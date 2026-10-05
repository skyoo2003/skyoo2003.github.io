---
title: "Fixing Metrics That Update Only When Status Is Called: Prometheus Collection in ACOR V3"
description: "Why ACOR V3 metrics only updated when the status API was called, and how a Prometheus Collector now reads state at scrape time for both HTTP and gRPC."
date: 2026-10-05T00:00:00+09:00
tags: [go, acor, prometheus, observability]
---

Prometheus can scrape `/metrics` regularly and still receive stale values. If the code that copies state into a Gauge lives inside another API, shortening the scrape interval only reads the values from the last API call more often.

ACOR's V3 server had this structure. HTTP `/v1/status` and `/healthz`, and gRPC `Status`, read state and then updated the metrics. If only searches and background refreshes continued, without status requests, the metrics did not reflect those changes. This did not come from a production incident; I found the structure while rereading the [previous HTTP implementation](https://github.com/skyoo2003/acor/blob/042048bf5697beda271e388477ec1f5445a24132/server/versioned.go) and [gRPC implementation](https://github.com/skyoo2003/acor/blob/042048bf5697beda271e388477ec1f5445a24132/server/grpc.go).

This post walks through the [change that added refresh on scrape](https://github.com/skyoo2003/acor/commit/a5ccfaaf98725cadec9a69ab6a6229f570721705) and how it fixed the problem. Source links refer to [`7182142`](https://github.com/skyoo2003/acor/tree/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8), the v1.7.0 release commit.

The [versioned dictionary post](/en/posts/2026/10/02/acor-v3-versioned-dictionaries/) explains why V3 separates storage and serving engine versions. For the existing cache's `CacheStats()` and invalidation behavior, see the [local cache post](/en/posts/2026/10/01/acor-distributed-cache-invalidation/#observability-cachestats). Here the focus is collecting V3 server state.

## Moving Updates into the Collector

The old flow was `status API → Status() → Gauge.Set()`. `/metrics` read values already stored in the Gauges. Initially it exposed their default values; after a status call, that call's state remained until the next one.

The new flow is `Prometheus collection → Collector.Collect() → Status() → Gauge.Set()`. No preceding status request is needed.

The [collector implementation](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/metrics/metrics.go) first copies the registered sources and releases its lock, then calls each source's `Status()`. It sets four GaugeVecs from the returned state and collects them into the metrics channel.

This avoids calling another object's method while holding the registration map's lock, and each `Collect()` reads a collection's state only once to set its four Gauges. The four GaugeVecs are still updated one at a time, though, and [a Collector may be called concurrently](https://pkg.go.dev/github.com/prometheus/client_golang/prometheus#Collector), so two overlapping scrapes can mix values from different moments. Do not expect the four values, or several collections, to form one point-in-time snapshot.

The status source has a small contract.

```go
type VersionedStatusSource interface {
    Status() acor.VersionedStatus
}
```

The method must perform no Redis I/O. The actual [`VersionedCollection.Status()`](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/pkg/acor/versioned.go) copies state under a local lock, fills in the instance's current lease count, and returns it.

Collection therefore does not directly wait on Redis during an outage. The tradeoff is the meaning of the values: **state observed by this instance**. If its background refresher has not discovered a new Redis version, scraping more frequently does not discover it either.

## Distinguishing Collections Without Growing Labels

The previous four Gauges had no collection label. Wiring multiple V3 collections to one Registry could let the last status request overwrite another collection's values. The new structure binds a status source to a `collection` label.

This label is not derived automatically from the Redis collection name. An operator supplies a stable identifier such as `moderation-prod`. Version tokens, keywords, and error text are not added as labels either.

Registration checks these conditions.

- The label is 1–64 bytes and accepts only ASCII letters, digits, `.`, `_`, `:`, and `-`.
- A status source is required; a nil pointer is rejected too.
- Registering the same source under the same label again is allowed.
- Binding a different source to an existing label returns an error.

For an actual `*VersionedCollection`, passing the same pointer to the HTTP and gRPC constructors identifies the same source. Internally, equality also requires the same type and a comparable value, which matters when implementing a custom adapter.

Character validation does not limit the number of labels. Request IDs or constantly changing deployment IDs would still create more time series. Fix the label in operational configuration and wire both protocols to the same collection.

## Wiring HTTP and gRPC to One Source

The function below covers wiring only. It assumes `v3` is a collection already opened with `OpenVersioned`; the caller owns HTTP and gRPC serving, shutdown, and closing the collection.

```go
package wiring

import (
    "net/http"

    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
    "github.com/skyoo2003/acor/pkg/acor"
    "github.com/skyoo2003/acor/server"
    "github.com/skyoo2003/acor/server/metrics"
    "google.golang.org/grpc"
)

func Wire(v3 *acor.VersionedCollection) (http.Handler, *grpc.Server, error) {
    promReg := prometheus.NewRegistry()
    registry := metrics.NewRegistry(promReg)
    obs := &server.VersionedObservability{
        Metrics: registry, Collection: "moderation-prod",
    }
    api, err := server.NewVersionedHTTPHandlerWithObservability(v3, obs)
    if err != nil {
        return nil, nil, err
    }
    rpc, err := server.NewVersionedGRPCServerWithObservability(v3, obs)
    if err != nil {
        return nil, nil, err
    }
    mux := http.NewServeMux()
    mux.Handle("/metrics", promhttp.HandlerFor(promReg, promhttp.HandlerOpts{}))
    mux.Handle("/", api)
    return mux, rpc, nil
}
```

Check each constructor's error separately. Overwriting `err` with the next call before checking the HTTP constructor could hide invalid wiring. Registering metrics and exposing `/metrics` are also separate steps, so the example passes the same Prometheus Registry to `HandlerFor`.

These V3 constructors bind collection state metrics. They do not automatically install the gRPC interceptor for general request counts or the standard gRPC health service. Those features have a separate wiring path in the [gRPC implementation](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/grpc.go).

Passing a Registry to the old HTTP constructor, and `NewVersionedGRPCServerWithMetrics`, remain available for source compatibility, but those arguments no longer bind V3 metrics. Use the `WithObservability` constructors that accept a collection label.

## What the Four Values Mean

All four V3 state metrics currently exported by the server are Gauges.

| Metric | Meaning |
| --- | --- |
| `acor_versioned_building` | 1 while a local engine candidate is being built |
| `acor_versioned_serving_ready` | 1 when `ServingVersion` exists and `LastError` is empty |
| `acor_versioned_refresh_failures` | Cumulative refresh failures observed by this instance |
| `acor_versioned_active_leases` | Number of V3 leases held by this instance |

`building=1` and `serving_ready=1` can occur together. While building a new candidate, both are true if an existing engine is installed and there is no error. Conversely, `building=0` does not mean refresh is healthy. A failed build finishes but leaves `LastError` set.

On refresh failure, the previous engine remains installed. Nevertheless, **`serving_ready=0` and HTTP `/healthz` returns 503**. Reading the metric name as “the search engine disappeared” would be wrong. This value combines the presence of an installed engine with the last refresh error.

`/v1/status` returns HTTP 200 even when its response body reports `degraded`. gRPC `Status` also puts that result in the response's `status` field. A successful status query and the reported service condition are separate facts. The conditions are explicit in the [HTTP status implementation](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/versioned.go).

Failures accumulate internally, but the Prometheus type is a Gauge, not a Counter. Treating it as a `_total` Counter and attaching a `rate()` example would misrepresent the implementation's contract. Restarting the process also resets the local accumulated value.

The lease count is neither the total across Redis nor a concurrent request count. It is local ownership at collection time; a lease that appears and disappears between scrapes may never be observed.

## A First Query and the Remaining Visibility

Instances whose reported readiness has dropped can be selected with:

```promql
acor_versioned_serving_ready{collection="moderation-prod"} == 0
```

This query does not detect a missing time series. Check Prometheus's `up` separately for the scrape target itself. `building` is an instantaneous observation, so one sample cannot establish that a build is stuck.

Keep failure counts and lease counts visible per instance. Aggregating every replica can obscure failures or uneven state on an individual replica.

These four Gauges do not expose a gap between active and serving versions, the last success timestamp, or shard state. Check version differences and the last success timestamp through `Status()` or a status API; shard state requires the library's `Status()`. HTTP and gRPC status responses omit shard fields. Versions are equality tokens; subtracting them or sorting their strings cannot measure lag. To check whether a particular write has reached local serving state, call `WaitForVersion` with a bounded context. The [monitoring documentation](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/docs/content/operations/monitoring.md) distinguishes these boundaries.

## What the Regression Tests Establish

The central test does not send an HTTP request first. It registers a fake status source, calls `Gather()` to verify that state was read, changes the source's state, and calls `Gather()` again to check the new values.

The same test file checks separation between two collections and rejection of invalid labels and conflicting sources. Server tests bind the same source through the HTTP and gRPC constructors, then gather immediately to verify labeled metrics. The [collector tests](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/metrics/metrics_test.go) and [server tests](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/versioned_test.go) directly exercise the contract that collection does not depend on status API traffic.

Note that this Prometheus code lives in the experimental, separately versioned `github.com/skyoo2003/acor/server` module. As [server/go.mod](https://github.com/skyoo2003/acor/blob/7182142ecf54d5e6e64c405c577fe9d6f2e4aea8/server/go.mod) states, it does not share the compatibility promise of the V3 library API in `pkg/acor`.

## Wrapping Up

With this change, metrics are refreshed at Prometheus scrape time without calling a status API first. The collected values are still local observations, though. If the instance has not yet seen a new version in Redis, the metrics will not show it either, so check the status API as well when judging whether dictionary refresh is healthy.

The full source code is available at [github.com/skyoo2003/acor](https://github.com/skyoo2003/acor).
