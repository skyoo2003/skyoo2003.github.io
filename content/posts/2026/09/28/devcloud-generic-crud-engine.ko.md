---
title: "모델만으로 수천 개 AWS 오퍼레이션에 응답하기: DevCloud의 Generic CRUD 엔진"
description: "코드 생성 시점의 오퍼레이션 분류만으로 수천 개 AWS API에 응답하는 DevCloud Generic CRUD 엔진의 구조와 가짜 성공을 거절하는 원칙을 설명한다."
date: 2026-09-28T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [aws, smithy, go, devcloud, emulator]
---

## 들어가며

참고로 이 글은 2026-10-05에 보완했으며, v1.2.0 이후 main의 [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c)를 기준으로 설명한다.

[DevCloud](https://github.com/skyoo2003/devcloud)는 로컬에서 돌아가는 AWS 에뮬레이터다. [이전 글](/ko/posts/2026/04/19/smithy-codegen-aws-services/)에서 Smithy 모델로 서비스별 타입과 라우터, 직렬화 코드, `NotImplemented`를 돌려주는 스텁까지 생성하는 파이프라인을 다루고 "스텁은 시작점이지 끝점이 아니다"라는 말로 마무리했는데, 이번에는 그 다음 이야기를 해보려 한다.

스텁을 생성하고 나면 라우터는 있는데 구현이 없는 오퍼레이션이 수천 개 남는데, S3, DynamoDB, SQS 같은 핵심 서비스를 손으로 구현하던 속도로는 이 롱테일을 따라잡을 수 없다. 그렇다고 아무 요청에나 `200`을 돌려주면 SDK가 이를 성공으로 받아들이기 때문에 로컬에서 통과한 코드가 실제 AWS에서 깨지게 된다.

v1.0.0에서 DevCloud에 넣은 **Generic CRUD 엔진**은 Smithy 모델에서 생성·조회·목록·삭제·수정 모양을 한 오퍼레이션을 골라내 하나의 범용 저장소로 처리한다. 처음에는 JSON 프로토콜 46개 서비스의 약 2,200개 오퍼레이션을 처리했고 v1.1.0에서 모든 프로토콜로 범위를 넓히면서 4,858개로 늘었다. v1.2.0 이후 위 기준 커밋에서는 등록 서비스 431개의 **11,588개** 오퍼레이션에 이 엔진으로 응답한다.

이 글에서는 엔진이 오퍼레이션을 분류하는 방법, 프로토콜마다 오퍼레이션 이름을 찾는 위치, 그리고 무엇보다 **모르는 요청을 거절하는 방법**을 살펴본다.

## Generic CRUD 엔진의 동작 범위

엔진의 계약은 문서 첫 단락에 적혀 있다.

> Fidelity is deliberately "plausible, not faithful."

엔진은 요청에 들어온 값을 저장소에 기록했다가 되돌려주고 ID와 ARN을 합성하므로, SDK에서는 create → get → list → delete 왕복을 자연스럽게 이어 갈 수 있다. 다만 **입력 검증, 리소스 간 무결성, 정확한 페이지네이션, 비즈니스 로직은 없다.** 따라서 로컬에서 SDK 연결(wiring)을 확인하는 용도로는 쓸 수 있어도 실제 동작의 호환성까지 보장하지는 않는다.

엔진이 하는 일과 하지 않는 일이 섞이면 "로컬에서 됐다"는 말이 아무 의미도 없어지므로, 처음부터 이 범위를 구분해 두었다. 엔진이 응답하는 오퍼레이션을 [fidelity manifest](/ko/posts/2026/09/29/devcloud-fidelity-manifest-coverage/)에 `auto-crud`로 따로 표시하는 것도 같은 취지다.

## 분류기, 엔진, 게이트웨이 구성

엔진은 크게 세 부분으로 나눌 수 있다.

| 조각 | 위치 | 하는 일 |
|---|---|---|
| 분류 | `internal/codegen/gen_crud_meta.go` | 오퍼레이션 이름과 출력 shape로 CRUD 메타데이터 생성 |
| 엔진 | `internal/shared/crud/crud.go` | 리소스 저장소와 동사(verb)별 디스패치 |
| 연결 | `internal/gateway/router.go` | 프로바이더가 처리하지 않은 요청만 엔진으로 전달 |

### 분류는 코드 생성 시점에 한다

분류기는 `make codegen` 단계에서 오퍼레이션 이름의 접두어로 동사를 정하고 나머지를 단수형 리소스 이름으로 바꾼다.

```go
// verbPrefixes maps operation-name prefixes to canonical CRUD verbs, longest and
// most specific first. Only high-confidence CRUD shapes are classified; anything
// else is left unclassified so the engine returns an honest "unknown action".
var verbPrefixes = []struct{ prefix, verb string }{
	{"Untag", "Untag"},
	{"Tag", "Tag"},
	{"Describe", "Get"},
	{"BatchGet", "List"},
	{"Get", "Get"},
	{"List", "List"},
	{"Create", "Create"},
	{"Register", "Create"},
	{"Deregister", "Delete"},
	{"Delete", "Delete"},
	{"Update", "Update"},
	{"Modify", "Update"},
	{"Put", "Update"},
}
```

이렇게 분류하면 `CreateDatabase`와 `ListDatabases`가 `Database`라는 같은 저장소 버킷을 쓰게 된다. 여기에 출력 shape에서 찾은 컬렉션 멤버(list key)와 단일 리소스를 감싸는 멤버(item key)를 더해 `OpMeta`로 정리하고 `internal/generated/crudregistry/registry_gen.go`의 `init()` 하나에서 등록한다.

```go
type OpMeta struct {
	Verb          string // canonical action: Create, Get, List, Delete, Update, Tag, Untag, Relate, Toggle
	Resource      string // singular resource key, e.g. "Database"
	OutputListKey string // output member holding the collection (List ops)
	OutputItemKey string // output member wrapping a single resource ("" = flat echo)

	Method string // e.g. "GET"
	URI    string // e.g. "/v1/graphs/{GraphName}"
}
```

접두어 목록에 `Start`, `Stop`, `Invoke`, `Import` 같은 동사가 없는 것은 의도한 것으로, 확신이 없는 모양은 일부러 분류하지 않고 뒤에서 살펴볼 거절 경로로 보낸다.

### 손으로 쓴 구현이 항상 이긴다

프로바이더가 dispatch의 `default:`에서 `plugin.ErrUnhandledOp`를 돌려줄 때만 게이트웨이가 엔진을 부르므로, 엔진이 프로바이더를 대체하는 구조는 아니다.

```go
// A provider that returns ErrUnhandledOp is opting into the generic CRUD
// fallback for operations it does not implement. If the engine cannot
// classify the operation either, emit the standard "unknown action" error.
if errors.Is(err, plugin.ErrUnhandledOp) || isUnimplementedResponse(resp) {
	res, cerr := crud.Handle(crud.Call{
		Service:  serviceID,
		Protocol: protocol,
		Op:       op,
		Method:   r.Method,
		URI:      r.URL.RequestURI(),
		Body:     body,
	})
	if cerr != nil && errors.Is(err, plugin.ErrUnhandledOp) {
		writeAWSError(w, protocol, http.StatusBadRequest, "InvalidAction", "unknown action: "+op)
		return
	}
	// ...
}
```

프로바이더에 손으로 구현한 `case`가 있으면 엔진은 호출되지 않으므로 실제 구현을 가리는 일도 없다. 오퍼레이션을 `auto-crud`에서 `hand-verified`로 올릴 때도 프로바이더에 명시적인 `case`를 추가하면 된다.

## 프로토콜마다 오퍼레이션 이름이 있는 곳이 다르다

엔진이 요청을 분류하려면 먼저 이 요청이 어떤 오퍼레이션인지 알아야 한다. [boto3 호환성 글](/ko/posts/2026/04/19/local-aws-emulator-boto3-compatibility/)에서 다룬 것처럼 AWS는 서비스마다 프로토콜이 다르고, 오퍼레이션 이름이 실리는 위치도 제각각이다.

| 프로토콜 | 오퍼레이션 이름의 출처 | 엔진 지원 |
|---|---|---|
| `json-1.0`, `json-1.1` | `X-Amz-Target` 헤더 | 지원 |
| `rest-json` | 메서드 + 경로를 모델의 URI 템플릿과 대조 | 지원 |
| `rest-xml` | 위와 같음 | 지원 |
| `query` | 폼 바디의 `Action` 필드 | 지원 |
| `ec2-query` | — | 미지원 |

v1.0.0의 엔진이 JSON 프로토콜만 처리한 것은 헤더에 오퍼레이션 이름이 그대로 있어 찾기 쉬웠기 때문이다. 반면 REST 계열은 요청 어디에도 이름이 적혀 있지 않아, Smithy 모델에 정의된 `GET /v1/graphs/{GraphName}` 같은 메서드와 URI 템플릿으로 오퍼레이션을 찾아야 한다. v1.1.0에서는 `internal/shared/httproute`가 이 쌍을 이름으로 바꾸도록 연결해 `rest-json`과 `rest-xml`도 엔진에서 처리할 수 있게 했다.

`query`는 경로 정보가 없어도 폼 바디의 `Action` 필드에서 이름을 읽을 수 있다. 비슷해 보이는 `ec2-query`는 같은 프로토콜로 처리할 수 없어 EC2를 수동 프로바이더에 맡기며 직접 구현하지 않은 오퍼레이션에는 Generic CRUD 대체 경로도 없다. 기준 manifest에서 EC2 오퍼레이션 65개는 `hand-verified`, 691개는 `unimplemented`로 분류돼 있다.

`crud.Handle` 앞부분이 이 분기를 그대로 보여 준다.

```go
switch {
case JSONProtocol(c.Protocol):
	// The operation name arrived in X-Amz-Target; nothing to resolve.
case c.Protocol == protocolQuery:
	op, form = parseQueryForm(c.Body)
	if op == "" {
		return nil, ErrUnclassified
	}
case c.Protocol == protocolRESTJSON, c.Protocol == protocolRESTXML:
	rest = true
	mu.RLock()
	rs := routes[c.Service]
	mu.RUnlock()
	if op, labels = httproute.Match(rs, c.Method, c.URI); op == "" {
		return nil, ErrUnclassified
	}
default:
	return nil, ErrUnclassified
}
```

### 파라미터의 우선순위

REST 프로토콜에서는 값이 세 군데서 올 수 있어서 엔진은 `httpQuery` 값, 요청 바디, 경로 레이블 순으로 덜 권위 있는 값부터 덮어쓰며, 결국 리소스를 가리키는 URI의 경로 레이블이 우선하게 된다. 실제 SDK는 한 멤버를 두 곳에 동시에 싣지 않으니 이 순서가 쓰일 일은 거의 없지만, 손으로 만든 요청이 바디로 조회 대상을 바꾸지 못하도록 규칙을 정해 두었다.

몇 가지는 일부러 읽지 않는다.

- **`rest-xml` 요청 바디.** `rest-xml`을 쓰는 S3는 바디가 수 GB짜리 업로드일 수 있어 게이트웨이가 버퍼링하지 않으므로, `rest-xml` 오퍼레이션은 경로와 쿼리만으로 처리한다. CRUD 모양을 한 S3 Control 오퍼레이션은 모두 경로로 리소스를 가리키기 때문에 이렇게 해도 잃는 것은 없다.
- **`query`의 `Action`, `Version`.** 둘은 요청을 설명하는 값이지 리소스 속성이 아니어서, 저장해 두면 응답 결과 안에 `<Action>CreateLoadBalancer</Action>`이 그대로 되돌아온다.
- **`httpHeader` 멤버, `httpPayload` blob, 스트리밍 바디.** 식별자가 헤더로만 오는 오퍼레이션은 호출자가 준 ID 대신 생성한 ID를 받게 되는데, 이 정도는 "그럴듯하게"라는 계약 범위 안이라고 봤다.

## 디스패치와 저장소

분류가 끝난 뒤의 디스패치는 동사별 `switch` 하나로 처리한다.

```go
switch m.Verb {
case "Create":
	id := resourceID(m.Resource, params)
	item := maps.Clone(params)
	stamp(item, service, m.Resource, id)
	if err := put(service, m.Resource, id, item); err != nil {
		return nil, err
	}
	return okBody(protocol, op, wrapItem(m, item))

case "Get":
	// A Describe*/Get* whose output is a collection returns the stored list,
	// not a single-resource lookup.
	// ...
case "Tag", "Untag", "Relate", "Toggle":
	// Relationship / tag / status flips: acknowledge without modelling state.
	return okBody(protocol, op, map[string]any{})

default:
	return nil, ErrUnclassified
}
```

ID는 요청 파라미터에서 `<Resource>Name`, `<Resource>Id`, `<Resource>Arn`, `Name`, `Id` 순으로 찾되 없으면 `res-` 접두어로 생성한다. 리소스는 `service|resource`를 키로 쓰는 문서 저장소에 넣는데, 실제 데이터는 DevCloud 데이터 디렉토리의 SQLite 테이블에 저장하므로 재시작해도 남는다.

SQLite 영속화는 [2026-09-30의 변경](https://github.com/skyoo2003/devcloud/commit/734b83995a3f750f0db827ec9299bc8ed81a530c)에서 추가된 것으로, v1.2.0 릴리즈의 Generic CRUD 저장소는 메모리 map이라 그 버전에서는 재시작하면 데이터가 사라진다.

JSON 프로토콜에는 JSON 바디를, `query`와 `rest-xml`에는 XML을 돌려주지만 같은 XML이라도 응답을 감싸는 구조에 주의해야 한다. botocore의 query 파서는 `<OperationResponse>` 안에 `<OperationResult>`가 있다고 가정해 이 구조가 없으면 **에러 없이 빈 결과**를 돌려주는 반면, `rest-xml` 파서는 루트 요소의 자식을 바로 출력 shape에 대응시킨다. 이 차이를 놓치면 테스트는 통과하는데 값은 비어 있는 상황이 생긴다.

## 거절: 가짜 성공을 만들지 않는다

엔진을 만들면서 가장 신경 쓴 부분은 오히려 **거절**이었다. 다음과 같은 요청은 저장소를 건드리지 않고 `InvalidAction`으로 거절한다.

- 메서드와 경로가 서비스 라우트 테이블의 어떤 항목과도 맞지 않는다.
- `Action`이 서비스가 등록하지 않은 오퍼레이션을 가리킨다.
- 오퍼레이션은 찾았지만 분류기가 동사를 정하지 못했다.

`rest-xml`에서는 게이트웨이의 프로토콜 감지기가 분류할 수 없는 요청을 S3로 보내므로 이 규칙이 특히 중요하다. S3처럼 생긴 경로가 엔진에 들어왔더라도 범용 저장소에서 답하지 말고 분류 불가로 돌려보내야 한다.

이 원칙은 엔진 밖의 프로바이더에도 적용했다. v1.0.0 이전의 CloudFront 프로바이더는 미구현 오퍼레이션 **122개**에 빈 XML 문서와 HTTP 200을 돌려주고 있었는데, boto3는 이를 정상적인 빈 결과로 파싱했다. 지금은 다른 32개 프로바이더처럼 `NotImplemented`(HTTP 501)를 돌려줘 SDK가 "아직 에뮬레이션하지 않은 오퍼레이션"과 "잘못된 요청"을 구분할 수 있게 했다.

## 버그: 더 넓은 형제 라우트가 대신 답하다

v1.2.0에서는 라우터만 있고 프로바이더가 없던 218개 서비스를 코드 생성 스캐폴드로 등록했다. 스캐폴드가 직접 구현하는 것은 없고 `ErrUnhandledOp`만 돌려주기 때문에, 등록하는 순간부터 CRUD 모양의 오퍼레이션은 엔진이 처리하고 나머지는 거절하게 된다.

이 작업 중에 오래된 가짜 성공도 드러났다. Amazon Chime의 `AssociatePhoneNumberWithUser`가 `UpdateUser`의 200을 돌려주고 있었고 API Gateway의 `ImportRestApi`도 `CreateRestApi`의 응답을 받고 있었다.

엔진의 라우트 테이블에는 분류된 오퍼레이션만 들어 있었는데, `httproute.Match`는 자신이 **가진** 라우트 중 가장 구체적인 것을 고른다. 분류되지 않은 오퍼레이션의 구체적인 경로가 테이블에서 빠져 있으면 이를 덮는 더 넓은 형제 패턴이 대신 선택되므로, 요청과 다른 오퍼레이션이 답하게 된 것이다.

그래서 `classifyOps`가 REST에 묶인 **모든** 오퍼레이션을 라우트 테이블에 기록하되, 분류하지 못한 것은 `Verb`를 비워 두도록 수정했다. 이제 구체적인 라우트가 존재하므로 넓은 라우트를 이기고, `crud.Handle`은 원래 하던 `Verb` 검사에서 요청을 거절한다.

```go
mu.RLock()
m, ok := registry[c.Service][op]
mu.RUnlock()
if !ok || m.Verb == "" {
	return nil, ErrUnclassified
}
```

`Verb`가 빈 항목은 라우트로만 쓰고 기능으로는 세지 않도록, fidelity manifest를 만들 때 건너뛰고 `RegisteredOps`에서도 걸러 낸다.

두 사례가 호환성 테스트에 걸리지 않았던 것은 테스트가 서비스마다 오퍼레이션 하나만 고르면서 `Describe`/`List`/`Get`을 우선하고, 변경 작업인 `Import`는 제외했기 때문이다. 지금은 두 사례를 Go 테스트로 고정해 두었고, 무조건 거절하는 것만으로는 테스트를 통과할 수 없도록 반대 방향도 함께 검사한다.

## 알려진 한계

문서에 적어 둔 한계는 다음과 같다.

- `List*` 응답은 저장된 객체를 돌려준다. 실제 AWS 출력이 구조체가 아니라 이름 목록이면 SDK가 값을 채우지 못할 수 있다.
- 필수 파라미터를 검증하지 않으므로 최소한의 입력으로도 호출이 성공한다.
- 리스트는 AWS 기본값인 `<member>`로 감싼다. 모델이 리스트를 평탄화(flatten)해도 엔진은 그 정보를 쓰지 않는다.

엔진은 로컬에서 연결이 되는지 확인하는 도구일 뿐 그 이상의 동작까지 기대하게 만들어서는 안 되기 때문에, 이런 한계도 문서와 manifest에 그대로 드러내고 있다.

## 마치며

로컬에서 SDK 연결을 확인하려면 필요한 오퍼레이션이 `auto-crud`인지 먼저 살펴보면 된다. 입력 검증이나 리소스 간 동작까지 확인하려는 경우에는 수동 구현과 테스트 범위도 함께 봐야 하므로, [다음 글](/ko/posts/2026/09/29/devcloud-fidelity-manifest-coverage/)에서는 각 등급과 커버리지 집계 방식을 정리해보려 한다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
