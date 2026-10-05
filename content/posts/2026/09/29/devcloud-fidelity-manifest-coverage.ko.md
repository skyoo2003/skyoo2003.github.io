---
title: "서비스 431개라고 말하기 전에: DevCloud의 Fidelity Manifest와 커버리지 지표"
description: "서비스 수 대신 오퍼레이션 단위 세 등급과 자동 생성 manifest로 DevCloud 커버리지를 세고, 문서의 숫자를 CI로 검사하는 방법을 다룬다."
date: 2026-09-29T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [aws, devcloud, testing, documentation]
---

참고로 이 글은 2026-10-05에 보완했으며, v1.2.0 이후 main의 [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c)를 기준으로 설명한다.

에뮬레이터 README를 보면 지원 서비스 수가 가장 먼저 눈에 들어온다. [DevCloud](https://github.com/skyoo2003/devcloud)도 처음에는 이 숫자를 앞세웠는데, v1.1.0을 준비하며 문서를 훑어보니 README는 104개, FAQ는 101개라고 적혀 있었고 실제 등록된 서비스는 148개였다. 같은 숫자를 설명하는 문서끼리도 맞지 않았던 것이다.

더 큰 문제는 그 숫자가 무엇을 뜻하는지 정의한 적이 없다는 것이었다. 서비스 하나를 "지원한다"고 할 때 요청이 DevCloud로 라우팅되기만 해도 되는지, 오퍼레이션 하나라도 응답해야 하는지, 손으로 구현해 boto3 테스트까지 통과해야 하는지가 불분명했고, 숫자 하나만으로는 이 셋을 구분할 방법도 없었다.

이 글에서는 오퍼레이션마다 신뢰 등급을 매기는 **fidelity manifest**부터 목표 서비스 수를 수요 조사로 정한 과정, 문서의 숫자가 바이너리와 어긋나면 CI가 실패하게 만든 장치까지 DevCloud가 이 문제를 다룬 방법을 살펴본다.

## 오퍼레이션 단위의 세 등급

서비스 단위의 숫자로는 신뢰할 수 있는 범위를 표현하기 어려워, 모든 오퍼레이션을 다음 세 등급 중 하나로 분류하기로 했다.

| 등급 | 의미 | 믿어도 되는 범위 |
|---|---|---|
| `hand-verified` | 서비스 프로바이더가 오퍼레이션을 직접 구현 | 수동 구현 여부를 뜻함. 동작 보장은 해당 테스트가 확인한 범위에 한정 |
| `auto-crud` | [Generic CRUD 엔진](/ko/posts/2026/09/28/devcloud-generic-crud-engine/)이 응답. 저장소 기반의 그럴듯한 응답 | SDK 연결과 create → get → list → delete 왕복. 그 이상은 아님 |
| `unimplemented` | 응답하지 않음. 가짜 성공 대신 실패 | DevCloud가 이 호출을 처리하지 않는다는 사실을 빨리 아는 것 |

`unimplemented` 오퍼레이션은 프로바이더가 거절하는 방식에 따라 `InvalidAction`(400), `NotImplemented`(501), 서비스 고유의 `UnsupportedOperation`이나 `MethodNotAllowed`를 돌려준다. 에러를 하나로 통일한 것은 아니며 호환성 정책도 **실패한다는 사실**만 약속하므로 구체적인 코드는 1.x 안에서 바뀔 수 있다.

manifest는 런타임에 admin API로 읽을 수 있는데, 이 API는 기본으로 꺼져 있으므로 `admin.enabled: true`를 설정해야 한다.

```bash
curl -s 'localhost:4747/devcloud/api/fidelity?service=s3'
```

아래는 기준 커밋의 S3 응답이다. `counts`는 전체 집계이며, `operations`는 두 항목만 발췌했다.

```json
{
  "s3": {
    "modelBacked": true,
    "counts": {"hand-verified": 37, "auto-crud": 65, "unimplemented": 5},
    "operations": {"PutObject": "hand-verified", "SelectObjectContent": "unimplemented"}
  }
}
```

Go 코드에서는 생성된 패키지로 조회한다.

```go
tier, ok := fidelity.Lookup("s3", "PutObject") // TierHandVerified, true
```

`ok`가 false이면 모르는 서비스라서 아예 라우팅되지 않은 것이고, `unimplemented`는 오퍼레이션이 프로바이더까지 도달한 뒤 거절된 경우이므로 조회 결과를 볼 때 둘을 구분해야 한다.

## manifest는 손으로 쓰지 않는다

manifest를 사람이 관리하면 금방 낡으므로 `make codegen`이 세 가지 입력을 받아 생성하도록 했다.

| 입력 | 출처 | 기여 |
|---|---|---|
| 오퍼레이션 전체 집합 | `api/smithy/*.json` (리소스에 붙은 오퍼레이션 포함) | 알려진 모든 오퍼레이션 |
| `auto-crud` | 생성된 CRUD 레지스트리 | 엔진이 처리할 수 있는 오퍼레이션 |
| `hand-verified` | 각 프로바이더 `HandleRequest` dispatch의 `case` 리터럴 | 구현된 오퍼레이션 |

물론 생성기를 만들었다고 바로 정확한 manifest가 나온 것은 아니었고, 큰 오류를 세 번 고치고 나서야 분류가 맞아졌다.

**첫째, 실제로 처리하는 오퍼레이션을 숨겼다.** 초기에는 프로바이더의 dispatch와 Smithy 모델의 교집합으로 manifest를 계산했지만 프로바이더가 모델에 없는 오퍼레이션도 처리한다는 점을 놓쳤다. `dynamodbstreams`는 오퍼레이션이 4개뿐인 모델 위에서 22개를 처리하고 `bedrock`은 AWS가 bedrock-runtime 모델에 둔 `InvokeModel`을 처리한다. 교집합 대신 dispatch를 직접 읽도록 바꾸자 숨어 있던 오퍼레이션 **226개**가 드러났고, 반대로 패키지 전체를 읽던 스캐너가 `identitystore`의 속성 패치에 쓰는 `"DisplayName"`이나 `pipes`의 경로 해석에 쓰는 `"POST"`까지 오퍼레이션으로 세어 만들어 낸 가짜 항목 5개는 없앴다. 지금은 `HandleRequest`와 거기서 위임하는 함수만 스캔하고 있다.

**둘째, 도달할 수 없는 오퍼레이션을 `auto-crud`로 표시했다.** CRUD 레지스트리에 등록돼 있어도 프로바이더가 미구현 오퍼레이션을 엔진에 넘기지 않으면 실제 요청은 거절된다. 등록은 엔진이 분류할 수 있다는 뜻일 뿐이므로, 지금은 프로바이더가 실제로 엔진에 위임하는 경우에만 `auto-crud`를 준다.

**셋째, 짧은 이름을 버렸다.** `hand-verified` 스캐너가 네 글자 이상인 문자열만 후보로 받아들이다 보니 바로 옆에 구현 코드가 있는 `resourcegroups.Tag`까지 `unimplemented`로 분류하고 있었다. 지금은 짧은 리터럴도 따로 모은 뒤 서비스 모델에 선언된 이름인지 확인하고 오퍼레이션으로 올린다.

같은 누락을 반복하지 않으려고 생성 결과를 여러 테스트로 검사한다. `TestFidelityManifestCoverage`는 정해진 등급 밖의 값이 있거나, CRUD 레지스트리에 처리 가능한 오퍼레이션이 있는데도 manifest에 응답 가능한 오퍼레이션이 하나도 없으면 실패한다. 응답 가능한 등급에는 `hand-verified`와 `auto-crud`가 모두 포함되며 CRUD 등록 항목도 없는 서비스라면 응답 가능한 오퍼레이션이 0개여도 이 조건으로 실패하지 않는다.

등록 서비스의 manifest 누락은 `TestFidelityManifestCoversRegisteredServices`, CRUD 항목 누락과 등급 오류는 `TestFidelityManifestCoversCRUDRegistry`, 실제 JSON 응답 여부는 `TestAutoCRUDIsServedOverJSON`으로 각각 확인한다.

## 수요에 따른 목표 서비스 선정

등급을 정하고 나니 몇 개 서비스를 목표로 할 것인지도 결정해야 했다.

원래는 AWS가 공개한 모든 서비스를 목표로 삼았지만, DevCloud가 등록하지 않은 서비스도 누군가는 원할 것이라는 가정을 검증해 본 적은 없었다. 그래서 미등록 서비스 283개를 만들기 전에 이 가정부터 확인해 보기로 했다.

DevCloud에는 사용 통계가 없어서, 사용자가 요청할 때만 서비스를 추가하는 세 프로젝트를 대리 지표로 삼았다.

| 출처 | 대상 사용자 | 서비스 수 |
|---|---|---|
| moto | boto3로 테스트하는 Python 개발자 | 163 |
| LocalStack | 로컬 AWS 에뮬레이터 사용자 | 119 |
| terraform-provider-aws | IaC 사용자 | 273 |

**숫자를 보기 전에 판정 규칙부터 정했다.** 미등록 서비스 중 60% 이상을 두 곳 이상이 지원하면 "전체 서비스" 목표를 유지하고 100개 이상이면 수요 집합으로 목표를 좁히기로 했다. 둘 다 못 미치는 경우에는 "전체" 주장을 버리고 수요 집합을 목표로 삼도록 정해, 방법 자체가 실패했을 때도 결과를 보고 편한 해석을 고르지 못하게 했다.

| 지표 | 값 |
|---|---|
| 미등록 서비스 | 283 |
| 세 곳 모두 지원 | 8 |
| 두 곳 이상 지원 | **57 (20.1%)** |
| 한 곳만 지원 | 111 |
| 아무도 지원 안 함 | 115 |
| DevCloud에 들어온 서비스 요청(전체 기간) | **0** |

57개는 어느 기준에도 못 미쳤으므로 미리 정한 대로 "전체 깊이" 목표를 버리고 당시 등록돼 있던 148개에 57개를 더한 **205개**를 깊이 목표로 정했다. 당시 미등록 서비스 283개 중 약 80%(226개)는 DevCloud보다 역사도 길고 인력도 많은 세 프로젝트 가운데 두 곳 이상이 만들지 않은 서비스였다. 그중 115개는 세 프로젝트 모두 만들지 않았고 111개는 한 곳만 만들었으니, 롱테일은 원래 이런 모양이라고 봐야 할 것 같다.

## 분모가 둘인 이유

v1.2.0에서는 나머지 226개 서비스도 모두 등록했지만 수요 조사 결론이 뒤집힌 것은 아니다. 조사에서 판단한 것은 수요가 있다는 가정만으로 283개를 **손으로 만드는 비용**을 들일 필요가 없다는 것이었다. 코드 생성 스캐폴드가 생기면서 226개 등록을 `make codegen` 플래그 하나로 끝낼 수 있게 됐고 이 서비스들은 CRUD 엔진 수준으로만 응답한다.

여기서 등록 여부를 AWS 호출 여부와 혼동하지 않도록 주의해야 한다. SDK 호출이 어디로 가는지는 `endpoint_url` 같은 엔드포인트 설정이 정하므로, 실제 AWS를 가리키는 클라이언트는 DevCloud가 서비스를 몇 개 등록했든 AWS로 간다. 반대로 DevCloud에 도착한 요청은 등록 여부와 관계없이 밖으로 전달되지 않으며 미등록 서비스라면 게이트웨이가 `UnknownService`(400)로 거절한다.

결국 등록의 실제 효과는 로컬에서 서비스를 인식하게 된다는 점이다. 등록한 서비스는 오퍼레이션 단위로 응답하거나 AWS 형식의 에러로 거절하고 fidelity manifest에도 오르기 때문에, 라우팅 목표는 "공개된 모든 모델"을 기준으로 잡고 비용이 드는 깊이 약속은 수요에 맞춰 따로 정했다. DevCloud가 목표를 두 개로 나눠 공개하는 것도 이 때문이다.

| 축 | 서비스 | 기준 |
|---|---|---|
| 라우팅 목표 | 431 / 431 | 공개된 모든 모델을 등록 |
| 깊이 목표 | 205 | 2026-09-05 수요 조사 |
| 등록됐지만 깊이 약속 없음 | 226 | CRUD 엔진 수준 |

오퍼레이션 등급 비율도 분모를 밝혀야 한다.

| 등급 | 깊이 목표 205개 | 등록 전체 431개 |
|---|---|---|
| `hand-verified` | 4,497 | 4,528 |
| `auto-crud` | 5,910 | 11,588 |
| `unimplemented` | 2,000 | 3,085 |
| **hand-verified 비율** | **36.2%** | **23.6%** |

오른쪽 열의 23.6%는 품질이 낮아졌다는 뜻이 아니다. 226개 서비스를 등록하면서 분모가 커졌을 뿐 각 오퍼레이션의 충실도는 그대로이므로, 이 차이를 오독하지 않도록 두 열을 항상 함께 싣는다.

## 문서의 숫자를 CI가 검사한다

사람이 숫자를 다섯 군데에 손으로 적으면 언젠가 어긋나기 때문에, 문서의 숫자를 맞추자는 규칙만으로는 충분하지 않았다. DevCloud에서는 숫자를 기록하는 위치를 하나로 모으고 그 값을 CI에서 검사하도록 바꿨다.

첫째, 숫자는 `docs/coverage.md` 한 곳에만 두고 다른 문서에서는 이 페이지를 링크하도록 했다.

둘째, `go test ./cmd/devcloud/`가 그 페이지의 숫자를 바이너리에 등록된 레지스트리와 비교하는데, 문서의 표는 다음과 같이 정규식으로 읽는다.

```go
// coverageRowPattern matches one row of the summary table at the top of
// docs/coverage.md:
//
//	| **Registered** | The gateway routes the service. … | **205** |
//
// The label is anchored to the row start so a number quoted in prose elsewhere
// on the page cannot be mistaken for the published figure.
func coverageRowPattern(label string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^\|\s*\*\*` + regexp.QuoteMeta(label) + `\*\*\s*\|[^|]*\|\s*\*\*(\d+)\*\*\s*\|`)
}
```

표의 행을 정확히 하나만 찾지 못하면 테스트가 실패하도록 해, 페이지 구조가 바뀌었을 때 엉뚱한 칸을 읽고 통과하는 일을 막았다. 코드만 바꾸고 문서를 고치지 않아도, 반대로 문서만 고쳐도 실패하는 양방향 검사인 셈이다. 서비스 수, 등급별 오퍼레이션 수, 비율, 목표 표의 산술, README와의 일치까지 아홉 개 테스트로 확인한다.

매주 Smithy 모델을 동기화하는 워크플로우도 여기에 맞춰 바뀌었다. 2026-09-06에 한 번 측정해 보니 모델 194개를 갱신했을 때 93개가 바뀌었고 그중 32개는 오퍼레이션이 늘거나 줄었으며, 문서만 바뀐 모델은 하나도 없었다. 오퍼레이션이 바뀌면 문서 숫자 검사가 의도대로 실패하기 때문에, 이제는 동기화 워크플로우가 숫자를 다시 계산해 자기 PR에 커밋하고 어떤 숫자가 바뀌었는지 PR 본문에 적어 두도록 했다. 덕분에 리뷰어는 숫자를 다시 계산할 필요 없이 그 오퍼레이션이 정말 바뀌어야 했는지 판단하면 된다.

## 수요를 직접 모으는 장치

세 프로젝트는 어디까지나 대리 지표일 뿐이라, 실제 수요를 모으기 위해 admin API에 엔드포인트를 하나 더 만들었다.

```bash
curl -s localhost:4747/devcloud/api/unrouted | jq .
```

```json
{
  "services": [
    { "serviceId": "appflow", "count": 2,
      "firstSeen": "2026-09-05T17:54:25+09:00",
      "lastSeen": "2026-09-05T17:54:40+09:00" }
  ],
  "maxServiceIds": 1000,
  "droppedServiceIds": 0
}
```

이 엔드포인트는 DevCloud가 요청을 받았지만 라우팅하지 못한 서비스를 세므로, 결과를 "Service Not Supported" 이슈 양식에 붙여 실제 수요를 알릴 수 있는데, 이런 사용자 보고 하나가 대리 지표 셋보다 훨씬 강한 신호가 된다. 서비스 ID는 호출자가 보낸 헤더에서 가져오므로 서로 다른 ID 수에 상한을 두었고, 상한 때문에 버린 개수도 함께 보고한다. 데이터는 메모리에만 보관하고 밖으로 보내지 않는다.

## 정리

DevCloud는 서비스 431개를 라우팅하고 그중 426개에서 오퍼레이션 하나 이상에 응답하지만 깊이 목표는 별도로 205개 서비스를 기준으로 삼는다. 실제로 사용할 때는 등록 개수만 보기보다 필요한 오퍼레이션의 등급과 테스트를 먼저 확인하는 편이 좋다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
