---
title: "ACOR v1.3.0: Redis Topology Support and Enhanced Error Handling"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, deep-dive]
---

## Introduction

[ACOR](https://github.com/skyoo2003/acor) v1.3.0 introduces two significant Redis-related improvements. First, it now supports various Redis topologies (Sentinel, Cluster, Ring). Second, the API has been improved to explicitly handle errors during Redis communication.

## Redis Topology Support

### The Problem

Prior to v1.3.0, ACOR only supported a single Redis instance (`Addr`). In production environments, Redis Sentinel is often used for high availability, or Redis Cluster for handling large-scale data. Using ACOR in these environments required additional work.

### The Solution

v1.3.0 adds topology-specific fields to the `AhoCorasickArgs` struct to support various Redis deployment modes:

```go
type AhoCorasickArgs struct {
    Addr       string            // Standalone
    Addrs      []string          // Sentinel or Cluster
    MasterName string            // Sentinel master name
    RingAddrs  map[string]string // Ring shards
    Password   string
    DB         int
    Name       string
}
```

### Usage Examples

**Standalone (existing approach)**

```go
args := &acor.AhoCorasickArgs{
    Addr:     "localhost:6379",
    Password: "",
    DB:       0,
    Name:     "sample",
}
```

**Redis Sentinel**

```go
args := &acor.AhoCorasickArgs{
    Addrs:      []string{"localhost:26379", "localhost:26380"},
    MasterName: "mymaster",
    Password:   "",
    DB:         0,
    Name:       "sample",
}
```

**Redis Cluster**

```go
args := &acor.AhoCorasickArgs{
    Addrs:    []string{"localhost:7000", "localhost:7001", "localhost:7002"},
    Password: "",
    Name:     "sample",
}
```

**Redis Ring**

```go
args := &acor.AhoCorasickArgs{
    RingAddrs: map[string]string{
        "shard-1": "localhost:7000",
        "shard-2": "localhost:7001",
    },
    Password: "",
    DB:       0,
    Name:     "sample",
}
```

### Cluster-Safe Key Design

Redis Cluster distributes keys across multiple shards. ACOR uses hash tags to ensure all keys belonging to a single collection are stored on the same shard:

```
{collection-name}:prefix:state
{collection-name}:output:keyword
```

This guarantees that all data for a single Aho-Corasick automaton is stored on the same shard, ensuring transaction support and read consistency.

## Redis Error Handling

### The Problem

Before v1.3.0, errors during Redis communication were silently ignored. For example, if the network disconnected, `Find` would return an empty result, making it impossible to distinguish between "no keywords matched" and "Redis connection failed."

### The Solution

In v1.3.0, all Redis-related APIs now explicitly return errors:

```go
func (ac *AhoCorasick) Create(args *AhoCorasickArgs) (*AhoCorasick, error)
func (ac *AhoCorasick) Add(keyword string) (bool, error)
func (ac *AhoCorasick) Remove(keyword string) (bool, error)
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) Flush() error
```

### Partial Write Rollback

The `Add` method stores keywords as a trie structure in Redis, requiring multiple Redis commands. If it fails midway, partially stored data would remain. v1.3.0 performs rollback on failure to ensure data consistency:

```go
func (ac *AhoCorasick) Add(keyword string) (bool, error) {
    // Store trie nodes in Redis
    for _, node := range nodes {
        if err := ac.saveNode(node); err != nil {
            // Roll back already saved nodes on failure
            ac.rollbackNodes(savedNodes)
            return false, err
        }
        savedNodes = append(savedNodes, node)
    }
    return true, nil
}
```

### Usage Example

```go
ac, err := acor.Create(args)
if err != nil {
    log.Fatalf("Redis connection failed: %v", err)
}
defer ac.Close()

matched, err := ac.Find("he is him")
if err != nil {
    log.Printf("Error during search: %v", err)
    // Handle error appropriately
    return
}
fmt.Println(matched)
```

## Conclusion

With v1.3.0's Redis improvements, ACOR can now be used more safely in production environments. Redis Sentinel/Cluster/Ring support provides high availability and scalability, while explicit error handling enables appropriate responses to failure scenarios.

For more details, visit the [ACOR GitHub repository](https://github.com/skyoo2003/acor) and [official documentation](https://skyoo2003.github.io/acor/).
