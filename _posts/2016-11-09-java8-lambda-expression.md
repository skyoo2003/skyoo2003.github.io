---
layout: post
title:  Java8 Lambda Expression
date:   2016-11-09 18:02:24
categories: [all, java]
---

## Overview

2010년도에 '[Project Lambda](http://openjdk.java.net/projects/lambda/){:target="_blank"}' 라는 프로젝트로 진행되어 Java8 에 공식 릴리즈가 되었다. 객체지향적 프로그래밍 언어에 어떻게 함수형 프로그래밍을 구현할 수 있는지 알아보고자 한다.

## Functional Programming

함수형 언어부터 알아보자. 함수형 언어에서 함수(Function)를 [일급 객체](https://ko.wikipedia.org/wiki/%EC%9D%BC%EA%B8%89_%EA%B0%9D%EC%B2%B4){:target="_blank"}([First-Class Citizen](https://en.wikipedia.org/wiki/First-class_citizen){:target="_blank"}) 로 간주한다. 일급 객체를 정의하자면 아래와 같다.

```
1. 변수나 데이터 구조안에 담을 수 있다.
2. 파라미터로 전달 할 수 있다.
3. 반환값(return value)으로 사용할 수 있다.
4. 할당에 사용된 이름과 관계없이 고유한 구별이 가능하다.
```

자바에서는 어떨까? 객체는 파라미터로 전달이 가능하지만, 메소드는 불가능하다. 객체에 익명 클래스는 담을 수 있지만, 메소드를 담을 수는 없다. 메소드는 객체에 종속된 행위이기 때문이다.

때문에 Java8 에서 함수형 인터페이스라는 개념을 도입하였고, 파라미터에 전달할 때 람다식으로 표현하여 마치 함수를 전달하는 듯한 문법 체계가 가능해진 것이다.

'함수형 인터페이스'는 **단 하나의 메소드만이 선언된 인터페이스** 를 의미하고, 더 자세히 정의하자면 default 지시자를 붙이지 않은 메소드가 단 1개만 있어야 한다는 의미이다.

```java
public interface Functional1 {
  boolean accept();
}

public interface Functional2 {
  boolean accept();
  default boolean reject() { return !accept(); }
}

@FunctionalInterface
public interface Functional3 {
  boolean accept();
}

public interface NotFunctional {
  boolean accept();
  boolean reject();
}
```

Functional1, 2, 3는 모두 함수형 인터페이스를 만족한다. 특이한 점이 Functional3 인터페이스의 경우, @FunctionalInterface 어노테이션을 붙여주었는데, 이는 컴파일러에게 명시적으로 함수형 인터페이스임을 알려주는 역할을 하고, 해당 인터페이스가 함수형 인터페이스 명세를 어기면 컴파일러 에러를 발생시켜 준다.

## Lambda Expression

자바에서는 함수형 인터페이스만 **람다식으로 표현할 수 있다** 는 점이 중요하고, 자바에서 기본적인 람다식 구조는 아래와 같다.

```java
(int a, int b) -> {return a + b} // 매개변수 -> 함수 로직 (+@ 리턴)
```

정리해보자면 아래와 같다.

* 단순한 람다 구문의 경우, 람다 구분에 중괄호가 없을 수도 있다.

* return 이 없을 수도 있다.

* 매개변수에는 타입을 명시하지 않아도 된다. (타입 추론)

* 람다식 문법을 컴파일러가 익명 클래스로 변환한다. 즉, 함수형 인터페이스를 컴파일러가 구현하도록 위임하는 형태라 볼 수 있다

```java
() -> {}                     // No parameters; result is void
() -> 42                     // No parameters, expression body
() -> null                   // No parameters, expression body
() -> { return 42; }         // No parameters, block body with return
() -> { System.gc(); }       // No parameters, void block body
() -> {
  if (true) { return 12; }
  else { return 11; }
}                          // Complex block body with returns
(int x) -> x+1             // Single declared-type parameter
(int x) -> { return x+1; } // Single declared-type parameter
(x) -> x+1                 // Single inferred-type parameter
x -> x+1                   // Parens optional for single inferred-type case
(String s) -> s.length()   // Single declared-type parameter
(Thread t) -> { t.start(); } // Single declared-type parameter
s -> s.length()              // Single inferred-type parameter
t -> { t.start(); }          // Single inferred-type parameter
(int x, int y) -> x+y      // Multiple declared-type parameters
(x,y) -> x+y               // Multiple inferred-type parameters
(final int x) -> x+1       // Modified declared-type parameter
(x, final y) -> x+y        // Illegal: can't modify inferred-type parameters
(x, int y) -> x+y          // Illegal: can't mix inferred and declared types
```

## Lambda Specification

위에서 자바의 함수형 프로그래밍과 람다 표현식에 대해서 자세하게 살펴보았고, 이번에는 람다의 구체적인 명세에 대해서 정리해보고자 한다.
람다식을 활용함에 있어 어떤 부분이 문법적인 제약이 있는지, 어떤 방법으로 활용될 수 있는지에 대해서 정리해보는 부분이라고 이해하면 좋다.

### Parameterized Behaviors

메소드에 사용할 데이터 혹은 변수와 행위를 같이 전달하게 하여 메소드의 행위 부분도 분리할 수 있을 것이다. 이를 통해 얻을 수 있는 장점은 아래 정도로 정리할 수 있을 것이다.

* 런타임에 행위를 전달 받아서 제어 흐름 수행 (cf. 전략 패턴)
* 메소드 단위의 추상화가 가능
* 함수형 언어의 고차 함수 (Higher-Order Function)

```java
public class Collections {
  ...
  public static <T> T max(Collection<? extends T> coll, Comparator<? super T> comp) {
    ...
  }
  ...
}

public class Fruit {
  public String name;
}

// AS-IS
Collections.max(fruits, new Comparator<Fruit> {
  @Override
  public int compare(Fruit o1, Fruit o2) {
      return o1.name.compareTo(o2.name);
  }
});

// TO-BE
Collections.max(fruits, (o1, o2) -> o1.name.compareTo(o2.name) ;
```

스프링 프레임워크에서 익명 클래스를 이용한 행위 파라미터를 적극적으로 활용해 '템플릿 콜백 패턴' 디자인패턴으로 이미 유용하게 사용되던 기법이었고, 람다식으로 간결하게 사용할 수 있게 된 것이다.

### Immutable Free Variables

자바에서 익명 클래스 + 자유 변수 포획으로 클로저를 가능하게 하였는데, 포획된 변수에는 명시적으로 final 지시자를 사용하도록 강제하였다. 람다식에서는 포획된 변수에 final 을 명시하지 않아도 되도록 변경되었지만 기존과 동일하게 포획된 변수는 변경할 수 없고, 변경하는 경우 컴파일 에러가 발생한다.

```java
int counter = 0 // Free Variable

new Thread(() -> System.out.println(counter)) // OK
new Thread(() -> System.out.println(counter++)) // Compile Error (Free variable is immutable!)
```

### Stateless Object

클래스의 메소드(행위)에서 멤버 변수(상태)를 자유롭게 제어할 수 있다. 즉, 객체가 메소드를 호출하면 입력(Input)+상태(Properties)로부터 출력(Output)이 결정되기 때문에 Side-Effect가 발생할 수 있다. 함수 단위의 배타적 수행이 보장되지 않기 때문에 병렬 처리와 멀티 스레드 환경에서 여러 단점에 노출될 가능성이 있다.

반면에 람다식으로 표현하게 되면, 오로지 입력(Input)과 출력(Output)에 종속되어 있기 때문에 Side-Effect 가 발생하지 않는 것을 최대한 보장할 수 있게 된 것이다. 후술할 스트림 API 에서는 함수형 인터페이스를 최대한 활용해 병렬(Parallel) 처리를 어떻게 효과적으로 할 수 있는지 알아볼 예정이다.

### Optional + Lambda

java.util.Optional 이라는 클래스는 값이 있거나 없는 경우를 표현하기 위한 클래스로 map, filter, flatMap 등의 고차 함수를 가지고 있다.
Optional의 고차 함수를 조합하여 간결하게 표현이 가능하며, 언제 발생할지 모르는 NullPointerException 의 두려움에 방어 로직으로부터 벗어날 수 있지 않을까 한다.

* 'If (obj != Null)' Null 체크로부터 해방

```java
// AS-IS
Member member = memberRepository.findById(1L);
Coord coord = null;
if (member != null) {
  if (member.getAddress() != null) {
    String zipCode = member.getAddress().getZipCode();
    if (zipCode != null) {
      coord = coordRepository.findByZipCode(zipCode)
    }
  }
}

// TO-BE
Optional<Member> member = memberRepository.findById(1L);
Coord coord = member.map(Member::getAddress)
    .map(address -> address.getZipCode())
    .map(zipCode -> coordRepository.findByZipCode(zipCode))
    .orElse(null)
```

* 비어 있는 객체 생성

```java
Optional<Member> member = Optional.empty();
```

* Null 허용하지 않는 객체 생성

```java
Optional<Member> member = Optional.of(memberRepository.findById(1L));
member.get() // NullPointerException !!!
```

* 값이 존재할 때, 특정 메소드 호출

```java
// AS-IS
Member member = memberRepository.findById(1L);
if (member != null) {
  System.out.println(member);
}

// TO-BE
Optional<Member> member = Optional.ofNullable(memberRepository.findById(1L));
member.ifPresent(System.out::println);
```

* 값 존재할 경우와 아닌 경우를 삼항 연산자로 표현하지 않아도 됨

```java
// AS-IS
Member member = memberRepository.findById(1L);
System.out.println(member != null ? member : new Member("Unknown"));

// TO-BE
Optional<Member> member = Optional.ofNullable(memberRepository.findById(1L));
member.orElse(new Member("Unknown")).ifPresent(System.out::println);
```

* 특정 조건을 만족하는 경우에만 특정 행위를 하고 싶을 경우

```java
// AS-IS
Member member = memberRepository.findById(1L);
if (member != null && member.getRating() != null && member.getRating() >= 4.0) {
  System.out.println(member);
}

// TO-BE
Optional<Member> member = Optional.ofNullable(memberRepository.findById(1L));
member.filter(m -> m.getRating() >= 4.0)
    .ifPresent(m -> System.out::println)
```

## References

[1] [자바8 람다식 소개](http://www.slideshare.net/madvirus/8-35205661){:target="_blank"}

[2] [Java 8 람다식 소개와 의미 고찰](http://www.slideshare.net/gyumee/java-8-lambda-35352385){:target="_blank"}

[3] [Java 8 Lambda Expression과 변경된 Interface의 모호함](http://www.xenomity.com/entry/Java-8-Lambda-Expression%EA%B3%BC-%EB%B3%80%EA%B2%BD%EB%90%9C-Interface%EC%9D%98-%EB%AA%A8%ED%98%B8%ED%95%A8){:target="_blank"}

[4] [Java8#01. 람다 표현식(Lambda Expression)](http://multifrontgarden.tistory.com/124){:target="_blank"}

[5] [자바 8 Optional](http://javaiyagi.tistory.com/443){:target="_blank"}
