package templateasset

import (
	"container/list"
	"sync"
)

// DefaultPreviewCacheBytes bounds the in-process slide cache. The landing ring
// asks for a few dozen small slides per visit and every one of them is a signed
// round trip to the CDN, so holding the hot set in memory turns a cold visit
// from thirty origin fetches into one per distinct slide.
const DefaultPreviewCacheBytes = int64(64 << 20)

// ObjectCache holds immutable, digest-pinned object bytes up to a byte budget,
// evicting least recently used entries first.
//
// Only immutable keys belong here. Entries never expire, because the objects it
// is built for cannot change under their key: a republished template lands on a
// new digest, and so on a new key.
type ObjectCache struct {
	mutex   sync.Mutex
	maxSize int64
	size    int64
	order   *list.List
	entries map[string]*list.Element
}

type cacheEntry struct {
	key  string
	body []byte
}

// NewObjectCache returns a cache bounded to maxBytes, or the default budget
// when that is not positive.
func NewObjectCache(maxBytes int64) *ObjectCache {
	if maxBytes <= 0 {
		maxBytes = DefaultPreviewCacheBytes
	}
	return &ObjectCache{
		maxSize: maxBytes,
		order:   list.New(),
		entries: make(map[string]*list.Element),
	}
}

// Get returns the cached bytes for a key and marks it most recently used. The
// returned slice is the cached one: callers must not write to it.
func (cache *ObjectCache) Get(key string) ([]byte, bool) {
	if cache == nil {
		return nil, false
	}
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	element, found := cache.entries[key]
	if !found {
		return nil, false
	}
	cache.order.MoveToFront(element)
	entry, ok := element.Value.(*cacheEntry)
	if !ok {
		return nil, false
	}
	return entry.body, true
}

// Put stores bytes under a key, evicting the least recently used entries until
// the cache fits its budget. A body larger than the whole budget is not cached,
// since admitting it would flush everything else to hold one object.
func (cache *ObjectCache) Put(key string, body []byte) {
	if cache == nil || len(body) == 0 || int64(len(body)) > cache.maxSize {
		return
	}
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	if element, found := cache.entries[key]; found {
		cache.order.MoveToFront(element)
		return
	}
	cache.entries[key] = cache.order.PushFront(&cacheEntry{key: key, body: body})
	cache.size += int64(len(body))
	for cache.size > cache.maxSize {
		oldest := cache.order.Back()
		if oldest == nil {
			return
		}
		cache.order.Remove(oldest)
		entry, ok := oldest.Value.(*cacheEntry)
		if !ok {
			continue
		}
		delete(cache.entries, entry.key)
		cache.size -= int64(len(entry.body))
	}
}
