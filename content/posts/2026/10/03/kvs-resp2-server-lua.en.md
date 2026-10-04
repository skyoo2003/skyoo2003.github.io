---
title: "Speaking Redis: Adding a RESP2 Server and Lua Scripting to KVS"
description: "Adding a RESP2 server and Lua scripting to the Go key-value store KVS: safe listener defaults, defensive parsing, SCAN cursors, atomicity, timeouts, and sandboxing."
date: 2026-10-03T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, kvs, redis-protocol, lua]
---

## Introduction

[KVS](https://github.com/skyoo2003/kvs) is a key-value store written in Go. The [first post about it](/en/posts/2026/03/18/kvs-intro/) focused on data structures like the Red-Black Tree and the LSM Tree. Since then the project has changed direction. The storage engine moved to an append log and Raft, and `pkg/rbt`, `pkg/lsm`, `pkg/bitset`, and `pkg/cuckoofilter`, which nothing imported anymore, were removed. KVS went from a data-structure playground to a server you can actually use.

The first step in that change was support for the **Redis protocol (RESP2)**. This post covers that work. Durability and clustering are covered in the [next post](/en/posts/2026/10/03/kvs-append-log-raft/).

Note that KVS's v1.0.0 tag is currently retracted in `go.mod`, and the next release is not out yet. This post is based on **the main branch**.

## Why RESP?

KVS already had HTTP and gRPC APIs. But the tools people who use key-value stores already know are from the Redis ecosystem: `redis-cli`, `redis-benchmark`, `go-redis`. Letting those tools connect as they are is faster than asking people to learn a new protocol and a new client.

KVS speaks RESP2, and all three protocols share one keyspace. A key written over RESP can be read over HTTP:

```sh
$ redis-cli -p 6379 set greeting hello
OK
$ curl http://localhost:3456/v1/keys/greeting
{"key":"greeting","value":"hello"}
```

About 100 commands are supported: strings, keys and expiry, hashes, lists, sets, sorted sets, transactions, Pub/Sub, and scripting.

## Conservative Listener Defaults

The RESP listener binds to **`127.0.0.1:6379`** by default, unlike HTTP and gRPC, which bind every interface. Port 6379 is scanned continuously across the internet, and KVS has no authentication unless you configure it. Exposing it should be a deliberate choice.

Several other defaults come from the same thinking:

- If another process (a local Redis, say) already holds the default port, KVS logs a warning, turns off only RESP, and serves HTTP and gRPC as usual. But if an address you specified yourself is taken, KVS refuses to start. It does not silently ignore an explicit setting.
- The password is **not accepted as a command-line flag**, because anyone who can list processes can see the arguments. It comes only from the config file or the `KVS_RESP_PASSWORD` environment variable.
- Up to **10,000** concurrent connections are accepted, the Redis `maxclients` default. A connection that sends nothing for 30 seconds is dropped. A connection that has sent at least one command may idle indefinitely, because that is how subscribers behave.

## RESP2 Parsing: Don't Trust Declared Lengths

A RESP2 request is simple. Something like `*3\r\n$3\r\nSET\r\n$8\r\ngreeting\r\n$5\r\nhello\r\n` states the array length first, then each argument's byte length and content. The inline form typed by hand over telnet is accepted too.

The problem is that the client declares the lengths. What happens if a client sends `*1000000` or `$536870912` and then nothing else? If the server allocates the declared length up front, a single request can exhaust its memory.

```go
const (
	// MaxBulkLength caps a single bulk string, matching the Redis proto-max-bulk-len default.
	// The buffer for a bulk string grows as the payload arrives, so a declared length costs
	// nothing until the bytes behind it do.
	MaxBulkLength = 512 * 1024 * 1024

	// argPrealloc bounds the argument slice reserved up front, so that a small request
	// claiming a huge argument count cannot make the server allocate ahead of the data.
	argPrealloc = 64

	// bulkPrealloc bounds the buffer reserved for a bulk string before its payload arrives.
	// Anything larger grows as the bytes come in, so announcing a 512MB value and then
	// stalling costs the server nothing.
	bulkPrealloc = 64 * 1024
)
```

The limits follow Redis defaults, but the memory reserved up front is kept small. Everything else grows only as the actual bytes arrive.

Reviewing the RESP work found both long response delays and process crashes. Glob backtracking in `KEYS` held the lock for too long; the integer-argument bugs below caused panics. At the time, the connection handler had no `recover`, so a panic terminated the entire process.

- `KEYS a*a*a*...*b`: glob matching recursed at every `*` and backtracked exponentially, while holding the store's read lock. A 40-character name took 49 seconds. It now remembers only the last `*` and runs in a single pass.
- `SETRANGE`: `offset+len(patch)` overflowed into a negative length and panicked in `copy`. The bound is now checked by subtraction, which cannot overflow.
- `LREM key MinInt`, `SRANDMEMBER key MinInt`: the absolute-value computation overflowed into a negative slice bound.

Once you open a network protocol, every integer argument is attack surface.

## Lists: A Data Structure Used as a Queue

The most common use of a Redis list is a queue: push at one end, pop at the other. But prepending to a Go slice copies the whole slice every time.

```go
// respList is a list with room to grow at both ends. items[head:] is the live range, and a
// push at the head fills reserved space in front of it instead of copying the whole list, so
// both ends cost O(1) amortized. That matters because the common use of a Redis list is a
// queue: push one end, pop the other.
type respList struct {
	items []string
	head  int
}
```

Spare room is kept at the front, and a `head` index points at the real start. Space vacated by pops at the front is left alone until 64 slots build up, then reclaimed at once. Both ends become amortized O(1).

## How SCAN Cursors Work

`SCAN` walks the keyspace in pages. The simplest way to build a cursor is as an offset. But an offset cursor skips a key when an earlier key is deleted mid-walk.

A KVS cursor is an **opaque handle** to the last key reached. Deleting keys the walk has already passed cannot make it skip one. The handle lives on the server, not on the connection, because client libraries pool connections, so the `SCAN` that starts an iteration and the one that continues it often go over different sockets.

The server remembers up to **1,024** unfinished iterations. Past that, it drops the handle that has been idle longest. A dropped cursor gets `ERR invalid cursor`. There is a reason it does not return an empty final page (`0`): `0` means "iteration complete" in the protocol, so answering that way would tell a client it had walked a keyspace it had barely started.

## Lua Scripting

### Ensuring Atomicity with a Write Lock

`EVAL`, `EVALSHA`, and `SCRIPT LOAD/EXISTS/FLUSH` are supported. The Lua 5.1 interpreter is [gopher-lua](https://github.com/yuin/gopher-lua). `redis.call` inside a script goes into the same dispatch table as a client's command.

The core promise of a Redis script is atomicity: nothing else runs while the script runs. KVS keeps that promise in the simplest possible way. A script holds **the store's single write lock** from start to finish.

```go
// ponytail: a fresh interpreter per call. A pooled one carries the last script's globals
// into the next, and Redis promises a script that cannot see what ran before it.
state := lua.NewState(lua.Options{SkipOpenLibs: true})
defer state.Close()

// Neither compiling nor building the sandbox touches the store, so both happen before the
// lock. Compiling first also keeps an unparseable script out of the cache, where SCRIPT
// EXISTS would call it runnable and it would hold budget until the next flush.
compiled, compileErr := state.LoadString(body)
// ...

err = c.write(func(tx *kvs.Tx) error {
	// The deadline starts here, not at the top: a script queued behind another writer would
	// otherwise spend its budget waiting for the lock and be stopped without having run.
	ctx, cancel := context.WithTimeout(context.Background(), respScriptTimeout)
	defer cancel()
	state.SetContext(ctx)
	// ...
})
```

This code carries several decisions:

- **A fresh interpreter for every call.** A pooled interpreter would carry the previous script's globals into the next one. Redis promises that a script cannot see what ran before it. A bit of performance was traded to keep that promise.
- **Compile outside the lock.** Work that does not touch the store finishes before the lock is taken. A script that fails to compile is not cached.
- **The timeout starts after the lock is taken.** Counting time spent waiting behind another writer could stop a script before it runs a single line.

### Why a 5-Second Timeout Is Enforced

Redis also has a default 5-second execution-time threshold. After it is exceeded, ordinary commands from other connections receive `BUSY`, but the script is not stopped automatically. `SCRIPT KILL` can stop a script only before it has performed writes. The behavior is described in the [Redis documentation](https://redis.io/docs/latest/develop/programmability/#maximum-execution-time).

In KVS, the script holds the write lock, so an endless loop also blocks other clients. The interpreter therefore enforces a **5-second** deadline and stops execution. KVS does not provide `SCRIPT KILL`. Writes performed before the interruption remain; Redis likewise does not roll back earlier writes when a script errors.

### The Sandbox

Scripts cannot reach outside the process. Only the `base`, `table`, `string`, `math`, and `cjson` libraries are opened, and `dofile`, `loadfile`, `print`, and `require` are removed. `os`, `io`, `debug`, and `package` are never opened. `redis.call` also refuses commands that make no sense inside a script: the transaction and subscribe families, the scripting commands themselves, and session commands.

Converting return values is bounded too. A script that returns a table containing itself could recurse until the stack runs out and take the process with it. So tables are followed only 32 levels deep.

### cjson and the Null Trap

`cjson` was added just before v1.0.0. Before that, `cjson` was a nil global, so every script that called `cjson.decode` failed. Many Redis scripts handle JSON, so this was essential.

The part that needed the most care was null. In Lua, putting nil in a table is the same as the element not being there. If the array `[1, null, 3]` is turned into a Lua table with null as nil, Lua sees an array that ends at 1. So KVS's `cjson.decode` turns a JSON null into a sentinel value, **`cjson.null`**, not nil. Arrays do not get cut short, and keys do not disappear from objects.

Encoding follows cjson's rules. A table whose keys are exactly 1 through n is an array; anything else, including an empty table, is an object.

```go
// respLuaTableToJSON decides whether a table is an array or an object. Lua spells both the same
// way, so the rule cjson uses stands here: a table whose keys are exactly 1..n is an array, and
// anything else, an empty table included, is an object.
```

One difference from Redis is also documented. A string that is not valid UTF-8 is encoded with the replacement character, while Redis passes the bytes through unchanged.

### The Script Cache

`EVALSHA` answers `NOSCRIPT` for a digest that is not in the cache. Every client library sees this reply and resends the script body, so answering with any other error would make that fallback unreachable. The cache is per server, not per connection, because the socket that loaded a script may not be the one that runs it.

The cache holds up to **16 MiB**. Past that, `EVAL` still runs the script but does not cache it. The client loses only the `EVALSHA` shortcut, not the command. `SCRIPT LOAD`, on the other hand, exists only to cache, so it returns an error.

## Where KVS Behaves Differently from Redis

KVS speaks RESP2, but it is not Redis. The docs collect the places where KVS answers correctly but not identically to Redis. A few of them:

- **There is one keyspace.** `SELECT` accepts only 0, and `FLUSHDB` and `FLUSHALL` do the same thing.
- **RESP2 only.** `HELLO 3` gets `NOPROTO`, which clients read as a signal to fall back to RESP2. go-redis asks for RESP3 by default and downgrades on its own.
- **Expiry is reclaimed by sampling.** An expired key becomes invisible immediately, and its memory is reclaimed by a write that touches the key or by the sampling sweep each write runs. A keyspace with no expiries pays nothing.
- **Slow subscribers are dropped.** Messages queue per connection under count and memory limits, and a subscriber that exceeds either is disconnected rather than slowing down the publisher.
- **`CONFIG SET` is refused.** That is better than accepting it and ignoring it.

The unsupported features are published as a list too: Functions (`FCALL`), streams, blocking commands (`BLPOP` and friends), RESP3 push, `MONITOR`, bit operations, `GEO`, HyperLogLog, `SCRIPT KILL`, and more. Every unsupported command answers with an error, so a client learns it is not supported instead of getting a wrong result.

## Conclusion

Existing Redis tools can connect, but check the supported commands and Lua features before using them. Scripts stop at the 5-second deadline, and writes already performed remain. The [next post](/en/posts/2026/10/03/kvs-append-log-raft/) explains persisting this keyspace and replicating it across nodes.

The full source code is available at [github.com/skyoo2003/kvs](https://github.com/skyoo2003/kvs).
