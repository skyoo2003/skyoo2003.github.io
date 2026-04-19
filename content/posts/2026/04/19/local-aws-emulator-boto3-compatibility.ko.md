---
title: "로컬 AWS 에뮬레이터에서 boto3 호환성 달성하기"
date: 2026-04-19T00:00:00+09:00
tags: [aws, emulator, boto3, python, devcloud]
---

## 들어가며

클라우드 네이티브 애플리케이션을 개발하다 보면 느끼는 불편함이 있다. CI 파이프라인에서 AWS를 호출하면 비용이 청구되고, VPN이 없으면 개발이 멈추며, 온보딩에는 자격 증명 설정이 필요하다. [DevCloud](https://github.com/skyoo2003/devcloud)는 이 문제를 로컬에서 해결하는 AWS 에뮬레이터다.

boto3 호환성 테스트에서 **671/699 케이스 통과 (96%)**를 달성했다. 이 숫자는 단순한 테스트 통과율이 아니라, 프로토콜 설계가 얼마나 정확한지를 보여주는 지표다.

## 왜 AWS 에뮬레이션이 어려운가

해결책을 설명하기 전에, AWS 에뮬레이션이 왜 근본적으로 어려운지 이해할 필요가 있다.

대부분의 API는 프로토콜이 하나다. gRPC 서비스는 protobuf를 쓰고, REST API는 JSON을 쓰며, GraphQL은 자체 쿼리 언어를 사용한다. AWS는 **서로 다른 다섯 가지 프로토콜**을 서비스별로 사용하며, 각 프로토콜마다 직렬화 규칙, 에러 포맷, 인증 방식이 다르다. 단일한 "AWS API"는 존재하지 않는다 — 사실상 하나의 서비스 모델을 공유하는 다섯 개의 프로토콜 구현체를 만드는 셈이다.

두 번째 난제는 **동작 충실도(behavioral fidelity)**다. 올바른 JSON 구조를 반환하는 것만으로는 충분하지 않다. 타임스탬프는 정해진 정밀도의 ISO 8601 포맷이어야 하고, 에러 코드는 AWS 특정 문자열과 정확히 일치해야 하며, 페이지네이션 토큰은 SDK가 파싱할 수 있는 형태여야 하고, XML 응답은 boto3가 기대하는 정확한 네임스페이스 선언을 가져야 한다. 이 디테일 각각이 잠재적 호환성 실패 원인이다.

## 5가지 프로토콜, 하나의 게이트웨이

DevCloud는 다섯 가지 AWS 프로토콜을 단일 HTTP 게이트웨이에서 처리한다:

```
Client (boto3 / AWS CLI / Terraform / CDK)
  │
  ▼
API Gateway (port 4747)
  │
  ├─ Middleware Chain
  │   ├─ ErrorRecovery (패닉 복구)
  │   ├─ BodyLimit (요청 크기 제한)
  │   ├─ CORS (크로스 오리진 처리)
  │   ├─ RequestID (X-Amz-Request-Id)
  │   ├─ RequestLogger (구조화 로깅)
  │   └─ LogCollector (대시보드 실시간 로그)
  │
  ▼
Protocol Detector
  │
  ├─ X-Amz-Target 헤더 존재       → JSON 프로토콜 (DynamoDB, SQS JSON)
  ├─ Content-Type: x-www-form-urlencoded + Action= → Query 프로토콜 (IAM, STS, SQS)
  ├─ SigV4 서명에 Lambda 경로     → REST-JSON (Lambda)
  └─ 기본                         → REST-XML (S3)
```

### 프로토콜 자동 감지

들어오는 요청의 헤더만으로 프로토콜을 판별한다:

```go
// internal/gateway/protocol.go
func DetectProtocol(r *http.Request) (protocol string, serviceID string) {
    // 1. JSON 프로토콜: X-Amz-Target 헤더 존재
    if target := r.Header.Get("X-Amz-Target"); target != "" {
        contentType := r.Header.Get("Content-Type")
        proto := jsonProtocolFromContentType(contentType)
        service := serviceFromTarget(target)
        return proto, service
    }

    // 2. Query 프로토콜: form-encoded body에 Action= 파라미터
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

    // 3. SigV4 서명에서 REST 스타일 서비스 추출
    if svc := serviceFromSigV4(r); svc != "" && svc != "s3" {
        normalized := normalizeServiceID(svc)
        return "rest-json", normalized
    }

    // 4. 기본: REST-XML (S3)
    return "rest-xml", "s3"
}
```

감지 순서가 중요하다. `X-Amz-Target`을 먼저 확인해야 JSON 프로토콜 서비스(DynamoDB, Lambda)가 Query 프로토콜로 오인되지 않는다. SQS는 JSON과 Query 프로토콜을 모두 지원하는 특이한 서비스로, `X-Amz-Target` 헤더 유무로 구분한다.

### 서비스 이름 정규화

게이트웨이는 100개 이상의 AWS 서비스 이름을 내부 ID로 매핑하는 광범위한 테이블을 유지한다. 특수 케이스가 많다:

- SES → `sesv2` (Query가 아닌 REST-JSON)
- `opensearch` vs `elasticsearchservice` (경로 기반 구분)
- 서비스 이름 정규화 (공백 제거, 소문자 변환)

SDK가 서비스를 참조하는 방식에 관계없이 올바른 플러그인에 도달하도록 보장한다.

## 프로토콜별 직렬화 상세

각 프로토콜의 직렬화 방식은 완전히 다르다. 에뮬레이터에서 가장 까다로운 부분이 바로 이 직렬화/역직렬화 계층이다. 구체적인 예시를 살펴보자.

### REST-XML (S3)

S3는 가장 복잡한 프로토콜이다. 오퍼레이션은 HTTP 메서드와 경로로 결정되며, 응답은 특정 네임스페이스 선언이 있는 유효한 XML이어야 한다.

**요청 라우팅:**
```
PUT    /my-bucket/my-key HTTP/1.1          → PutObject
GET    /my-bucket?list-type=2 HTTP/1.1     → ListObjectsV2
DELETE /my-bucket/my-key HTTP/1.1          → DeleteObject
HEAD   /my-bucket/my-key HTTP/1.1          → HeadObject
POST   /my-bucket?delete HTTP/1.1          → DeleteObjects (다중 객체)
```

**응답 XML 구조:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<ListObjectsV2Output>
    <Name>my-bucket</Name>
    <Prefix></Prefix>
    <KeyCount>2</KeyCount>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>hello.txt</Key>
        <LastModified>2026-04-19T12:00:00.000Z</LastModified>
        <ETag>"d41d8cd98f00b204e9800998ecf8427e"</ETag>
        <Size>13</Size>
        <StorageClass>STANDARD</StorageClass>
    </Contents>
</ListObjectsV2Output>
```

boto3는 서비스 모델의 `xmlNamespace` 트레이트를 사용하여 이 XML을 파싱한다. 네임스페이스 선언이나 엘리먼트 순서가 틀리면, 역직렬화가 조용히 실패하거나 잘못된 값을 생성한다.

### JSON 1.0/1.1 (DynamoDB, Lambda)

JSON 프로토콜은 라우팅이 단순하지만 자체적인 뉘앙스가 있다:

```
X-Amz-Target: DynamoDB_20120810.CreateTable
Content-Type: application/x-amz-json-1.0

{"TableName": "users", "KeySchema": [...], "AttributeDefinitions": [...]}
```

JSON 1.0은 `application/x-amz-json-1.0`을 사용하고, 특정 `X-Amz-Target` 포맷을 따른다: `ServiceName_APIVersion.OperationName`. JSON 1.1은 `application/x-amz-json-1.1`과 약간 다른 타겟 포맷을 사용한다.

에러 응답은 특정 구조를 따른다:

```json
{"__type": "ResourceNotFoundException", "message": "Requested resource not found"}
```

### Query (IAM, STS)

Query 프로토콜은 모든 파라미터를 form-urlencoded 형식으로 인코딩한다:

```
Action=GetUser&Version=2010-05-08&UserName=alice
```

이 프로토콜은 몇 가지 독특한 직렬화 과제를 가지고 있다:

- **ECMAScript 날짜 포맷**: 타임스탬프가 `20260419T120000Z` (하이픈과 콜론 없음)으로 인코딩되며, ISO 8601이 아니다
- **평탄화 리스트**: `member.1=Value1&member.2=Value2` — JSON 배열이 아닌 인덱스 기반 표현
- **구조화 맵 키**: `AttributeName.1.Name=id&AttributeName.1.Value=userId` — 맵 키도 인덱스로 인코딩
- **부울린 인코딩**: `true`와 `false`를 소문자 문자열로 표현

## 96% 호환성의 의미

boto3 호환성 테스트는 실제 AWS SDK가 보내는 요청을 에뮬레이터에 재생하고, 응답이 SDK가 기대하는 구조와 일치하는지 검증한다. 이것은 단위 테스트가 아니라 **와이어 프로토콜 수준의 통합 테스트**다.

```
699개 테스트 케이스 실행
├─ 671개 통과 (96.0%)
├─ 28개 실패
│  ├─ 페이지네이션 엣지 케이스: 12개
│  │   └─ NextToken 포맷, exclusive StartKey 처리
│  ├─ 타임스탬프 포맷 미세 차이: 8개
│  │   └─ 밀리초 정밀도, 타임존 처리
│  └─ 예외 메시지 텍스트 차이: 8개
│       └─ AWS 정확 문구와 불일치
```

실패한 28개의 대부분은 기능적 오류가 아니라 **포맷 미세 차이**다:

1. **페이지네이션 (12개 실패)**: boto3는 한 응답의 `NextToken`을 다음 요청의 입력으로 사용한다. 토큰 포맷이 AWS와 다르면 페이지네이션이 깨진다. 우리 토큰은 base64 인코딩 포인터인 반면, AWS는 불투명한 암호화 토큰을 사용한다. SDK는 파싱할 수 있지만, 일부 엣지 케이스에서 라운드트립이 실패한다.

2. **타임스탬프 (8개 실패)**: AWS는 가변 정밀도의 타임스탬프를 반환한다 — 밀리초(`2026-04-19T12:00:00.123Z`)가 있고, 없는 것(`2026-04-19T12:00:00Z`)도 있다. SDK는 필드별로 특정 포맷을 기대한다. 우리 타임스탬프는 항상 밀리초 정밀도인데, 일부 필드는 소수점이 없는 것을 기대한다.

3. **에러 메시지 (8개 실패)**: `The bucket you are attempting to access must be addressed using the specified endpoint.` 같은 에러 메시지는 AWS의 정확한 문구와 일치해야 한다. 우리 메시지는 동일한 의미를 전달하지만 다른 표현을 사용한다.

이 실패들은 실제 애플리케이션 동작에 영향을 주지 않는다. 애플리케이션은 에러 메시지 텍스트가 아닌 에러 코드(예: `NoSuchBucket`)를 확인하며, 우리 에러 코드는 정확히 일치한다.

## 서비스 플러그인 아키텍처

모든 서비스는 `ServicePlugin` 인터페이스를 구현한다:

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

### 플러그인 레지스트리

서비스는 중앙 레지스트리를 통해 등록된다:

```go
type Registry struct {
    mu        sync.RWMutex
    factories map[string]PluginFactory
    active    map[string]ServicePlugin
}

func (r *Registry) Register(serviceID string, factory PluginFactory) {
    r.mu.Lock()
    defer r.mu.Unlock()
    r.factories[serviceID] = factory
}

func (r *Registry) Init(serviceID string, cfg PluginConfig) (ServicePlugin, error) {
    factory, ok := r.factories[serviceID]
    if !ok {
        return nil, fmt.Errorf("unknown service: %s", serviceID)
    }
    p := factory(cfg)
    if err := p.Init(cfg); err != nil {
        return nil, fmt.Errorf("init %s: %w", serviceID, err)
    }
    r.active[serviceID] = p
    return p, nil
}
```

이 분리 덕분에 새 서비스를 추가하려면:
1. 코드 생성기를 실행하여 타입과 스텁 생성
2. `ServicePlugin` 인터페이스 구현
3. 팩토리에 등록

프로토콜 처리, 직렬화, 라우팅은 자동 생성 코드가 전부 처리한다.

## 실제 사용 예시: 코드 변경 제로

DevCloud를 띄우면 기존 코드 변경 없이 엔드포인트만 바꾸면 된다:

### Python (boto3)

```python
import boto3

# 프로덕션
# s3 = boto3.client('s3', endpoint_url='https://s3.amazonaws.com')

# DevCloud 로컬
s3 = boto3.client('s3', endpoint_url='http://localhost:4747',
                  aws_access_key_id='test',
                  aws_secret_access_key='test')

s3.create_bucket(Bucket='my-bucket')
s3.put_object(Bucket='my-bucket', Key='hello.txt', Body=b'Hello, DevCloud!')
response = s3.get_object(Bucket='my-bucket', Key='hello.txt')
print(response['Body'].read())  # b'Hello, DevCloud!'
```

### Docker

```bash
docker run -p 4566:4566 skyoo2003/devcloud
```

### Terraform

```bash
export AWS_ENDPOINT_URL=http://localhost:4747
terraform apply
```

### AWS CLI

```bash
aws --endpoint-url http://localhost:4747 s3 ls
```

AWS SDK를 사용하는 모든 도구가 수정 없이 동작한다. DevCloud는 AWS와 동일한 와이어 프로토콜을 구현하므로, SDK 입장에서는 진짜 AWS인지 로컬 에뮬레이터인지 구별할 수 없다.

## 핵심 인사이트

### 1. 프로토콜이 복잡성의 핵심이다

비즈니스 로직보다 직렬화/역직렬화가 구현 난이도를 결정한다. 96개 서비스에 대해 5개 프로토콜 직렬화기를 수동으로 구현하는 것은 유지보수 악몽이다. 코드 생성으로 자동화하는 것이 올바른 접근이었다.

### 2. 호환성은 포맷 정밀도에서 갈린다

96%에서 99.9%로 가는 길은 기능 추가가 아니라 타임스탬프 포맷, 에러 메시지 문구, 페이지네이션 토큰 같은 디테일에 있다. 이 디테일은 지루하지만 필수적이다. 96%를 넘어선 각 퍼센트 포인트마다 점점 더 구체적인 포맷 매칭이 필요하다.

### 3. 플러그인 아키텍처로 관심사를 분리하라

프로토콜 처리와 서비스 로직을 분리하면 양쪽을 독립적으로 발전시킬 수 있다. 코드 생성 쪽에서 프로토콜 처리를 개선해도 서비스 구현에 영향이 없고, 서비스 개발자는 직렬화 세부사항을 몰라도 기능을 추가할 수 있다.

### 4. SDK 관점에서 테스트하라

호환 가능한 에뮬레이터를 구축하는 가장 빠른 방법은 서버 관점이 아니라 SDK 관점에서 테스트하는 것이다. 실제 SDK 요청을 녹화하고, 에뮬레이터에 재생한 뒤 응답을 비교한다. 서버 중심 테스트가 놓치는 포맷 이슈를 잡을 수 있다.

## 마치며

96% boto3 호환성은 로컬 개발 환경에서 AWS SDK를 그대로 사용할 수 있다는 것을 의미한다. CI/CD 파이프라인의 클라우드 비용을 없애고, 오프라인 개발(비행기, 제한된 네트워크 환경)을 가능하게 하며, 새 팀원의 온보딩을 `docker run` 하나로 줄일 수 있다.

남은 4%는 포맷 정밀도 문제다 — 페이지네이션 토큰, 타임스탬프 포맷, 에러 메시지 문구. 이것도 매주 Smithy 모델 동기와 함께 점진적으로 개선되고 있다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
