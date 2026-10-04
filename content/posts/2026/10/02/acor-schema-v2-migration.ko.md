---
title: "ACOR 스키마 V2: Redis 키 99%를 줄이고 V1에서 안전하게 옮기기"
description: "ACOR 스키마 V2가 해시와 Lua 스크립트로 Redis 키를 컬렉션당 3개로 줄인 설계, V1 마이그레이션 API, 롤백 주의사항과 V1 은퇴 과정을 정리한다."
date: 2026-10-02T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, redis, acor, data-migration]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor)은 2017년 첫 버전부터 Aho-Corasick 트라이를 Redis에 저장했다. 처음 설계(V1)에서는 트라이 구조를 Redis 자료구조에 거의 그대로 옮겨 키워드 집합, 접두사 간선, 접미사 링크, 상태별 출력, 노드 메타데이터를 각각 다른 키에 두었는데, 이해하기 쉬운 대신 키워드가 늘어날수록 키 수와 쓰기 비용도 함께 커졌다.

v0.4.0에서 넣은 새 스키마 V2는 키워드 수와 관계없이 컬렉션 하나에 **최대 3개 키**만 쓰도록 바꾼 것으로, 이 글에서는 V2 설계, 이미 V1으로 쌓인 데이터를 옮기는 마이그레이션 API, 그 과정에서 겪은 버그, 그리고 V1을 단계적으로 은퇴시킨 과정을 정리한다.

