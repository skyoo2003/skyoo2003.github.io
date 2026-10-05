---
title: "Introducing ACOR: Redis-backed Aho-Corasick Implementation"
description: "How the Aho-Corasick algorithm matches many keywords at once using a trie and failure links, and how ACOR implements it in Go with Redis as storage."
date: 2017-06-28T16:39:49+09:00
tags: [go, redis, acor, tutorial]
---

Finding one keyword in a string isn't hard. But when there are hundreds or thousands of keywords to look for, it's a different story. If you scan the text once per keyword, search time grows with the number of keywords.

The usual answer here is the [Aho-Corasick algorithm](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm). Published by Alfred V. Aho and Margaret J. Corasick in a [1975 paper](http://dl.acm.org/citation.cfm?id=360855), it finds every keyword while walking the text only once, no matter how many keywords there are.

I implemented this algorithm in Go and released it as [ACOR (Aho-Corasick automation On Redis)](https://github.com/skyoo2003/acor), a library that stores the trie in Redis instead of memory. The idea came from the [judou/redis-ac-keywords](https://github.com/judou/redis-ac-keywords) project. In this post I'll briefly go over the algorithm, then show how ACOR stores its data in Redis and how to use it.

## A Quick Look at Aho-Corasick

The algorithm is made of three parts.

1. **Goto (trie)** : A trie built from the registered keywords. Decides whether the current state can move on with the next character.
2. **Failure (failure function)** : Defines the state to fall back to when it can't move on.
3. **Output (output function)** : Defines the keywords matched when a state is reached.

You read the text one character at a time and move with Goto. When you can't move, you follow Failure back and try again. Checking Output at each state gives you every matched keyword. With text length n, total keyword length m, and z matches, the time complexity is O(n + m + z).

For example, registering "he", "his", and "she" builds this trie.

```
root
├── h
│   ├── e (output: "he")
│   └── i
│       └── s (output: "his")
└── s
    └── h
        └── e (output: "she", "he")
```

Note that the output of the "she" state also contains "he", because "he", a suffix of "she", is a keyword too. The failure function works on the same idea: if the "his" state can't move any further, it falls back to "s", the longest suffix of "his" that exists in the trie. That way you never have to go back and reread the text.

## What ACOR Stores in Redis

ACOR doesn't create node objects for trie states. A state is just **the string from the root to that state**. The state reached by "h" → "i" → "s" is simply the string "his". Thanks to that, you can tell which state a value is just by looking at it in Redis, which made debugging easy.

Based on the name given as `Name`, it uses these keys.

| Key | Type | Use |
|---|---|---|
| `{name}:keyword` | Set | Registered keywords |
| `{name}:prefix` | Sorted Set | Every trie state (every prefix of the keywords) |
| `{name}:suffix` | Sorted Set | State strings reversed. Used to find states whose output must be recomputed |
| `{state}:output` | Set | Keywords matched at that state |
| `{keyword}:node` | Set | States that have that keyword as output (used on removal) |

Goto is just a `ZSCORE` check for "current state + next character" in `{name}:prefix`. The failure function isn't precomputed; on every search it looks up the suffixes of the current state in `{name}:prefix`, longest first. Outputs, on the other hand, are computed and stored when a keyword is added.

Keeping it in Redis means a large keyword set doesn't take up application memory, and several application instances can share the same keyword dictionary. Of course, since every state transition calls Redis, it's bound to be slower than an in-memory implementation. I think it fits cases where several servers need to share one keyword dictionary.

## Usage

### Prerequisites

- Go 1.7+
- Redis 3.x+

### Installation

```bash
$ go get github.com/skyoo2003/acor
```

Dependencies are managed with [Glide](https://github.com/Masterminds/glide).

### Example

```go
package main

import (
	"fmt"

	"github.com/skyoo2003/acor"
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

	ac.Flush() // If you want to remove all of the data
}
```

If you don't have Redis locally, the `run-redis.sh` script in the repository starts a Redis docker container for testing.

### Methods

| Method | Description |
|---|---|
| `Create(args)` | Connect to Redis and create an Aho-Corasick instance |
| `Add(keyword)` | Add a keyword |
| `Remove(keyword)` | Remove a keyword |
| `Find(text)` | Find matching keywords in text |
| `Suggest(input)` | Look up keywords starting with the input |
| `Info()` | Get the number of keywords and nodes (states) |
| `Flush()` | Delete all stored data |
| `Close()` | Close the Redis connection |

## Wrapping Up

I built it with cases like profanity filtering or detecting messages with certain keywords in mind, where several servers need to share a keyword dictionary. It's still an early version with plenty missing, so I plan to keep improving it.

See the [GitHub repository](https://github.com/skyoo2003/acor) for details.
