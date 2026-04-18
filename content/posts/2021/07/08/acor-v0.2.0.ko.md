---
title: "ACOR v0.2.0 릴리즈: 표준 프로젝트 구조와 버그 수정"
date: 2021-07-08T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor) v0.2.0을 릴리즈했다. 이번 버전은 프로젝트 구조를 Go 표준으로 정리하고 몇 가지 버그를 수정하는 데 집중했다.

## 표준 프로젝트 구조로 변경

v0.2.0에서는 Go 커뮤니티의 표준 프로젝트 레이아웃을 따르도록 구조를 변경했다 ([#2](https://github.com/skyoo2003/acor/issues/2)). 

Go 프로젝트가 성장하면서 파일 구조를 체계적으로 관리할 필요가 있었다. [Standard Go Project Layout](https://github.com/golang-standards/project-layout) 가이드라인을 참고하여:

- `pkg/`: 외부에서 import 가능한 패키지 코드
- `internal/`: 내부 전용 코드
- `cmd/`: 메인 애플리케이션

이런 구조를 적용함으로써 프로젝트의 의도를 더 명확히 전달할 수 있게 되었다.

## 지원 Go 버전 변경

Go 버전 지원 정책을 업데이트했다 ([#5](https://github.com/skyoo2003/acor/issues/5)). 

Go는 6개월마다 새 버전을 릴리즈하며, 각 메이저 버전은 약 1년간 지원된다. 이에 맞춰 테스트 대상 Go 버전을 조정했다. 최신 Go 버전에서의 호환성을 보장하면서도, 구버전 지원 부담을 줄이는 방향으로 정책을 수립했다.

## 에러명 변경

`RedisAlreadyClosed` 에러의 이름을 일관성 있게 변경했다 ([#7](https://github.com/skyoo2003/acor/issues/7)).

Go의 관례에 따라 에러 변수명을 `Err` 접두사를 사용하도록 수정했다. 이는 Go 표준 라이브러리와 많은 서드파티 라이브러리가 따르는 패턴이다.

## NodeKey 출력 버그 수정

NodeKey 메서드에서 출력이 제대로 작성되지 않는 버그를 수정했다 ([#13](https://github.com/skyoo2003/acor/issues/13)).

이 버그는 특정 조건에서 NodeKey의 문자열 변환이 누락되어 발생했다. 디버깅 및 로깅 시 문제가 될 수 있었는데, 이번 릴리즈에서 해결되었다.

## 업그레이드 방법

기존 ACOR 사용자는 다음과 같이 업그레이드할 수 있다:

```bash
go get github.com/skyoo2003/acor@v0.2.0
```

Go modules를 사용 중이라면 `go.mod` 파일이 자동으로 업데이트된다.

## 마치며

v0.2.0은 기능적으로는 큰 변화가 없지만, 프로젝트 구조를 표준화하고 알찬 버그 수정을 포함한다. 이러한 개선은 향후 유지보수와 기여자 유입에 도움이 될 것이다.

더 자세한 내용은 [GitHub 릴리즈 노트](https://github.com/skyoo2003/acor/releases/tag/v0.2.0)와 [저장소](https://github.com/skyoo2003/acor)를 참고하자.
