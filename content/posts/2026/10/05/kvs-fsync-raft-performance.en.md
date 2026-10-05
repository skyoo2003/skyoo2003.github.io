---
title: "Fast GETs, Slow Server: Measuring fsync and Raft Queues in KVS"
description: "Measuring KVS by function call, RESP round trip, and 200-connection load to explain how a 3.75 ms durable write becomes 758 ms latency and how Raft queues affect GETs."
date: 2026-10-05T00:00:00+09:00
tags: [go, kvs, performance, benchmark]
---

[The previous post](/en/posts/2026/10/03/kvs-append-log-raft/) covered how the append log and Raft preserve acknowledged writes in KVS. This post looks at what that guarantee costs. Reading one value from memory and measuring a server with 200 connections waiting for writes answer different questions.

The KVS performance documentation has a result that makes this distinction visible. Memory mode handles roughly 210,000 commands per second, while a three-node cluster handles only 435–437. Yet the cluster has the shorter median GET latency. The slowest server by total throughput has the fastest individual reads in this workload.

All numbers in this post come from the KVS [performance documentation](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/website/content/docs/performance.md). They were measured at `24cccb1`, which fixed the prefill right after `f57bc5b` added the benchmarks, while source links point to [`b470020`](https://github.com/skyoo2003/kvs/tree/b470020c4a4229b28be976f6a4d069f752819757) on main, the next commit, which added write revisions.

The recorded machine was an Apple M4 with 10 cores, 16 GB of memory, and an internal SSD, running macOS 26.6.2, Go 1.26.7, and memtier_benchmark 2.5.1. It was connected to AC power with no other load. All three cluster nodes ran on this machine too. These results therefore do not include networking between separate hosts or disk contention in a production environment.

## Separating Function Calls from RESP Round Trips

`make bench` measures store functions, the RESP server, and cluster writes separately. The documented values are medians of six runs with `BENCH_COUNT=6`. Another task interfered with the first RESP run, so those rows came from a second run of that package alone.

| Benchmark | Path | ns/op | B/op | allocs/op |
|---|---|---:|---:|---:|
| `BenchmarkPut` | In-memory store write | 103 | 144 | 2 |
| `BenchmarkPutParallel` | In-memory writes across cores | 165 | 144 | 2 |
| `BenchmarkGet` | In-memory store read | 62 | 32 | 1 |
| `BenchmarkGetParallel` | In-memory reads across cores | 106 | 32 | 1 |
| `BenchmarkPutDurable` | Write with the append log | 3,750,000 | 4,662 | 8 |
| `BenchmarkRESPSet` | go-redis SET over loopback | 15,070 | 5,469 | 32 |
| `BenchmarkRESPGet` | go-redis GET over loopback | 14,490 | 3,560 | 22 |
| `BenchmarkRESPSetParallel` | Parallel SET through one client pool | 9,690 | 5,481 | 32 |
| `BenchmarkClusterPut` | Three-node write on the same host | 22,200,000 | 145,000 | 620 |

The 62 ns memory GET and the roughly 14.5 μs RESP GET cover different scopes. The first calls the store directly from Go. The second includes the client library, a TCP round trip, RESP parsing, command execution, and reply handling. Loopback adds little external network delay, but it does not eliminate the cost of crossing the protocol boundary.

The [store benchmarks](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/pkg/kvs/bench_test.go) repeatedly overwrite 1,000 keys. Every key is loaded before reads, and key names are prepared in advance so repeated string conversion does not become part of the measurement. The small value `"value"` keeps the focus on the command path rather than the bandwidth needed to copy large values.

The [RESP benchmarks](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/internal/server/resp_bench_test.go) also use 1,000 keys and a small value. The [cluster benchmark](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/internal/cluster/bench_test.go), however, constructs the key string inside its loop. The three paths can be compared, but they should not be treated as doing identical work down to each byte.

The larger parallel store results also include contention on the shared lock. For a parallel benchmark, `ns/op` is calculated from the overall elapsed time and the number of completed operations. It is not directly the response time of one client request or a p99 latency.

## With 200 Connections Attached

`make memtier` sends load to a running server rather than calling store functions. Four threads use 50 connections each, sending one SET for every ten GETs. Values are 32 bytes, keys are chosen randomly from the prefilled keyspace, and the run lasts 60 seconds.

All times below are in **milliseconds**. p50 is the median and p99 is the 99th percentile; both include the waiting time seen by the client. Ops/sec includes SETs and GETs together. The durable result of 2,754 ops/sec does not mean 2,754 disk synchronizations per second.

| Mode | Run | Ops/sec | SET p50 | SET p99 | GET p50 | GET p99 |
|---|---|---:|---:|---:|---:|---:|
| memory | 1 | 210,137 | 0.89 | 2.83 | 0.86 | 2.70 |
| memory | 2 | 204,953 | 0.92 | 2.80 | 0.90 | 2.69 |
| durable | 1 | 2,754 | 758 | 803 | 3.98 | 5.98 |
| durable | 2 | 2,773 | 754 | 934 | 3.98 | 7.71 |
| cluster | 1 | 437 | 4,850 | 5,014 | 0.055 | 0.119 |
| cluster | 2 | 435 | 4,882 | 5,145 | 0.055 | 0.143 |

memory is `kvs serve` without a data directory. durable adds `--data-dir` to a single node. cluster connects three nodes on the same host through Raft and directs the load to the leader. The two runs show movement under the same conditions; two runs cannot establish the full range of variation.

## How a 3.75 ms Durable Write Becomes a 758 ms Response

In durable mode, a change is appended to the log and synchronized to disk before the reply. This happens inside the store's write lock. [`WriteRevision`](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/pkg/kvs/kvs.go) holds the lock while performing the write, and the [log writer](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/pkg/kvs/log.go) flushes its buffer before calling `file.Sync()`.

The sequential benchmark takes about 3.75 ms on this path. The 3.75 ms measures the complete Put path, including log writing and synchronization, rather than fsync alone. Its reciprocal is roughly 267 writes per second; the documentation describes the ceiling as about 270. Adding connections does not change the fact that only one write can hold the lock and synchronize at a time.

Imagine all 200 connections waiting for their turn to write. The scale becomes clear. `200 × 3.75 ms = 750 ms`, close to the observed SET median of 754–758 ms. This is an approximation of how a queue magnifies one operation's cost, not an exact model of lock scheduling.

A GET does not need disk access, but it still needs the read lock. If the current writer holds the store during fsync, a reader waits too. The roughly 4 ms GET median describes a condition where waiting for that lock costs much more than the memory lookup itself.

Making one write faster and reducing the number of waiting writes are separate concerns. The 3.75 ms sequential benchmark alone cannot describe request latency with 200 connections. Conversely, calling 758 ms the cost of one fsync would overstate the disk cost by roughly a factor of 200.

## GETs Get Faster While Writes Wait for Raft

A sequential cluster write takes about 22.2 ms, while the loaded SET median is about 4.9 seconds. Again, the cost of sequential work must be separated from the waiting time of many connections. At the configured SET:GET ratio of 1:10, the table's total throughput corresponds to roughly 40 SETs per second. Applying the same arithmetic as the durable mode gives `200 × 22.2ms ≈ 4.4s`, so most of the 4.85–4.88 second median SET latency is time spent waiting for a turn.

The code also serializes work in a different place. [`Node.Write`](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/internal/cluster/cluster.go) holds `applyMu`, computes the change, submits it to Raft, and retains that lock while waiting for the applied result. The store lock is held when computing the change and when applying the agreed change. It is released while waiting for consensus; durable mode instead holds it throughout disk synchronization.

Each client connection waits for its SET to finish before sending its next GET. While many connections wait for their write turns, less read traffic reaches the server. The documentation explains the 0.055 ms cluster GET by **the node spending most of its time waiting on writes, with little work queued ahead of reads**.

KVS does answer reads from each node's local state without a consensus round. But that fact alone cannot explain why reads are faster than on a single memory node: that node does not run consensus for reads either. Even with the same 200 connections, the incoming read rate and the waiting conditions differ.

No separate load sending only GETs was measured, so this table cannot tell whether the cluster has more read capacity. Local reads can also lag, so a short read time does not imply a guarantee of the latest value.

## Fixing a Keyspace That Was Never Filled

The script introduced in `f57bc5b` sent random SETs and GETs to an empty store. It did not first write the keys that GET could choose, so most reads followed the missing-value path. The prefill correction reports that only about 12% of keys existed at the end of the old durable run, and about 2.5% at the end of the cluster run.

Those percentages describe **keyspace occupancy at the end of a run**, not a direct measurement of GET hit rate over the whole run. Slower writes left less of the keyspace populated, demonstrating that the modes were not compared under the same read-hit conditions. The same command ratio did not ensure the same read path.

The corrected [script](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/scripts/memtier.sh) writes all **100,001 keys**, from `memtier-0` through `memtier-100000`. The upper endpoint is included, so a maximum of 100,000 gives 100,001 keys. The load then reads and overwrites those keys without expiry or deletion, so GET operates on populated keys.

Prefill groups 1,000 keys into each MSET, then sends the final single key separately. That is exactly **101 MSET commands**. The comment's “about a hundred writes” describes the scale. Sending a SET for every key would require 100,001 fsyncs or consensus rounds, while one MSET groups the changes into the same transaction.

Prefill finishes before memtier's 60-second measurement, and the script checks the pipe result for errors. The updated performance page was also remeasured on AC power. The difference between the old and new tables therefore cannot be isolated as the effect of prefill alone. This post uses the corrected table.

## What the INFO Numbers Count

The benchmark addition also introduced connection, command, and memory fields in RESP `INFO`. They help observe load, but broadening their meaning from the field names would measure something else. Their implementations are in the [connection and dispatch code](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/internal/server/resp.go) and the [INFO reply code](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/internal/server/resp_commands.go).

| Field | Meaning in this implementation |
|---|---|
| `connected_clients` | RESP connections currently being tracked |
| `total_connections_received` | Cumulative admitted RESP connections, excluding those refused at the connection limit |
| `total_commands_processed` | Incremented when a RESP command reaches its handler |
| `used_memory` | Go runtime `/memory/classes/heap/objects:bytes` |

The command counter is not a count of successful writes or Raft commits. It increments **before** calling the handler, so a command that fails inside the handler still counts. Requests rejected before the handler, such as unknown commands or incorrect argument counts, do not count. `INFO` itself counts as a command. Commands inside MULTI count when EXEC runs them, rather than when queued, and calls inside Lua count too.

A rate derived from the counter's difference can therefore include prefill, readiness checks, and INFO queries. It is not a global counter that also includes HTTP and gRPC requests. `used_memory` is Go heap occupied by live objects and dead objects not yet reclaimed. It is neither RSS nor the size of keys and values alone.

## Running the Same Measurements Again

The reproduction commands are recorded in the [performance documentation](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/website/content/docs/performance.md) and [Makefile](https://github.com/skyoo2003/kvs/blob/b470020c4a4229b28be976f6a4d069f752819757/Makefile). Run the following from a KVS checkout.

```sh
brew install memtier_benchmark redis
make memtier BENCH_MODE=memory
make memtier BENCH_MODE=durable
make memtier BENCH_MODE=cluster
make bench BENCH_COUNT=10
```

`make memtier` builds `dist/kvs` and starts the server on RESP port 16379 by default. It stops if a server already answers there. `KVS_BENCH_PORT` selects a different port; cluster mode also uses nearby ports. The cluster waits for the other two nodes to join before filling the keyspace and starting the load.

The default duration is `BENCH_TIME=60`, and full results are saved to `dist/memtier-<mode>.json`. On exit, the script cleans up the processes it started and the temporary data directories, so this is not a long-running workload reusing a data directory. For two changed builds, repeated Go benchmarks under the same conditions can be compared with benchstat.

These measurements cover small values, a fixed keyspace, a SET:GET ratio of 1:10, and loopback. They do not represent large values, transactions, real networks, multiple disks, or response times during faults. They also do not report results after sharding, group commit, or Raft write pipelining.

## Wrapping Up

These measurements give a baseline for comparing later changes. When short GET times appear alongside low total throughput, look at which work is serialized and when clients send their next request, not only at the cost of the function itself. In KVS, the user-visible write time grew far beyond one fsync or Raft round as more connections waited behind it. When comparing performance, it is worth matching the number of connections and the command ratio as well.

The full source code is available at [github.com/skyoo2003/kvs](https://github.com/skyoo2003/kvs).
