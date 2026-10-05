---
title: "ACOR v0.2.0 Release: Standard Project Structure and Bug Fixes"
description: "ACOR v0.2.0 adopts the standard Go project layout, updates supported Go versions and error names, fixes a NodeKey output bug, and explains how to upgrade."
date: 2021-07-08T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

I released [ACOR](https://github.com/skyoo2003/acor) v0.2.0. Again, rather than new features, this release focuses on tidying up the project structure and fixing bugs found along the way. Here's a quick rundown.

## Standard project structure ([#2](https://github.com/skyoo2003/acor/issues/2))

Until now it was a simple layout with a single `acor.go` file at the repository root. This time I split the directories as below, following the [Standard Go Project Layout](https://github.com/golang-standards/project-layout).

- `pkg/acor/` : Library code imported from outside
- `internal/pkg/utils/` : Utility code used only internally
- `cmd/acor/` : Executable entry point (just an empty shell for now)

**Note that the import path changed from `github.com/skyoo2003/acor` to `github.com/skyoo2003/acor/pkg/acor`.** If you upgrade existing code, you'll need to update the import.

While restructuring, I also added release and build tooling: GoReleaser for releases, changie for the CHANGELOG, plus a Makefile, a Dockerfile, and a golangci-lint configuration.

## Supported Go versions ([#5](https://github.com/skyoo2003/acor/issues/5))

Go officially supports only the two most recent major versions. So I decided there was no need to keep testing very old versions in CI, dropped Go 1.11 and 1.12 from the test targets, and added 1.16. CI now runs on Go 1.13 through 1.16.

## Error name change ([#7](https://github.com/skyoo2003/acor/issues/7))

Introducing golangci-lint meant cleaning up lint errors, and one of them was an error variable name. In Go it's conventional to prefix error variables with `Err`, so `RedisAlreadyClosed` became `ErrRedisAlreadyClosed`. If you compare against this error directly, update that too.

## NodeKey output bug fix ([#13](https://github.com/skyoo2003/acor/issues/13))

For each keyword, ACOR stores in the `{keyword}:node` key the list of "states that have this keyword as output", and when a keyword is removed it uses that list to remove the keyword from each state's output. But when `_buildOutput` saved that list, it built the key with the `OutputKey` format instead of `NodeKey`.

```go
// AS-IS
nKey := fmt.Sprintf(OutputKey, output)

// TO-BE
nKey := fmt.Sprintf(NodeKey, output)
```

In other words, nothing was ever written to `{keyword}:node`, and states were piling up in the wrong `{keyword}:output` key instead. Calling `Remove()` in that state couldn't find the states to clean up, so a removed keyword could stay in other states' output. This bug had been there since the first release and I only just found it...

## Upgrading

```bash
$ go get github.com/skyoo2003/acor@v0.2.0
```

As mentioned above, the import path changed, so update it like this.

```go
import "github.com/skyoo2003/acor/pkg/acor"
```

## Wrapping Up

With the structure cleaned up, adding features should be a lot easier from here. I plan to fill the `cmd/acor` I added this time with a CLI that's actually usable in the next version.

See the [GitHub release notes](https://github.com/skyoo2003/acor/releases/tag/v0.2.0) and the [repository](https://github.com/skyoo2003/acor) for details.
