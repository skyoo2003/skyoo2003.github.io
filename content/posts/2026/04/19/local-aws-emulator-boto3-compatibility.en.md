---
title: "Achieving boto3 Compatibility in a Local AWS Emulator"
date: 2026-04-19T00:00:00+09:00
tags: [aws, emulator, boto3, python, devcloud]
---

## Introduction

Developing cloud-native applications comes with recurring pain points: AWS calls in CI pipelines incur costs, development stops without VPN, and onboarding requires credential setup. [DevCloud](https://github.com/skyoo2003/devcloud) is a local AWS emulator that solves these problems entirely offline.

It achieves **671/699 test cases passing (96%)** in boto3 compatibility tests. That number isn't just a test pass rate — it's a measure of how precisely the protocol layer replicates AWS behavior. This post explains how a single Go binary achieves this level of compatibility, covering protocol detection, serialization challenges, the plugin architecture, and the path from 96% to production-ready.

## The Problem: Why AWS Emulation Is Hard

Before diving into the solution, it's worth understanding why AWS emulation is fundamentally difficult.

Most APIs have one protocol. gRPC services use protobuf, REST APIs use JSON, GraphQL uses its query language. AWS uses **five different protocols** across its services, each with unique serialization rules, error formats, and authentication schemes. A single "AWS API" doesn't exist — you're really building five protocol implementations that happen to share a service model.

The second challenge is **behavioral fidelity**. It's not enough to return the right JSON structure. Timestamps must be in ISO 8601 with the right precision. Error codes must match AWS's specific strings. Pagination tokens must be parseable by the SDK. XML responses must have the exact namespace declarations boto3 expects. Each of these details is a potential compatibility failure.

## 5 Protocols, One Gateway

DevCloud handles all five AWS protocols through a single HTTP gateway:

```
Client (boto3 / AWS CLI / Terraform / CDK)
  │
  ▼
API Gateway (port 4747)
  │
  ├─ Middleware Chain
  │   ├─ ErrorRecovery (panic recovery)
  │   ├─ BodyLimit (request size limit)
  │   ├─ CORS (cross-origin handling)
  │   ├─ RequestID (X-Amz-Request-Id)
  │   ├─ RequestLogger (structured logging)
  │   └─ LogCollector (dashboard real-time logs)
  │
  ▼
Protocol Detector
  │
  ├─ X-Amz-Target header present    → JSON protocol (DynamoDB, SQS JSON)
  ├─ Content-Type: x-www-form-urlencoded + Action= → Query protocol (IAM, STS, SQS)
  ├─ SigV4 signature with Lambda path  → REST-JSON (Lambda)
  └─ Default                          → REST-XML (S3)
```

### Automatic Protocol Detection

Protocol is determined solely from incoming request headers:

```go
// internal/gateway/protocol.go
func DetectProtocol(r *http.Request) (protocol string, serviceID string) {
    // 1. JSON protocol: X-Amz-Target header present
    if target := r.Header.Get("X-Amz-Target"); target != "" {
        contentType := r.Header.Get("Content-Type")
        proto := jsonProtocolFromContentType(contentType)
        service := serviceFromTarget(target)
        return proto, service
    }

    // 2. Query protocol: Action= parameter in form-encoded body
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

    // 3. REST-style service extraction from SigV4 signature
    if svc := serviceFromSigV4(r); svc != "" && svc != "s3" {
        normalized := normalizeServiceID(svc)
        return "rest-json", normalized
    }

    // 4. Default: REST-XML (S3)
    return "rest-xml", "s3"
}
```

The detection order matters. `X-Amz-Target` must be checked first, otherwise JSON protocol services (DynamoDB, Lambda) would be misidentified as Query protocol. SQS is an unusual service that supports both JSON and Query protocols, distinguished by the presence of the `X-Amz-Target` header.

### Service Name Normalization

The gateway maintains an extensive table mapping 100+ AWS service names to internal IDs. There are many special cases:

- SES → `sesv2` (REST-JSON, not Query)
- `opensearch` vs `elasticsearchservice` (path-based differentiation)
- Service name normalization (whitespace removal, lowercase conversion)

This ensures that regardless of how the SDK references a service, it reaches the correct plugin.

## Protocol-Specific Serialization Details

Serialization differs completely across protocols. The serialization/deserialization layer is the most challenging part of building an emulator. Let's look at specific examples.

### REST-XML (S3)

S3 is the most complex protocol. Operations are determined by HTTP method and path, and responses must be valid XML with specific namespace declarations.

**Request routing:**
```
PUT    /my-bucket/my-key HTTP/1.1          → PutObject
GET    /my-bucket?list-type=2 HTTP/1.1     → ListObjectsV2
DELETE /my-bucket/my-key HTTP/1.1          → DeleteObject
HEAD   /my-bucket/my-key HTTP/1.1          → HeadObject
POST   /my-bucket?delete HTTP/1.1          → DeleteObjects (multi-object)
```

**Response XML structure:**
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

boto3 parses this XML using the `xmlNamespace` trait from the service model. If namespace declarations or element order are wrong, deserialization silently fails or produces incorrect values.

### JSON 1.0/1.1 (DynamoDB, Lambda)

JSON protocols have simpler routing but their own nuances:

```
X-Amz-Target: DynamoDB_20120810.CreateTable
Content-Type: application/x-amz-json-1.0

{"TableName": "users", "KeySchema": [...], "AttributeDefinitions": [...]}
```

JSON 1.0 uses `application/x-amz-json-1.0` and follows a specific `X-Amz-Target` format: `ServiceName_APIVersion.OperationName`. JSON 1.1 uses `application/x-amz-json-1.1` with a slightly different target format.

Error responses follow a specific structure:

```json
{"__type": "ResourceNotFoundException", "message": "Requested resource not found"}
```

### Query (IAM, STS)

The Query protocol encodes all parameters as form-urlencoded:

```
Action=GetUser&Version=2010-05-08&UserName=alice
```

This protocol has several unique serialization challenges:

- **ECMAScript date format**: Timestamps encoded as `20260419T120000Z` (no hyphens or colons) — not ISO 8601
- **Flattened lists**: `member.1=Value1&member.2=Value2` — index-based representation, not JSON arrays
- **Structured map keys**: `AttributeName.1.Name=id&AttributeName.1.Value=userId` — map keys also index-encoded
- **Boolean encoding**: `true` and `false` as lowercase strings

## What 96% Compatibility Means

The boto3 compatibility test replays actual AWS SDK requests against the emulator and verifies that responses match the structure the SDK expects. This isn't a unit test — it's a **wire-protocol level integration test**.

```
699 test cases executed
├─ 671 passed (96.0%)
├─ 28 failed
│  ├─ Pagination edge cases: 12
│  │   └─ NextToken format, exclusive StartKey handling
│  ├─ Timestamp format micro-differences: 8
│  │   └─ Millisecond precision, timezone handling
│  └─ Error message text differences: 8
│       └─ Exact wording mismatch with AWS
```

Most of the 28 failures aren't functional errors — they're **format micro-differences**.

1. **Pagination (12 failures)**: boto3 uses a response's `NextToken` as input for the next request. If the token format differs from AWS, pagination breaks. Our tokens are base64-encoded pointers, while AWS uses opaque encrypted tokens. The SDK can parse them, but round-trips fail in some edge cases.

2. **Timestamps (8 failures)**: AWS returns variable-precision timestamps — some with milliseconds (`2026-04-19T12:00:00.123Z`) and some without (`2026-04-19T12:00:00Z`). The SDK expects specific formats per field. Our timestamps always have millisecond precision, but some fields expect no decimal point.

3. **Error messages (8 failures)**: Error messages like `The bucket you are attempting to access must be addressed using the specified endpoint.` must match AWS's exact wording. Our messages convey the same meaning but use different phrasing.

These failures don't affect actual application behavior. Applications check error codes (e.g., `NoSuchBucket`), not error message text — and our error codes match exactly.

## Service Plugin Architecture

Every service implements the `ServicePlugin` interface:

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

### Plugin Registry

Services are registered through a central registry:

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

This separation means adding a new service requires:
1. Run the code generator to produce types and stubs
2. Implement the `ServicePlugin` interface
3. Register with the factory

Protocol handling, serialization, and routing are all handled by auto-generated code.

## Usage Example: Zero Code Changes

With DevCloud running, just change the endpoint — no code modifications needed:

### Python (boto3)

```python
import boto3

# Production
# s3 = boto3.client('s3', endpoint_url='https://s3.amazonaws.com')

# DevCloud local
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

Any tool using the AWS SDK works without modification. DevCloud implements the same wire protocol as AWS, so from the SDK's perspective, there's no way to distinguish between real AWS and the local emulator.

## Key Insights

### 1. Protocols Are the Core Complexity

Serialization/deserialization determines implementation difficulty more than business logic. Manually implementing 5 protocol serializers for 96 services is a maintenance nightmare. Automating it with code generation is the right approach.

### 2. Compatibility Is Won in Format Precision

The path from 96% to 99.9% isn't about adding features — it's about timestamps, error messages, and pagination tokens. These details are tedious but essential. Each percentage point past 96% requires increasingly specific format matching.

### 3. Separate Concerns with Plugin Architecture

Decoupling protocol handling from service logic lets both evolve independently. Improving protocol handling on the codegen side doesn't affect service implementations, and service developers can add features without knowing serialization details.

### 4. Test from the SDK's Perspective

The fastest way to build a compatible emulator is to test from the SDK's perspective, not the server's. Record actual SDK requests, replay them against the emulator, and compare responses. This catches format issues that server-centric tests miss.

## Conclusion

96% boto3 compatibility means you can use the AWS SDK as-is in local development. Eliminate cloud costs from CI/CD pipelines, enable offline development (flights, restricted networks), and reduce new team member onboarding to a single `docker run`.

The remaining 4% is format precision — pagination tokens, timestamp formats, error message wording. These are being incrementally improved with weekly Smithy model syncs.

Full source code available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
