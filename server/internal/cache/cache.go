// Package cache is a small in-process TTL map. Each API instance keeps its own: it only ever holds data
// that may be a few seconds stale without harm (token → player, the leaderboard).
package cache

import (
	"sync"
	"time"
)

type entry[V any] struct {
	v   V
	exp time.Time
}

// TTL maps keys to values for a fixed time. When it reaches max entries it starts over rather than
// tracking recency: cheap, and a cold miss only costs one database read.
type TTL[K comparable, V any] struct {
	mu  sync.RWMutex
	ttl time.Duration
	max int
	m   map[K]entry[V]
}

func New[K comparable, V any](ttl time.Duration, max int) *TTL[K, V] {
	return &TTL[K, V]{ttl: ttl, max: max, m: make(map[K]entry[V])}
}

func (c *TTL[K, V]) Get(k K, now time.Time) (V, bool) {
	c.mu.RLock()
	e, ok := c.m[k]
	c.mu.RUnlock()
	if !ok || now.After(e.exp) {
		var zero V
		return zero, false
	}
	return e.v, true
}

func (c *TTL[K, V]) Set(k K, v V, now time.Time) {
	c.mu.Lock()
	if len(c.m) >= c.max {
		c.m = make(map[K]entry[V], c.max/4)
	}
	c.m[k] = entry[V]{v: v, exp: now.Add(c.ttl)}
	c.mu.Unlock()
}

// DeleteFunc drops every entry whose value matches.
func (c *TTL[K, V]) DeleteFunc(match func(V) bool) {
	c.mu.Lock()
	for k, e := range c.m {
		if match(e.v) {
			delete(c.m, k)
		}
	}
	c.mu.Unlock()
}
