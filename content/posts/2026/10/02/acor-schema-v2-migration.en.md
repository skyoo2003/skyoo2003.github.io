---
title: "ACOR Schema V2: 99% Fewer Redis Keys and a Safe Path Off V1"
description: "How ACOR schema V2 cuts Redis keys to three per collection with hashes and Lua scripts, plus the V1 migration API, rollback caveats, and retiring V1."
date: 2026-10-02T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, redis, acor, data-migration]
---

## Introduction

Since its first version in 2017, [ACOR](https://github.com/skyoo2003/acor) has stored its Aho-Corasick trie in Redis. The first design (V1) mapped the trie structure almost directly onto Redis data structures: the keyword set, prefix edges, suffix links, per-state outputs, and node metadata each lived in separate keys. It was easy to understand, but the number of keys and the cost of writes grew with the number of keywords.

v0.4.0 introduced a new schema, V2. A collection uses **at most 3 keys** regardless of how many keywords it has. This post covers the V2 design, the migration API for moving data already stored as V1, the bugs I hit along the way, and how V1 was retired in stages.

The `{name}` hash tag in key names, which keeps a collection's keys in the same Redis Cluster slot, was introduced in [v0.3.0](https://github.com/skyoo2003/acor/releases/tag/v0.3.0) and covered in this blog's v0.3.0 post. V2 follows the same rule.

## The Cost of V1

V1 spreads one collection across many keys.

| Key pattern | Purpose |
|---|---|
| `{name}:keyword` | Keyword set |
| `{name}:prefix` | Trie prefix edges |
| `{name}:suffix` | Trie suffix links |
| `{name}:output:{state}` | Output keywords per state |
| `{name}:node:{keyword}` | Node metadata |

The first three keys exist once per collection, but there is one `node` key per keyword and one `output` key per trie state that has output. Every keyword has its own end state, so the key count is more than twice the keyword count. 100,000 keywords means well over 200,000 keys, and more for dictionaries with many suffix matches, since those add output states. Many keys are not just a memory overhead. They make operations with `KEYS` or `SCAN` harder, and deleting a collection becomes heavy.

The bigger cost was writes. At the time, V1's `Add()` walked the trie node by node, updating keys as it went. The number of round trips grew with **the length of the keyword being added**. Adding a 5-character keyword took 53 round trips; a 26-character keyword took 507.

## The V2 Hash Layout

V2 serializes the whole trie into a few hashes:

```text
{name}:trie      (hash)
  keywords -> ["keyword1", "keyword2", ...]
  prefixes -> ["", "h", "he", ...]
  version  -> <int64 optimistic lock>

{name}:outputs   (hash)
  he  -> ["he"]
  she -> ["he", "she"]

{name}:nodes     (hash, migration only)
  keyword1 -> ["s0","s1","s2"]
```

Most collections have only `:trie` and `:outputs`. `:nodes` exists only on collections migrated from V1. At 100,000 keywords, V1's more than 200,000 keys become 2. That structural difference is where the v0.4.0 release notes' "99% fewer keys" comes from. Since V2's key count does not depend on the number of keywords, the larger the dictionary, the further the reduction goes beyond 99%.

### Writes Go Through One Lua Script

For a write, the client computes the new trie and commits it with a single Lua script, using the `version` field as an optimistic lock:

```go
// v2WriteScript commits a planned trie mutation under optimistic locking:
// it rejects the write (returns 0) when another client has already moved the
// version on, and otherwise swaps in the new trie fields and output states.
//
// Precompiled with redis.NewScript so calls go out as EVALSHA.
var v2WriteScript = redis.NewScript(`
	local trieKey = KEYS[1]
	local outputsKey = KEYS[2]
	local oldVersion = ARGV[1]
	-- ...
	local currentVersion = redis.call('HGET', trieKey, 'version')
	if currentVersion and currentVersion ~= oldVersion then
		return 0
	end

	redis.call('HSET', trieKey, 'keywords', keywords, 'prefixes', prefixes, 'version', newVersion)

	-- Decode before the DEL: a cjson error aborts the script without rolling
	-- back the commands already run, so nothing destructive may precede it.
	local outputs = cjson.decode(outputsJson)

	if clearOutputs then
		redis.call('DEL', outputsKey)
	end
	-- ...
`)
```

If another client has already bumped the version, the script returns 0, and the client reads and computes again. It is two round trips regardless of keyword length: one read, one commit.

This script carries two fixes from v0.6.x:

**Lua errors do not roll back.** A Redis script stops on an error, but it does not undo the commands it already ran. The original code ran `DEL outputsKey` first and decoded the JSON after. If decoding failed, the outputs hash stayed deleted. v0.6.1 moved the `DEL` after decoding.

That fix did not make the whole script safe, though. As the code above shows, `HSET trieKey` still runs **before** decoding. If `outputsJson` is invalid JSON, the trie fields (keywords, prefixes, version) take their new values while the outputs hash keeps the old ones. The worst case, losing the whole outputs hash, is prevented, but a partial update is still possible. In practice the client builds the JSON itself, so decoding rarely fails. Still, being fully safe would require decoding and validating before every write.

**`EVALSHA` instead of `EVAL`.** v0.6.0 replaced inline `EVAL` calls with package-level `redis.NewScript` variables. Only the SHA is sent, not the script body every time.

Version generation was fixed once too. It originally added a random value to a nanosecond timestamp, which could overflow `int64`. Now the timestamp goes in the lower 48 bits and two random bytes in the upper 16 bits, so two instances generating a version in the same nanosecond are unlikely to collide.

### A Claim That Measurement Changed

The v0.4.0 release notes said V2 "cuts round trips by 80–85%." At the time that was true, because V1's `Find()` made several round trips per visited state. But in v0.10.1, V1's `Find()` switched to scanning with the same in-memory automaton as the other modes, so V1 also reads with a single `SMEMBERS`. Today the comparison looks like this:

| Metric | V1 | V2 |
|---|---|---|
| Keys per 100K keywords | Over 200K (grows with keywords) | 2 |
| `Find()` round trips | 1 | 1 |
| `Add()` round trips | Grows with keyword length (53 at 5 chars, 507 at 26) | 2 |
| `Add()` time | baseline | ~14x faster |
| `Find()` time, no cache | baseline | ~1.7x **slower** at 1,000 keywords |

The V1 write figures measure the historical implementation preserved as a test fixture. Since v1.5.0, the public API rejects V1 writes with `ErrV1ReadOnly`.

V2's win is **writes**, not reads. Uncached V2 has to read an outputs hash with one entry per state, so it is slightly slower than V1. The large read speedups come from `EnableCache` and the `Preset` engines, and both require V2. That is what the docs say now. The [measured performance post](/en/posts/2026/10/01/acor-measured-performance/) covers that process in more detail.

## The Migration API

Once V2 became the default for new collections (v0.4.0, BREAKING), existing V1 collections needed a way to move.

Before running the migration, stop older V1 clients that write to this collection. The migration lock excludes other migrations, not ordinary writes. The final key swap is atomic, but collecting data in several stages does not guarantee one consistent snapshot of the entire collection. This condition applies to both the API and CLI below.

```go
result, err := ac.MigrateV1ToV2(&acor.MigrationOptions{
    Progress: func(done, total int, msg string) {
        fmt.Printf("[%d/%d] %s\n", done, total, msg)
    },
})
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Migrated %d keywords in %dms\n", result.Keywords, result.DurationMs)
```

Migration runs in five steps:

1. Take a lock to prevent concurrent migrations. Its TTL is 5 minutes, so it is released even if the client crashes.
2. Collect the V1 data V2 needs (keywords, prefixes, outputs, nodes).
3. Write the V2 structure to temporary keys.
4. Atomically swap to the V2 keys, and optionally delete the V1 keys.
5. Release the lock.

There are three options:

- **`DryRun`**: count what would be migrated without writing anything. The lock, however, is taken and released exactly as in a real migration. So a dry run and a real migration of the same collection exclude each other with `ErrMigrationInProg`. The progress callback stops at 4/5, so draw a progress bar from `done/total` instead of waiting for a final call.
- **`KeepOldKeys`**: keep the V1 keys. Rollback requires this.
- **`Progress`**: a callback invoked at each step.

The CLI does the same:

```bash
acor -name mycollection schema-version              # check the current schema
acor -name mycollection -dry-run migrate            # preview
acor -name mycollection -keep-old-keys migrate      # execute (keep V1 keys so rollback works)
acor -name mycollection migrate-rollback            # back to V1
```

The `acor` CLI parses one global flag set, so `-dry-run` and `-keep-old-keys` must come **before** the command name. Writing them after it, as in `migrate --dry-run`, ends in a usage error. And running without `-keep-old-keys` deletes the V1 keys, which makes rollback impossible.

### Rollback Precautions

`RollbackToV1()` works only when the V1 keys were kept with `KeepOldKeys`. Even then, it has a price, and the doc comment lists all of it:

- Keywords added after the migration are lost. They exist only in the V2 keys the rollback deletes, and the preserved V1 keys predate them.
- The collection becomes read-only. Since v1.5.0, V1 does not accept writes.
- Local caching stops.

Rollback is not a way to keep working on V1. It is a way to read old data with an old client. If you are considering rollback, compare it against not migrating at all.

## Operations That Did Not Change After Migration

v0.5.0 restructured the internals with a Strategy pattern. The `AhoCorasick` struct holds a per-schema `operations` implementation (one for V1, one for V2), and every public method delegates to it.

v0.6.1 fixed a bug in that structure. `MigrateV1ToV2` converted the data in Redis to V2, but **the operations held by the instance stayed V1**. An `Add` on the same instance right after migration went down the V1 path. `RollbackToV1` had the same problem in the opposite direction.

The fix swaps the operations to the target schema when migration or rollback finishes, carrying the configured values (such as case sensitivity) across the swap. A migration is done only when the data and the code that handles it both change. Today, a successful `MigrateV1ToV2` switches to V2 operations and the instance becomes writable.

## Retiring V1 in Stages

V1 was not removed in one go. It went through these stages:

| Version | Change |
|---|---|
| v0.4.0 | V2 becomes the default for new collections. `SchemaVersion: 1` keeps V1 |
| v0.10.1 | The unused `suffixes` field is dropped from the V2 trie hash |
| v0.11.0 | `SchemaV1` deprecated. Reads and writes still work |
| v1.5.0 | V1 is read-only. `Add`/`Remove` return `ErrV1ReadOnly` |
| v2 (planned) | V1 read path removed. Kept for the whole v1 line, removed no earlier than v2 |

Dropping the `suffixes` field is a small change, but it shows how rolling upgrades were handled. The field stored every prefix reversed and was rewritten on every add and remove, but no matcher ever read it. New versions stop writing it, ignore it on read if it is still there, and it disappears on the next `Flush`. So old and new binaries can share a collection during a rolling upgrade.

Even in the read-only stage, `Find`, `FindIndex`, `Suggest`, `Info`, `Flush`, and `MigrateV1ToV2` still work. Existing collections can be read and converted in place. Note, though, that `Flush` still deletes every key. Read-only refuses keyword writes. It does not protect the collection.

## Conclusion

Before migrating, stop older clients from writing and inspect the collection with a dry run. Use `KeepOldKeys` if rollback is needed. Retained V1 keys do not include later V2 writes, and V1 is read-only in clients from v1.5.0 onward.

The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
