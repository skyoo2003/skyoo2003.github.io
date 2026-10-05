---
title: "Before You Say 431 Services: DevCloud's Fidelity Manifest and Coverage Figures"
description: "Instead of headline service counts, DevCloud grades each operation in three tiers in a generated manifest and has CI check the coverage numbers in its docs."
date: 2026-09-29T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [aws, devcloud, testing, documentation]
---

Updated on 2026-10-05. The implementation described here is main at [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c), after v1.2.0.

The first number you notice in an emulator's README is the count of supported services. [DevCloud](https://github.com/skyoo2003/devcloud) was no different at first. But while preparing v1.1.0, I noticed the same number had different values across the docs. The README said 104, the FAQ said 101, and the number of services actually registered was 148.

There was a bigger problem than the numbers disagreeing: nobody had defined what the number meant. "Supporting" a service could mean requests are routed to DevCloud, or that at least one operation answers, or that it is implemented by hand and passes the boto3 tests. A single number cannot tell these apart.

This post covers how DevCloud dealt with that: the **fidelity manifest**, which gives every operation a trust tier; how the target service count was set by a demand study; and the checks that fail CI when a number in the docs drifts from the binary.

## Three Tiers per Operation

Trust cannot be expressed per service, so the unit moved down to the operation. Every operation belongs to one of three tiers.

| Tier | Meaning | Trust it for |
|---|---|---|
| `hand-verified` | The service's provider implements the operation explicitly | Indicates a manual implementation. Behavioral guarantees cover only properties asserted by its tests |
| `auto-crud` | Answered by the [Generic CRUD engine](/en/posts/2026/09/28/devcloud-generic-crud-engine/): store-backed, plausible responses | Wiring up the SDK and round-tripping create → get → list → delete. Nothing more |
| `unimplemented` | Not served. It fails instead of fabricating a success | Learning early that DevCloud will not serve this call |

`unimplemented` does not map to a single error. Depending on how the provider declines, you get `InvalidAction` (400), `NotImplemented` (501), or a service-specific `UnsupportedOperation` or `MethodNotAllowed`. The compatibility policy promises only **that it fails**. The specific code may change within 1.x.

The manifest can be read at runtime through the admin API. The admin API is off by default, so set `admin.enabled: true` first.

```bash
curl -s 'localhost:4747/devcloud/api/fidelity?service=s3'
```

The S3 response at the reference commit is shown below. `counts` covers all operations; `operations` is excerpted to two entries.

```json
{
  "s3": {
    "modelBacked": true,
    "counts": {"hand-verified": 37, "auto-crud": 65, "unimplemented": 5},
    "operations": {"PutObject": "hand-verified", "SelectObjectContent": "unimplemented"}
  }
}
```

In Go, it is a lookup in a generated package:

```go
tier, ok := fidelity.Lookup("s3", "PutObject") // TierHandVerified, true
```

`ok` being false is not the same as `unimplemented`. An unknown service is never routed at all, while an `unimplemented` operation reaches its provider and is refused there.

## The Manifest Is Never Written by Hand

A manifest maintained by people goes stale quickly, so `make codegen` generates it from three inputs.

| Input | Source | Contributes |
|---|---|---|
| Operation universe | `api/smithy/*.json` (including resource-attached operations) | Every known operation |
| `auto-crud` | The generated CRUD registry | Operations the engine can serve |
| `hand-verified` | The `case` literals in each provider's `HandleRequest` dispatch | Implemented operations |

Being generated did not make it correct from the start. It was badly wrong three times.

**First, it hid operations that were actually served.** The early manifest computed the intersection of a provider's dispatch with the Smithy model. But providers sometimes serve operations their model does not declare. `dynamodbstreams` serves 22 operations on top of a model that has only 4, and `bedrock` serves `InvokeModel`, which AWS models under bedrock-runtime. Dropping the intersection and reading the dispatch directly surfaced **226** hidden operations. In the other direction, 5 fake operations invented by a scanner that read the whole package disappeared: strings like `"DisplayName"`, which `identitystore` uses for an attribute patch, and `"POST"`, which `pipes` uses to resolve a path. The scan is now limited to `HandleRequest` and the functions it delegates to.

**Second, it marked unreachable operations as `auto-crud`.** Being in the CRUD registry only means the engine can classify the operation. If the provider does not hand its unimplemented operations to the engine, the call is refused anyway. Now an operation gets `auto-crud` only when its provider actually delegates to the engine.

**Third, it dropped short names.** The `hand-verified` scanner only considered strings of four characters or more as operation candidates. So `resourcegroups.Tag` showed up as `unimplemented`, right next to the code that implemented it. Short literals are now collected separately and promoted to operations only when the service's own model declares them.

Several tests now check the generated result. `TestFidelityManifestCoverage` fails on an unknown tier, or when the CRUD registry contains operations a service can handle but its manifest shows no served operations. Served operations include both `hand-verified` and `auto-crud`. A service with no CRUD registrations may have zero served operations without failing this condition.

`TestFidelityManifestCoversRegisteredServices` checks registered services for missing manifests. `TestFidelityManifestCoversCRUDRegistry` checks CRUD operations for missing entries and incorrect tiers. `TestAutoCRUDIsServedOverJSON` checks actual JSON responses.

