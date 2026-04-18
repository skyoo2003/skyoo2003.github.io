---
title: "ACOR v0.1.0 릴리즈: Go modules와 GitHub Actions로의 전환"
date: 2020-11-15T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor) v0.1.0을 릴리즈했다. 이번 버전은 새로운 기능 추가보다는 프로젝트의 기반을 현대화하는 데 집중했다. Go 생태계의 변화에 맞춰 의존성 관리와 CI/CD 시스템을 최신 표준으로 전환했다.

## 왜 Go modules로 전환했는가

ACOR은 처음 [Glide](https://github.com/Masterminds/glide)를 사용해 의존성을 관리했다. Glide는 Go에 공식 의존성 관리 도구가 없던 시절, 커뮤니티에서 널리 사용되던 도구였다. 하지만 Go 1.11부터 [Go modules](https://blog.golang.org/using-go-modules)가 공식으로 도입되면서 상황이 바뀌었다.

Glide의 한계는 명확했다:

1. **유지보수 중단**: Glide는 더 이상 활발히 개발되지 않는다
2. **버전 관리**: 정확한 버전 고정과 의존성 트리 관리가 번거롭다
3. **재현성**: 다른 환경에서 동일한 빌드를 보장하기 어렵다

Go modules는 이 문제들을 해결한다. `go.mod` 파일 하나로 의존성을 관리하고, Semantic Versioning을 기반으로 버전을 제어한다. 무엇보다 Go 도구 체인에 내장되어 있어 별도 설치가 필요 없다.

## 마이그레이션 여정

Glide에서 Go modules로 전환하는 과정은 생각보다 간단했다.

먼저 기존 `glide.yaml`과 `glide.lock` 파일을 삭제하고, 프로젝트 루트에서 다음 명령을 실행했다:

```bash
go mod init github.com/skyoo2003/acor
go mod tidy
```

`go mod init`은 `go.mod` 파일을 생성하고, `go mod tidy`는 실제 사용 중인 의존성만 추가한다.

이 과정에서 [go-redis/redis](https://github.com/go-redis/redis) 패키지도 최신 버전으로 업그레이드했다. v6에서 v8로의 업그레이드였는데, API 변경사항이 있어 일부 코드 수정이 필요했다. 특히 컨텍스트(Context) 지원이 추가되어 대부분의 메서드가 컨텍스트를 첫 번째 인자로 받도록 변경되었다.

단위 테스트도 함께 수정했다. 다행히 테스트 커버리지가 괜찮아 큰 문제 없이 전환을 완료할 수 있었다.

## 함께 바뀐 것들

### Travis CI에서 GitHub Actions로

의존성 관리 도구를 바꾸면서 CI/CD 시스템도 점검하게 되었다. 기존에 사용하던 Travis CI는 여전히 훌륭한 도구지만, GitHub Actions가 제공하는 장점이 컸다:

1. **GitHub 통합**: 저장소 설정에서 바로 워크플로우를 관리할 수 있다
2. **설정 간소화**: `.github/workflows/` 디렉토리에 YAML 파일만 추가하면 된다
3. **속도**: GitHub 인프라에서 실행되어 빠르다

GitHub Actions 워크플로우는 다음과 같이 간단하다:

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

Travis CI 설정 파일(`.travis.yml`)은 더 이상 필요 없어 제거했다.

## 업그레이드 방법

기존 ACOR 사용자는 다음과 같이 업그레이드할 수 있다:

```bash
go get github.com/skyoo2003/acor@v0.1.0
```

Go modules를 사용 중이라면 `go.mod` 파일이 자동으로 업데이트된다.

## 마치며

v0.1.0은 기능적으로는 큰 변화가 없지만, 프로젝트의 지속 가능성을 위해 중요한 업데이트다. 최신 도구와 표준을 사용함으로써 향후 유지보수가 더 쉬워질 것이다.

더 자세한 내용은 [GitHub 릴리즈 노트](https://github.com/skyoo2003/acor/releases/tag/v0.1.0)와 [저장소](https://github.com/skyoo2003/acor)를 참고하자.
