---
title: "Auto-Generating AWS Services from Smithy Models"
description: "How DevCloud parses AWS Smithy model JSON and renders per-service Go types, routers, serialization code, and scaffolds with Go templates, and where that pipeline falls short."
date: 2026-04-19T00:00:00+09:00
tags: [aws, smithy, codegen, go, devcloud]
---

The first problem I ran into building [DevCloud](https://github.com/skyoo2003/devcloud) was simply that "AWS has too many services." Each service has dozens or hundreds of operations, and request/response shapes and protocols vary from one to the next. Copying structs out of the docs by hand, I'd struggle to finish even S3.

Fortunately, AWS defines and publishes the API of every service in an IDL called [Smithy](https://smithy.io/). The AWS SDKs themselves are generated from these models. So why not do what the SDKs do, and generate the server-side code for the emulator from the same models? In this post I'll go over DevCloud's Smithy code generation pipeline, and also talk about how far it actually helped and where it fell short.

## A Quick Look at Smithy Models

Smithy is an interface definition language (IDL) built by AWS. It plays a role similar to Protocol Buffers or OpenAPI, but besides struct definitions it also carries, as traits inside the model, things like **which protocol is used, what the HTTP method and path are, which errors are thrown, and how pagination works**.

Models are also published as JSON (AST), and DevCloud downloads the model files from the [aws-sdk-go-v2 repository](https://github.com/aws/aws-sdk-go-v2/tree/main/codegen/sdk-codegen/aws-models) as is. A trimmed-down view of S3's `PutObject` looks like this.

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

From the model alone you can tell the operation's input/output structs, the HTTP method and URI pattern, and whether each member comes from the path (`httpLabel`), a header, or the body. The protocol is attached to the service shape as a trait such as `aws.protocols#restXml`.

## Pipeline Structure

The overall flow looks like this.

```
smithy-models/*.json
       │
       ▼
  1. Parse: Smithy JSON → intermediate representation (services, operations, shapes)
       │
       ▼
  2. Render: generate per-service Go files with text/template
       │   internal/generated/<service>/
       │     types.go          Request/response structs
       │     interface.go      Operation interface
       │     base_provider.go  Stub where every operation returns ErrNotImplemented
       │     serializer.go     HTTP request → input struct
       │     deserializer.go   Output struct → HTTP response
       │     router.go         HTTP method/URI → operation name
       │     errors.go         Error types
       │
       │   internal/services/<service>/  (only created if missing)
       │     provider.go, register.go    Service plugin skeleton
       ▼
  3. Every week GitHub Actions re-downloads the models, regenerates, and opens a PR if anything changed
```

### Step 1: Parsing

The parser first takes the Smithy JSON as `json.RawMessage`, then pulls out only the fields it needs according to each shape's `type` and turns them into an intermediate representation.

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

The protocol is determined by the trait keys on the service shape.

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

Writing this up, I noticed something missing: `aws.protocols#ec2Query`, used by EC2, isn't handled here and ends up as an empty string. EC2 is still at the scaffold level so it hasn't been a problem yet, but it's something to fix later.

Shape names carry a namespace and `#`, as in `com.amazonaws.s3#PutObjectRequest`, so only the short name after `#` is used as the Go type name. Operations with no input reference Smithy's built-in type `smithy.api#Unit`.

### Step 2: Template rendering

The parsed result is rendered with the `text/template` files in `internal/codegen/templates/`. For example, `types.go.tmpl` gives each struct both JSON and XML tags, so one struct can be used by both JSON and XML protocols.

```go
{{ range .Structures -}}
type {{ .Name }} struct {
{{ range .Members -}}
	{{ .Name }} {{ .GoType }} `json:"{{ .JSONTag }}" xml:"{{ .XMLTag }}"`
{{ end -}}
}
{{ end -}}
```

For REST protocol services, `router.go` gets a table mapping HTTP methods and URI patterns to operation names. S3 has many operations on the same path that differ only by query string, so the query string is part of the pattern too.

```go
var OperationRoutes = []OperationRoute{
	{Method: "PUT", Pattern: "/{Bucket}/{Key+}?x-id=CopyObject", Operation: "CopyObject"},
	{Method: "PUT", Pattern: "/{Bucket}", Operation: "CreateBucket"},
	{Method: "DELETE", Pattern: "/{Bucket}?cors", Operation: "DeleteBucketCors"},
	{Method: "DELETE", Pattern: "/{Bucket}/{Key+}?x-id=DeleteObject", Operation: "DeleteObject"},
	// ...
}
```

The `+` in `{Key+}` means it takes several path segments, slashes included, at once. That's essential syntax for S3, where object keys contain `/`.

`serializer.go` gets functions that turn an HTTP request into the input struct. They read the model's `httpLabel`, `httpHeader`, and `httpQuery` traits and pull values out of the path, headers, and query string respectively.

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

`base_provider.go` is a stub where every operation returns an error wrapping `ErrNotImplemented`.

```go
var ErrNotImplemented = fmt.Errorf("operation not implemented")

type BaseProvider struct{}

func (b *BaseProvider) CreateBucket(ctx context.Context, input *CreateBucketRequest) (*CreateBucketOutput, error) {
	return nil, fmt.Errorf("CreateBucket: %w", ErrNotImplemented)
}
```

And if `internal/services/<service>/` doesn't exist yet, it generates a skeleton `Provider` that embeds this `BaseProvider`, plus the registry registration code. Existing files are never overwritten. When adding a new service, you start from this skeleton and fill in the operations you need first.

### Step 3: Weekly model sync

AWS adds operations and fields all the time. Following that by hand is hard, so every Monday GitHub Actions re-downloads the models, regenerates the code, and if anything changed, runs the tests and opens a PR.

```yaml
# .github/workflows/smithy-sync.yml (excerpt)
on:
  schedule:
    - cron: "0 0 * * 1"  # Every Monday 00:00 UTC
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

Nothing happens in weeks when the models don't change; a PR only shows up when they do. Reviewing the diff of the generated code also tells you what AWS changed that week, which turned out to be surprisingly useful.

## So How Much Did It Actually Help?

To be honest, it didn't turn out the way I first hoped, where you "just put business logic on top of the generated code and you're done."

DevCloud's plugin interface receives requests through a single `HandleRequest(ctx, op, req)`. The generated skeleton's `HandleRequest` just returns `ErrNotImplemented` by default, so in the end each service has to write its own code that branches on the operation name. On top of that, the core services implemented first, such as S3, SQS, DynamoDB, IAM, and Lambda, have hand-written request parsing and response serialization. Matching the subtle response formats AWS SDKs expect (XML element names, error codes, empty list handling, and so on) one by one, the serialization code generated from generic templates often wasn't enough. Right now, the services that actually import a generated package are roughly Bedrock, CloudFront, EFS, Route 53, and STS.

Even so, code generation was well worth it for these reasons.

- **The list and types of 96 services and about 4,400 operations always exist and stay current.** When implementing a new service, you can start from the generated `types.go` and `router.go` instead of the docs.
- **Operations that aren't implemented yet are clearly visible.** Even services at the scaffold stage get registered and respond, so the dashboard and compatibility tests show right away what's missing.
- **AWS API changes don't slip by.** The weekly PR works as a kind of change notification.

## Wrapping Up

Generating code from Smithy models was definitely effective for building a starting point in an AWS emulator with this many services. But the last step, actually matching SDK compatibility, still takes a lot of work per service. Going forward, the goal is to move patterns I've repeatedly hand-written in the core services back into the templates, and increase the number of services that can use the generated code as is.

The full source code is at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
