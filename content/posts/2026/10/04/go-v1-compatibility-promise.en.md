---
title: "The Cost of Saying v1: Enforcing Compatibility Promises in Three Go Projects"
description: "Taking ACOR, KVS, and DevCloud to v1: retracting ghost versions and using CI to check public API lists, data formats, and config compatibility."
date: 2026-10-04T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, api-compatibility, acor, kvs, devcloud]
---

This year, three of my open-source projects reached v1: the Aho-Corasick library [ACOR](https://github.com/skyoo2003/acor), the key-value store [KVS](https://github.com/skyoo2003/kvs), and the AWS emulator [DevCloud](https://github.com/skyoo2003/devcloud). One caveat: KVS later retracted v1.0.0 for reasons covered below, so the release in which its promise actually takes effect is still being prepared.

In Go, v1 is not just a number. Under the [import compatibility rule for Go modules](https://go.dev/blog/module-compatibility), code that used an older version of a package must keep working with a newer version at the same import path. A breaking change requires a new path such as `/v2`. Anything could change in v0, but from v1 on, whatever you publish has to be carried until v2.

While taking these three projects to v1, I worked out ways to keep that promise **by machine** rather than by memory. This post collects them across the projects: withdrawing ghost versions, shrinking the public surface, pinning the surface with snapshots, and deciding how far the promise extends into docs, data formats, and runtime behavior.

## 1. Withdrawing Ghost Versions: `retract`

The first problem ACOR hit on the way to v1 was not code. It was **tags that no longer existed**. ACOR had once published from v1.0.0–v1.4.0 tags and then deleted those tags. But deleting a tag does not unpublish a module version, because `proxy.golang.org` caches every version it has seen forever. So `go get github.com/skyoo2003/acor` was landing on the deleted v1.4.0 instead of the supported v0.11.x.

The fix is the `retract` directive in `go.mod`:

```go
// Published in error; upgrade to v1.5.0 or later.
// Only the line above reaches users: the go command truncates a retraction
// rationale at the first newline, so keep it a complete sentence.
// v1.5.0 is the first supported v1 release. Never let this range reach it.
// See RELEASE.md.
retract [v1.0.0, v1.4.0]
```

What I like about this comment is that it is written for two readers. The `go` command **truncates the retraction rationale at the first line**, so the first line has to be a complete sentence for users. The remaining lines are a warning for maintainers: if this range ever widens to v1.5.0, it will retract the first supported version.

Since v1.0–v1.4 were already taken, the first supported v1 became v1.5.0. That is why the version number jumps from v0.11.x to v1.5.0. v1.5.0 is the first release carrying the retract block, and the baseline the v1 promise is measured from.

There is one more rule. The `go` command reads retractions **only from the `go.mod` of the highest published version**. If the next release drops the block, the retracted versions silently come back. So ACOR's CI checks that the `retract` line is still in `go.mod`. A rule someone had to remember became a rule the machine keeps.

KVS uses `retract` too. It retracts `[v0.1.0, v0.1.1]` and v1.0.0. v1.0.0 had the library at the module root. On 2026-09-29 the repository moved to the standard Go layout, the library moved to `pkg/kvs`, and v1.0.0 was retracted the same day. KVS's compatibility page now says the former module-root path is no longer provided. KVS's retraction does not have a rationale comment yet, though, so users see no reason. A one-sentence first line, as in ACOR, would be better. And because of the rule above, this retraction only takes effect once the next KVS release carrying the block is published. That release is not out yet.

## 2. Trimming the Public API Before v1

Once you go to v1, every exported identifier becomes a promise. So most of the work in ACOR v1.5.0 was not adding features. It was **shrinking the surface**.

- **Aliases into internal packages became real definitions.** Public types such as `KVStorage`, `Preset`, and `Match` were aliases of types in internal packages. With an alias, every change to the internal package changes the public API too. They are now all declared directly in `pkg/acor`.
- **The storage abstraction was unexported.** Unexporting `KVStorage`, `Pipeliner`, `Subscription`, `StringMapResult`, `PubSubMessage`, and `Z` removed 43 of the 223 entries that would have been frozen. No exported function accepted or returned these interfaces, so nobody outside could supply an implementation anyway. But freezing them as exported would forbid adding methods during v1, locking in the shape of a future pluggable-storage feature before it existed.
- **Unused things were deleted.** `InMemoryInfo`, a field-for-field duplicate of `AhoCorasickInfo`, and `PresetUltimate`, a deprecated alias for `PresetBalanced`, were removed.

The docs state one exception: upgrading from v0.11.x to v1.5.0 may require code changes. Every upgrade after that is within the promise.

DevCloud did the same thing differently. Just before v1.0.0, a repo-wide over-engineering audit removed the event bus and admin WebSocket, the `GetMetrics` plugin API, and `/devcloud/api/metrics`. The web dashboard moved to a separate repository, and the binary now serves no UI, only the opt-in admin API. The surface to promise was shrunk first.

## 3. Maintaining the Public API List

Once the surface is small, pin it. ACOR and KVS use the same approach: generate the public surface as a text file, commit it, and have CI regenerate and compare it on every run.

ACOR's `api/v1.txt` starts like this:

```text
# Public API surface of github.com/skyoo2003/acor/pkg/acor, frozen for the v1 line.
# Generated by tools/apisnap. Regenerate with: make api-check
# A deleted line is a breaking change. See docs/content/reference/compatibility.md.
# Each line's godoc is frozen too; api/v1-audit.txt records whether it was verified.
const BatchModeBestEffort BatchMode
const BatchModeTransactional BatchMode
const ChunkBoundaryLine ChunkBoundary
...
```

It holds functions, methods, struct fields, interface methods, and even **struct tags**, one per line. Struct tags are there for a reason: changing `json:"status"` leaves the Go signature alone but breaks code that reads the serialized output.

It matters to be precise about what this prevents. It does not prevent removals. A PR that changes the public API has to change this file in the same diff, and a removal shows up in front of the reviewer **as a deleted line**. What it prevents is breaking things without anyone noticing.

KVS's `pkg/kvs/testdata/api-surface.txt` plays the same role. A test renders the package's public surface from the Go AST and compares it with the golden file:

```text
# Exported API surface of this package - see website/content/docs/compatibility.md
# for how much of it v1 promises, and for the cluster plumbing it exempts by name.
# A line changed or removed below is a breaking change and needs a major version, unless the
# page exempts it. A line added is a new promise: it cannot be taken back within v1.
# Regenerate deliberately: go test ./pkg/kvs -run TestPublicAPISurface -update
```

The second-to-last line is the key: **adding a line is a new promise, too.** It cannot be taken back within v1.

KVS also has things that are exported but not promised. `Store`'s `SetReplicator`, `ReplaceWith`, and `ApplyReplicated` are exported only so `internal/cluster` can reach them across the package boundary, not for outside users. The compatibility page names these three methods as exemptions. The tool pins the surface; the docs draw the line of the promise within it.

## 4. Auditing Behavioral Descriptions in Godoc

API signatures can be compared by tools. Individual **documented behaviors**, such as match ordering, `FindSet` preserving first-match order, and `FindParallel` deduplicating, can also be tested. What is difficult is automatically extracting all compatibility conditions from natural-language docs and comparing their meaning across versions.

Alongside behavioral tests, ACOR checks that each API entry has an audit record. `api/v1-audit.txt` holds one verdict line for each entry in `v1.txt`:

| Verdict | Meaning |
|---|---|
| `ok` | Godoc matches the code |
| `fixed` | A mismatch was found and fixed |
| `risk` | There is a known risk |
| `unaudited` | Not checked yet (allowed, but counted and printed on every run) |

Any verdict other than `unaudited` must cite a `file:line` that actually exists as evidence. CI fails if an entry has no verdict, has two, or cites a line that does not exist.

Before freezing v1.5.0, all 180 entries were checked against the code, and **38** described something the code did not do. Those sentences were fixed before the freeze. So what v1 promises is the corrected wording, not what shipped in v1.4.0. Had they not been checked before the freeze, wrong sentences would have been promised until v2.

## 5. Managing Data-Format Compatibility

The library API is not the only thing under promise. Data left in Redis or on disk also outlives a version. The two projects took opposite strategies.

**ACOR: the Redis V2 format only grows.** Many instances share one dictionary, so during a rolling deploy two ACOR versions read and write the same keys. So during v1, changes to the V2 format are additive only:

- Key names, hash tags, and the names and meanings of existing fields do not change.
- New fields may be added to the `{name}:trie` hash or under a new key. Unknown fields are ignored.
- Nothing is added to the `{name}:outputs` hash. Its field names are automaton states, so there is no room for metadata.

With these rules, a mixed-version fleet works in both directions. The docs also list the costs: a `Flush` from an older instance drops fields a newer one added, and a feature that depends on a new field only takes effect after every instance is upgraded.

**KVS: the format is not promised; refusal is.** KVS's data directory has a `format` file, and KVS refuses to start on a version it does not recognize. The compatibility page says "that refusal is the promise; the contents are not." There is no guarantee that data written by one release can be read by another, and there is no conversion code. What is guaranteed is that unreadable data is never half-read. The [KVS durability post](/en/posts/2026/10/03/kvs-append-log-raft/) goes into detail.

Both strategies are honest. Additive-only fits ACOR, which does rolling deploys on shared storage. Loud refusal fits KVS, where each node has its own directory.

## 6. Runtime Compatibility of Configuration and APIs

DevCloud is not a library. Users don't import a Go package; they run a binary. So DevCloud's compatibility policy promises the surfaces users actually touch.

| Surface | Promised across 1.x |
|---|---|
| Config file keys | `server.port`, `services.<id>.enabled`, `admin.enabled`, and others. Can be added; never removed or repurposed |
| Environment variables | `DEVCLOUD_PORT`, `DEVCLOUD_SERVICES`, `DEVCLOUD_DATA_DIR`, including the precedence of environment over config |
| Admin API | Routes keep responding, and JSON responses **only gain fields** |
| Fidelity tier names | `hand-verified`, `auto-crud`, `unimplemented`. The set does not shrink, and no name is reused for a different meaning |
| Wire behavior | The properties asserted by tests in the compatibility suite. **Nothing wider** |

The last row is the most interesting. Instead of promising the entire AWS response, DevCloud promises exactly as much as each assertion in `test/compatibility/` checks. The docs illustrate this:

| Field | Asserted as | Promised |
|---|---|---|
| `FunctionName` | Equal to the name sent | Key and value |
| `FunctionArn` | Present | Presence only, not that it stays ARN-shaped |
| `Runtime`, `Handler` | Not asserted | Nothing, even though today's response includes them |

That narrowness is the point. The 1,530 tests run on every push and against the tagged commit before a release, so breaking an assertion fails the build rather than depending on review discipline. To widen the promise, add assertions.

What is not promised is spelled out too: `auto-crud` response content, `hand-verified` operations with no test, data durability, error codes and message wording, and everything under `internal/`.

DevCloud also defines a deprecation procedure. Deprecate in a minor release, where the old form keeps working and emits a warning naming its replacement. Remove no earlier than the next major. The precedent is the `dashboard` → `admin` config rename: the old key still enables the admin API, warns, and yields to an explicit `admin` block. The docs say "silence is not deprecation." Even a removed key is kept in the parser so it can warn instead of being silently dropped by YAML.

## The Three Projects Compared

| | ACOR | KVS | DevCloud |
|---|---|---|---|
| What is promised | Go library `pkg/acor` | Three wire protocols, CLI, `pkg/kvs` | Config, env vars, CLI, admin API, wire behavior |
| Surface pinning | `api/v1.txt` + `make api-check` | `testdata/api-surface.txt` + golden test | Config/admin API lists + `ServicePlugin` conformance test |
| Ghost versions | `retract [v1.0.0, v1.4.0]` + CI check | `retract [v0.1.0, v0.1.1]`, `retract v1.0.0` | None |
| Docs verification | Audit of 180 godoc entries, 38 fixed | Surface file + exemption list | Wire promise = suite assertions |
| Data format | V2 additive only | Not promised; unknown formats refused | Not promised |

## Wrapping Up

Before upgrading, check the compatibility exceptions and data-format conditions as well as the public API list. API snapshots expose changes; behavioral tests and audit records check the documentation. DevCloud's response guarantees also cover only properties asserted by its compatibility suite.
