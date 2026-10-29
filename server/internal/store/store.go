// Package store persists players, their synced profiles and raid history.
//
// Two implementations share one contract: Mongo for production (Railway) and an in-memory store for
// local development and tests. The API layer only talks to the Store interface.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var (
	// ErrNotFound: no such player / code.
	ErrNotFound = errors.New("not found")
	// ErrConflict: the profile changed on the server since the client last saw it (optimistic concurrency).
	ErrConflict = errors.New("revision conflict")
)

// Player is an account. There are no passwords: a device holds a bearer token, and a short link code
// moves the account to another device.
type Player struct {
	ID   string `json:"id" bson:"_id"`
	Name string `json:"name" bson:"name"`
	// SHA-256 of each device's bearer token (newest last, capped at MaxDevices).
	TokenHashes []string  `json:"-" bson:"tokenHashes"`
	CreatedAt   time.Time `json:"createdAt" bson:"createdAt"`
	// Leaderboard fields, refreshed from the profile on every save.
	XP       int64 `json:"xp" bson:"xp"`
	Survived int64 `json:"survived" bson:"survived"`
	Kills    int64 `json:"kills" bson:"kills"`
}

// Profile is the client's save game, stored verbatim (the engine owns its schema).
type Profile struct {
	PlayerID  string          `bson:"_id"`
	Rev       int64           `bson:"rev"`
	Data      json.RawMessage `bson:"-"`
	UpdatedAt time.Time       `bson:"updatedAt"`
}

// Raid is one finished raid, as reported by the client.
type Raid struct {
	PlayerID string    `json:"-" bson:"playerId"`
	Status   string    `json:"status" bson:"status"`
	Kills    int       `json:"kills" bson:"kills"`
	XP       int       `json:"xp" bson:"xp"`
	Value    int64     `json:"value" bson:"value"`
	Duration int       `json:"duration" bson:"duration"`
	At       time.Time `json:"at" bson:"at"`
}

// Stats are the leaderboard numbers pulled out of a profile.
type Stats struct {
	Name     string
	XP       int64
	Survived int64
	Kills    int64
}

// MaxDevices is how many devices can hold a token for one player at once.
const MaxDevices = 8

type Store interface {
	// Kind names the backend for /health ("mongo" or "memory").
	Kind() string
	Ping(ctx context.Context) error

	CreatePlayer(ctx context.Context, p Player) error
	PlayerByTokenHash(ctx context.Context, hash string) (Player, error)
	// AddTokenHash authorises one more device, dropping the oldest beyond MaxDevices.
	AddTokenHash(ctx context.Context, playerID, hash string) error

	// GetProfile returns (nil, 0) when the player hasn't saved yet.
	GetProfile(ctx context.Context, playerID string) (json.RawMessage, int64, error)
	// PutProfile stores data if the current revision equals baseRev and returns the new revision;
	// otherwise ErrConflict.
	PutProfile(ctx context.Context, playerID string, data json.RawMessage, baseRev int64, stats Stats) (int64, error)

	// SaveLinkCode remembers a one-time code for moving the account to another device.
	SaveLinkCode(ctx context.Context, code, playerID string, expires time.Time) error
	// TakeLinkCode consumes a code (single use) and returns its player.
	TakeLinkCode(ctx context.Context, code string, now time.Time) (string, error)

	AddRaid(ctx context.Context, r Raid) error
	Leaderboard(ctx context.Context, limit int) ([]Player, error)

	Close(ctx context.Context) error
}
