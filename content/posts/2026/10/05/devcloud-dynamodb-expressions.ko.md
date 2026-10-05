---
title: "DynamoDB 표현식을 직접 해석하기: 토큰화부터 조건부 쓰기까지"
description: "DevCloud가 DynamoDB FilterExpression과 ConditionExpression을 토큰화, 이름·값 치환, 재귀 하강 파싱, 타입 보존 비교로 평가하는 방법을 설명한다."
date: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, dynamodb, parser]
---

[로컬 AWS 에뮬레이터와 boto3 호환성](/ko/posts/2026/04/19/local-aws-emulator-boto3-compatibility/)을 다룬 글에서는 SDK 요청이 서비스에 도달하는 과정을 살펴봤다. DynamoDB에서는 요청을 올바르게 역직렬화한 뒤에도 `FilterExpression`과 `ConditionExpression`에 들어 있는 문자열을 실행해야 하므로 일이 남는다.

예를 들어 `#age >= :min AND attribute_not_exists(deletedAt)`에는 이름과 값의 치환, 타입을 가진 비교, 논리 연산의 우선순위가 함께 들어 있다. 이런 작은 언어를 해석해 평가 결과가 거짓이면 필터에서는 해당 항목을 제외하고 쓰기 조건에서는 오류로 바꿔야 한다.

DevCloud는 이 문자열을 [expression.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/expression.go)의 작은 해석기로 직접 평가한다. DynamoDB 표현식 문법 전체를 구현한 것은 아니고, 로컬 테스트에서 자주 쓰는 조건을 처리하는 정도다. 이번에는 이 해석기가 문자열을 토큰으로 나누고 평가해 읽기·쓰기 API에 연결하는 과정을 살펴보려 한다.

참고로 이 글은 v1.2.0 이후 main의 [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c)를 기준으로 설명한다.

## 먼저 문자를 토큰으로 나눈다

토크나이저는 입력을 `[]rune`으로 보관한 채 위치를 하나씩 이동하면서 `unicode.IsSpace`로 공백을 건너뛰고 식별자, 값 참조, 이름 참조, 비교 연산자, 괄호, 쉼표를 구분한다. 입력을 모두 읽으면 마지막에 EOF 토큰을 붙인다.

예를 들어 다음 식을 읽는다고 하자.

```text
#age >= :min AND attribute_not_exists(deletedAt)
```

주요 토큰은 다음처럼 나뉜다.

| 입력 | 토큰 종류 | 역할 |
| --- | --- | --- |
| `#age` | `tokNameRef` | 이름 치환 맵의 키 |
| `>=` | `tokOp` | 비교 연산자 |
| `:min` | `tokValue` | 값 치환 맵의 키 |
| `AND` | `tokIdent` | 파서에서 논리 키워드로 해석 |
| `attribute_not_exists` | `tokIdent` | 파서에서 함수로 해석 |
| `(`, `)` | 괄호 토큰 | 함수 인자 또는 식의 묶음 |

키워드 전용 토큰은 만들지 않는다. `AND`, `OR`, 속성 이름, 함수 이름을 모두 식별자로 읽은 다음, 파서가 필요한 위치에서 `strings.ToUpper`로 키워드를 판별하는 방식이다. 두 글자 연산자인 `<>`, `<=`, `>=`는 토크나이저에서 하나의 토큰으로 만든다.

다만 알 수 없는 문자도 한 글자 식별자로 반환하고 이후 평가 API에 별도의 구문 오류 반환값이 없으므로 토큰화만으로 문법 검증까지 끝나지는 않는다. 유효한 요청이 처리되는지 확인했다면 잘못된 요청을 거절하는지도 따로 확인해야 한다.

## 이름 치환과 값 치환은 다른 작업이다

다음 요청 조각에서 `#age`는 속성 이름을, `:min`은 타입을 가진 값을 가리킨다.

```json
{
  "FilterExpression": "#age >= :min",
  "ExpressionAttributeNames": {"#age": "age"},
  "ExpressionAttributeValues": {":min": {"N": "20"}}
}
```

`resolveAttrName`은 이름 참조를 `nameMap`에서 찾고 `resolveValueTok`은 값 참조를 `valMap`에서 찾아 `*AttributeValue`를 반환한다. 이렇게 값을 식 문자열에 삽입하는 대신 별도 맵에서 가져오면 문자열 값에 공백이나 연산자 문자가 있어도 다시 토큰화하지 않는다.

