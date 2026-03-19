---
title: "Deep Dive into ACOR v1.3.0 Index APIs"
date: 2026-03-16T00:00:00+09:00
tags: [go, redis, acor, deep-dive]
---

## Introduction

The [Aho-Corasick algorithm](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm) is a classic string-searching algorithm that efficiently finds all occurrences of multiple patterns in a text simultaneously. It's widely used in spam filtering, sensitive data detection, and autocomplete systems.

[ACOR](https://github.com/skyoo2003/acor) is a Go library that implements Aho-Corasick with Redis as the backend storage. Version 1.3.0 introduces Index APIs that extend the existing functionality to provide match position information.

In this post, we'll take a deep dive into the design and implementation of the `FindIndex` and `SuggestIndex` APIs.

## Comparison with Existing APIs

Prior to v1.3.0, ACOR provided two search APIs:

```go
// Existing APIs: Returns only matched keywords
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) Suggest(input string) ([]string, error)
```

These APIs tell you which keywords matched, but not where in the text they were found. For text highlighting or position-based analysis, you'd need to calculate indices separately.

The v1.3.0 Index APIs solve this problem:

```go
// New Index APIs: Returns keywords with their start indices
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

## API Overview

### FindIndex

`FindIndex` traverses the input text and finds all positions where registered keywords match:

```go
matched, err := ac.FindIndex("he is him")
// Result: map[string][]int{
//   "he":  {0},
//   "him": {6},
// }
```

The return value is a `map[keyword][]startIndex`. Since each keyword can match at multiple positions, the start indices are returned as a slice.

### SuggestIndex

`SuggestIndex` returns matched keywords and their start positions for prefix-based autocomplete:

```go
suggestions, err := ac.SuggestIndex("he")
// Result: map[string][]int{
//   "he":  {0},
//   "her": {0},
// }
```

## Usage Example

Here's a complete usage example:

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

    // Register keywords
    keywords := []string{"he", "her", "his", "him"}
    for _, k := range keywords {
        ac.Add(k)
    }

    // Find match positions with FindIndex
    matched, _ := ac.FindIndex("he is him and she is her")
    fmt.Println(matched)
    // Output: map[he:[0] him:[6] her:[21]]
}
```

## Implementation Deep Dive

### Rune-Based Indexing

The key to `FindIndex` is proper Unicode handling. Go's `range` statement iterates over strings in rune (Unicode code point) units:

```go
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error) {
    matched := make(map[string][]int)
    state := ""
    runeIndex := 0

    for _, char := range text {  // Iterates by rune
        // State transition logic...
        runeIndex++
    }
    // ...
}
```

This approach ensures correct indexing for multi-byte characters like Korean and emojis.

### State Transition Logic

The core of Aho-Corasick is the Trie structure and Failure Function. ACOR stores these in Redis:

```go
func (ac *AhoCorasick) _go(inState string, input rune) (string, error) {
    buffer := bytes.NewBufferString(inState)
    buffer.WriteRune(input)
    nextState := buffer.String()

    // Check next state in Redis Sorted Set
    pKey := ac.prefixKey()
    err := ac.redisClient.ZScore(ac.ctx, pKey, nextState).Err()
    if err == redis.Nil {
        return "", nil  // Transition not possible
    }
    return nextState, nil
}

func (ac *AhoCorasick) _fail(inState string) (string, error) {
    pKey := ac.prefixKey()
    inStateRunes := []rune(inState)
    for idx := 0; idx < len(inStateRunes); idx++ {
        nextState := string(inStateRunes[idx+1:])
        // Try falling back to shorter suffixes
        err := ac.redisClient.ZScore(ac.ctx, pKey, nextState).Err()
        if err == nil {
            return nextState, nil
        }
    }
    return "", nil
}
```

### Index Calculation

The start index of a matched keyword is calculated by subtracting the keyword length from the end position:

```go
func (ac *AhoCorasick) appendMatchedIndexes(
    matched map[string][]int,
    outputs []string,
    endIndex int,
) {
    for _, output := range outputs {
        startIndex := endIndex - len([]rune(output))
        matched[output] = append(matched[output], startIndex)
    }
}
```

Using `len([]rune(output))` ensures calculation by character count, not byte count.

## Edge Cases

### Overlapping Matches

In the text `"her"`, both `"he"` and `"her"` match at index 0:

```go
matched, _ := ac.FindIndex("her")
// Result: map[string][]int{
//   "he":  {0},
//   "her": {0},
// }
```

### Repeated Matches

In `"hehe"`, `"he"` matches twice:

```go
matched, _ := ac.FindIndex("hehe")
// Result: map[string][]int{
//   "he": {0, 2},
// }
```

### Unicode Handling

Registering Korean keyword `"한글"` and searching in `"가한글"`:

```go
matched, _ := ac.FindIndex("가한글")
// Result: map[string][]int{
//   "한글": {1},  // Character index, not byte index
// }
```

`"가"` is the 0th rune, `"한글"` starts at the 1st rune.

## Performance Considerations

Index APIs have the following overhead compared to the original APIs:

1. **Memory**: Storing index information in `map[string][]int` structure
2. **Computation**: Calculating rune length with `len([]rune(output))` at each match

For simple existence checks where index information isn't needed, use the original `Find`/`Suggest` APIs for better efficiency. For text highlighting, position-based logging, or analysis tasks requiring indices, the Index APIs are the right choice.

## Conclusion

ACOR v1.3.0's Index APIs expand the library's utility by providing match position information. The rune-based indexing for proper Unicode handling and the implementation of Aho-Corasick's state transitions in Redis are particularly noteworthy.

For more details, check out the [ACOR GitHub repository](https://github.com/skyoo2003/acor) and [official documentation](https://skyoo2003.github.io/acor/).
