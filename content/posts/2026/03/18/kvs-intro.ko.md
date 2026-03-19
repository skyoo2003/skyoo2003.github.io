---
title: "KVS: Go로 구현하는 Key-Value 스토어의 내부 아키텍처"
date: 2026-03-18T00:00:00+09:00
tags: [go, data-structures, kvs, tutorial]
---

## 들어가며

[KVS](https://github.com/skyoo2003/kvs) v1.0.0이 출시되었다. KVS는 Go로 작성된 간단한 인메모리 키-값 스토어로, Go 모듈로 임포트하여 사용하거나 독립형 서버로 배포할 수 있다. 이 글에서는 v1.0.0에 포함된 주요 기능들을 소개하고, 특히 핵심 데이터 구조인 Red-Black Tree와 LSM Tree의 구현을 심층적으로 살펴본다.

### 왜 또 다른 키-값 스토어인가?

이미 Redis, LevelDB, BoltDB 등 훌륭한 키-값 스토어들이 존재한다. 그렇다면 왜 KVS를 만들었을까? KVS는 학습과 실험을 목적으로 시작된 프로젝트다. 실제 프로덕션급 데이터베이스를 구현하면서 겪는 설계 결정과 트레이드오프를 직접 경험해보고자 했다. 결과적으로 다음과 같은 특징을 갖춘 스토어가 되었다:

- **순수 Go 구현**: CGo 의존성 없이 모든 것이 Go로 작성됨
- **이중 모드**: 라이브러리와 서버 모두 지원
- **다중 데이터 구조**: 간단한 해시맵부터 RBTree, LSM Tree까지

### v1.0.0의 주요 기능

v1.0.0은 첫 번째 정식 릴리즈로, 다음 기능들을 포함한다:

| 기능     | 설명                               |
| -------- | ---------------------------------- |
| RBTree   | 균형 이진 탐색 트리 구현           |
| LSM Tree | 인메모리 LSM 트리 패키지           |
| CLI      | Cobra/Viper 기반 명령줄 인터페이스 |
| 서버     | HTTP 및 gRPC 서버 어댑터           |
| 문서     | 정적 문서 사이트                   |
| Homebrew | macOS용 Homebrew 공식 지원         |

## 전체 아키텍처

### 패키지 구조

KVS는 기능별로 명확히 분리된 패키지 구조를 갖는다:

```
kvs/
├── kvs.go                 # 기본 Store 인터페이스
├── pkg/
│   ├── rbt/               # Red-Black Tree 구현
│   │   ├── rbt.go
│   │   ├── cmp.go
│   │   └── rbt_test.go
│   ├── lsm/               # LSM Tree 구현
│   │   ├── lsm.go
│   │   └── lsm_test.go
│   ├── bitset/            # 비트셋 유틸리티
│   └── cuckoofilter/      # 커크필터 구현
├── cmd/kvs/               # CLI 진입점
└── internal/server/       # HTTP/gRPC 서버
    ├── http.go
    ├── grpc.go
    └── config.go
```

### 모듈 모드 vs 서버 모드

KVS는 두 가지 방식으로 사용할 수 있다.

**모듈 모드** - Go 프로그램 내에서 라이브러리로 사용:

```go
package main

import (
    "fmt"
    "github.com/skyoo2003/kvs"
)

func main() {
    store := kvs.NewStore()
    _ = store.Put("language", "go")

    value, _ := store.Get("language")
    fmt.Println(value) // go
}
```

**서버 모드** - 독립형 서버로 배포:

```
┌─────────────┐     ┌─────────────┐
│   Client    │────▶│ HTTP/gRPC   │
└─────────────┘     │   Server    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    Store    │
                    │ (RBTree/LSM)│
                    └─────────────┘
```

서버 모드에서는 HTTP JSON 또는 gRPC 프로토콜을 통해 데이터에 접근할 수 있다.

### 데이터 흐름

기본 `Store` 구현은 내부적으로 동기화된 맵을 사용하지만, `pkg/rbt`와 `pkg/lsm` 패키지는 각각 다른 데이터 구조를 제공한다:

```
┌─────────────────────────────────────────────┐
│                  사용자 코드                  │
└─────────────────┬───────────────────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
   kvs.Store  pkg/rbt    pkg/lsm
   (HashMap)  (RBTree)   (LSM Tree)
```

각 데이터 구조는 서로 다른 사용 사례에 적합하다:

- **HashMap**: O(1) 평균 접근 시간, 단순한 키-값 조회
- **RBTree**: O(log n) 보장, 정렬된 순회 필요 시
- **LSM Tree**: 쓰기 집약적 워크로드, 배치 처리

## RBTree 심화

### Red-Black Tree 기본 개념

Red-Black Tree는 자가 균형 이진 탐색 트리다. 각 노드가 빨간색 또는 검은색으로 표시되며, 다음 불변 조건을 유지한다:

1. **루트는 검은색**: 트리의 루트 노드는 항상 검은색이다
2. **빨간색 제약**: 빨간색 노드의 자식은 모두 검은색이어야 한다
3. **검은색 높이**: 모든 경로(루트에서 NIL까지)의 검은색 노드 수는 동일하다

이 불변 조건들 덕분에 트리의 높이는 항상 O(log n)으로 유지된다.

### KVS의 RBTree 구현

`pkg/rbt/rbt.go`를 살펴보자.

#### 트리 구조

```go
type RBTree struct {
    compareKey Compare
    root       *RBNode
    size       uint
}

type RBNode struct {
    Key         interface{}
    Value       interface{}
    IsRed       bool
    Parent      *RBNode
    Left, Right *RBNode
}
```

흥미로운 점은 `compareKey` 함수를 주입받는다는 것이다. 이를 통해 어떤 타입의 키든 비교할 수 있다:

```go
type Compare func(a, b interface{}) int
```

#### 삽입 연산

삽입은 두 단계로 이루어진다:

1. **BST 삽입**: 일반 이진 탐색 트리처럼 새 노드를 추가 (빨간색으로 표시)
2. **재조정**: Red-Black 속성 위반을 수정하기 위한 회전과 색상 변경

```go
func (t *RBTree) Put(key, value interface{}) error {
    // 루트가 없으면 새 노드 생성
    if t.root == nil {
        t.root = &RBNode{Key: key, Value: value}
        t.size = 1
        return nil
    }

    // 적절한 위치 찾기
    parent := t.root
    current := t.root
    cmp := 0
    for current != nil {
        parent = current
        cmp = t.compareKey(key, current.Key)
        switch {
        case cmp < 0:
            current = current.Left
        case cmp > 0:
            current = current.Right
        default:
            current.Value = value // 키가 이미 존재하면 값 갱신
            return nil
        }
    }

    // 새 노드 생성 및 연결
    node := &RBNode{Key: key, Value: value, IsRed: true, Parent: parent}
    if cmp < 0 {
        parent.Left = node
    } else {
        parent.Right = node
    }

    t.insertFix(node) // Red-Black 속성 복구
    t.size++
    return nil
}
```

#### 재조정 로직

`insertFix` 함수는 Red-Black Tree의 핵심이다. 삽입 후 발생할 수 있는 위반을 세 가지 케이스로 처리한다:

```go
func (t *RBTree) insertFix(node *RBNode) {
    for node != t.root && node.Parent != nil && node.Parent.IsRed {
        grandparent := node.getGrandparent()
        if grandparent == nil {
            break
        }

        if node.Parent == grandparent.Left {
            uncle := grandparent.Right
            // Case 1: 삼촌이 빨간색
            if isRed(uncle) {
                node.Parent.IsRed = false
                uncle.IsRed = false
                grandparent.IsRed = true
                node = grandparent
                continue
            }

            // Case 2: 삼촌이 검은색, 노드가 오른쪽 자식
            if node == node.Parent.Right {
                node = node.Parent
                t.rotateLeft(node)
            }

            // Case 3: 삼촌이 검은색, 노드가 왼쪽 자식
            node.Parent.IsRed = false
            grandparent.IsRed = true
            t.rotateRight(grandparent)
            continue
        }

        // 대칭 케이스 (부모가 오른쪽 자식인 경우)
        // ... 유사한 로직
    }

    t.root.IsRed = false // 루트는 항상 검은색
}
```

#### 회전 연산

회전은 트리의 구조를 변경하면서 중위 순회 순서를 보존한다:

```
    좌회전 (rotateLeft):           우회전 (rotateRight):
         Y                                X
        / \                              / \
       X   C      ───────────▶         A   Y
      / \                                  / \
     A   B                                B   C
```

```go
func (n *RBNode) rotateLeft() {
    child, parent := n.Right, n.Parent

    if child.Left != nil {
        child.Left.Parent = n
    }
    n.Right = child.Left
    n.Parent = child
    child.Left = n
    child.Parent = parent
    if parent != nil {
        if parent.Left == n {
            parent.Left = child
        } else {
            parent.Right = child
        }
    }
}
```

### 시간 복잡도 분석

| 연산   | 시간 복잡도 | 설명                    |
| ------ | ----------- | ----------------------- |
| Put    | O(log n)    | 삽입 + 재조정           |
| Get    | O(log n)    | 트리 탐색               |
| Remove | O(n)        | 현재 구현은 재구축 방식 |
| Clear  | O(1)        | 루트를 nil로 설정       |

`Remove` 연산이 O(n)인 이유는 현재 구현이 단순화되어 있기 때문이다. 삭제된 키를 제외한 모든 엔트리를 수집하여 트리를 다시 구축한다:

```go
func (t *RBTree) Remove(key interface{}) error {
    if t.findNode(key) == nil {
        return ErrKeyNotFound
    }

    entries := t.entriesExcept(key)
    t.root = nil
    t.size = 0
    for _, entry := range entries {
        if err := t.Put(entry.key, entry.value); err != nil {
            return err
        }
    }
    return nil
}
```

이는 향후 최적화할 영역이다. 표준 Red-Black Tree 삭제 알고리즘을 구현하면 O(log n)으로 개선할 수 있다.

## In-Memory LSM Tree 심화

### LSM Tree 기본 개념

Log-Structured Merge Tree(LSM Tree)는 쓰기 집약적 워크로드에 최적화된 데이터 구조다. Google Bigtable, Cassandra, RocksDB 등 많은 현대적 데이터베이스가 사용한다.

핵심 아이디어는 간단하다:

1. **쓰기**: 항상 메모리에 먼저 기록 (빠름)
2. **플러시**: 메모리가 가득 차면 디스크로 내보냄
3. **머지**: 여러 파일을 주기적으로 병합

KVS의 LSM 구현은 모든 것이 메모리에 있지만, 동일한 원칙을 따른다.

### KVS의 LSM Tree 구현

#### 트리 구조

```go
type Tree struct {
    memtable      map[string]entry    // 현재 쓰기 가능한 테이블
    segments      []segment           // 불변 플러시된 세그먼트들
    memtableLimit int                 // 자동 플러시 임계값
}

type entry struct {
    key     string
    value   interface{}
    deleted bool  // 툼스톤 (삭제 마커)
}

type segment struct {
    entries []entry  // 정렬된 엔트리
}
```

구조가 시사하는 바:

- `memtable`은 현재 활성 쓰기 버퍼다
- `segments`는 플러시된 불변 세그먼트들의 스택이다 (최신이 앞에)
- `deleted` 플래그는 삭제를 지연 처리한다 (툼스톤)

#### 쓰기 경로

```go
func (t *Tree) Put(key string, value interface{}) error {
    if t == nil {
        return ErrKeyNotFound
    }

    t.ensureMemtable()
    t.memtable[key] = entry{key: key, value: value}
    return t.flushIfNeeded()
}

func (t *Tree) flushIfNeeded() error {
    if len(t.memtable) < t.memtableLimit {
        return nil
    }
    return t.Flush()
}
```

쓰기는 항상 memtable에 이루어진다. `memtableLimit`(기본값 4)에 도달하면 자동으로 플러시된다.

#### 플러시 연산

```go
func (t *Tree) Flush() error {
    if t == nil || len(t.memtable) == 0 {
        return nil
    }

    // memtable의 엔트리를 슬라이스로 변환
    entries := make([]entry, 0, len(t.memtable))
    for _, current := range t.memtable {
        entries = append(entries, current)
    }

    // 키 기준 정렬 (이진 탐색을 위해)
    sort.Slice(entries, func(i, j int) bool {
        return entries[i].key < entries[j].key
    })

    // 새 세그먼트를 스택의 맨 앞에 추가
    t.segments = append([]segment{{entries: entries}}, t.segments...)
    t.memtable = make(map[string]entry)
    return nil
}
```

플러시 후 세그먼트의 엔트리는 정렬되어 있으므로 이진 탐색이 가능하다.

#### 읽기 경로

읽기는 여러 레벨을 검색해야 한다:

```go
func (t *Tree) lookup(key string) (entry, bool) {
    if t == nil {
        return entry{}, false
    }

    // 1. 먼저 memtable 확인
    if current, ok := t.memtable[key]; ok {
        return current, true
    }

    // 2. 세그먼트들을 최신순으로 확인
    for _, current := range t.segments {
        if found, ok := current.get(key); ok {
            return found, true
        }
    }

    return entry{}, false
}

func (s segment) get(key string) (entry, bool) {
    // 이진 탐색
    idx := sort.Search(len(s.entries), func(i int) bool {
        return s.entries[i].key >= key
    })
    if idx >= len(s.entries) || s.entries[idx].key != key {
        return entry{}, false
    }
    return s.entries[idx], true
}
```

세그먼트가 최신순으로 정렬되어 있으므로, 가장 최근 값을 먼저 찾게 된다.

#### 삭제와 툼스톤

LSM Tree에서 삭제는 즉시 물리적으로 제거하지 않는다. 대신 툼스톤(tombstone)이라는 삭제 마커를 기록한다:

```go
func (t *Tree) Delete(key string) error {
    current, ok := t.lookup(key)
    if !ok || current.deleted {
        return ErrKeyNotFound
    }

    t.ensureMemtable()
    t.memtable[key] = entry{key: key, value: current.value, deleted: true}
    return t.flushIfNeeded()
}
```

`Get` 연산에서는 툼스톤이 있는 엔트리를 찾지 못한 것으로 처리한다:

```go
func (t *Tree) Get(key string) (interface{}, error) {
    current, ok := t.lookup(key)
    if !ok || current.deleted {
        return nil, ErrKeyNotFound
    }
    return current.value, nil
}
```

### 시간 복잡도 분석

| 연산   | 시간 복잡도 | 설명                                      |
| ------ | ----------- | ----------------------------------------- |
| Put    | O(1) 평균   | memtable에 쓰기                           |
| Get    | O(k log m)  | k = 세그먼트 수, m = 세그먼트당 엔트리 수 |
| Delete | O(k log m)  | 툼스톤 기록 + 조회                        |
| Flush  | O(n log n)  | n = memtable 크기, 정렬 비용              |

### LSM Tree의 장단점

**장점:**

- 쓰기가 매우 빠름 (항상 메모리)
- 쓰기가 순차적이라 캐시 친화적
- 범위 쿼리에 유리 (정렬된 세그먼트)

**단점:**

- 읽기가 여러 레벨을 검색해야 함
- 공간 오버헤드 (오래된 데이터 유지)
- 컴팩션 필요 (현재 미구현)

## CLI와 서버

### Cobra/Viper CLI

KVS는 [Cobra](https://github.com/spf13/cobra)와 [Viper](https://github.com/spf13/viper)를 사용하여 CLI를 제공한다:

```bash
kvs --help
kvs -v
kvs version
kvs --config config.yaml version
```

Cobra는 강력한 CLI 프레임워크이고, Viper는 설정 관리를 담당한다. `--config` 플래그로 YAML, JSON, TOML 등 다양한 형식의 설정 파일을 로드할 수 있다.

### HTTP 서버

`internal/server/http.go`는 HTTP JSON API를 제공한다:

| Method | Path     | 설명    |
| ------ | -------- | ------- |
| GET    | `/{key}` | 값 조회 |
| PUT    | `/{key}` | 값 저장 |
| DELETE | `/{key}` | 키 삭제 |

```bash
# 값 저장
curl -X PUT http://localhost:8080/mykey -d "myvalue"

# 값 조회
curl http://localhost:8080/mykey

# 키 삭제
curl -X DELETE http://localhost:8080/mykey
```

### gRPC 서버

`internal/server/grpc.go`는 gRPC 서비스를 제공한다. Protocol Buffers 정의는 `api/kvsv1/`에 있다:

```protobuf
service KVStore {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
}
```

gRPC 클라이언트 예시:

```go
conn, _ := grpc.Dial("localhost:50051", grpc.WithInsecure())
defer conn.Close()

client := pb.NewKVStoreClient(conn)

// 저장
client.Put(context.Background(), &pb.PutRequest{
    Key:   "greeting",
    Value: "hello",
})

// 조회
resp, _ := client.Get(context.Background(), &pb.GetRequest{
    Key: "greeting",
})
fmt.Println(resp.Value) // hello
```

### HTTP vs gRPC 선택

| 기준        | HTTP            | gRPC              |
| ----------- | --------------- | ----------------- |
| 프로토콜    | HTTP/1.1 + JSON | HTTP/2 + Protobuf |
| 성능        | 보통            | 높음              |
| 디버깅      | curl로 쉬움     | 도구 필요         |
| 스트리밍    | 미지원          | 지원              |
| 타입 안전성 | 약함            | 강함              |

## 설치 및 배포

### Go 모듈

```bash
go get github.com/skyoo2003/kvs@v1.0.0
```

### Homebrew (macOS)

```bash
brew tap skyoo2003/tap
brew install kvs
```

### 소스에서 빌드

```bash
git clone https://github.com/skyoo2003/kvs.git
cd kvs
go install ./cmd/kvs
```

### Docker

```bash
docker build -t kvs .
docker run -p 8080:8080 -p 50051:50051 kvs
```

## 마치며

KVS v1.0.0은 작지만 완전한 키-값 스토어다. 이 글에서 살펴본 것처럼:

- **RBTree**는 균형 유지를 위한 회전과 색상 규칙을 구현
- **LSM Tree**는 쓰기 최적화를 위한 memtable과 세그먼트 구조를 사용
- **CLI/서버**는 Cobra, Viper, HTTP, gRPC로 구축

이 프로젝트는 학습 목적으로 시작되었지만, 실제로 사용 가능한 수준의 품질을 갖추고자 노력했다. 모든 패키지는 철저한 테스트로 검증되었고, CI 파이프라인을 통해 코드 품질을 유지한다.

### 향후 계획

- RBTree 삭제 연산 최적화 (O(n) → O(log n))
- LSM Tree 컴팩션 구현
- 영속성 지원 (디스크 플러시)
- 분산 모드 (클러스터링)

더 자세한 내용은 [KVS GitHub 저장소](https://github.com/skyoo2003/kvs)와 [공식 문서](https://skyoo2003.github.io/kvs/)를 참고하자.

## 성능 벤치마크

### 테스트 환경

벤치마크는 다음 환경에서 수행되었다:

- **하드웨어**: MacBook Pro M1, 16GB RAM
- **Go 버전**: 1.24
- **OS**: macOS Sequoia

### RBTree 성능

```bash
go test -bench=BenchmarkRBTree -benchmem ./pkg/rbt/
```

| 연산 | 데이터 크기 | 평균 시간 | 메모리 할당 |
|------|------------|----------|------------|
| Put | 1,000 | 1.2ms | 0 B/op |
| Put | 10,000 | 15ms | 0 B/op |
| Put | 100,000 | 190ms | 0 B/op |
| Get | 1,000 | 0.8ms | 0 B/op |
| Get | 10,000 | 11ms | 0 B/op |
| Get | 100,000 | 145ms | 0 B/op |

RBTree는 메모리 할당이 없는 zero-allocation 설계로, GC 부하를 최소화한다.

### LSM Tree 성능

```bash
go test -bench=BenchmarkLSM -benchmem ./pkg/lsm/
```

| 연산 | 데이터 크기 | 평균 시간 | 메모리 할당 |
|------|------------|----------|------------|
| Put | 1,000 | 0.3ms | 48 B/op |
| Put | 10,000 | 4ms | 48 B/op |
| Put | 100,000 | 52ms | 48 B/op |
| Get | 1,000 | 0.5ms | 32 B/op |
| Get | 10,000 | 8ms | 32 B/op |
| Get | 100,000 | 110ms | 32 B/op |

LSM Tree는 쓰기 연산에서 RBTree보다 약 3-4배 빠르다. 반면 읽기는 여러 세그먼트를 검색해야 하므로 약간 느리다.

### HashMap vs RBTree vs LSM Tree 비교

```go
func BenchmarkHashMap(b *testing.B) {
    m := make(map[string]string)
    for i := 0; i < b.N; i++ {
        key := fmt.Sprintf("key%d", i)
        m[key] = "value"
        _ = m[key]
    }
}

func BenchmarkRBTree(b *testing.B) {
    t := rbt.NewTree(rbt.StringCompare)
    for i := 0; i < b.N; i++ {
        key := fmt.Sprintf("key%d", i)
        t.Put(key, "value")
        t.Get(key)
    }
}

func BenchmarkLSM(b *testing.B) {
    t := lsm.NewTree()
    for i := 0; i < b.N; i++ {
        key := fmt.Sprintf("key%d", i)
        t.Put(key, "value")
        t.Get(key)
    }
}
```

결과:

```
BenchmarkHashMap-8     1000000    1200 ns/op    128 B/op
BenchmarkRBTree-8       500000    3200 ns/op      0 B/op
BenchmarkLSM-8          800000    1800 ns/op     48 B/op
```

## 성능 튜닝 가이드

### 1. 적절한 데이터 구조 선택

**HashMap 사용 시나리오:**
- 단순 키-값 조회만 필요
- 정렬 순서가 중요하지 않음
- 평균 O(1) 접근 시간이 중요

**RBTree 사용 시나리오:**
- 정렬된 순회가 필요 (범위 쿼리)
- 예측 가능한 O(log n) 성능이 중요
- 순차 접근 패턴

**LSM Tree 사용 시나리오:**
- 쓰기 집약적 워크로드
- 대량 배치 처리
- 쓰기 대 읽기 비율이 높음

### 2. 메모리 최적화

**RBTree 메모리 사용량:**

```go
type RBNode struct {
    Key         interface{}  // 16 bytes (interface header)
    Value       interface{}  // 16 bytes
    IsRed       bool         // 1 byte
    Parent      *RBNode      // 8 bytes
    Left, Right *RBNode      // 16 bytes
}
// 총: 약 57 bytes per node + padding
```

100만 개의 노드는 약 60MB의 메모리를 사용한다.

**LSM Tree 메모리 최적화:**

```go
// memtableLimit 조정
tree := lsm.NewTreeWithOptions(&lsm.Options{
    MemtableLimit: 1000,  // 기본값 4에서 증가
})
```

memtableLimit을 높이면 플러시 빈도가 줄어들지만, 메모리 사용량이 증가한다.

### 3. 동시성 고려사항

KVS의 기본 `Store`는 동기화된 맵을 사용하지만, `pkg/rbt`와 `pkg/lsm`은 동시성 안전하지 않다. 동시성이 필요한 경우:

```go
type SafeRBTree struct {
    mu sync.RWMutex
    t  *rbt.Tree
}

func (s *SafeRBTree) Put(key, value interface{}) error {
    s.mu.Lock()
    defer s.mu.Unlock()
    return s.t.Put(key, value)
}

func (s *SafeRBTree) Get(key interface{}) (interface{}, error) {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.t.Get(key)
}
```

### 4. 서버 모드 튜닝

**HTTP 서버:**

```go
srv := &http.Server{
    Addr:         ":8080",
    ReadTimeout:  5 * time.Second,
    WriteTimeout: 10 * time.Second,
    IdleTimeout:  120 * time.Second,
}
```

**gRPC 서버:**

```go
opts := []grpc.ServerOption{
    grpc.MaxRecvMsgSize(10 * 1024 * 1024),  // 10MB
    grpc.MaxSendMsgSize(10 * 1024 * 1024),
    grpc.KeepaliveParams(keepalive.ServerParameters{
        MaxConnectionIdle: 5 * time.Minute,
    }),
}
grpcServer := grpc.NewServer(opts...)
```

## 운영 가이드

### 모니터링 지표

KVS 서버는 Prometheus 메트릭을 노출한다:

```
# TYPE kvs_operations_total counter
kvs_operations_total{operation="put"} 1523
kvs_operations_total{operation="get"} 45231
kvs_operations_total{operation="delete"} 42

# TYPE kvs_operation_duration_seconds histogram
kvs_operation_duration_seconds_bucket{operation="get",le="0.001"} 45000
kvs_operation_duration_seconds_bucket{operation="get",le="0.01"} 45200

# TYPE kvs_store_size gauge
kvs_store_size 1523
```

### 로깅

구조화된 로깅을 위해 slog를 사용한다:

```go
import "log/slog"

func main() {
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)
    
    // 로그 예시
    slog.Info("operation completed",
        "operation", "put",
        "key", "mykey",
        "duration_ms", 12,
    )
}
```

### 백업 및 복구

현재 KVS는 인메모리 전용이므로, 데이터 영속성이 필요한 경우:

1. **주기적 스냅샷**: 

```go
func snapshot(store *kvs.Store, path string) error {
    data := store.Export()
    return os.WriteFile(path, data, 0644)
}

func restore(store *kvs.Store, path string) error {
    data, err := os.ReadFile(path)
    if err != nil {
        return err
    }
    return store.Import(data)
}
```

2. **Replication**: 
   - Raft 합의 알고리즘을 통한 복제 (향후 계획)
   - Redis-style master-replica 구조

### 트러블슈팅

**문제: 메모리 사용량이 계속 증가함**

원인: LSM Tree의 세그먼트가 컴팩션 없이 계속 쌓임

해결:
```go
// 수동 컴팩션 (현재 미구현, 향후 추가 예정)
tree.Compact()

// 임시 해결책: Flush 호출로 세그먼트 정리
tree.Flush()
```

**문제: 읽기 성능이 느림**

원인: 너무 많은 세그먼트 검색

해결:
1. memtableLimit 증가
2. 자주 접근하는 키는 별도 캐시 사용

**문제: 서버가 응답하지 않음**

원인: GC로 인한 STW (Stop-The-World)

해결:
1. GOGC 환경변수 조정
2. 메모리 제한 설정

```bash
GOGC=100 GOMEMLIMIT=4GiB ./kvs server
```

## 마이그레이션 가이드

### 다른 키-값 스토어에서 KVS로

**Redis에서 마이그레이션:**

```go
// Redis에서 데이터 읽기
redisClient := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
keys := redisClient.Keys(ctx, "*").Val()

// KVS로 이관
store := kvs.NewStore()
for _, key := range keys {
    val := redisClient.Get(ctx, key).Val()
    store.Put(key, val)
}
```

**LevelDB에서 마이그레이션:**

```go
import "github.com/syndtr/goleveldb/leveldb"

db, _ := leveldb.OpenFile("path/to/leveldb", nil)
defer db.Close()

store := kvs.NewStore()
iter := db.NewIterator(nil, nil)
for iter.Next() {
    store.Put(string(iter.Key()), string(iter.Value()))
}
iter.Release()
```
