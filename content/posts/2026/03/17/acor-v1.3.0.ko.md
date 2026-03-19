---
title: "ACOR v1.3.0: 새로운 기능 소개"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor)은 Aho-Corasick 알고리즘을 Go로 구현하고 Redis를 백엔드 저장소로 사용하는 라이브러리다. 최신 버전에서는 네 가지 주요 기능이 추가되었다:

1. **Index APIs** - 매칭된 키워드의 위치 정보 제공
2. **Redis 토폴로지 지원** - Sentinel, Cluster, Ring 지원
3. **커맨드라인 도구** - 터미널에서 바로 사용 가능
4. **서버 어댑터** - HTTP와 gRPC로 서비스 배포

이 포스트에서는 각 기능의 사용법과 특징을 살펴본다.

## Index APIs

### 기존 API와의 차이점

이전에는 `Find`와 `Suggest` API가 어떤 키워드가 매칭되었는지만 알려줬다. 텍스트 하이라이팅이나 위치 기반 분석을 위해서는 별도로 인덱스를 계산해야 했다.

새로운 Index APIs는 이 문제를 해결한다:

```go
// 기존: 키워드 목록만 반환
func (ac *AhoCorasick) Find(text string) ([]string, error)

// 새로운: 키워드와 시작 인덱스를 함께 반환
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

### 사용 예제

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

    keywords := []string{"he", "her", "his", "him"}
    for _, k := range keywords {
        ac.Add(k)
    }

    matched, _ := ac.FindIndex("he is him and she is her")
    fmt.Println(matched)
    // 출력: map[he:[0] him:[6] her:[21]]
}
```

### Unicode 처리

Index APIs는 Unicode를 올바르게 처리한다. Go의 `range` 문은 문자열을 rune 단위로 순회하여 한글, 이모지 등 멀티바이트 문자에서도 올바른 인덱스를 보장한다:

```go
matched, _ := ac.FindIndex("가한글")
// 결과: map[string][]int{"한글": {1}}  // 바이트가 아닌 문자 인덱스
```

### 성능 고려사항

Index APIs는 `map[string][]int` 구조로 인덱스 정보를 저장하고, 매칭 시점마다 rune 길이를 계산하는 오버헤드가 있다. 인덱스 정보가 필요하지 않은 단순 존재 여부 확인에는 기존 `Find`/`Suggest`를 사용하는 것이 효율적이다.

## Redis 토폴로지 지원

### 지원하는 토폴로지

이제 다양한 Redis 배포 방식을 지원한다:

```go
type AhoCorasickArgs struct {
    Addr       string            // Standalone
    Addrs      []string          // Sentinel 또는 Cluster
    MasterName string            // Sentinel 마스터 이름
    RingAddrs  map[string]string // Ring 샤드
    Password   string
    DB         int
    Name       string
}
```

**Standalone**

```go
args := &acor.AhoCorasickArgs{
    Addr:     "localhost:6379",
    Password: "",
    DB:       0,
    Name:     "sample",
}
```

**Redis Sentinel**

```go
args := &acor.AhoCorasickArgs{
    Addrs:      []string{"localhost:26379", "localhost:26380"},
    MasterName: "mymaster",
    Password:   "",
    DB:         0,
    Name:       "sample",
}
```

**Redis Cluster**

```go
args := &acor.AhoCorasickArgs{
    Addrs:    []string{"localhost:7000", "localhost:7001", "localhost:7002"},
    Password: "",
    Name:     "sample",
}
```

**Redis Ring**

```go
args := &acor.AhoCorasickArgs{
    RingAddrs: map[string]string{
        "shard-1": "localhost:7000",
        "shard-2": "localhost:7001",
    },
    Password: "",
    DB:       0,
    Name:     "sample",
}
```

### Cluster 안전 키 설계

Redis Cluster에서는 키가 여러 샤드에 분산된다. ACOR은 하나의 컬렉션에 속한 모든 키가 같은 샤드에 저장되도록 hash tag를 사용한다:

```
{collection-name}:prefix:state
{collection-name}:output:keyword
```

### 에러 핸들링

모든 Redis 관련 API가 명시적으로 에러를 반환하도록 개선되었다:

```go
ac, err := acor.Create(args)
if err != nil {
    log.Fatalf("Redis 연결 실패: %v", err)
}
defer ac.Close()

matched, err := ac.Find("he is him")
if err != nil {
    log.Printf("검색 중 에러 발생: %v", err)
    return
}
fmt.Println(matched)
```

`Add` 메서드는 실패 시 롤백을 수행하여 데이터 일관성을 보장한다.

## 커맨드라인 도구

### 설치

**바이너리 다운로드**

```bash
# macOS (Apple Silicon)
curl -LO https://github.com/skyoo2003/acor/releases/latest/download/acor_darwin_arm64.tar.gz
tar xzf acor_darwin_arm64.tar.gz
sudo mv acor /usr/local/bin/

# Linux (x86_64)
curl -LO https://github.com/skyoo2003/acor/releases/latest/download/acor_linux_amd64.tar.gz
tar xzf acor_linux_amd64.tar.gz
sudo mv acor /usr/local/bin/
```

**소스에서 빌드**

```bash
git clone https://github.com/skyoo2003/acor.git
cd acor
make build
```

### 기본 사용법

```bash
# 키워드 추가
acor -addr localhost:6379 -name sample add "he"
acor -addr localhost:6379 -name sample add "her"
acor -addr localhost:6379 -name sample add "him"

# 텍스트 검색
acor -addr localhost:6379 -name sample find "he is him"
# 출력: he
#       him

# 위치 정보와 함께 검색
acor -addr localhost:6379 -name sample find-index "he is him"
# 출력: he: [0]
#       him: [6]

# 자동완성 제안
acor -addr localhost:6379 -name sample suggest "he"
# 출력: he
#       her
```

