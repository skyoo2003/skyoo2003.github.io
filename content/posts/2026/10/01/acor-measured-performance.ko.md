---
title: "추측 대신 측정: ACOR 매칭 엔진을 빠르게 만든 변경과 되돌린 변경"
description: "ACOR v0.9.0~v1.5.0에서 Redis 왕복 감소, ASCII 직접 인덱스, 전이 표 평탄화로 매칭을 빠르게 한 변경과 측정 후 제거한 Bloom 필터를 정리한다."
date: 2026-10-01T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, acor, performance, aho-corasick]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor)의 README에는 한동안 "V2 스키마로 `Find()`가 50\~60배 빨라진다"고 적혀 있었다. v0.11.0에서 벤치마크를 다시 정리해 보니 50\~60배라는 측정값은 맞았지만 빨라진 것은 V2 스키마가 아니라 `EnableCache`와 `Preset` 엔진 덕분이었다. 캐시 없는 V2는 오히려 V1보다 느렸으니, 숫자는 맞아도 설명은 틀린 셈이었다.

그 뒤로 성능 수치를 공개할 때는 재현 명령을 함께 싣고 구조적으로 정해지는 숫자는 테스트로 고정하기로 했다. 이 글에서는 v0.9.0부터 v1.5.0까지 진행한 성능 작업을 돌아보며 빨라진 변경과 측정 후 되돌린 변경, 그 과정에서 발견한 정확성 버그를 함께 정리한다.

Aho-Corasick 알고리즘 자체는 [ACOR 소개 글](/ko/posts/2017/06/28/introducing-acor/)에서 다뤘으므로 여기서는 설명하지 않는다.

## 왕복 횟수와 실행 시간 측정

ACOR은 Redis를 저장소로 쓰므로 성능을 볼 때는 다음 두 종류의 숫자를 구분해야 한다.

- **왕복 횟수**는 구조적이다. 저장소 경계에서 세므로 miniredis에서도, 실제 서버에서도 같아서 CI에서 테스트로 강제할 수 있다.
- **시간**은 하드웨어에 묶여 있다. 절대값은 다른 기계에서 재현되지 않으므로 재현 가능한 것은 설정 간의 **비율**뿐이다.

왕복 횟수는 `pkg/acor/rtt_claims_test.go`에서 고정하며 파일 첫머리 주석에는 수치를 어떻게 관리할지 적어 두었다.

```go
// Each test here pins one round-trip claim that ACOR publishes. When a test and
// the docs disagree, the docs are wrong: these counts are measured, the prose
// was asserted. Update README.md and docs/content/reference/benchmarks.md to
// match, never the other way around.
```

ACOR은 이 주석에 따라 테스트와 문서가 어긋나면 카운터와 측정 조건부터 확인하고 검증된 측정값에 맞춰 문서를 수정한다. 테스트 코드 자체에도 오류가 있을 수 있으므로 테스트 결과를 무조건 정답으로 받아들인다는 뜻은 아니다.

카운터 자체를 검증하는 테스트도 있는데, 명령 N개를 담은 파이프라인 하나가 왕복 1회로 세지는지 확인한다. 카운터가 이를 N으로 센다면 공개한 숫자가 모두 부풀려지기 때문이다.

| 오퍼레이션 | V1 | V2 |
|---|---|---|
| `Find()` | 1 | 1 |
| `Find()`, `EnableCache` 웜 상태 | n/a | 0 |
| `Find()`, `Preset` 엔진 | n/a | 0 |
| `FindParallel()`, 63 청크 | 1 | 1 |
| `Add()`, 5글자 키워드 | 53 | 2 |
| `Add()`, 26글자 키워드 | 507 | 2 |

표의 V1 쓰기 수치는 과거 구현을 테스트용 fixture로 보존해 측정한 비교값으로, v1.5.0 이후 공개 API는 V1 쓰기를 `ErrV1ReadOnly`로 거절한다.

