---
title: "ACOR v0.1.0 Release: Migration to Go Modules and GitHub Actions"
description: "How ACOR v0.1.0 moved from Glide to Go modules and from Travis CI to GitHub Actions, plus upgrade instructions."
date: 2020-11-15T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

I finally got back to [ACOR](https://github.com/skyoo2003/acor) after a long while. I'd left it mostly untouched since first publishing it in 2017, and the Go ecosystem had changed so much in the meantime that the build setup needed work first. So v0.1.0 focuses on cleaning up dependency management and CI rather than adding features.

## From Glide to Go modules

When I first built ACOR, Go had no official dependency manager, so I used [Glide](https://github.com/Masterminds/glide) and committed the dependencies wholesale into a `vendor/` directory. Since then Go 1.11 introduced [Go modules](https://blog.golang.org/using-go-modules), and Glide is no longer maintained. There was no reason to keep Glide, so I moved to Go modules.

The switch itself was simpler than I expected. Delete `glide.yaml`, `glide.lock`, and the `vendor/` directory, then run the following in the project root.

```bash
$ go mod init github.com/skyoo2003/acor
$ go mod tidy
```

`go mod init` creates the `go.mod` file, and `go mod tidy` finds the dependencies the code actually uses and records them in `go.mod` and `go.sum`. Dropping the vendor directory deleted more than 20,000 lines in one commit. (I can't believe I'd been carrying all that code in the repository...)

## go-redis v6 to v8

While I was at it, I also moved [go-redis/redis](https://github.com/go-redis/redis) from v6 to v8. From v8, most command methods take a `context.Context` as their first argument, so every Redis call inside ACOR had to change.

```go
// v6
ac.redisClient.ZScore(pKey, outState)

// v8
ac.redisClient.ZScore(ac.ctx, pKey, outState)
```

I also changed the unit tests, which depended on a locally running Redis, to use [miniredis](https://github.com/alicebob/miniredis). miniredis is a Redis-compatible test server started from Go code, so the tests now run with just `go test`, without starting Redis separately.

## From Travis CI to GitHub Actions

Since I was already fixing the build, I moved CI from Travis CI to GitHub Actions too. All it takes is one YAML file under `.github/workflows/` in the repository, and the results show up right in the GitHub UI, which is handy. This is the workflow I added; it runs lint and tests on each supported Go version.

```yaml
name: Go

on:
  push:
    branches: [ master ]
  pull_request:
    branches: [ master ]

jobs:
  build:
    name: CI
    runs-on: ubuntu-latest
    strategy:
      matrix:
        go-version: [1.11, 1.12, 1.13, 1.14, 1.15]
    steps:
    - uses: actions/checkout@v2
    - name: Set up Go ${{ matrix.go-version }}
      uses: actions/setup-go@v2
      with:
        go-version: ${{ matrix.go-version }}
    - name: Install golint tool
      run: go get -u golang.org/x/lint/golint
    - name: Lint
      run: golint ./...
    - name: Test
      run: go test -v ./...
```

The old `.travis.yml` file was removed.

## Upgrading

With Go modules support, the minimum Go version is now 1.11. Existing users can upgrade like this.

```bash
$ go get github.com/skyoo2003/acor@v0.1.0
```

Method signatures are unchanged, so most code needs no changes. However, the return value of `Add()` changed from "total keyword count after adding" to "number of keywords newly added this call (0 or 1)", so check it if you were using that value.

## Wrapping Up

Not much changed functionally, but these were things I had to clean up before I could keep working on it. From the next release I plan to gradually improve the project structure and the code itself.

See the [GitHub release notes](https://github.com/skyoo2003/acor/releases/tag/v0.1.0) and the [repository](https://github.com/skyoo2003/acor) for details.