### 주요 명령어

| 명령어          | 설명                      |
| --------------- | ------------------------- |
| `add`           | 키워드 추가               |
| `remove`        | 키워드 삭제               |
| `find`          | 텍스트 검색               |
| `find-index`    | 위치 정보와 함께 검색     |
| `suggest`       | 자동완성 제안             |
| `suggest-index` | 위치 정보와 함께 자동완성 |
| `info`          | 컬렉션 정보               |
| `flush`         | 컬렉션 삭제               |

### 공통 옵션

| 옵션           | 설명                       | 기본값           |
| -------------- | -------------------------- | ---------------- |
| `-addr`        | Redis 단일 주소            | `localhost:6379` |
| `-addrs`       | Sentinel/Cluster 주소 목록 |                  |
| `-master-name` | Sentinel 마스터 이름       |                  |
| `-ring-addrs`  | Ring 샤드                  |                  |
| `-password`    | Redis 비밀번호             |                  |
| `-db`          | Redis 데이터베이스 번호    | `0`              |
| `-name`        | ACOR 컬렉션 이름           | (필수)           |

## 서버 어댑터

### 아키텍처

`pkg/server` 패키지가 기존 `pkg/acor` API를 HTTP JSON과 gRPC로 노출한다:

```
┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ HTTP/gRPC   │
└─────────────┘     │   Server    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  pkg/acor   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Redis    │
                    └─────────────┘
```

### HTTP 서버

```go
package main

import (
    "log"
    "net/http"

    "github.com/skyoo2003/acor/pkg/acor"
    "github.com/skyoo2003/acor/pkg/server"
)

func main() {
    ac, err := acor.Create(&acor.AhoCorasickArgs{
        Addr: "localhost:6379",
        Name: "sample",
    })
    if err != nil {
        log.Fatal(err)
    }
    defer ac.Close()

    httpHandler := server.NewHTTPHandler(ac)
    http.Handle("/", httpHandler)

    log.Println("HTTP server listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}
```

**API 엔드포인트**

| Method | Path             | 설명                      |
| ------ | ---------------- | ------------------------- |
| POST   | `/add`           | 키워드 추가               |
| POST   | `/remove`        | 키워드 삭제               |
| POST   | `/find`          | 텍스트 검색               |
| POST   | `/find-index`    | 위치 정보와 함께 검색     |
| POST   | `/suggest`       | 자동완성 제안             |
| POST   | `/suggest-index` | 위치 정보와 함께 자동완성 |
| GET    | `/info`          | 컬렉션 정보               |
| POST   | `/flush`         | 컬렉션 삭제               |

**요청 예제**

```bash
curl -X POST http://localhost:8080/find \
  -H "Content-Type: application/json" \
  -d '{"text": "he is him"}'
```

```json
{
  "matched": ["he", "him"]
}
```

### gRPC 서버

**서버 구현**

```go
package main

import (
    "log"
    "net"

    "github.com/skyoo2003/acor/pkg/acor"
    "github.com/skyoo2003/acor/pkg/server"
    "google.golang.org/grpc"
)

func main() {
    ac, err := acor.Create(&acor.AhoCorasickArgs{
        Addr: "localhost:6379",
        Name: "sample",
    })
    if err != nil {
        log.Fatal(err)
    }
    defer ac.Close()

    lis, err := net.Listen("tcp", ":50051")
    if err != nil {
        log.Fatal(err)
    }

    grpcServer := grpc.NewServer()
    server.RegisterGRPCServer(grpcServer, ac)

    log.Println("gRPC server listening on :50051")
    grpcServer.Serve(lis)
}
```

**클라이언트 예제**

```go
conn, _ := grpc.Dial("localhost:50051", grpc.WithInsecure())
defer conn.Close()

client := pb.NewAhoCorasickClient(conn)
resp, _ := client.Find(context.Background(), &pb.FindRequest{Text: "he is him"})
fmt.Println(resp.Matched) // [he, him]
```

### HTTP vs gRPC 선택 가이드

| 기준     | HTTP             | gRPC              |
| -------- | ---------------- | ----------------- |
| 프로토콜 | HTTP/1.1 + JSON  | HTTP/2 + Protobuf |
| 성능     | 보통             | 높음              |
| 디버깅   | curl 등으로 쉬움 | 도구 필요         |
| 스트리밍 | 미지원           | 지원              |

HTTP는 디버깅과 빠른 프로토타이핑에, gRPC는 고성능이 필요한 프로덕션 환경에 적합하다.

### 배포

**Docker**

```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY . .
RUN go build -o server ./cmd/server

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/server .
EXPOSE 8080 50051
CMD ["./server"]
```

```bash
docker build -t acor-server .
docker run -p 8080:8080 -p 50051:50051 acor-server
```

**Kubernetes**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: acor-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: acor-server
  template:
    spec:
      containers:
        - name: acor-server
          image: acor-server:latest
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 50051
              name: grpc
          env:
            - name: REDIS_ADDR
              value: "redis-service:6379"
```

## 마치며

이번 업데이트로 ACOR의 활용 범위가 크게 확장되었다:

- **Index APIs**: 텍스트 하이라이팅, 위치 기반 분석 가능
- **Redis 토폴로지**: 프로덕션 환경에서 고가용성과 확장성 확보
- **CLI**: 스크립트와 결합한 자동화, 빠른 테스트 가능
- **서버 어댑터**: 마이크로서비스 아키텍처에 쉽게 통합

더 자세한 내용은 [ACOR GitHub 저장소](https://github.com/skyoo2003/acor)와 [공식 문서](https://skyoo2003.github.io/acor/)를 참고하자.
