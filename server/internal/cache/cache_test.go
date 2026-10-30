package cache

import (
	"testing"
	"time"
)

func TestTTL(t *testing.T) {
	c := New[string, int](time.Minute, 3)
	now := time.Unix(1000, 0)
	c.Set("a", 1, now)
	if v, ok := c.Get("a", now.Add(59*time.Second)); !ok || v != 1 {
		t.Fatalf("fresh entry: %v %v", v, ok)
	}
	if _, ok := c.Get("a", now.Add(61*time.Second)); ok {
		t.Fatal("expired entry returned")
	}
	c.Set("b", 2, now)
	c.Set("c", 3, now)
	c.Set("d", 4, now) // over max: starts over
	if _, ok := c.Get("a", now); ok {
		t.Fatal("cache did not reset at max size")
	}
	c.DeleteFunc(func(v int) bool { return v == 4 })
	if _, ok := c.Get("d", now); ok {
		t.Fatal("DeleteFunc kept the entry")
	}
}