AWS에서 예약어 또는 특수 문자가 있는 속성 이름을 표현식에 사용하려면 이름 별칭이 필요하며 구체적인 규칙은 [AWS의 이름 별칭 문서](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ExpressionAttributeNames.html)에 설명되어 있다. DevCloud도 별칭 치환을 구현하지만 예약어 목록 전체를 검증하는 일까지 이 평가기의 역할에 포함되지는 않는다.

누락된 참조는 어떻게 처리하는지도 확인해야 한다. 이름 맵에 키가 없으면 원래 `#age` 문자열을 그대로 돌려주고 값 맵에 키가 없으면 `nil`을 반환하므로, 치환 맵 오류가 언제나 `ValidationException`으로 보고된다고 가정할 수 없다.

## 재귀 하강으로 우선순위를 표현한다

파서는 AST를 먼저 만드는 대신 토큰 위치와 현재 항목을 가진 `exprParser`로 파싱하면서 바로 `bool`을 계산한다. 이때 논리 연산의 우선순위는 함수의 호출 순서로 정해진다.

```text
parseExpr       OR
  └─ parseAnd   AND
       └─ parseNot   NOT
            └─ parsePrimary
                 ├─ 괄호 안의 parseExpr
                 ├─ 함수 호출
                 └─ 비교 / BETWEEN / IN
```

이 구조에서는 `A OR B AND C`를 `A OR (B AND C)`로 읽되, `(A OR B) AND C`처럼 괄호를 넣으면 `parsePrimary`가 안쪽 식을 재귀적으로 평가한다. 여기에 `NOT`이 오면 그 아래의 기본식을 뒤집는다. 논리 연산의 순서는 [AWS의 조건식 우선순위](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html)와 같은 방향으로 구성되어 있다.

`BETWEEN :lo AND :hi`에서 `AND`는 범위 문법의 일부이므로 논리 연산자로 읽지 않는다. `parseComparison`이 하한, `AND`, 상한을 먼저 소비하면 바깥 `parseAnd`는 그 토큰을 다시 해석하지 않는다. 작은 파서에서도 현재 문법 위치에 따라 토큰의 의미가 달라지는 사례다.

파싱과 평가를 함께 수행할 때는 토큰 위치도 유지해야 한다. 코드에서는 `right := p.parseAnd()` 또는 `right := p.parseNot()`를 실행한 뒤에야 `left || right`, `left && right`를 계산하므로 왼쪽 결과가 이미 정해졌더라도 오른쪽 토큰은 파싱한다.

문법의 경계도 있다. `parseNot`은 `NOT` 뒤에 다시 `parseNot`을 호출하지 않기 때문에 연속된 `NOT`을 일반적인 재귀 규칙으로 지원하지 않으며 평가가 끝난 뒤에도 EOF인지 확인하지 않아 남은 토큰을 엄격하게 거절하지 않는다.

## AttributeValue의 타입을 보존한 비교

항목을 나타내는 타입은 `map[string]*AttributeValue`이며 [store.go의 타입 정의](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/store.go)는 문자열 `S`, 숫자 문자열 `N`, 바이너리 `B`, 불리언, NULL, 리스트, 맵, 집합을 담는다. 이 가운데 표현식 평가기에 비교 규칙이 구현된 타입은 일부다.

`compareAttr`은 양쪽이 `N`이면 숫자로 변환하고 양쪽이 `S`이면 Go 문자열 비교를 사용하며 양쪽이 `BOOL`일 때는 같은 값인지 비교하면서 `false`를 `true`보다 작게 취급한다. 이렇게 얻은 결과 `-1`, `0`, `1`에 `applyOp`을 적용하면 여섯 가지 비교 연산자를 처리할 수 있다. `IN`에서는 후보와의 비교 결과가 `0`인지 확인하고 `BETWEEN`에서는 양 끝을 포함하는 비교를 수행한다.

숫자는 문자열로 보관해도 비교할 때는 정밀도가 달라진다. 여기서는 `strconv.ParseFloat(..., 64)`를 사용하기 때문에 `9007199254740992`와 `9007199254740993`이 `float64`로 변환되면 같은 값이 되고 이 평가기의 동등 비교에서도 구별되지 않는다. AWS 숫자의 최대 38자리 정밀도는 [공식 데이터 타입 문서](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html)에서 확인할 수 있다.

타입이 다르거나 비교가 구현되지 않은 경우에는 `compareAttr`이 비교 불가 상태를 따로 구분하지 않고 `-1`을 반환한다. 이 결과를 `<`와 `<>` 같은 연산에 적용하면 참이 될 수 있으며 누락된 우변 값도 같은 문제를 만든다. 정밀한 십진 비교와 타입 오류 처리는 추가로 구현할 필요가 있다.

