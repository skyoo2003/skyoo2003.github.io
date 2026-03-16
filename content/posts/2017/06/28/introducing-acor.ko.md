---
title: "ACOR 소개: Redis 기반 Aho-Corasick 구현"
date: 2017-06-28T16:39:49+09:00
tags: [go, redis, algorithm, aho-corasick]
---

## 들어가며

문자열 검색은 소프트웨어 개발에서 자주 마주치는 문제다. 특정 키워드 하나를 찾는 것은 간단하지만, 수백 개의 키워드를 동시에 찾아야 한다면 어떨까? 각 키워드마다 텍스트를 순회한다면 비효율적일 것이다.

[Aho-Corasick 알고리즘](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm)은 이 문제를 우아하게 해결한다. 1975년 Alfred V. Aho와 Margaret J. Corasick이 개발한 이 알고리즘은 여러 패턴을 동시에 효율적으로 검색할 수 있다.

[ACOR](https://github.com/skyoo2003/acor)은 이 Aho-Corasick 알고리즘을 Go로 구현하고 Redis를 백엔드 저장소로 사용하는 라이브러리다. 이 포스트에서는 ACOR의 소개와 Aho-Corasick 알고리즘의 기본 개념, 그리고 사용법을 살펴본다.

## Aho-Corasick 알고리즘 개요

### 기본 원리

Aho-Corasick 알고리즘은 두 단계로 동작한다:

1. **트라이(Trie) 구성**: 검색할 키워드들로부터 트라이 자료구조를 만든다
2. **실패 함수(Failure Function) 구축**: 매칭 실패 시 이동할 상태를 미리 계산한다

검색 시 입력 텍스트를 한 번만 순회하면서 모든 키워드의 매칭을 찾을 수 있다. 시간 복잡도는 O(n + m + z)로, n은 텍스트 길이, m은 모든 키워드의 총 길이, z는 매칭 횟수다.

### 트라이 구조

트라이는 각 노드가 문자 하나를 나타내는 트리 구조다. 키워드 "he", "his", "she"를 등록하면 다음과 같은 트라이가 구성된다:

```
root
├── h
│   ├── e (output: "he")
│   └── i
│       └── s (output: "his")
└── s
    └── h
        └── e (output: "she")
```

### 실패 함수

실패 함수는 현재 상태에서 매칭이 실패했을 때 어느 상태로 돌아갈지를 정의한다. 예를 들어 "his"를 검색하다가 's' 다음에 다른 문자가 나오면, 접미사 "s" 또는 빈 문자열 상태로 돌아간다.

이를 통해 텍스트를 되돌아가지 않고도 모든 매칭을 찾을 수 있다.

## ACOR 설계 및 특징

### Redis를 저장소로 활용

ACOR의 독특한 점은 트라이와 실패 함수를 Redis에 저장한다는 것이다. 이로 인한 장점:

1. **메모리 효율성**: 대량의 키워드도 Redis가 관리하는 메모리에 저장
2. **영속성**: Redis의 영속성 옵션을 통해 데이터 보존
3. **분산 환경 지원**: 여러 애플리케이션 인스턴스가 동일한 트라이 공유

### 상태 표현

ACOR은 상태를 문자열로 표현한다. 예를 들어 "h" -> "i" -> "s" 경로는 상태 문자열 "his"로 나타낸다. 이 단순한 표현 방식은 디버깅과 이해를 쉽게 만든다.

Redis Sorted Set을 사용하여 유효한 상태들을 관리한다.

## 시작하기

### 사전 요구사항

- Go 1.13 이상
- Redis 3.0 이상

### 설치

```bash
go get -u github.com/skyoo2003/acor
```

### 기본 사용법

```go
package main

import (
    "fmt"
    "github.com/skyoo2003/acor/pkg/acor"
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

    ac.Flush()
}
```

### API 개요

| Method | Description |
|--------|-------------|
| `Create(args)` | 새로운 Aho-Corasick 인스턴스 생성 |
| `Add(keyword)` | 키워드 추가 |
| `Find(text)` | 텍스트에서 매칭되는 키워드 검색 |
| `Suggest(input)` | 접두사 기반 자동완성 제안 |
| `Flush()` | 등록된 모든 키워드 삭제 |
| `Close()` | Redis 연결 종료 |

## 활용 사례

1. **스팸 필터링**: 스팸 키워드 목록을 등록하고 메시지에서 검색
2. **민감 정보 탐지**: 주민번호, 신용카드 번호 패턴 등 감지
3. **자동완성**: 검색어 자동완성 시스템
4. **콘텐츠 모더레이션**: 부적절한 단어 필터링

## 마치며

ACOR은 Aho-Corasick 알고리즘의 강력함과 Redis의 유연함을 결합한 라이브러리다. 다중 키워드 검색이 필요한 프로젝트에서 쉽게 활용할 수 있다.

더 자세한 내용은 [GitHub 저장소](https://github.com/skyoo2003/acor)를 참고하자.
