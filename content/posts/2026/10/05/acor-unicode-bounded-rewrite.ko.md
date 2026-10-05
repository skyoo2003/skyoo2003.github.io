---
title: "검색 결과를 안전하게 고치기: ACOR의 Unicode 마스킹과 자원 제한"
description: "ACOR의 Scan, MaskText, ReplaceText가 소문자 변환 뒤에도 원문 바이트 위치를 보존하고 겹친 매칭과 결과 수·작업량 제한을 처리하는 방법을 설명한다."
date: 2026-10-05T00:00:00+09:00
tags: [go, acor, unicode, text-processing]
---

문자열에서 키워드를 찾고 나면 그 위치를 별표로 가리거나 다른 문구로 바꾸고 싶을 수 있다. 간단해 보이는 작업이지만 검색에 사용한 문자열과 사용자에게 돌려줄 원문이 다르면 생각보다 신경 쓸 부분이 많다. 대소문자를 무시하려고 소문자로 바꾸는 것만으로도 UTF-8 바이트 길이가 달라질 수 있고 겹치는 키워드를 각각 치환하려다 같은 구간을 여러 번 바꾸는 문제도 생긴다.

[ACOR](https://github.com/skyoo2003/acor)에 추가한 `Scan`, `MaskText`, `ReplaceText`에서는 원문 위치를 보존하고 자원 제한을 명시해 이 문제를 다뤘다. [v1.7.0 소스](https://github.com/skyoo2003/acor/tree/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8)를 따라가며 검색 결과를 텍스트 변환에 어떻게 연결했는지 살펴보려 한다. 사전의 저장과 갱신 구조는 [V3 소개 글](/ko/posts/2026/10/02/acor-v3-versioned-dictionaries/)에서 다뤘으므로 여기서는 입력과 출력에 집중한다.

## 같은 문자 위치라도 바이트 위치는 다르다

사전에 `한국`, `한국어`, `istanbul`이 있고 입력이 다음과 같다고 하자.

```text
한국어 İSTANBUL
```

대소문자를 무시하면 `İSTANBUL`은 `istanbul`과 매칭되는데, Go의 `unicode.ToLower`가 `İ`를 `i`로 바꾸는 과정에서 바이트 길이가 달라진다. 원문의 `İ`는 UTF-8에서 2바이트이고 `i`는 1바이트이므로, 전체 입력을 소문자로 바꾼 뒤 얻은 바이트 오프셋을 원문에 적용하면 마지막 글자까지 포함하지 못할 수 있다.

Go 문자열의 슬라이싱도 바이트 단위이므로 `한국어`가 룬 세 개라는 사실과 문자열에서 9바이트를 차지한다는 사실을 구분해야 한다. leftmost-longest 규칙으로 두 매칭을 선택하면 원문 위치는 아래와 같으며 각 구간의 끝은 포함하지 않는다.

| 원문 매칭 | 정규화된 키워드 | 룬 구간 | 바이트 구간 |
|---|---|---|---|
| `한국어` | `한국어` | `[0, 3)` | `[0, 9)` |
| `İSTANBUL` | `istanbul` | `[4, 12)` | `[10, 19)` |

룬 수가 사람이 보는 글자 수와 항상 같지는 않다. 결합 문자나 여러 코드 포인트로 구성한 이모지는 룬 여러 개일 수 있으므로, 이 API가 제공하는 룬·바이트 위치를 화면에서 보이는 글자 단위인 grapheme cluster 위치로 해석해서는 안 된다.

## 검색에는 소문자를, 결과에는 원문 위치를

`Scan`은 `SourceMatch`에 두 종류의 정보를 담는다.

| 필드 | 의미 |
|---|---|
| `Keyword` | 매칭된 사전 키워드 |
| `Text` | 원문에서 잘라 낸 문자열 |
| `Start`, `End` | 원문의 룬 구간 |
| `ByteStart`, `ByteEnd` | 원문의 바이트 구간 |

구현에서는 입력을 먼저 순회하며 원문 룬 배열과 각 룬이 시작한 바이트 오프셋을 만들고 배열 끝에 `len(text)`를 넣어 마지막 룬 뒤의 위치까지 표현한다. 검색 엔진에 필요할 때 룬별 소문자를 전달하더라도 매칭이 나오면 원문 오프셋 배열로 바이트 위치를 복원하므로, 결과에는 항상 다음 관계가 성립한다.

```go
match.Text == text[match.ByteStart:match.ByteEnd]
```

실제 위치 복원은 [`sourceScanner.emit`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan.go)에서 수행하며 소문자 변환에는 룬마다 `unicode.ToLower`를 적용한다. 다만 Unicode의 모든 case-folding 확장이나 NFC/NFD 정규화까지 수행하는 것은 아니다.

잘못된 UTF-8이 들어와도 원문을 다시 인코딩해 고치지는 않는다. 검색에서는 Go의 디코딩 규칙에 따라 `RuneError`로 취급하되 매칭되지 않은 부분을 출력할 때는 원래 바이트를 그대로 복사하므로, 이런 입력을 받아들일지는 애플리케이션이 별도로 결정할 수 있다.

## 겹친 결과를 모두 바꿀 수는 없다

`한국어`에서는 `한국`과 `한국어`가 같은 위치에서 시작하므로 검색이라면 둘 다 반환해도 된다. 다만 치환에서 두 구간을 모두 적용하면 같은 원문을 중복해서 소비하게 된다.

그래서 마스킹과 치환에는 **가장 왼쪽에서 시작한 매칭 중 가장 긴 것**을 고르는 leftmost-longest 규칙을 사용하고 하나를 고른 뒤에는 그 구간과 겹치는 나머지 매칭을 버린다. `Scan`은 겹치는 결과를 모두 돌려주는 모드도 지원하지만 텍스트 변환에는 이 선택 규칙을 고정했다.

구현에서는 모든 매칭을 모아 정렬하는 대신 시작 위치마다 가장 긴 후보만 보관하고, 사전의 최장 키워드 길이만큼 입력을 더 읽은 뒤 그 위치의 선택을 확정하도록 했다. 그만큼 진행했다면 같은 시작 위치에서 더 긴 키워드가 뒤늦게 완성될 수 없기 때문이다. 입력이 끝났을 때는 남은 후보를 확정한다.

이미 선택한 구간의 끝보다 앞에서 시작한 후보는 건너뛴다. 후보의 확정 조건과 겹침 제거는 [`sourceScanner.flush`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan.go)에 있다. 다만 입력 룬·오프셋 배열, 대기 중인 시작 위치, 보존한 결과를 담을 메모리가 필요하므로 그 사용량은 상수 크기로 고정되지 않는다.

## 결과 개수와 작업량을 따로 제한한다

결과를 1,000개까지만 받더라도 검색 작업이 1,000번으로 끝나지는 않는다. 사전에 `a`, `aa`, `aaa`처럼 접미사가 겹치는 키워드가 많으면 입력을 한 글자 진행할 때 여러 후보가 나오는데, `WholeWord` 조건에서 모두 탈락해 결과가 비어 있더라도 엔진은 그 후보를 처리해야 한다.

`ScanOptions`에서는 이를 다음 한도로 제한한다.

| 옵션 | 기본값 | 한도를 넘으면 |
|---|---|---|
| `MaxInputBytes` | 1 MiB | 엔진 로드와 스캔 전에 `ErrInputLimit` |
| `MaxMatches` | 1,000 | 추가로 적격 매칭을 발견하면 `Truncated: true` |
| `MaxCandidates` | 100,000 | 원시 후보가 한도를 넘으면 `ErrScanWorkLimit` |

0을 지정하면 기본값을 선택하고 음수는 거절한다. `MaxCandidates`는 단어 경계 검사와 겹침 제거 **전**에 세어, 필터에서 탈락하는 후보가 많아도 작업량 제한을 우회할 수 없도록 했다. `MaxMatches`에서는 실제 반환 대상이 되는 결과를 센다.

결과가 정확히 한도와 같은 개수라면 잘렸다고 표시하지 않고 한도를 넘는 적격 매칭을 하나 더 발견했을 때 `Truncated`가 된다. 입력 크기나 후보 수를 초과하거나 context가 취소된 경우에는 오류와 함께 결과를 반환하지 않으므로, 검색의 `Truncated`와 오류를 서로 다른 신호로 읽어야 한다. 이 동작은 [`TestScanLimitsAndWordBoundaries`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan_test.go)에서 확인한다.

context가 있어도 모든 사용자 코드를 즉시 중단시킬 수는 없다. 예를 들어 사용자 정의 `WordRune` 함수는 호출자의 고루틴에서 실행되므로 그 함수가 끝나지 않으면 다음 취소 검사까지 진행할 수 없다.

## 반만 마스킹된 문서를 반환하지 않는다

검색은 일부 결과를 보여 주면서 나머지가 잘렸다고 알릴 수 있다. 하지만 마스킹이 중간에 멈춘 문서를 성공 결과로 돌려주면 뒤쪽 키워드가 그대로 남은 문서를 호출자가 사용하기 쉽다.

`MaskText`와 `ReplaceText`에서는 이 차이를 API 계약에 반영해, 치환 중 매칭 한도를 넘으면 `ErrMatchLimit`, 출력 크기를 넘으면 `ErrOutputLimit`를 반환하도록 했다. 어떤 오류든 `RewriteResult`는 `nil`이며 입력과 후보 한도, 취소 오류에도 같은 규칙이 적용된다.

`RewriteOptions.MaxOutputBytes`의 기본값은 4 MiB이며 [`renderRewrite`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/rewrite.go)는 선택한 매칭과 변경하지 않을 구간을 바탕으로 최종 출력 크기를 먼저 계산한 뒤 한도 안에 있을 때 출력 버퍼를 할당한다. 매칭되지 않은 원문도 계산에 포함하므로 키워드가 하나도 없어도 출력 한도가 입력보다 작으면 오류가 난다.

`ReplaceText`의 replacement는 그대로 삽입하는 문자열이므로 정규식의 캡처 치환을 수행하거나 삽입한 문자열을 다시 검색하지 않는다. 빈 문자열을 넘겼을 때는 매칭 구간을 삭제한다.

`MaskText`는 매칭된 **원문 룬 하나당 마스크 룬 하나**를 출력하므로 룬 수는 보존하지만 바이트 수는 달라질 수 있다. 앞의 입력을 `*`로 가리면 다음과 같다.

```text
*** ********
```

`●`를 사용하면 마스크 하나가 UTF-8에서 3바이트이므로 출력은 더 커진다. 이때 반환된 매칭 위치는 항상 **입력 원문**을 가리키므로 출력이 짧아졌더라도 그 위치를 치환 후 문자열에 적용해서는 안 된다.

## V3 사전과 함께 사용하기

아래 예제에서는 로컬 Redis와 v1.7.0 라이브러리로 사전을 커밋한 뒤, `WaitForVersion`을 호출해 이 인스턴스의 검색 엔진에 반영될 때까지 기다린다. 예제 이름의 V3 사전을 교체하므로 테스트용 Redis에서 실행한다.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "time"

    "github.com/skyoo2003/acor/pkg/acor"
)

