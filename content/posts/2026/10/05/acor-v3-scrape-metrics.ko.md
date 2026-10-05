---
title: "상태 API를 호출해야 갱신되는 메트릭 고치기: ACOR V3의 Prometheus 수집"
description: "상태 API를 호출해야 갱신되던 ACOR V3 메트릭을 Prometheus Collector가 수집 시점에 읽도록 바꾸고 HTTP와 gRPC를 같은 상태 소스에 연결한 과정을 다룬다."
date: 2026-10-05T00:00:00+09:00
tags: [go, acor, prometheus, observability]
---

Prometheus가 `/metrics`를 주기적으로 읽는데도 값이 갱신되지 않을 수 있다. 상태를 Gauge에 옮기는 코드가 다른 API 안에 있다면 수집 주기를 줄여 봐도 달라지는 것은 없고 마지막 API 호출 때의 값을 반복해서 읽을 뿐이다.

ACOR의 V3 서버에도 이 구조가 있었다. HTTP의 `/v1/status`와 `/healthz`, gRPC의 `Status`가 상태를 읽은 뒤 메트릭을 갱신했기 때문에 검색과 백그라운드 갱신만 계속되고 상태 API는 호출되지 않으면 메트릭은 그 변화를 반영하지 못했다. 운영 중에 장애로 겪은 것은 아니고, [변경 전 HTTP 코드](https://github.com/skyoo2003/acor/blob/042048bf5697beda271e388477ec1f5445a24132/server/versioned.go)와 [gRPC 코드](https://github.com/skyoo2003/acor/blob/042048bf5697beda271e388477ec1f5445a24132/server/grpc.go)를 다시 읽다가 발견한 구조다.

이번에는 [수집 시점 갱신을 추가한 변경](https://github.com/skyoo2003/acor/commit/a5ccfaaf98725cadec9a69ab6a6229f570721705)을 중심으로 이 문제를 어떻게 고쳤는지 살펴보려 한다. 참고로 본문의 소스 링크는 v1.7.0 릴리즈 커밋인 [`7182142`](https://github.com/skyoo2003/acor/tree/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8)를 기준으로 한다.

V3의 저장소와 검색 엔진 버전이 나뉘는 이유는 [버전 사전 글](/ko/posts/2026/10/02/acor-v3-versioned-dictionaries/)에서 이미 다뤘다. 기존 캐시의 `CacheStats()`와 무효화 문제는 [로컬 캐시 글](/ko/posts/2026/10/01/acor-distributed-cache-invalidation/#관측-cachestats)을 참고하면 되며 이 글에서는 V3 서버의 상태를 어떻게 수집하는지에 집중한다.

## 갱신 책임을 Collector로 옮기기

이전 흐름은 `상태 API → Status() → Gauge.Set()`이었고 `/metrics`는 이미 저장된 Gauge를 읽었다. 처음에는 기본값이 보이다가 상태 API를 한 번 호출하면 그때의 상태가 다음 호출까지 남는 구조였다.

흐름을 `Prometheus 수집 → Collector.Collect() → Status() → Gauge.Set()`으로 수정하면서 상태 API를 미리 호출할 필요가 없어졌다.

[Collector 구현](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/metrics/metrics.go)에서는 등록된 상태 소스를 먼저 복사하고 잠금을 푼 다음 각 소스의 `Status()`를 호출한다. 이렇게 반환된 상태로 네 GaugeVec의 값을 설정한 뒤 수집 채널로 보내도록 구현했다.

등록 맵의 잠금을 잡은 채로 다른 객체의 메서드를 호출하지 않도록 했고, 한 번의 `Collect()`에서는 컬렉션마다 상태를 한 번만 읽어 네 Gauge를 설정한다. 다만 네 GaugeVec을 하나씩 갱신하는 구조라서, [Collector는 동시에 호출될 수 있으므로](https://pkg.go.dev/github.com/prometheus/client_golang/prometheus#Collector) 두 수집이 겹치면 서로 다른 시점의 값이 섞일 수 있다. 네 값이나 여러 컬렉션을 한 시점의 스냅샷으로 읽는다고 기대해서는 안 된다.

상태 소스에는 아래 메서드 하나가 필요하다.

```go
type VersionedStatusSource interface {
    Status() acor.VersionedStatus
}
```

수집 경로에서 호출되므로 이 메서드는 Redis I/O를 하지 않아야 한다. 실제 [`VersionedCollection.Status()`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/versioned.go)는 로컬 잠금 아래 상태를 복사하고 현재 인스턴스의 lease 수를 채운 뒤 반환한다.

수집이 Redis 장애를 직접 기다리지는 않지만 여기서 읽는 값은 이 인스턴스가 관측한 상태다. 백그라운드 갱신이 Redis의 새 버전을 아직 확인하지 못한 상황에서는 수집을 자주 해도 그 사실을 새로 알아내지는 못한다.

## 컬렉션을 구분하되 라벨을 늘리지 않기

예전 네 Gauge에는 컬렉션 라벨이 없어 하나의 Registry를 여러 V3 컬렉션에 연결하면 마지막 상태 호출이 앞서 기록한 값을 덮을 수 있었다. 이를 구분하도록 새 구조에서는 상태 소스를 `collection` 라벨에 연결한다.

이 라벨은 Redis 컬렉션 이름에서 자동으로 가져오는 대신 운영자가 `moderation-prod`처럼 안정된 식별자를 지정한다. 버전 토큰이나 키워드, 오류 메시지를 라벨로 넣지도 않는다.

등록 함수는 다음 조건을 검사한다.

- 라벨은 1~64바이트이며 ASCII 영문자, 숫자, `.`, `_`, `:`, `-`만 허용한다.
- 상태 소스가 필요하며 nil 포인터도 거절한다.
- 같은 라벨에 같은 소스를 다시 연결하는 것은 허용한다.
- 같은 라벨을 다른 소스에 연결하면 오류를 돌려준다.

실제 `*VersionedCollection`에서는 같은 포인터를 HTTP와 gRPC 생성자에 전달하면 같은 소스로 판단한다. 내부 비교에는 타입이 같고 비교 가능한 값이어야 한다는 조건이 있으므로, 별도 어댑터를 구현했다면 이 조건도 확인해야 한다.

등록 함수는 허용 문자만 검사할 뿐 라벨 개수는 제한하지 않는다. 요청 ID나 매번 바뀌는 배포 ID를 넣으면 시계열이 계속 늘어나니 라벨은 운영 설정에서 고정하고 두 프로토콜이 같은 컬렉션을 가리키도록 연결한다.

## HTTP와 gRPC를 같은 상태 소스에 연결하기

아래 함수는 연결 부분만 담았다. `v3`로 받는 컬렉션은 이미 `OpenVersioned`로 연 상태이며 HTTP와 gRPC의 Serve/Stop 및 컬렉션 종료는 호출자가 담당한다고 가정한다.

```go
package wiring

import (
    "net/http"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "github.com/skyoo2003/acor/pkg/acor"
    "github.com/skyoo2003/acor/server"
    "github.com/skyoo2003/acor/server/metrics"
    "google.golang.org/grpc"
)

func Wire(v3 *acor.VersionedCollection) (http.Handler, *grpc.Server, error) {
    promReg := prometheus.NewRegistry()
    registry := metrics.NewRegistry(promReg)
    obs := &server.VersionedObservability{
        Metrics: registry, Collection: "moderation-prod",
    }
    api, err := server.NewVersionedHTTPHandlerWithObservability(v3, obs)
    if err != nil {
        return nil, nil, err
    }
    rpc, err := server.NewVersionedGRPCServerWithObservability(v3, obs)
    if err != nil {
        return nil, nil, err
    }
    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.HandlerFor(promReg, promhttp.HandlerOpts{}))
    mux.Handle("/", api)
    return mux, rpc, nil
}
```

두 생성자의 오류는 각각 확인한다. HTTP 생성자의 오류를 확인하기 전에 다음 호출에서 `err`를 덮어쓰면 잘못된 연결을 놓칠 수 있기 때문이다. Registry에 등록하는 것과 `/metrics`로 노출하는 것도 별개라 위에서는 같은 Prometheus Registry를 `HandlerFor`에 전달한다.

이 V3 생성자는 컬렉션 상태 메트릭을 연결한다. 일반 요청 수를 세는 gRPC interceptor와 표준 gRPC health 서비스는 [gRPC 구현](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/grpc.go)의 별도 서버 연결 경로에 있으므로 필요하다면 따로 연결해야 한다.

이전 HTTP 생성자에 Registry를 넘기는 방식과 `NewVersionedGRPCServerWithMetrics`는 소스 호환을 위해 남아 있지만 현재는 그 인자로 V3 메트릭을 연결하지 않으므로, 수집하려면 라벨을 받는 `WithObservability` 생성자를 사용해야 한다.

## 네 값이 말해 주는 것

현재 서버가 내보내는 V3 상태 메트릭은 모두 Gauge다.

| 메트릭 | 의미 |
| --- | --- |
| `acor_versioned_building` | 로컬 엔진 후보를 만드는 중이면 1 |
| `acor_versioned_serving_ready` | `ServingVersion`이 있고 `LastError`가 비어 있으면 1 |
| `acor_versioned_refresh_failures` | 이 인스턴스가 관측한 누적 갱신 실패 횟수 |
| `acor_versioned_active_leases` | 이 인스턴스가 보유한 V3 lease 수 |

`building=1`과 `serving_ready=1`은 새 후보를 만드는 동안에도 기존 엔진이 설치되어 있고 오류가 없다면 함께 나올 수 있다. 반대로 빌드가 실패해 끝났다면 `building=0`이어도 `LastError`가 남으므로 갱신이 정상인지 확인하려면 두 값을 함께 봐야 한다.

갱신 실패 시 이전 엔진은 유지되지만 이때 `serving_ready=0`이고 HTTP `/healthz`는 503이다. 설치된 엔진의 존재와 마지막 갱신 오류를 함께 반영한 값이므로 준비 상태가 내려갔다면 검색 엔진이 남아 있는지도 확인할 필요가 있다.

`/v1/status`는 같은 상태를 본문에 `degraded`로 표현해도 HTTP 200을 반환하고 gRPC `Status` 역시 상태 응답의 `status` 필드에 이를 담는다. 그래서 상태 조회의 성공과 서비스 상태 판정을 구분해야 한다. [HTTP 상태 처리](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/versioned.go)에 조건이 명시되어 있다.

내부에서 누적하는 실패 횟수를 Prometheus에서는 Counter가 아닌 Gauge 타입으로 등록하므로 이를 `_total` Counter로 간주해 `rate()` 예제를 붙이면 구현의 계약과 어긋난다. 누적값은 로컬에 남는 값이라 프로세스가 다시 시작되면 초기화된다.

lease 수는 수집 시점의 로컬 보유 수를 뜻하므로 전체 Redis의 lease 수나 동시 요청 수로 해석할 수는 없다. 짧게 생겼다가 사라진 lease라면 두 번의 수집 사이에서 보이지 않을 수 있다.

## 먼저 확인할 쿼리와 남은 관측 범위

준비 상태가 내려간 인스턴스는 다음처럼 찾을 수 있다.

```promql
acor_versioned_serving_ready{collection="moderation-prod"} == 0
```

이 쿼리는 시계열이 없어진 경우를 잡지 못하므로 수집 대상 자체가 살아 있는지는 Prometheus의 `up`과 별도로 확인한다. `building`도 순간 상태를 나타내는 만큼 한 번의 값으로 빌드가 멈췄다고 판단하지 않는다.

모든 복제본을 합치면 일부 인스턴스의 갱신 실패나 편중된 상태를 놓치기 쉬워 실패 횟수와 lease 수는 인스턴스별 원래 값을 함께 본다.

네 Gauge에는 활성 버전과 검색 버전의 차이, 마지막 성공 시각, shard 상태가 들어 있지 않다. 버전 차이와 마지막 성공 시각은 `Status()`나 상태 API로 볼 수 있지만, HTTP와 gRPC 상태 응답에는 shard 필드가 없으므로 shard 상태는 라이브러리의 `Status()`로만 확인할 수 있다.

버전은 같은지 다른지만 의미가 있는 토큰이라 숫자처럼 빼거나 문자열 순서로 지연을 계산할 수 없다. 특정 쓰기가 반영됐는지 확인하려면 타임아웃을 건 context로 `WaitForVersion`을 호출하면 된다. 이 구분은 [모니터링 문서](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/docs/content/operations/monitoring.md)에도 정리해 두었다.

## 회귀 테스트가 확인하는 경계

핵심 테스트에서는 HTTP 요청을 먼저 보내지 않고 가짜 상태 소스를 등록한 뒤 `Gather()`를 호출해 상태가 읽혔는지 확인한다. 이어 소스의 상태를 바꾸고 다시 `Gather()`해 새 값이 나오는지 검사한다.

같은 테스트 파일에서 두 컬렉션의 값을 분리하는지, 잘못된 라벨과 다른 소스의 충돌을 거절하는지도 확인한다. 서버 테스트에서는 HTTP와 gRPC 생성자에 같은 소스를 연결하고 바로 수집해 라벨이 붙은 메트릭을 확인한다. 두 테스트는 각각 [Collector 테스트](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/metrics/metrics_test.go)와 [서버 테스트](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/versioned_test.go)에 있으며, 상태 API를 호출하지 않아도 수집이 동작하는지를 직접 확인한다.

참고로 이 Prometheus 코드는 별도로 버전을 관리하는 실험적인 `github.com/skyoo2003/acor/server` 모듈에 있다. [server/go.mod](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/go.mod)에도 적어 두었듯이 `pkg/acor`의 V3 라이브러리 API와 같은 호환성 약속은 적용되지 않는다.

## 정리

이번 변경으로 상태 API를 먼저 호출하지 않아도 Prometheus 수집 시점에 메트릭이 갱신되도록 했다. 다만 수집하는 값은 로컬에서 관측한 상태다. Redis의 새 버전을 아직 확인하지 못했다면 메트릭에도 나타나지 않으므로 사전 갱신이 정상인지 볼 때는 상태 API도 함께 확인하는 편이 좋겠다.

전체 소스 코드는 [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor)에서 확인할 수 있다.
