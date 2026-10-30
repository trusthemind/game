package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

// Every Store must pass the same contract. Mongo runs when MONGODB_TEST_URI is set (CI starts a
// mongo service container); each run uses a throwaway database.
func stores(t *testing.T) map[string]Store {
	out := map[string]Store{"memory": NewMemory()}
	if uri := os.Getenv("MONGODB_TEST_URI"); uri != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		db := fmt.Sprintf("ashfall_test_%d", time.Now().UnixNano())
		m, err := NewMongo(ctx, uri, db, 50)
		if err != nil {
			t.Fatalf("mongo: %v", err)
		}
		t.Cleanup(func() {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			_ = m.client.Database(db).Drop(ctx)
			_ = m.Close(ctx)
		})
		out["mongo"] = m
	}
	return out
}

func TestStoreContract(t *testing.T) {
	for name, s := range stores(t) {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			now := time.Now().UTC().Truncate(time.Millisecond)
			p := Player{ID: "p1", Name: "Fedir", TokenHashes: []string{"h1"}, CreatedAt: now}
			if err := s.CreatePlayer(ctx, p); err != nil {
				t.Fatal(err)
			}
			got, err := s.PlayerByTokenHash(ctx, "h1")
			if err != nil || got.ID != "p1" || got.Name != "Fedir" {
				t.Fatalf("by token: %+v %v", got, err)
			}
			if _, err := s.PlayerByTokenHash(ctx, "nope"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("unknown token: %v", err)
			}

			// Devices: a new token works alongside the old one; the oldest falls off past MaxDevices.
			for i := 2; i <= MaxDevices+1; i++ {
				if err := s.AddTokenHash(ctx, "p1", fmt.Sprintf("h%d", i)); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.PlayerByTokenHash(ctx, "h1"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("oldest device should be dropped: %v", err)
			}
			if _, err := s.PlayerByTokenHash(ctx, fmt.Sprintf("h%d", MaxDevices+1)); err != nil {
				t.Fatalf("newest device: %v", err)
			}
			if err := s.AddTokenHash(ctx, "ghost", "hx"); !errors.Is(err, ErrNotFound) {
				t.Fatalf("token for missing player: %v", err)
			}

			// Profiles: optimistic concurrency on rev.
			data, rev, err := s.GetProfile(ctx, "p1")
			if err != nil || data != nil || rev != 0 {
				t.Fatalf("empty profile: %s %d %v", data, rev, err)
			}
			doc := json.RawMessage(`{"name":"Fedir","npcs":{"vera.k":{"a":1}},"stash":{"0":1}}`)
			if rev, err = s.PutProfile(ctx, "p1", doc, 0, Stats{Name: "Fedir R", XP: 3000, Survived: 2, Kills: 9}); err != nil || rev != 1 {
				t.Fatalf("first put: %d %v", rev, err)
			}
			if _, err = s.PutProfile(ctx, "p1", doc, 0, Stats{}); !errors.Is(err, ErrConflict) {
				t.Fatalf("stale first put: %v", err)
			}
			if _, err = s.PutProfile(ctx, "p1", doc, 5, Stats{}); !errors.Is(err, ErrConflict) {
				t.Fatalf("future rev: %v", err)
			}
			if rev, err = s.PutProfile(ctx, "p1", doc, 1, Stats{Name: "Fedir R", XP: 3500, Survived: 3, Kills: 9}); err != nil || rev != 2 {
				t.Fatalf("second put: %d %v", rev, err)
			}
			data, rev, _ = s.GetProfile(ctx, "p1")
			if rev != 2 || string(data) != string(doc) {
				t.Fatalf("round trip: %s rev %d", data, rev)
			}

			// Link codes: single use, expire.
			if err := s.SaveLinkCode(ctx, "ABCDEFGH", "p1", now.Add(time.Minute)); err != nil {
				t.Fatal(err)
			}
			if id, err := s.TakeLinkCode(ctx, "ABCDEFGH", now); err != nil || id != "p1" {
				t.Fatalf("take: %q %v", id, err)
			}
			if _, err := s.TakeLinkCode(ctx, "ABCDEFGH", now); !errors.Is(err, ErrNotFound) {
				t.Fatalf("reuse: %v", err)
			}
			_ = s.SaveLinkCode(ctx, "OLDCODE2", "p1", now.Add(time.Minute))
			if _, err := s.TakeLinkCode(ctx, "OLDCODE2", now.Add(2*time.Minute)); !errors.Is(err, ErrNotFound) {
				t.Fatalf("expired: %v", err)
			}

			// Leaderboard: by xp, players without xp hidden, no token hashes leaked.
			_ = s.CreatePlayer(ctx, Player{ID: "p2", Name: "Lena", TokenHashes: []string{"z1"}, CreatedAt: now})
			_ = s.CreatePlayer(ctx, Player{ID: "p3", Name: "Idle", TokenHashes: []string{"z2"}, CreatedAt: now})
			if _, err := s.PutProfile(ctx, "p2", doc, 0, Stats{Name: "Lena", XP: 9000, Survived: 8, Kills: 30}); err != nil {
				t.Fatal(err)
			}
			if err := s.AddRaid(ctx, Raid{PlayerID: "p2", Status: "extracted", Kills: 3, XP: 800, At: now}); err != nil {
				t.Fatal(err)
			}
			lb, err := s.Leaderboard(ctx, 10)
			if err != nil || len(lb) != 2 || lb[0].Name != "Lena" || lb[1].Name != "Fedir R" || lb[1].XP != 3500 || lb[1].Survived != 3 {
				t.Fatalf("leaderboard: %+v %v", lb, err)
			}
			for _, e := range lb {
				if len(e.TokenHashes) != 0 {
					t.Fatalf("leaderboard leaks token hashes: %+v", e)
				}
			}
		})
	}
}
