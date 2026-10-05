---
title: "KVS: Inside the Architecture of a Go Key-Value Store"
description: "The architecture of the Go key-value store KVS v1.0.0: package layout, module and server modes, data flow, and its Red-Black Tree and LSM Tree. Later versions differ."
date: 2026-03-18T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, data-structures, kvs, tutorial]
---

> Note that this post describes v1.0.0 as of 2026-03-18. `pkg/rbt`, `pkg/lsm`, and others have since been removed, and the library path and server layout have changed too, so don't read what follows as how to use the current version. The new server layout is covered in the [RESP2 and Lua post](/en/posts/2026/10/03/kvs-resp2-server-lua/), and durability and clustering in the [append log and Raft post](/en/posts/2026/10/03/kvs-append-log-raft/).

I released [KVS](https://github.com/skyoo2003/kvs) v1.0.0. KVS is a simple in-memory key-value store written in Go that you can import as a Go module or run as a separate server. In this post I'll briefly go over the structure of v1.0.0 and look more closely at its Red-Black Tree and LSM Tree implementations.

There are already great key-value stores like Redis, LevelDB, and BoltDB, so why build one myself? Simple: learning and experimenting. I wanted to implement the data structures and design decisions I'd only seen in books and docs, and experience the trade-offs firsthand. So it's written entirely in Go with no external C dependencies, and it supports both library and server use.

v1.0.0 includes the following.

| Feature | Description |
|---|---|
| `kvs.Store` | Base store built on a synchronized map |
| `pkg/rbt` | Red-Black Tree implementation |
| `pkg/lsm` | In-memory LSM Tree implementation |
| CLI | Cobra/Viper based command-line interface |
| Server | HTTP and gRPC servers |
| Distribution | Static documentation site, Homebrew tap |

## Overall Structure

### Package layout

```
kvs/
├── kvs.go                 # Base Store
├── pkg/
│   ├── rbt/               # Red-Black Tree
│   ├── lsm/               # LSM Tree
│   ├── bitset/            # Bitset utility
│   └── cuckoofilter/      # Cuckoo filter
├── api/kvsv1/             # gRPC Protocol Buffers definitions
├── cmd/kvs/               # CLI entry point
└── internal/server/       # HTTP/gRPC servers
```

### Using it as a module

To use it as a library inside a Go program, create a store with `kvs.NewStore()`. Inside it's a single `map[string]interface{}` guarded by a `sync.RWMutex`.

```go
package main

import (
	"fmt"

	"github.com/skyoo2003/kvs"
)

func main() {
	store := kvs.NewStore()
	_ = store.Put("language", "go")

	value, _ := store.Get("language")
	fmt.Println(value) // go
}
```

`pkg/rbt` and `pkg/lsm` are standalone packages not wired into `Store`. In other words, neither the server nor `Store` uses the trees internally; you pull them in directly where you need them. Roughly:

- **`kvs.Store` (map)** : Average O(1) lookup. Plain lookups where order doesn't matter.
- **`pkg/rbt`** : Guaranteed O(log n). When key order matters.
- **`pkg/lsm`** : For experimenting with collecting writes in a memtable and flushing them as sorted segments.

## Red-Black Tree

A Red-Black Tree is a binary search tree that colors each node red or black and stays balanced by keeping these rules.

1. The root is black.
2. Both children of a red node are black.
3. Every path from a node down to NIL has the same number of black nodes.

These rules keep the height of the tree at O(log n).

### Structure

```go
type Compare func(a, b interface{}) int

type RBTree struct {
	compareKey Compare
	root       *RBNode
	size       uint
}

type RBNode struct {
	Key         interface{}
	Value       interface{}
	IsRed       bool
	Parent      *RBNode
	Left, Right *RBNode
}
```

Instead of fixing the key type, it takes a compare function. The common ones, `CompareString`, `CompareInt`, and `CompareFloat64`, are already in `cmp.go`.

```go
tree, err := rbt.New(rbt.CompareString)
if err != nil {
	panic(err)
}
_ = tree.Put("b", 2)
_ = tree.Put("a", 1)
value, _ := tree.Get("a") // 1
```

### Insertion

Insertion finds the spot like an ordinary binary search tree and attaches a red node, and if a rule is broken, `insertFix` restores it with rotations and recoloring.

```go
func (t *RBTree) Put(key, value interface{}) error {
	if err := t.requireComparator(); err != nil {
		return err
	}

	if t.root == nil {
		t.root = &RBNode{Key: key, Value: value}
		t.size = 1
		return nil
	}

	parent := t.root
	current := t.root
	cmp := 0
	for current != nil {
		parent = current
		cmp = t.compareKey(key, current.Key)
		switch {
		case cmp < 0:
			current = current.Left
		case cmp > 0:
			current = current.Right
		default:
			current.Value = value // If the key already exists, just update the value
			return nil
		}
	}

	node := &RBNode{Key: key, Value: value, IsRed: true, Parent: parent}
	if cmp < 0 {
		parent.Left = node
	} else {
		parent.Right = node
	}

	t.insertFix(node)
	t.size++
	return nil
}
```

`insertFix` loops while the parent is red and handles the three textbook cases. (The case where the parent is a right child is the same code with left and right swapped, so it's omitted.)

```go
func (t *RBTree) insertFix(node *RBNode) {
	for node != t.root && node.Parent != nil && node.Parent.IsRed {
		grandparent := node.getGrandparent()
		if grandparent == nil {
			break
		}

		if node.Parent == grandparent.Left {
			uncle := grandparent.Right
			// Case 1: If the uncle is red, recolor and move up to the grandparent.
			if isRed(uncle) {
				node.Parent.IsRed = false
				uncle.IsRed = false
				grandparent.IsRed = true
				node = grandparent
				continue
			}

			// Case 2: If the uncle is black and the node is a right child, rotate to turn it into Case 3.
			if node == node.Parent.Right {
				node = node.Parent
				t.rotateLeft(node)
			}

			// Case 3: Swap the colors of parent and grandparent, then rotate around the grandparent.
			node.Parent.IsRed = false
			grandparent.IsRed = true
			t.rotateRight(grandparent)
			continue
		}

		// Parent is a right child (symmetric)
		// ...
	}

	t.root.IsRed = false
}
```

A rotation swaps a parent and child while keeping the in-order traversal order.

```
          Y          rotateRight(Y)          X
         / \        ───────────────▶        / \
        X   C                              A   Y
       / \          ◀───────────────          / \
      A   B          rotateLeft(X)            B   C
```

### Removal is still O(n)

Embarrassingly, `Remove` isn't implemented the proper way yet. It collects every entry except the one being removed and rebuilds the tree from scratch, so it takes O(n).

```go
func (t *RBTree) Remove(key interface{}) error {
	if err := t.requireComparator(); err != nil {
		return err
	}

	if t.findNode(key) == nil {
		return ErrKeyNotFound
	}

	entries := t.entriesExcept(key)
	t.root = nil
	t.size = 0
	for _, entry := range entries {
		if err := t.Put(entry.key, entry.value); err != nil {
			return err
		}
	}
	return nil
}
```

Red-Black Tree deletion has far more cases than insertion, so I built something that's definitely correct first and plan to replace it once there are enough tests.

| Operation | Time complexity |
|---|---|
| Put | O(log n) |
| Get | O(log n) |
| Remove | O(n) (rebuild) |
| Clear | O(1) |

## LSM Tree

An LSM (Log-Structured Merge) Tree collects writes in memory (the memtable) first, writes them out as sorted files once they reach a certain size, and periodically merges the accumulated files (compaction). LevelDB, RocksDB, Cassandra, and others use this approach.

KVS's `pkg/lsm` imitates all of this in memory. Instead of writing to disk it flushes to sorted slices (segments), and there's no compaction yet.

### Structure

```go
type Tree struct {
	memtable      map[string]entry // Table currently taking writes
	segments      []segment        // Flushed immutable segments (newest first)
	memtableLimit int              // Auto-flush threshold (default 4)
}

type entry struct {
	key     string
	value   interface{}
	deleted bool // Tombstone
}

type segment struct {
	entries []entry // Sorted by key
}
```

`lsm.New()` creates a tree with the default of 4, and `lsm.NewWithMemtableLimit(n)` with whatever threshold you want. The default is tiny on purpose, so flushes happen often in tests.

### Writes and flushes

Writes always go to the memtable only. When the memtable reaches the threshold, its entries are sorted by key into a new segment that's placed at the front of the segment list.

```go
func (t *Tree) Flush() error {
	if t == nil || len(t.memtable) == 0 {
		return nil
	}

	entries := make([]entry, 0, len(t.memtable))
	for _, current := range t.memtable {
		entries = append(entries, current)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].key < entries[j].key
	})

	t.segments = append([]segment{{entries: entries}}, t.segments...)
	t.memtable = make(map[string]entry)
	return nil
}
```

### Reads

Reads check the memtable first, and if the key isn't there, binary search the segments from newest to oldest. Because the newest segment is checked first, you get the last value written even if the same key is in several segments.

```go
func (t *Tree) lookup(key string) (entry, bool) {
	if current, ok := t.memtable[key]; ok {
		return current, true
	}
	for _, current := range t.segments {
		if found, ok := current.get(key); ok {
			return found, true
		}
	}
	return entry{}, false
}
```

### Deletes and tombstones

Existing segments are never modified, so a delete writes a new entry with `deleted: true` (a tombstone) to the memtable instead of removing the value. A lookup that hits the tombstone first treats the key as missing.

```go
func (t *Tree) Delete(key string) error {
	current, ok := t.lookup(key)
	if !ok || current.deleted {
		return ErrKeyNotFound
	}

	t.ensureMemtable()
	t.memtable[key] = entry{key: key, value: current.value, deleted: true}
	return t.flushIfNeeded()
}
```

| Operation | Time complexity |
|---|---|
| Put | Average O(1) (O(m log m) when a flush happens) |
| Get | O(k log s) (k = number of segments, s = segment size) |
| Delete | Get + Put |

With no compaction, segments keep growing, and overwritten values and tombstones stay around. The more you write, the slower reads get and the more memory it uses, so it isn't ready to be a real store yet. Compaction is the next thing to try.

## CLI and Servers

### CLI

The CLI is built with [Cobra](https://github.com/spf13/cobra) and [Viper](https://github.com/spf13/viper). `--config` points to a config file Viper can read (YAML, JSON, TOML, etc.).

```bash
$ kvs --help
$ kvs -v
$ kvs version
$ kvs --config config.yaml version
$ kvs serve --http-addr :3456 --grpc-addr :3457
```

`kvs serve` starts the HTTP and gRPC servers together, on `:3456` and `:3457` by default. The servers use the `kvs.Store` shown above.

### HTTP

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | Health check |
| GET | `/v1/keys/{key}` | Get a value |
| PUT | `/v1/keys/{key}` | Store a value (`{"value": "..."}`) |
| DELETE | `/v1/keys/{key}` | Delete a key |

```bash
# Store a value
$ curl -X PUT http://localhost:3456/v1/keys/mykey -d '{"value": "myvalue"}'

# Get a value
$ curl http://localhost:3456/v1/keys/mykey
{"key":"mykey","value":"myvalue"}

# Delete a key
$ curl -X DELETE http://localhost:3456/v1/keys/mykey
```

The PUT body must be JSON of the form `{"value": "..."}`, and unknown fields get a 400.

### gRPC

The Protocol Buffers definitions are in `api/kvsv1/kvs.proto`.

```protobuf
service KVStore {
  rpc Get(GetRequest) returns (GetResponse);
  rpc Put(PutRequest) returns (PutResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
}
```

```go
conn, err := grpc.Dial("localhost:3457",
	grpc.WithTransportCredentials(insecure.NewCredentials()))
if err != nil {
	log.Fatal(err)
}
defer conn.Close()

client := kvsv1.NewKVStoreClient(conn)
_, _ = client.Put(context.Background(), &kvsv1.PutRequest{Key: "greeting", Value: "hello"})

resp, _ := client.Get(context.Background(), &kvsv1.GetRequest{Key: "greeting"})
fmt.Println(resp.GetValue()) // hello
```

## Installation

```bash
# Go module
$ go get github.com/skyoo2003/kvs@v1.0.0

# Homebrew
$ brew tap skyoo2003/tap
$ brew install kvs

# Build from source
$ git clone https://github.com/skyoo2003/kvs.git
$ cd kvs
$ go install ./cmd/kvs
```

## Wrapping Up

You could say v1.0.0 is a version where I implemented a Red-Black Tree, an LSM Tree, a CLI, and servers once each on top of a small key-value store. Writing it up, I see plenty of things I'm not happy with. Next I plan to work on:

- Improving Red-Black Tree removal to O(log n)
- Implementing LSM Tree compaction
- Disk persistence
- Clustering

See the [KVS GitHub repository](https://github.com/skyoo2003/kvs) and the [documentation site](https://skyoo2003.github.io/kvs/) for details.
