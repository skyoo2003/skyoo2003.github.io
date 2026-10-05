---
title: "Rewriting Search Results Safely: Unicode Masking and Resource Limits in ACOR"
description: "How ACOR's Scan, MaskText, and ReplaceText keep original byte offsets after case folding, resolve overlapping matches, and enforce result and work limits."
date: 2026-10-05T00:00:00+09:00
tags: [go, acor, unicode, text-processing]
---

Once a program can find keywords, masking them with asterisks or replacing them with another phrase looks straightforward. It becomes harder when the string used for matching differs from the original returned to the user. Lowercasing alone can change UTF-8 byte lengths, and overlapping keywords compete to replace the same input.

[ACOR](https://github.com/skyoo2003/acor) addresses this with `Scan`, `MaskText`, and `ReplaceText`: original-input positions and explicit resource limits. This post examines the design at the [v1.7.0 source](https://github.com/skyoo2003/acor/tree/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8). The [V3 post](/en/posts/2026/10/02/acor-v3-versioned-dictionaries/) covers dictionary storage and refresh; here the focus is on input and output.

## Character Positions and Byte Positions Differ

Suppose the dictionary contains `한국`, `한국어`, and `istanbul`, and the input is:

```text
한국어 İSTANBUL
```

Case-insensitive matching finds `istanbul` in `İSTANBUL`. Go's `unicode.ToLower` maps `İ` to `i`, but the original `İ` occupies two UTF-8 bytes and `i` occupies one. Applying byte offsets obtained from a lowercased copy to the original can leave the final character outside the selected span.

Go string slicing also operates on bytes. `한국어` contains three runes but occupies nine bytes. With leftmost-longest selection, the two selected matches have the following original positions. End positions are exclusive.

| Original match | Normalized keyword | Rune span | Byte span |
|---|---|---|---|
| `한국어` | `한국어` | `[0, 3)` | `[0, 9)` |
| `İSTANBUL` | `istanbul` | `[4, 12)` | `[10, 19)` |

A rune count is not a count of visible characters either. Combining characters and some emoji consist of multiple code points. This API reports rune and byte positions, not grapheme-cluster positions.

## Lowercase for Matching, Original Positions for Results

`Scan` returns `SourceMatch` values carrying both kinds of information:

| Field | Meaning |
|---|---|
| `Keyword` | Matched dictionary keyword |
| `Text` | Substring sliced from the original input |
| `Start`, `End` | Original rune span |
| `ByteStart`, `ByteEnd` | Original byte span |

The implementation first walks the input to build an original-rune array and an array of byte offsets for each rune's start. It appends `len(text)` to represent the position after the final rune. During matching, it passes lowercased runes to the engine when needed. When a match arrives, the original-offset array restores its byte span. Consequently:

```go
match.Text == text[match.ByteStart:match.ByteEnd]
```

The actual conversion happens in [`sourceScanner.emit`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan.go). Case-insensitive matching uses `unicode.ToLower` one rune at a time. It does not promise every Unicode case-folding expansion or NFC/NFD normalization.

Malformed UTF-8 is not repaired by re-encoding the whole input. Matching decodes it as `RuneError` according to Go's rules, while unchanged output regions retain their original bytes. An application can separately decide whether to accept such input.

## Overlapping Matches Cannot All Be Rewritten

Both `한국` and `한국어` start at the same position in `한국어`. Returning both is useful for a search, but applying both replacements would consume the same original bytes twice.

Masking and replacement therefore always use **leftmost-longest** selection: take the earliest available start, choose the longest match there, and discard overlapping candidates. `Scan` can also return overlapping results, but the rewrite selection rule is fixed.

The implementation does not collect and sort every raw match. It keeps the longest candidate at each pending start and waits until it has advanced by the dictionary's longest keyword length before deciding that start. At that point, a longer keyword beginning there cannot finish later. End-of-input flushes the remaining candidates.

Candidates beginning before the end of the previously selected span are discarded. [`sourceScanner.flush`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan.go) implements the decision boundary and overlap removal. This still requires the input-rune and offset arrays, pending starts, and retained results; it is not constant-memory processing.

## Limit Results and Work Separately

Keeping at most 1,000 results does not mean doing at most 1,000 units of matching work. With keywords such as `a`, `aa`, and `aaa`, each input step can emit multiple candidates. Even if `WholeWord` rejects every candidate and the result is empty, the engine still handles them.

`ScanOptions` therefore has three independent limits:

| Option | Default | At the limit |
|---|---|---|
| `MaxInputBytes` | 1 MiB | `ErrInputLimit` before loading the engine or scanning |
| `MaxMatches` | 1,000 | Another eligible match sets `Truncated: true` |
| `MaxCandidates` | 100,000 | Another raw candidate produces `ErrScanWorkLimit` |

Zero selects the default, rather than removing the limit; negative values are rejected. Candidates are counted **before** word-boundary checks and overlap selection, so rejected candidates cannot bypass the work budget. `MaxMatches` counts results eligible for retention.

Exactly reaching the result limit does not mark the result truncated. An additional eligible match must be found. Exceeding the input-size or candidate limit, or canceling the context, instead returns an error and no result. `Truncated` and errors are different signals. [`TestScanLimitsAndWordBoundaries`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan_test.go) fixes these boundaries in tests.

A context cannot immediately interrupt arbitrary user code. A custom `WordRune` callback, for example, runs in the caller's goroutine. If it never returns, execution cannot reach the next cancellation check.

## Never Return a Half-Masked Document

A search can show some results and report that others were truncated. A rewrite that stops halfway is different: returning it as a success makes it easy for a caller to use a document with later keywords still exposed.

`MaskText` and `ReplaceText` express that difference in their contracts. Exceeding the match limit returns `ErrMatchLimit`; exceeding the output limit returns `ErrOutputLimit`. **Every error returns a nil `RewriteResult`**, including input limits, candidate limits, and cancellation.

`RewriteOptions.MaxOutputBytes` defaults to 4 MiB. [`renderRewrite`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/rewrite.go) calculates the final size from selected matches and unchanged regions before allocating the output buffer. Unmatched input counts toward that size too. A document with no keyword matches still fails if its output limit is smaller than the input.

`ReplaceText` inserts its replacement literally. It performs no regular-expression capture expansion and does not search the replacement again. An empty replacement deletes the matched spans.

`MaskText` writes **one mask rune per matched original rune**. It preserves rune count, not byte count. Masking the example with `*` produces:

```text
*** ********
```

Using `●` produces a larger output because each mask occupies three UTF-8 bytes. Returned match offsets always refer to the **input**, even when the replacement makes the output shorter. They must not be applied to the rewritten string.

## Using It with a V3 Dictionary

This example uses local Redis and the v1.7.0 library. It replaces the named example dictionary, so run it against a test Redis instance. After committing the dictionary, `WaitForVersion` waits for this instance's serving engine to reflect the write.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/skyoo2003/acor/pkg/acor"
)

