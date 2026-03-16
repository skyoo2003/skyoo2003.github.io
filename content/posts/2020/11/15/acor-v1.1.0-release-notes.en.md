---
title: "ACOR v1.1.0 Release: Migration to Go Modules and GitHub Actions"
date: 2020-11-15T00:00:00+09:00
tags: [go, redis, algorithm, aho-corasick, go-modules, github-actions]
---

## Introduction

I've released [ACOR](https://github.com/skyoo2003/acor) v1.1.0. This version focuses on modernizing the project foundation rather than adding new features. Following the evolution of the Go ecosystem, I migrated the dependency management and CI/CD systems to current standards.

## Why Go Modules

ACOR initially used [Glide](https://github.com/Masterminds/glide) for dependency management. Glide was widely used in the community during the era when Go lacked an official dependency management tool. However, things changed when [Go modules](https://blog.golang.org/using-go-modules) were officially introduced in Go 1.11.

The limitations of Glide became clear:

1. **Maintenance discontinued**: Glide is no longer actively developed
2. **Version management**: Pinning exact versions and managing dependency trees is cumbersome
3. **Reproducibility**: Guaranteeing identical builds across different environments is difficult

Go modules solves these problems. A single `go.mod` file manages dependencies, and versioning is controlled based on Semantic Versioning. Best of all, it's built into the Go toolchain, requiring no separate installation.

## The Migration Journey

Migrating from Glide to Go modules was simpler than expected.

First, I removed the existing `glide.yaml` and `glide.lock` files, then ran the following commands in the project root:

```bash
go mod init github.com/skyoo2003/acor
go mod tidy
```

`go mod init` creates the `go.mod` file, and `go mod tidy` adds only the dependencies actually in use.

During this process, I also upgraded the [go-redis/redis](https://github.com/go-redis/redis) package to the latest version. The upgrade from v6 to v8 included API changes that required some code modifications. Notably, context support was added, so most methods now accept context as the first argument.

Unit tests were updated as well. Fortunately, the test coverage was decent, allowing the migration to complete without major issues.

## What Else Changed

### From Travis CI to GitHub Actions

While changing the dependency management tool, I also reviewed the CI/CD system. Travis CI, which I had been using, is still an excellent tool, but GitHub Actions offered significant advantages:

1. **GitHub integration**: Manage workflows directly from repository settings
2. **Simplified configuration**: Just add a YAML file to the `.github/workflows/` directory
3. **Speed**: Runs on GitHub infrastructure, making it fast

The GitHub Actions workflow is simple:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-go@v2
        with:
          go-version: '1.15'
      - run: go test -v ./...
```

The Travis CI configuration file (`.travis.yml`) was removed as it's no longer needed.

## How to Upgrade

Existing ACOR users can upgrade with:

```bash
go get github.com/skyoo2003/acor@v1.1.0
```

If you're using Go modules, the `go.mod` file will be updated automatically.

## Conclusion

While v1.1.0 doesn't bring major functional changes, it's an important update for the project's sustainability. Using modern tools and standards will make future maintenance easier.

For more details, see the [GitHub release notes](https://github.com/skyoo2003/acor/releases/tag/v1.1.0) and the [repository](https://github.com/skyoo2003/acor).
