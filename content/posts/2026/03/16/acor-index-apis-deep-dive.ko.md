---
title: "ACOR v1.3.0 Index APIs 심층 분석"
date: 2026-03-16T00:00:00+09:00
tags: [go, redis, acor, deep-dive]
---

## 들어가며

[Aho-Corasick 알고리즘](https://en.wikipedia.org/wiki/Aho%E2%80%93Corasick_algorithm)은 다중 패턴 문자열 검색을 위한 고전적인 알고리즘이다. 사전에 등록된 여러 키워드를 입력 텍스트에서 동시에 효율적으로 찾을 수 있어, 스팸 필터링, 민감 정보 탐지, 자동완성 등 다양한 영역에서 활용된다.

[ACOR](https://github.com/skyoo2003/acor)은 이 Aho-Corasick 알고리즘을 Go로 구현하고 Redis를 백엔드 저장소로 사용하는 라이브러리다. v1.3.0에서는 기존 API를 확장하여 매칭된 키워드의 위치 정보를 제공하는 Index APIs가 추가되었다.

이 포스트에서는 `FindIndex`와 `SuggestIndex` API의 설계와 구현을 심층 분석해본다.

## 기존 API와의 차이점

v1.3.0 이전에는 `Find`와 `Suggest` 두 가지 검색 API가 있었다:

```go
// 기존 API: 매칭된 키워드 목록만 반환
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) Suggest(input string) ([]string, error)
```

이들 API는 어떤 키워드가 매칭되었는지만 알려줄 뿐, 텍스트 내 어느 위치에서 매칭되었는지는 알 수 없었다. 텍스트 하이라이팅이나 위치 기반 분석을 위해서는 별도로 인덱스를 계산해야 했다.

v1.3.0의 Index APIs는 이 문제를 해결한다:

```go
// 새로운 Index API: 키워드와 시작 인덱스를 함께 반환
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

## API 개요

### FindIndex

`FindIndex`는 입력 텍스트를 순회하며 등록된 키워드와 매칭되는 모든 위치를 찾는다:

```go
matched, err := ac.FindIndex("he is him")
// 결과: map[string][]int{
//   "he":  {0},
//   "him": {6},
// }
```

반환값은 `map[keyword][]startIndex` 구조다. 각 키워드는 여러 위치에서 매칭될 수 있으므로 시작 인덱스의 슬라이스로 반환된다.

### SuggestIndex

`SuggestIndex`는 접두사 기반 자동완성에서 매칭된 키워드와 그 시작 위치를 반환한다:

```go
suggestions, err := ac.SuggestIndex("he")
// 결과: map[string][]int{
//   "he":  {0},
//   "her": {0},
// }
```

## 사용 예제

전체 사용 예제:

```go
package main

import (
    "fmt"
    "github.com/skyoo2003/acor/pkg/acor"
)

func main() {
    ac, err := acor.Create(&acor.AhoCorasickArgs{
        Addr: "localhost:6379",
        Name: "sample",
    })
    if err != nil {
        panic(err)
    }
    defer ac.Close()

    // 키워드 등록
    keywords := []string{"he", "her", "his", "him"}
    for _, k := range keywords {
        ac.Add(k)
    }

    // FindIndex로 매칭 위치 찾기
    matched, _ := ac.FindIndex("he is him and she is her")
    fmt.Println(matched)
    // 출력: map[he:[0] him:[6] her:[21]]
}
```

## 내부 구현 분석

### Rune 기반 인덱싱

`FindIndex`의 핵심은 Unicode를 올바르게 처리하는 것이다. Go의 `range` 문은 문자열을 rune(유니코드 코드 포인트) 단위로 순회한다:

```go
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error) {
    matched := make(map[string][]int)
    state := ""
    runeIndex := 0

    for _, char := range text {  // rune 단위 순회
        // 상태 전이 로직...
        runeIndex++
    }
    // ...
}
```

이 방식은 한글, 이모지 등 멀티바이트 문자에서도 올바른 인덱스를 보장한다.

### 상태 전이 로직

Aho-Corasick의 핵심은 트라이(Trie) 구조와 실패 함수(Failure Function)다. ACOR은 이를 Redis에 저장한다:

```go
func (ac *AhoCorasick) _go(inState string, input rune) (string, error) {
    buffer := bytes.NewBufferString(inState)
    buffer.WriteRune(input)
    nextState := buffer.String()

    // Redis Sorted Set에서 다음 상태 확인
    pKey := ac.prefixKey()
    err := ac.redisClient.ZScore(ac.ctx, pKey, nextState).Err()
    if err == redis.Nil {
        return "", nil  // 전이 불가능
    }
    return nextState, nil
}

func (ac *AhoCorasick) _fail(inState string) (string, error) {
    pKey := ac.prefixKey()
    inStateRunes := []rune(inState)
    for idx := 0; idx < len(inStateRunes); idx++ {
        nextState := string(inStateRunes[idx+1:])
        // 더 짧은 접미사로 fallback 시도
        err := ac.redisClient.ZScore(ac.ctx, pKey, nextState).Err()
        if err == nil {
            return nextState, nil
        }
    }
    return "", nil
}
```

### 인덱스 계산

매칭된 키워드의 시작 인덱스는 끝 위치에서 키워드 길이를 빼서 계산한다:

```go
func (ac *AhoCorasick) appendMatchedIndexes(
    matched map[string][]int,
    outputs []string,
    endIndex int,
) {
    for _, output := range outputs {
        startIndex := endIndex - len([]rune(output))
        matched[output] = append(matched[output], startIndex)
    }
}
```

`len([]rune(output))`를 사용하여 바이트가 아닌 문자 수로 계산하는 점이 중요하다.

## 특수 케이스 처리

### 중복 매칭 (Overlapping Matches)

`"her"`라는 텍스트에서 `"he"`와 `"her"` 모두 인덱스 0에서 매칭된다:

```go
matched, _ := ac.FindIndex("her")
// 결과: map[string][]int{
//   "he":  {0},
//   "her": {0},
// }
```

### 반복 매칭 (Repeated Matches)

`"hehe"`에서 `"he"`는 두 번 매칭된다:

```go
matched, _ := ac.FindIndex("hehe")
// 결과: map[string][]int{
//   "he": {0, 2},
// }
```

### Unicode 처리

한글 키워드 `"한글"`을 등록하고 `"가한글"`에서 검색하면:

```go
matched, _ := ac.FindIndex("가한글")
// 결과: map[string][]int{
//   "한글": {1},  // 바이트가 아닌 문자 인덱스
// }
```

`"가"`는 0번째 rune, `"한글"`은 1번째 rune에서 시작한다.

## 성능 고려사항

Index APIs는 기존 API 대비 다음과 같은 오버헤드가 있다:

1. **메모리**: `map[string][]int` 구조로 인덱스 정보 저장
2. **연산**: `len([]rune(output))`로 매칭 시점마다 rune 길이 계산

따라서 인덱스 정보가 필요하지 않은 단순 존재 여부 확인에는 기존 `Find`/`Suggest`를 사용하는 것이 효율적이다. 반면, 텍스트 하이라이팅, 위치 기반 로깅, 분석 등 인덱스가 필요한 작업에서는 Index APIs를 사용하면 된다.

## 마치며

ACOR v1.3.0의 Index APIs는 매칭 위치 정보를 제공하여 라이브러리의 활용 범위를 확장했다. 특히 Unicode를 올바르게 처리하는 Rune 기반 인덱싱과 Aho-Corasick의 상태 전이를 Redis에 구현한 점이 흥미로운 부분이다.

더 자세한 내용은 [ACOR GitHub 저장소](https://github.com/skyoo2003/acor)와 [공식 문서](https://skyoo2003.github.io/acor/)를 참고.
