---
layout: post
title:  Introduction to Java8
date:   2016-10-25 21:33:00
categories: [all, java]
---

## Overview
객체 지향적 언어로 알려져 있는 Java에 함수형 언어로서의 지원이 추가된 Java8에 대해서 간략하고 전체적인 부분을 정리.

## New Features

### Lambda Expression (a.k.a Anonymous Method)

자바의 람다 표현식의 근간은 '알론소 처치 (Alonzo Church)'가 1930년대에 람다 대수를 제안.  함수 정의, 함수 적용, 귀납적 함수를 추상화한 형식 체계! 자세한 사항은 [람다 대수 위키](https://ko.wikipedia.org/wiki/%EB%9E%8C%EB%8B%A4_%EB%8C%80%EC%88%98){:target="_blank"} 참조.

쉽게 이해하자면, 자바에서는 익명 메소드 생성 문법을 지원한다는 정도로 이해하면 좋을 듯 하다.

**Java7**

```java
new Thread(new Runnable() {
	@Override
	public void run() {
		System.out.println("Hello, World!");
	}
}).start();
```

**Java8**

```java
new Thread(() -> {
	System.out.println("Hello, World!");
}).start();
```
Java7의 경우, 쓰레드를 생성하고 익명 클래스를 구현하여 메소드를 오버라이딩하는 불필요한 코드가 많이 붙게 되는 것을 볼 수 있다.
Java8의 경우, 람다 식으로 세련되게 코드를 작성할 수 있고, 본래 구현하고자 하였던 코드에 더 집중할 수 있게 됩니다. 추가적으로, '함수형 인터페이스' 를 구현하는 경우, 어떤 메소드를 오버라이드 하였는지도 명시할 필요가 없다. 함수형 인터페이스는 추후에 자세히 설명하도록 하겠다.

**Java7**

```java
Collections.sort(theListOfMyClasses, new Comparator<MyClass>() {
    public int compare(MyClass a, MyClass b) {
        return b.getValue() - a.getValue();
    }
});
```

**Java8**

```java
theListOfMyClasses.sort((MyClass a, MyClass b) -> {
    return a.getValue() - b.getValue();
});

theListOfMyClasses.sort((a, b) -> a.getValue() - b.getValue());
```
람다 표현식에서 '타입 추론' 이 가능하여, 전달하는 파라미터의 타입을 명시하지 않아도 런타임에 추론이 가능해진다. 이로 인해, 불필요한 코드량을 줄일 수 있게 된다.

### Stream API

스트림 API는 람다 표현식의 효과적인 활용법으로, Collection 인터페이스를 다루는 새로운 매커니즘을 제공한다. 파이프라인/지연/병렬 처리 등이 동일 인터페이스로 제공되며, 함수형 프로그래밍이 가능해진다.

Referred to ['lambda-resort' Github](https://github.com/benelog/lambda-resort){:target="_blank"}

```java
List<Guest> guests = repository.findAll();
return guests.stream()
	.filter(g -> company.equals(g.getCompany()))
	.sorted(Comparator.comparing(Guest::getGrade))
	.map(Guest::getName)
	.collect(Collectors.toList());
```
컨테이너로부터 스트림을 생성하고, 특정 company와 동일한 guest 객체만 필터링한 뒤에, guest.grade 값을 오름차순으로 정렬한 뒤에 guest의 이름만 추출하여 다시 리스트로 만드는 로직이다.
기존의 for-each 문의로 작성하려고 하면, 코드량이 많아지고 복잡해질 수 있는 로직을 아주 깔끔하게 처리할 수 있게 되었다.

### Default Method

경직된 자바 인터페이스 체계에서는 인터페이스의 메소드 추가 시, 하위의 모든 구현체에 영향을 미치게 됨. 인터페이스를 상속한 Concrete/Abstract Class의 어디선가는 꼭 구현을 해야함.

다양한 우회 기법을 활용하였음.
- 헬퍼 클래스 활용 / 확장 인터페이스 추가 / 추상 클래스를 통한 확장 등...

```java
public interface Iterator<E> {
	...

	default void forEachRemaining(Consumer<? super E> action) {
      Objects.requireNonNull(action);
      while (hasNext())
          action.accept(next());
  }
}
```
forEachRemaining 메소드에 대한 구현이 상속 받은 클래스에서 구현을 강요하지 않음. 단, 오버라이딩을 통한 확장이 가능하도록 여지는 남겨놓았음.

상속을 통한 구현이 인터페이스 기본 메소드보다 우선! (Override method > Default method)

Diamond Problem 발생 가능!

```java
public interface Red {
	default void draw() { /* Some of code */ }
}
public interface Blue {
	default void draw() { /* Some of code */ }
}
public interface Green {
	default void draw() { /* Some of code */ }
}

public interface Pen extends Red, Blue, Green {
	/* 컴파일 오류 발생! ( Pen inherits unrelated defaults for the draw() from Red and Blue ) */
}
```

명시적으로 어떤 인터페이스의 기본 메소드를 사용할 것인지 기본 메소드를 정의하여 회피 가능

```java
public interface Pen extends Red, Blue, Green {
	default void draw() { Red.super.draw(); }
}
```

정적 메서드도 인터페이스에 포함 가능 / 별도 유틸리티 클래스로 분리할 필요 없음

```java
public interface Function<T, R> {
	R apply(T t);
	static Function<?, String> toStringFunction() {
		return value -> value.toString();
	}
	static <E> Function<E, E> identity() {
		return value -> value;
	}
	static <R> Function<?, R> constant(R constantValue) {
		return value -> constantValue;
	}
}
```

### Joda Time 방식의 새 날짜 API 변경 (JSR 310)

#### 기본 날짜 클래스 문제점

Java7 까지의 JDK에서 제공하던 날짜 관련 클래스들은 문제가 많았다. 결국은 유틸리티 라이브러리 (Joda Time) 의 등장으로 어느정도 해소 되었으나 공식적으로 자바 진영에서 새로운 표준을 제시하였다.

먼저, 기존의 날짜 관련 코드가 어떤 부분에서 문제가 될 수 있는지에 대해서는 아래에 간략하게 정리하였다. (해당 내용은 [3] 를 참고하였다.)

* Not immutable!
자바의 Date/Calendar클래스에는 Getter/Setter 를 통해 내부 객체를 자유롭게 변경할 수 있다. 쓰레드 안정성이 지켜지지 않으며, 악의적인 코드에 취약할 수 있다.

* 상수 오남용

```java
(1) calendar.add(Calendar.SECOND, 2);
(2) calendar.add(Calendar.OCTOBER, 2);
```
(1) 과 같이 초 단위의 조작을 원했더라도 (2) 과 같이 작성하여도 컴파일 과정에서 에러를 발생시키지 않는다. 런타임 중에 논리적 오류를 인지하고서야 해결할 수 있을 것이다.

```java
(1) calendar.set(1582, Calendar.OCTOBER , 4);
(2) calendar.set(1582, 10, 4);
```
(1) 과 같이 1582-10-4 의 날짜를 설정할 수 있다. 일반적으로 'OCTOBER == 10월' 으로 인지하고 있기 때문에 상수를 사용하지 않고 임의의 정수로 설정하는 경우 의도와 다른 결과를 얻을 수 있다.
Calendar.OCTOBER 상수의 값은 '9' 이며, 10으로 설정하는 경우 11월로 설정한 꼴이 된다.

* 일관성 없는 요일 상수

Calendar.get(Calendar.DAY_OF_WEEK) 의 일요일은 1(=Calendar.SUNDAY) 로 표현.
반면에, calendar.getTime() 로 Date 객체를 얻어와서 Date.getDay() 메서드로 요일을 구하면 일요일은 0이 된다.

#### 새로운 날짜 표준 소개 (JSR-310)

JSR-310 표준으로 날짜와 시간에 대한 새로운 API가 추가되었다. Joda Time & Time And Money & ICU 등의 여러 오픈소스에 영향을 받았다고 함.

```java
public class JSR310Test {
	@Test
  public void testNextDay() {
      LocalDate today = IsoChronology.INSTANCE.date(2016, 11, 3);
      DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
      assertThat(today.format(formatter)).isEqualTo("2016-11-03");

      LocalDate tomorrow = today.plusDays(1);
      assertThat(tomorrow.format(formatter)).isEqualTo("2016-11-04");
  }
}
```

### 메타 어노테이션 지원 보완

개발 편리성 및 생산성을 위하 메타 프로그래밍이 사용되고 있다. 메소드나 프로퍼티에 어노테이션을 걸고, 동적으로 정보를 가져올 수 있는 개발 방법이다.
자바8에는 '@Repeatable' 어노테이션이 추가되었고, 어노테이션이 Context를 상속한다. 지역 변수, 제네릭 타입, 수퍼클래스와 인터페이스 구현체, 또한 메소드 Exception 정의까지 거의 모든것을 어노테이션으로 표현할 수 있다. 자세한 내용은 [4] 링크를 참조하자. ^^

```java
@Target( ElementType.TYPE )
@Retention( RetentionPolicy.RUNTIME )
@Repeatable( Filters.class )
public @interface Filter {
	String value();
};

@Filter( "filter1" )
@Filter( "filter2" )
public interface Filterable { }

public static void main(String[] args) {
	for( Filter filter : Filterable.class.getAnnotationsByType( Filter.class ) ) {
			System.out.println( filter.value() );
	}
}
```

### 동시성 API 개선

* java.util.concurrent.ConcurrentHaspMap 에 스트림과 람다 표현식을 지원하기 위한 새로운 메소드가 추가됨
* java.util.concurrent.ForkJoinPool 멀티 코어 대응 ExecutorService 구현체 (JDK7+) / ForkJoinPool.commonPool() 메소드 추가로 ForkJoinPool 객체를 생성 하지 않고 할당받을 수 있게 됨.
* java.util.concurrent.locks.ReadWriteLock 의 성능 이슈로 이를 개선한 java.util.concurrent.locks.StampedLock 이 추가 되었다. 자체로 속도가 개선 되었을 뿐 만 아니라 Optimistic Lock을 제공해 더욱 빠르게 동작함. 자세한 내용은 [5] 링크 참조. 성능 비교는 [6] 링크 참조.
* 계수 / 누산에 같은 작업의 원자적 연산을 지원하는 클래스(DoubleAccumulator, DoubleAdder, LongAccumulator, LongAdder)가 추가되었다. 자세한 내용은 [5] 링크 참조.

### IO/NIO 확장

### IO/NIO 관련 클래스에 메소드 추가 / Stream API 를 통한 사용성 개선

```java
BufferedReader.lines();
Files.list (Path)
Files.walk (Path, int FileVisitOption ...)
Files.walk (Path, FileVisitOption ...)
Files.find (Path, int BiPredicate, FileVisitOption ...)
Files.lines (Path, Charset)
DirectoryStream.stream ()
```
추가된 메소드 중 일부 나열.

```java
Files.list(new File(".").toPath())
     .filter(p -> !p.getFileName().toString().startsWith("."))
     .limit(3)
     .forEach(System.out::println);
```
현재 디렉토리에서 '.' 으로 시작하지 않는 파일을 리스팅 하는 예시.

#### java.util.Base64 클래스 추가

```java
// 인코딩
String asB64 = Base64.getEncoder().encodeToString("Hello, World!".getBytes("utf-8"));
System.out.println(asB64); // Equals to "SGVsbG8sIFdvcmxkIQ=="

// 디코딩
byte[] asBytes = Base64.getDecoder().decode("SGVsbG8sIFdvcmxkIQ==");
System.out.println(new String(asBytes, "utf-8"));
```

### Heap에서 Permanent Generation 제거

* java.lang.OutOfMemoryError: PermGen 에러의 원흉... (각종 프레임워크와 개발자)

## References
[1] [Java 8 개선 사항 관련 글 모음](http://blog.fupfin.com/?p=27){:target="_blank"}

[2] [자바 8 살펴보기](http://www.moreagile.net/2014/04/AllAboutJava8.html){:target="_blank"}

[3] [Java의 날짜와 시간 API](http://d2.naver.com/helloworld/645609){:target="_blank"}

[4] [Java8 메타 어노테이션](http://goodcodes.tistory.com/entry/Java-8-Feature-Annotation){:target="_blank"}

[5] [Java SE 8 의 새로운 기능](http://www.yunsobi.com/blog/599)

[6] [StampedLock 성능 비교](http://blog.takipi.com/java-8-stampedlocks-vs-readwritelocks-and-synchronized/)

[6] [Java 8 New I/O API](https://blog.jooq.org/2014/01/24/java-8-friday-goodies-the-new-new-io-apis/)
