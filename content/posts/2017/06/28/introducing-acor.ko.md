---
title: "ACOR 소개: Redis 기반 Aho-Corasick 구현"
description: "여러 키워드를 한 번에 찾는 Aho-Corasick 알고리즘의 트라이와 실패 함수 원리, Redis를 저장소로 쓰는 Go 구현체 ACOR의 설계와 사용법을 소개한다."
date: 2017-06-28T16:39:49+09:00
tags: [go, redis, acor, tutorial]
---

문자열 안에서 키워드 하나를 찾는 건 어렵지 않다. 그런데 찾아야 할 키워드가 수백, 수천 개라면 이야기가 달라진다. 키워드마다 텍스트를 한 번씩 훑는다면 키워드가 늘어날수록 검색 시간도 같이 늘어나게 된다.

이런 경우에 주로 사용하는 것이 [Aho-Corasick 알고리즘](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm)이다. 1975년 Alfred V. Aho와 Margaret J. Corasick이 [논문](http://dl.acm.org/citation.cfm?id=360855)으로 발표한 알고리즘으로, 키워드가 몇 개이든 텍스트를 한 번만 순회하면서 모든 키워드를 찾아낸다.

이번에 이 알고리즘을 Go 로 구현하면서, 트라이를 메모리가 아닌 Redis 에 저장하도록 만든 [ACOR (Aho-Corasick automation On Redis)](https://github.com/skyoo2003/acor) 라는 라이브러리를 공개했다. 아이디어는 [judou/redis-ac-keywords](https://github.com/judou/redis-ac-keywords) 프로젝트를 참고했다. 이번 글에서는 알고리즘의 기본 개념을 간략하게 정리하고, ACOR 가 Redis 에 데이터를 어떻게 저장하는지와 사용법을 소개하고자 한다.

## Aho-Corasick 알고리즘 간략하게 알아보기

Aho-Corasick 알고리즘은 크게 세 가지 요소로 구성된다.

1. **Goto (트라이)** : 등록한 키워드들로 만든 트라이. 현재 상태에서 다음 문자로 이동할 수 있는지를 판단한다.
2. **Failure (실패 함수)** : 다음 문자로 이동할 수 없을 때 돌아갈 상태를 정의한다.
3. **Output (출력 함수)** : 어떤 상태에 도달했을 때 매칭된 키워드 목록을 정의한다.

텍스트를 앞에서부터 한 글자씩 읽으면서 Goto 로 이동하고, 이동할 수 없으면 Failure 를 따라 돌아간 뒤에 다시 이동을 시도한다. 그리고 상태마다 Output 을 확인하면 매칭된 키워드를 모두 얻을 수 있다. 텍스트 길이를 n, 키워드 길이의 합을 m, 매칭 횟수를 z 라고 하면 시간 복잡도는 O(n + m + z) 이다.

예를 들어, "he", "his", "she" 를 등록하면 아래와 같은 트라이가 만들어진다.

```
root
├── h
│   ├── e (output: "he")
│   └── i
│       └── s (output: "his")
└── s
    └── h
        └── e (output: "she", "he")
```

"she" 상태의 output 에 "he" 가 같이 들어 있는 것을 볼 수 있다. "she" 의 접미사인 "he" 도 키워드이기 때문이다. 실패 함수도 비슷한 원리로, "his" 상태에서 더 이상 이동할 수 없다면 "his" 의 접미사 중에 트라이에 존재하는 가장 긴 상태인 "s" 로 돌아가게 된다. 이렇게 하면 텍스트를 되돌아가서 다시 읽을 필요가 없다.

## ACOR 는 Redis 에 무엇을 저장하는가

ACOR 는 트라이의 상태를 별도의 노드 객체로 만들지 않고 **루트부터 해당 상태까지의 문자열** 로 표현한다. "h" → "i" → "s" 로 이동한 상태는 그냥 "his" 라는 문자열이다. 덕분에 Redis 에 저장된 값을 직접 조회해봐도 어떤 상태인지 바로 알 수 있어서 디버깅하기 편했다.

`Name` 으로 지정한 이름을 기준으로 아래와 같은 키들을 사용한다.

| 키 | 타입 | 용도 |
|---|---|---|
| `{name}:keyword` | Set | 등록된 키워드 목록 |
| `{name}:prefix` | Sorted Set | 트라이의 모든 상태 (키워드의 모든 접두사) |
| `{name}:suffix` | Sorted Set | 상태 문자열을 뒤집은 값. output 을 다시 계산할 대상을 찾을 때 사용 |
| `{state}:output` | Set | 해당 상태에서 매칭되는 키워드 목록 |
| `{keyword}:node` | Set | 해당 키워드를 output 으로 가지고 있는 상태 목록 (삭제할 때 사용) |

Goto 는 `{name}:prefix` 에 "현재 상태 + 다음 문자" 가 있는지 `ZSCORE` 로 확인하는 것으로 끝난다. 실패 함수는 미리 계산해두지 않고, 검색할 때마다 현재 상태의 접미사를 긴 것부터 `{name}:prefix` 에서 찾아보는 방식으로 구현했다. 대신 output 은 키워드를 추가할 때 미리 계산해서 저장해둔다.

이렇게 Redis 에 저장하면 키워드가 많아져도 애플리케이션의 메모리를 차지하지 않고, 여러 애플리케이션 인스턴스가 같은 키워드 사전을 공유할 수 있다. 물론, 상태를 이동할 때마다 Redis 를 호출하기 때문에 메모리에서 동작하는 구현보다는 느릴 수 밖에 없다. 키워드 사전을 여러 서버가 공유해야 하는 경우에 적합하다고 생각한다.

## 사용하기

### 사전 요구사항

- Go 1.7 이상
- Redis 3.x 이상

### 설치

```bash
$ go get github.com/skyoo2003/acor
```

의존성 관리는 [Glide](https://github.com/Masterminds/glide)를 사용하고 있다.

### 사용 예제

```go
package main

import (
	"fmt"

	"github.com/skyoo2003/acor"
)

func main() {
	args := &acor.AhoCorasickArgs{
		Addr:     "localhost:6379",
		Password: "",
		DB:       0,
		Name:     "sample",
	}
	ac := acor.Create(args)
	defer ac.Close()

	keywords := []string{"he", "her", "him"}
	for _, k := range keywords {
		ac.Add(k)
	}

	matched := ac.Find("he is him")
	fmt.Println(matched)
	// Output: [he him]

	ac.Flush() // 저장된 데이터를 모두 지우고 싶은 경우
}
```

로컬에 Redis 가 없다면 저장소의 `run-redis.sh` 스크립트로 Redis 도커 컨테이너를 띄워서 테스트해볼 수 있다.

### 제공하는 메소드

| 메소드 | 설명 |
|---|---|
| `Create(args)` | Redis 에 연결하고 Aho-Corasick 인스턴스 생성 |
| `Add(keyword)` | 키워드 추가 |
| `Remove(keyword)` | 키워드 삭제 |
| `Find(text)` | 텍스트에서 매칭되는 키워드 검색 |
| `Suggest(input)` | 입력값으로 시작하는 키워드 조회 |
| `Info()` | 키워드 수와 노드(상태) 수 조회 |
| `Flush()` | 저장된 모든 데이터 삭제 |
| `Close()` | Redis 연결 종료 |

## 정리

금칙어 필터링이나 특정 키워드가 포함된 메시지 탐지처럼, 키워드 사전을 여러 서버에서 같이 써야 하는 경우를 생각하고 만들었다. 아직 초기 버전이라 부족한 부분이 많지만, 조금씩 개선해 나갈 예정이다.

자세한 내용은 [GitHub 저장소](https://github.com/skyoo2003/acor)를 참고하자.
