---
title: "ACOR v1.3.0: HTTP and gRPC Server Adapters"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, tutorial]
---

## Introduction

[ACOR](https://github.com/skyoo2003/acor) v1.3.0 adds HTTP and gRPC server adapters. You can now easily integrate ACOR into microservice architectures or deploy it as a standalone server. This post covers the usage and deployment of both adapters.

## Architecture Overview

v1.3.0 adds a `pkg/server` package that exposes the existing `pkg/acor` APIs over HTTP JSON and gRPC:

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

## HTTP Server

### Basic Usage

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

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/add` | Add keyword |
| POST | `/remove` | Remove keyword |
| POST | `/find` | Search text |
| POST | `/find-index` | Search with position info |
| POST | `/suggest` | Autocomplete suggestions |
| POST | `/suggest-index` | Autocomplete with position info |
| GET | `/info` | Collection info |
| POST | `/flush` | Delete collection |

### Request/Response Examples

**Add Keyword**

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

**Search Text**

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

**Search with Position Info**

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

## gRPC Server

### Protobuf Definition

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

### Server Implementation

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

### Client Example

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

    // Add keyword
    _, err = client.Add(context.Background(), &pb.AddRequest{Keyword: "he"})
    if err != nil {
        log.Fatal(err)
    }

    // Search
    resp, err := client.Find(context.Background(), &pb.FindRequest{Text: "he is him"})
    if err != nil {
        log.Fatal(err)
    }
    fmt.Println(resp.Matched) // [he, him]
}
```

## Deployment

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

## HTTP vs gRPC Selection Guide

| Criteria | HTTP | gRPC |
|----------|------|------|
| Protocol | HTTP/1.1 + JSON | HTTP/2 + Protobuf |
| Performance | Moderate | High |
| Debugging | Easy with curl | Requires tools |
| Clients | All languages | Go, Java, Python, etc. |
| Streaming | Not supported | Supported |

## Conclusion

With v1.3.0's server adapters, ACOR can be easily deployed as a microservice. HTTP is suitable for debugging and quick prototyping, while gRPC is ideal for high-performance production environments.

For more details, visit the [ACOR GitHub repository](https://github.com/skyoo2003/acor) and [official documentation](https://skyoo2003.github.io/acor/).
