---
title: Java 8 람다 표현식 자세히 살펴보기
date: 2016-11-09T18:02:24+09:00
tags: [java, tutorial]
---

2010년도에 '[Project Lambda](http://openjdk.java.net/projects/lambda/)' 라는 프로젝트로 진행되어 Java 8 에 공식 릴리즈가 되었다. 기존의 Java 언어에 어떻게 함수형 프로그래밍을 녹여내었는지 좀 더 자세히 정리하고자 한다.

## 함수형 프로그래밍 간략하게 알아보기

자바의 람다식을 소개하기 전에 함수형 프로그래밍에 대해서 간략하게라도 알아볼 필요가 있다. (람다 대수에 근간을 두는 함수형 프로그래밍은 패러다임이고, 람다 표현식은 이를 나타낸다고 볼 수 있기 때문!)

함수형 프로그래밍은 함수의 입력만을 의존하여 출력을 만드는 구조로 외부에 상태를 변경하는 것을 지양하는 패러다임으로 부작용(Side-effect) 발생을 최소화 하는 방법론이라 할 수 있다. 함수형 프로그래밍에서는 다음의 조건을 만족시켜야 하는데 먼저 이것부터 정리해보자.

- 순수한 함수 (Pure Function)

부작용 (Side-effect)가 없는 함수로 함수의 실행이 외부의 상태를 변경시키지 않는 함수를 의미한다. 순수한 함수는 멀티 쓰레드 환경에서도 안전하고, 병렬처리 및 계산이 가능하다. 오직 입력에 의해서만 출력이 정해지고, 환경이나 상태에 영향을 받아서는 안된다는 의미이다.

- 익명 함수 (Annonymous Function)

이름이 없는 함수를 정의할 수 있어야 한다. 이러한 익명 함수는 대부분의 프로그래밍 언어에서 '람다식'으로 표현하고 있으며, 이론적인 근거는 람다 대수에 있다.

- 고계 함수 (Higher-order Function)

함수를 다루는 상위의 함수로 함수형 언어에서는 함수도 하나의 값으로 취급하고, 함수의 인자로 함수를 전달할 수 있는 특성이 있다. 이러한 함수를 일급 객체 (a.k.a 일급 함수) 로 간주한다.

그렇다면, 자바에서는 함수형 프로그래밍을 어떻게 언어 차원에서 지원할 수 있었는지 간략하게 알아보자.

**자바에는 함수의 개념이 없다.** (자바의 메소드는 일급 함수가 아니므로, 다른 메소드로 전달할 수 없다. 자바에는 모든 것이 객체다. 메소드는 객체의 행위를 정의하고 객체의 상태를 변경한다.) 이런 이유로 기존의 자바 언어 체계에서는 함수형 언어를 언어 차원에서 지원하지는 못하였다. (함수형 프로그래밍의 조건을 만족하도록 구현한다면 기존에도 가능하다고 할 수 있겠다.)

떄문에, Java8 에서 함수형 인터페이스(**단 하나의 메소드만이 선언된 인터페이스**)라는 개념을 도입하게 되었고, 함수형 인터페이스의 경우, 람다식으로 표현이 가능할 수 있게 제공하였다.

Java8에서 함수형 인터페이스라는 개념과 람다식 표현을 통해 입력에 의해서만 출력이 결정되도록 '순수한 함수'를 표현할 수 있게 되었고, 람다식으로 표현함으로써 '익명 함수'를 정의할 수 있게 되었고, 함수형 인터페이스의 메소드에서 또다른 함수형 인터페이스를 인자로 받을 수 있도록 하여 '고계 함수'를 정의할 수 있게 되었다. 즉, 함수형 프로그래밍 언어의 조건을 만족시킬 수 있게 되었다고 할 수 있다.

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
함수형 인터페이스가 무엇인지 예제를 통해 간략히 알아보면,
Functional1, 2, 3는 모두 함수형 인터페이스를 만족한다. 특이한 점이 Functional3 인터페이스의 경우, @FunctionalInterface 어노테이션을 붙여주었는데, 이는 컴파일러에게 명시적으로 함수형 인터페이스임을 알려주는 역할을 하고, 해당 인터페이스가 함수형 인터페이스 명세를 어기면 컴파일러 에러를 발생시켜 준다.