## 함수별 지원 범위

각 함수에서 처리하는 타입과 경로를 정리하면 다음과 같다.

| 함수 | 이 커밋에서 구현한 동작 |
| --- | --- |
| `attribute_exists`, `attribute_not_exists` | 최상위 항목 맵에 키가 있는지 확인 |
| `begins_with` | `S` 값에 `strings.HasPrefix` 적용 |
| `contains` | 문자열 부분 검색, `SS`와 `NS`의 원소 검색 |
| `size` | 비교식의 왼쪽에서 크기를 숫자로 계산 |

`contains`에는 리스트와 바이너리 집합 검색이 없고 숫자 집합의 원소도 문자열 그대로 비교하므로 `"1"`과 `"1.0"`을 같은 숫자로 정규화하지 않는다. 함수 분기에는 `attribute_type`도 없다.

함수 이름도 `strings.ToUpper`로 판별해 대소문자를 구분하지 않는다. 반면 [AWS의 함수 이름은 대소문자를 구분한다](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html)고 명시되어 있으므로 함수 이름을 대문자로 바꾼 테스트는 서로 다른 결과가 나올 수 있다.

`sizeOf`는 문자열과 바이너리에 Go의 `len`을 적용하고 `SS`, `NS`, 리스트, 맵에는 원소 수를 반환한다. 숫자 `N`에는 숫자 문자열의 길이를 반환하는 별도 분기가 있지만 `BS` 분기는 없으므로, AWS가 설명하는 `size`의 유효 타입과 완전히 일치하지 않는다. 또한 `size(path)`의 결과를 사용하는 전용 처리는 일반 비교 연산자 분기에 있고 `BETWEEN`과 `IN` 분기에서는 원래 속성 값을 조회한다. [함수별 AWS 규칙](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html)을 읽을 때 이 차이를 함께 봐야 한다.

중첩 경로도 지원 범위 밖이다. 식별자에 점을 포함시킬 수 있어도 실제 조회는 `p.item[lhsPath]`로 끝나기 때문에, `profile.age`를 읽으면 중첩 맵을 순회하지 않고 그 문자열 전체를 최상위 키로 조회한다. `#profile.#age`나 리스트 인덱스를 해석하는 경로 평가기도 아직 없다.

## 같은 평가 결과를 서로 다른 API에 연결한다

[provider.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/provider.go)에서 표현식은 저장소 호출 앞뒤에 붙는다. `Query`와 `Scan`은 항목을 조회한 뒤 `EvaluateFilterExpression`으로 걸러내고 마지막에 `ApplyProjectionExpression`을 적용한다. 필터가 필요로 하는 속성을 프로젝션으로 먼저 지우지 않는 순서다.

프로젝션은 조건 파서를 재사용하는 대신 쉼표로 나눈 이름을 다듬고 별칭을 해석한 뒤 해당 최상위 속성만 새 맵에 담는다. 따라서 이 구현 역시 중첩 속성을 잘라 반환하는 프로젝션은 처리하지 않는다.

`Query`의 `KeyConditionExpression`도 일반 조건 파서로 실행하는 대신 `extractPartitionKeyValue`가 공백으로 나눈 문자열에서 첫 값 참조를 찾아 그 값으로 저장소를 조회한다. 이 때문에 필터 파서의 `BETWEEN` 지원을 근거로 Query의 정렬 키 조건도 같은 범위로 지원한다고 볼 수는 없다. 이 핸들러에는 페이지네이션 입력과 다음 페이지 키도 구현되어 있지 않다.

쓰기에서는 `EvaluateConditionExpression`이 같은 불리언 평가기를 호출하여 결과가 거짓일 때 `ConditionalCheckFailedException` 문자열을 가진 오류를 반환한다. `PutItem` 핸들러는 기존 항목을 조회하되 없으면 빈 항목으로 조건을 평가하고 조건을 통과한 경우에만 저장소의 `PutItem`을 호출한다. 실패한 요청은 HTTP 400과 JSON 오류 코드로 클라이언트에 전달한다.

`UpdateItem`과 `DeleteItem`도 조건 검사를 수행하지만 없는 항목의 처리는 같지 않다. Update는 키 속성만 있는 항목을 만든 뒤 조건을 확인하는 반면, Delete는 항목이 없고 조건이 있으면 바로 실패하므로 존재 여부 조건을 시험할 때 이 차이가 결과에 영향을 준다.

Update의 변경 자체는 `expression.go`가 아니라 provider 내부의 `applyUpdateExpression`과 절별 함수가 처리한다. `SET`, `REMOVE`, `ADD`, `DELETE`를 분리하는 구현이며 조건 파서의 문법 지원 범위를 갱신식에도 그대로 적용할 수는 없다.

