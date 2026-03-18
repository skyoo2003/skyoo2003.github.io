---
title: "KVS: Inside the Architecture of a Go Key-Value Store"
date: 2026-03-18T00:00:00+09:00
tags: [go, key-value, data-structures, rbtree, lsm-tree]
---

## Introduction

[KVS](https://github.com/skyoo2003/kvs) v1.0.0 has been released. KVS is a simple in-memory key-value store written in Go that can be used as a Go module or deployed as a standalone server. This post introduces the major features included in v1.0.0 and takes a deep dive into the core data structures: Red-Black Tree and LSM Tree implementations.

### Why Another Key-Value Store?

Excellent key-value stores like Redis, LevelDB, and BoltDB already exist. So why build KVS? KVS started as a learning and experimentation project. The goal was to experience firsthand the design decisions and trade-offs involved in building a production-grade database. The result is a store with these characteristics:

- **Pure Go**: Everything written in Go with no CGo dependencies
- **Dual Mode**: Supports both library and server usage
- **Multiple Data Structures**: From simple hashmaps to RBTree and LSM Tree

### Key Features in v1.0.0

v1.0.0 is the first stable release, featuring:

| Feature       | Description                                |
| ------------- | ------------------------------------------ |
| RBTree        | Balanced binary search tree implementation |
| LSM Tree      | In-memory LSM tree package                 |
| CLI           | Cobra/Viper-based command-line interface   |
| Server        | HTTP and gRPC server adapters              |
| Documentation | Static documentation site                  |
| Homebrew      | Official Homebrew support for macOS        |

## Overall Architecture

### Package Structure

KVS has a clearly separated package structure organized by functionality:

```
kvs/
├── kvs.go                 # Basic Store interface
├── pkg/
│   ├── rbt/               # Red-Black Tree implementation
│   │   ├── rbt.go
│   │   ├── cmp.go
│   │   └── rbt_test.go
│   ├── lsm/               # LSM Tree implementation
│   │   ├── lsm.go
│   │   └── lsm_test.go
│   ├── bitset/            # Bitset utilities
│   └── cuckoofilter/      # Cuckoo filter implementation
├── cmd/kvs/               # CLI entry point
└── internal/server/       # HTTP/gRPC server
    ├── http.go
    ├── grpc.go
    └── config.go
```

### Module Mode vs Server Mode

KVS can be used in two ways.

**Module Mode** - Use as a library within a Go program:

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

**Server Mode** - Deploy as a standalone server:

```
┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ HTTP/gRPC   │
└─────────────┘     │   Server    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Store    │
                    │ (RBTree/LSM)│
                    └─────────────┘
```

In server mode, data can be accessed via HTTP JSON or gRPC protocols.

### Data Flow

The basic `Store` implementation uses a synchronized map internally, but the `pkg/rbt` and `pkg/lsm` packages provide different data structures:

```
┌─────────────────────────────────────────────┐
│              User Code                       │
└─────────────────┬───────────────────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   kvs.Store  pkg/rbt    pkg/lsm
   (HashMap)  (RBTree)   (LSM Tree)
```

Each data structure suits different use cases:

- **HashMap**: O(1) average access time, simple key-value lookups
- **RBTree**: O(log n) guaranteed, when sorted traversal is needed
- **LSM Tree**: Write-intensive workloads, batch processing

## RBTree Deep Dive

### Red-Black Tree Basics

A Red-Black Tree is a self-balancing binary search tree. Each node is marked red or black, and the tree maintains these invariants:

1. **Root is Black**: The root node is always black
2. **Red Constraint**: Red nodes can only have black children
3. **Black Height**: All paths from root to NIL have the same number of black nodes

These invariants ensure the tree height is always O(log n).

### KVS RBTree Implementation

Let's examine `pkg/rbt/rbt.go`.

#### Tree Structure

```go
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

Notably, the `compareKey` function is injected, allowing comparison of any key type:

```go
type Compare func(a, b interface{}) int
```

#### Insertion Operation

Insertion happens in two phases:

1. **BST Insert**: Add a new node like a regular binary search tree (marked red)
2. **Rebalancing**: Fix Red-Black property violations through rotations and recoloring

```go
func (t *RBTree) Put(key, value interface{}) error {
    // Create new node if no root exists
    if t.root == nil {
        t.root = &RBNode{Key: key, Value: value}
        t.size = 1
        return nil
    }

    // Find appropriate position
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
            current.Value = value // Update value if key exists
            return nil
        }
    }

    // Create and link new node
    node := &RBNode{Key: key, Value: value, IsRed: true, Parent: parent}
    if cmp < 0 {
        parent.Left = node
    } else {
        parent.Right = node
    }

    t.insertFix(node) // Restore Red-Black properties
    t.size++
    return nil
}
```

#### Rebalancing Logic

The `insertFix` function is the heart of the Red-Black Tree. It handles violations after insertion with three cases:

```go
func (t *RBTree) insertFix(node *RBNode) {
    for node != t.root && node.Parent != nil && node.Parent.IsRed {
        grandparent := node.getGrandparent()
        if grandparent == nil {
            break
        }

        if node.Parent == grandparent.Left {
            uncle := grandparent.Right
            // Case 1: Uncle is red
            if isRed(uncle) {
                node.Parent.IsRed = false
                uncle.IsRed = false
                grandparent.IsRed = true
                node = grandparent
                continue
            }

            // Case 2: Uncle is black, node is right child
            if node == node.Parent.Right {
                node = node.Parent
                t.rotateLeft(node)
            }

            // Case 3: Uncle is black, node is left child
            node.Parent.IsRed = false
            grandparent.IsRed = true
            t.rotateRight(grandparent)
            continue
        }

        // Symmetric case (parent is right child)
        // ... similar logic
    }

    t.root.IsRed = false // Root is always black
}
```

#### Rotation Operations

Rotations restructure the tree while preserving in-order traversal order:

```
    Left Rotation (rotateLeft):    Right Rotation (rotateRight):
         Y                                X
        / \                              / \
       X   C      ───────────▶         A   Y
      / \                                  / \
     A   B                                B   C
