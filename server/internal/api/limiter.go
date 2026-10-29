package api

import (
	"sync"
	"time"
)

// limiter is a fixed-window counter per key. Small and good enough to blunt link-code guessing and
// account spam from one address; it lives in memory, so each instance counts on its own.
type limiter struct {
	mu     sync.Mutex
	max    int
	window time.Duration
	hits   map[string]*window
	sweep  time.Time
}

type window struct {
	start time.Time
	n     int
}

func newLimiter(max int, per time.Duration) *limiter {
	return &limiter{max: max, window: per, hits: map[string]*window{}}
}

func (l *limiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if now.Sub(l.sweep) > l.window {
		for k, w := range l.hits {
			if now.Sub(w.start) > l.window {
				delete(l.hits, k)
			}
		}
		l.sweep = now
	}
	w := l.hits[key]
	if w == nil || now.Sub(w.start) > l.window {
		l.hits[key] = &window{start: now, n: 1}
		return true
	}
	if w.n >= l.max {
		return false
	}
	w.n++
	return true
}
