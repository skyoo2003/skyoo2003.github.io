---
title: "Interpreting DynamoDB Expressions: From Tokenization to Conditional Writes"
description: "How DevCloud evaluates DynamoDB filter and condition expressions itself: tokenizing, name and value substitution, recursive descent parsing, and type-aware comparison."
date: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, dynamodb, parser]
---

The earlier article on [local AWS emulation and boto3 compatibility](/en/posts/2026/04/19/local-aws-emulator-boto3-compatibility/) followed an SDK request as it reached a service. For DynamoDB, correctly deserializing the request is only part of the work. The strings inside `FilterExpression` and `ConditionExpression` still need to execute.

`#age >= :min AND attribute_not_exists(deletedAt)` is a small language. It combines name and value substitution, typed comparison, and logical precedence. A filter discards an item when the result is false; a write condition turns that same result into an error.

DevCloud evaluates these strings directly with a small interpreter in [expression.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/expression.go). It does not implement the full DynamoDB expression grammar, only the conditions local tests commonly use. This post looks at how the interpreter tokenizes and evaluates a string, and how the result is wired into the read and write APIs.

This post is based on [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c) on main after v1.2.0.

## Splitting Characters into Tokens

The tokenizer stores the input as `[]rune` and advances a position through it. After skipping whitespace with `unicode.IsSpace`, it recognizes identifiers, value references, name references, comparison operators, parentheses, and commas. It appends an EOF token at the end.

Consider this expression:

```text
#age >= :min AND attribute_not_exists(deletedAt)
```

Its main tokens have the following roles:

| Input | Token kind | Role |
| --- | --- | --- |
| `#age` | `tokNameRef` | Key in the name substitution map |
| `>=` | `tokOp` | Comparison operator |
| `:min` | `tokValue` | Key in the value substitution map |
| `AND` | `tokIdent` | Interpreted as a logical keyword by the parser |
| `attribute_not_exists` | `tokIdent` | Interpreted as a function by the parser |
| `(`, `)` | Parenthesis tokens | Function arguments or expression grouping |

There are no dedicated keyword tokens. `AND`, `OR`, attribute names, and function names are all identifiers. The parser identifies keywords at the appropriate position using `strings.ToUpper`. The tokenizer recognizes the two-character operators `<>`, `<=`, and `>=` as individual tokens.

Tokenization does not guarantee syntax validation. An unknown character becomes a one-character identifier, and the evaluation API has no separate syntax-error return value. Processing valid requests and rejecting invalid ones therefore require separate scrutiny.

## Name Substitution and Value Substitution Are Different

In this request fragment, `#age` refers to an attribute name, while `:min` refers to a typed value:

```json
{
  "FilterExpression": "#age >= :min",
  "ExpressionAttributeNames": {"#age": "age"},
  "ExpressionAttributeValues": {":min": {"N": "20"}}
}
```

`resolveAttrName` looks up name references in `nameMap`. `resolveValueTok` looks up value references in `valMap` and returns a `*AttributeValue`. Values come from a separate map instead of being inserted into the expression string, so spaces or operator characters inside string values are never tokenized again.

AWS requires name aliases for attributes that collide with reserved words or contain certain special characters. Its [expression attribute names documentation](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ExpressionAttributeNames.html) explains those rules. DevCloud implements alias substitution, but this evaluator does not validate the complete reserved-word list.

Missing references also deserve attention. If the name map has no matching key, the resolver returns the original `#age` string. If the value map has no matching key, the resolver returns `nil`. A faulty substitution map therefore does not necessarily produce a `ValidationException`.

## Expressing Precedence with Recursive Descent

The parser does not build an AST first. An `exprParser` holds the token position and current item, computing a `bool` while parsing. The function call hierarchy establishes logical precedence:

```text
parseExpr       OR
  └─ parseAnd   AND
       └─ parseNot   NOT
            └─ parsePrimary
                 ├─ parseExpr inside parentheses
                 ├─ function call
                 └─ comparison / BETWEEN / IN
```