## 람다 표현식 자세히 알아보기

자바에서 기본적인 람다식 구조는 아래와 같다.

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

## 람다 표현식 활용

위에서 자바의 함수형 프로그래밍과 람다 표현식에 대해서 자세하게 살펴보았고, 이번에는 람다의 구체적인 명세에 대해서 정리해보고자 한다.
람다식을 활용함에 있어 어떤 부분이 문법적인 제약이 있는지, 어떤 방법으로 활용될 수 있는지에 대해서 정리해보는 부분이라고 이해하면 좋다.

### 파라미터에 행위 전달 (Parameterized Behaviors)

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

### 불변 변수 사용 (Immutable Free Variables)

자바에서 익명 클래스 + 자유 변수 포획으로 클로저를 가능하게 하였는데, 포획된 변수에는 명시적으로 final 지시자를 사용하도록 강제하였다. 람다식에서는 포획된 변수에 final 을 명시하지 않아도 되도록 변경되었지만 기존과 동일하게 포획된 변수는 변경할 수 없고, 변경하는 경우 컴파일 에러가 발생한다.

```java
int counter = 0 // Free Variable

new Thread(() -> System.out.println(counter)) // OK
new Thread(() -> System.out.println(counter++)) // Compile Error (Free variable is immutable!)
```

### 상태 없는 객체 (Stateless Object)

클래스의 메소드(행위)에서 멤버 변수(상태)를 자유롭게 제어할 수 있다. 즉, 객체가 메소드를 호출하면 입력(Input)+상태(Properties)로부터 출력(Output)이 결정되기 때문에 Side-Effect가 발생할 수 있다. 함수 단위의 배타적 수행이 보장되지 않기 때문에 병렬 처리와 멀티 스레드 환경에서 여러 단점에 노출될 가능성이 있다.

반면에 람다식으로 표현하게 되면, 오로지 입력(Input)과 출력(Output)에 종속되어 있기 때문에 Side-Effect 가 발생하지 않는 것을 최대한 보장할 수 있게 된 것이다. 후술할 스트림 API 에서는 함수형 인터페이스를 최대한 활용해 병렬(Parallel) 처리를 어떻게 효과적으로 할 수 있는지 알아볼 예정이다.

### Optional + Lambda 조합

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

## 함수형 인터페이스 심화

### 표준 함수형 인터페이스

Java 8은 `java.util.function` 패키지에 43개의 표준 함수형 인터페이스를 제공한다. 가장 자주 사용되는 인터페이스들을 살펴보자.

#### Predicate<T> - 조건 검사

```java
@FunctionalInterface
public interface Predicate<T> {
    boolean test(T t);
    
    default Predicate<T> and(Predicate<? super T> other) { ... }
    default Predicate<T> or(Predicate<? super T> other) { ... }
    default Predicate<T> negate() { ... }
}

// 사용 예
Predicate<String> isEmpty = String::isEmpty;
Predicate<String> isNotEmpty = isEmpty.negate();
Predicate<String> isLongerThan5 = s -> s.length() > 5;

// 조합
Predicate<String> isValid = isNotEmpty.and(isLongerThan5);

List<String> filtered = names.stream()
    .filter(isValid)
    .collect(Collectors.toList());
```

#### Function<T, R> - 변환

```java
@FunctionalInterface
public interface Function<T, R> {
    R apply(T t);
    
    default <V> Function<V, R> compose(Function<? super V, ? extends T> before) { ... }
    default <V> Function<T, V> andThen(Function<? super R, ? extends V> after) { ... }
}

// 사용 예
Function<String, Integer> toLength = String::length;
Function<Integer, String> toString = Object::toString;
Function<String, String> pipeline = toLength.andThen(toString);

// compose vs andThen
Function<Integer, Integer> multiplyBy2 = x -> x * 2;
Function<Integer, Integer> add10 = x -> x + 10;

Function<Integer, Integer> multiplyThenAdd = multiplyBy2.andThen(add10); // (x * 2) + 10
Function<Integer, Integer> addThenMultiply = multiplyBy2.compose(add10); // (x + 10) * 2
```

