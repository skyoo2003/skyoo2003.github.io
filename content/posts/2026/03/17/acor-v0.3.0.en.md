---
title: "What's New in ACOR v0.3.0"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor]
---

## Introduction

[ACOR](https://github.com/skyoo2003/acor) is a Go library that implements the Aho-Corasick algorithm with Redis as the backend storage. The latest version introduces four major features:

1. **Index APIs** - Provides match position information
2. **Redis Topology Support** - Supports Sentinel, Cluster, and Ring
3. **Command-Line Tool** - Use directly from the terminal
4. **Server Adapters** - Deploy as HTTP and gRPC services

This post covers the usage and features of each.

## Index APIs

### Comparison with Existing APIs

Previously, `Find` and `Suggest` APIs only told you which keywords matched. For text highlighting or position-based analysis, you had to calculate indices separately.

The new Index APIs solve this problem:

```go
// Existing: Returns only matched keywords
func (ac *AhoCorasick) Find(text string) ([]string, error)

// New: Returns keywords with their start indices
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) SuggestIndex(input string) (map[string][]int, error)
```

### Usage Example

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
    // Output: map[he:[0] him:[6] her:[21]]
}
```

### Unicode Handling

Index APIs properly handle Unicode. Go's `range` statement iterates over strings in rune units, ensuring correct indexing for multi-byte characters like Korean and emojis:

```go
matched, _ := ac.FindIndex("가한글")
// Result: map[string][]int{"한글": {1}}  // Character index, not byte index
```

### Performance Considerations

Index APIs have overhead from storing index information in `map[string][]int` and calculating rune length at each match. For simple existence checks where index information isn't needed, use the original `Find`/`Suggest` APIs for better efficiency.

## Redis Topology Support

### Supported Topologies

Various Redis deployment modes are now supported:

```go
type AhoCorasickArgs struct {
    Addr       string            // Standalone
    Addrs      []string          // Sentinel or Cluster
    MasterName string            // Sentinel master name
    RingAddrs  map[string]string // Ring shards
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

### Cluster-Safe Key Design

In Redis Cluster, keys are distributed across multiple shards. ACOR uses hash tags to ensure all keys belonging to a single collection are stored on the same shard:

```
{collection-name}:prefix:state
{collection-name}:output:keyword
```

### Error Handling

All Redis-related APIs now explicitly return errors:

```go
ac, err := acor.Create(args)
if err != nil {
    log.Fatalf("Redis connection failed: %v", err)
}
defer ac.Close()

matched, err := ac.Find("he is him")
if err != nil {
    log.Printf("Error during search: %v", err)
    return
}
fmt.Println(matched)
```

The `Add` method performs rollback on failure to ensure data consistency.

## Command-Line Tool

### Installation

**Binary Download**

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

**Build from Source**

```bash
git clone https://github.com/skyoo2003/acor.git
cd acor
make build
```

### Basic Usage

```bash
# Add keywords
acor -addr localhost:6379 -name sample add "he"
acor -addr localhost:6379 -name sample add "her"
acor -addr localhost:6379 -name sample add "him"

# Search text
acor -addr localhost:6379 -name sample find "he is him"
# Output: he
#         him

# Search with position info
acor -addr localhost:6379 -name sample find-index "he is him"
# Output: he: [0]
#         him: [6]

# Autocomplete suggestions
acor -addr localhost:6379 -name sample suggest "he"
# Output: he
#         her
```

### Main Commands

| Command         | Description                     |
| --------------- | ------------------------------- |
| `add`           | Add keyword                     |
| `remove`        | Remove keyword                  |
| `find`          | Search text                     |
| `find-index`    | Search with position info       |
| `suggest`       | Autocomplete suggestions        |
| `suggest-index` | Autocomplete with position info |
| `info`          | Collection info                 |
| `flush`         | Delete collection               |

### Common Options

| Option         | Description                | Default          |
| -------------- | -------------------------- | ---------------- |
| `-addr`        | Single Redis address       | `localhost:6379` |
| `-addrs`       | Sentinel/Cluster addresses |                  |
| `-master-name` | Sentinel master name       |                  |
| `-ring-addrs`  | Ring shards                |                  |
| `-password`    | Redis password             |                  |
| `-db`          | Redis database number      | `0`              |
| `-name`        | ACOR collection name       | (required)       |

## Server Adapters

### Architecture

The `pkg/server` package exposes the existing `pkg/acor` APIs over HTTP JSON and gRPC:

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

### HTTP Server

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

**API Endpoints**

| Method | Path             | Description                     |
| ------ | ---------------- | ------------------------------- |
| POST   | `/add`           | Add keyword                     |
| POST   | `/remove`        | Remove keyword                  |
| POST   | `/find`          | Search text                     |
| POST   | `/find-index`    | Search with position info       |
| POST   | `/suggest`       | Autocomplete suggestions        |
| POST   | `/suggest-index` | Autocomplete with position info |
| GET    | `/info`          | Collection info                 |
| POST   | `/flush`         | Delete collection               |

**Request Example**

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

### gRPC Server

**Server Implementation**

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

**Client Example**

```go
conn, _ := grpc.Dial("localhost:50051", grpc.WithInsecure())
defer conn.Close()

client := pb.NewAhoCorasickClient(conn)
resp, _ := client.Find(context.Background(), &pb.FindRequest{Text: "he is him"})
fmt.Println(resp.Matched) // [he, him]
```

### HTTP vs gRPC Selection Guide

| Criteria    | HTTP            | gRPC              |
| ----------- | --------------- | ----------------- |
| Protocol    | HTTP/1.1 + JSON | HTTP/2 + Protobuf |
| Performance | Moderate        | High              |
| Debugging   | Easy with curl  | Requires tools    |
| Streaming   | Not supported   | Supported         |

HTTP is suitable for debugging and quick prototyping, while gRPC is ideal for high-performance production environments.

### Deployment

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

## Conclusion

This update significantly expands ACOR's capabilities:

- **Index APIs**: Enable text highlighting and position-based analysis
- **Redis Topology Support**: Provides high availability and scalability in production
- **CLI**: Enables automation with scripts and quick testing
- **Server Adapters**: Easy integration into microservice architectures

For more details, visit the [ACOR GitHub repository](https://github.com/skyoo2003/acor) and [official documentation](https://skyoo2003.github.io/acor/).
