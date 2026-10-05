---
title: "로컬 AWS 에뮬레이터에서 boto3 호환성 달성하기"
description: "로컬 AWS 에뮬레이터 DevCloud가 여러 AWS 프로토콜을 한 게이트웨이에서 구분해 처리하는 방법과, boto3 호환성 테스트 699건 중 28건이 실패했던 원인을 정리한다."
date: 2026-04-19T00:00:00+09:00
tags: [aws, emulator, boto3, python, devcloud]
---

AWS를 사용하는 애플리케이션을 개발하다 보면 테스트 환경 때문에 불편할 때가 많다. CI에서 실제 AWS를 호출하면 비용이 나가고, 회사 네트워크나 VPN이 없으면 개발이 막히고, 새로 합류한 사람은 자격 증명부터 받아야 한다. 이런 불편함을 줄여보려고 로컬에서 띄울 수 있는 AWS 에뮬레이터인 [DevCloud](https://github.com/skyoo2003/devcloud)를 만들고 있다.

DevCloud의 목표는 "SDK 입장에서 진짜 AWS와 구별되지 않는 것"이다. 그래서 boto3로 각 서비스의 오퍼레이션을 실제로 호출해보는 호환성 테스트를 만들어 두었는데, 처음 전체를 돌렸을 때 결과는 **699건 중 671건 통과(96%)** 였다. 이번 글에서는 DevCloud가 여러 AWS 프로토콜을 하나의 포트에서 어떻게 구분하는지, 그리고 실패했던 28건이 어떤 문제였는지 정리해보려 한다.

## AWS 에뮬레이션이 까다로운 이유

보통의 API는 프로토콜이 하나다. 그런데 AWS는 서비스마다 사용하는 프로토콜이 다르다. 크게 나누면 아래와 같다.

| 프로토콜 | 대표 서비스 | 특징 |
|---|---|---|
| REST-XML | S3, Route 53 | HTTP 메서드와 경로로 오퍼레이션 결정, XML 응답 |
| REST-JSON | Lambda, SESv2 | HTTP 메서드와 경로로 오퍼레이션 결정, JSON 응답 |
| JSON 1.0 / 1.1 | DynamoDB, SQS(JSON) | `X-Amz-Target` 헤더로 오퍼레이션 결정 |
| Query | IAM, STS, SQS(Query) | form-urlencoded 바디의 `Action=`으로 오퍼레이션 결정 |

프로토콜마다 요청을 읽는 방법, 응답을 만드는 방법, 에러를 표현하는 방법이 전부 다르다. 즉, "AWS API" 하나를 만드는 게 아니라 같은 서비스 모델을 공유하는 여러 프로토콜 구현체를 만드는 셈이다.

게다가 응답의 구조만 맞으면 끝나는 것도 아니다. 에러 코드 문자열, 타임스탬프 형식, 페이지네이션 토큰, XML 엘리먼트 이름 같은 세부 사항 하나만 달라도 SDK에서 파싱이 실패하거나 엉뚱한 값이 나온다.

## 하나의 게이트웨이에서 프로토콜 구분하기

DevCloud는 모든 서비스를 4747 포트 하나로 받는다. 요청이 들어오면 공통 미들웨어(패닉 복구, 요청 크기 제한, CORS, `X-Amz-Request-Id` 생성, 요청 로깅)를 거친 뒤에, 요청의 헤더와 바디를 보고 프로토콜과 서비스를 판별한다.

```go
// internal/gateway/protocol.go
func DetectProtocol(r *http.Request) (protocol string, serviceID string) {
	// 1. JSON 프로토콜: X-Amz-Target 헤더가 있다.
	if target := r.Header.Get("X-Amz-Target"); target != "" {
		contentType := r.Header.Get("Content-Type")
		proto := jsonProtocolFromContentType(contentType)
		service := serviceFromTarget(target)
		return proto, service
	}

	// 2. Query 프로토콜: form-urlencoded 바디에 Action= 이 있다.
	contentType := r.Header.Get("Content-Type")
	if strings.Contains(contentType, "application/x-www-form-urlencoded") {
		bodyBytes, err := io.ReadAll(r.Body)
		if err == nil {
			r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			if strings.Contains(string(bodyBytes), "Action=") {
				service := serviceFromQueryRequest(r, string(bodyBytes))
				return "query", service
			}
		}
	}

	// 3. SigV4 서명의 서비스 이름으로 REST-JSON 서비스를 찾는다.
	if svc := serviceFromSigV4(r); svc != "" && svc != "s3" {
		normalized := normalizeServiceID(svc)
		if normalized == "ses" {
			normalized = "sesv2"
		}
		if normalized == "opensearch" && strings.Contains(r.URL.Path, "/2015-01-01/") {
			normalized = "elasticsearchservice"
		}
		return "rest-json", normalized
	}

	// 4. 나머지는 REST-XML(S3)로 본다.
	return "rest-xml", "s3"
}
```

여기서는 확인하는 순서가 중요하다. SQS는 JSON과 Query 프로토콜을 둘 다 지원하는 서비스라서, `X-Amz-Target` 헤더가 있으면 JSON으로, 없고 바디에 `Action=`이 있으면 Query로 처리해야 한다. 그리고 Query 판별을 위해 바디를 한 번 읽었다면, 뒤에서 다시 읽을 수 있도록 `r.Body`를 되돌려 놓아야 한다. (이걸 빠뜨리면 서비스 핸들러에서 빈 바디를 받게 된다.)

3번의 예외 처리도 실제로 부딪히면서 추가한 부분이다. SES와 SESv2는 SigV4 서명 이름이 둘 다 `ses`이고, Elasticsearch와 OpenSearch도 둘 다 `es`를 쓴다. 그래서 서명 이름만으로는 구분이 안 되고, REST-JSON인 SESv2로 보내거나 경로에 `/2015-01-01/`이 있는지로 레거시 Elasticsearch API를 따로 구분하고 있다. 이 밖에도 SDK가 보내는 서비스 이름을 내부 ID로 바꿔주는 `normalizeServiceID`가 꽤 긴 switch 문으로 되어 있다.

## 프로토콜별로 다른 직렬화

### REST-XML (S3)

S3는 HTTP 메서드와 경로, 쿼리 스트링 조합으로 오퍼레이션이 결정된다.

```
PUT    /my-bucket/my-key        → PutObject
GET    /my-bucket?list-type=2   → ListObjectsV2
DELETE /my-bucket/my-key        → DeleteObject
HEAD   /my-bucket/my-key        → HeadObject
POST   /my-bucket?delete        → DeleteObjects
```

응답은 XML이고, boto3는 서비스 모델에 정의된 엘리먼트 이름을 기준으로 값을 꺼낸다. 엘리먼트 이름이 하나라도 다르면 에러가 나는 게 아니라 그 필드가 조용히 빠진 채로 응답이 만들어지기 때문에, 오히려 문제를 찾기가 더 어렵다.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>my-bucket</Name>
    <KeyCount>1</KeyCount>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>hello.txt</Key>
        <LastModified>2026-04-19T12:00:00.000Z</LastModified>
        <ETag>"..."</ETag>
        <Size>16</Size>
        <StorageClass>STANDARD</StorageClass>
    </Contents>
</ListBucketResult>
```

### JSON 1.0 / 1.1 (DynamoDB 등)

JSON 프로토콜은 라우팅이 단순하다. `X-Amz-Target`이 `서비스이름_API버전.오퍼레이션` 형식이라서 이것만 잘라보면 된다.

```
X-Amz-Target: DynamoDB_20120810.CreateTable
Content-Type: application/x-amz-json-1.0

{"TableName": "users", "KeySchema": [...], "AttributeDefinitions": [...]}
```

에러는 `__type` 필드에 에러 코드를 담아서 반환한다.

```json
{"__type": "ResourceNotFoundException", "message": "Requested resource not found"}
```

### Query (IAM, STS 등)

Query 프로토콜은 모든 파라미터를 form-urlencoded로 보낸다.

```
Action=GetUser&Version=2010-05-08&UserName=alice
```

리스트나 맵도 `member.1=Value1&member.2=Value2`처럼 인덱스를 붙인 평탄한 키로 표현하기 때문에, 중첩된 구조를 다시 조립하는 부분이 생각보다 까다로웠다. 응답은 REST-XML처럼 XML이지만, `<GetUserResponse><GetUserResult>...</GetUserResult></GetUserResponse>`처럼 오퍼레이션 이름으로 한 번 더 감싸는 형태다.

## 실패한 28건은 무엇이었나

호환성 테스트는 `tests/compatibility/` 아래에 서비스별 pytest 파일로 되어 있다. 테스트가 DevCloud 서버를 띄운 뒤에, boto3 클라이언트로 오퍼레이션을 호출하고 응답 값을 확인하는 방식이다. 단위 테스트와 달리 실제 SDK의 직렬화/역직렬화를 그대로 거치기 때문에, 서버 코드만 봐서는 알기 어려운 형식 문제를 잡아준다.

처음 실행했을 때 실패한 28건을 원인별로 보면 아래와 같았다.

| 원인 | 서비스 |
|---|---|
| 태그를 맵이 아니라 `[{key, value}]` 리스트로 반환해야 함 | Bedrock, Textract |
| boto3가 붙이는 `/v1` 경로 접두사를 처리하지 못함 | S3 Tables |
| 같은 POST 요청이 생성인지 수정인지 구분하지 못함, 바디의 `GroupName`을 읽지 않음 | EventBridge Scheduler |
| camelCase/PascalCase 파라미터 이름 혼용, 응답 키 대소문자 | Serverless Application Repository |
| botocore 버전에 따라 달라지는 파라미터, 필수 파라미터 누락 등 테스트 코드 쪽 문제 | Route 53, Support, Textract |

대부분은 기능이 없어서가 아니라 **응답 형식이 SDK가 기대하는 것과 조금씩 달라서** 생긴 문제였다. 예를 들어 Bedrock은 태그를 `{"env": "dev"}` 같은 맵으로 돌려주고 있었는데, 서비스 모델은 `[{"key": "env", "value": "dev"}]` 형태의 리스트를 기대한다. 서버 쪽에서는 정상 응답이지만 boto3에서는 파싱 결과가 기대와 다르게 나온다. 이 28건은 같은 날 [#4](https://github.com/skyoo2003/devcloud/pull/4)에서 모두 수정했다.

그리고 테스트가 실패했는데 원인이 서버가 아니라 테스트 환경이었던 경우도 있었다. 테스트용 서버를 띄울 때 저장소에 없는 `devcloud.yaml`을 `-config`로 넘기고 있었는데, 서버가 설정 파일을 찾지 못하고 바로 종료되어 버렸다. 서버의 stderr를 버리고 있었기 때문에, 테스트에서는 30초 동안 서버를 기다리다가 타임아웃이 나는 것만 보였다. 지금은 설정 파일이 있을 때만 넘기고, 서버가 뜨지 않으면 stderr 내용을 에러 메시지에 같이 보여주도록 바꿨다.

## 서비스 플러그인 구조

각 서비스는 `ServicePlugin` 인터페이스를 구현하고, 중앙 레지스트리에 팩토리를 등록하는 방식으로 붙는다.

```go
type ServicePlugin interface {
	ServiceID() string
	ServiceName() string
	Protocol() ProtocolType
	Init(config PluginConfig) error
	Shutdown(ctx context.Context) error
	HandleRequest(ctx context.Context, op string, req *http.Request) (*Response, error)
	ListResources(ctx context.Context) ([]Resource, error)
	GetMetrics(ctx context.Context) (*ServiceMetrics, error)
}
```

게이트웨이는 프로토콜과 서비스, 오퍼레이션 이름까지만 결정하고, 실제 요청을 해석해서 응답을 만드는 일은 각 서비스의 `HandleRequest`가 맡는다. 서비스 골격은 AWS의 Smithy 모델로부터 코드 생성기로 만들어내는데, 이 부분은 [Smithy 코드 생성 글](/ko/posts/2026/04/19/smithy-codegen-aws-services/)에서 따로 정리했다. 다만, S3, DynamoDB, SQS처럼 자주 쓰는 서비스는 직렬화까지 직접 작성한 코드가 대부분이고, 생성된 직렬화 코드를 그대로 쓰는 서비스는 아직 일부다.

## 사용 방법

기존 코드는 그대로 두고 엔드포인트만 DevCloud로 바꾸면 된다.

```bash
$ docker run -p 4747:4747 ghcr.io/skyoo2003/devcloud:latest
```

```python
import boto3

s3 = boto3.client(
    "s3",
    endpoint_url="http://localhost:4747",
    region_name="us-east-1",
    aws_access_key_id="test",
    aws_secret_access_key="test",
)

s3.create_bucket(Bucket="my-bucket")
s3.put_object(Bucket="my-bucket", Key="hello.txt", Body=b"Hello, DevCloud!")
response = s3.get_object(Bucket="my-bucket", Key="hello.txt")
print(response["Body"].read())  # b'Hello, DevCloud!'
```

AWS CLI나 Terraform도 마찬가지로 엔드포인트만 지정하면 된다.

```bash
$ aws --endpoint-url http://localhost:4747 s3 ls

$ export AWS_ENDPOINT_URL=http://localhost:4747
$ terraform apply
```

## 정리

에뮬레이터를 만들면서 느낀 점은, 구현 난이도가 비즈니스 로직보다 **직렬화 형식을 정확히 맞추는 쪽**에 몰려 있다는 것이다. 이번에 실패한 28건도 대부분 태그 형식, 경로 접두사, 파라미터 이름의 대소문자 같은 작은 차이였다. 이런 차이는 서버 코드만 봐서는 잘 보이지 않기 때문에, 실제 SDK로 호출해보는 테스트를 먼저 갖춰 둔 것이 가장 도움이 되었다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
