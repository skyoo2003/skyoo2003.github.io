---
title: "SQS는 메시지 배열보다 복잡하다: 가시성 타임아웃과 DLQ 재처리"
description: "DevCloud SQS가 가시성 타임아웃, 수신 횟수, 수신 핸들로 메시지 수명 주기를 관리하고 DLQ 이동과 재처리, FIFO 중복 제거를 다루는 방법을 설명한다."
date: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, sqs, message-queue]
---

메시지 큐를 처음 구현한다면 배열에 메시지를 넣고 수신할 때 앞에서 하나씩 꺼내는 구조를 생각할 수 있다. 그런데 수신과 동시에 배열에서 제거해 버리면 소비자가 처리에 실패했을 때 다시 처리할 메시지가 남아 있지 않다.

DevCloud의 SQS 구현은 메시지를 수신해도 보관한 채 일정 시간 다른 수신 요청에서 보이지 않게 하며 성공적으로 처리한 소비자가 삭제해야 메시지를 제거한다. 수신과 삭제가 분리되므로 단순한 배열에도 메시지별 가시성 시각, 수신 횟수, 수신마다 바뀌는 핸들이 필요해진다.

SDK 요청과 응답 형식은 [이전 boto3 호환성 글](/ko/posts/2026/04/19/local-aws-emulator-boto3-compatibility/)에서 다뤘으므로, 이번에는 저장소 안에서 메시지가 어떻게 바뀌는지 살펴보고 AWS SQS와 다르게 동작하는 부분도 함께 정리하려 한다.

참고로 이 글은 v1.2.0 이후 main의 [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c)를 기준으로 설명한다.

## 메시지 하나에 필요한 상태

[저장소의 `Message` 구조체](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L47-L94)에서 수명 주기와 관련된 필드만 옮기면 다음과 같다.

```go
MessageID     string
ReceiptHandle string

invisibleUntil time.Time
deleted bool
receiveCount int
```

`MessageID`로 메시지를 식별하고 `ReceiptHandle`로 해당 메시지를 수신한 뒤 삭제하거나 가시성을 바꾸는 요청을 한다. 다시 수신할 수 있는 시각은 `invisibleUntil`에 두며 DLQ 이동 여부는 `receiveCount`로 판단한다.

| 시점 | 저장소의 변화 | 다음 수신 요청 |
|---|---|---|
| `SendMessage` | 메시지를 배열에 추가 | 즉시 수신 가능 |
| `ReceiveMessage` | 수신 횟수 증가, 가시성 시각과 핸들 갱신 | 가시성 시각 전까지 제외 |
| 타임아웃 만료 | 별도 작업 없이 현재 시각으로 판단 | 다시 수신 가능 |
| `ChangeMessageVisibility` | 지금부터 요청한 초만큼 가시성 시각 변경 | 0초면 다시 수신 가능 |
| `DeleteMessage` | 삭제 표시 후 배열 정리 | 다시 수신할 수 없음 |

타임아웃마다 고루틴이나 타이머를 만들지는 않는다. [`ReceiveMessage`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L452-L523)와 큐 속성 조회에서 현재 시각을 `invisibleUntil`과 비교하기만 해도 시간이 지난 메시지는 다시 보이므로, 소비자가 멈춘 상황을 로컬에서 재현하기에는 이 정도로 충분했다.

