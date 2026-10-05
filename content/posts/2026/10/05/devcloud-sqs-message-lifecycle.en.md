---
title: "SQS Is More Than a Message Array: Visibility Timeouts and DLQ Redrive"
description: "How DevCloud's SQS manages message lifecycles with visibility timeouts, receive counts, and receipt handles, plus DLQ moves, redrive, and FIFO deduplication."
date: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, sqs, message-queue]
---

An initial queue implementation might put messages into an array and remove the first item on each receive. But what happens if a consumer receives a message and then fails to process it? If receiving already removed the message, there is nothing left to retry.

DevCloud's SQS implementation keeps received messages in storage and hides them from other receive requests for a specified period. A consumer must delete a message after processing it successfully. That distinction introduces per-message visibility deadlines, receive counts, and handles that change with each delivery, even when storage is just an array.

The [earlier boto3 compatibility post](/en/posts/2026/04/19/local-aws-emulator-boto3-compatibility/) covered SDK request and response formats, so this post looks at how messages change inside the store, along with the places where DevCloud behaves differently from AWS SQS.

This post is based on [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c) on main after v1.2.0.

## State Attached to a Message

These are the lifecycle fields from the store's [`Message` struct](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L47-L94).

```go
MessageID     string
ReceiptHandle string

invisibleUntil time.Time
deleted bool
receiveCount int
```

`MessageID` identifies a message, while `ReceiptHandle` is used to delete it or change its visibility after delivery. `invisibleUntil` is the time it becomes available again, and `receiveCount` determines whether it moves to a DLQ.

| Event | Change in storage | Next receive request |
|---|---|---|
| `SendMessage` | Appends a message to the array | Available immediately |
| `ReceiveMessage` | Increments receive count; updates deadline and handle | Skipped until the deadline |
| Timeout expires | Evaluated against the current time, without a separate job | Available again |
| `ChangeMessageVisibility` | Sets deadline to now plus the requested seconds | Available again if set to zero |
| `DeleteMessage` | Marks deleted, then compacts the array | No longer available |

The implementation does not create a goroutine or timer for every timeout. [`ReceiveMessage`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L452-L523) and queue-attribute reads compare the current time with `invisibleUntil`, so an undeleted message becomes visible again as time passes. That turned out to be enough to reproduce a stopped consumer locally.

