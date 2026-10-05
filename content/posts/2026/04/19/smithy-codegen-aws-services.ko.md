---
title: "Smithy 모델로 AWS 서비스를 자동 생성하는 방법"
description: "AWS Smithy 모델 JSON을 파싱하고 Go 템플릿으로 서비스별 타입, 라우터, 직렬화 코드와 스캐폴드를 생성하는 DevCloud의 코드 생성 파이프라인과 그 한계를 정리한다."
date: 2026-04-19T00:00:00+09:00
tags: [aws, smithy, codegen, go, devcloud]
---

[DevCloud](https://github.com/skyoo2003/devcloud)를 만들면서 가장 먼저 부딪힌 문제는 "AWS 서비스가 너무 많다"는 것이었다. 서비스마다 오퍼레이션이 수십, 수백 개씩 있고, 요청/응답 구조와 프로토콜도 제각각이다. 문서를 보면서 구조체를 하나씩 손으로 옮겨 적는 방식으로는 S3 하나도 끝내기 어렵다.

다행히 AWS는 모든 서비스의 API를 [Smithy](https://smithy.io/)라는 IDL로 정의해서 공개하고 있다. AWS SDK들도 이 모델로부터 생성된다. 그렇다면 SDK가 그렇게 하듯이, 에뮬레이터도 같은 모델에서 서버 쪽 코드를 생성하면 되지 않을까? 이번 글에서는 DevCloud의 Smithy 코드 생성 파이프라인을 정리하고, 실제로 써보니 어디까지 도움이 되었고 어디서 한계가 있었는지도 같이 이야기해보려 한다.

## Smithy 모델 간략하게 알아보기

Smithy는 AWS가 만든 인터페이스 정의 언어(IDL)다. Protocol Buffers나 OpenAPI와 비슷한 역할이지만, 구조체 정의뿐만 아니라 **어떤 프로토콜을 쓰는지, HTTP 메서드와 경로가 무엇인지, 어떤 에러를 던지는지, 페이지네이션은 어떻게 하는지** 같은 정보까지 trait으로 모델 안에 같이 들어 있다는 점이 다르다.

모델은 JSON(AST) 형태로도 배포되는데, DevCloud는 [aws-sdk-go-v2 저장소](https://github.com/aws/aws-sdk-go-v2/tree/main/codegen/sdk-codegen/aws-models)에 있는 모델 파일을 그대로 내려받아서 사용한다. S3의 `PutObject` 오퍼레이션을 간략하게 보면 아래와 같은 형태다.

```json
{
  "smithy": "2.0",
  "shapes": {
    "com.amazonaws.s3#PutObject": {
      "type": "operation",
      "input": { "target": "com.amazonaws.s3#PutObjectRequest" },
      "output": { "target": "com.amazonaws.s3#PutObjectOutput" },
      "traits": {
        "smithy.api#http": { "method": "PUT", "uri": "/{Bucket}/{Key+}?x-id=PutObject" }
      }
    },
    "com.amazonaws.s3#PutObjectRequest": {
      "type": "structure",
      "members": {
        "Bucket": { "target": "com.amazonaws.s3#BucketName", "traits": { "smithy.api#httpLabel": {} } },
        "Key": { "target": "com.amazonaws.s3#ObjectKey", "traits": { "smithy.api#httpLabel": {} } }
      }
    }
  }
}
```

오퍼레이션의 입력/출력 구조체, HTTP 메서드와 URI 패턴, 각 멤버가 경로(`httpLabel`)에서 오는지 헤더나 바디에서 오는지까지 모델만 보고 알 수 있다. 프로토콜은 서비스 shape에 `aws.protocols#restXml` 같은 trait으로 붙어 있다.

## 파이프라인 구조

전체 흐름을 그려보면 아래와 같다.

```
smithy-models/*.json
       │
       ▼
  1. 파싱: Smithy JSON → 중간 표현 (서비스, 오퍼레이션, shape)
       │
       ▼
  2. 렌더링: text/template 으로 서비스별 Go 파일 생성
       │   internal/generated/<service>/
       │     types.go          요청/응답 구조체
       │     interface.go      오퍼레이션 인터페이스
       │     base_provider.go  모든 오퍼레이션이 ErrNotImplemented 를 반환하는 스텁
       │     serializer.go     HTTP 요청 → 입력 구조체
       │     deserializer.go   출력 구조체 → HTTP 응답
       │     router.go         HTTP 메서드/URI → 오퍼레이션 이름
       │     errors.go         에러 타입
       │
       │   internal/services/<service>/  (없을 때만 생성)
       │     provider.go, register.go    서비스 플러그인 골격
       ▼
  3. 매주 GitHub Actions 에서 모델을 다시 받아 재생성하고, 바뀐 게 있으면 PR 생성
```

### 1단계: 파싱

파서는 Smithy JSON을 일단 `json.RawMessage`로 받아둔 뒤에, shape의 `type`에 따라 필요한 필드만 꺼내서 중간 표현으로 바꾼다.

```go
type rawModel struct {
	Smithy string                     `json:"smithy"`
	Shapes map[string]json.RawMessage `json:"shapes"`
}

type rawShape struct {
	Type       string                     `json:"type"`
	Operations []rawTarget                `json:"operations"`
	Input      *rawTarget                 `json:"input"`
	Output     *rawTarget                 `json:"output"`
	Errors     []rawTarget                `json:"errors"`
	Members    map[string]rawMember       `json:"members"`
	Member     *rawMember                 `json:"member"`
	Traits     map[string]json.RawMessage `json:"traits"`
}
```

프로토콜은 서비스 shape의 trait 키로 판별한다.

```go
func detectProtocol(s *rawShape) string {
	if _, ok := s.Traits["aws.protocols#restXml"]; ok {
		return "rest-xml"
	}
	if _, ok := s.Traits["aws.protocols#awsJson1_0"]; ok {
		return "json-1.0"
	}
	if _, ok := s.Traits["aws.protocols#awsJson1_1"]; ok {
		return "json-1.1"
	}
	if _, ok := s.Traits["aws.protocols#awsQuery"]; ok {
		return "query"
	}
	if _, ok := s.Traits["aws.protocols#restJson1"]; ok {
		return "rest-json"
	}
	return ""
}
```

정리하다 보니 하나 빠진 게 보이는데, EC2가 쓰는 `aws.protocols#ec2Query`는 여기서 처리하지 않아서 빈 문자열이 된다. EC2는 아직 스캐폴드 수준이라 당장 문제가 되진 않았지만, 나중에 손봐야 할 부분이다.

shape 이름은 `com.amazonaws.s3#PutObjectRequest`처럼 네임스페이스와 `#`이 붙어 있어서, `#` 뒤의 짧은 이름만 Go 타입 이름으로 사용한다. 입력이 없는 오퍼레이션은 Smithy의 빌트인 타입인 `smithy.api#Unit`을 참조한다.

### 2단계: 템플릿 렌더링

파싱한 결과는 `internal/codegen/templates/`의 `text/template` 파일로 렌더링한다. 예를 들어 `types.go.tmpl`은 구조체마다 JSON과 XML 태그를 같이 달아준다. 하나의 구조체를 JSON 프로토콜에서도, XML 프로토콜에서도 쓸 수 있게 하기 위해서다.

```go
{{ range .Structures -}}
type {{ .Name }} struct {
{{ range .Members -}}
	{{ .Name }} {{ .GoType }} `json:"{{ .JSONTag }}" xml:"{{ .XMLTag }}"`
{{ end -}}
}
{{ end -}}
```

REST 프로토콜 서비스는 `router.go`에 HTTP 메서드와 URI 패턴을 오퍼레이션 이름으로 매핑하는 테이블이 생성된다. S3는 같은 경로에 쿼리 스트링만 다른 오퍼레이션이 많아서, 패턴에도 쿼리 스트링이 같이 들어간다.

```go
var OperationRoutes = []OperationRoute{
	{Method: "PUT", Pattern: "/{Bucket}/{Key+}?x-id=CopyObject", Operation: "CopyObject"},
	{Method: "PUT", Pattern: "/{Bucket}", Operation: "CreateBucket"},
	{Method: "DELETE", Pattern: "/{Bucket}?cors", Operation: "DeleteBucketCors"},
	{Method: "DELETE", Pattern: "/{Bucket}/{Key+}?x-id=DeleteObject", Operation: "DeleteObject"},
	// ...
}
```

`{Key+}`의 `+`는 슬래시를 포함한 여러 경로 세그먼트를 한 번에 받는다는 의미다. 객체 키에 `/`가 들어가는 S3에서는 꼭 필요한 문법이다.

`serializer.go`에는 HTTP 요청을 입력 구조체로 바꾸는 함수가 생성된다. 모델의 `httpLabel`, `httpHeader`, `httpQuery` trait을 보고 경로, 헤더, 쿼리 스트링에서 각각 값을 꺼내는 코드다.

```go
func DeserializeAbortMultipartUploadRequest(r *http.Request, pathParams PathParams) (*AbortMultipartUploadRequest, error) {
	input := &AbortMultipartUploadRequest{}

	if v, ok := pathParams["Bucket"]; ok {
		input.Bucket = v
	}

	input.ExpectedBucketOwner = r.Header.Get("x-amz-expected-bucket-owner")
	// ...
}
```

`base_provider.go`는 모든 오퍼레이션이 `ErrNotImplemented`를 감싼 에러를 반환하는 스텁이다.

```go
var ErrNotImplemented = fmt.Errorf("operation not implemented")

type BaseProvider struct{}

func (b *BaseProvider) CreateBucket(ctx context.Context, input *CreateBucketRequest) (*CreateBucketOutput, error) {
	return nil, fmt.Errorf("CreateBucket: %w", ErrNotImplemented)
}
```

그리고 `internal/services/<service>/`에 서비스 디렉토리가 아직 없다면, 이 `BaseProvider`를 임베딩한 `Provider`와 레지스트리 등록 코드를 골격으로 만들어준다. 이미 있는 파일은 덮어쓰지 않는다. 새 서비스를 추가할 때는 이 골격에서 필요한 오퍼레이션부터 채워 나가면 된다.

### 3단계: 매주 모델 동기화

AWS는 수시로 오퍼레이션이나 필드를 추가한다. 이걸 손으로 따라가기는 어려우니, 매주 월요일에 GitHub Actions에서 모델을 다시 받아 코드를 재생성하고, 바뀐 게 있으면 테스트를 돌린 뒤 PR을 만들도록 했다.

```yaml
# .github/workflows/smithy-sync.yml (일부)
on:
  schedule:
    - cron: "0 0 * * 1"  # 매주 월요일 00:00 UTC
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Download latest Smithy models
        run: bash scripts/download-smithy-models.sh
      - name: Run code generation
        run: |
          CGO_ENABLED=1 go run ./cmd/codegen \
            -models ./smithy-models \
            -output ./internal/generated \
            -templates ./internal/codegen/templates \
            -scaffold-output ./internal/services
      - name: Check for changes
        id: changes
        run: |
          if git diff --quiet; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi
      - name: Run tests
        if: steps.changes.outputs.changed == 'true'
        run: CGO_ENABLED=1 go test ./internal/... -v
      - name: Create Pull Request
        if: steps.changes.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v8
        with:
          title: "chore: weekly Smithy model sync"
          branch: smithy-sync/weekly
```

모델이 바뀌지 않은 주에는 아무 일도 일어나지 않고, 바뀐 주에만 PR이 올라온다. 리뷰할 때 생성 코드의 diff를 보면 AWS가 그 주에 어떤 API를 바꿨는지도 자연스럽게 알 수 있어서 의외로 쓸모가 있었다.

## 그래서 실제로 얼마나 도움이 되었나

솔직하게 이야기하면, 처음 기대했던 것처럼 "생성된 코드 위에 비즈니스 로직만 얹으면 끝"이 되지는 않았다.

DevCloud의 플러그인 인터페이스는 `HandleRequest(ctx, op, req)` 하나로 요청을 받는다. 생성된 골격의 `HandleRequest`도 기본적으로 `ErrNotImplemented`를 반환할 뿐이라서, 결국 각 서비스가 오퍼레이션 이름으로 분기하는 코드를 직접 작성해야 한다. 게다가 S3, SQS, DynamoDB, IAM, Lambda처럼 먼저 구현한 핵심 서비스들은 요청 파싱과 응답 직렬화까지 직접 작성했다. AWS SDK가 기대하는 미묘한 응답 형식(XML 엘리먼트 이름, 에러 코드, 빈 리스트 처리 등)을 하나씩 맞추다 보니, 범용 템플릿으로 생성한 직렬화 코드로는 부족한 경우가 많았다. 현재 생성된 패키지를 실제로 import 해서 쓰는 서비스는 Bedrock, CloudFront, EFS, Route 53, STS 정도다.

그럼에도 코드 생성은 아래와 같은 점에서 충분히 가치가 있었다.

- **96개 서비스, 4,400여 개 오퍼레이션의 목록과 타입이 항상 최신 상태로 존재한다.** 새 서비스를 구현할 때 문서 대신 생성된 `types.go`와 `router.go`를 보면서 시작할 수 있다.
- **아직 구현하지 않은 오퍼레이션이 명확하게 드러난다.** 스캐폴드 단계의 서비스도 일단 등록되고 응답하기 때문에, 대시보드나 호환성 테스트에서 어디가 비어 있는지 바로 보인다.
- **AWS의 API 변경을 놓치지 않는다.** 매주 올라오는 PR이 일종의 변경 알림 역할을 한다.

## 정리

Smithy 모델에서 코드를 생성하는 방식은 서비스 수가 많은 AWS 에뮬레이터에서 출발점을 만드는 데 확실히 효과적이었다. 다만 SDK 호환성을 실제로 맞추는 마지막 단계는 여전히 서비스별로 손이 많이 간다. 앞으로는 핵심 서비스에서 반복적으로 손으로 작성한 패턴들을 템플릿 쪽으로 다시 옮겨서, 생성 코드를 그대로 쓸 수 있는 서비스를 늘려가는 것이 목표다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
