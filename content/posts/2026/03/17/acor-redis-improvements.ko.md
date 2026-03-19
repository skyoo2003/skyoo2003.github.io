---
title: "ACOR v1.3.0: Redis 토폴로지 지원과 에러 핸들링 강화"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, deep-dive]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor) v1.3.0에서 Redis 관련 두 가지 중요한 개선사항이 추가되었다. 첫째, 다양한 Redis 토폴로지(Sentinel, Cluster, Ring)를 지원하게 되었고, 둘째, Redis 통신 중 발생하는 에러를 명시적으로 처리하도록 API가 개선되었다.

## Redis 토폴로지 지원

### 문제 상황

v1.3.0 이전에는 단일 Redis 인스턴스(`Addr`)만 지원했다. 프로덕션 환경에서는 고가용성을 위해 Redis Sentinel을 사용하거나, 대용량 데이터 처리를 위해 Redis Cluster를 사용하는 경우가 많다. ACOR을 이런 환경에서 사용하려면 별도의 작업이 필요했다.

### 해결 방법

v1.3.0에서는 `AhoCorasickArgs` 구조체에 토폴로지별 필드를 추가하여 다양한 Redis 배포 방식을 지원한다:

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

### 사용 예제

**Standalone (기존 방식)**

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

Redis Cluster는 키가 여러 샤드에 분산된다. ACOR은 하나의 컬렉션에 속한 모든 키가 같은 샤드에 저장되도록 hash tag를 사용한다:

```
{collection-name}:prefix:state
{collection-name}:output:keyword
```

이렇게 하면 하나의 Aho-Corasick 오토마톤에 속한 모든 데이터가 동일한 샤드에 저장되어, 트랜잭션과 읽기 일관성이 보장된다.

## Redis 에러 핸들링

### 문제 상황

v1.3.0 이전에는 Redis 통신 중 에러가 발생해도 무시되거나 조용히 실패했다. 예를 들어, 네트워크 단절 시 `Find` 호출이 빈 결과를 반환했는데, 이것이 실제로 매칭되는 키워드가 없어서인지 Redis 연결 문제인지 알 수 없었다.

### 해결 방법

v1.3.0에서는 모든 Redis 관련 API가 명시적으로 에러를 반환하도록 변경되었다:

```go
func (ac *AhoCorasick) Create(args *AhoCorasickArgs) (*AhoCorasick, error)
func (ac *AhoCorasick) Add(keyword string) (bool, error)
func (ac *AhoCorasick) Remove(keyword string) (bool, error)
func (ac *AhoCorasick) Find(text string) ([]string, error)
func (ac *AhoCorasick) FindIndex(text string) (map[string][]int, error)
func (ac *AhoCorasick) Flush() error
```

### 부분 쓰기 롤백

`Add` 메서드는 키워드를 트라이 구조로 Redis에 저장한다. 여러 Redis 명령이 필요한데, 중간에 실패하면 부분적으로 저장된 데이터가 남게 된다. v1.3.0에서는 실패 시 롤백을 수행하여 데이터 일관성을 보장한다:

```go
func (ac *AhoCorasick) Add(keyword string) (bool, error) {
    // 트라이 노드들을 Redis에 저장
    for _, node := range nodes {
        if err := ac.saveNode(node); err != nil {
            // 실패 시 이미 저장한 노드들 롤백
            ac.rollbackNodes(savedNodes)
            return false, err
        }
        savedNodes = append(savedNodes, node)
    }
    return true, nil
}
```

### 사용 예제

```go
ac, err := acor.Create(args)
if err != nil {
    log.Fatalf("Redis 연결 실패: %v", err)
}
defer ac.Close()

matched, err := ac.Find("he is him")
if err != nil {
    log.Printf("검색 중 에러 발생: %v", err)
    // 적절한 에러 처리
    return
}
fmt.Println(matched)
```

## 마치며

v1.3.0의 Redis 개선사항으로 ACOR을 프로덕션 환경에서 더 안전하게 사용할 수 있게 되었다. Redis Sentinel/Cluster/Ring 지원으로 고가용성과 확장성을 확보할 수 있고, 명시적인 에러 처리로 장애 상황에서 적절한 대응이 가능해졌다.

더 자세한 내용은 [ACOR GitHub 저장소](https://github.com/skyoo2003/acor)와 [공식 문서](https://skyoo2003.github.io/acor/)를 참고하자.
