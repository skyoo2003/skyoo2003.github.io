---
title: "ACOR V3: Versioned Dictionaries, Snapshots, and a Million Keywords"
description: "ACOR V3 versioned dictionaries for million-keyword workloads: bucket, chunk, and manifest storage, snapshots and sharding, the reverted delta search, and benchmarks."
date: 2026-10-02T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, redis, valkey, acor, performance]
---

[ACOR](https://github.com/skyoo2003/acor)'s [V2 schema](/en/posts/2026/10/02/acor-schema-v2-migration/) fits filters with thousands or tens of thousands of keywords well. Once a dictionary grows to a million keywords, though, V2's structure becomes a burden. V2 serializes the whole trie into one hash, so even adding a single keyword recomputes and rewrites the whole thing. And while the whole dictionary is being replaced, it is hard to guarantee which version a search sees.

v1.6.0 added a new storage format to address this, **V3 versioned dictionaries**, as an opt-in, and v1.7.0 refined it. This post covers V3's API and storage layout, the delta search I experimented with and then removed, and the numbers measured at one million keywords.

## The V3 Contract

V3 is a separate format in the same Go module. You open it with `OpenVersioned`, and it requires a **new collection name**. The existing `Create`, the V1/V2 keys, and their error contracts are untouched.

The core of V3 is that every state of the dictionary carries a **version**. Every write sends "the version I saw," and fails if another write happened in between. The example below is copied from the [v1.7.0 source documentation](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/docs/content/reference/versioned.md). The original has a `<!-- doccheck -->` marker and is compiled by ACOR's CI; that check does not include the copy in this blog.

```go
dictionary, err := acor.OpenVersioned(ctx, &acor.VersionedOptions{
    Redis: acor.AhoCorasickArgs{Addr: "localhost:6379", Name: "filter-v3"},
    ShardCount: 4, // New collections only; an existing layout is retained.
    ShardConcurrency: 2, // Bound concurrent shard download/build/search work.
})
if err != nil { log.Fatal(err) }
defer dictionary.Close()

snapshot, err := dictionary.Snapshot(ctx)
if err != nil { log.Fatal(err) }
expected := snapshot.Version()
snapshot.Close(ctx)

result, err := dictionary.Replace(ctx, expected, []string{"한국", "hello"})
if err != nil { log.Fatal(err) }
if err := dictionary.WaitForVersion(ctx, result.Version); err != nil { log.Fatal(err) }
matches, err := dictionary.Find(ctx, "HELLO 한국")
if err != nil { log.Fatal(err) }
log.Print(matches)
```

A few rules apply:

- **Versions are opaque equality tokens.** Never compare them as ordered numbers or strings.
- **Two writes holding the same version cannot overwrite each other.** The loser gets `ErrConcurrencyConflict`.
- **Batch changes are atomic.** `Replace` accepts an empty dictionary.
- **Reapplying an identical dictionary keeps the version** and publishes no invalidation.

### When a Commit Becomes Visible to Search

The most important sentence in V3 is this heading from its docs. A successful `Replace` only means the Redis commit landed. Every instance, including the caller, may still be searching with the previous engine. Each instance has to discover the new version, rebuild its engine, and swap it in before it searches the new version.

For read-after-write, call `WaitForVersion`. It waits for the calling `VersionedCollection`'s local engine to serve that commit or a later one, and honors context cancellation. Success does not guarantee that other instances have finished updating.

Discovering a new version and rebuilding work like this:

| Behavior | |
|---|---|
| Discovery | Polling every 30 s by default, accelerated by Pub/Sub |
| Coalescing | A fixed 20 ms debounce window merges bursts; new events do not extend it |
| In-flight build | Finishes, then reloads the newest version observed meanwhile |
| Failure | The previous serving engine is kept |

The lessons from the [local cache invalidation post](/en/posts/2026/10/01/acor-distributed-cache-invalidation/) are all here. Pub/Sub is only an accelerator, and polling is responsible for correctness. New commits arriving during a build do not cancel it. If they did, a steady stream of writes would keep the rebuild from ever finishing.

`Status()` reads only local state, with no Redis I/O. `ActiveVersion` is the last committed version observed in Redis; `ServingVersion` is the version currently used for searches. If they differ, the observed commit has not yet reached this instance's search engine. Versions are opaque tokens, so subtracting them does not measure lag. These values do not describe the health of all instances.

## Storage Layout of Buckets, Chunks, and Manifests

V3 assigns each keyword to one of **4,096 fixed buckets** using the first 12 bits of its SHA-256. Each bucket is sorted and deduplicated, then split into JSON string-array chunks of at most 1 MiB including escaping. Chunks are immutable, content-addressed objects.

```
active pointer ──▶ generation manifest (version N)
                     ├─ bucket 0000 ──▶ chunk sha256:ab12…
                     ├─ bucket 0001 ──▶ chunk sha256:cd34…
                     └─ …4,096 buckets
```

With this layout, the cost of a change scales with the number of changed buckets, not with the dictionary size:

- **Writes**: adding or removing keywords downloads and prepares only the affected buckets. A full replacement compares every bucket and reuses the unchanged ones.
- **Local rebuild**: keyword slices for unchanged buckets are reused, and only changed buckets are downloaded.
- **Commit**: the final Lua commit checks the expected pointer, the preparation lease, and the maintenance lock, stores a receipt, and swaps the pointer. It does not parse the manifest or iterate keywords. Prepared data is referenced from nowhere until it is committed.

Redis is not on the search path. Every search runs on an engine built locally. In exchange, every serving replica has to hold the whole searchable dictionary in memory. During a rebuild the old and new engines coexist, so a full replacement temporarily needs memory for two engine sets.

### When You Don't Know Whether a Commit Landed

When the network drops, there are cases where you cannot tell whether a commit happened. V3 returns these as a separate error, `ErrCommitUnknown`. Keep `WriteResult.OperationID` and call `ResolveOperation(ctx, id)`. If a receipt is found, it is a definite success. The docs are explicit about the other case: **a missing receipt is not proof that an in-flight request cannot still commit.** Do not blindly reapply an ambiguous write.

### Leases and Pruning

Snapshots, builds, and writes in preparation hold server-time leases: five minutes by default, renewed every minute. `Prune(ctx)` keeps the active generation, anything prepared or committed within 24 hours, and anything protected by a valid lease, and deletes the remaining chunks and manifests. While pruning, it holds a monotonically increasing maintenance fence, so an expired pruner cannot keep deleting after a successor takes over. Searches continue during pruning.

## Sharding (v1.7.0)

v1.7.0 added opt-in sharding. Setting `ShardCount` to a power of two between 2 and 256 creates a sharded layout. The same 4,096 buckets are assigned to shards by `bucketID % shardCount`, and each shard uses its own hash tag, so it can be placed across slots in Redis Cluster.

A local rebuild reuses unchanged shard engines and rebuilds only the changed shards. The complete generation is installed atomically only after every required shard validates. A failed candidate is discarded, and the previous complete generation keeps serving.

The layout of an existing collection does not change because of the `ShardCount` passed at open. You have to call `Reshard(ctx, expected, count)` explicitly, and it goes through the same expected-version check as a normal write. The docs also state what is not yet verified: multi-node Cluster failover and resharding have not been qualified in this release.

## Removing Delta Search

Early in V3, I experimented with **delta search** to apply small changes quickly. It kept one base automaton plus an additions automaton and a deletion set, so a small change did not require rebuilding the whole engine. Rebuilding a million-keyword engine to add a single keyword looked wasteful.

The measurements said otherwise. It failed the release gate. Search p95 went up to **2.62x** the full-rebuild baseline, and peak RSS for the Korean dictionary reached **1.55x**. Checking two automatons and filtering a deletion set on every search cost more than the rebuilds it saved.

In v1.7.0, V3 switched to serving **one immutable engine for every version**. The `DeltaSearch` option remains in the type for source compatibility, but it has no effect and always reports false in the status. The experiment's measurements are kept in the docs as an archive page. Keeping the evidence for a removed feature means the next time the same idea comes up, it does not have to be measured again.

## Measurements at One Million Keywords

The single-engine changes later included in v1.7.0 were measured at commit `212179f` on 2026-09-15: Apple M4, Go 1.26.7, Redis 8.10.1 on localhost, `MemoryEfficient` preset, and 50 ms polling for measurement. Each size and distribution ran in three fresh Go processes, and the table shows medians. This is not a measurement of the `ShardCount: 4` example above.

The scope and raw results are in the [original report](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/docs/content/reference/v3-single-engine-20260915.md). Prepare Redis, check out the measured commit `212179f`, and run:

```bash
ACOR_V3_SCALE_ADDR=127.0.0.1:6379 \
ACOR_V3_SCALE_OUTPUT=/tmp/acor-v3-20260915-redis \
ACOR_V3_SCALE_REPEATS=3 \
  make bench-v3
```

| Distribution | Initial load (s) | Add 1 keyword, ready (s) | Full replace, ready (s) | Peak RSS (GiB) | Search p95 during add (µs) |
|---|---:|---:|---:|---:|---:|
| Shared prefix | 1.198 | 0.520 | 1.643 | 1.111 | 3.834 |
| Diverse prefix | 1.708 | 0.879 | 2.099 | 2.395 | 4.166 |
| Korean | 2.112 | 1.019 | 2.740 | 2.961 | 4.708 |

"Ready" is the time from `Replace` until the local engine serves that version. The commit itself finishes in a few milliseconds. The rest is discovering the new version and rebuilding the engine. Even a one-keyword add takes 0.5–1 second, because the whole engine for the changed generation is rebuilt. That is the price of dropping delta search. In return, search latency stays at a few microseconds even during updates.

The table also shows how much cost depends on distribution. Korean keywords use about 2.7x the memory of shared-prefix keywords. That is why the docs recommend measuring on your own deployment host: shared prefixes, diverse prefixes, and Korean keywords have different engine costs.

Valkey was not part of this run. The earlier baseline (R1) measured both Redis and Valkey 9.1.2 and found similar ranges. But in that run, a source build of Valkey 9.1.2 once exited with SIGSEGV under its default prefetch setting. The final Valkey results were obtained with `prefetch-batch-max-size 0`, so the docs state that they do not establish support for that build's default configuration. This is exactly why measurement conditions are written down next to the numbers.

These numbers come from a developer workstation and do not guarantee production latency or memory. They were taken on localhost with RDB and AOF disabled, so durability and network costs are not included.

## Moving from V2

Moving to V3 is different from the V1→V2 migration. There is no in-place conversion.

1. **Use a different name.** `CopyV2(ctx, sourceName, expected, nil)` reads V2's version and keywords in one `HMGET`, replaces the V3 target, and reports the source version, the normalized count, and the SHA-256 checksum of the sorted keyword array.
2. **Rehearse.** Copy, then compare the count, the checksum, and representative search results (case-sensitive, Korean, and overlapping matches).
3. **Cut over.** Stop V2 writes for the final copy, verify, and point the application at the new V3 name. There is no automatic dual write.
4. **Rollback is not a name change.** Once V3 writes begin, switching back to V2 loses them.

## Wrapping Up

Before adopting V3, check startup time and memory for the dictionary size and distribution. An instance that must search immediately after a write should use `WaitForVersion` to wait for its local engine. The million-keyword table measures the single-engine path at `212179f`; measure the selected v1.7.0 sharding configuration separately.

The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
