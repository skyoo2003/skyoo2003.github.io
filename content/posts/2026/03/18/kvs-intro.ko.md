---
title: "KVS: Go로 구현하는 Key-Value 스토어의 내부 아키텍처"
description: "Go 키-값 스토어 KVS v1.0.0의 패키지 구조, 모듈·서버 모드, 데이터 흐름과 Red-Black Tree·LSM Tree 구현을 살펴본다. 이후 버전은 구조가 다르다."
date: 2026-03-18T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, data-structures, kvs, tutorial]
---

> 참고로 이 글은 2026-03-18 당시의 v1.0.0 기준이다. 이후 `pkg/rbt`, `pkg/lsm` 등은 제거됐고 라이브러리 경로와 서버 구성도 바뀌었으니, 아래 내용을 현재 버전의 사용법으로 보지 않도록 주의하자. 바뀐 서버 구성은 [RESP2와 Lua 글](/ko/posts/2026/10/03/kvs-resp2-server-lua/), 내구성과 클러스터링은 [append log와 Raft 글](/ko/posts/2026/10/03/kvs-append-log-raft/)에서 다룬다.

[KVS](https://github.com/skyoo2003/kvs) v1.0.0을 릴리즈했다. KVS는 Go로 작성한 간단한 인메모리 키-값 스토어로, Go 모듈로 import 해서 쓰거나 별도의 서버로 띄워서 쓸 수 있다. 이번 글에서는 v1.0.0의 구조를 간략하게 정리하고, 그 중에서도 Red-Black Tree와 LSM Tree 구현을 좀 더 자세히 살펴보려 한다.

이미 Redis, LevelDB, BoltDB처럼 훌륭한 키-값 스토어가 많은데 굳이 직접 만든 이유는 단순하다. 학습과 실험이 목적이었다. 책이나 문서로만 보던 자료구조와 설계 결정들을 직접 구현해보면서 어떤 트레이드오프가 있는지 경험해보고 싶었다. 그래서 외부 C 의존성 없이 전부 Go로 작성했고, 라이브러리와 서버 두 가지 방식을 모두 지원하도록 했다.

v1.0.0에 포함된 내용은 아래와 같다.

| 기능 | 설명 |
|---|---|
| `kvs.Store` | 동기화된 맵 기반의 기본 저장소 |
| `pkg/rbt` | Red-Black Tree 구현 |
| `pkg/lsm` | 인메모리 LSM Tree 구현 |
| CLI | Cobra/Viper 기반 명령줄 인터페이스 |
| 서버 | HTTP 및 gRPC 서버 |
| 배포 | 정적 문서 사이트, Homebrew tap |

## 전체 구조

### 패키지 구조

```
kvs/
├── kvs.go                 # 기본 Store
├── pkg/
│   ├── rbt/               # Red-Black Tree
│   ├── lsm/               # LSM Tree
│   ├── bitset/            # 비트셋 유틸리티
│   └── cuckoofilter/      # 쿠쿠 필터
├── api/kvsv1/             # gRPC Protocol Buffers 정의
├── cmd/kvs/               # CLI 진입점
└── internal/server/       # HTTP/gRPC 서버
```

### 모듈로 사용하기

Go 프로그램 안에서 라이브러리로 쓸 때는 `kvs.NewStore()`로 저장소를 만들면 된다. 내부는 `sync.RWMutex`로 보호되는 `map[string]interface{}` 하나다.

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

`pkg/rbt`와 `pkg/lsm`은 `Store`와 연결되어 있지 않은 독립 패키지다. 즉, 서버나 `Store`가 내부적으로 트리를 쓰는 것이 아니라, 필요한 쪽에서 직접 가져다 쓰는 구조다. 각각의 특징을 정리하면 아래 정도가 될 것 같다.

- **`kvs.Store` (map)** : 평균 O(1) 조회. 순서가 필요 없는 단순 조회.
- **`pkg/rbt`** : O(log n) 보장. 키 순서가 의미 있는 경우.
- **`pkg/lsm`** : 쓰기를 memtable에 모았다가 정렬된 세그먼트로 내보내는 구조를 실험해보기 위한 용도.

## Red-Black Tree 구현

Red-Black Tree는 각 노드를 빨간색 또는 검은색으로 칠하고, 아래 규칙을 지키면서 균형을 유지하는 이진 탐색 트리다.

1. 루트는 검은색이다.
2. 빨간색 노드의 자식은 모두 검은색이다.
3. 어떤 노드에서 NIL까지 가는 모든 경로에는 같은 수의 검은색 노드가 있다.

이 규칙 덕분에 트리의 높이가 항상 O(log n)으로 유지된다.

### 구조

```go
type Compare func(a, b interface{}) int

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

키 타입을 고정하지 않고 비교 함수를 주입받도록 했다. 자주 쓰는 `CompareString`, `CompareInt`, `CompareFloat64`는 `cmp.go`에 미리 만들어 두었다.

```go
tree, err := rbt.New(rbt.CompareString)
if err != nil {
	panic(err)
}
_ = tree.Put("b", 2)
_ = tree.Put("a", 1)
value, _ := tree.Get("a") // 1
```

### 삽입

삽입은 일반적인 이진 탐색 트리처럼 자리를 찾아 빨간색 노드를 붙인 뒤, 규칙이 깨졌다면 `insertFix`에서 회전과 색상 변경으로 복구한다.

```go
func (t *RBTree) Put(key, value interface{}) error {
	if err := t.requireComparator(); err != nil {
		return err
	}

	if t.root == nil {
		t.root = &RBNode{Key: key, Value: value}
		t.size = 1
		return nil
	}

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
			current.Value = value // 이미 있는 키라면 값만 갱신
			return nil
		}
	}

	node := &RBNode{Key: key, Value: value, IsRed: true, Parent: parent}
	if cmp < 0 {
		parent.Left = node
	} else {
		parent.Right = node
	}

	t.insertFix(node)
	t.size++
	return nil
}
```

`insertFix`는 부모가 빨간색인 동안 반복하면서, 교과서에 나오는 세 가지 경우를 처리한다. (부모가 오른쪽 자식인 경우는 좌우만 바꾼 대칭 코드라서 생략했다.)

```go
func (t *RBTree) insertFix(node *RBNode) {
	for node != t.root && node.Parent != nil && node.Parent.IsRed {
		grandparent := node.getGrandparent()
		if grandparent == nil {
			break
		}

		if node.Parent == grandparent.Left {
			uncle := grandparent.Right
			// Case 1: 삼촌이 빨간색이면 색만 바꾸고 조부모로 올라간다.
			if isRed(uncle) {
				node.Parent.IsRed = false
				uncle.IsRed = false
				grandparent.IsRed = true
				node = grandparent
				continue
			}

			// Case 2: 삼촌이 검은색이고 노드가 오른쪽 자식이면 회전해서 Case 3으로 만든다.
			if node == node.Parent.Right {
				node = node.Parent
				t.rotateLeft(node)
			}

			// Case 3: 부모와 조부모의 색을 바꾸고 조부모를 기준으로 회전한다.
			node.Parent.IsRed = false
			grandparent.IsRed = true
			t.rotateRight(grandparent)
			continue
		}

		// 부모가 오른쪽 자식인 경우 (대칭)
		// ...
	}

	t.root.IsRed = false
}
```

회전은 중위 순회 순서를 유지한 채로 부모와 자식의 위치만 바꾸는 연산이다.

```
          Y          rotateRight(Y)          X
         / \        ───────────────▶        / \
        X   C                              A   Y
       / \          ◀───────────────          / \
      A   B          rotateLeft(X)            B   C