## Choosing Target Services from Demand

With tiers in place, the next question was: how many services should the target be?

The original target was every service AWS publishes. That target rested on an untested assumption: that someone wants the services DevCloud did not register. Before building 283 unregistered services, I decided to test it.

DevCloud has no usage telemetry. Instead, I used three projects that each add a service only when users ask for it, as proxies.

| Source | Population | Services |
|---|---|---|
| moto | Python developers testing with boto3 | 163 |
| LocalStack | Users of a local AWS emulator | 119 |
| terraform-provider-aws | IaC users | 273 |

The important part is that **the decision rule was written down before looking at the numbers**. If at least 60% of the unregistered services were supported by two or more sources, keep the "every service" target. If at least 100 were, narrow the target to the demand set. If neither, drop the "every service" claim and adopt the demand set as the target. There was even a predefined conclusion for the case where the method itself failed. The point was to make it impossible to pick a convenient reading after seeing the result.

| Reading | Value |
|---|---|
| Unregistered services | 283 |
| Supported by all three | 8 |
| Supported by two or more | **57 (20.1%)** |
| Supported by exactly one | 111 |
| Supported by none | 115 |
| Service requests DevCloud ever received | **0** |

57 cleared neither bar. So, as decided in advance, the "full depth" target was dropped, and the depth target became **205**: the 148 services registered at the time plus the 57. Of the 283 services unregistered at the time, about 80% (226) were built by fewer than two of three projects that have far more history and staffing than DevCloud. Of those, 115 were built by none of the three and 111 by exactly one. That is what a long tail looks like.

## Why There Are Two Denominators

In v1.2.0, the remaining 226 services were registered too. This did not overturn the demand study. What the study rejected was the **cost of hand-building** 283 services on the assumption that someone wanted them. The codegen scaffold removed that cost. Registering the 226 took one flag on `make codegen`, and those services answer only at CRUD-engine level.

It is worth being precise about what registration changes. Registration does not stop calls to AWS. Where an SDK call goes is decided by the SDK's endpoint configuration (such as `endpoint_url`). A client whose endpoint points at real AWS goes to AWS no matter how many services DevCloud registers. Conversely, a request that reaches DevCloud is never forwarded anywhere, registered or not. An unregistered service simply gets `UnknownService` (400) from the gateway.

What registration actually does is make the service known locally. A registered service answers per operation or declines with an AWS-shaped error, and it appears in the fidelity manifest. That is why the routing target is set at "every published model." Depth, on the other hand, is a promise that costs something, so it follows demand. That is why DevCloud publishes two targets.

| Axis | Services | Governed by |
|---|---|---|
| Routing target | 431 / 431 | Every published model is registered |
| Depth target | 205 | The 2026-09-05 demand study |
| Registered, no depth promise | 226 | CRUD-engine level |

The tier shares have to name their denominator too.

| Tier | Depth target (205) | All registered (431) |
|---|---|---|
| `hand-verified` | 4,497 | 4,528 |
| `auto-crud` | 5,910 | 11,588 |
| `unimplemented` | 2,000 | 3,085 |
| **hand-verified share** | **36.2%** | **23.6%** |

The 23.6% in the right column must not be read as a quality regression. Registering 226 services did not make any operation less faithful. It only made the denominator bigger. Both columns are always published together to prevent that misreading.

## CI Checks the Numbers in the Docs

Rules alone do not fix numbers that differ between docs. If people write a number by hand in five places, sooner or later the places disagree. DevCloud handles this in two ways.

First, the numbers live in one place only: `docs/coverage.md`. Other docs link to that page.

Second, `go test ./cmd/devcloud/` compares the numbers on that page with the registry in the binary. The test reads the doc's tables with regular expressions:

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

If the test does not find exactly one matching row, it fails. That prevents the test from passing by reading the wrong cell after the page is restructured. The check runs in both directions: it fails when the code changes and the doc does not, and it fails when only the doc changes. Nine tests guard this page, covering the service counts, the per-tier operation counts, the shares, the arithmetic of the target table, and agreement with the README.

The weekly Smithy sync workflow changed to fit this. A one-time measurement on 2026-09-06 found that refreshing 194 models changed 93 of them, and 32 of those added or removed an operation. Not one was a documentation-only change. When operations move, the docs check fails on purpose. Now the sync workflow recomputes the numbers, commits them into its own PR, and states in the PR body which numbers moved. Reviewers no longer do the arithmetic. They only make the judgment: should those operations have moved?

## Collecting Real Demand

The three projects are only proxies. To collect real demand, the admin API got one more endpoint:

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

It counts services that DevCloud received requests for but could not route. You paste the output into the "Service Not Supported" issue form. One user report is a stronger signal than all three proxies. Service IDs come from caller-controlled headers, so the collector caps how many distinct IDs it keeps and also reports how many it dropped because of the cap. The data stays in memory and is never sent anywhere.

## Wrapping Up

DevCloud routes 431 services, and 426 serve at least one operation. The separate depth target covers 205 services. Before using an operation, check its tier and tests rather than relying on the service count.

The full source code is available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
