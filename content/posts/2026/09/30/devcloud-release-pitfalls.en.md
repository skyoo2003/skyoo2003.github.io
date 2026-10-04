---
title: "Tests Passed, Binary Was Dead: A DevCloud Release Post-Mortem"
date: 2026-09-30T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, release-engineering, security]
---

## Introduction

Updated on 2026-10-05. The implementation described here is main at [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c), after v1.2.0.

[DevCloud](https://github.com/skyoo2003/devcloud) runs its boto3 compatibility suite before it ships a binary; at v1.0.0 that suite had 775 tests. Yet on the way to v1.0.0, binaries that passed this gate **died on startup** twice. The causes were different, but the root was the same: the binary the gate tested was not the binary users downloaded.

This post is a post-mortem of those two incidents, plus a security flaw fixed a month later in v1.1.1. In all three cases the fix itself was a few lines. What took time was understanding why no check had caught the problem.

## Incident 1: CGO_ENABLED=0 and a cgo-only Driver

### Symptom

DevCloud stores service state in SQLite. The GoReleaser config builds with `CGO_ENABLED=0` for cross-compilation. The store used `mattn/go-sqlite3`, a driver that does not work without cgo.

The catch is that this combination **compiles**. The driver ships a stub for cgo-disabled builds, and the stub fails at runtime. So every tagged binary from v0.2.0 on exited at startup with this message:

```
init s3: enable WAL: Binary was compiled with 'CGO_ENABLED=0',
go-sqlite3 requires cgo to work. This is a stub
```

The tar.gz/zip archives and the Homebrew formula were all dead on arrival. Only the container image worked, because its Dockerfile installed `sqlite-dev` and built with `CGO_ENABLED=1`. Most tests passed for the same reason: CI ran with cgo enabled.

### Fix

The driver was replaced with `modernc.org/sqlite`, a Go translation of SQLite's C code that needs no C toolchain per target platform. Fortunately, the API differences were small. The `NUMTEXT` collation used for DynamoDB sort keys matched the `func(left, right string) int` signature that `RegisterCollationUtf8` takes, so it ported as-is. The package's public API did not change, so none of its 108 importers had to move. The on-disk format is still SQLite's, so existing data directories still open.

There was a cost. The compatibility suite got about 15% slower, from 55 to 63 seconds. That is the expected cost of C translated to Go.

### Swapping Drivers Swaps Defaults

Right after the swap, one more thing had to be fixed. `mattn/go-sqlite3` sets `PRAGMA busy_timeout` to 5000 ms on every connection, even when the DSN says nothing. DevCloud passed a bare path, so switching to `modernc.org/sqlite` removed that 5-second wait. Drivers behind the same interface did not share this default.

The current code appends `?_pragma=busy_timeout(5000)` to the DSN. Using the driver's DSN configuration applies the setting to each new connection in the pool. The supported options are listed in the [documentation for the driver version used here](https://pkg.go.dev/modernc.org/sqlite@v1.59.0#Driver.Open).

### Testing the Build Mode You Ship

The more important change was in CI, not the driver. Every build and test now runs at `CGO_ENABLED=0`, the shipping mode. Everything else went: the `libsqlite3-dev` installed by six workflows, the `gcc/musl-dev/sqlite-dev` installed by two Dockerfiles, `sqlite-libs` in the runtime image, and the troubleshooting doc that told users to install headers.

A sentence from the commit message sums up the incident:

> Testing CGO_ENABLED=1 while shipping CGO_ENABLED=0 is how a binary that cannot open its own database passed every gate for two releases.

## Incident 2: GoReleaser Built a Single File

### Symptom

Two days after the driver fix, v1.0.0 was published, and the published binary again died on startup. This time the message was:

```
unknown service: s3
```

DevCloud's services register themselves in the registry through blank imports in `cmd/devcloud/imports.go`. But `.goreleaser.yaml` was building **a single file**, not the package:

```yaml
builds:
- id: devcloud
  binary: devcloud
  main: cmd/devcloud/main.go
```

When you name a file, as in `go build cmd/devcloud/main.go`, Go compiles only that file. `imports.go` in the same directory is left out. `main.go` references no symbol from `imports.go`, so the compile succeeds. The result is a binary with no services registered. In v1.0.0, six archives, a Homebrew formula, and four container tags went out with that binary.

### Why Did the Gate Pass?

The release workflow had a step meant to prevent exactly this. It even had a comment:

```yaml
- name: Build devcloud binary
  # Same build configuration as .goreleaser.yaml, so the 775 tests below
  # exercise the artifact this tag is about to publish.
  run: CGO_ENABLED=0 go build -o dist/devcloud ./cmd/devcloud
```

The comment claimed the same configuration as GoReleaser, but the only thing that actually matched was `CGO_ENABLED`. The gate built the **package**, so `imports.go` was included, and the 775 tests passed against a healthy binary. The binary users received was never tested.

### Fix

Two places were changed. GoReleaser now builds the package with `main: ./cmd/devcloud`, and the gate builds with GoReleaser itself:

```yaml
- name: Build devcloud binary with GoReleaser
  uses: goreleaser/goreleaser-action@<pinned-sha>  # goreleaser-action v7
  with:
    distribution: goreleaser
    version: "~> v2"
    args: build --single-target --snapshot --clean --id devcloud --output dist/devcloud
```

What the gate compiles and what ships now come from the same tool with the same config. The key is running the same tool, instead of writing down that the config is the same. The v1.0.0 tag was re-created on the fix commit and released again.

## Common Cause: The Gate Verified Something Else

The two incidents had different code causes but the same structure:

```
             What the gate verified             What users received
Incident 1   CGO_ENABLED=1 binary         ≠    CGO_ENABLED=0 binary
Incident 2   go build ./cmd/devcloud      ≠    GoReleaser single file main.go
```

In both cases there was a belief that the gate and the release used the same configuration. In incident 2, that belief was even written down as a comment. Comments are not checked. Making both run the same command is more reliable than writing down that their configs match.

## Incident 3: An S3 Key That Leaves Its Bucket

This one is not a release problem, but it belongs to the same family, "the check guarded the wrong thing," and it was fixed in v1.1.1.

DevCloud's S3 stores objects as files under `baseDir/<account>/<bucket>/<key>`. Path traversal was blocked, of course: the joined path was checked to be under `baseDir`.

But a key like `../victim/secret.txt` **leaves its own bucket while staying inside `baseDir`.** The joined result is `baseDir/<account>/victim/secret.txt`, which passes the check. An attacker could read, overwrite, and delete objects in other buckets and other accounts. Even for a local emulator, this is a real problem when several teams share one instance.

The fix started with a reproducer test (RED). `filepath.IsLocal` is now applied to every user-controlled path component:

```go
// objectPath returns the absolute filesystem path for the given object.
// Unlike safePath, the key may contain '/' (e.g. "photos/a.jpg") which is
// valid for S3 object keys. Containment under the bucket is still enforced.
func (fs *FileStore) objectPath(accountID, bucket, key string) (string, error) {
	// ...
	// The key gets IsLocal rather than validPathComponent because '/' is legal
	// in it. Checking the joined path against baseDir alone is not enough: a key
	// like "../victim/secret" leaves its own bucket while staying under baseDir.
	if !filepath.IsLocal(key) {
		return "", fmt.Errorf("invalid path component: %q", key)
	}
	// ...
}
```

`filepath.IsLocal`, added in Go 1.20, rejects the empty string, `..`, `../x`, and absolute paths. It is shorter than a hand-written `Clean` + `HasPrefix` combination, and CodeQL recognizes it as a barrier for `go/path-injection`. The same fix was applied to the Lambda code path and the S3 bucket directory, with tests.

`IsLocal` checks the path string lexically. It does not follow filesystem symlinks, so access through symlinks needs separate consideration. The scope is described in the [Go documentation](https://pkg.go.dev/path/filepath#IsLocal).

The lesson is the same as incidents 1 and 2. The check existed. But the boundary it needed to guard was the **tenant (bucket)**, not `baseDir`.

## Checklist

These are the release rules I follow after the three incidents:

1. **Test in the build mode you ship.** Flags like `CGO_ENABLED`, build tags, and `-trimpath` must match the release.
2. **Build the gate with the release tool.** Instead of a comment saying "same config," run GoReleaser `build --snapshot` as is.
3. **Check that the binary starts first.** Before the 775 tests, running `devcloud` and calling one service must succeed.
4. **When swapping a driver, compare defaults.** Even with the same interface, hidden defaults like timeouts, pragmas, and pool sizes can differ.
5. **Put path checks on the narrowest boundary.** Check per tenant, not per root directory.

## Conclusion

Release checks now build the package without CGO and run smoke tests against that artifact. SQLite waiting time is explicit in the DSN. S3 paths are checked for bucket containment; filesystem symlinks, which `IsLocal` does not inspect, still need consideration in the deployment environment.

The full source code is available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
