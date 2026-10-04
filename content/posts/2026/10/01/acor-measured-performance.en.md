---
title: "Measure, Don't Guess: What Made ACOR's Matcher Faster (and What We Removed)"
date: 2026-10-01T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, acor, performance, aho-corasick]
---

## Introduction

For a while, [ACOR](https://github.com/skyoo2003/acor)'s README said that the V2 schema made `Find()` 50–60x faster. While reorganizing the benchmarks for v0.11.0, I found that sentence was wrong. 50–60x was a real measured number. But that speed came from `EnableCache` and the `Preset` engines, not from the V2 schema. V2 without a cache was actually slower than V1.

That changed how I handle performance claims. Every published number now sits in the docs with the command that reproduces it, and structural numbers are pinned by tests. This post covers the performance work from v0.9.0 through v1.5.0: not only the changes that made things faster, but also a change I removed after measuring it, and correctness bugs I found while doing the performance work.

The Aho-Corasick algorithm itself is covered in the [ACOR introduction post](/en/posts/2017/06/28/introducing-acor/), so I won't explain it here.

## Measuring Round Trips and Execution Time

ACOR uses Redis as its store, so its performance numbers come in two kinds:

- **Round trips** are structural. They are counted at the storage boundary, so they are the same on miniredis and on a real server. CI can enforce them with tests.
- **Time** is bound to hardware. Absolute values do not reproduce on another machine. What does reproduce is the **ratio** between configurations.

Round trips are pinned by `pkg/acor/rtt_claims_test.go`. The comment at the top of the file shows its attitude:

```go
// Each test here pins one round-trip claim that ACOR publishes. When a test and
// the docs disagree, the docs are wrong: these counts are measured, the prose
// was asserted. Update README.md and docs/content/reference/benchmarks.md to
// match, never the other way around.
```

This comment states ACOR's policy for RTT figures. If a test and the docs disagree, first check the counter and measurement conditions, then update the docs from the verified measurement. The policy does not rule out bugs in the test itself.

There is even a test for the counter itself. It checks that one pipeline carrying N commands counts as one round trip. If the counter counted N, every published number would be inflated.

| Operation | V1 | V2 |
|---|---|---|
| `Find()` | 1 | 1 |
| `Find()`, `EnableCache` warm | n/a | 0 |
| `Find()`, `Preset` engine | n/a | 0 |
| `FindParallel()`, 63 chunks | 1 | 1 |
| `Add()`, 5-character keyword | 53 | 2 |
| `Add()`, 26-character keyword | 507 | 2 |

The V1 write figures measure the historical implementation preserved as a test fixture. Since v1.5.0, the public API rejects V1 writes with `ErrV1ReadOnly`.

This table alone shows why the 50–60x claim was wrong. V1 and V2 `Find()` both cost one round trip. Changing the schema cannot make reads dozens of times faster in that structure. V2's clear win is on **writes**.

Time is measured on an Apple M4, Go 1.26, Redis 8 on loopback. Repeated runs on the same laptop moved the absolute values by 20–25%, while the ratios held within about 15%. So the docs state ratios as approximate and label raw numbers as a single sample.

| Configuration (1,000 keywords) | ns/op | allocs/op | vs V1 |
|---|---|---|---|
| V1 | 129,062 | 1,070 | baseline |
| V2, no cache | 224,738 | 2,060 | ~1.7x slower |
| V2 + `EnableCache`, warm | 8,631 | 62 | ~15x faster |
| `PresetBalanced` | 2,204 | 4 | **~59x faster** |

## Cut Round Trips First

In a library that uses Redis, round trips come before CPU optimization. Even on loopback, one round trip costs more than one engine scan, and on a real network the gap is larger.

**V2 `Find()` rebuilt the engine on every call (v0.11.0).** Uncached V2 `Find()` built a new match engine from the data read from Redis on every call, even when the dictionary had not changed. Memoizing the engine and reading only the outputs hash took 1,000 keywords from 1,163,098 to 221,253 ns/op, and allocations from 11,704 to 2,063. The gap went from about 9x slower than V1 to about 1.7x. What remains is payload cost: V2 has to read an outputs hash that has an entry per state.

**Bulk adds in one transaction (v0.11.0).** `AddMany` now plans the whole batch at once and commits it in a single transaction. That is two round trips regardless of batch size. Comparing `AddMany` before and after the change, adding 1,000 keywords became about 400x faster with 970x fewer allocations. A separate comparison of the current `Add` loop and `AddMany` puts the same writes at about 350 ms and 3.0 ms, roughly a 117x difference.

**Parallel search read once per chunk (v1.5.0).** `FindParallel` splits a long text into chunks and scans them in parallel. But each chunk read its own automaton from Redis. A text split into 63 chunks sent 63 `HGETALL` calls against the whole outputs hash. Now each call reads once, and every chunk shares that snapshot. Besides cutting round trips, every chunk now sees the same version of the dictionary. The performance fix was a consistency fix too.

## Cutting CPU Cost per Character

With round trips handled, what remains is the scan loop of the `Preset` engines. That loop runs once per input character.

### ASCII Direct Index (v0.9.0)

The engine builds a compact alphabet from the characters that appear in the dictionary, and maps each character to an alphabet index to look up the transition table. At first that mapping used a `map[rune]int`, which costs a hash per character.

There are only 128 ASCII characters, so an array can be indexed directly:

```go
type alphabetCoder struct {
	index map[rune]int
	// asciiCode is a direct-index fast path for index: for an ASCII rune r in the
	// alphabet, asciiCode[r] = index+1 (0 means "not in alphabet"), avoiding a map
	// hash on nearly every character.
	asciiCode [128]int32
	// asciiOnly reports whether every alphabet rune is ASCII. Scans that report no
	// offsets can then walk raw bytes instead of decoding UTF-8.
	asciiOnly bool
}
```

The index is stored plus one so that `0` can mean "not in the alphabet." This change, together with not recomputing character codes while following failure links, made the default `Balanced` `Find` about 2.2–2.4x faster, and `Speed` up to 3x. Results did not change.

### Flattened Transition Table and Byte Scan (v0.11.0)

The `Speed` engine's DFA transition table was a `[][]int`. Each character cost a slice-header load and two bounds checks. It was flattened into a single `[]int32` indexed by `state*alphaSize+alphabetIndex`. Each entry also carries an output bit, so states with no match skip the output lookup.

When the dictionary is pure ASCII, UTF-8 decoding is skipped as well:

```go
// Byte scan when the dictionary is pure ASCII. Every byte of a multibyte rune
// is >= utf8.RuneSelf and so cannot be in the alphabet, so it resets to root
// just as the rune scan does.
if e.asciiOnly {
	for i := 0; i < len(text); i++ {
		ai, ok := e.codeByte(text[i])
		if !ok {
			state = 0
			continue
		}
		v := e.dfa[state*alpha+ai]
		state = int(v &^ hasOutputBit)
		if v&hasOutputBit == 0 {
			continue
		}
		matched = e.out.appendChain(matched, state)
	}
	// ...
}
```

Every byte of a multibyte character is `0x80` or above, so it can never be in an ASCII alphabet. Walking byte by byte therefore returns to the root exactly as a rune scan does. `Find` does not report offsets, so the difference between byte and rune indices never shows.

### Why the Loops Are Not Shared

The ASCII loop and the rune loop above are nearly identical, which makes a shared `scan(text, onOutput)` helper tempting. I measured it. Capturing the result slice in a closure moves it to the heap, so every match writes through a pointer. `PresetSpeed`'s ASCII match path got 12–17% slower (2,979 → 3,483 ns at 1,000 keywords). It won on multibyte text and text with no matches, but not by enough to pay for the main path. So the duplication stays, with a comment that records why, with the measurement.

## Removing the Bloom Filter

ACOR had a preset called `PresetUltimate`. In v0.8.0, the separate Ultimate engine was merged into `Balanced`, so it became the `Balanced` engine with a Bloom pre-filter in front. Before scanning, the filter checks whether a keyword can start at this position. The idea was to skip needless transitions on text that rarely matches.

After adding the ASCII byte scan, I measured again, and the result flipped. Going through the Bloom filter was **1.7–1.8x slower**. Checking the filter now cost more than the scan itself, which had become cheap. On top of that, the filter blocked the byte-scan path.

In v0.11.0, `PresetUltimate` became a deprecated alias for `PresetBalanced`, and the Bloom filter was removed from it. Existing code still compiled and got the faster engine. v1.5.0 removed the alias. `PresetMemoryEfficient`, whose purpose is saving memory, keeps its Bloom filter. The same technique pays off differently depending on what an engine is for.

## Correctness Bugs Found by Performance Work

While optimizing the failure-link construction in v0.9.0, I found two bugs. Both produced wrong results.

**A goto transition was applied twice.** When building failure links for the `Speed` and `MemoryEfficient` engines, one goto transition was applied twice. On keyword sets with nested suffixes such as `{a, aa, aaa}`, `MemoryEfficient`'s `Find` could loop forever, and `Speed` silently dropped matches.

**The DFA was filled in state-id order.** The `Speed` engine filled its DFA transition table in state-id order. But when a state's failure link points at a state that was **inserted later**, that state's transitions are referenced before they are filled. The table is now filled breadth-first. In Aho-Corasick, a failure link always points to a shallower state, so filling in depth order guarantees the referenced state is always complete first.

Both bugs passed the existing tests. They surfaced because the performance work added tests that compare results across engines. Making something faster has to come with checking that it still gives the same answer.

## Reducing Allocations in FindSet

`FindSet` returns the matched keywords once each, in first-match order. The first implementation deduplicated by string. v1.5.0 switched to a 4-byte pattern ID, with keyword strings interned once when the engine is built. At 1,000 keywords it is 1.4–3.2x faster, and allocations per query fell from 178 KB/44 to 35 KB/10. Sparse text is unchanged, because it had nothing to allocate in the first place.

In the same spirit, `Find` and `FindSet` do not allocate a result slice when nothing matches. When ACOR is used as a filter, most text matches nothing, and there is no reason to allocate memory for a match that never happened.

## Conclusion

Cache settings and `Preset` change search performance, so compare runs under the same conditions. Count round trips at the storage boundary and record timing with its environment. Treat V1 write figures as historical comparisons rather than current API behavior.

The reproduction commands and full tables are on the [Benchmarks page of the ACOR docs](https://skyoo2003.github.io/acor/reference/benchmarks/). The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