#### Consumer<T> - 소비

```java
@FunctionalInterface
public interface Consumer<T> {
    void accept(T t);
    
    default Consumer<T> andThen(Consumer<? super T> after) { ... }
}

// 사용 예
Consumer<String> print = System.out::println;
Consumer<String> printWithPrefix = s -> System.out.println("Log: " + s);
Consumer<String> combined = print.andThen(printWithPrefix);

combined.accept("Hello"); // Hello \n Log: Hello
```

#### Supplier<T> - 공급

```java
@FunctionalInterface
public interface Supplier<T> {
    T get();
}

// 사용 예 - 지연 초기화
public class LazyLoader {
    private Supplier<ExpensiveObject> supplier = () -> {
        ExpensiveObject obj = createExpensiveObject();
        supplier = () -> obj; // 메모이제이션
        return obj;
    };
    
    public ExpensiveObject get() {
        return supplier.get();
    }
}

// 사용 예 - 팩토리
Supplier<List<String>> listFactory = ArrayList::new;
List<String> list = listFactory.get();
```

#### BinaryOperator<T> - 이항 연산

```java
@FunctionalInterface
public interface BinaryOperator<T> extends BiFunction<T, T, T> {
    static <T> BinaryOperator<T> minBy(Comparator<? super T> comparator) { ... }
    static <T> BinaryOperator<T> maxBy(Comparator<? super T> comparator) { ... }
}

// 사용 예
BinaryOperator<Integer> sum = Integer::sum;
BinaryOperator<String> concat = (s1, s2) -> s1 + s2;

// Stream.reduce()에서 활용
int total = numbers.stream().reduce(0, sum);
String result = words.stream().reduce("", concat);
```

### 커스텀 함수형 인터페이스

표준 인터페이스로 표현할 수 없는 경우 직접 정의할 수 있다.

```java
@FunctionalInterface
public interface ThrowingFunction<T, R, E extends Exception> {
    R apply(T t) throws E;
    
    static <T, R, E extends Exception> Function<T, R> unchecked(
            ThrowingFunction<T, R, E> function) {
        return t -> {
            try {
                return function.apply(t);
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
    }
}

// 사용 예
List<File> files = paths.stream()
    .map(ThrowingFunction.unchecked(File::new))
    .collect(Collectors.toList());
```

## 메소드 레퍼런스 심화

메소드 려퍼런스는 람다식을 더 간결하게 표현하는 방법이다.

### 정적 메소드 레퍼런스

```java
// 람다
Function<String, Integer> parser = s -> Integer.parseInt(s);

// 메소드 레퍼런스
Function<String, Integer> parser = Integer::parseInt;

// 활용
List<Integer> numbers = strings.stream()
    .map(Integer::parseInt)
    .collect(Collectors.toList());
```

### 인스턴스 메소드 레퍼런스

```java
// 특정 객체의 인스턴스 메소드
String prefix = "Hello, ";
Predicate<String> startsWith = prefix::startsWith;

// 임의 객체의 인스턴스 메소드
Function<String, Integer> length = String::length;
BiPredicate<String, String> equals = String::equals;

// 활용
List<Integer> lengths = strings.stream()
    .map(String::length)
    .collect(Collectors.toList());
```

### 생성자 레퍼런스

```java
// 기본 생성자
Supplier<List<String>> listSupplier = ArrayList::new;
List<String> list = listSupplier.get();

// 매개변수 생성자
Function<Integer, List<String>> listFactory = ArrayList::new;
List<String> list = listFactory.apply(10);

// 복잡한 예
record Person(String name, int age) {}

BiFunction<String, Integer, Person> personFactory = Person::new;
Person person = personFactory.apply("John", 30);

// Stream에서 활용
List<Person> people = names.stream()
    .map(name -> new Person(name, 0))
    .collect(Collectors.toList());
    
// 생성자 레퍼런스로 변환 (단, age가 필요하므로 직접 사용은 어려움)
// 대신 팩토리 메소드 활용
```

