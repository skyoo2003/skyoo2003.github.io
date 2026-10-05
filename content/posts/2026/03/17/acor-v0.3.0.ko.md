---
title: "ACOR v0.3.0: 새로운 기능 소개"
description: "ACOR에 추가된 매칭 위치를 돌려주는 Index API, Redis Sentinel·Cluster·Ring 지원, 커맨드라인 도구, HTTP·gRPC 서버 어댑터를 소개한다."
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor]
---

[ACOR](https://github.com/skyoo2003/acor) v0.3.0을 릴리즈했다. v0.2.0 이후로 한동안 손을 놓고 있다가 오랜만에 기능을 꽤 많이 추가한 릴리즈다. 크게 정리하면 아래 네 가지다.

1. 매칭된 위치까지 알려주는 **Index API**
2. Sentinel, Cluster, Ring 등 **Redis 토폴로지 지원**
3. 터미널에서 바로 쓸 수 있는 **CLI**
4. HTTP와 gRPC로 노출하는 **서버 어댑터**

하나씩 사용법 위주로 정리해보려 한다. 예제의 출력은 모두 v0.3.0을 빌드해서 로컬 Redis에 실제로 실행해본 결과다.

## Index API

기존 `Find`, `Suggest`는 어떤 키워드가 매칭되었는지만 알려줬다. 그런데 매칭된 부분을 하이라이팅하려면 위치도 필요해서, 키워드별 시작 인덱스를 함께 반환하는 `FindIndex`, `SuggestIndex`를 추가했다.

```go
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) Suggest(input string) ([]string, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

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

	for _, k := range []string{"he", "her", "his", "him"} {
		ac.Add(k)
	}

	matched, _ := ac.FindIndex("he is him and she is her")
	fmt.Println(matched)
	// map[he:[0 15 21] her:[21] him:[6]]
}
```

"she" 안의 "he"(15)와 "her" 앞의 "he"(21)까지 모두 잡히는 것을 볼 수 있다. 참고로 같은 입력을 `Find`로 검색하면 `[he him he he her]`처럼 매칭된 횟수만큼 중복해서 반환한다.

인덱스는 바이트가 아니라 **문자(rune) 단위**다. 문자열을 `range`로 순회하면서 rune 단위로 위치를 세기 때문에, 한글이 섞여 있어도 기대한 위치가 나온다.

```go
ac.Add("한글")
matched, _ := ac.FindIndex("가한글")
// map[한글:[1]]  (바이트 기준이었다면 3)
```

`SuggestIndex`는 입력으로 시작하는 키워드를 찾는 것이라 위치는 항상 0이다. 위치가 필요 없다면 기존 `Find`/`Suggest`를 쓰면 된다.

## Redis 토폴로지 지원

지금까지는 단일 Redis만 연결할 수 있었는데, 이제 `AhoCorasickArgs`에 설정한 값에 따라 클라이언트 종류를 골라서 생성한다.

```go
type AhoCorasickArgs struct {
	Addr       string            // Standalone
	Addrs      []string          // Sentinel 또는 Cluster
	MasterName string            // Sentinel 마스터 이름
	RingAddrs  map[string]string // Ring 샤드
	Password   string
	DB         int
	Name       string
	Debug      bool
}
```

선택 순서는 `RingAddrs`가 있으면 Ring, `MasterName`이 있으면 Sentinel, `Addrs`만 있으면 Cluster, 나머지는 Standalone이다.

```go
// Sentinel
args := &acor.AhoCorasickArgs{
	Addrs:      []string{"localhost:26379", "localhost:26380"},
	MasterName: "mymaster",
	Name:       "sample",
}

// Cluster (DB 번호는 지정할 수 없다)
args := &acor.AhoCorasickArgs{
	Addrs: []string{"localhost:7000", "localhost:7001", "localhost:7002"},
	Name:  "sample",
}

// Ring
args := &acor.AhoCorasickArgs{
	RingAddrs: map[string]string{
		"shard-1": "localhost:7000",
		"shard-2": "localhost:7001",
	},
	Name: "sample",
}
```

설정이 서로 충돌하거나(예를 들어 Cluster인데 `DB`를 지정한 경우), Sentinel 주소가 비어 있는 경우에는 `Create`가 `ErrRedisClusterDB`, `ErrRedisSentinelAddrs` 같은 에러를 반환한다.

### Cluster를 위한 키 이름 변경

Cluster를 지원하면서 가장 신경 쓴 부분은 키 이름이다. Cluster에서는 키마다 해시 슬롯이 달라서, 한 컬렉션의 키가 여러 노드에 흩어지면 곤란하다. 그래서 모든 키 앞에 `{컬렉션 이름}`을 hash tag로 붙여서 같은 슬롯에 들어가도록 했다.

```
{sample}:keyword
{sample}:prefix
{sample}:suffix
{sample}:output:<state>
{sample}:node:<keyword>
```

예전에는 `<state>:output`, `<keyword>:node`처럼 컬렉션 이름 없이 키를 만들고 있어서, 이름이 다른 컬렉션끼리도 output 키가 섞일 수 있는 문제가 있었다. 이번 변경으로 이 부분도 같이 정리되었다. **다만 키 형식이 바뀌었기 때문에, 이전 버전으로 저장한 데이터는 그대로 읽을 수 없다.** 업그레이드한다면 키워드를 다시 등록해야 한다.

### 에러 처리

이전에는 Redis 명령이 실패해도 결과를 그냥 무시하는 부분이 많았다. 이번 버전부터는 `Create`를 포함해서 Redis를 사용하는 모든 메서드가 `error`를 함께 반환한다. 또, `Add` 도중 트라이를 만들다가 실패하면 방금 추가한 키워드를 다시 지워서, 키워드 목록과 트라이가 어긋난 상태로 남지 않도록 했다.

## CLI

`cmd/acor`가 드디어 실제로 동작하는 CLI가 되었다. (v0.2.0에서 빈 껍데기로 넣어두었던 그것이다.)

```bash
$ go install github.com/skyoo2003/acor/cmd/acor@v0.3.0
```

릴리즈 페이지에서 OS별 바이너리를 내려받아도 된다. 결과는 JSON으로 출력하기 때문에 `jq` 같은 도구와 같이 쓰기 편하다.

```bash
$ acor -addr localhost:6379 -name sample add he
{"count":1}
$ acor -addr localhost:6379 -name sample add him
{"count":1}

$ acor -addr localhost:6379 -name sample find "he is him"
{"matches":["he","him"]}

$ acor -addr localhost:6379 -name sample find-index "he is him"
{"matches":{"he":[0],"him":[6]}}

$ acor -addr localhost:6379 -name sample info
{"keywords":2,"nodes":5}
```

| 명령어 | 설명 |
|---|---|
| `add <keyword>` / `remove <keyword>` | 키워드 추가 / 삭제 |
| `find <input>` / `find-index <input>` | 텍스트 검색 (위치 포함) |
| `suggest <input>` / `suggest-index <input>` | 입력으로 시작하는 키워드 조회 |
| `info` | 키워드 수, 노드 수 조회 |
| `flush` | 컬렉션 데이터 전체 삭제 |

전역 옵션은 라이브러리의 `AhoCorasickArgs`와 1:1로 대응한다. `-addr`, `-addrs`(쉼표 구분), `-master-name`, `-ring-addrs`(`shard=addr` 쉼표 구분), `-password`, `-db`, `-name`(기본값 `default`), `-debug`가 있다.

## 서버 어댑터

ACOR를 라이브러리로 직접 import 하지 않는 서비스에서도 쓸 수 있도록, `pkg/server` 패키지에 HTTP와 gRPC 어댑터를 추가했다. 둘 다 `*acor.AhoCorasick`를 그대로 넘기면 된다.

```go
ac, err := acor.Create(&acor.AhoCorasickArgs{Addr: "localhost:6379", Name: "sample"})
if err != nil {
	log.Fatal(err)
}
defer ac.Close()

// HTTP
httpServer := server.NewHTTPServer(":8080", ac)
go httpServer.ListenAndServe()

// gRPC
lis, err := net.Listen("tcp", ":50051")
if err != nil {
	log.Fatal(err)
}
grpcServer := server.NewGRPCServer(ac)
log.Fatal(grpcServer.Serve(lis))
```

### HTTP

| Method | Path | 요청 바디 |
|---|---|---|
| GET | `/healthz` | |
| POST | `/v1/add`, `/v1/remove` | `{"keyword": "..."}` |
| POST | `/v1/find`, `/v1/find-index` | `{"input": "..."}` |
| POST | `/v1/suggest`, `/v1/suggest-index` | `{"input": "..."}` |
| GET | `/v1/info` | |
| POST | `/v1/flush` | |

```bash
$ curl -X POST http://localhost:8080/v1/find \
    -H "Content-Type: application/json" \
    -d '{"input": "he is him"}'
{"matches":["he","him"]}
```

### gRPC

gRPC 쪽은 조금 특이하게 만들었는데, `.proto` 파일과 protobuf 코드 생성 없이 **JSON 코덱**을 사용한다. `NewGRPCServer`가 서버에 JSON 코덱을 강제하고, 서비스 이름은 `acor.server.v1.Acor`, 요청/응답 타입은 HTTP와 같은 구조체를 그대로 쓴다. 의존성을 늘리지 않으려고 이렇게 했는데, 대신 클라이언트도 JSON 코덱을 지정해서 호출해야 한다.

```go
conn, err := grpc.Dial("localhost:50051",
	grpc.WithTransportCredentials(insecure.NewCredentials()),
	grpc.WithDefaultCallOptions(grpc.ForceCodec(server.JSONCodec{})),
)
if err != nil {
	log.Fatal(err)
}
defer conn.Close()

var resp server.MatchesResponse
err = conn.Invoke(context.Background(), server.GRPCMethodFind,
	&server.InputRequest{Input: "he is him"}, &resp)
fmt.Println(resp.Matches) // [he him]
```

즉, 일반적인 protobuf 기반 gRPC 클라이언트(`grpcurl` 등)로는 그대로 호출할 수 없다는 점은 참고하자. 다른 언어에서 붙어야 한다면 HTTP 쪽을 쓰는 편이 간단하다.

## 정리

v0.3.0은 라이브러리로만 쓰던 ACOR를 CLI나 별도 서버로도 쓸 수 있게 만든 릴리즈라고 할 수 있다. 다만 키 형식이 바뀌었으니 업그레이드할 때는 데이터를 다시 등록해야 한다는 점을 꼭 기억하자.

자세한 내용은 [GitHub 저장소](https://github.com/skyoo2003/acor)와 [문서 사이트](https://skyoo2003.github.io/acor/)를 참고하자.
