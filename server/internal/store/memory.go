package store

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"
)

type linkCode struct {
	playerID string
	expires  time.Time
}

// Memory is a process-local Store. Data is lost on restart: for development and tests only.
type Memory struct {
	mu       sync.Mutex
	players  map[string]*Player
	byToken  map[string]string
	profiles map[string]*Profile
	codes    map[string]linkCode
	raids    []Raid
}

func NewMemory() *Memory {
	return &Memory{
		players:  map[string]*Player{},
		byToken:  map[string]string{},
		profiles: map[string]*Profile{},
		codes:    map[string]linkCode{},
	}
}

func (m *Memory) Kind() string                { return "memory" }
func (m *Memory) Ping(context.Context) error  { return nil }
func (m *Memory) Close(context.Context) error { return nil }

func (m *Memory) CreatePlayer(_ context.Context, p Player) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := p
	cp.TokenHashes = append([]string(nil), p.TokenHashes...)
	m.players[p.ID] = &cp
	for _, h := range cp.TokenHashes {
		m.byToken[h] = p.ID
	}
	return nil
}

func (m *Memory) PlayerByTokenHash(_ context.Context, hash string) (Player, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	id, ok := m.byToken[hash]
	if !ok {
		return Player{}, ErrNotFound
	}
	p := *m.players[id]
	p.TokenHashes = append([]string(nil), p.TokenHashes...)
	return p, nil
}

func (m *Memory) AddTokenHash(_ context.Context, playerID, hash string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.players[playerID]
	if !ok {
		return ErrNotFound
	}
	p.TokenHashes = append(p.TokenHashes, hash)
	m.byToken[hash] = playerID
	if n := len(p.TokenHashes) - MaxDevices; n > 0 {
		for _, old := range p.TokenHashes[:n] {
			delete(m.byToken, old)
		}
		p.TokenHashes = append([]string(nil), p.TokenHashes[n:]...)
	}
	return nil
}

func (m *Memory) GetProfile(_ context.Context, playerID string) (json.RawMessage, int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	pr, ok := m.profiles[playerID]
	if !ok {
		return nil, 0, nil
	}
	return pr.Data, pr.Rev, nil
}

func (m *Memory) PutProfile(_ context.Context, playerID string, data json.RawMessage, baseRev int64, st Stats) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cur := int64(0)
	if pr, ok := m.profiles[playerID]; ok {
		cur = pr.Rev
	}
	if cur != baseRev {
		return 0, ErrConflict
	}
	m.profiles[playerID] = &Profile{PlayerID: playerID, Rev: cur + 1, Data: append(json.RawMessage(nil), data...), UpdatedAt: time.Now()}
	if p, ok := m.players[playerID]; ok {
		if st.Name != "" {
			p.Name = st.Name
		}
		p.XP, p.Survived, p.Kills = st.XP, st.Survived, st.Kills
	}
	return cur + 1, nil
}

func (m *Memory) SaveLinkCode(_ context.Context, code, playerID string, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.codes[code] = linkCode{playerID, expires}
	return nil
}

func (m *Memory) TakeLinkCode(_ context.Context, code string, now time.Time) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	c, ok := m.codes[code]
	delete(m.codes, code)
	if !ok || now.After(c.expires) {
		return "", ErrNotFound
	}
	return c.playerID, nil
}

func (m *Memory) AddRaid(_ context.Context, r Raid) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.raids = append(m.raids, r)
	return nil
}

func (m *Memory) Leaderboard(_ context.Context, limit int) ([]Player, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Player, 0, len(m.players))
	for _, p := range m.players {
		if p.XP > 0 {
			e := *p
			e.TokenHashes = nil
			out = append(out, e)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].XP != out[j].XP {
			return out[i].XP > out[j].XP
		}
		return out[i].CreatedAt.Before(out[j].CreatedAt)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
