---
layout: post
title:  Java8 Stream API
date:   2016-11-18 19:17:09
categories: [all, java]
permalink: /post/:year/:month/:day/:title
published: true
---

## Overview

Java8에서 소개한 함수형 인터페이스 및 람다식을 효과적으로 활용할 수 있도록 스트림 API가 발표되었다. 먼저, 스트림 API가 무엇인지 살펴본다.

스트림 API를 사용함으로써 취할 수 있는 이점은 무엇이 있을지도 알아보고, 유의해야할 점과 잘못 사용했을 때 치루어야할 대가는 어떤 것이 있을지 알아본다.

## What is Stream API

```java
// AS-IS
public int sum(List<Integer> list) {
  int sum = 0;
  for (Integer item : list) {
    if (item > 5) {
      sum += item;
    }
  }
  return sum;
}

// TO-BE
public int sum(List<Integer> list) {
    return list.stream()
      .filter(item -> item > 5)
      .mapToInt(item -> item)
      .sum();
}
```

## References