키 이름의 `{name}` 해시 태그로 Redis Cluster에서 한 컬렉션의 키를 같은 슬롯에 모으는 설계는 [v0.3.0](https://github.com/skyoo2003/acor/releases/tag/v0.3.0)에서 도입해 [v0.3.0 소개 글](/ko/posts/2026/03/17/acor-v0.3.0/)에서 다뤘는데, V2도 같은 규칙을 따른다.

## V1의 비용

V1은 컬렉션 하나를 다음과 같이 여러 키에 펼쳐 저장한다.

| 키 패턴 | 용도 |
|---|---|
| `{name}:keyword` | 키워드 집합 |
| `{name}:prefix` | 트라이 접두사 간선 |
| `{name}:suffix` | 트라이 접미사 링크 |
| `{name}:output:{state}` | 상태별 출력 키워드 |
| `{name}:node:{keyword}` | 노드 메타데이터 |

앞의 세 키는 컬렉션마다 하나씩만 생기지만 `node`는 키워드마다 하나씩, `output`은 출력이 있는 트라이 상태마다 하나씩 생긴다. 키워드마다 끝 상태가 하나씩 있어 전체 키 수가 키워드 수의 두 배를 넘으므로, 키워드 10만 개라면 키는 최소 20만 개가 넘는다. 접미사 매칭이 많은 사전은 출력 상태도 더 많아져, 메모리 오버헤드뿐 아니라 `KEYS`나 `SCAN`으로 운영하고 컬렉션을 지우는 비용까지 커진다.

쓰기 비용은 더 컸다. 당시 V1의 `Add()`는 트라이를 노드 하나씩 걸으며 키를 갱신해 왕복 횟수가 **추가하는 키워드의 길이**에 비례했고 5글자 키워드에는 왕복 53회, 26글자에는 507회가 필요했다.

## V2의 해시 구조

V2는 트라이 전체를 해시 몇 개에 직렬화해서 저장한다.

```text
{name}:trie      (hash)
  keywords -> ["keyword1", "keyword2", ...]
  prefixes -> ["", "h", "he", ...]
  version  -> <int64 optimistic lock>

{name}:outputs   (hash)
  he  -> ["he"]
  she -> ["he", "she"]

{name}:nodes     (hash, migration only)
  keyword1 -> ["s0","s1","s2"]
```

대부분의 컬렉션은 `:trie`와 `:outputs` 두 키만 쓰고 V1에서 마이그레이션한 경우에만 `:nodes`가 추가된다. 키워드 10만 개라면 V1의 최소 20만 개 넘는 키가 2개로 줄어들어, v0.4.0 릴리즈 노트에 "키 99% 감소"라고 적을 수 있었다. 키 수가 키워드 수와 관계없이 고정되므로 사전이 커질수록 감소율은 99%를 훌쩍 넘는다.

### 쓰기는 Lua 스크립트 하나로

쓰기는 클라이언트가 새 트라이를 계산한 뒤 Lua 스크립트 하나로 커밋하며, 이때 `version` 필드로 낙관적 잠금을 건다.

```go
// v2WriteScript commits a planned trie mutation under optimistic locking:
// it rejects the write (returns 0) when another client has already moved the
// version on, and otherwise swaps in the new trie fields and output states.
//
// Precompiled with redis.NewScript so calls go out as EVALSHA.
var v2WriteScript = redis.NewScript(`
	local trieKey = KEYS[1]
	local outputsKey = KEYS[2]
	local oldVersion = ARGV[1]
	-- ...
	local currentVersion = redis.call('HGET', trieKey, 'version')
	if currentVersion and currentVersion ~= oldVersion then
		return 0
	end

	redis.call('HSET', trieKey, 'keywords', keywords, 'prefixes', prefixes, 'version', newVersion)

	-- Decode before the DEL: a cjson error aborts the script without rolling
	-- back the commands already run, so nothing destructive may precede it.
	local outputs = cjson.decode(outputsJson)

	if clearOutputs then
		redis.call('DEL', outputsKey)
	end
	-- ...
`)
```

다른 클라이언트가 먼저 버전을 올렸으면 스크립트가 0을 돌려주고 클라이언트는 다시 읽어서 계산한다. 충돌이 없다면 읽기 한 번과 커밋 한 번으로 끝나므로 키워드 길이와 관계없이 왕복은 2회다.

이 스크립트에는 v0.6.x에서 고친 두 가지가 담겨 있다.

**Lua 에러는 롤백되지 않는다.** Redis 스크립트가 중간 에러로 멈춰도 이미 실행한 명령은 되돌리지 않는데, 처음에는 `DEL outputsKey`를 실행한 뒤 JSON을 디코딩하고 있었다. 디코딩에 실패하면 출력 해시가 지워진 채로 남으므로 v0.6.1에서 `DEL`을 디코딩 뒤로 옮겼다.

다만 이 수정으로 스크립트 전체가 안전해진 것은 아니다. `HSET trieKey`가 여전히 디코딩보다 **앞에** 있어, `outputsJson`이 잘못된 JSON이면 트라이 필드(키워드, 접두사, 버전)는 새 값이 되고 출력 해시는 옛 값으로 남는다. 출력 해시가 통째로 사라지는 경우는 막았어도 부분 갱신은 여전히 가능한 셈이다. 실제로는 클라이언트가 직접 만든 JSON을 넘겨 디코딩에 실패할 일이 드물지만 완전히 안전하게 만들려면 모든 쓰기보다 디코딩과 검증을 먼저 해야 한다.

**`EVAL` 대신 `EVALSHA`.** v0.6.0에서 인라인 `EVAL` 호출을 패키지 수준의 `redis.NewScript` 변수로 바꿔, 스크립트 본문을 매번 보내지 않고 SHA만 보내도록 했다.

버전 생성 방식도 고쳤다. 처음에는 나노초 타임스탬프에 난수를 더했는데 `int64`가 넘칠 수 있어서, 지금은 하위 48비트에 타임스탬프를, 상위 16비트에 난수 2바이트를 넣어 같은 나노초에 두 인스턴스가 버전을 만들어도 충돌할 확률이 낮도록 했다.

### 측정이 바꾼 주장

v0.4.0 릴리즈 노트에 V2가 "왕복을 80\~85% 줄인다"고 적은 것은 당시 V1의 `Find()`가 방문하는 상태마다 여러 번 왕복했기 때문이다. 그런데 v0.10.1에서 V1 `Find()`도 다른 모드와 같은 메모리 automaton으로 스캔하게 바꾸자 V1 역시 `SMEMBERS` 한 번이면 읽을 수 있게 됐다. 그래서 현재 두 스키마를 비교하면 다음과 같다.

| 지표 | V1 | V2 |
|---|---|---|
| 키워드 10만 개당 키 | 20만 개 이상 (키워드 수에 비례) | 2 |
| `Find()` 왕복 | 1 | 1 |
| `Add()` 왕복 | 키워드 길이에 비례 (5글자 53, 26글자 507) | 2 |
| `Add()` 시간 | 기준 | 약 14배 빠름 |
| `Find()` 시간, 캐시 없음 | 기준 | 키워드 1,000개에서 약 1.7배 **느림** |

표의 V1 쓰기 수치는 과거 구현을 테스트용 fixture로 보존해 측정한 비교값으로, v1.5.0 이후 공개 API는 V1 쓰기를 `ErrV1ReadOnly`로 거절한다.

캐시가 없다면 V2의 확실한 이득은 **쓰기** 쪽이고, 읽기는 상태마다 항목이 있는 출력 해시를 가져와야 해서 오히려 V1보다 조금 느리다. 읽기 성능을 크게 높이는 것은 `EnableCache`와 `Preset` 엔진인데 둘 다 V2에서만 사용할 수 있다. 현재 문서에서는 이 차이를 구분해 설명하고 있으며 주장과 측정값을 다시 맞춘 과정은 [측정 기반 성능 글](/ko/posts/2026/10/01/acor-measured-performance/)에서 자세히 다뤘다.

## 마이그레이션 API

V2가 새 컬렉션의 기본값이 되면서(v0.4.0, BREAKING), 기존 V1 컬렉션을 옮길 방법이 필요했다.

마이그레이션 잠금이 막는 것은 다른 마이그레이션뿐이고 일반 쓰기는 계속 가능하기 때문에, 실행하기 전에 해당 컬렉션에 쓰는 구버전 V1 클라이언트부터 멈춰야 한다. 마지막 키 교체는 원자적이어도 데이터를 단계별로 모으는 전체 과정이 일관된 스냅샷이라는 보장은 없으므로, 아래 API와 CLI를 사용할 때 모두 이 조건을 확인해야 한다.

```go
result, err := ac.MigrateV1ToV2(&acor.MigrationOptions{
    Progress: func(done, total int, msg string) {
        fmt.Printf("[%d/%d] %s\n", done, total, msg)
    },
})
if err != nil {
    log.Fatal(err)
}
fmt.Printf("Migrated %d keywords in %dms\n", result.Keywords, result.DurationMs)
```

마이그레이션은 다음 다섯 단계로 진행된다.

1. 동시 마이그레이션을 막는 잠금을 잡는다. 클라이언트가 죽어도 풀리도록 TTL을 5분으로 둔다.
2. V2에 필요한 V1 데이터(키워드, 접두사, 출력, 노드)를 모은다.
3. V2 구조를 임시 키에 쓴다.
4. 원자적으로 V2 키로 바꾸고, 선택적으로 V1 키를 지운다.
5. 잠금을 푼다.

옵션은 세 가지가 있다.

- **`DryRun`**: 무엇을 옮길지 세기만 하고 아무것도 쓰지 않는다. 다만 잠금은 실제 마이그레이션과 똑같이 잡았다 풀기 때문에 같은 컬렉션의 dry run과 실제 마이그레이션은 서로를 `ErrMigrationInProg`로 막는다. 진행 콜백도 4/5에서 멈추므로 진행 표시줄은 마지막 호출을 기다리지 말고 `done/total`로 그려야 한다.
- **`KeepOldKeys`**: V1 키를 남기며, 롤백하려면 이 옵션이 필요하다.
- **`Progress`**: 단계마다 호출되는 콜백이다.

CLI로도 같은 작업을 할 수 있지만 플래그의 위치에 주의해야 한다. `acor` CLI는 플래그 집합을 전역으로 한 번 파싱하므로 `-dry-run`과 `-keep-old-keys`를 명령 이름보다 **앞에** 둬야 하며 `migrate --dry-run`처럼 뒤에 쓰면 사용법 오류로 끝난다. `-keep-old-keys` 없이 실행하면 V1 키를 지워 롤백할 수 없다는 점도 확인해야 한다.

```bash
acor -name mycollection schema-version              # 현재 스키마 확인
acor -name mycollection -dry-run migrate            # 미리 보기
acor -name mycollection -keep-old-keys migrate      # 실행 (롤백 가능하도록 V1 키 유지)
acor -name mycollection migrate-rollback            # V1으로 되돌리기
```

### 롤백 시 주의사항

`RollbackToV1()`은 `KeepOldKeys`로 남겨 둔 V1 키가 있을 때만 동작하며 다음과 같은 대가도 문서 주석에 적어 두었다.

- 마이그레이션 이후 추가한 키워드는 사라진다. 그 키워드는 롤백이 지우는 V2 키에만 있고, 남겨 둔 V1 키는 그 이전 상태이기 때문이다.
- v1.5.0부터 V1은 쓰기를 받지 않으므로 컬렉션이 읽기 전용이 된다.
- 로컬 캐시가 멈춘다.

롤백하면 옛 클라이언트로 옛 데이터를 읽을 수는 있지만 V1을 계속 쓰는 용도로는 적합하지 않으니, 롤백을 염두에 두고 있다면 차라리 마이그레이션을 하지 않는 쪽과 비교해 보는 것이 좋다.

## 마이그레이션 이후 operations가 바뀌지 않은 문제

v0.5.0에서 내부 구조를 Strategy 패턴으로 바꿔, `AhoCorasick`이 스키마별 `operations` 구현(V1용, V2용)을 보관하고 모든 공개 메서드를 그쪽으로 위임하도록 했다.

v0.6.1에서는 이 구조와 관련된 또 다른 버그를 고쳤다. `MigrateV1ToV2`가 Redis 데이터는 V2로 옮겨 놓고 **인스턴스의 operations는 V1 그대로** 두어, 직후 같은 인스턴스에서 `Add`를 호출하면 V1 경로로 쓰기가 가고 있었고, `RollbackToV1`에서도 반대 방향으로 같은 문제가 있었다.

그래서 마이그레이션이나 롤백을 마칠 때 operations도 대상 스키마로 교체하고 대소문자 구분 같은 설정값은 그대로 옮기도록 했다. 데이터뿐 아니라 그 데이터를 다루는 코드까지 함께 바뀌어야 작업이 끝나는 셈인데, 지금은 `MigrateV1ToV2`가 성공하면 V2 operations로 전환돼 쓰기를 이어 갈 수 있다.

## V1의 단계적 은퇴

V1은 한 번에 없애지 않고 다섯 단계에 걸쳐 은퇴시켰다.

| 버전 | 변화 |
|---|---|
| v0.4.0 | 새 컬렉션의 기본값이 V2. `SchemaVersion: 1`로 V1 유지 가능 |
| v0.10.1 | V2 트라이 해시에서 쓰지 않는 `suffixes` 필드 제거 |
| v0.11.0 | `SchemaV1` deprecated. 읽기와 쓰기는 여전히 가능 |
| v1.5.0 | V1은 읽기 전용. `Add`/`Remove`는 `ErrV1ReadOnly` |
| v2 (예정) | V1 읽기 경로 제거. v1 라인 동안은 유지하고, 빨라도 v2에서 제거 |

`suffixes` 필드를 지운 과정에도 롤링 업그레이드 조건이 반영돼 있다. 이 필드는 모든 접두사를 거꾸로 저장해 추가와 삭제 때마다 다시 쓰고 있었지만 정작 어떤 매칭 코드도 읽지 않고 있었다. 그렇다고 바로 지우지는 않고, 새 버전에서는 쓰기만 중단하고 남아 있는 값은 무시하다가 다음 `Flush` 때 지워지게 했는데, 덕분에 롤링 업그레이드 중에도 옛 바이너리와 새 바이너리가 같은 컬렉션을 함께 쓸 수 있다.

읽기 전용 단계에서도 `Find`, `FindIndex`, `Suggest`, `Info`, `Flush`, `MigrateV1ToV2`는 계속 동작해 기존 컬렉션을 읽거나 제자리에서 변환할 수 있다. 다만 `Flush`는 여전히 모든 키를 지우므로, 읽기 전용이 키워드 쓰기를 거절한다는 뜻이지 컬렉션까지 보호한다는 뜻은 아니라는 점에 주의해야 한다.

## 마치며

마이그레이션 전에는 구버전 클라이언트의 쓰기를 멈춘 뒤 dry run으로 대상을 확인하고 롤백이 필요하다면 `KeepOldKeys`를 지정해야 한다. 다만 남겨 둔 V1 키에 이후의 V2 쓰기가 반영되지는 않으며 v1.5.0 이후 클라이언트에서 V1은 읽기 전용이므로 되돌렸을 때 사용할 수 있는 범위도 미리 확인하는 편이 좋다.

전체 소스 코드는 [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor)에서 확인할 수 있다.