This structure reads `A OR B AND C` as `A OR (B AND C)`. With `(A OR B) AND C`, `parsePrimary` recursively evaluates the expression inside the parentheses. `NOT` negates the primary expression below it. The ordering of these logical operations follows the direction described in [AWS's condition precedence rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html).

The `AND` in `BETWEEN :lo AND :hi` belongs to the range syntax. `parseComparison` consumes the lower bound, `AND`, and upper bound before the outer `parseAnd` can see them. Even in a small parser, a token's meaning depends on its grammatical position.

Another detail is consumption of the right-hand expression. The code executes `right := p.parseAnd()` or `right := p.parseNot()` before computing `left || right` or `left && right`. It parses the right-hand tokens even when the left-hand result already determines the outcome. This keeps the token position moving in an implementation that combines parsing and evaluation.

The grammar has limits. `parseNot` does not recursively call `parseNot` after `NOT`, so repeated `NOT` operators do not have a general recursive rule. The evaluator also does not verify EOF after evaluation, meaning it does not strictly reject trailing tokens.

## Comparisons That Keep AttributeValue Types

An item is a `map[string]*AttributeValue`. The [type definitions in store.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/store.go) represent strings `S`, numeric strings `N`, binary `B`, booleans, NULL, lists, maps, and sets. The expression evaluator implements comparisons for a subset of them.

`compareAttr` converts two `N` values to numbers, compares two `S` values using Go string comparison, and compares two `BOOL` values with `false` ordered before `true`. It produces `-1`, `0`, or `1`, which `applyOp` maps to the six comparison operators. `IN` checks whether comparison with a candidate returns `0`; `BETWEEN` performs inclusive comparisons against both bounds.

Keeping numbers in string form does not automatically preserve their precision during evaluation. This implementation uses `strconv.ParseFloat(..., 64)`. Both `9007199254740992` and `9007199254740993` convert to the same `float64` value, so this evaluator cannot distinguish them in an equality comparison. AWS supports up to 38 digits of numeric precision, as documented in its [data type reference](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.NamingRulesDataTypes.html).

Different types and unsupported comparisons introduce another issue. `compareAttr` returns `-1` for these cases rather than a distinct incomparable state. Operators such as `<` and `<>` can then evaluate to true. A missing right-hand value has the same problem. Exact decimal comparison and explicit type-error handling remain improvements to make.

## Function Support

Looking at each branch gives a more precise picture of function support:

| Function | Behavior implemented at this commit |
| --- | --- |
| `attribute_exists`, `attribute_not_exists` | Check key membership in the top-level item map |
| `begins_with` | Apply `strings.HasPrefix` to `S` values |
| `contains` | Search substrings and elements of `SS` or `NS` |
| `size` | Compute a numeric size on the left side of a comparison |

`contains` has no list or binary-set branch. Number-set membership compares the stored strings directly, so it does not normalize `"1"` and `"1.0"` to the same number. There is also no function branch for `attribute_type`.

Function names are matched through `strings.ToUpper`, making them case-insensitive here. [AWS function names are case-sensitive](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html), so tests using uppercase function names can produce different results.

`sizeOf` applies Go's `len` to strings and binary data, and returns element counts for `SS`, `NS`, lists, and maps. It also has a branch returning the length of an `N` value's numeric string, while lacking a `BS` branch. That differs from the valid types described by AWS. The special handling of a `size(path)` result also lives in the ordinary comparison-operator branch; `BETWEEN` and `IN` look up the original attribute instead. These differences matter when reading the [AWS function rules](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.OperatorsAndFunctions.html).

Nested document paths are outside the implemented scope. Identifiers can contain dots, but the actual lookup ends at `p.item[lhsPath]`. `profile.age` looks for that entire string as a top-level key instead of traversing a nested map. There is no path evaluator for `#profile.#age` or list indexes yet either.

## Connecting One Evaluation Result to Different APIs

In [provider.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/provider.go), expressions run around store operations. `Query` and `Scan` retrieve items, filter them with `EvaluateFilterExpression`, and finally apply `ApplyProjectionExpression`. This ordering preserves attributes needed by the filter until filtering finishes.

Projection does not reuse the condition parser. It splits the expression on commas, trims each name, resolves aliases, and copies matching top-level attributes into a new map. It does not implement projections that return selected nested attributes.

The `Query` handler does not run `KeyConditionExpression` through the general condition parser either. `extractPartitionKeyValue` splits the string on whitespace, finds the first value placeholder, and uses that value to query the store. Support for `BETWEEN` in the filter parser therefore does not establish equivalent support for Query sort-key conditions. This handler also lacks pagination inputs and a next-page key.

For writes, `EvaluateConditionExpression` calls the same boolean evaluator. A false result becomes an error containing `ConditionalCheckFailedException`. The `PutItem` handler reads the existing item, evaluates against an empty item if none exists, and calls the store's `PutItem` only after the condition passes. A failure reaches the client as HTTP 400 with a JSON error code.

`UpdateItem` and `DeleteItem` also check conditions, but handle missing items differently. Update constructs an item containing the key attributes before checking the condition. Delete immediately fails if the item is missing and a condition is present. This difference affects tests involving existence conditions.

The update itself is handled by `applyUpdateExpression` and its clause functions inside the provider, separately from `expression.go`. It separates `SET`, `REMOVE`, `ADD`, and `DELETE` clauses. The condition parser's grammar coverage cannot be assumed to apply to update expressions.

## Checking Both Failure and Stored State with boto3

This example assumes DevCloud is running at `http://localhost:4747` and the table name is unused. A low-level boto3 client exposes the `AttributeValue` representation directly:

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

Running it against DevCloud built from that commit prints the following.

```text
ConditionalCheckFailedException
1 [{'age': {'N': '25'}, 'pk': {'S': 'user-1'}}]
```

When the condition is false, the handler returns before writing to the store, so the example can check both the error code and that the previous value is still there. Reading the existing item and writing, however, are separate store calls that each take their own lock. If two requests with `attribute_not_exists` on the same key arrive at the same time, both can pass the condition, so do not expect the check and the write to be atomic as they are on AWS.

## What the Current Tests Cover

[expression_test.go](https://github.com/skyoo2003/devcloud/blob/734b83995a3f750f0db827ec9299bc8ed81a530c/internal/services/dynamodb/expression_test.go) covers basic comparisons, `AND` and `OR`, `NOT`, `BETWEEN`, `IN`, functions, and name substitution. Provider tests check the item count after filtering, HTTP 400 and the error type for a conditional Put, and projection results from GetItem. Separate tests cover Remove, Add, and combined Set and Remove update clauses.

That list is not a complete compatibility specification. Numeric precision, mismatched types, missing references, nested paths, and malformed syntax need additional checks. Reading the item again after a conditional failure, as in the boto3 example, examines stored state that a test of the error response alone would miss.

If I improve this, the first step would be separating syntax errors from evaluation results and checking that every token was consumed. Explicit incomparable states, exact decimal comparison, and nested-path access would come after that.

## Wrapping Up

This post followed how DevCloud splits a DynamoDB expression into tokens, evaluates it, and connects the result to read filtering and write failures. The SDK example checks both the error code and the stored result. When writing local tests, it is worth checking not only the supported syntax but also where DevCloud still behaves differently from AWS.

The full source code is available at [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud).
