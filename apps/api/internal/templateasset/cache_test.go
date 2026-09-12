package templateasset

import (
	"strings"
	"testing"
)

func TestObjectCacheEvictsLeastRecentlyUsedWithinItsBudget(t *testing.T) {
	cache := NewObjectCache(20)
	body := func(text string) []byte { return []byte(strings.Repeat(text, 10)) }

	cache.Put("a", body("a"))
	cache.Put("b", body("b"))
	if _, found := cache.Get("a"); !found {
		t.Fatal("a was evicted while the cache still fit")
	}
	/* a was just read, so b is the eviction candidate */
	cache.Put("c", body("c"))
	if _, found := cache.Get("b"); found {
		t.Error("b survived past the budget")
	}
	for _, key := range []string{"a", "c"} {
		if _, found := cache.Get(key); !found {
			t.Errorf("%s was evicted", key)
		}
	}
}

func TestObjectCacheRefusesEntriesLargerThanItsBudget(t *testing.T) {
	cache := NewObjectCache(8)
	cache.Put("small", []byte("12345678"))
	cache.Put("huge", []byte(strings.Repeat("x", 9)))

	if _, found := cache.Get("huge"); found {
		t.Error("an entry over the whole budget was admitted")
	}
	if _, found := cache.Get("small"); !found {
		t.Error("an oversized entry flushed the cache on its way to being refused")
	}
	if _, found := cache.Get("missing"); found {
		t.Error("a key that was never stored was reported cached")
	}
}
