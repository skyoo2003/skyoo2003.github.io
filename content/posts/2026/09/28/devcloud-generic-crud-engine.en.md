---
title: "Answering Thousands of AWS Operations from Models Alone: DevCloud's Generic CRUD Engine"
description: "How DevCloud's generic CRUD engine answers thousands of AWS operations by classifying them at codegen time, and why it refuses rather than faking success."
date: 2026-09-28T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [aws, smithy, go, devcloud, emulator]
---

## Introduction

Updated on 2026-10-05. The implementation described here is main at [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c), after v1.2.0.

[DevCloud](https://github.com/skyoo2003/devcloud) is an AWS emulator that runs locally. In an [earlier post](/en/posts/2026/04/19/smithy-codegen-aws-services/) I covered the pipeline that generates each service's types, router, serialization code, and a stub that returns `NotImplemented`, all from Smithy models. That post ended with "a stub is a starting point, not an end point."

The hard part comes after the stub. Thousands of operations are left with a router but no implementation. Hand-implementing core services like S3, DynamoDB, and SQS will never keep up with that long tail. But answering any request with `200` is worse: the SDK takes it as success, and code that passed locally breaks against real AWS.

In v1.0.0, DevCloud added a **Generic CRUD engine** to fill that gap. It picks the operations in the Smithy models that look like create, read, list, delete, or update, and serves them from one generic store. It started with about 2,200 operations across 46 JSON-protocol services. v1.1.0 extended it to every protocol and brought the count to 4,858. At the commit above, after v1.2.0 expanded registration to 431 services, the engine answers **11,588** operations.

This post covers how the engine classifies operations, where it finds the operation name for each protocol, and above all, **how it declines requests it does not understand**.

## Scope of the Generic CRUD Engine

The engine's contract is in the first paragraph of its docs:

> Fidelity is deliberately "plausible, not faithful."

Engine responses are written to a store, echo the values from the request, and carry synthesized IDs and ARNs. From the SDK's point of view, a create → get → list → delete round trip works naturally. What it does **not** have: input validation, cross-resource integrity, correct pagination, or business logic. It is scaffolding for checking local wiring, not an implementation that promises behavioral compatibility.

The line was drawn up front for a simple reason. If what the engine does and what it does not do get mixed up, "it worked locally" stops meaning anything. Operations the engine answers are marked separately as `auto-crud` in the [fidelity manifest](/en/posts/2026/09/29/devcloud-fidelity-manifest-coverage/).

## Classifier, Engine, and Gateway

The engine has three pieces.

| Piece | Location | What it does |
|---|---|---|
| Classification | `internal/codegen/gen_crud_meta.go` | Generates CRUD metadata from operation names and output shapes |
| Engine | `internal/shared/crud/crud.go` | Resource store plus per-verb dispatch |
| Integration | `internal/gateway/router.go` | Passes only requests the provider did not handle to the engine |

### Classification Happens at Codegen Time

The classifier runs during `make codegen`, not at runtime. It picks the verb from the operation-name prefix and turns the rest into a singular resource name.

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

So `CreateDatabase` and `ListDatabases` share the same store bucket, `Database`. From the output shape, the classifier finds the member that holds a collection (list key) and the member that wraps a single resource (item key). The result is an `OpMeta`, registered from a single `init()` in `internal/generated/crudregistry/registry_gen.go`.

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

Verbs like `Start`, `Stop`, `Invoke`, and `Import` are not in the prefix list. Shapes the classifier is unsure about are deliberately left unclassified, and they go down the decline path described below.

### Hand-Written Code Always Wins

The engine does not replace providers. The gateway calls it only when a provider returns `plugin.ErrUnhandledOp` from its dispatch `default:` case.

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

If the provider has a hand-written `case`, the engine is never called, so it can never shadow a real implementation. Promoting an operation from `auto-crud` to `hand-verified` works the same way: add an explicit `case` to the provider.

## Each Protocol Puts the Operation Name Somewhere Else

Before the engine can classify a request, it has to know which operation the request is for. As covered in the [boto3 compatibility post](/en/posts/2026/04/19/local-aws-emulator-boto3-compatibility/), AWS uses different protocols per service, and each one carries the operation name in a different place.

| Protocol | Where the operation name comes from | Engine support |
|---|---|---|
| `json-1.0`, `json-1.1` | the `X-Amz-Target` header | yes |
| `rest-json` | method + path, matched against the model's URI templates | yes |
| `rest-xml` | same as above | yes |
| `query` | the `Action` field of the form body | yes |
| `ec2-query` | — | no |

In v1.0.0 the engine handled only the JSON protocols. The name sat right there in a header, so that was easy. The REST protocols do not write the name anywhere in the request. Instead, every REST operation in a Smithy model is bound to a method and URI template such as `GET /v1/graphs/{GraphName}`. In v1.1.0, `internal/shared/httproute` turns that pair back into an operation name, so the engine can take `rest-json` and `rest-xml` too.

`query` has no path information, but the name is in the `Action` field of the form body. `ec2-query` looks similar but is not interchangeable. EC2 uses a hand-written provider; operations it does not implement have no Generic CRUD fallback. At the reference commit, the manifest classifies 65 EC2 operations as `hand-verified` and 691 as `unimplemented`.

The start of `crud.Handle` shows this branching directly:

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

### Parameter Precedence

In the REST protocols, a value can come from three places. The engine applies them from least to most authoritative: `httpQuery` values, then the request body, then the path labels. The URI addresses the resource, so path labels win. Real SDKs never put one member in two places, so this order never matters for them. It exists so that a hand-crafted request cannot redirect a lookup through the body.

Some things are deliberately not read:

- **`rest-xml` request bodies.** S3 speaks `rest-xml`, and S3 bodies are multi-gigabyte uploads, so the gateway does not buffer them. `rest-xml` operations are served from the path and query alone. Every CRUD-shaped S3 Control operation addresses its resource through the path, so nothing is lost.
- **`Action` and `Version` in `query`.** These describe the request, not the resource. If they were stored, `<Action>CreateLoadBalancer</Action>` would come back inside the result.
- **`httpHeader` members, `httpPayload` blobs, streaming bodies.** An operation whose identifier arrives only in a header gets a generated ID instead of the caller's. That is within the "plausible" contract.

## Dispatch and the Store

Once classification is done, dispatch is a single `switch` over the verb:

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

The ID is looked up in the request parameters in the order `<Resource>Name`, `<Resource>Id`, `<Resource>Arn`, `Name`, `Id`. If none is present, one is generated with a `res-` prefix. The store is a document store keyed by `service|resource`. It lives in a SQLite table in the DevCloud data directory, so it survives restarts.

SQLite persistence was added in the [2026-09-30 change](https://github.com/skyoo2003/devcloud/commit/734b83995a3f750f0db827ec9299bc8ed81a530c). The Generic CRUD store in the v1.2.0 release was an in-memory map and lost its contents on restart.

The response format follows the protocol: a JSON body for the JSON protocols, XML for `query` and `rest-xml`. Even the two XML forms use different envelopes. botocore's query parser expects `<OperationResult>` inside `<OperationResponse>`, and if it does not find it, it returns **an empty result with no error**. The `rest-xml` parser maps the root element's children straight onto the output shape. Miss this difference and you get tests that pass while the values are empty.

## Declining: No Fabricated Successes

The most important code in the engine is not the part that builds responses. It is **the part that declines**. These requests are declined with `InvalidAction` without touching the store:

- The method and path match no entry in the service's route table.
- `Action` names an operation the service did not register.
- The operation was found, but the classifier could not assign a verb.

This rule matters most for `rest-xml`. The gateway's protocol detector sends anything it cannot classify to S3. When an S3-shaped path reaches the engine, it must come back as unclassified instead of being answered from the generic store.

The principle is not limited to the engine. Before v1.0.0, the CloudFront provider answered **122** unimplemented operations with an empty XML document and HTTP 200. boto3 parses that as a normal empty result. It now returns `NotImplemented` (HTTP 501), like the other 32 providers that decline from their own dispatch default. SDKs need to be able to tell "not emulated yet" apart from "invalid request."

## The Bug: A Broader Sibling Route Answered Instead

In v1.2.0, the 218 services that had generated routers but no provider were registered from the codegen scaffold. The scaffold implements nothing by hand and only returns `ErrUnhandledOp`. From the moment a service is generated, the engine serves its CRUD-shaped operations and declines the rest.

This work exposed an old fabricated success. Amazon Chime's `AssociatePhoneNumberWithUser` was returning `UpdateUser`'s 200. API Gateway's `ImportRestApi` was getting `CreateRestApi`'s response.

The cause was a gap in the route table. The engine's route table held only classified operations. `httproute.Match` picks the most specific route **it holds**. When a broader sibling pattern covered the path of an unclassified operation, the sibling answered. The specific route was not in the table, so the general one won.

The fix changed the table, not the classification rules. `classifyOps` now records **every** REST-bound operation and leaves `Verb` empty for the ones it cannot classify. The specific route now exists, so it outranks the broader one, and `crud.Handle` declines the request at the `Verb` check it already had:

```go
mu.RLock()
m, ok := registry[c.Service][op]
mu.RUnlock()
if !ok || m.Verb == "" {
	return nil, ErrUnclassified
}
```

An entry with an empty `Verb` is a route, not a capability. So the fidelity manifest skips it, and `RegisteredOps` filters it out.

The compatibility suite could not catch either case. It picks one operation per service, prefers `Describe`/`List`/`Get`, and excludes `Import` as mutating. Both cases are now pinned by Go tests. The tests also check the opposite direction, because declining everything must not become the cheap way to pass.

## Known Limits

The documented limits are:

- `List*` responses return the stored objects. When the real AWS output is a list of names rather than structures, the SDK may not populate it.
- Required parameters are not validated, so calls succeed with minimal input.
- Lists are wrapped in `<member>`, the AWS default. If a model flattens a list, the engine does not use that information.

These limits are not hidden. They are stated in the docs and in the manifest. The engine is a tool for checking that things connect locally, and it must not set expectations beyond that.

## Conclusion

For local SDK wiring, check whether the required operation is classified as `auto-crud`. If input validation or cross-resource behavior matters, also check the manual implementation and its tests. The [next post](/en/posts/2026/09/29/devcloud-fidelity-manifest-coverage/) explains the tiers and coverage counts.

The full source code is available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
