---
title: "ACOR의 로컬 캐시 무효화: Redis Pub/Sub로 여러 인스턴스를 맞추기"
date: 2026-10-01T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, redis, acor, caching]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor)은 Aho-Corasick 사전을 Redis에 저장하는 Go 라이브러리다. 사전이 Redis에 있으면 여러 프로세스가 같은 키워드 집합을 공유할 수 있지만, 그만큼 `Find`를 호출할 때마다 Redis에서 사전을 읽어야 하는 비용이 따른다.

v0.5.0에서는 이 비용을 줄이려고 **로컬 캐시**를 넣어, 각 인스턴스가 메모리에 사전의 automaton을 보관하고 `Find`를 로컬에서 처리하도록 했는데, 그러자 인스턴스 A가 키워드를 추가했을 때 인스턴스 B가 오래된 캐시를 어떻게 버리게 할 것인가 하는 문제가 남았다.

해결 방법으로는 쓰기 후 컬렉션 채널에 무효화 메시지를 publish하고 모든 인스턴스가 이를 구독하는 Redis Pub/Sub를 선택했다. 구조는 단순했지만 v0.5.0부터 v1.6.0까지 네 번의 버그를 겪으면서 분산 로컬 캐시를 만들 때 어떤 문제에 부딪히는지 알게 됐는데, 이 글에서는 그 경험을 정리해보려 한다.

## 기본 구조

V2 스키마에서 `EnableCache`를 켠 경우와 로컬 엔진으로 검색하는 `Preset` 모드는 모두 캐시를 사용하며, 무효화도 같은 흐름을 따른다.

```
 인스턴스 A                     Redis                     인스턴스 B
 ──────────                     ─────                     ──────────
 Add("hello") ──쓰기──────────▶ 사전 갱신
 로컬 캐시 갱신
 PUBLISH ─────────────────────▶ acor:invalidate:<name> ──▶ 메시지 수신
                                                          로컬 캐시 무효화
                                                          다음 Find에서 재빌드
```

쓴 쪽은 자기 캐시를 이미 갱신한 상태라 자기가 보낸 메시지를 다시 받더라도 무시해야 하는데, 이 "자기 메시지 무시"부터 문제가 생겼다.

## 문제 1: 자기 메시지로 자기 캐시를 버리다

Pub/Sub에서는 publish한 클라이언트도 같은 채널을 구독하고 있으면 자기 메시지를 받는다. v0.5.0의 첫 구현은 이를 고려하지 않아서, 쓰기를 하고 로컬 캐시를 갱신한 다음 publish하면 자기 메시지를 받아 방금 갱신한 캐시를 버리고 있었다. 다음 `Find`에서 다시 읽으니 결과가 틀리지는 않았지만 쓰기마다 불필요한 재빌드 비용을 내고 있었다.

v0.5.1에서는 처음에 publish 직전 "다음 메시지는 내 것"이라고 표시하는 boolean 플래그를 넣었는데, 쓰기가 동시에 두 번 일어나면 플래그 하나로는 구분할 수 없어 곧 `int32` 원자 카운터로 바꿨다. publish할 때 카운터를 올리고 메시지를 받을 때 값이 0보다 크면 하나 내린 뒤 무시하는 방식이었다.

## 문제 2: 카운터가 새다

그런데 v0.6.0에서 카운터의 결함이 드러났다. Pub/Sub는 **best-effort**라 네트워크 문제나 버퍼 초과로 유실된 메시지를 Redis가 다시 보내 주지 않는데, 자기 메시지 하나가 사라지면 카운터가 1에서 내려오지 않는다. 이 상태에서 **다른 인스턴스의** 메시지가 도착하면 자기 메시지로 오인해 무시하므로, 캐시는 오래된 사전을 계속 쓰게 된다.

카운터로는 "몇 개가 내 것인가"만 알 수 있고 "어느 것이 내 것인가"는 구분할 수 없어, 메시지마다 고유 ID를 붙이는 방식으로 바꿨다.

```go
// newInvalidationID returns an id unique to this publish. The timestamp keeps
// ids ordered for debugging; the random suffix keeps two instances publishing in
// the same nanosecond from generating the same id — a collision is the dangerous
// direction, since the loser would mistake the winner's message for its own echo
// and skip a real invalidation.
func newInvalidationID() string {
	b := make([]byte, invalidateIDBytes)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%d:%x", time.Now().UnixNano(), b)
}
```

