---
title: "Introducing ACOR: Redis-backed Aho-Corasick Implementation"
date: 2017-06-28T16:39:49+09:00
tags: [go, redis, algorithm, aho-corasick]
---

## Introduction

String searching is a common problem in software development. Finding a single keyword is straightforward, but what if you need to search for hundreds of keywords simultaneously? Iterating through the text for each keyword would be inefficient.

The [Aho-Corasick algorithm](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm) elegantly solves this problem. Developed by Alfred V. Aho and Margaret J. Corasick in 1975, this algorithm can efficiently search for multiple patterns at once.

[ACOR](https://github.com/skyoo2003/acor) is a Go library that implements Aho-Corasick with Redis as the backend storage. In this post, we'll introduce ACOR, cover the basics of the Aho-Corasick algorithm, and walk through its usage.

## Aho-Corasick Algorithm Overview

### Basic Principles

The Aho-Corasick algorithm operates in two phases:

1. **Trie Construction**: Build a trie data structure from the keywords to search
2. **Failure Function Construction**: Pre-calculate which state to transition to when a match fails

During search, the input text is traversed only once while finding all keyword matches. The time complexity is O(n + m + z), where n is the text length, m is the total length of all keywords, and z is the number of matches.

### Trie Structure

A trie is a tree structure where each node represents a single character. When registering keywords "he", "his", and "she", the following trie is constructed:

```
root
├── h
│   ├── e (output: "he")
│   └── i
│       └── s (output: "his")
└── s
    └── h
        └── e (output: "she")
```

### Failure Function

The failure function defines which state to return to when matching fails at the current state. For example, if searching for "his" and a different character appears after 's', the algorithm falls back to the suffix "s" or the empty string state.

This allows finding all matches without backtracking through the text.

## ACOR Design and Features

### Redis as Storage

ACOR's unique feature is storing the trie and failure function in Redis. Benefits include:

1. **Memory Efficiency**: Large keyword sets are managed by Redis's memory management
2. **Persistence**: Data preservation through Redis persistence options
3. **Distributed Environment Support**: Multiple application instances can share the same trie

### State Representation

ACOR represents states as strings. For example, the path "h" -> "i" -> "s" is represented as the state string "his". This simple representation makes debugging and understanding easier.

Redis Sorted Sets are used to manage valid states.

## Getting Started

### Prerequisites

- Go 1.13 or higher
- Redis 3.0 or higher

### Installation

```bash
go get -u github.com/skyoo2003/acor
```

### Basic Usage

```go
package main

import (
    "fmt"
    "github.com/skyoo2003/acor/pkg/acor"
)

func main() {
    args := &acor.AhoCorasickArgs{
        Addr:     "localhost:6379",
        Password: "",
        DB:       0,
        Name:     "sample",
    }
    ac := acor.Create(args)
    defer ac.Close()

    keywords := []string{"he", "her", "him"}
    for _, k := range keywords {
        ac.Add(k)
    }

    matched := ac.Find("he is him")
    fmt.Println(matched)
    // Output: [he him]

    ac.Flush()
}
```

### API Overview

| Method | Description |
|--------|-------------|
| `Create(args)` | Create a new Aho-Corasick instance |
| `Add(keyword)` | Add a keyword |
| `Find(text)` | Search for matching keywords in text |
| `Suggest(input)` | Get prefix-based autocomplete suggestions |
| `Flush()` | Remove all registered keywords |
| `Close()` | Close Redis connection |

## Use Cases

1. **Spam Filtering**: Register spam keywords and search messages
2. **Sensitive Data Detection**: Detect patterns like SSNs, credit card numbers
3. **Autocomplete**: Search query autocomplete systems
4. **Content Moderation**: Filter inappropriate words

## Conclusion

ACOR combines the power of the Aho-Corasick algorithm with the flexibility of Redis. It's easy to integrate into projects that need multi-keyword searching.

For more details, check out the [GitHub repository](https://github.com/skyoo2003/acor).