표에서 V1과 V2의 `Find()`가 모두 왕복 1회라는 점을 보면 50\~60배 주장의 문제가 드러난다. 스키마를 바꾸는 것만으로 읽기가 수십 배 빨라질 구조는 아니며 V2에서 확실히 줄어드는 비용은 **쓰기** 쪽이다.

시간은 Apple M4, Go 1.26, 루프백 Redis 8에서 쟀다. 같은 노트북에서 반복 측정해도 절대값은 20\~25%씩 움직였지만 비율은 약 15% 안에서 유지됐기 때문에, 문서에서는 비율을 "약"으로 적고 원시 숫자는 한 번의 샘플이라고 표시한다.

| 설정 (키워드 1,000개) | ns/op | allocs/op | V1 대비 |
|---|---|---|---|
| V1 | 129,062 | 1,070 | 기준 |
| V2, 캐시 없음 | 224,738 | 2,060 | 약 1.7배 느림 |
| V2 + `EnableCache`, 웜 | 8,631 | 62 | 약 15배 빠름 |
| `PresetBalanced` | 2,204 | 4 | **약 59배 빠름** |

## 왕복을 먼저 줄인다

Redis를 쓰는 라이브러리에서 CPU 최적화보다 먼저 봐야 하는 것은 왕복이다. 루프백에서도 왕복 하나가 엔진의 스캔 한 번보다 비싸고, 실제 네트워크에서는 그 차이가 더 커진다.

**V2 `Find()`가 매번 엔진을 다시 만들고 있었다 (v0.11.0).** 캐시 없는 V2 `Find()`는 사전이 바뀌지 않았는데도 호출할 때마다 Redis에서 읽은 데이터로 매칭 엔진을 새로 만들었다. 엔진을 메모이즈하고 outputs 해시만 읽도록 바꾸자 키워드 1,000개에서 실행 시간은 1,163,098 ns/op에서 221,253 ns/op로, 할당은 11,704회에서 2,063회로 줄었다. V1보다 약 9배 느리던 격차도 약 1.7배로 좁혀졌으며 남은 차이는 V2가 상태마다 항목이 있는 outputs 해시 전체를 가져오는 페이로드 비용이다.

**대량 추가를 트랜잭션 하나로 (v0.11.0).** `AddMany`가 배치 전체를 한 번에 계획하고 트랜잭션 하나로 커밋하게 바꿔, 배치 크기와 상관없이 왕복 2회로 처리한다. 변경 전·후 `AddMany`를 비교하면 키워드 1,000개 추가가 약 400배 빨라졌고 할당은 970배 줄었다. 별도로 현재 `Add` 루프와 `AddMany`를 비교하면 같은 쓰기가 약 350ms와 3.0ms로, 약 117배 차이가 난다.

**청크마다 읽던 병렬 검색 (v1.5.0).** `FindParallel`은 긴 텍스트를 청크로 나눠 병렬로 스캔하지만 당시에는 청크마다 automaton을 Redis에서 따로 읽고 있었다. 63개 청크로 나눈 텍스트라면 outputs 해시 전체에 `HGETALL`을 63번 보내는 구조였다. 지금은 호출당 한 번 읽은 스냅샷을 모든 청크가 공유하므로 왕복이 줄었을 뿐 아니라 검색하는 동안 같은 버전의 사전을 쓰게 되어, 성능을 고치다가 일관성까지 함께 챙기게 됐다.

## 문자 하나당 CPU 비용 줄이기

왕복을 줄인 뒤에는 `Preset` 엔진이 입력 문자마다 실행하는 스캔 루프의 CPU 비용을 살펴봤다.

### ASCII 직접 인덱스 (v0.9.0)

엔진은 사전에 나오는 문자만 모아 압축된 알파벳을 만들고, 문자를 알파벳 인덱스로 바꿔 상태 전이 표를 조회한다. 처음에는 이 변환에 `map[rune]int`를 써서 문자마다 해시 계산이 한 번씩 들어갔다.