publish할 때 ID를 `sync.Map`에 기록하고 받은 메시지의 ID가 맵에 남아 있으며 TTL 안에서 유효한 경우에만 자기 메시지로 보고 무시한다. ID가 없거나 만료됐다면 캐시를 버리고, timestamp와 난수를 함께 써서 다른 메시지와 충돌할 가능성도 낮췄다. 이렇게 하면 메시지가 유실돼도 카운터처럼 미처리 횟수가 남아 다음 메시지까지 무시하는 일은 없다.

쓸모없는 항목이 계속 쌓이는 문제는 TTL을 붙여 처리했는데, 현재 코드는 다음과 같다.

```go
// selfSkipTTL bounds how long a self-published ID is remembered. A publish whose
// message never comes back — dropped delivery, a listener restart — would
// otherwise leak an entry forever. 30s is orders of magnitude beyond normal
// Redis pub/sub delivery latency.
const selfSkipTTL = 30 * time.Second

// claim atomically consumes id, reporting whether it was a live self-publish.
// An expired or unknown id returns false, so the caller invalidates.
func (s *selfSkipSet) claim(id string) bool {
	val, loaded := s.ids.LoadAndDelete(id)
	if !loaded {
		return false
	}
	t, ok := val.(time.Time)
	if !ok {
		return false
	}
	age := time.Since(t)
	// A negative age means the clock moved backwards; treat it as untrustworthy
	// and invalidate rather than skip.
	if age < 0 {
		return false
	}
	return age < selfSkipTTL
}
```

여기에는 몇 가지 의도한 선택이 들어 있다.

- **publish 횟수에 따라 만료 항목을 정리한다.** 128번 publish할 때마다 맵 전체를 한 번 훑으므로 별도 고루틴이 필요 없다. publish가 없으면 만료 항목이 다음 정리까지 남을 수 있지만, 메시지를 받을 때 TTL을 확인하기 때문에 만료된 ID로 메시지를 무시하는 일은 없다.
- **애매하면 무효화한다.** ID가 없거나, 만료됐거나, 시계가 거꾸로 갔거나, 메시지를 파싱할 수 없으면 모두 "다른 인스턴스의 메시지"로 취급한다. 불필요한 재빌드는 성능 문제에 그치지만 놓친 무효화는 정확성 문제이므로, 비용이 비대칭인 만큼 판단도 한쪽으로 기울였다.
- **`LoadAndDelete`로 한 번만 쓴다.** 덕분에 같은 ID로 메시지를 두 번 무시하는 일은 없다.

## 문제 3: 유실된 무효화는 영원히 오래된다

자기 메시지를 구분하고 나니 이번에는 **다른 인스턴스의** 무효화 메시지가 유실되는 경우를 다뤄야 했다. 이를 받지 못한 인스턴스는 사전이 바뀐 줄 모르고 다음 쓰기까지 오래된 캐시로 검색하므로, 쓰기가 드문 사전에서는 몇 시간 동안 같은 상태가 이어질 수도 있다.

Pub/Sub 자체를 신뢰할 수 있는 채널로 바꿀 수는 없으니, v0.10.0에서 메시지 유실에 대비한 **폴링**을 추가했다. `AhoCorasickArgs.InvalidationPollInterval`을 설정하면 `Preset` 모드가 Redis를 주기적으로 확인하는데, v1.6.0부터는 **버전 필드만** 읽는다. 버전이 바뀐 경우에만 다음 검색에서 전체 사전을 읽고 엔진을 다시 만들기 때문에 폴링 비용은 사전 크기에 영향을 받지 않는다.

다만 문서에는 이 장치의 한계도 분명히 적어 두었다. 폴링 자체가 실패하면 다음 틱에 다시 시도할 뿐이므로, 폴링 간격을 실패 상황에서 캐시가 오래된 채로 남는 시간의 상한으로 볼 수는 없다. 그래서 v1.6.0은 실패 횟수를 세는 카운터 `PresetPollFailures`와 `PresetReloadFailures`도 함께 노출한다.

같은 릴리즈에서는 재빌드 실패도 검색 결과에 드러나게 했다. 재로드가 실패하면 이전 엔진을 유지하되 **검색에 에러를 돌려줘**, 오래된 결과가 정상 결과처럼 나가지 않도록 한 것이다.

## 문제 4: 커밋한 것과 다른 것으로 재빌드하다