func main() {
    if err := run(); err != nil {
        log.Fatal(err)
    }
}

func run() error {
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    dictionary, err := acor.OpenVersioned(ctx, &acor.VersionedOptions{
        Redis: acor.AhoCorasickArgs{Addr: "localhost:6379", Name: "rewrite-example"},
    })
    if err != nil { return err }
    defer dictionary.Close()

    snapshot, err := dictionary.Snapshot(ctx)
    if err != nil { return err }
    expected := snapshot.Version()
    if err := snapshot.Close(ctx); err != nil { return err }
    write, err := dictionary.Replace(ctx, expected, []string{"한국", "한국어", "istanbul"})
    if err != nil { return err }
    if err := dictionary.WaitForVersion(ctx, write.Version); err != nil { return err }

    text := "한국어 İSTANBUL"
    found, err := dictionary.Scan(ctx, text, &acor.ScanOptions{
        Kind: acor.MatchKindLeftmostLongest,
    })
    if err != nil { return err }
    if found.Truncated { return fmt.Errorf("incomplete scan") }
    for _, match := range found.Matches {
        fmt.Printf("%q [%d,%d)\n", match.Text, match.ByteStart, match.ByteEnd)
    }
    masked, err := dictionary.MaskText(ctx, text, '*', nil)
    if err != nil { return err }
    fmt.Println(masked.Text)
    return nil
}
```

로컬 Redis에서 실행하면 다음과 같이 출력된다.

```text
"한국어" [0,9)
"İSTANBUL" [10,19)
*** ********
```

V3의 각 호출은 처리하는 동안 하나의 서빙 엔진을 유지하므로 도중에 새 사전이 설치되어도 같은 호출의 앞부분과 뒷부분을 서로 다른 사전으로 처리하지 않는다. 다만 예제의 `Scan`과 `MaskText`는 별도 호출이어서 그 사이에 다른 클라이언트가 사전을 바꿨다면 두 호출이 서로 다른 세대를 사용할 수 있다.

## 테스트로 고정한 경계

구현의 경계를 확인할 때는 [`scan_test.go`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/scan_test.go)의 다음 테스트를 참고할 수 있다.

- `TestScanOriginalUnicodeSpans`는 세 프리셋과 두 매칭 모드에서 원문 바이트·룬 위치를 대조한다.
- `TestRewriteAtomicAndOriginalOffsets`는 마스킹의 룬 수, 원문 오프셋, 한도 초과 시 `nil` 결과, 빈 문자열 치환을 확인한다.
- `TestScanSensitiveAndMalformedUTF8`은 대소문자를 구분하는 경우와 잘못된 UTF-8을 다룬다.
- `FuzzScanLeftmostParity`는 leftmost-longest 결과를 기존 매칭 API와 비교한다.

마스킹 결과를 보관할 때는 `SourceMatch.Text`에도 원문 부분 문자열이 들어 있다는 점을 살펴야 한다. 마스킹된 `Text`만 저장하려던 곳에 매칭 목록까지 남기면 가린 키워드가 다시 기록되고 부분 문자열이 큰 원문 문자열의 메모리를 붙잡을 수도 있다.

## 정리

검색 기능을 마스킹·치환으로 확장하면서 원문 위치와 선택 규칙, 입력·작업·출력 한도를 함께 정의했다. 검색용 키워드와 출력용 원문을 구분하고 한 번의 V3 변환에서는 하나의 서빙 엔진을 사용하도록 했다.

호출하는 쪽에서는 `Scan`의 오류와 `Truncated`를 모두 확인해야 하며 마스킹·치환은 오류가 없을 때만 결과를 사용해야 한다. 반환된 위치도 항상 입력 기준이므로 변환한 문자열에 그대로 적용하지 않도록 주의하자.

전체 소스 코드는 [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor)에서 확인할 수 있다.