하지만 ASCII 문자는 128개뿐이므로 해시 대신 배열로 바로 찾을 수 있다.

```go
type alphabetCoder struct {
	index map[rune]int
	// asciiCode is a direct-index fast path for index: for an ASCII rune r in the
	// alphabet, asciiCode[r] = index+1 (0 means "not in alphabet"), avoiding a map
	// hash on nearly every character.
	asciiCode [128]int32
	// asciiOnly reports whether every alphabet rune is ASCII. Scans that report no
	// offsets can then walk raw bytes instead of decoding UTF-8.
	asciiOnly bool
}
```

`0`을 "알파벳에 없음"으로 쓰려고 인덱스에 1을 더해 저장한다. 이 변경에 실패 링크를 따라갈 때 문자 코드를 다시 계산하지 않게 한 변경을 더하자, 결과는 그대로이면서 기본 `Balanced`의 `Find`는 약 2.2\~2.4배, `Speed`는 최대 3배 빨라졌다.

### 전이 표 평탄화와 바이트 스캔 (v0.11.0)

`Speed` 엔진의 DFA 전이 표는 `[][]int`라 문자 하나를 처리할 때마다 슬라이스 헤더를 읽고 경계 검사도 두 번 해야 했다. 이를 `state*alphaSize+alphabetIndex`로 인덱싱하는 `[]int32` 하나로 펼치고 각 항목에 출력 여부 비트도 넣어 매칭이 없는 상태에서는 출력 조회를 건너뛰도록 했다.

또한 사전이 ASCII로만 이루어져 있으면 UTF-8 디코딩도 건너뛴다.

```go
// Byte scan when the dictionary is pure ASCII. Every byte of a multibyte rune
// is >= utf8.RuneSelf and so cannot be in the alphabet, so it resets to root
// just as the rune scan does.
if e.asciiOnly {
	for i := 0; i < len(text); i++ {
		ai, ok := e.codeByte(text[i])
		if !ok {
			state = 0
			continue
		}
		v := e.dfa[state*alpha+ai]
		state = int(v &^ hasOutputBit)
		if v&hasOutputBit == 0 {
			continue
		}
		matched = e.out.appendChain(matched, state)
	}
	// ...
}
```

멀티바이트 문자의 모든 바이트는 `0x80` 이상이라 ASCII 알파벳에 들어갈 수 없으므로, 바이트 단위로 스캔해도 룬 단위 스캔과 똑같이 루트로 돌아간다. `Find`는 오프셋을 보고하지 않아 바이트 인덱스와 룬 인덱스의 차이도 결과에 드러나지 않는다.

### 공통 함수로 묶지 않은 이유

ASCII 루프와 룬 루프가 거의 같아 공통 `scan(text, onOutput)` 함수로 묶어 봤지만 결과 슬라이스를 클로저로 캡처하자 슬라이스가 힙으로 이동하고 매칭마다 포인터를 거쳐 쓰는 비용이 생겼다. 측정해 보니 `PresetSpeed`의 ASCII 매칭 경로는 12\~17% 느려졌다(키워드 1,000개에서 2,979 → 3,483 ns). 멀티바이트 텍스트와 매칭 없는 텍스트에서는 빨라졌어도 주요 경로의 손해를 메울 만큼은 아니었으므로, 중복을 남기고 그 판단에 쓴 측정값을 주석으로 적어 두었다.

## Bloom 필터를 제거한 과정

ACOR에는 `PresetUltimate`라는 프리셋이 있었는데, v0.8.0에서 별도 Ultimate 엔진을 `Balanced`에 합치며 `Balanced` 앞에 Bloom 사전 필터를 붙였다. 매칭이 드문 텍스트에서 불필요한 전이를 줄이려고 스캔 전에 "이 위치에서 키워드가 시작될 수 있는가"를 필터로 먼저 확인하는 방식이었다.