```

```go
func (n *RBNode) rotateLeft() {
    child, parent := n.Right, n.Parent

    if child.Left != nil {
        child.Left.Parent = n
    }
    n.Right = child.Left
    n.Parent = child
    child.Left = n
    child.Parent = parent
    if parent != nil {
        if parent.Left == n {
            parent.Left = child
        } else {
            parent.Right = child
        }
    }
}
```

### Time Complexity Analysis

| Operation | Time Complexity | Description                          |
| --------- | --------------- | ------------------------------------ |
| Put       | O(log n)        | Insert + rebalancing                 |
| Get       | O(log n)        | Tree traversal                       |
| Remove    | O(n)            | Current implementation rebuilds tree |
| Clear     | O(1)            | Set root to nil                      |

The `Remove` operation is O(n) because the current implementation is simplified. It collects all entries except the deleted key and rebuilds the tree:

```go
func (t *RBTree) Remove(key interface{}) error {
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

This is an area for future optimization. Implementing the standard Red-Black Tree deletion algorithm would improve it to O(log n).

## In-Memory LSM Tree Deep Dive

### LSM Tree Basics

The Log-Structured Merge Tree (LSM Tree) is a data structure optimized for write-intensive workloads. Many modern databases like Google Bigtable, Cassandra, and RocksDB use it.

The core idea is simple:

1. **Writes**: Always go to memory first (fast)
2. **Flush**: When memory fills up, write to disk
3. **Merge**: Periodically combine multiple files

KVS's LSM implementation is entirely in-memory but follows the same principles.

### KVS LSM Tree Implementation

#### Tree Structure

```go
type Tree struct {
    memtable      map[string]entry    // Current writable table
    segments      []segment           // Immutable flushed segments
    memtableLimit int                 // Auto-flush threshold
}

type entry struct {
    key     string
    value   interface{}
    deleted bool  // Tombstone (deletion marker)
}

type segment struct {
    entries []entry  // Sorted entries
}
```

What this structure tells us:

- `memtable` is the current active write buffer
- `segments` is a stack of flushed immutable segments (newest first)
- The `deleted` flag handles deferred deletion (tombstone)

#### Write Path

```go
func (t *Tree) Put(key string, value interface{}) error {
    if t == nil {
        return ErrKeyNotFound
    }

    t.ensureMemtable()
    t.memtable[key] = entry{key: key, value: value}
    return t.flushIfNeeded()
}

func (t *Tree) flushIfNeeded() error {
    if len(t.memtable) < t.memtableLimit {
        return nil
    }
    return t.Flush()
}
```

Writes always go to the memtable. When `memtableLimit` (default 4) is reached, it automatically flushes.

#### Flush Operation

```go
func (t *Tree) Flush() error {
    if t == nil || len(t.memtable) == 0 {
        return nil
    }

    // Convert memtable entries to a slice
    entries := make([]entry, 0, len(t.memtable))
    for _, current := range t.memtable {
        entries = append(entries, current)
    }

    // Sort by key (for binary search)
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].key < entries[j].key
    })

    // Add new segment to front of stack
    t.segments = append([]segment{{entries: entries}}, t.segments...)
    t.memtable = make(map[string]entry)
    return nil
}
```

After flushing, segment entries are sorted, enabling binary search.

#### Read Path

Reads must search multiple levels:

```go
func (t *Tree) lookup(key string) (entry, bool) {
    if t == nil {
        return entry{}, false
    }

    // 1. Check memtable first
    if current, ok := t.memtable[key]; ok {
        return current, true
    }

    // 2. Check segments from newest to oldest
    for _, current := range t.segments {
        if found, ok := current.get(key); ok {
            return found, true
        }
    }

    return entry{}, false
}

func (s segment) get(key string) (entry, bool) {
    // Binary search
    idx := sort.Search(len(s.entries), func(i int) bool {
        return s.entries[i].key >= key
    })
    if idx >= len(s.entries) || s.entries[idx].key != key {
        return entry{}, false
    }
    return s.entries[idx], true
}
```

Since segments are ordered newest first, the most recent value is found first.

#### Deletion and Tombstones

LSM Trees don't immediately physically remove data on delete. Instead, they record a deletion marker called a tombstone:

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

In the `Get` operation, entries with tombstones are treated as not found:

```go
func (t *Tree) Get(key string) (interface{}, error) {
    current, ok := t.lookup(key)
    if !ok || current.deleted {
        return nil, ErrKeyNotFound
    }
    return current.value, nil
}
```

### Time Complexity Analysis

| Operation | Time Complexity | Description                           |
| --------- | --------------- | ------------------------------------- |
| Put       | O(1) average    | Write to memtable                     |
| Get       | O(k log m)      | k = segments, m = entries per segment |
| Delete    | O(k log m)      | Tombstone write + lookup              |
| Flush     | O(n log n)      | n = memtable size, sorting cost       |

### LSM Tree Trade-offs

**Advantages:**

- Very fast writes (always in memory)
- Writes are sequential, cache-friendly
- Good for range queries (sorted segments)

**Disadvantages:**

- Reads must search multiple levels
- Space overhead (old data retained)
- Compaction needed (not yet implemented)

## CLI and Server

### Cobra/Viper CLI

KVS provides a CLI using [Cobra](https://github.com/spf13/cobra) and [Viper](https://github.com/spf13/viper):

```bash
kvs --help
kvs -v
kvs version
kvs --config config.yaml version
```

Cobra is a powerful CLI framework, and Viper handles configuration management. The `--config` flag can load configuration files in YAML, JSON, TOML, and other formats.

### HTTP Server

`internal/server/http.go` provides an HTTP JSON API:

| Method | Path     | Description |
| ------ | -------- | ----------- |
| GET    | `/{key}` | Get value   |
| PUT    | `/{key}` | Store value |
| DELETE | `/{key}` | Delete key  |

```bash
# Store value
curl -X PUT http://localhost:8080/mykey -d "myvalue"

# Get value
curl http://localhost:8080/mykey

# Delete key
curl -X DELETE http://localhost:8080/mykey
```

### gRPC Server

`internal/server/grpc.go` provides a gRPC service. Protocol Buffers definitions are in `api/kvsv1/`:

```protobuf
service KVStore {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
}
```

gRPC client example:

```go
conn, _ := grpc.Dial("localhost:50051", grpc.WithInsecure())
defer conn.Close()

client := pb.NewKVStoreClient(conn)

// Store
client.Put(context.Background(), &pb.PutRequest{
    Key:   "greeting",
    Value: "hello",
})

// Get
resp, _ := client.Get(context.Background(), &pb.GetRequest{
    Key: "greeting",
})
fmt.Println(resp.Value) // hello
```

### HTTP vs gRPC Selection

| Criteria    | HTTP            | gRPC              |
| ----------- | --------------- | ----------------- |
| Protocol    | HTTP/1.1 + JSON | HTTP/2 + Protobuf |
| Performance | Moderate        | High              |
| Debugging   | Easy with curl  | Requires tools    |
| Streaming   | Not supported   | Supported         |
| Type Safety | Weak            | Strong            |

## Installation and Deployment

### Go Module

```bash
go get github.com/skyoo2003/kvs@v1.0.0
```

### Homebrew (macOS)

```bash
brew tap skyoo2003/tap
brew install kvs
```

### Build from Source

```bash
git clone https://github.com/skyoo2003/kvs.git
cd kvs
go install ./cmd/kvs
```

### Docker

```bash
docker build -t kvs .
docker run -p 8080:8080 -p 50051:50051 kvs
```

## Conclusion

KVS v1.0.0 is a small but complete key-value store. As we've explored:

- **RBTree** implements rotations and coloring rules to maintain balance
- **LSM Tree** uses memtable and segment structures for write optimization
- **CLI/Server** is built with Cobra, Viper, HTTP, and gRPC

This project started for learning purposes but aims for production-usable quality. All packages are verified with thorough tests, and code quality is maintained through CI pipelines.

### Future Plans

- Optimize RBTree deletion (O(n) → O(log n))
- Implement LSM Tree compaction
- Add persistence support (disk flush)
- Distributed mode (clustering)

For more details, visit the [KVS GitHub repository](https://github.com/skyoo2003/kvs) and [official documentation](https://skyoo2003.github.io/kvs/).
