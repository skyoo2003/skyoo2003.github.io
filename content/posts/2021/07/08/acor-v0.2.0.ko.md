---
title: "ACOR v0.2.0 릴리즈: 표준 프로젝트 구조와 버그 수정"
description: "ACOR v0.2.0의 Go 표준 프로젝트 구조 전환, 지원 Go 버전과 에러 이름 변경, NodeKey 출력 버그 수정과 업그레이드 방법을 정리한다."
date: 2021-07-08T00:00:00+09:00
tags: [go, redis, acor, release-notes]
---

[ACOR](https://github.com/skyoo2003/acor) v0.2.0을 릴리즈했다. 이번에도 새로운 기능보다는 프로젝트 구조를 정리하고, 그 과정에서 발견한 버그를 수정하는 데 집중했다. 변경 사항을 간략하게 정리해보자.

## 표준 프로젝트 구조로 변경 ([#2](https://github.com/skyoo2003/acor/issues/2))

지금까지는 저장소 루트에 `acor.go` 파일 하나가 있는 단순한 구조였다. 이번에 [Standard Go Project Layout](https://github.com/golang-standards/project-layout)을 참고해서 아래와 같이 디렉토리를 나눴다.

- `pkg/acor/` : 외부에서 import 하는 라이브러리 코드
- `internal/pkg/utils/` : 내부에서만 사용하는 유틸 코드
- `cmd/acor/` : 실행 파일 진입점 (아직은 빈 껍데기다)

**import 경로가 `github.com/skyoo2003/acor`에서 `github.com/skyoo2003/acor/pkg/acor`로 바뀌었다는 점에 주의가 필요하다.** 기존 코드를 업그레이드한다면 import 구문을 수정해야 한다.

그리고, 구조를 바꾸는 김에 릴리즈와 빌드 관련 도구들도 같이 추가했다. GoReleaser로 릴리즈를 만들고, changie로 CHANGELOG를 관리하고, Makefile, Dockerfile, golangci-lint 설정도 들어갔다.

## 지원 Go 버전 변경 ([#5](https://github.com/skyoo2003/acor/issues/5))

Go는 최근 두 개의 메이저 버전만 공식적으로 지원한다. 때문에 너무 오래된 버전까지 CI에서 테스트할 필요는 없다고 판단했고, 테스트 대상에서 Go 1.11, 1.12를 제외하고 1.16을 추가했다. 이제 CI는 Go 1.13 ~ 1.16에서 수행된다.

## 에러 이름 변경 ([#7](https://github.com/skyoo2003/acor/issues/7))

golangci-lint를 도입하면서 lint 에러들을 정리했는데, 그 중 하나가 에러 변수의 이름이었다. Go에서는 에러 변수 이름에 `Err` 접두사를 붙이는 것이 관례라서, `RedisAlreadyClosed`를 `ErrRedisAlreadyClosed`로 변경했다. 이 에러를 직접 비교하고 있었다면 함께 수정해야 한다.

## NodeKey 출력 버그 수정 ([#13](https://github.com/skyoo2003/acor/issues/13))

ACOR는 키워드마다 `{keyword}:node` 키에 "이 키워드를 output으로 가지고 있는 상태" 목록을 저장해 두고, 키워드를 삭제할 때 이 목록을 보고 각 상태의 output에서 키워드를 지운다. 그런데 output을 계산하는 `_buildOutput`에서 이 목록을 저장할 때 `NodeKey`가 아니라 `OutputKey` 형식으로 키를 만들고 있었다.

```go
// AS-IS
nKey := fmt.Sprintf(OutputKey, output)

// TO-BE
nKey := fmt.Sprintf(NodeKey, output)
```

즉, `{keyword}:node`에는 아무것도 기록되지 않고 엉뚱한 `{keyword}:output`에 상태가 쌓이고 있었던 것이다. 이 상태에서 `Remove()`를 호출하면 지워야 할 상태 목록을 찾지 못하기 때문에, 삭제한 키워드가 다른 상태의 output에 그대로 남아 있을 수 있었다. 처음 공개했을 때부터 있던 버그였는데 이번에야 발견했다...

## 업그레이드 방법

```bash
$ go get github.com/skyoo2003/acor@v0.2.0
```

앞에서 이야기한 것처럼 import 경로가 바뀌었으니 아래와 같이 수정해야 한다.

```go
import "github.com/skyoo2003/acor/pkg/acor"
```

## 정리

구조를 정리하고 나니 앞으로 기능을 추가하기가 한결 수월해진 것 같다. 이번에 넣어둔 `cmd/acor`도 다음 버전에서는 실제로 쓸 수 있는 CLI로 채워볼 생각이다.

자세한 내용은 [GitHub 릴리즈 노트](https://github.com/skyoo2003/acor/releases/tag/v0.2.0)와 [저장소](https://github.com/skyoo2003/acor)를 참고하자.