ASCII 바이트 스캔을 넣고 나서 다시 측정해 보니 Bloom 필터를 거치는 쪽이 **1.7\~1.8배 느렸다.** 스캔 비용이 충분히 낮아지면서 오히려 필터를 확인하는 비용이 더 커졌고, 필터 때문에 바이트 스캔 경로도 탈 수 없었다.

그래서 v0.11.0에서 `PresetUltimate`를 `PresetBalanced`의 deprecated 별칭으로 바꾸고 Bloom 필터를 뺐는데, 기존 코드는 그대로 컴파일되면서 더 빠른 엔진을 쓰게 했고 별칭은 v1.5.0에서 삭제했다. 반면 메모리를 아끼는 것이 목적인 `PresetMemoryEfficient`는 Bloom 필터를 그대로 유지하고 있으니, 같은 기법이라도 엔진의 목적에 따라 득실이 달라진다.

## 성능 작업이 찾은 정확성 버그

v0.9.0에서 실패 링크 구성 코드를 최적화하다가 결과를 틀리게 만드는 버그 두 개를 찾았다.

**goto 전이를 두 번 적용했다.** `Speed`와 `MemoryEfficient` 엔진의 실패 링크를 만들 때 goto 전이 하나가 두 번 적용되고 있었다. `{a, aa, aaa}`처럼 접미사가 겹치는 키워드 집합에서 `MemoryEfficient`의 `Find`는 무한 루프에 빠질 수 있었고, `Speed`는 매칭을 조용히 빠뜨렸다.

**DFA를 상태 ID 순서로 채웠다.** `Speed` 엔진은 DFA 전이 표를 상태 ID 순으로 채웠는데, 실패 링크가 **나중에 삽입된** 상태를 가리키면 아직 비어 있는 전이를 참조하게 됐다. Aho-Corasick의 실패 링크는 항상 더 얕은 상태를 가리키므로, 너비 우선(BFS) 순으로 채우도록 바꿔 참조할 상태가 먼저 완성되게 했다.

두 버그 모두 기존 테스트는 통과하고 있었는데, 성능 작업 중에 엔진별 결과를 서로 비교하는 테스트를 늘리면서 드러났다. 빠르게 만드는 작업에는 같은 결과를 내는지 확인하는 작업이 반드시 따라와야 한다는 것을 다시 느꼈다.

## FindSet의 메모리 할당 줄이기

`FindSet`은 매칭된 키워드를 중복 없이 처음 나온 순서대로 돌려주는데, 처음에는 문자열을 키로 써 중복을 걸렀다. v1.5.0에서 이를 4바이트 패턴 ID로 바꾸고 키워드 문자열은 엔진을 만들 때 한 번만 저장(interning)하게 했다. 키워드 1,000개에서 속도는 1.4\~3.2배 빨라졌고 쿼리당 할당도 178 KB/44회에서 35 KB/10회로 줄었지만 매칭이 드문 텍스트는 원래 할당할 일이 없어 변화가 없었다.

같은 맥락에서 `Find`와 `FindSet`은 매칭이 하나도 없으면 결과 슬라이스를 할당하지 않는다. 필터로 쓰는 경우에는 대부분의 텍스트가 아무것도 매칭하지 않으므로 결과를 위해 메모리를 할당할 이유가 없다.

## 마치며

성능을 비교할 때는 캐시 유무와 `Preset` 설정을 맞춰 같은 조건에서 측정해야 한다. 왕복 횟수는 저장소 경계에서 확인하고 실행 시간은 측정 환경과 함께 기록하며 V1 쓰기 수치는 현재 API의 사용법이 아닌 과거 구현과의 비교값으로 읽어야 한다.

벤치마크 재현 명령과 전체 표는 [ACOR 문서의 Benchmarks 페이지](https://skyoo2003.github.io/acor/reference/benchmarks/)에 있다. 전체 소스 코드는 [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor)에서 확인할 수 있다.
