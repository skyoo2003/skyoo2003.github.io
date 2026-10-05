---
title: "What's New in ACOR v0.3.0"
description: "New in ACOR: Index APIs that return match positions, Redis Sentinel, Cluster, and Ring support, a command-line tool, and HTTP and gRPC server adapters."
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor]
---

I released [ACOR](https://github.com/skyoo2003/acor) v0.3.0. I'd left it alone for a while after v0.2.0, and this release finally adds quite a few features. In short, there are four.

1. **Index APIs** that also tell you where the matches are
2. **Redis topology support** for Sentinel, Cluster, and Ring
3. A **CLI** you can use right from the terminal
4. **Server adapters** exposing it over HTTP and gRPC

I'll go through them one by one, focusing on usage. Every output shown here is from actually running a v0.3.0 build against a local Redis.

## Index APIs

The existing `Find` and `Suggest` only told you which keywords matched. Highlighting the matched parts needs positions too, so I added `FindIndex` and `SuggestIndex`, which also return each keyword's start indexes.

```go
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) Suggest(input string) ([]string, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

```go
package main

import (
	"fmt"

	"github.com/skyoo2003/acor/pkg/acor"
)

func main() {
	ac, err := acor.Create(&acor.AhoCorasickArgs{
		Addr: "localhost:6379",
		Name: "sample",
	})
	if err != nil {
		panic(err)
	}
	defer ac.Close()

	for _, k := range []string{"he", "her", "his", "him"} {
		ac.Add(k)
	}

	matched, _ := ac.FindIndex("he is him and she is her")
	fmt.Println(matched)
	// map[he:[0 15 21] her:[21] him:[6]]
}
```

It catches the "he" inside "she" (15) and the "he" at the start of "her" (21) too. For reference, `Find` on the same input returns duplicates, one per match, like `[he him he he her]`.

Indexes are counted in **characters (runes), not bytes**. Since the string is walked with `range` and positions are counted per rune, you get the expected position even with Korean text mixed in.

```go
ac.Add("한글")
matched, _ := ac.FindIndex("가한글")
// map[한글:[1]]  (would be 3 if it were byte based)
```

`SuggestIndex` looks up keywords that start with the input, so the position is always 0. If you don't need positions, just keep using `Find`/`Suggest`.

## Redis topology support

Until now you could only connect to a single Redis. Now the kind of client is picked from the values set in `AhoCorasickArgs`.

```go
type AhoCorasickArgs struct {
	Addr       string            // Standalone
	Addrs      []string          // Sentinel or Cluster
	MasterName string            // Sentinel master name
	RingAddrs  map[string]string // Ring shards
	Password   string
	DB         int
	Name       string
	Debug      bool
}
```

The order is: Ring if `RingAddrs` is set, Sentinel if `MasterName` is set, Cluster if only `Addrs` is set, and Standalone otherwise.

```go
// Sentinel
args := &acor.AhoCorasickArgs{
	Addrs:      []string{"localhost:26379", "localhost:26380"},
	MasterName: "mymaster",
	Name:       "sample",
}

// Cluster (no DB number allowed)
args := &acor.AhoCorasickArgs{
	Addrs: []string{"localhost:7000", "localhost:7001", "localhost:7002"},
	Name:  "sample",
}

// Ring
args := &acor.AhoCorasickArgs{
	RingAddrs: map[string]string{
		"shard-1": "localhost:7000",
		"shard-2": "localhost:7001",
	},
	Name: "sample",
}
```

If settings conflict (for example a Cluster with `DB` set) or the Sentinel addresses are empty, `Create` returns errors such as `ErrRedisClusterDB` or `ErrRedisSentinelAddrs`.

### Key names changed for Cluster

What I paid most attention to while adding Cluster support was key naming. In a Cluster each key can land in a different hash slot, and having one collection's keys scattered across nodes is a problem. So every key now starts with `{collection name}` as a hash tag, which puts them all in the same slot.

```
{sample}:keyword
{sample}:prefix
{sample}:suffix
{sample}:output:<state>
{sample}:node:<keyword>
```

Previously keys like `<state>:output` and `<keyword>:node` were built without the collection name, so output keys could even get mixed between collections with different names. This change cleans that up too. **But because the key format changed, data stored by earlier versions can't be read as is.** If you upgrade, you need to register the keywords again.

### Error handling

Previously, many places just ignored a failed Redis command. From this version, every method that touches Redis, including `Create`, also returns an `error`. And if building the trie fails during `Add`, the keyword that was just added is removed again so the keyword list and the trie don't drift apart.

## CLI

`cmd/acor` is finally a working CLI. (Yes, the empty shell I added back in v0.2.0.)

```bash
$ go install github.com/skyoo2003/acor/cmd/acor@v0.3.0
```

You can also download per-OS binaries from the releases page. Output is JSON, so it plays nicely with tools like `jq`.

```bash
$ acor -addr localhost:6379 -name sample add he
{"count":1}
$ acor -addr localhost:6379 -name sample add him
{"count":1}

$ acor -addr localhost:6379 -name sample find "he is him"
{"matches":["he","him"]}

$ acor -addr localhost:6379 -name sample find-index "he is him"
{"matches":{"he":[0],"him":[6]}}

$ acor -addr localhost:6379 -name sample info
{"keywords":2,"nodes":5}
```

| Command | Description |
|---|---|
| `add <keyword>` / `remove <keyword>` | Add / remove a keyword |
| `find <input>` / `find-index <input>` | Search text (with positions) |
| `suggest <input>` / `suggest-index <input>` | Look up keywords starting with the input |
| `info` | Keyword and node counts |
| `flush` | Delete all data in the collection |

The global options map one to one onto the library's `AhoCorasickArgs`: `-addr`, `-addrs` (comma separated), `-master-name`, `-ring-addrs` (comma-separated `shard=addr`), `-password`, `-db`, `-name` (default `default`), and `-debug`.

## Server adapters

So services that don't import ACOR as a library can use it too, I added HTTP and gRPC adapters in the `pkg/server` package. Both take a `*acor.AhoCorasick` as is.

```go
ac, err := acor.Create(&acor.AhoCorasickArgs{Addr: "localhost:6379", Name: "sample"})
if err != nil {
	log.Fatal(err)
}
defer ac.Close()

// HTTP
httpServer := server.NewHTTPServer(":8080", ac)
go httpServer.ListenAndServe()

// gRPC
lis, err := net.Listen("tcp", ":50051")
if err != nil {
	log.Fatal(err)
}
grpcServer := server.NewGRPCServer(ac)
log.Fatal(grpcServer.Serve(lis))
```

### HTTP

| Method | Path | Request body |
|---|---|---|
| GET | `/healthz` | |
| POST | `/v1/add`, `/v1/remove` | `{"keyword": "..."}` |
| POST | `/v1/find`, `/v1/find-index` | `{"input": "..."}` |
| POST | `/v1/suggest`, `/v1/suggest-index` | `{"input": "..."}` |
| GET | `/v1/info` | |
| POST | `/v1/flush` | |

```bash
$ curl -X POST http://localhost:8080/v1/find \
    -H "Content-Type: application/json" \
    -d '{"input": "he is him"}'
{"matches":["he","him"]}
```

### gRPC

The gRPC side is a bit unusual: it uses a **JSON codec** with no `.proto` file and no protobuf code generation. `NewGRPCServer` forces the JSON codec on the server, the service name is `acor.server.v1.Acor`, and the request/response types are the same structs as HTTP. I did it this way to avoid adding dependencies, but in exchange the client also has to call with the JSON codec.

```go
conn, err := grpc.Dial("localhost:50051",
	grpc.WithTransportCredentials(insecure.NewCredentials()),
	grpc.WithDefaultCallOptions(grpc.ForceCodec(server.JSONCodec{})),
)
if err != nil {
	log.Fatal(err)
}
defer conn.Close()

var resp server.MatchesResponse
err = conn.Invoke(context.Background(), server.GRPCMethodFind,
	&server.InputRequest{Input: "he is him"}, &resp)
fmt.Println(resp.Matches) // [he him]
```

In other words, keep in mind that a regular protobuf-based gRPC client (such as `grpcurl`) can't call it as is. If you need to connect from another language, the HTTP side is simpler.

## Wrapping Up

You could say v0.3.0 is the release that lets ACOR, previously library only, be used as a CLI or a standalone server too. Just remember that the key format changed, so you need to register your data again when upgrading.

See the [GitHub repository](https://github.com/skyoo2003/acor) and the [documentation site](https://skyoo2003.github.io/acor/) for details.
