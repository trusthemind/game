package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/trusthemind/game/server/internal/store"
)

type client struct {
	t   *testing.T
	srv *httptest.Server
}

func newClient(t *testing.T) (*client, *Server) {
	t.Helper()
	s := New(store.NewMemory(), Options{AllowedOrigins: []string{"https://ashfall-two.vercel.app", "*.vercel.app"}})
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)
	return &client{t, srv}, s
}

func (c *client) do(method, path, token string, body any, out any) int {
	c.t.Helper()
	var rd *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	} else {
		rd = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, c.srv.URL+"/api/v1"+path, rd)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			c.t.Fatalf("%s %s: decode: %v", method, path, err)
		}
	}
	return res.StatusCode
}

type auth struct {
	PlayerID string `json:"playerId"`
	Token    string `json:"token"`
	Code     string `json:"code"`
}

func (c *client) register(name string) auth {
	var a auth
	if st := c.do("POST", "/players", "", map[string]string{"name": name}, &a); st != http.StatusCreated {
		c.t.Fatalf("register: %d", st)
	}
	return a
}

func TestHealth(t *testing.T) {
	c, _ := newClient(t)
	var h struct {
		OK bool   `json:"ok"`
		DB string `json:"db"`
	}
	if st := c.do("GET", "/health", "", nil, &h); st != 200 || !h.OK || h.DB != "memory" {
		t.Fatalf("health: %d %+v", st, h)
	}
}

func TestProfileSyncWithConflicts(t *testing.T) {
	c, _ := newClient(t)
	a := c.register("  Fedir   the  Scav ")
	if len(a.Token) != 64 || a.PlayerID == "" || len(a.Code) != linkCodeLen {
		t.Fatalf("bad registration: %+v", a)
	}

	var got struct {
		Profile json.RawMessage `json:"profile"`
		Rev     int64           `json:"rev"`
	}
	c.do("GET", "/profile", a.Token, nil, &got)
	if string(got.Profile) != "null" || got.Rev != 0 {
		t.Fatalf("fresh profile: %s rev %d", got.Profile, got.Rev)
	}

	profile := map[string]any{"name": "Fedir", "xp": 2500, "stats": map[string]int{"survived": 3, "kills": 7}, "stash": map[string]any{"w": 10}}
	var put struct {
		Rev int64 `json:"rev"`
	}
	if st := c.do("PUT", "/profile", a.Token, map[string]any{"profile": profile, "baseRev": 0}, &put); st != 200 || put.Rev != 1 {
		t.Fatalf("first put: %d rev %d", st, put.Rev)
	}
	// A second device still at rev 0 loses the race.
	var conflict struct {
		Error string `json:"error"`
		Rev   int64  `json:"rev"`
	}
	if st := c.do("PUT", "/profile", a.Token, map[string]any{"profile": profile, "baseRev": 0}, &conflict); st != http.StatusConflict || conflict.Rev != 1 {
		t.Fatalf("stale put: %d %+v", st, conflict)
	}
	if st := c.do("PUT", "/profile", a.Token, map[string]any{"profile": profile, "baseRev": 1}, &put); st != 200 || put.Rev != 2 {
		t.Fatalf("second put: %d rev %d", st, put.Rev)
	}
	c.do("GET", "/profile", a.Token, nil, &got)
	var back map[string]any
	_ = json.Unmarshal(got.Profile, &back)
	if got.Rev != 2 || back["name"] != "Fedir" {
		t.Fatalf("round trip: rev %d %v", got.Rev, back)
	}

	if st := c.do("PUT", "/profile", a.Token, map[string]any{"profile": []int{1}, "baseRev": 2}, nil); st != http.StatusBadRequest {
		t.Fatalf("non-object profile accepted: %d", st)
	}
}

func TestAuthRequired(t *testing.T) {
	c, _ := newClient(t)
	for _, tok := range []string{"", "nope", strings.Repeat("a", 64)} {
		if st := c.do("GET", "/profile", tok, nil, nil); st != http.StatusUnauthorized {
			t.Fatalf("token %q: %d", tok, st)
		}
	}
}

