---
title: "ACOR v0.1.0 릴리즈: Go modules와 GitHub Actions로의 전환"
description: "ACOR v0.1.0에서 Glide를 Go modules로, Travis CI를 GitHub Actions로 옮긴 과정과 업그레이드 방법을 정리한다."
date: 2020-11-15T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

오랜만에 [ACOR](https://github.com/skyoo2003/acor)를 다시 손보게 되었다. 2017년에 처음 공개한 이후로 거의 그대로 두었더니, 그 사이에 Go 생태계가 많이 바뀌어서 빌드 환경부터 손을 봐야 하는 상황이었다. 때문에 이번 v0.1.0은 기능 추가보다는 의존성 관리와 CI 환경을 정리하는 데 집중했다.

## Glide에서 Go modules로

처음 ACOR를 만들 때는 Go에 공식 의존성 관리 도구가 없어서 [Glide](https://github.com/Masterminds/glide)를 사용했고, 의존성은 `vendor/` 디렉토리에 통째로 커밋해 두었다. 그런데 Go 1.11부터 [Go modules](https://blog.golang.org/using-go-modules)가 도입되었고, Glide는 더 이상 관리되지 않는 상태가 되었다. 굳이 Glide를 유지할 이유가 없어서 Go modules로 옮기기로 했다.

전환 자체는 생각보다 간단했다. `glide.yaml`, `glide.lock`과 `vendor/` 디렉토리를 지우고, 프로젝트 루트에서 아래의 명령을 실행하면 된다.

```bash
$ go mod init github.com/skyoo2003/acor
$ go mod tidy
```

`go mod init`은 `go.mod` 파일을 생성하고, `go mod tidy`는 코드에서 실제로 사용하는 의존성을 찾아서 `go.mod`와 `go.sum`에 정리해준다. vendor 디렉토리에 들어 있던 파일들이 빠지면서 커밋 하나에 2만 줄 넘게 삭제되었다. (그동안 저 코드들을 저장소에 들고 있었다니...)

## go-redis v6에서 v8로

이 김에 [go-redis/redis](https://github.com/go-redis/redis)도 v6에서 v8로 올렸다. v8부터는 대부분의 명령 메서드가 첫 번째 인자로 `context.Context`를 받도록 바뀌었기 때문에, ACOR 내부의 Redis 호출 부분을 전부 수정해야 했다.

```go
// v6
ac.redisClient.ZScore(pKey, outState)

// v8
ac.redisClient.ZScore(ac.ctx, pKey, outState)
```

그리고, 단위 테스트가 로컬에 떠 있는 Redis에 의존하던 부분도 [miniredis](https://github.com/alicebob/miniredis)를 사용하도록 바꿨다. miniredis는 Go 코드 안에서 띄우는 Redis 호환 테스트 서버라서, 이제 Redis를 따로 실행하지 않아도 `go test`만으로 테스트를 돌릴 수 있다.

## Travis CI에서 GitHub Actions로

빌드 환경을 손보는 김에 CI도 Travis CI에서 GitHub Actions로 옮겼다. 저장소 안의 `.github/workflows/`에 YAML 파일 하나만 추가하면 되고, 결과도 GitHub 화면에서 바로 확인할 수 있어서 편했다. 아래가 이번에 추가한 워크플로우인데, 지원하는 Go 버전마다 lint와 테스트를 수행하도록 했다.

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

기존의 `.travis.yml` 파일은 제거했다.

## 업그레이드 방법

Go modules를 지원하게 되면서 최소 Go 버전은 1.11로 올라갔다. 기존 사용자는 아래와 같이 업그레이드할 수 있다.

```bash
$ go get github.com/skyoo2003/acor@v0.1.0
```

메서드 시그니처는 그대로라서 대부분은 코드를 수정할 필요가 없다. 다만, `Add()`의 반환값이 "추가 후 전체 키워드 수"에서 "이번에 새로 추가된 키워드 수(0 또는 1)"로 바뀌었으니, 반환값을 사용하고 있었다면 확인이 필요하다.

## 정리

기능적으로 달라진 점은 거의 없지만, 앞으로 계속 손을 대려면 먼저 정리해야 했던 부분들이다. 다음 릴리즈부터는 프로젝트 구조나 코드 쪽도 조금씩 개선해 나갈 생각이다.

자세한 내용은 [GitHub 릴리즈 노트](https://github.com/skyoo2003/acor/releases/tag/v0.1.0)와 [저장소](https://github.com/skyoo2003/acor)를 참고하자.