## 람다와 클로저

### 클로저의 개념

클로저는 자신이 생성된 환경의 변수를 포획(capture)하여, 그 변수에 접근할 수 있는 함수를 말한다.

```java
public class ClosureExample {
    public static void main(String[] args) {
        int x = 10;  // 자유 변수
        
        // 람다는 x를 포획 (클로저)
        Function<Integer, Integer> addX = y -> y + x;
        
        System.out.println(addX.apply(5));  // 15
    }
}
```

### Java의 클로저 제약

Java의 람다는 사실상 제한된 클로저다. 포획한 변수는 반드시 effectively final이어야 한다.

```java
public class ClosureLimitation {
    public static void main(String[] args) {
        int counter = 0;  // effectively final이 아님
        
        // 컴파일 에러!
        Runnable r = () -> {
            // counter++;  // 포획한 변수는 수정 불가
            System.out.println(counter);  // 읽기는 OK
        };
    }
}
```

### 우회 방법

```java
// 방법 1: Atomic 사용
AtomicInteger counter = new AtomicInteger(0);
Runnable r = () -> counter.incrementAndGet();

// 방법 2: 배열 사용 (권장하지 않음)
int[] counter = {0};
Runnable r = () -> counter[0]++;

// 방법 3: 래퍼 클래스 사용
class Counter {
    int value = 0;
}
Counter counter = new Counter();
Runnable r = () -> counter.value++;
```

## 람다 성능 고려사항

### JVM 최적화

Java 8의 람다는 `invokedynamic` 바이트코드를 사용하여 구현된다. 이를 통해 JVM이 런타임에 최적화를 수행할 수 있다.

```java
// 람다는 익명 클래스와 다르다
Runnable r1 = () -> System.out.println("Hello");

// 위 코드는 다음과 같이 컴파일되지 않음:
// new Runnable() { ... }

// 대신 invokedynamic을 사용하여 JVM이 최적화
```

### 성능 벤치마크

```java
@BenchmarkMode(Mode.AverageTime)
@OutputTimeUnit(TimeUnit.NANOSECONDS)
public class LambdaBenchmark {
    
    @Benchmark
    public void anonymousClass() {
        Runnable r = new Runnable() {
            @Override
            public void run() {
                // do nothing
            }
        };
        r.run();
    }
    
    @Benchmark
    public void lambda() {
        Runnable r = () -> {};
        r.run();
    }
    
    @Benchmark
    public void methodReference() {
        Runnable r = LambdaBenchmark::doNothing;
        r.run();
    }
    
    private static void doNothing() {}
}
```

일반적으로 람다는 익명 클래스보다 약간 더 빠르거나 비슷한 성능을 보인다. 첫 호출 시 약간의 오버헤드가 있을 수 있지만, JVM이 최적화한 후에는 차이가 미미하다.

### 메모리 사용량

```java
// 람다는 캡처가 없는 경우 싱글톤으로 최적화됨
Runnable r1 = () -> System.out.println("Hello");
Runnable r2 = () -> System.out.println("Hello");
// r1 == r2일 수 있음 (JVM 구현에 따라 다름)

// 캡처가 있는 경우 새 인스턴스 생성
String msg = "Hello";
Runnable r3 = () -> System.out.println(msg);
Runnable r4 = () -> System.out.println(msg);
// r3 != r4
```

## 람다 디버깅

### 스택 트레이스 문제

람다식은 스택 트레이스에서 익명 클래스와 다르게 표시된다.

```java
public class LambdaStackTrace {
    public static void main(String[] args) {
        List<Integer> list = Arrays.asList(1, 2, 3, null);
        
        try {
            list.stream()
                .map(i -> i + 1)  // NPE 발생
                .forEach(System.out::println);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

스택 트레이스:
```
java.lang.NullPointerException
    at LambdaStackTrace.lambda$main$0(LambdaStackTrace.java:7)
    at java.util.stream.ReferencePipeline$3$1.accept(ReferencePipeline.java:193)
    ...
