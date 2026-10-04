---
title: "Durability and Clustering in KVS: Append Log, Raft, and a Four-Hour Soak Test"
description: "Adding durability to KVS with an append log and clustering with Raft, which guarantees it makes and doesn't, and harness bugs found in a four-hour soak test."
date: 2026-10-03T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, kvs, raft, distributed-systems]
---

## Introduction

The [previous post](/en/posts/2026/10/03/kvs-resp2-server-lua/) covered how [KVS](https://github.com/skyoo2003/kvs) learned to speak the Redis protocol. But up to that point, KVS kept everything in memory. When the process restarted, the keyspace was gone.

This post covers the work that added two flags to KVS. `--data-dir` lets the keyspace survive a restart, and `--raft-addr` lets it survive losing a machine. Both are off by default, so a plain `kvs serve` is still a single in-memory node.

More than the design, I want to talk about measurement. I ran a four-hour soak test twice, and each time I found a bug in the test harness. Fixing the harness showed that some of the numbers in the docs were wrong.

This post is based on **the main branch**. The KVS v1.0.0 tag is retracted in `go.mod`, and the revisions and data-directory format 2 discussed below are not released yet.

## Single-Node Durability with an Append Log

With `--data-dir`, every change is appended to a log in that directory and replayed at startup. All three protocols (RESP, HTTP, gRPC) write to the same log.

```sh
$ kvs serve --data-dir /var/lib/kvs
$ redis-cli -p 6379 set greeting hello
OK
# restart kvs
$ redis-cli -p 6379 get greeting
"hello"
```

It makes three promises:

- **A write that has returned is on disk.** The log is flushed and `fsync`ed before the command answers, so it survives a crash, not just a clean shutdown. The cost is that writes go no faster than the disk can sync.
- **A crash loses only the record in flight.** A log whose last record was cut short stops being read there, reports how many bytes were dropped, and is rewritten without them at startup.
- **The log is compacted at startup, not while running.** After replay the whole live keyspace is in memory, so rewriting the log at that moment costs nothing extra and needs no background worker.

The last promise has a cost: a long-running process grows its log without bound in the meantime. I measured how fast. Four hours of continuous writes over 1,000 keys, 1,726,455 writes in all, overwrote each key about 1,700 times and produced an **87MB** log. The keyspace never exceeded 1,000 entries. That is **51 bytes per write**. The figure belongs to this workload: a record carries the key and the encoded value, so your own average record size sets it. What generalizes is the shape. The log grows with **the number of writes**, not with time and not with how much data you keep. Over the same four hours, memory stayed between 1.11MB and 1.22MB. The disk is what needs watching, and a restart is what reclaims it.

## Building a Raft Cluster

One node is one disk. Lose the disk and you lose the data; stop the process and you stop the service. Durability is not availability.

`--raft-addr` puts a node in a [Raft](https://raft.github.io/) cluster. The implementation uses [hashicorp/raft](https://github.com/hashicorp/raft) and raft-boltdb.

```sh
# first node: starts the cluster
$ kvs serve --data-dir /var/lib/kvs1 --raft-addr 127.0.0.1:7901 --resp-addr 127.0.0.1:6381 \
            --http-addr 127.0.0.1:3461 --grpc-addr 127.0.0.1:3471

# the others: join through a node already in the cluster
$ kvs serve --data-dir /var/lib/kvs2 --raft-addr 127.0.0.1:7902 --resp-addr 127.0.0.1:6382 \
            --http-addr 127.0.0.1:3462 --grpc-addr 127.0.0.1:3472 --join 127.0.0.1:6381
$ kvs serve --data-dir /var/lib/kvs3 --raft-addr 127.0.0.1:7903 --resp-addr 127.0.0.1:6383 \
            --http-addr 127.0.0.1:3463 --grpc-addr 127.0.0.1:3473 --join 127.0.0.1:6381
```

When running several nodes on one machine, the HTTP and gRPC addresses must differ per node too. With the defaults (`:3456`, `:3457`), the second node fails to bind its HTTP port and exits.

`--join` takes the **Redis address** of an existing node, not its Raft address. Joining goes through the `KVS.JOIN` command on the RESP listener. There is no second port and no second way to authenticate.

### The Store Is the State Machine

Adding Raft was smaller work than I expected, because the store already had the three methods Raft requires of a state machine (FSM). The serialization and replay built for the append log are used for replication as they are.

```go
// fsm is the store seen the way Raft needs to see it. The three methods it has to provide are
// the three the store already grew for its own log and for replication.
type fsm struct {
	store *kvs.Store
}

func (f *fsm) Apply(entry *raft.Log) interface{} {
	var lines [][]byte
	if err := json.Unmarshal(entry.Data, &lines); err != nil {
		return fmt.Errorf("decode frame: %w", err)
	}

	// The entry's index is the write's revision: every node applies the same entry at the same
	// index, however far behind it was or whichever snapshot it started from.
	rev, err := f.store.ApplyReplicated(int64(entry.Index), lines)
	if err != nil {
		return err
	}

	return rev
}
```

On a clustered node, the store gets a replicator, so every write goes through consensus first. The Raft log **replaces** the single-node append log. Writing the same changes in two places would only mean two things to keep in sync. That is why `--data-dir` is required in a cluster: the Raft log has to live somewhere.

On the unreleased main branch, every write carries a **revision**. In a cluster, the Raft entry index is the revision. Every node applies the same entry at the same index, so the revision is the same no matter how far behind a node was or which snapshot it started from.

### What It Promises

- **An acknowledged write survives losing a minority of nodes.** Writes follow the Raft consensus order, and a majority retains the log on disk before a successful response. Each write requires one consensus round. Reads use each node's local state and may return stale values. This durability guarantee does not establish strong consistency for all reads and writes.
- **Failover needs no person.** Stop the leader and the rest elect a new one on their own.

### What It Does Not Promise

The docs spend more words on this part:

- **Three nodes, not two.** A majority of two is two. A two-node cluster stops accepting writes the moment either node dies, which is worse than one node.
- **Writes stop during an election.** On a three-node cluster on one machine, writes came back **1.3–3.0 seconds** after the leader was stopped, across eight runs. Expect longer over a real network.
- **Reads may be behind.** Every node answers reads from its own copy. A follower that is catching up, or one cut off from the majority, can return a value the leader has already replaced.
- **Pub/Sub does not cross nodes.** Channels are not keyspace, so they are not replicated.
- **`/healthz` knows nothing about the cluster.** A node cut off from the majority, unable to accept a single write, still reports healthy. Read it only as "the process is alive."
- **No sharding.** Every node holds the whole keyspace. This is designed for availability, not throughput.

### Writing to a Node That Is Not the Leader

Only the leader takes writes. Each protocol says so in its own way:

| Protocol | Reply | Leader address |
|---|---|---|
| RESP | `MOVED 0 <leader>`, or `CLUSTERDOWN` during an election | Included. Borrows Redis Cluster's reply format |
| HTTP | `409 Conflict` | Only in the `error` message text |
| gRPC | `FAILED_PRECONDITION` | Only in the status message text |

The RESP reply only borrows Redis Cluster's format; KVS is not Redis Cluster. It does not shard and has no `CLUSTER` commands. The `0` in `MOVED` is not a real slot number, just a value that fills the format. So clients need handling on their side:

- **Cluster-mode clients** (such as go-redis `ClusterClient`) read a slot map with commands like `CLUSTER SLOTS` when they initialize. KVS has no such command, so they do not connect with default settings.
- **Single-node clients** do not follow `MOVED`; they return it as an error. The application has to reconnect to the leader address in the reply, or find the leader through `INFO`'s `master_host`/`master_port` and connect to it from the start.

## The Four-Hour Soak Test

`make soak` puts load on a three-node cluster while stopping one node and bringing it back every 30 seconds. It is skipped by the normal `make test` and in CI, and runs only when `-soak` is given a duration.

### Harness Bug 1: The Node Never Missed a Write

The first four-hour run looked clean: 457 node restarts, 350,260 acknowledged writes, all of them present on every node.

Then, rereading the harness, I found the problem. Load and fault injection ran in **the same goroutine**. A node was stopped and restarted between two writes, so it never missed a single one. What that run measured was not "the cluster takes writes with a node missing and hands them over when it comes back." It measured a process being started twice.

The verification had a gap too. It checked only at the end, so if a later round overwrote a value that had gone missing in between, the evidence of the loss disappeared along with the data.

The fixed harness works like this:

- A stopped node stays down for **10 seconds** while writes continue, and the writes taken in that state are counted separately.
- Each time a node comes back, it is checked against **the last acknowledged value of every key** before the load writes again. All three nodes are checked once more at the end.

The numbers now in the docs come from four hours with the fixed harness: **329,631** acknowledged writes, **111,516** of them taken while a node was down; **479** restarts; **0** losses found by the checks; 0 crashes.

The scope of that "0 losses" needs reading precisely. The check is per **key**, not per write. When more writes arrive during a check interval than there are keys, some keys are overwritten several times, and only the last value can be compared. So writes overwritten before a check were not verified one by one, and the harness reports how many such writes there were. The accurate claim is: "none of the latest acknowledged values at each check was missing."

### Harness Bug 2: It Wasn't KVS's Heap That Grew

The first run's report had one more uncomfortable number. Under the condition where a stopped node comes right back, the heap grew from **10MB to 139MB** over four hours. A heap profile put more than half of the reachable memory in Raft's network transport, which holds a 256KB read buffer and a 256KB write buffer per connection. The docs recommended a memory limit for that condition.

I ran the same condition again with the harness that separates load from fault injection: the same three nodes, the same 479 restarts, each one immediate. The heap went from **6.7MB to 7.0MB**, staying within a 5.0MB–8.6MB band. Goroutines held steady at 26–27. Per restart, the old number implied 269KB; what actually happens is 600 bytes.

Nothing in KVS needed fixing. The buffers are still there; they just do not accumulate. The old number was measured before the harness's load and fault injection were separated. The commit title states the conclusion directly:

> The heap does not grow in a crash loop; the harness did

This run changed the soak test too. At first, the heap had been measured not to converge, so a threshold would either be picked to pass or fail without telling anyone anything useful, and the test only printed the heap. Now it fails if the heap more than doubles.

### Log Growth on a Node That Cannot Snapshot

After fixing the harness, one problem remains, and this one is real.

Raft discards log entries only once a snapshot covers them. It considers a snapshot every two to four minutes, takes one only if 8,192 entries have arrived since the last, and keeps the most recent 10,240 entries anyway. In the soak test a node goes down every 90 seconds, so it never lives long enough to snapshot. After four hours, every node held **126MB of Raft log** for 1,000 keys, none of it discardable. Under the immediate-restart condition, 558,813 writes went in and each node reached **202MB**. This too grows with writes, not with time.

A node in a crash loop fills its disk while looking like it is merely restarting. A node that stays up snapshots normally, and this does not arise. The docs do not hide it; it is listed under "what it does not promise."

## Stamping a Format Version on the Data Directory

Once there is durability, there is a new risk. What if the next version changes how bytes are laid out in the directory? Replay would read them anyway, and the damage would surface later, looking like **data corruption rather than a version mismatch**.

So the data directory carries a `format` file. Every path that opens a directory checks this version before reading any data. If the version is not understood, startup is refused with both version numbers and what to do about it.

```go
// Version is what this build writes. Raise it whenever the bytes in a data directory change
// shape — including when a dependency that owns part of the directory, the Raft log store among
// them, changes its own format under us. A build reads its own version and those back to
// oldestReadable, and nothing newer: there is no conversion code, which is why the check has to
// be loud.
const Version = 2
```

The marker sits next to the data, not inside it, for a reason: the Raft store's files belong to a library and cannot carry a KVS header. With one version per directory, the version has to move when the Raft library changes its own format too.

The version file itself was refined three times in review:

- Reading a `stat` that failed for any reason other than "file not found" as "no data" would stamp a new version onto a directory holding an older version's keyspace, which is exactly what this package exists to prevent. Now that error is returned as is.
- Writing the version in place means an interrupted write leaves half a version, and half a version is refused forever. Now it is written to a temporary file, synced, renamed, and the directory is synced too.
- Reading the whole file means swapping it for a huge file kills the process. Now reading stops at 64 bytes.

Upgrades happen in place. A build reads the older formats it lists as readable and restamps them with its own version. Format 2 (which added revisions) reads format 1. Downgrades do not work: a newer format is refused, so you move the directory aside and load the data again.

## Conclusion

When operating a KVS cluster, monitor majority connectivity and log size together. Writes go through consensus, but local reads may be stale, and a node that cannot snapshot may keep growing its log. The soak result covers only the latest acknowledged values and conditions checked by the harness described above.

The full source code is available at [github.com/skyoo2003/kvs](https://github.com/skyoo2003/kvs).