A fresh handle is issued on every delivery. After a second receive, deleting with the first handle fails the handle check in [`DeleteMessage`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L535-L612), and the [provider](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider.go#L544-L561) returns `ReceiptHandleIsInvalid`. Deleting by message ID is not supported either. The latest handle, on the other hand, has no time-based validity check: if its visibility timeout expires and nobody receives the message again, that handle can still delete it.

This differs from AWS. According to the [AWS DeleteMessage documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html), deleting with an old handle can succeed without deleting the message, so the error-code assertion in the example below checks DevCloud's behavior and may not pass against real AWS.

## Queue Attributes and Receive Behavior Are Separate

Setting `VisibilityTimeout` through `SetQueueAttributes` makes that value appear in [attribute reads](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L321-L390). The receive handler, however, does not read the stored queue value. When a [receive request](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider.go#L492-L505) omits `VisibilityTimeout`, it uses 30 seconds. A queue attribute of five seconds therefore still produces a 30-second invisible period when the request omits the parameter.

`DelaySeconds` can also be stored and read, but it does not delay sending. Assuming an attribute takes effect just because it appears in a response leads to misreading test results.

Creation has another caveat. [`CreateQueueWithAttributes`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L129-L182) applies only `FifoQueue` and `ContentBasedDeduplication` and does not copy the other attributes. In particular, `RedrivePolicy` is [parsed only in `SetQueueAttributes`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L394-L433), so passing a DLQ policy only in the creation request does not configure it. The example below therefore creates the queues first and sets `RedrivePolicy` afterwards.

## Checking the Lifecycle and Redrive with boto3

This example assumes DevCloud is running on `localhost:4747`. Each run uses unique queue names and deletes them at the end so it does not mix with existing messages.

```python
import json
from uuid import uuid4

import boto3
from botocore.exceptions import ClientError

sqs = boto3.client(
    "sqs", endpoint_url="http://localhost:4747",
    region_name="us-east-1",
    aws_access_key_id="test", aws_secret_access_key="test",
)
suffix = uuid4().hex[:12]
queues = []

def make_queue(name):
    url = sqs.create_queue(QueueName=f"{name}-{suffix}")["QueueUrl"]
    queues.append(url)
    return url

def receive(url, timeout):
    return sqs.receive_message(
        QueueUrl=url, MaxNumberOfMessages=1,
        VisibilityTimeout=timeout,
    ).get("Messages", [])

try:
    src = make_queue("lifecycle-src")
    dlq = make_queue("lifecycle-dlq")
    dlq_arn = sqs.get_queue_attributes(
        QueueUrl=dlq, AttributeNames=["QueueArn"],
    )["Attributes"]["QueueArn"]
    sqs.set_queue_attributes(QueueUrl=src, Attributes={
        "RedrivePolicy": json.dumps({
            "deadLetterTargetArn": dlq_arn, "maxReceiveCount": 2,
        }),
    })

    sqs.send_message(QueueUrl=src, MessageBody="complete-me")
    first = receive(src, 30)[0]
    assert receive(src, 30) == []
    sqs.change_message_visibility(
        QueueUrl=src, ReceiptHandle=first["ReceiptHandle"],
        VisibilityTimeout=0,
    )
    second = receive(src, 30)[0]
    assert first["MessageId"] == second["MessageId"]
    assert first["ReceiptHandle"] != second["ReceiptHandle"]
    try:
        sqs.delete_message(QueueUrl=src, ReceiptHandle=first["ReceiptHandle"])
    except ClientError as error:
        assert error.response["Error"]["Code"] == "ReceiptHandleIsInvalid"
    else:
        raise AssertionError("old receipt handle unexpectedly accepted")
    sqs.delete_message(QueueUrl=src, ReceiptHandle=second["ReceiptHandle"])
    assert receive(src, 0) == []

    sqs.send_message(QueueUrl=src, MessageBody="retry-me")
    assert len(receive(src, 0)) == 1
    assert len(receive(src, 0)) == 1
    assert receive(src, 0) == []  # third receive moves it to the DLQ
    handle = sqs.start_message_move_task(SourceArn=dlq_arn)["TaskHandle"]
    task = sqs.list_message_move_tasks(SourceArn=dlq_arn)["Results"][0]
    assert task["TaskHandle"] == handle
    print(task["Status"], task["ApproximateNumberOfMessagesMoved"])
    back = receive(src, 30)[0]
    print(back["Body"])
    sqs.delete_message(QueueUrl=src, ReceiptHandle=back["ReceiptHandle"])
finally:
    for url in reversed(queues):
        sqs.delete_queue(QueueUrl=url)
```

Running it against DevCloud built from that commit prints the following. Random IDs and timestamps are left out.

```text
COMPLETED 1
retry-me
```

The first half checks receiving and deleting separately. The second half receives a message twice without deleting it, moves it to the DLQ on the third receive attempt, and redrives it to the original queue. The store's [`TestQueueStore_DLQ` and move-task lifecycle test](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L138-L249) and the [existing boto3 redrive tests](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/test/compatibility/test_sqs.py#L200-L278) exercise the same path.

## Moving to a DLQ and Redriving

Automatic dead lettering happens inside `ReceiveMessage`. The store first increments a visible message's receive count. If `receiveCount > MaxReceiveCount`, it copies the message into the configured DLQ and marks the original deleted. With a threshold of two, the message is delivered twice and moved on the third attempt.

Elapsed time alone does not trigger this move. Another receive attempt must check the condition, and no move occurs if the target queue does not exist. The copy preserves the body, message ID, sent timestamp, and user message attributes, but omits FIFO fields. This happens in the [DLQ branch of `ReceiveMessage`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L472-L514).

`StartMessageMoveTask`, by contrast, explicitly takes messages out of a DLQ and moves them to a destination. Its `SourceArn` is the ARN of the **DLQ containing failed messages**. At least one other queue must reference that queue through `RedrivePolicy` before a move task can start.

When `DestinationArn` is omitted, a DLQ referenced by exactly one queue sends messages back to that queue. If several queues share the DLQ, the store cannot determine the destination because it does not track each message's origin; it rejects the request with `InvalidParameterValue`. In that case the destination ARN must be given explicitly. The destination logic is in [`StartMessageMoveTask`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L727-L768), and the multiple-source case is covered by a [store test](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L251-L279).

## How Move Tasks Run

The redrive APIs were added in [commit `b16c632`](https://github.com/skyoo2003/devcloud/commit/b16c632fd1234f1424e01b2f8e9d3515f034aceb). The start call moves the messages and records a `COMPLETED` task before returning. There is no `RUNNING` state to observe after the call finishes.

| Item | Behavior at the base commit |
|---|---|
| Eligible messages | Undeleted DLQ messages currently available |
| In-flight messages | Remain in the DLQ with their current handles |
| State after moving | Fresh handle, cleared visibility, receive count zero |
| Message ID and sent timestamp | Preserved during redrive |
| `MaxNumberOfMessagesPerSecond` | Recorded and returned, without throttling |
| Task retention | Latest ten per source ARN |
| `ListMessageMoveTasks` | Newest first; defaults to one; positive values capped at ten |
| `CancelMessageMoveTask` | Returns `ResourceNotFoundException` because the task has completed |

The [AWS DLQ redrive documentation](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html) describes assigning new message IDs and enqueue times and resetting the retention period. This implementation preserves message IDs and sent timestamps, so tests comparing IDs before and after redrive need to account for that difference.

Leaving in-flight messages behind preserves handles held by consumers reading the DLQ. The store-wide lock protects queue resolution and task-record updates; it is released while messages move. Moving messages then locks the source and destination queues in turn. Avoiding simultaneous locks on two queues prevents conflicting lock order with the receive path that moves messages into a DLQ. See the [move and task-record code](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L770-L895) for details.

Tasks are ordered by a monotonically increasing sequence rather than the millisecond timestamp, so the newest task survives even when several finish in the same millisecond. Records are bounded per source, but there is no global cap across all source ARNs; the [task-record test](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L281-L326) checks these bounds.

Both JSON and legacy Query requests reach redrive handlers. They share the same store, so synchronous completion applies to both protocols. The Query path has its own [regression test](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider_test.go#L469-L535).

## What FIFO Deduplication Covers

A queue is considered FIFO when its name ends in `.fifo` or its creation attributes include `FifoQueue=true`. An explicit `MessageDeduplicationId` is recorded in a per-queue cache. Sending the same ID within five minutes returns success without adding another message.

When `ContentBasedDeduplication=true` and no explicit ID is supplied, the cache key is the SHA-256 of the body. User message attributes are not part of that hash. A duplicate send returns a fresh random message ID, so different response IDs do not prove that two messages were stored. The implementation is in [`SendMessageFull`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L264-L318).

Storing `MessageGroupId` does not implement serialized processing within a group. Receive scans visible messages in array order; an in-flight message does not block a later message in the same group. Required group IDs are not validated, and the internal sequence number is not exposed in SDK send or receive responses. The [FIFO store tests](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L353-L395) also cover only explicit-ID and body-based deduplication.

## What Local Tests Can Rely On

This implementation can check a consumer's receive-and-delete flow, immediate redelivery after setting visibility to zero, and DLQ movement followed by redrive. Tests involving processing time or durability must account for these limits.

- `WaitTimeSeconds` is not honored; long-poll requests return immediately.
- Messages do not expire over time, even when a retention attribute is present.
- Queue-level delay and visibility attributes do not affect send and receive behavior.
- `AddPermission` and `RemovePermission` return success without enforcing access permissions.
- Queues, messages, deduplication caches, and move tasks exist only in memory and disappear when the server restarts.

The [SQS service documentation](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/docs/services/sqs.md#known-limitations) lists these limits as well. Every operation answering does not mean every detail matches AWS, so check separately that the behavior you need is implemented.

## Wrapping Up

Adding visibility deadlines, receipt handles, and receive counts to a message array made it possible to handle consumer success and failure locally, and as the example shows, that lifecycle can be reproduced through the SDK as is. For tests that need long polling, FIFO group ordering, or persistence, though, it is better to use another environment alongside it for now.

The full source code is available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
