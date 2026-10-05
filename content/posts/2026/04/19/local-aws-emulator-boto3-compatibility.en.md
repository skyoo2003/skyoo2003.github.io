---
title: "Achieving boto3 Compatibility in a Local AWS Emulator"
description: "How the local AWS emulator DevCloud tells several AWS protocols apart behind one gateway, and what caused 28 of its 699 boto3 compatibility tests to fail."
date: 2026-04-19T00:00:00+09:00
tags: [aws, emulator, boto3, python, devcloud]
---

When you build applications on AWS, the test environment is often a pain. Calling real AWS from CI costs money, development stalls without the office network or a VPN, and anyone joining has to get credentials first. To reduce that friction I've been building [DevCloud](https://github.com/skyoo2003/devcloud), an AWS emulator you can run locally.

DevCloud's goal is to be "indistinguishable from real AWS from the SDK's point of view." So I wrote compatibility tests that actually call each service's operations through boto3, and the first full run came out at **671 of 699 passing (96%)**. In this post I'll go over how DevCloud tells several AWS protocols apart on a single port, and what the 28 failures turned out to be.

## Why AWS Emulation Is Tricky

Most APIs have a single protocol. AWS uses a different protocol per service. Roughly:

| Protocol | Example services | Characteristics |
|---|---|---|
| REST-XML | S3, Route 53 | Operation chosen by HTTP method and path, XML responses |
| REST-JSON | Lambda, SESv2 | Operation chosen by HTTP method and path, JSON responses |
| JSON 1.0 / 1.1 | DynamoDB, SQS (JSON) | Operation chosen by the `X-Amz-Target` header |
| Query | IAM, STS, SQS (Query) | Operation chosen by `Action=` in a form-urlencoded body |

Each protocol reads requests, builds responses, and expresses errors differently. In other words, you're not building one "AWS API" but several protocol implementations sharing the same service models.

And getting the response structure right isn't the end of it. If a single detail differs, such as an error code string, a timestamp format, a pagination token, or an XML element name, the SDK fails to parse or produces the wrong value.

## Telling Protocols Apart in One Gateway

DevCloud serves every service on a single port, 4747. An incoming request goes through common middleware (panic recovery, request size limit, CORS, `X-Amz-Request-Id` generation, request logging), and then the protocol and service are determined from the request headers and body.

```go
// internal/gateway/protocol.go
func DetectProtocol(r *http.Request) (protocol string, serviceID string) {
	// 1. JSON protocol: the X-Amz-Target header is present.
	if target := r.Header.Get("X-Amz-Target"); target != "" {
		contentType := r.Header.Get("Content-Type")
		proto := jsonProtocolFromContentType(contentType)
		service := serviceFromTarget(target)
		return proto, service
	}

	// 2. Query protocol: the form-urlencoded body contains Action=.
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

	// 3. Find REST-JSON services by the service name in the SigV4 signature.
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

	// 4. Everything else is treated as REST-XML (S3).
	return "rest-xml", "s3"
}
```

The order of the checks matters here. SQS supports both the JSON and Query protocols, so it has to be handled as JSON when `X-Amz-Target` is present, and as Query when it isn't and the body contains `Action=`. Also, if you read the body once to detect Query, you have to put `r.Body` back so it can be read again later. (Forget that and the service handler gets an empty body.)

The special cases in step 3 were also added after running into them. SES and SESv2 both use the SigV4 signing name `ses`, and Elasticsearch and OpenSearch both use `es`. So the signing name alone isn't enough; it routes to SESv2, the REST-JSON one, and separates the legacy Elasticsearch API by checking for `/2015-01-01/` in the path. On top of that, `normalizeServiceID`, which maps the service names SDKs send to internal IDs, is a fairly long switch statement.

## Serialization Differs per Protocol

### REST-XML (S3)

In S3 the operation is determined by the combination of HTTP method, path, and query string.

```
PUT    /my-bucket/my-key        → PutObject
GET    /my-bucket?list-type=2   → ListObjectsV2
DELETE /my-bucket/my-key        → DeleteObject
HEAD   /my-bucket/my-key        → HeadObject
POST   /my-bucket?delete        → DeleteObjects
```

