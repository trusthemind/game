// Command loadtest hammers the API with the end-of-raid save, the heaviest thing real players do:
//
//	PUT  /api/v1/profile   the whole profile (stash, gear, quests…) with compare-and-swap on the revision
//	POST /api/v1/raids     the raid record
//	GET  /api/v1/leaderboard  one player in ten opens it afterwards
//
// Each virtual user registers once, then repeats that sequence with no think time (closed loop), so
// throughput is limited only by the server. Runs a ramp of concurrency levels and prints latency
// percentiles, throughput and every non-2xx status per step.
//
//	go run ./cmd/loadtest -url http://localhost:8080 -profile profile.json -steps 25,100,250,500 -dur 20s
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type sample struct {
	op     string
	status int
	dur    time.Duration
}

type user struct {
	token string
	rev   int64
}

// lost counts saves the server acknowledged (200) that later turned out to be missing: a 409 reporting
// a revision older than one we were already given. Non-zero means acknowledged writes can be lost.
var lost atomic.Int64

func main() {
	base := flag.String("url", "http://localhost:8080", "API base URL")
	profilePath := flag.String("profile", "", "profile JSON to save (a real one from the game)")
	pad := flag.Int("pad", 0, "extra KB of padding added to the profile (simulates bigger stashes)")
	stepsArg := flag.String("steps", "25,100,250,500", "concurrency levels")
	dur := flag.Duration("dur", 20*time.Second, "duration of each step")
	timeout := flag.Duration("timeout", 10*time.Second, "per-request timeout")
	flag.Parse()

	profile := map[string]any{"name": "LoadTester", "xp": 1000, "stats": map[string]int{"survived": 1, "kills": 1}}
	if *profilePath != "" {
		raw, err := os.ReadFile(*profilePath)
		must(err)
		must(json.Unmarshal(raw, &profile))
	}
	if *pad > 0 {
		profile["history"] = strings.Repeat("x", *pad<<10)
	}
	probe, _ := json.Marshal(profile)
	fmt.Printf("profile body: %.1f KB\n", float64(len(probe))/1024)

	client := &http.Client{
		Timeout:   *timeout,
		Transport: &http.Transport{MaxIdleConns: 4096, MaxIdleConnsPerHost: 4096, IdleConnTimeout: 90 * time.Second},
	}
	var steps []int
	for _, s := range strings.Split(*stepsArg, ",") {
		n, err := strconv.Atoi(strings.TrimSpace(s))
		must(err)
		steps = append(steps, n)
	}

	// Accounts for the largest step, created up front (not part of the measurement).
	maxUsers := slices.Max(steps)
	users := make([]*user, maxUsers)
	t0 := time.Now()
	var wg sync.WaitGroup
	sem := make(chan struct{}, 64)
	var regErr error
	var mu sync.Mutex
	for i := range users {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			var r struct{ Token string }
			st, _, err := call(client, "POST", *base+"/api/v1/players", "", map[string]string{"name": fmt.Sprintf("lt%05d", i)}, &r)
			if err != nil || st != http.StatusCreated {
				mu.Lock()
				regErr = fmt.Errorf("register: status %d err %v", st, err)
				mu.Unlock()
				return
			}
			users[i] = &user{token: r.Token}
		}()
	}
	wg.Wait()
	must(regErr)
	fmt.Printf("registered %d players in %s\n\n", maxUsers, time.Since(t0).Round(time.Millisecond))

	fmt.Printf("%-6s %-12s %8s %8s %8s %8s %8s %8s  %s\n", "users", "op", "req/s", "p50", "p95", "p99", "max", "errors", "statuses")
	for _, n := range steps {
		runStep(client, *base, users[:n], profile, *dur)
	}
}

func runStep(client *http.Client, base string, users []*user, profile map[string]any, dur time.Duration) {
	ctx, cancel := context.WithTimeout(context.Background(), dur)
	defer cancel()
	out := make(chan sample, 65536)
	var wg sync.WaitGroup
	for i, u := range users {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rng := rand.New(rand.NewPCG(uint64(i), 7))
			// Each user owns a copy so the server sees a changing profile every save.
			p := make(map[string]any, len(profile))
			for k, v := range profile {
				p[k] = v
			}
			xp := 1000
			for ctx.Err() == nil {
				xp += rng.IntN(2000)
				p["xp"] = xp
				p["money"] = rng.IntN(5_000_000)
				var put struct{ Rev int64 }
				st, d, err := call(client, "PUT", base+"/api/v1/profile", u.token, map[string]any{"profile": p, "baseRev": u.rev}, &put)
				out <- sample{"save", code(st, err), d}
				if st == http.StatusOK {
					u.rev = put.Rev
				} else if st == http.StatusConflict {
					if put.Rev < u.rev {
						lost.Add(1)
					}
					u.rev = put.Rev
				}
				raid := map[string]any{"status": "extracted", "kills": rng.IntN(12), "xp": rng.IntN(5000), "value": rng.IntN(400000), "duration": 300 + rng.IntN(1500)}
				st, d, err = call(client, "POST", base+"/api/v1/raids", u.token, raid, nil)
				out <- sample{"raid", code(st, err), d}
				if rng.IntN(10) == 0 {
					st, d, err = call(client, "GET", base+"/api/v1/leaderboard", "", nil, nil)
					out <- sample{"board", code(st, err), d}
				}
			}
		}()
	}
	go func() {
		wg.Wait()
		close(out)
	}()
	byOp := map[string][]sample{}
	start := time.Now()
	for s := range out {
		byOp[s.op] = append(byOp[s.op], s)
	}
	elapsed := time.Since(start).Seconds()
	for _, op := range []string{"save", "raid", "board"} {
		ss := byOp[op]
		if len(ss) == 0 {
			continue
		}
		ds := make([]time.Duration, len(ss))
		codes := map[int]int{}
		errs := 0
		for i, s := range ss {
			ds[i] = s.dur
			codes[s.status]++
			if s.status < 200 || s.status >= 300 {
				errs++
			}
		}
		slices.Sort(ds)
		pct := func(p float64) string { return ms(ds[min(len(ds)-1, int(p*float64(len(ds))))]) }
		var parts []string
		for c, k := range codes {
			parts = append(parts, fmt.Sprintf("%d×%d", c, k))
		}
		slices.Sort(parts)
		fmt.Printf("%-6d %-12s %8.0f %8s %8s %8s %8s %8d  %s\n", len(users), op, float64(len(ss))/elapsed, pct(0.5), pct(0.95), pct(0.99), ms(ds[len(ds)-1]), errs, strings.Join(parts, " "))
	}
	fmt.Printf("acknowledged saves lost so far: %d\n\n", lost.Load())
}

// call sends JSON and decodes JSON; status 0 means a transport error (timeout, refused…).
func call(c *http.Client, method, url, token string, body any, out any) (int, time.Duration, error) {
	var rd io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return 0, 0, err
		}
		rd = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, url, rd)
	if err != nil {
		return 0, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	t := time.Now()
	res, err := c.Do(req)
	if err != nil {
		return 0, time.Since(t), err
	}
	defer res.Body.Close()
	if out != nil {
		_ = json.NewDecoder(res.Body).Decode(out)
	} else {
		_, _ = io.Copy(io.Discard, res.Body)
	}
	return res.StatusCode, time.Since(t), nil
}

func code(st int, err error) int {
	if err != nil {
		return 0
	}
	return st
}

func ms(d time.Duration) string { return fmt.Sprintf("%.1fms", float64(d.Microseconds())/1000) }

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
