---
title: "Auto-Generating AWS Services from Smithy Models"
description: "How DevCloud parses AWS Smithy model JSON and renders Go templates to generate per-service types, routers, and serialization code for a local AWS emulator."
date: 2026-04-19T00:00:00+09:00
tags: [aws, smithy, codegen, go, devcloud]
---

## Introduction

AWS provides over 200 services, each with its own API protocol and request/response structure. Manually implementing them one by one is practically impossible. At [DevCloud](https://github.com/skyoo2003/devcloud), we built a codegen pipeline that reverse-engineers AWS's internal modeling language, **Smithy**, to auto-generate Go code for nearly all AWS services.

This post covers the full flow from parsing Smithy models to generating Go code, and how the auto-generated code powers a local AWS emulator. But the more fundamental question is: **why generate code from an IDL at all?** To understand the value beyond simple "productivity automation," we need to first understand the problem this approach solves.

## The Fundamental Problem: Limits of Manual API Implementation

Building a cloud emulator is fundamentally a **protocol translation problem**. When an AWS SDK sends a JSON body, the emulator must convert it to a Go struct; when it returns an XML response, the error codes must match what the SDK expects.

There are three fundamental limits to doing this manually.

First, **divergence between specification and implementation**. When AWS adds a new operation to S3, you must read the documentation, add Go structs, and update serialization code. At every step, something can be missed. Second, **memorizing the serialization rules of 5 different protocols exceeds human cognitive capacity**. XML namespaces in REST-XML, ECMAScript date format in Query protocol, `X-Amz-Target` header format in JSON protocol — implementing all of these simultaneously accurately is something only those who have actually tried it can appreciate. Third, **scalability**. Implementing 6 core services is realistic, but scaling that to 90+ services is an entirely different problem.

The key to solving this is simple: **AWS has already defined everything as models, so parse the models and generate code.** Bridging the gap between specification and implementation through models as an intermediate representation. This is the essence of model-based code generation.

## What is Smithy?

Smithy is AWS's internal **Interface Definition Language (IDL)**. It serves the same role as Protocol Buffers or OpenAPI, but with a few decisive differences.

| Feature | OpenAPI | Protocol Buffers | Smithy |
|---------|---------|-----------------|--------|
| Scope | REST APIs | Message format | API + Protocol + Errors |
| Protocol | Built into REST | Separate definition needed | Explicit in model |
| Server codegen | No official support | protoc (Go) | No official support (custom impl) |
| SDK generation | Official support | protoc (multi-language) | Official support (multi-language) |
| Error modeling | RFC 7807 | Separate definition | Built-in (httpBinding, retryConfig) |

Smithy's core difference is that **protocols are explicit in the model**. OpenAPI is limited to REST, Protocol Buffers only define serialization. Smithy, on the other hand, defines every aspect of an API in a single model: services, operations, structures, errors, protocol bindings, HTTP endpoints, retry policies, pagination, and more.

Smithy models are distributed in JSON format and can be found in the AWS SDK Go V2 repository:

```json
{
  "smithy": "2.0",
  "shapes": {
    "com.amazonaws.s3#PutObjectRequest": {
      "type": "structure",
      "members": {
        "Bucket": { "target": "com.amazonaws.s3#BucketName" },
        "Key": { "target": "com.amazonaws.s3#ObjectKey" }
      },
      "traits": {
        "aws.api#http": { "method": "PUT", "uri": "/{Bucket}/{Key+}" },
        "aws.protocols#restXml": {}
      }
    }
  }
}
```

From this single Shape definition, we can extract everything we need: struct fields (`Bucket`, `Key`), HTTP binding (`PUT /{Bucket}/{Key+}`), and protocol (`rest-xml`).

## Code Generation Pipeline Structure

DevCloud's codegen pipeline consists of four stages:

```
smithy-models/*.json  (AWS Smithy model files)
       │
       ▼
  ┌─────────────────────────────────────────┐
  │  1. Smithy JSON → Intermediate Rep      │
  │     (ServiceDef, OperationDef, ShapeDef)  │
  └───────────────┬─────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────────┐
  │  2. Intermediate Rep → 7 Go Templates    │
  │                                          │
  │  types.go          Structs (req/res)     │
  │  interface.go      Service interface      │
  │  serializer.go     Request deserialization│
  │  │              ├─ JSON body parsing      │
  │  │              ├─ XML body parsing       │
  │  │              ├─ Query params parsing   │
  │  │              └─ URI path parsing      │
  │  deserializer.go Response serialization  │
  │  router.go         Operation routing table│
  │  errors.go         Error type definitions │
  │  base_provider.go  Stub (NotImplemented) │
  └───────────────┬─────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────────┐
  │  3. Developer embeds stub and implements │
  │     Override only needed operations      │
  │     → No auth code, focus on logic       │
  └─────────────────────────────────────────┘
                  │
                  ▼
  ┌─────────────────────────────────────────┐
  │  4. GitHub Actions weekly model sync     │
  │     → Auto-create PR on changes          │
  └─────────────────────────────────────────┘
```

The core idea behind this structure is **separation of concerns**. Model parsing (stage 1) requires AWS domain knowledge, and template rendering (stage 2) requires understanding of Go templates and serialization libraries. But **service implementation (stage 3) requires zero knowledge of protocol details**. Since serialization/deserialization is handled by the codegen, developers only need to implement business logic like "PutObject stores to a file."

## Stage 1: Core of Smithy JSON Parsing

The parser's job is to convert AWS-encoded JSON into program-accessible structs. Three key decisions were made in this process.

### Raw JSON to Intermediate Representation

All values in Smithy JSON are `json.RawMessage`. This is because each Shape type (`service`, `operation`, `structure`, etc.) requires different parsing logic:

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

The `Traits` map is the core. Protocol information (`aws.protocols#restXml`), HTTP bindings (`aws.api#http`), documentation (`smithy.api#documentation`) — everything is expressed as a Trait. The parser detects the protocol by checking Trait key prefixes:

```go
func detectProtocol(s *rawShape) string {
    traits := s.Traits
    if traits["aws.protocols#restXml"] != nil { return "rest-xml" }
    if traits["aws.protocols#awsJson1_0"] != nil { return "json-1.0" }
    if traits["aws.protocols#awsJson1_1"] != nil { return "json-1.1" }
    if traits["aws.protocols#awsQuery"] != nil { return "query" }
    if traits["aws.protocols#restJson1"] != nil { return "rest-json" }
    return ""
}
```

### Resolving Operation References

When Smithy operations reference other operations or structures, they use `#`-separated identifiers: `com.amazonaws.s3#PutObjectInput`. The parser extracts only the short name (`PutObjectInput`) from these identifiers:

```go
func shortName(ref string) string {
    parts := strings.Split(ref, "#")
    return parts[len(parts)-1]
}
```

`smithy.api#Unit` is a Smithy built-in type representing operations with no input. Operations like DeleteBucket and ListBuckets use this type as their input.

### HTTP Binding Extraction

For REST protocol services (S3, Route53, etc.), the HTTP method and URI pattern are included in the `aws.api#http` Trait. This information is essential for router generation:

```json
"traits": {
    "aws.api#http": {
        "method": "PUT",
        "uri": "/{Bucket}/{Key+}"
    }
}
```

The `+` in `{Key+}` means "one or more path segments" in Smithy's URI template syntax. The router converts this pattern into a regular expression to match incoming HTTP requests.

## Stage 2: Go Template Rendering

The generator renders Go templates based on the parsed intermediate representation. Each service produces seven Go files, each solving a different problem.

### types.go — Multi-Protocol Structs

The most challenging template. A single struct must carry tags for both JSON and XML, so the template reads serialization directives from Smithy Traits for both protocols and generates tags:

```go
{{ range .Structures -}}
type {{ .Name }} struct {
{{ range .Members -}}
    {{ .Name }} {{ .GoType }} `json:"{{ .JSONTag }}" xml:"{{ .XMLTag }}"`
{{ end -}}
}
{{ end -}}
```

Note that field names can differ between protocols: `json:"bucketName"` vs `xml:"BucketName"`. The AWS SDK converts XML element names to camelCase, but some legacy services retain the original casing. This subtle difference is a common source of compatibility failures.

### interface.go — Operation Contract

Defines the full set of operations as an interface:

```go
{{ range .Operations }}
    {{ .Name }}(ctx context.Context, input *{{ .InputName }}) (*{{ .OutputName }}, error)
{{- end }}
}
```

This interface is the **contract between service implementations and the code generator**. Since the interface is defined, the compiler can verify at compile time that all operations have been implemented.

### router.go — HTTP-Based Routing

For REST protocol services, operations are determined by HTTP method and URI pattern:

```go
var OperationRoutes = []OperationRoute{
    {Method: "PUT", Pattern: "/{Bucket}/{Key+}", Operation: "PutObject"},
    {Method: "GET", Pattern: "/{Bucket}", Operation: "ListObjectsV2"},
    {Method: "DELETE", Pattern: "/{Bucket}/{Key+}", Operation: "DeleteObject"},
}
```

JSON protocol services (DynamoDB, Lambda) don't need a router — the `X-Amz-Target` header specifies the operation directly.

### base_provider.go — Implementation Enforcement Mechanism

Generates a stub that returns `NotImplementedError` for all operations. Combined with Go's **embedding**, this creates a powerful implementation enforcement mechanism:

```go
func (p *S3BaseProvider) PutObject(ctx context.Context, req *PutObjectInput) (*PutObjectOutput, error) {
    return nil, &NotImplementedError{
        Service: "Amazon S3",
        Operation: "PutObject",
    }
}
```

The advantage of this pattern: unimplemented operations become **runtime errors, not compile errors**. This makes it clear that it's not a bug, but rather unimplemented. Meanwhile, Go's compiler verifies that the implementation satisfies the interface, preventing accidental omissions.

## Stage 3: Implementing via Stub Embedding

Let's walk through how actual services are implemented using auto-generated code, with S3 as an example.

### Blocking All Operations with Embedding

```go
type S3Provider struct {
    *generated.S3BaseProvider  // Auto-generated stub — unimplemented ops auto-blocked
    fileStore  *FileStore
    metaStore  *MetadataStore
    serverPort int
}

func (p *S3Provider) ServiceID() string     { return "s3" }
func (p *S3Provider) ServiceName() string   { return "Amazon S3" }
func (p *S3Provider) Protocol() plugin.ProtocolType {
    return plugin.ProtocolRESTXML
}
```

By embedding `*generated.S3BaseProvider`, all non-overridden methods automatically return `NotImplementedError`. Go's embedding makes this pattern possible — the key is Go's method resolution rule that **explicit overrides take precedence over implicit ones**.

### Path Traversal Protection

Since we're using the local filesystem, security matters. `FileStore` performs traversal checks on all paths:

```go
func (fs *FileStore) safePath(parts ...string) (string, error) {
    joined := filepath.Join(append([]string{fs.baseDir}, parts...)...)
    cleaned := filepath.Clean(joined)
    if !strings.HasPrefix(cleaned, fs.baseDir+string(filepath.Separator)) &&
       cleaned != fs.baseDir {
        return "", fmt.Errorf("path traversal detected: %s", cleaned)
    }
    return cleaned, nil
}
```

`filepath.Clean` normalizes malicious paths like `../../etc/passwd`, and `strings.HasPrefix` verifies that the normalized path is still under baseDir. Without this two-step check, the implementation isn't safe.

## Stage 4: Weekly Auto-Sync and Automation Flywheel

AWS constantly launches new services and adds operations to existing ones. Tracking these changes is the final stage of the codegen pipeline.

```yaml
# .github/workflows/smithy-sync.yml
on:
  schedule:
    - cron: "0 0 * * 1"  # Every Monday midnight UTC
  workflow_dispatch:       # Manual trigger also available
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Download latest Smithy models
        run: bash scripts/download-smithy-models.sh
      - name: Run code generation
        run: |
          CGO_ENABLED=1 go run ./cmd/codegen \
            -models ./smithy-models \
            -output ./internal/generated \
            -templates ./internal/codegen/templates
      - name: Check for changes
        id: changes
        run: |
          if git diff --quiet internal/generated/; then
            echo "changed=false" >> $GITHUB_OUTPUT
          else
            echo "changed=true" >> $GITHUB_OUTPUT
          fi
      - name: Create Pull Request
        if: steps.changes.outputs.changed == 'true'
        uses: peter-evans/create-pull-request@v8
        with:
          commit-message: "chore: sync Smithy models and regenerate code"
          title: "chore: weekly Smithy model sync"
          body: |
            Automated weekly sync of AWS Smithy models.
            Changes detected in generated code.
          branch: smithy-sync/weekly
          delete-branch: true
```

The core of this workflow is that it **only creates a PR when changes are detected**. If AWS hasn't changed any models in a given week, nothing happens. When changes are detected, a PR is automatically created for review and merging.

This is the true value of code generation: **an automation flywheel**. AWS changes models → code auto-regenerates → compatibility tests auto-run → merge if no issues. Human developers focus only on business logic.

## Automatic Detection of 5 Protocols

At runtime, the protocol is determined solely from incoming request headers. This detection logic is one of the most critical pieces of code in the emulator's entry point.

```go
func DetectProtocol(r *http.Request) (protocol string, serviceID string) {
    // 1. JSON protocol: X-Amz-Target header
    if target := r.Header.Get("X-Amz-Target"); target != "" {
        contentType := r.Header.Get("Content-Type")
        proto := jsonProtocolFromContentType(contentType)
        service := serviceFromTarget(target)
        return proto, service
    }

    // 2. Query protocol: form-encoded body with Action= parameter
    if strings.Contains(r.Header.Get("Content-Type"),
        "application/x-www-form-urlencoded") {
        bodyBytes, _ := io.ReadAll(r.Body)
        r.Body = io.NopCloser(bytes.NewReader(bodyBytes))
        if strings.Contains(string(bodyBytes), "Action=") {
            return "query", serviceFromQueryRequest(r, string(bodyBytes))
        }
    }

    // 3. REST-style service extraction from SigV4 signature
    if svc := serviceFromSigV4(r); svc != "" && svc != "s3" {
        return "rest-json", normalizeServiceID(svc)
    }

    // 4. Default: REST-XML (S3)
    return "rest-xml", "s3"
}
```

The detection order matters. Checking `X-Amz-Target` first prevents JSON protocol services (DynamoDB, Lambda) from being misidentified as Query protocol. SQS is an unusual service that supports both JSON and Query protocols, distinguished by the presence of the `X-Amz-Target` header.

| Protocol | Content-Type | Operation Spec Method | Representative Services | Complexity |
|----------|-------------|----------------------|------------------------|------------|
| REST-XML | `application/xml` | HTTP method + URI | S3, Route53, CloudFront | Very High |
| JSON 1.0 | `application/x-amz-json-1.0` | `X-Amz-Target` header | DynamoDB, SQS | Medium |
| JSON 1.1 | `application/x-amz-json-1.1` | `X-Amz-Target` header | ECS, Lambda, CloudWatch | Medium |
| Query | `application/x-www-form-urlencoded` | `Action=` parameter | IAM, STS, SNS, RDS | High |
| REST-JSON | `application/json` | HTTP method + URI | ACM, API Gateway | Medium |

REST-XML is the most complex because S3-specific features like HTTP path-based routing, XML serialization, multipart upload, and presigned URLs add significant complexity. JSON protocol services, on the other hand, have simpler routing since the operation is specified in the header.

## Service Implementation Status and Prioritization

All services are categorized into three tiers, each with different goals:

- **Tier 1 (Core 6)**: S3, SQS, DynamoDB, Lambda, IAM, STS — 124+ operations, fully implemented. Most cloud-native applications work with just these services.
- **Tier 2 (Integration 8)**: EventBridge, SNS, CloudWatch, KMS, Secrets Manager, SSM, ECR — 157+ operations. Essential services for microservice architectures.
- **Tier 3 (Extended 40+)**: EC2, EFS, EBS, Route53, ACM, ECS, EKS, etc. — Stubs generated, incremental implementation planned.

The prioritization criterion is **usage frequency × implementation difficulty**. S3, DynamoDB, and SQS are used by virtually all cloud applications, so they're fully implemented first. EC2 has high usage frequency but high implementation complexity, so it starts at the stub stage.

## Key Insights

The lessons from this pipeline go beyond the technical fact that "we auto-generated code." There are deeper insights to be drawn.

### 1. When Models Become the Source of Truth, Maintenance Disappears

Across 96 services × an average of ~10 operations each, that's roughly 960 operations. The number that AWS changes in any given week is tiny. The codegen pipeline automatically detects changes and creates PRs, so human developers never need to answer "what operations were added?" **When the model changes, the code follows** — this is the true value of model-based approaches.

### 2. Interfaces Become the Language Between Developers and Code Generators

The `ServicePlugin` interface serves two roles simultaneously. For developers, it provides a clear contract: "implement these methods." For the code generator, it declares: "I'll handle serialization for these methods." Even though both sides speak different languages, the interface becomes a common language that enables communication.

### 3. Stubs Are Starting Points, Not Endpoints

Auto-generating stubs for all operations creates what looks like "an empty project with nothing implemented." But this empty project **compiles, runs tests, and appears on dashboards**. This is the starting point. Implement incrementally based on actual usage frequency, and any missing implementations immediately surface as errors.

### 4. Embedding Wins Over Composition in Certain Cases

In Go, there are two ways to satisfy an interface — composition and embedding. Composition requires manually delegating every method, while embedding only calls the actual implementation for explicitly overridden methods, and the rest follow the embedded type's default behavior. When implementing only a handful out of hundreds of operations, embedding is far more practical.

## Conclusion: What This Approach Means

Auto-generating Go code from Smithy models is technically interesting, but the true value behind it lies in the **automation flywheel**. When AWS changes models, code auto-regenerates and compatibility tests auto-run. Human developers focus only on business logic.

This pattern isn't limited to AWS. Azure's REST APIs are defined with OpenAPI, and GCP's gRPC services are defined with Protocol Buffers. Building a pipeline that parses each platform's IDL and generates code is a general-purpose approach for constructing multi-cloud emulators.

Full source code available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