수신할 때마다 새 핸들이 이전 핸들을 대신하므로, 두 번째 수신 이후 첫 번째 핸들로 삭제하면 [`DeleteMessage`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L535-L612)가 핸들 비교에 실패하고 [프로바이더](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider.go#L544-L561)는 `ReceiptHandleIsInvalid`를 반환한다. 메시지 ID를 대신 넣어 삭제할 수도 없다. 반면 마지막 핸들에는 시간에 따른 유효성 검사가 없어서, 타임아웃이 지났어도 그사이 다시 수신한 소비자가 없다면 그 핸들로 삭제할 수 있다.

이 부분은 AWS와 다르다. AWS의 [DeleteMessage 문서](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/APIReference/API_DeleteMessage.html)에 따르면 이전 핸들로 삭제하면 요청은 성공하지만 메시지는 삭제되지 않을 수 있다. 그래서 아래 예제에서 오류 코드를 확인하는 부분은 DevCloud의 동작을 확인하는 것이고, 실제 AWS에서는 통과하지 않을 수 있다.

## 큐 속성과 수신 동작은 별개다

`SetQueueAttributes`로 저장한 `VisibilityTimeout`은 [조회 응답](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L321-L390)에 나타나지만 수신 핸들러가 큐에 저장된 값을 읽어 쓰지는 않는다. [수신 요청](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider.go#L492-L505)의 `VisibilityTimeout`만 확인해 없으면 30초를 사용하므로 큐 속성이 5초여도 요청에서 생략하면 이 구현에서는 30초 동안 숨긴다.

`DelaySeconds`도 저장하고 조회할 수는 있지만 전송을 지연시키지는 않는다. 설정이 응답에 보인다고 해서 실제 동작에도 적용된다고 보면 테스트 결과를 잘못 해석하게 된다.

큐를 생성할 때도 주의할 부분이 있다. [`CreateQueueWithAttributes`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L129-L182)는 `FifoQueue`와 `ContentBasedDeduplication`만 반영하고 나머지 속성은 복사하지 않는다. 특히 `RedrivePolicy`는 [`SetQueueAttributes`에서만 파싱](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L394-L433)하므로, DLQ 연결을 생성 요청의 `Attributes`에만 넣으면 설정되지 않는다. 그래서 아래 예제에서는 큐를 만든 뒤 `RedrivePolicy`를 따로 설정한다.

## boto3로 수명 주기와 재처리 확인하기

DevCloud가 `localhost:4747`에서 실행 중이라고 가정한 예제다. 기존 메시지와 섞이지 않도록 실행할 때마다 큐 이름을 바꾸고 마지막에 삭제한다.

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

기준 커밋으로 빌드한 DevCloud에서 실행하면 다음과 같이 출력된다. 무작위 ID와 타임스탬프는 출력하지 않았다.

```text
COMPLETED 1
retry-me
```

앞부분에서 수신과 삭제를 분리해 확인했다면 뒷부분에서는 같은 메시지를 두 번 받아도 삭제하지 않은 뒤 세 번째 수신 요청에서 DLQ로 보내고 다시 원래 큐로 옮긴다. 저장소 테스트의 [`TestQueueStore_DLQ`와 재처리 수명 주기](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L138-L249), [기존 boto3 재처리 테스트](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/test/compatibility/test_sqs.py#L200-L278)도 같은 경로를 확인한다.

## DLQ 이동과 재처리

자동 DLQ 이동은 `ReceiveMessage` 안에서 보이는 메시지의 수신 횟수를 먼저 늘린 뒤 `receiveCount > MaxReceiveCount`이면 연결된 DLQ로 복사하고 원본에 삭제 표시를 하는 순서로 이루어진다. 기준값이 2라면 두 번까지는 소비자에게 전달하고 세 번째 시도에서 이동한다.

시간이 흐르는 것만으로 DLQ 이동이 일어나지는 않는다. 다시 수신을 시도해야 조건을 확인하고 대상 큐가 실제로 존재해야 이동하며 이때 본문, 메시지 ID, 전송 시각, 사용자 메시지 속성은 유지하지만 FIFO 관련 필드는 복사하지 않는다. 이 처리는 [`ReceiveMessage`의 DLQ 분기](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L472-L514)에 있다.

반면 `StartMessageMoveTask`는 DLQ에서 메시지를 꺼내 목적지로 옮기는 명시적 재처리로 여기서 `SourceArn`은 실패 메시지가 쌓인 **DLQ의 ARN**을 뜻한다. 다른 큐가 `RedrivePolicy`로 참조하는 큐여야 시작할 수 있다.

`DestinationArn`을 생략하면 DLQ를 참조하는 큐가 하나일 때 그 큐로 돌려보내지만 여러 큐가 같은 DLQ를 공유하면 메시지별 출처를 기록하지 않아 목적지를 결정할 수 없으므로 `InvalidParameterValue`로 거절한다. 이 경우에는 목적지 ARN을 직접 지정해야 한다. 목적지를 정하는 코드는 [`StartMessageMoveTask`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L727-L768)에, 여러 원본 큐를 다루는 경우는 [저장소 테스트](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L251-L279)에 있다.

## 재처리 작업의 실행 방식

재처리 API는 [커밋 `b16c632`](https://github.com/skyoo2003/devcloud/commit/b16c632fd1234f1424e01b2f8e9d3515f034aceb)에서 추가됐으며 시작 호출 안에서 메시지를 모두 옮기고 `COMPLETED` 작업 기록까지 남기므로 호출이 끝난 뒤 `RUNNING` 상태를 관찰할 수 없다.

| 항목 | 기준 커밋의 실제 동작 |
|---|---|
| 이동 대상 | 삭제되지 않았고 현재 보이는 DLQ 메시지 |
| 수신 중인 메시지 | DLQ에 남겨 현재 핸들을 유지 |
| 이동 후 상태 | 핸들 갱신, 가시성 초기화, 수신 횟수 0 |
| 메시지 ID·전송 시각 | 재처리 이동에서 유지 |
| `MaxNumberOfMessagesPerSecond` | 기록하고 반환하지만 속도를 제한하지 않음 |
| 작업 보관 | 소스 ARN별 최신 10개 |
| `ListMessageMoveTasks` | 최신순, 기본 1개, 양수 상한 10개 |
| `CancelMessageMoveTask` | 이미 완료됐으므로 `ResourceNotFoundException` |

AWS의 [DLQ 재처리 문서](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html)에서는 재처리한 메시지에 새 메시지 ID와 enqueueTime을 부여하고 보존 기간도 다시 시작한다고 설명한다. 이 구현은 메시지 ID와 전송 시각을 유지하므로 재처리 전후의 ID를 비교하는 테스트에서는 그 차이를 고려해야 한다.

수신 중인 메시지는 DLQ를 읽고 있는 소비자의 핸들을 무효화하지 않도록 남긴다. 저장소 전체 잠금은 큐 조회와 작업 기록 갱신에 사용하고 메시지를 옮기는 동안에는 잡지 않는다. 메시지 이동에서는 소스와 목적지 큐를 차례로 잠가 서로 다른 두 큐의 잠금을 동시에 잡지 않으므로 수신 중의 DLQ 이동 경로와 잠금 순서가 엇갈리는 일을 피할 수 있다. 자세한 구현은 [이동과 작업 기록 코드](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L770-L895)에서 볼 수 있다.

작업 기록은 시각이 아니라 단조 증가하는 순번으로 정렬해, 같은 밀리초에 여러 작업이 끝나도 최신 작업이 남도록 했다. 기록은 소스별로 제한되지만 소스 ARN 전체에 대한 전역 상한은 없으며, 이 경계는 [작업 기록 테스트](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L281-L326)에서 확인한다.

JSON과 기존 Query 프로토콜 모두 재처리 핸들러로 연결되며 같은 저장소를 사용하므로 프로토콜이 달라도 동기 완료라는 제한은 같다. Query 경로에는 별도의 [회귀 테스트](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/provider_test.go#L469-L535)가 있다.

## FIFO 중복 제거가 보장하는 범위

FIFO 큐는 `.fifo` 이름이나 생성 속성 `FifoQueue=true`로 판별하며 전송 시 명시적인 `MessageDeduplicationId`가 있으면 큐별 캐시에 기록한다. 5분 안에 같은 ID가 들어오면 성공을 반환하면서 메시지를 추가하지 않는다.

`ContentBasedDeduplication=true`이고 명시적 ID가 없으면 사용자 메시지 속성은 해시에 포함하지 않고 본문의 SHA-256을 캐시 키로 사용한다. 중복 전송 응답에는 새 무작위 메시지 ID를 반환하므로 응답 ID가 다르다는 이유로 두 메시지가 저장됐다고 판단해서는 안 된다. 구현은 [`SendMessageFull`](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store.go#L264-L318)에 있다.

다만 `MessageGroupId`를 저장해도 수신은 배열에서 보이는 메시지를 순서대로 찾는다. 같은 그룹의 앞 메시지가 수신 중이어도 뒤 메시지를 막지 않으므로 그룹별 처리 직렬화는 지원 범위에 들어 있지 않다. 필수 그룹 ID 검증도 없고 내부 순번을 SDK의 전송·수신 응답에 노출하지도 않는다. [FIFO 저장소 테스트](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/sqs/store_test.go#L353-L395)도 명시적 ID와 본문 기반의 중복 제거까지만 확인한다.

## 로컬 테스트에서 믿을 수 있는 것

이 구현으로 소비자가 메시지를 받은 뒤 삭제하는 흐름, 가시성을 0으로 바꿔 재수신하는 흐름, 수신 횟수를 넘겨 DLQ로 보낸 뒤 재처리하는 흐름을 확인할 수 있다. 하지만 처리 시간이나 내구성까지 검증하려면 다음 제한을 고려해야 한다.

- `WaitTimeSeconds`를 적용하지 않아 롱 폴링 요청도 즉시 반환한다.
- 보존 기간 속성이 있어도 메시지를 시간에 따라 만료시키지 않는다.
- 큐 수준 지연과 가시성 속성은 전송·수신 동작에 적용하지 않는다.
- `AddPermission`과 `RemovePermission`은 성공 응답만 하며 접근 권한을 검사하지 않는다.
- 큐, 메시지, 중복 제거 캐시, 재처리 작업은 메모리에만 존재해 서버 재시작 시 사라진다.

이 제한은 [SQS 서비스 문서](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/docs/services/sqs.md#known-limitations)에도 적어 두었다. 오퍼레이션이 모두 응답한다고 해서 세부 동작까지 AWS와 같지는 않으므로, 필요한 동작이 구현돼 있는지는 따로 확인해야 한다.

## 정리

메시지 배열에 가시성 시각과 수신 핸들, 수신 횟수를 더해 소비자의 성공과 실패를 로컬에서 다룰 수 있도록 했고, 위 예제처럼 이 수명 주기를 SDK로 그대로 재현할 수 있다. 다만 롱 폴링, FIFO 그룹 순서, 영속성까지 확인해야 하는 테스트라면 아직은 다른 환경을 함께 쓰는 편이 좋겠다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