마지막은 v1.5.0에서 고친 lost update 버그인데, `Preset` 모드에서 `Add`나 `Remove`를 한 번 호출하면 방금 Redis에 커밋한 스냅샷 대신 **증분으로 관리하던 키워드 집합**으로 로컬 automaton을 다시 만들고 있었다.

두 집합은 대부분 같아 보이지만 다른 인스턴스가 그사이에 추가한 키워드는 증분 집합에 들어 있지 않다. 이 집합으로 재빌드하면 다른 인스턴스의 키워드가 엔진에서 사라지는데, 쓰기를 마친 인스턴스는 자기 캐시가 최신이라고 믿고 다시 읽지도 않으니 사라진 키워드가 돌아오지 않았다.

배치 쓰기(`AddMany`, `RemoveMany`)는 이미 커밋한 스냅샷을 적용하고 있었고 단일 쓰기만 다른 경로를 타고 있었기 때문에, 단일 쓰기도 커밋한 스냅샷을 적용하도록 맞췄다.

```
 증분 집합으로 재빌드 (버그)          커밋한 스냅샷으로 재빌드 (수정)
 ───────────────────────────          ─────────────────────────────
 로컬 집합 {a, b} + c                 Redis에 커밋 → 스냅샷 {a, b, x, c}
   → 엔진 {a, b, c}                     → 엔진 {a, b, x, c}
 (다른 인스턴스가 넣은 x 소실)
```

## 관측: CacheStats

네 번의 버그를 겪으며 캐시가 실제로 어떻게 동작하는지 확인할 수단도 필요해졌다. v1.5.0에서 추가한 `AhoCorasick.CacheStats()`는 Redis를 읽지 않으므로 주기적으로 호출해도 부담 없이 상태를 볼 수 있다.

```go
stats := ac.CacheStats()

// Hits+Misses is the read count. Both are zero before the first read.
hitRate := 0.0
if reads := stats.Hits + stats.Misses; reads > 0 {
    hitRate = float64(stats.Hits) / float64(reads)
}

// What one rebuild costs — the price a write makes every reader pay.
meanRebuild := time.Duration(0)
if stats.Rebuilds > 0 {
    meanRebuild = stats.RebuildDuration / time.Duration(stats.Rebuilds)
}

lag := stats.LastInvalidationLag
```

다만 숫자를 읽을 때 주의할 점이 몇 가지 있다.

- **`Rebuilds`는 `Misses`와 같지 않다.** 동시에 일어난 miss는 하나의 빌드로 합쳐지고, 로컬 쓰기는 읽기 경로 밖에서 재빌드한다. 둘 다 `uint64`이므로 빼기 전에 대소를 확인하지 않으면 쓰기가 많은 인스턴스에서 값이 약 1.8e19로 넘어가 버린다.
- **`LastInvalidationLag`에는 시계 차이가 섞인다.** 무효화 ID 앞에 이미 publish 시각이 들어 있으므로, 받는 쪽이 그 시각과 현재 시각의 차이를 재는데, 두 시각이 서로 다른 머신의 시계에서 온 것이라 실제 지연보다 크게도, 작게도 나올 수 있다. 음수는 기록하지 않으며, 값이 갑자기 뛰면 Pub/Sub보다 NTP를 먼저 확인하라고 문서에 적어 두었다.
- **ACOR은 메트릭 라이브러리에 의존하지 않는다.** Prometheus든 OpenTelemetry든 로그든, 이미 쓰고 있는 도구에 값을 넘기면 된다.

## 함께 막아 둔 조합

`EnableCache`와 `Preset`을 함께 켜면 v0.11.0부터 `ErrCacheWithPreset`을 돌려준다. `Preset`은 이미 로컬 엔진에서 읽기를 처리해 캐시 설정이 아무 효과가 없는데도, 예전에는 이를 조용히 무시하는 바람에 사용자가 캐시를 켰다고 믿을 수 있었으므로, 지금은 효과 없는 설정을 명시적으로 거절한다.

## 마치며

메시지를 놓치더라도 폴링과 재로드가 성공하면 저장소의 변경을 다시 확인할 수 있지만 실패가 이어지는 동안에는 폴링 간격만으로 최신성을 보장할 수 없다. 그래서 운영 중에는 `PresetPollFailures`와 `PresetReloadFailures`를 함께 확인하며 캐시가 실제로 갱신되고 있는지 살펴봐야 한다.

전체 소스 코드는 [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor)에서 확인할 수 있다.