```

### 디버깅 팁

```java
// 1. 람다를 별도 메소드로 분리
list.stream()
    .map(this::addOne)  // 디버깅 포인트 설정 가능
    .forEach(System.out::println);

private Integer addOne(Integer i) {
    return i + 1;  // 여기에 브레이크포인트
}

// 2. peek() 사용
list.stream()
    .peek(i -> System.out.println("Before: " + i))
    .map(i -> i + 1)
    .peek(i -> System.out.println("After: " + i))
    .forEach(System.out::println);

// 3. 로깅 래퍼
public static <T> T log(String name, T value) {
    System.out.println(name + ": " + value);
    return value;
}

list.stream()
    .map(i -> log("input", i))
    .map(i -> i + 1)
    .forEach(System.out::println);
```

## 람다 모범 사례

### 1. 람다는 간결하게 유지

```java
// 나쁜 예: 너무 긴 람다
list.stream()
    .filter(item -> {
        if (item == null) return false;
        if (item.getValue() == null) return false;
        return item.getValue() > 0 && item.isActive();
    })
    .forEach(...);

// 좋은 예: 별도 메소드로 분리
list.stream()
    .filter(this::isValid)
    .forEach(...);

private boolean isValid(Item item) {
    return item != null 
        && item.getValue() != null 
        && item.getValue() > 0 
        && item.isActive();
}
```

### 2. 타입 명시는 필요할 때만

```java
// 불필요한 타입 명시
list.stream()
    .map((String s) -> s.toUpperCase())
    .collect(Collectors.toList());

// 깔끔한 형태
list.stream()
    .map(String::toUpperCase)
    .collect(Collectors.toList());

// 타입 명시가 필요한 경우 (모호할 때)
executor.execute((Runnable) () -> doSomething());
```

### 3. 부작용 피하기

```java
// 나쁜 예: 외부 상태 변경
List<String> results = new ArrayList<>();
list.stream()
    .forEach(item -> results.add(transform(item)));  // 부작용!

// 좋은 예: 순수 함수 사용
List<String> results = list.stream()
    .map(this::transform)
    .collect(Collectors.toList());
```

### 4. Optional과 람다 조합

```java
// 나쁜 예: null 체크
if (user != null) {
    Address address = user.getAddress();
    if (address != null) {
        String city = address.getCity();
        if (city != null) {
            return city.toUpperCase();
        }
    }
}
return "UNKNOWN";

// 좋은 예: Optional + 람다
return Optional.ofNullable(user)
    .map(User::getAddress)
    .map(Address::getCity)
    .map(String::toUpperCase)
    .orElse("UNKNOWN");
```

## 참고 링크

- [자바8 람다식 소개](http://www.slideshare.net/madvirus/8-35205661)
- [Java 8 람다식 소개와 의미 고찰](http://www.slideshare.net/gyumee/java-8-lambda-35352385)
- [Java 8 Lambda Expression과 변경된 Interface의 모호함](http://www.xenomity.com/entry/Java-8-Lambda-Expression%EA%B3%BC-%EB%B3%80%EA%B2%BD%EB%90%9C-Interface%EC%9D%98-%EB%AA%A8%ED%98%B8%ED%95%A8)
- [Java8#01. 람다 표현식(Lambda Expression)](http://multifrontgarden.tistory.com/124)
- [자바 8 Optional](http://javaiyagi.tistory.com/443)
- [함수형 프로그래밍 위키](https://ko.wikipedia.org/wiki/%ED%95%A8%EC%88%98%ED%98%95_%ED%94%84%EB%A1%9C%EA%B7%B8%EB%9E%98%EB%B0%8D)
- [일급 객체 위키](https://ko.wikipedia.org/wiki/%EC%9D%BC%EA%B8%89_%EA%B0%9D%EC%B2%B4)
- [일급 함수 제타위키](http://zetawiki.com/wiki/1%EA%B8%89_%ED%95%A8%EC%88%98)
