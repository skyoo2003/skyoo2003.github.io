---
title: "Keeping Local Caches Consistent Across ACOR Instances with Redis Pub/Sub"
date: 2026-10-01T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, redis, acor, caching]
---

## Introduction

[ACOR](https://github.com/skyoo2003/acor) is a Go library that stores an Aho-Corasick dictionary in Redis. Keeping the dictionary in Redis lets many processes share one keyword set. The cost is that every `Find` has to read the dictionary from Redis.

v0.5.0 added a **local cache** to cut that cost. Each instance holds the dictionary as an in-memory automaton and serves `Find` locally. That leaves one question: when instance A adds a keyword, how does instance B know to drop its cache?

The answer was Redis Pub/Sub. After a write, the writer publishes an invalidation message on the collection's channel, and every instance subscribes to that channel. The design is simple. Yet between v0.5.0 and v1.6.0, this simple design produced four bugs. This post follows them one by one and collects the problems you actually run into when building a distributed local cache.

## The Basic Design

The cache exists in two modes: V2 schema with `EnableCache` on, and `Preset` mode, which searches with a local engine. Both follow the same flow:

```
 Instance A                     Redis                     Instance B
 ──────────                     ─────                     ──────────
 Add("hello") ──write─────────▶ dictionary updated
 update local cache
 PUBLISH ─────────────────────▶ acor:invalidate:<name> ──▶ message received
                                                          drop local cache
                                                          rebuild on next Find
```

The writer has already updated its own cache, so when its own message comes back, it should ignore it. Ignoring your own message was the first problem.

## Problem 1: Dropping Your Own Cache on Your Own Message

With Pub/Sub, a client that publishes a message also receives it if it is subscribed to the same channel. The first implementation in v0.5.0 did not account for that. An instance wrote, updated its local cache, published, then received its own message and dropped the cache it had just updated. Results were not wrong, since the next `Find` read the dictionary again. But every write caused a needless rebuild.

The v0.5.1 fix went through two steps. First came a boolean flag: before publishing, mark "the next message is mine." With two concurrent writes, one flag is not enough, so it soon became an `int32` atomic counter. Increment on publish; on receive, if the counter is above zero, decrement it and ignore the message.

## Problem 2: The Counter Leaks

In v0.6.0 I found the flaw in the counter. Pub/Sub is **best-effort**. If a message is lost to a network problem or a buffer overflow, Redis does not resend it. If one of your own messages is lost, the counter stays at 1. Then the next message from **another instance** is mistaken for yours and ignored. The cache keeps serving the old dictionary.

A counter knows *how many* messages are yours, but not *which ones*. So the fix gave every message a unique ID:

```go
// newInvalidationID returns an id unique to this publish. The timestamp keeps
// ids ordered for debugging; the random suffix keeps two instances publishing in
// the same nanosecond from generating the same id — a collision is the dangerous
// direction, since the loser would mistake the winner's message for its own echo
// and skip a real invalidation.
func newInvalidationID() string {
	b := make([]byte, invalidateIDBytes)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%d:%x", time.Now().UnixNano(), b)
}
```

On publish, the ID goes into a `sync.Map`. On receive, the listener looks it up. A valid, unexpired ID in the map identifies a local message to ignore; a missing or expired ID invalidates the cache. Combining a timestamp with randomness makes collisions with other messages unlikely. Unlike the counter, a lost message does not leave an outstanding count that suppresses the next message.

The remaining issue was useless entries piling up, so a TTL was added. The current code:

```go
// selfSkipTTL bounds how long a self-published ID is remembered. A publish whose
// message never comes back — dropped delivery, a listener restart — would
// otherwise leak an entry forever. 30s is orders of magnitude beyond normal
// Redis pub/sub delivery latency.
const selfSkipTTL = 30 * time.Second

// claim atomically consumes id, reporting whether it was a live self-publish.
// An expired or unknown id returns false, so the caller invalidates.
func (s *selfSkipSet) claim(id string) bool {
	val, loaded := s.ids.LoadAndDelete(id)
	if !loaded {
		return false
	}
	t, ok := val.(time.Time)
	if !ok {
		return false
	}
	age := time.Since(t)
	// A negative age means the clock moved backwards; treat it as untrustworthy
	// and invalidate rather than skip.
	if age < 0 {
		return false
	}
	return age < selfSkipTTL
}
```

A few choices stand out:

- **Expired entries are swept by publish count, not by a timer.** Every 128 publishes, one pass walks the whole map. Without new publishes, expired entries can remain until the next sweep. The listener still checks TTL on receipt, so an expired ID cannot suppress a message. No extra goroutine is needed.
- **When in doubt, invalidate.** A missing ID, an expired ID, a clock that went backwards, or a message that does not parse are all treated as "another instance's message." A needless rebuild is a performance problem, but a missed invalidation is a correctness problem. The costs are asymmetric, so the judgment leans one way.
- **`LoadAndDelete` makes each ID single-use.** The same ID is never ignored twice.

## Problem 3: A Lost Invalidation Stays Stale Forever

Fixing the self-message problem left the opposite direction. What happens if **another instance's** invalidation message is lost? This instance does not know the dictionary changed, and it keeps searching with a stale cache until the next write happens. For a dictionary that rarely changes, that could be hours.

Pub/Sub cannot be turned into a reliable channel. Instead, v0.10.0 added **polling** as a backstop. With `AhoCorasickArgs.InvalidationPollInterval` set, `Preset` mode checks Redis periodically. v1.6.0 changed the poll to read **only the version field**, not the whole dictionary. Only when the version has changed does the next search read the full dictionary and rebuild the engine. The cost of polling no longer depends on the dictionary size.

The docs are explicit about the limits too. The poll interval is not an upper bound on staleness when things fail. If a poll fails, it just retries on the next tick. So v1.6.0 also exposes failure counters: `PresetPollFailures` and `PresetReloadFailures`.

The same release defined what happens when a rebuild fails. The previous engine is kept, but instead of quietly answering with it, **the search returns an error**. Surfacing the failure is better than returning stale results as if they were normal.

## Problem 4: Rebuilding from Something Other Than What Was Committed

The last bug was a lost update fixed in v1.5.0. In `Preset` mode, a single `Add` or `Remove` rebuilt the local automaton from **an incrementally maintained keyword set**, not from the snapshot it had just committed to Redis.

The two sets are usually the same, but they differ if another instance added a keyword in between. The incremental set does not have that keyword, so the rebuilt engine loses it. On top of that, this instance has just written, so it believes its cache is fresh and does not read again. The lost keyword never comes back.

Batch writes (`AddMany`, `RemoveMany`) already applied the committed snapshot. Only single writes took a different path. The fix made single writes apply the committed snapshot too.

```
 Rebuild from incremental set (bug)    Rebuild from committed snapshot (fix)
 ──────────────────────────────────    ─────────────────────────────────────
 local set {a, b} + c                  commit to Redis → snapshot {a, b, x, c}
   → engine {a, b, c}                    → engine {a, b, x, c}
 (x, added by another instance, lost)
```

## Observability: CacheStats

After four bugs, I needed a way to see how the cache actually behaves. v1.5.0 added `AhoCorasick.CacheStats()`. It does no Redis I/O, so it is cheap to call on a timer.

```go
stats := ac.CacheStats()

// Hits+Misses is the read count. Both are zero before the first read.
hitRate := 0.0
if reads := stats.Hits + stats.Misses; reads > 0 {
    hitRate = float64(stats.Hits) / float64(reads)
}

// What one rebuild costs — the price a write makes every reader pay.
meanRebuild := time.Duration(0)
if stats.Rebuilds > 0 {
    meanRebuild = stats.RebuildDuration / time.Duration(stats.Rebuilds)
}

lag := stats.LastInvalidationLag
```

A few things to keep in mind when reading the numbers:

- **`Rebuilds` does not equal `Misses`.** Concurrent misses coalesce into one build, and local writes rebuild off the read path. Both are `uint64`, so compare before subtracting, or the value wraps to about 1.8e19 on a write-heavy instance.
- **`LastInvalidationLag` includes clock skew.** The invalidation ID already starts with the publish time, so the receiver measures the difference between that time and now. The two timestamps come from different machines' clocks, so the value can be larger or smaller than the real delay. The docs say: if it jumps, check NTP before blaming Pub/Sub. Negative values are not recorded.
- **ACOR depends on no metrics library.** Hand the values to whatever you already use: Prometheus, OpenTelemetry, or a log line.

## A Combination That Is Now Rejected

Since v0.11.0, turning on `EnableCache` together with `Preset` returns `ErrCacheWithPreset`. `Preset` mode already serves reads from a local engine, so the cache setting has no effect. It used to be silently ignored. Accepting a setting that does nothing makes users believe the cache is on. Rejecting it is more honest.

## Conclusion

After a message is lost, successful polling and reloading can still discover the stored change. Repeated failures remove any freshness bound based on the polling interval. Monitor both `PresetPollFailures` and `PresetReloadFailures` during operation.

The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