func main() {
    if err := run(); err != nil {
        log.Fatal(err)
    }
}

func run() error {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    dictionary, err := acor.OpenVersioned(ctx, &acor.VersionedOptions{
        Redis: acor.AhoCorasickArgs{Addr: "localhost:6379", Name: "rewrite-example"},
    })
    if err != nil { return err }
    defer dictionary.Close()

    snapshot, err := dictionary.Snapshot(ctx)
    if err != nil { return err }
    expected := snapshot.Version()
    if err := snapshot.Close(ctx); err != nil { return err }
    write, err := dictionary.Replace(ctx, expected, []string{"한국", "한국어", "istanbul"})
    if err != nil { return err }
    if err := dictionary.WaitForVersion(ctx, write.Version); err != nil { return err }

    text := "한국어 İSTANBUL"
    found, err := dictionary.Scan(ctx, text, &acor.ScanOptions{
        Kind: acor.MatchKindLeftmostLongest,
    })
    if err != nil { return err }
    if found.Truncated { return fmt.Errorf("incomplete scan") }
    for _, match := range found.Matches {
        fmt.Printf("%q [%d,%d)\n", match.Text, match.ByteStart, match.ByteEnd)
    }
    masked, err := dictionary.MaskText(ctx, text, '*', nil)
    if err != nil { return err }
    fmt.Println(masked.Text)
    return nil
}
```

Running it against a local Redis prints the following.

```text
"한국어" [0,9)
"İSTANBUL" [10,19)
*** ********
```

Each V3 call retains one serving engine throughout its work. Installing a new dictionary during a call does not make its first and last portions use different generations. However, this example's `Scan` and `MaskText` are separate calls: a concurrent writer can make them observe different generations.

## Boundaries Fixed by Tests

The following tests in [`scan_test.go`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan_test.go) document the implementation's boundaries:

- `TestScanOriginalUnicodeSpans` compares original byte and rune spans across three presets and both match kinds.
- `TestRewriteAtomicAndOriginalOffsets` checks mask rune counts, original offsets, nil results on limit failures, and deletion with an empty replacement.
- `TestScanSensitiveAndMalformedUTF8` covers case-sensitive matching and malformed UTF-8.
- `FuzzScanLeftmostParity` compares leftmost-longest results with the existing matching API.

Also consider `SourceMatch.Text` when retaining a masked result. It contains the original matched substring: storing the match list alongside the masked text can record the very keyword that was hidden. Substrings can also keep the larger original string alive in memory.

## Wrapping Up

Extending search into masking and replacement meant defining original positions, an overlap selection rule, and input, work, and output limits together. Matching keywords are kept separate from the original text used for output, and one V3 transformation uses one serving engine.

Callers should check both the error and `Truncated` from `Scan`, and use masking or replacement results only when there is no error. Returned positions always refer to the input, so be careful not to apply them to the rewritten string.

The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