## boto3에서 실패와 저장 결과를 함께 확인한다

다음 예시는 DevCloud가 `http://localhost:4747`에서 실행 중이고 같은 이름의 테이블이 없는 상태를 전제로 하며 저수준 boto3 클라이언트를 사용해 `AttributeValue` 표현을 그대로 보여준다.

```python
import boto3
from botocore.exceptions import ClientError

ddb = boto3.client(
    "dynamodb",
    endpoint_url="http://localhost:4747",
    region_name="us-east-1",
    aws_access_key_id="test",
    aws_secret_access_key="test",
)
table = "expression-demo"
ddb.create_table(
    TableName=table,
    KeySchema=[{"AttributeName": "pk", "KeyType": "HASH"}],
    AttributeDefinitions=[{"AttributeName": "pk", "AttributeType": "S"}],
    BillingMode="PAY_PER_REQUEST",
)
ddb.put_item(
    TableName=table,
    Item={"pk": {"S": "user-1"}, "age": {"N": "25"}},
)

try:
    ddb.put_item(
        TableName=table,
        Item={"pk": {"S": "user-1"}, "age": {"N": "99"}},
        ConditionExpression="attribute_not_exists(#pk)",
        ExpressionAttributeNames={"#pk": "pk"},
    )
except ClientError as exc:
    code = exc.response["Error"]["Code"]
    print(code)
    assert code == "ConditionalCheckFailedException"
else:
    raise AssertionError("Expected the conditional write to fail")

item = ddb.get_item(TableName=table, Key={"pk": {"S": "user-1"}})["Item"]
assert item["age"] == {"N": "25"}

result = ddb.scan(
    TableName=table,
    FilterExpression="#age >= :min",
    ProjectionExpression="#pk, #age",
    ExpressionAttributeNames={"#pk": "pk", "#age": "age"},
    ExpressionAttributeValues={":min": {"N": "20"}},
)
print(result["Count"], result["Items"])
assert result["Count"] == 1
assert result["Items"] == [item]
ddb.delete_table(TableName=table)
```

기준 커밋으로 빌드한 DevCloud에서 실행하면 다음과 같이 출력된다.

```text
ConditionalCheckFailedException
1 [{'age': {'N': '25'}, 'pk': {'S': 'user-1'}}]
```

조건이 거짓이면 저장소에 쓰기 전에 반환하므로 오류 코드와 함께 기존 값이 그대로 남아 있는지도 확인할 수 있다. 다만 기존 항목 조회와 쓰기는 각각 따로 잠금을 잡는 별도의 저장소 호출이다. 같은 키에 `attribute_not_exists` 조건을 건 요청 두 개가 동시에 들어오면 둘 다 조건을 통과할 수 있으므로, AWS처럼 조건 검사와 쓰기가 원자적이라고 기대해서는 안 된다.

## 현재 테스트가 증명하는 범위

[expression_test.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/expression_test.go)는 기본 비교, `AND`와 `OR`, `NOT`, `BETWEEN`, `IN`, 함수, 이름 치환을 확인한다. provider 테스트는 필터 뒤의 항목 수, 조건부 Put의 HTTP 400과 오류 타입, GetItem의 프로젝션 결과를 확인한다. 갱신식의 Remove와 Add, Set과 Remove 조합도 별도로 다룬다.

다만 이 테스트를 통과해도 숫자 정밀도, 타입 불일치, 누락된 참조, 중첩 경로, 잘못된 문법까지 검증한 것은 아니므로 각각 별도의 확인이 필요하다. 위 boto3 예시처럼 조건부 실패 뒤에 다시 읽어서 변경이 없음을 확인하면 실패 응답만 검사할 때 놓치는 저장 결과까지 살펴볼 수 있다.

앞으로 보완한다면 구문 오류와 평가 결과를 분리하고 모든 토큰을 소비했는지 확인하는 것부터 손대야 할 것 같다. 그다음이 타입별 비교 불가 상태, 정확한 십진 비교, 중첩 경로 접근이다.

## 정리

이번에는 DynamoDB 표현식을 토큰으로 나누고 평가한 뒤 그 결과를 읽기 필터와 쓰기 실패로 연결하는 과정을 살펴봤다. SDK 예제에서는 오류 코드와 저장 결과를 함께 확인하도록 했다. 로컬 테스트를 작성할 때는 지원하는 문법뿐 아니라 AWS와 아직 다르게 동작하는 부분도 함께 확인하는 편이 좋겠다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