```

### 삭제는 아직 O(n)

부끄럽지만 `Remove`는 아직 정석대로 구현하지 않았다. 삭제할 키를 제외한 나머지 엔트리를 모두 모은 뒤에 트리를 처음부터 다시 만드는 방식이라 O(n)이 걸린다.

```go
func (t *RBTree) Remove(key interface{}) error {
	if err := t.requireComparator(); err != nil {
		return err
	}

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

Red-Black Tree의 삭제는 경우의 수가 삽입보다 훨씬 많아서, 우선 동작이 확실한 방식으로 만들어 두고 테스트를 충분히 쌓은 다음에 바꿀 생각이다.

| 연산 | 시간 복잡도 |
|---|---|
| Put | O(log n) |
| Get | O(log n) |
| Remove | O(n) (재구축) |
| Clear | O(1) |

## LSM Tree 구현

LSM(Log-Structured Merge) Tree는 쓰기를 메모리(memtable)에 먼저 모았다가, 일정 크기가 되면 정렬된 파일로 내보내고, 쌓인 파일들을 주기적으로 병합(컴팩션)하는 구조다. LevelDB, RocksDB, Cassandra 등이 이 방식을 사용한다.

KVS의 `pkg/lsm`은 이걸 전부 메모리 안에서 흉내 낸 버전이다. 디스크에 쓰는 대신 정렬된 슬라이스(세그먼트)로 내보내고, 컴팩션은 아직 없다.

### 구조

```go
type Tree struct {
	memtable      map[string]entry // 현재 쓰기를 받는 테이블
	segments      []segment        // 플러시된 불변 세그먼트 (최신이 앞)
	memtableLimit int              // 자동 플러시 기준 (기본값 4)
}

type entry struct {
	key     string
	value   interface{}
	deleted bool // 툼스톤
}

type segment struct {
	entries []entry // 키 기준으로 정렬됨
}
```

`lsm.New()`는 기본값 4로, `lsm.NewWithMemtableLimit(n)`은 원하는 기준으로 트리를 만든다. 기본값이 4로 아주 작은 이유는 테스트에서 플러시가 자주 일어나도록 하기 위해서다.

### 쓰기와 플러시

쓰기는 항상 memtable에만 한다. memtable 크기가 기준에 도달하면 엔트리를 키 순서로 정렬해서 새 세그먼트로 만들고, 세그먼트 목록의 맨 앞에 붙인다.

```go
func (t *Tree) Flush() error {
	if t == nil || len(t.memtable) == 0 {
		return nil
	}

	entries := make([]entry, 0, len(t.memtable))
	for _, current := range t.memtable {
		entries = append(entries, current)
	}
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].key < entries[j].key
	})

	t.segments = append([]segment{{entries: entries}}, t.segments...)
	t.memtable = make(map[string]entry)
	return nil
}
```

### 읽기

읽기는 memtable을 먼저 보고, 없으면 세그먼트를 최신 것부터 이진 탐색한다. 최신 세그먼트를 먼저 보기 때문에 같은 키가 여러 세그먼트에 있어도 가장 마지막에 쓴 값을 찾게 된다.

```go
func (t *Tree) lookup(key string) (entry, bool) {
	if current, ok := t.memtable[key]; ok {
		return current, true
	}
	for _, current := range t.segments {
		if found, ok := current.get(key); ok {
			return found, true
		}
	}
	return entry{}, false
}
```

### 삭제와 툼스톤

이미 만들어진 세그먼트는 수정하지 않기 때문에, 삭제는 값을 지우는 대신 `deleted: true`인 엔트리(툼스톤)를 memtable에 새로 쓰는 것으로 처리한다. 조회할 때 툼스톤을 먼저 만나면 없는 키로 취급한다.

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

| 연산 | 시간 복잡도 |
|---|---|
| Put | 평균 O(1) (플러시가 일어나면 O(m log m)) |
| Get | O(k log s) (k = 세그먼트 수, s = 세그먼트 크기) |
| Delete | Get + Put |

컴팩션이 없어서 세그먼트가 계속 늘어나고, 덮어쓴 값이나 툼스톤도 그대로 남는다. 쓰기가 많을수록 읽기가 느려지고 메모리도 계속 늘어나는 구조라서, 실제 저장소로 쓰기에는 아직 무리가 있다. 컴팩션은 다음에 구현해볼 부분이다.

## CLI와 서버

### CLI

CLI는 [Cobra](https://github.com/spf13/cobra)와 [Viper](https://github.com/spf13/viper)로 만들었다. `--config`로 Viper가 읽을 수 있는 설정 파일(YAML, JSON, TOML 등)을 지정할 수 있다.

```bash
$ kvs --help
$ kvs -v
$ kvs version
$ kvs --config config.yaml version
$ kvs serve --http-addr :3456 --grpc-addr :3457
```

`kvs serve`는 HTTP 서버와 gRPC 서버를 같이 띄우는데, 기본 주소는 각각 `:3456`, `:3457`이다. 서버에서 쓰는 저장소는 앞에서 본 `kvs.Store`다.

### HTTP

| Method | Path | 설명 |
|---|---|---|
| GET | `/healthz` | 헬스 체크 |
| GET | `/v1/keys/{key}` | 값 조회 |
| PUT | `/v1/keys/{key}` | 값 저장 (`{"value": "..."}`) |
| DELETE | `/v1/keys/{key}` | 키 삭제 |

```bash
# 값 저장
$ curl -X PUT http://localhost:3456/v1/keys/mykey -d '{"value": "myvalue"}'

# 값 조회
$ curl http://localhost:3456/v1/keys/mykey
{"key":"mykey","value":"myvalue"}

# 키 삭제
$ curl -X DELETE http://localhost:3456/v1/keys/mykey
```

PUT 요청의 바디는 `{"value": "..."}` 형태의 JSON이어야 하고, 정의되지 않은 필드가 있으면 400을 반환한다.

### gRPC

Protocol Buffers 정의는 `api/kvsv1/kvs.proto`에 있다.

```protobuf
service KVStore {
  rpc Get(GetRequest) returns (GetResponse);
  rpc Put(PutRequest) returns (PutResponse);
  rpc Delete(DeleteRequest) returns (DeleteResponse);
}
```

```go
conn, err := grpc.Dial("localhost:3457",
	grpc.WithTransportCredentials(insecure.NewCredentials()))
if err != nil {
	log.Fatal(err)
}
defer conn.Close()

client := kvsv1.NewKVStoreClient(conn)
_, _ = client.Put(context.Background(), &kvsv1.PutRequest{Key: "greeting", Value: "hello"})

resp, _ := client.Get(context.Background(), &kvsv1.GetRequest{Key: "greeting"})
fmt.Println(resp.GetValue()) // hello
```

## 설치

```bash
# Go 모듈
$ go get github.com/skyoo2003/kvs@v1.0.0

# Homebrew
$ brew tap skyoo2003/tap
$ brew install kvs

# 소스에서 빌드
$ git clone https://github.com/skyoo2003/kvs.git
$ cd kvs
$ go install ./cmd/kvs
```

## 정리

v1.0.0은 작은 키-값 스토어에 Red-Black Tree, LSM Tree, CLI, 서버를 한 번씩 구현해본 버전이라고 할 수 있다. 정리하면서 보니 아쉬운 부분도 많다. 다음에는 아래 부분들을 손볼 생각이다.

- Red-Black Tree 삭제를 O(log n)으로 개선
- LSM Tree 컴팩션 구현
- 디스크 영속성
- 클러스터링

자세한 내용은 [KVS GitHub 저장소](https://github.com/skyoo2003/kvs)와 [문서 사이트](https://skyoo2003.github.io/kvs/)를 참고하자.
