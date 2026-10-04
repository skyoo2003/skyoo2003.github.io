---
title: "KVS에 Redis 프로토콜 붙이기: RESP2 서버와 Lua 스크립팅"
description: "KVS에 RESP2 서버와 Lua 스크립팅을 붙이며 정한 리스너 기본값, 길이를 믿지 않는 파싱, SCAN 커서, 원자성과 타임아웃, 샌드박스를 설명한다."
date: 2026-10-03T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, kvs, redis-protocol, lua]
---

## 들어가며

[KVS](https://github.com/skyoo2003/kvs)는 Go로 만든 키-값 스토어로, [처음 소개한 글](/ko/posts/2026/03/18/kvs-intro/)에서는 Red-Black Tree와 LSM Tree 같은 자료구조를 중심으로 설명했다. 이후 실제로 쓸 수 있는 서버를 만드는 쪽으로 방향이 바뀌면서 저장 엔진은 append log와 Raft로 옮겨 갔고 아무도 import하지 않게 된 `pkg/rbt`, `pkg/lsm`, `pkg/bitset`, `pkg/cuckoofilter`도 정리했다.

그 변화의 첫 단계가 **Redis 프로토콜(RESP2)** 지원이었다. 이 글에서는 프로토콜을 붙이며 정한 동작과 겪었던 문제를 살펴보고 내구성과 클러스터링은 [다음 글](/ko/posts/2026/10/03/kvs-append-log-raft/)에서 이어서 다루려 한다.

참고로 아래 설명은 **main 브랜치 기준**인데, KVS의 v1.0.0 태그는 현재 `go.mod`에서 retract된 상태이고 다음 릴리즈는 아직 나오지 않았다.

## 왜 RESP인가

KVS에는 이미 HTTP와 gRPC API가 있었지만 키-값 스토어를 쓰는 사람들에게 더 익숙한 도구는 `redis-cli`, `redis-benchmark`, `go-redis` 같은 Redis 생태계의 도구였다. 새 프로토콜과 클라이언트를 배우게 하기보다 손에 익은 도구로 바로 연결할 수 있도록 하는 편이 빠르다고 봤다.

RESP2를 지원하면서도 HTTP, gRPC와 키 공간 하나를 공유하도록 했으므로, 아래처럼 RESP로 쓴 키를 HTTP에서 읽을 수 있다.

```sh
$ redis-cli -p 6379 set greeting hello
OK
$ curl http://localhost:3456/v1/keys/greeting
{"key":"greeting","value":"hello"}
```

문자열, 키와 만료, 해시, 리스트, 셋, 정렬 셋, 트랜잭션, Pub/Sub, 스크립팅에 걸쳐 약 100개 명령을 지원한다.

## 리스너의 기본값은 보수적으로

RESP 리스너는 기본으로 <strong>`127.0.0.1:6379`</strong>에 바인딩한다. 모든 인터페이스에 바인딩하는 HTTP와 gRPC와 기본값을 달리한 것은, 6379 포트가 인터넷에서 계속 스캔되는 데다 KVS에는 별도로 설정하지 않으면 인증이 없기 때문이다. 외부에 열고 싶다면 사용자가 직접 선택하도록 했다.

몇 가지 기본 동작도 같은 생각에서 나왔다.

- 기본 포트를 이미 다른 프로세스(예를 들어 로컬 Redis)가 쓰고 있으면 경고를 남기고 RESP만 끈 채 HTTP와 gRPC는 정상적으로 띄운다. 반면 사용자가 직접 지정한 주소가 막혀 있으면 명시한 설정을 조용히 무시하지 않도록 시작을 거부한다.
- 비밀번호는 **명령행 플래그로 받지 않는다.** 프로세스 목록을 볼 수 있는 사람이라면 누구나 인자를 볼 수 있기 때문에 설정 파일이나 `KVS_RESP_PASSWORD` 환경 변수로만 받는다.
- 동시 연결은 Redis `maxclients` 기본값과 같은 **10,000개**까지 받으며, 연결하고 30초 동안 아무것도 보내지 않으면 끊는다. 다만 구독자처럼 한 번이라도 명령을 보낸 연결은 무기한 쉬어도 끊지 않는다.

## RESP2 파싱: 선언된 길이를 믿지 않는다

RESP2 요청은 `*3\r\n$3\r\nSET\r\n$8\r\ngreeting\r\n$5\r\nhello\r\n`처럼 배열 길이 뒤에 각 인자의 바이트 길이와 내용을 이어 보내는 단순한 구조이며, 이 형식 외에 telnet으로 직접 입력하는 인라인 요청도 받는다.

문제는 클라이언트가 `*1000000`이나 `$536870912`처럼 길이만 선언한 뒤 실제 내용은 보내지 않을 수 있다는 데 있다. 선언된 길이를 믿고 그만큼의 메모리를 미리 할당하면 요청 하나만으로도 서버 메모리가 바닥날 수 있다.

```go
const (
	// MaxBulkLength caps a single bulk string, matching the Redis proto-max-bulk-len default.
	// The buffer for a bulk string grows as the payload arrives, so a declared length costs
	// nothing until the bytes behind it do.
	MaxBulkLength = 512 * 1024 * 1024

	// argPrealloc bounds the argument slice reserved up front, so that a small request
	// claiming a huge argument count cannot make the server allocate ahead of the data.
	argPrealloc = 64

	// bulkPrealloc bounds the buffer reserved for a bulk string before its payload arrives.
	// Anything larger grows as the bytes come in, so announcing a 512MB value and then
	// stalling costs the server nothing.
	bulkPrealloc = 64 * 1024
)
```

상한은 Redis 기본값을 따르되 미리 잡는 메모리는 작게 제한하고 나머지는 실제 바이트가 도착하는 만큼만 늘린다.

RESP 구현을 검토하는 과정에서는 응답 지연과 프로세스 종료 문제도 발견했다. `KEYS`의 글롭 패턴 백트래킹은 읽기 잠금을 오래 잡고 있었고 아래 정수 인자 문제들은 panic을 일으켰는데, 당시 연결 처리에는 `recover`가 없어서 이 panic이 프로세스 전체의 종료로 이어졌다.

- `KEYS a*a*a*...*b`: 글롭 매칭이 `*`마다 재귀하면서 지수적으로 백트래킹했는데, 그것도 스토어의 읽기 잠금을 쥔 채라 40글자 이름에 49초가 걸렸다. 지금은 마지막 `*` 하나만 기억하고 한 번에 훑는다.
- `SETRANGE`: `offset+len(patch)`가 넘쳐서 음수 길이가 되고 `copy`에서 panic이 났다. 지금은 뺄셈으로 상한을 확인하므로 넘침이 생길 수 없다.
- `LREM key MinInt`, `SRANDMEMBER key MinInt`: 절댓값 계산이 넘쳐 음수 슬라이스 경계가 됐다.

네트워크 프로토콜을 연다는 것은 모든 정수 인자가 공격 표면이 된다는 뜻이기도 하다.

## 리스트: 큐처럼 쓰이는 자료구조

Redis 리스트는 한쪽에 넣고 다른 쪽에서 빼는 큐로 흔히 쓰이는데, Go 슬라이스의 앞쪽에 넣으려면 매번 전체를 복사해야 한다.

```go
// respList is a list with room to grow at both ends. items[head:] is the live range, and a
// push at the head fills reserved space in front of it instead of copying the whole list, so
// both ends cost O(1) amortized. That matters because the common use of a Redis list is a
// queue: push one end, pop the other.
type respList struct {
	items []string
	head  int
}
```

그래서 슬라이스 앞쪽에 여유 공간을 두고 `head` 인덱스로 실제 시작점을 가리키도록 했다. 앞에서 꺼낸 자리는 64칸이 쌓였을 때 한꺼번에 회수하므로, 양쪽 끝 연산을 모두 분할 상환 O(1)로 처리할 수 있다.

## SCAN 커서의 동작 방식

`SCAN`은 키 공간을 나눠 훑는 명령으로, 커서를 오프셋으로 만들면 구현은 간단하지만 순회 중 앞쪽 키가 지워졌을 때 다음 키 하나를 건너뛰는 문제가 생긴다.

KVS에서는 마지막으로 도달한 키를 가리키는 **불투명한 핸들**을 커서로 사용해, 이미 지나간 키가 지워져도 다음 키를 건너뛰지 않도록 했다. 클라이언트 라이브러리의 연결 풀 때문에 처음 호출한 `SCAN`과 이어서 호출하는 `SCAN`이 서로 다른 소켓으로 들어올 수 있으므로, 핸들도 소켓이 아닌 서버에 보관한다.

서버가 보관하는 미완료 순회는 **1,024개**까지이며 한도를 넘으면 가장 오래 쉬고 있는 핸들을 버리는데, 이때 버려진 커서로 요청한 클라이언트에는 `ERR invalid cursor`를 돌려줘야 한다. 빈 마지막 페이지(`0`)로 답하면 클라이언트가 `0`을 "반복 끝"으로 해석해, 거의 훑지 않은 키 공간을 전부 확인했다고 믿게 되기 때문이다.

## Lua 스크립팅

### 쓰기 잠금으로 원자성 보장하기

Lua 스크립팅에서는 `EVAL`, `EVALSHA`, `SCRIPT LOAD/EXISTS/FLUSH`를 지원하며 인터프리터로 Lua 5.1을 구현한 [gopher-lua](https://github.com/yuin/gopher-lua)를 사용하며, 스크립트의 `redis.call`도 클라이언트 명령과 같은 디스패치 테이블에서 처리한다.

Redis 스크립트의 원자성 약속을 지키려면 실행 중에 다른 명령이 끼어들지 않아야 한다. 이를 위해 KVS에서는 스크립트가 실행을 시작할 때 **스토어의 쓰기 잠금 하나**를 잡고 끝날 때까지 유지하도록 했다.

```go
// ponytail: a fresh interpreter per call. A pooled one carries the last script's globals
// into the next, and Redis promises a script that cannot see what ran before it.
state := lua.NewState(lua.Options{SkipOpenLibs: true})
defer state.Close()

// Neither compiling nor building the sandbox touches the store, so both happen before the
// lock. Compiling first also keeps an unparseable script out of the cache, where SCRIPT
// EXISTS would call it runnable and it would hold budget until the next flush.
compiled, compileErr := state.LoadString(body)
// ...

err = c.write(func(tx *kvs.Tx) error {
	// The deadline starts here, not at the top: a script queued behind another writer would
	// otherwise spend its budget waiting for the lock and be stopped without having run.
	ctx, cancel := context.WithTimeout(context.Background(), respScriptTimeout)
	defer cancel()
	state.SetContext(ctx)
	// ...
})
```

이 코드에는 몇 가지 의도한 결정이 들어 있다.

- **호출마다 새 인터프리터를 만든다.** 인터프리터를 풀로 재사용하면 이전 스크립트의 전역 변수가 다음 스크립트에 남는데, Redis는 스크립트가 앞서 실행된 것을 볼 수 없다고 약속하므로 성능을 조금 내주더라도 이 약속을 지키는 쪽을 택했다.
- **컴파일은 잠금 밖에서 한다.** 스토어를 건드리지 않는 작업은 잠금을 잡기 전에 끝내고, 컴파일에 실패한 스크립트는 캐시에 넣지 않는다.
- **타임아웃은 잠금을 잡은 뒤부터 잰다.** 다른 쓰기 뒤에서 기다린 시간까지 세면 한 줄도 실행하지 못하고 멈출 수 있기 때문이다.

### 5초 타임아웃을 적용한 이유

Redis에도 기본 5초의 실행 시간 임계값이 있지만 이를 넘었다고 스크립트를 자동으로 중단하지는 않는다. 대신 다른 연결의 일반 명령에 `BUSY`로 답하며 아직 쓰기를 수행하지 않은 스크립트라면 `SCRIPT KILL`로 중단할 수 있다. 자세한 동작은 [Redis 공식 문서](https://redis.io/docs/latest/develop/programmability/#maximum-execution-time)에 설명돼 있다.

반면 KVS에서는 스크립트가 쓰기 잠금을 쥐고 있어서 무한 루프에 빠지면 다른 클라이언트까지 멈춰 버린다. 그래서 인터프리터에 **5초**의 마감 시간을 두어 실행을 중단하도록 했고 `SCRIPT KILL`은 제공하지 않는다. 다만 중단 전에 수행한 쓰기는 그대로 남는데, Redis에서도 스크립트 오류가 이미 수행한 쓰기를 되돌리지는 않는다.

### 샌드박스

스크립트가 프로세스 밖으로 나가지 못하도록 `base`, `table`, `string`, `math`, `cjson` 라이브러리만 열고 `dofile`, `loadfile`, `print`, `require`는 지웠으며 `os`, `io`, `debug`, `package`는 아예 열지 않는다. `redis.call`도 트랜잭션, 구독, 스크립팅 명령 자체, 세션 명령처럼 스크립트 안에서 의미 없는 명령은 거절한다.

반환값을 변환할 때도 테이블을 32단계까지만 따라가도록 했다. 스크립트가 자기 자신을 담은 테이블을 반환하면 변환 과정의 재귀가 스택을 모두 쓰고 프로세스를 종료시킬 수 있기 때문이다.

### cjson과 null의 함정

많은 Redis 스크립트가 JSON을 다루기 때문에 v1.0.0 직전에 `cjson`도 추가했는데, 그전에는 `cjson`이 nil 전역이라 `cjson.decode`를 호출하는 스크립트가 모두 실패하고 있었다.

이때 특히 주의한 부분은 null 처리였다. Lua 테이블에 nil을 넣으면 해당 원소가 사라지므로, JSON 배열 `[1, null, 3]`의 null을 그대로 nil로 바꾸면 Lua에서는 배열이 1에서 끝난 것으로 보인다. 이를 막기 위해 KVS의 `cjson.decode`는 JSON null을 <strong>`cjson.null`</strong>이라는 센티널 값으로 바꿔서, 배열이 중간에 끊기거나 객체의 키가 사라지지 않게 했다.

인코딩은 cjson 규칙을 따라, 키가 정확히 1부터 n까지인 테이블은 배열로, 빈 테이블을 포함한 나머지는 모두 객체로 다룬다.

```go
// respLuaTableToJSON decides whether a table is an array or an object. Lua spells both the same
// way, so the rule cjson uses stands here: a table whose keys are exactly 1..n is an array, and
// anything else, an empty table included, is an object.
```

올바른 UTF-8이 아닌 문자열은 대체 문자로 인코딩하는데, 바이트를 그대로 통과시키는 Redis와의 차이도 문서에 남겨 두었다.

### 스크립트 캐시

`EVALSHA`에 캐시되지 않은 다이제스트가 들어오면 `NOSCRIPT`로 답해야 한다. 모든 클라이언트 라이브러리가 이 응답을 보고 스크립트 본문을 다시 보내므로, 다른 에러를 반환하면 대체 경로가 작동하지 않기 때문이다. 로드와 실행이 서로 다른 소켓에서 이루어질 수도 있어 캐시는 서버 단위로 관리한다.

스크립트 캐시의 한도는 **16MiB**인데, 한도를 넘더라도 `EVAL`은 스크립트를 실행하고 캐시에만 넣지 않으므로, 클라이언트는 명령을 실행할 수 있고 `EVALSHA`로 다시 호출하는 지름길만 잃는다. 반면 `SCRIPT LOAD`는 캐시에 넣는 것이 유일한 목적이라 한도를 넘으면 에러를 돌려준다.

## Redis와 다르게 동작하는 곳

RESP2로 연결할 수 있다고 해서 모든 동작이 Redis와 같은 것은 아니다. 그래서 문서에 "올바르지만 Redis와 똑같지는 않은 곳"을 따로 정리했으며 그중 몇 가지를 아래에 옮겼다.

- **키 공간은 하나다.** `SELECT`는 0만 받고 `FLUSHDB`와 `FLUSHALL`은 같은 일을 한다.
- **RESP2만 말한다.** `HELLO 3`에는 `NOPROTO`로 답하고 클라이언트는 이를 보고 RESP2로 내려온다. go-redis도 기본으로 RESP3를 요청하지만 스스로 RESP2로 내려온다.
- **만료는 샘플링으로 회수한다.** 만료된 키는 즉시 보이지 않게 되지만, 메모리는 그 키를 쓰는 쓰기나 쓰기마다 도는 샘플링 스윕이 회수한다. 만료가 없는 키 공간이라면 이 비용도 들지 않는다.
- **느린 구독자는 끊는다.** 메시지는 연결마다 개수와 메모리 상한 안에서 쌓이며, 상한을 넘는 구독자는 발행자를 늦추는 대신 연결을 끊는다.
- **`CONFIG SET`은 거절한다.** 받아들이고 조용히 무시하는 것보다 낫다고 봤다.

Functions(`FCALL`), 스트림, 블로킹 명령(`BLPOP` 등), RESP3 push, `MONITOR`, 비트 연산, `GEO`, HyperLogLog, `SCRIPT KILL` 등은 지원하지 않는 기능으로 공개했고, 해당 명령에는 모두 에러로 답해 클라이언트가 잘못된 결과를 받아들이지 않고 지원 여부를 알 수 있게 했다.

## 마치며

기존 Redis 도구로 KVS에 연결할 때는 사용할 명령과 Lua 기능이 지원 목록에 있는지 먼저 확인하는 편이 좋다. 특히 스크립트는 5초가 지나면 중단되더라도 이미 수행한 쓰기가 남는다는 점을 고려해야 한다. 이렇게 만든 키 공간을 디스크에 보존하고 여러 노드로 복제한 과정은 [다음 글](/ko/posts/2026/10/03/kvs-append-log-raft/)에서 이어 가려 한다.

전체 소스 코드는 [github.com/skyoo2003/kvs](https://github.com/skyoo2003/kvs)에서 확인할 수 있다.