Responses are XML, and boto3 pulls values out based on the element names defined in the service model. If an element name is off, you don't get an error; the response is built with that field silently missing, which actually makes the problem harder to find.

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

### JSON 1.0 / 1.1 (DynamoDB, etc.)

Routing for the JSON protocol is simple. `X-Amz-Target` has the form `ServiceName_APIVersion.Operation`, so you just split it.

```
X-Amz-Target: DynamoDB_20120810.CreateTable
Content-Type: application/x-amz-json-1.0

{"TableName": "users", "KeySchema": [...], "AttributeDefinitions": [...]}
```

Errors are returned with the error code in the `__type` field.

```json
{"__type": "ResourceNotFoundException", "message": "Requested resource not found"}
```

### Query (IAM, STS, etc.)

The Query protocol sends every parameter as form-urlencoded.

```
Action=GetUser&Version=2010-05-08&UserName=alice
```

Lists and maps are also expressed as flat indexed keys like `member.1=Value1&member.2=Value2`, so reassembling nested structures was trickier than I expected. Responses are XML like REST-XML, but wrapped once more by operation name, as in `<GetUserResponse><GetUserResult>...</GetUserResult></GetUserResponse>`.

## What Were the 28 Failures?

The compatibility tests live under `tests/compatibility/` as one pytest file per service. Each test starts a DevCloud server, calls operations with a boto3 client, and checks the returned values. Unlike unit tests, they go through the real SDK's serialization and deserialization, so they catch format issues that are hard to spot just by reading server code.

Grouped by cause, the 28 failures from the first run looked like this.

| Cause | Services |
|---|---|
| Tags must be returned as a `[{key, value}]` list, not a map | Bedrock, Textract |
| The `/v1` path prefix boto3 adds wasn't handled | S3 Tables |
| Couldn't tell whether the same POST was a create or an update; `GroupName` in the body wasn't read | EventBridge Scheduler |
| Mixed camelCase/PascalCase parameter names, response key casing | Serverless Application Repository |
| Test-side issues such as parameters that vary by botocore version or missing required parameters | Route 53, Support, Textract |

Most of them weren't missing features but **response formats that differed slightly from what the SDK expects**. For example, Bedrock was returning tags as a map like `{"env": "dev"}`, while the service model expects a list like `[{"key": "env", "value": "dev"}]`. It's a valid response on the server side, but boto3 parses it into something other than expected. All 28 were fixed the same day in [#4](https://github.com/skyoo2003/devcloud/pull/4).

There was also a case where tests failed because of the test environment, not the server. When starting the test server, it passed a `devcloud.yaml` that doesn't exist in the repository via `-config`, and the server exited immediately because it couldn't find the config file. Since the server's stderr was being discarded, all the tests showed was a 30-second wait for the server followed by a timeout. Now the config file is only passed when it exists, and if the server doesn't come up, its stderr is included in the error message.

## Service Plugin Structure

Each service implements the `ServicePlugin` interface and plugs in by registering a factory with a central registry.

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

The gateway only decides the protocol, the service, and the operation name; interpreting the request and building the response is up to each service's `HandleRequest`. Service skeletons are generated from AWS's Smithy models with a code generator, which I wrote up separately in the [Smithy code generation post](/en/posts/2026/04/19/smithy-codegen-aws-services/). That said, frequently used services like S3, DynamoDB, and SQS are mostly hand-written down to serialization, and only some services use the generated serialization code as is.

## Usage

Leave your existing code alone and just point the endpoint at DevCloud.

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

The AWS CLI and Terraform work the same way; just set the endpoint.

```bash
$ aws --endpoint-url http://localhost:4747 s3 ls

$ export AWS_ENDPOINT_URL=http://localhost:4747
$ terraform apply
```

## Wrapping Up

What I've learned building an emulator is that the difficulty is concentrated less in business logic and more in **matching the serialization formats exactly**. The 28 failures this time were mostly small differences like tag formats, path prefixes, and parameter name casing. Those differences are hard to see from server code alone, so having tests that call through the real SDK in place first helped the most.

The full source code is at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