func TestLinkCodeMovesAccountToAnotherDevice(t *testing.T) {
	c, s := newClient(t)
	a := c.register("Lena")
	var code struct {
		Code string `json:"code"`
	}
	c.do("GET", "/players/me/code", a.Token, nil, &code)

	var b auth
	if st := c.do("POST", "/players/claim", "", map[string]string{"code": strings.ToLower(code.Code)}, &b); st != 200 || b.PlayerID != a.PlayerID || b.Token == a.Token {
		t.Fatalf("claim: %d %+v", st, b)
	}
	// Both devices stay signed in.
	for _, tok := range []string{a.Token, b.Token} {
		if st := c.do("GET", "/profile", tok, nil, nil); st != 200 {
			t.Fatalf("device token rejected: %d", st)
		}
	}
	// Single use.
	if st := c.do("POST", "/players/claim", "", map[string]string{"code": code.Code}, nil); st != http.StatusNotFound {
		t.Fatalf("code reused: %d", st)
	}
	// Expiry.
	c.do("GET", "/players/me/code", a.Token, nil, &code)
	s.now = func() time.Time { return time.Now().Add(linkCodeTTL + time.Minute) }
	if st := c.do("POST", "/players/claim", "", map[string]string{"code": code.Code}, nil); st != http.StatusNotFound {
		t.Fatalf("expired code accepted: %d", st)
	}
}

func TestClaimIsRateLimited(t *testing.T) {
	c, _ := newClient(t)
	last := 0
	for i := 0; i < 25; i++ {
		last = c.do("POST", "/players/claim", "", map[string]string{"code": "ZZZZZZZZ"}, nil)
	}
	if last != http.StatusTooManyRequests {
		t.Fatalf("expected 429 after many guesses, got %d", last)
	}
}

func TestRaidsAndLeaderboard(t *testing.T) {
	c, _ := newClient(t)
	a := c.register("Kostia")
	b := c.register("Bohdan")
	c.do("PUT", "/profile", a.Token, map[string]any{"profile": map[string]any{"name": "Kostia", "xp": 1000, "stats": map[string]int{"survived": 1, "kills": 4}}, "baseRev": 0}, nil)
	c.do("PUT", "/profile", b.Token, map[string]any{"profile": map[string]any{"name": "Bohdan", "xp": 5000, "stats": map[string]int{"survived": 6, "kills": 20}}, "baseRev": 0}, nil)

	if st := c.do("POST", "/raids", a.Token, map[string]any{"status": "extracted", "kills": 4, "xp": 900, "value": 120000, "duration": 840}, nil); st != 200 {
		t.Fatalf("raid: %d", st)
	}
	if st := c.do("POST", "/raids", a.Token, map[string]any{"status": "won", "kills": 1}, nil); st != http.StatusBadRequest {
		t.Fatalf("bad raid status accepted: %d", st)
	}

	var lb struct {
		Entries []boardEntry `json:"entries"`
	}
	c.do("GET", "/leaderboard", "", nil, &lb)
	if len(lb.Entries) != 2 || lb.Entries[0].Name != "Bohdan" || lb.Entries[0].Level != LevelFromXP(5000) || lb.Entries[1].Kills != 4 {
		t.Fatalf("leaderboard: %+v", lb.Entries)
	}
}

func TestLevelMatchesEngine(t *testing.T) {
	// levelFromXp in packages/engine/src/profile.ts: 1000, 1250, 1563, 1954…
	for xp, want := range map[int64]int{0: 1, 999: 1, 1000: 2, 2249: 2, 2250: 3, 3813: 4, 3812: 3} {
		if got := LevelFromXP(xp); got != want {
			t.Errorf("LevelFromXP(%d) = %d, want %d", xp, got, want)
		}
	}
}

func TestCORS(t *testing.T) {
	c, _ := newClient(t)
	for origin, allowed := range map[string]bool{
		"https://ashfall-two.vercel.app":    true,
		"https://ashfall-abc123.vercel.app": true,
		"https://evil.example":              false,
		"https://vercel.app.evil.example":   false,
	} {
		req, _ := http.NewRequest("OPTIONS", c.srv.URL+"/api/v1/profile", nil)
		req.Header.Set("Origin", origin)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if got := res.Header.Get("Access-Control-Allow-Origin") == origin; got != allowed {
			t.Errorf("origin %s: allowed=%v, want %v", origin, got, allowed)
		}
	}
}

func TestBodyLimit(t *testing.T) {
	c, _ := newClient(t)
	a := c.register("Big")
	huge := map[string]any{"profile": map[string]string{"blob": strings.Repeat("x", maxProfileBytes)}, "baseRev": 0}
	if st := c.do("PUT", "/profile", a.Token, huge, nil); st != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized profile: %d", st)
	}
}
