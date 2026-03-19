---
title: "ACOR v1.3.0: HTTP와 gRPC 서버 어댑터"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, tutorial]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor) v1.3.0에서 HTTP와 gRPC 서버 어댑터가 추가되었다. 이제 ACOR을 마이크로서비스 아키텍처에 쉽게 통합하거나, 별도의 서버로 배포할 수 있다. 이 포스트에서는 두 어댑터의 사용법과 배포 방법을 살펴본다.

## 아키텍처 개요

v1.3.0에서 `pkg/server` 패키지가 추가되어 기존 `pkg/acor` API를 HTTP JSON과 gRPC로 노출한다:

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

## HTTP 서버

### 기본 사용법

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

### API 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| POST | `/add` | 키워드 추가 |
| POST | `/remove` | 키워드 삭제 |
| POST | `/find` | 텍스트 검색 |
| POST | `/find-index` | 위치 정보와 함께 검색 |
| POST | `/suggest` | 자동완성 제안 |
| POST | `/suggest-index` | 위치 정보와 함께 자동완성 |
| GET | `/info` | 컬렉션 정보 |
| POST | `/flush` | 컬렉션 삭제 |

### 요청/응답 예제

**키워드 추가**

```bash
curl -X POST http://localhost:8080/add \
  -H "Content-Type: application/json" \
  -d '{"keyword": "he"}'
```

```json
{
  "added": true
}
```

**텍스트 검색**

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

**위치 정보와 함께 검색**

```bash
curl -X POST http://localhost:8080/find-index \
  -H "Content-Type: application/json" \
  -d '{"text": "he is him"}'
```

```json
{
  "matched": {
    "he": [0],
    "him": [6]
  }
}
```

## gRPC 서버

### 프로토버퍼 정의

```protobuf
syntax = "proto3";

package acor;

option go_package = "github.com/skyoo2003/acor/pkg/server/proto";

service AhoCorasick {
    rpc Add(AddRequest) returns (AddResponse);
    rpc Remove(RemoveRequest) returns (RemoveResponse);
    rpc Find(FindRequest) returns (FindResponse);
    rpc FindIndex(FindRequest) returns (FindIndexResponse);
    rpc Suggest(SuggestRequest) returns (SuggestResponse);
    rpc SuggestIndex(SuggestRequest) returns (SuggestIndexResponse);
    rpc Info(InfoRequest) returns (InfoResponse);
    rpc Flush(FlushRequest) returns (FlushResponse);
}

message AddRequest {
    string keyword = 1;
}

message AddResponse {
    bool added = 1;
}

message FindRequest {
    string text = 1;
}

message FindResponse {
    repeated string matched = 1;
}

message FindIndexResponse {
    map<string, repeated int32> matched = 1;
}
```

### 서버 구현

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
    if err := grpcServer.Serve(lis); err != nil {
        log.Fatal(err)
    }
}
```

### 클라이언트 예제

```go
package main

import (
    "context"
    "fmt"
    "log"
    
    pb "github.com/skyoo2003/acor/pkg/server/proto"
    "google.golang.org/grpc"
)

func main() {
    conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
    if err != nil {
        log.Fatal(err)
    }
    defer conn.Close()

    client := pb.NewAhoCorasickClient(conn)

    // 키워드 추가
    _, err = client.Add(context.Background(), &pb.AddRequest{Keyword: "he"})
    if err != nil {
        log.Fatal(err)
    }

    // 검색
    resp, err := client.Find(context.Background(), &pb.FindRequest{Text: "he is him"})
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(resp.Matched) // [he, him]
}
```

## 배포

### Docker

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

### Kubernetes

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
    metadata:
      labels:
        app: acor-server
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
---
apiVersion: v1
kind: Service
metadata:
  name: acor-server
spec:
  selector:
    app: acor-server
  ports:
  - port: 8080
    targetPort: 8080
    name: http
  - port: 50051
    targetPort: 50051
    name: grpc
```

## HTTP vs gRPC 선택 가이드

| 기준 | HTTP | gRPC |
|------|------|------|
| 프로토콜 | HTTP/1.1 + JSON | HTTP/2 + Protobuf |
| 성능 | 보통 | 높음 |
| 디버깅 | curl 등으로 쉬움 | 도구 필요 |
| 클라이언트 | 모든 언어 | Go, Java, Python 등 |
| 스트리밍 | 미지원 | 지원 |

## 마치며

v1.3.0의 서버 어댑터로 ACOR을 마이크로서비스로 쉽게 배포할 수 있게 되었다. HTTP는 디버깅과 빠른 프로토타이핑에, gRPC는 고성능이 필요한 프로덕션 환경에 적합하다.

더 자세한 내용은 [ACOR GitHub 저장소](https://github.com/skyoo2003/acor)와 [공식 문서](https://skyoo2003.github.io/acor/)를 참고하자.
