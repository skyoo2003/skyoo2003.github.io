---
title: "ACOR v0.2.0 Release: Standard Project Structure and Bug Fixes"
date: 2021-07-08T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

## Introduction

I've released [ACOR](https://github.com/skyoo2003/acor) v0.2.0. This version focuses on restructuring the project to follow Go standards and fixing a few bugs.

## Standard Project Structure

v0.2.0 restructures the project to follow the standard Go project layout ([#2](https://github.com/skyoo2003/acor/issues/2)).

As the project grew, managing the file structure systematically became necessary. Following the [Standard Go Project Layout](https://github.com/golang-standards/project-layout) guidelines:

- `pkg/`: Package code importable by external projects
- `internal/`: Private application code
- `cmd/`: Main applications

This structure makes the project's intent clearer and more maintainable.

## Go Version Support Changes

I updated the Go version support policy ([#5](https://github.com/skyoo2003/acor/issues/5)).

Go releases a new version every 6 months, with each major version supported for about a year. I adjusted the tested Go versions accordingly, ensuring compatibility with the latest Go versions while reducing the burden of supporting older versions.

## Error Name Change

Changed the `RedisAlreadyClosed` error name for consistency ([#7](https://github.com/skyoo2003/acor/issues/7)).

Following Go conventions, I updated error variable names to use the `Err` prefix. This matches the pattern used by the Go standard library and many third-party libraries.

## NodeKey Output Bug Fix

Fixed a bug where NodeKey output wasn't being written correctly ([#13](https://github.com/skyoo2003/acor/issues/13)).

The bug caused string conversion to be missing under certain conditions, which could cause issues during debugging and logging. This has been resolved in this release.

## How to Upgrade

Existing ACOR users can upgrade with:

```bash
go get github.com/skyoo2003/acor@v0.2.0
```

If you're using Go modules, the `go.mod` file will be updated automatically.

## Conclusion

While v0.2.0 doesn't bring major functional changes, it standardizes the project structure and includes meaningful bug fixes. These improvements will help with future maintenance and contributor onboarding.

For more details, see the [GitHub release notes](https://github.com/skyoo2003/acor/releases/tag/v0.2.0) and the [repository](https://github.com/skyoo2003/acor).
