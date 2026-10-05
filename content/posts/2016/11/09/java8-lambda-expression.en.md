---
title: Deep Dive into Java 8 Lambda Expressions
description: "Java 8 lambda expressions in depth: functional programming basics, syntax, behavior parameterization, Optional, standard functional interfaces, and how lambdas actually work."
date: 2016-11-09T18:02:24+09:00
tags: [java, tutorial]
---

Started as 'Project Lambda' in 2010, it was officially released in Java 8. This article details how functional programming was incorporated into the existing Java language.

## Brief Overview of Functional Programming

Before introducing Java's lambda expressions, we need to briefly understand functional programming. (Functional programming based on lambda calculus is a paradigm, and lambda expressions represent it!)

Functional programming is a paradigm that creates output relying only on function input, avoiding changing external state, minimizing side-effects. Functional programming must satisfy the following conditions:

- Pure Function

A function without side-effects, meaning the function's execution doesn't change external state. Pure functions are safe in multi-threaded environments and enable parallel processing. Output is determined only by input, not affected by environment or state.

- Anonymous Function

Ability to define functions without names. Such anonymous functions are expressed as 'lambda expressions' in most programming languages, with theoretical basis in lambda calculus.

- Higher-order Function

A higher-level function that handles functions. In functional languages, functions are treated as values, and functions can be passed as arguments to other functions. Such functions are considered first-class objects (a.k.a first-class functions).

So let's briefly see how Java could support functional programming at the language level.

**Java doesn't have the concept of functions.** (Java methods are not first-class functions, so they can't be passed to other methods. In Java, everything is an object. Methods define object behavior and change object state.) For this reason, the existing Java language system couldn't support functional languages at the language level. (It was possible before if implemented to satisfy functional programming conditions.)

Therefore, Java 8 introduced the concept of functional interfaces (**interfaces with only one method declared**), and functional interfaces could be expressed as lambda expressions.

Through the functional interface concept and lambda expression in Java 8, 'pure functions' could be expressed where output is determined only by input, 'anonymous functions' could be defined through lambda expressions, and 'higher-order functions' could be defined by allowing functional interface methods to accept other functional interfaces as arguments. In other words, it became possible to satisfy the conditions of functional programming languages.

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

Looking at what functional interfaces are through examples, Functional1, 2, 3 all satisfy functional interfaces. Notably, Functional3 has @FunctionalInterface annotation, which explicitly tells the compiler it's a functional interface and generates a compiler error if the interface violates functional interface specifications.

## Deep Dive into Lambda Expressions

The basic lambda expression structure in Java is:

```java
(int a, int b) -> { return a + b; } // Parameters -> Function logic (+@ return)
```

Summarized as follows:

* Simple lambda syntax may not have braces in the lambda body.

* May not have return.

* Parameters don't need explicit type declaration (type inference).

* Instead of writing the functional interface implementation yourself, you delegate it to the compiler (more precisely, the runtime). (It isn't converted to an anonymous class; more on that below.)

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

## Lambda Expression Usage

We've looked at Java's functional programming and lambda expressions in detail. Now let's summarize the specific specifications of lambda.
Think of this as summarizing what syntactic restrictions exist when using lambda expressions and how they can be utilized.

### Parameterized Behaviors

By passing data or variables and behavior together to a method, the behavior part of the method can also be separated. The advantages gained can be summarized as:

* Perform control flow by receiving behavior at runtime (cf. Strategy Pattern)
* Method-level abstraction possible
* Higher-order functions in functional languages

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
Collections.max(fruits, new Comparator<Fruit>() {
  @Override
  public int compare(Fruit o1, Fruit o2) {
      return o1.name.compareTo(o2.name);
  }
});

// TO-BE
Collections.max(fruits, (o1, o2) -> o1.name.compareTo(o2.name));
```

The Spring Framework already used behavior parameters using anonymous classes as the 'Template Callback Pattern' design pattern, and now it can be used more concisely with lambda expressions.

### Immutable Free Variables

Java enabled closures through anonymous classes + free variable capture, forcing explicit use of the final modifier on captured variables. In lambda expressions, final doesn't need to be explicitly declared on captured variables, but captured variables still can't be modified, and attempting to modify results in a compile error.

```java
int counter = 0; // Free Variable

new Thread(() -> System.out.println(counter)); // OK
new Thread(() -> System.out.println(counter++)); // Compile Error (Free variable is immutable!)
```

### Stateless Object

Class methods (behavior) can freely control member variables (state). In other words, when an object calls a method, output is determined from input + state (properties), so side-effects can occur. Since exclusive function execution isn't guaranteed, there's potential exposure to various disadvantages in parallel processing and multi-threaded environments.

On the other hand, when expressed with lambda expressions, it becomes dependent only on input and output, so side-effects can be guaranteed not to occur as much as possible. In the Stream API to be discussed later, we'll see how parallel processing can be done effectively by maximizing the use of functional interfaces.

### Optional + Lambda Combination

The java.util.Optional class is a class for expressing cases where a value exists or doesn't exist, with higher-order functions like map, filter, and flatMap.
Optional's higher-order functions can be combined for concise expression, potentially freeing from defensive logic due to fear of NullPointerException.

* Liberation from 'If (obj != Null)' null checks

```java
// AS-IS
Member member = memberRepository.findById(1L);
Coord coord = null;
if (member != null) {
  if (member.getAddress() != null) {
    String zipCode = member.getAddress().getZipCode();
    if (zipCode != null) {
      coord = coordRepository.findByZipCode(zipCode);
    }
  }
}

// TO-BE
Optional<Member> member = memberRepository.findById(1L);
Coord coord = member.map(Member::getAddress)
    .map(address -> address.getZipCode())
    .map(zipCode -> coordRepository.findByZipCode(zipCode))
    .orElse(null);
```

* Creating empty objects

```java
Optional<Member> member = Optional.empty();
```

* Creating non-null objects

```java
Optional<Member> member = Optional.of(memberRepository.findById(1L)); // NullPointerException right here if null !!!
```

* Calling specific method when value exists

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

* No need to express with ternary operator for value existence cases

```java
// AS-IS
Member member = memberRepository.findById(1L);
System.out.println(member != null ? member : new Member("Unknown"));

// TO-BE
Optional<Member> member = Optional.ofNullable(memberRepository.findById(1L));
System.out.println(member.orElse(new Member("Unknown")));
```

* When you want to perform specific behavior only when certain conditions are met

```java
// AS-IS
Member member = memberRepository.findById(1L);
if (member != null && member.getRating() != null && member.getRating() >= 4.0) {
  System.out.println(member);
}

// TO-BE
Optional<Member> member = Optional.ofNullable(memberRepository.findById(1L));
member.filter(m -> m.getRating() != null && m.getRating() >= 4.0)
    .ifPresent(System.out::println);
```

## Standard Functional Interfaces

You don't have to define a functional interface yourself every time. Java 8 ships the common shapes in the `java.util.function` package. There are 43 of them, but if you skip the primitive specializations (IntPredicate, LongFunction, etc.), knowing the ones below is mostly enough.

| Interface | Method | Use |
|---|---|---|
| `Predicate<T>` | `boolean test(T t)` | Condition check (filter, etc.) |
| `Function<T, R>` | `R apply(T t)` | Value conversion (map, etc.) |
| `Consumer<T>` | `void accept(T t)` | Consume a value (forEach, etc.) |
| `Supplier<T>` | `T get()` | Produce a value (lazy creation, factories, etc.) |
| `UnaryOperator<T>` | `T apply(T t)` | Function whose input and output types match |
| `BinaryOperator<T>` | `T apply(T t1, T t2)` | Fold two values of one type into one (reduce, etc.) |

They also come with default methods for composition, so small lambdas can be chained together.

```java
Predicate<String> isNotEmpty = ((Predicate<String>) String::isEmpty).negate();
Predicate<String> isValid = isNotEmpty.and(s -> s.length() > 5);

Function<Integer, Integer> multiplyBy2 = x -> x * 2;
Function<Integer, Integer> add10 = x -> x + 10;
multiplyBy2.andThen(add10).apply(1); // (1 * 2) + 10 = 12
multiplyBy2.compose(add10).apply(1); // (1 + 10) * 2 = 22
```

PS. Expressions like `String::isEmpty` and `System.out::println` above are method references, a shorter syntax for a lambda that just calls one existing method. Static methods (`Integer::parseInt`), instance methods (`String::length`), and constructors (`ArrayList::new`) can all be written as references.

## By the way, a lambda is not an anonymous class

I described lambdas like anonymous classes above, but if you look at the compiled bytecode, no anonymous class file (`Outer$1.class`) is generated. The lambda body is compiled into a private method like `lambda$main$0`, and the call site gets an `invokedynamic` instruction that builds the functional interface implementation at runtime on first call. That's why `this` inside a lambda refers to the enclosing class instance, not an anonymous class object.

It's also why names like `lambda$main$0` show up in stack traces. If a lambda body gets long enough to be hard to debug, pulling it out into a separate method and passing a method reference is easier both to read and to debug.

## References

- [Java 8 Lambda Introduction](http://www.slideshare.net/madvirus/8-35205661)
- [Java 8 Lambda Introduction and Meaning Consideration](http://www.slideshare.net/gyumee/java-8-lambda-35352385)
- [Java 8 Lambda Expression and Ambiguity of Changed Interface](http://www.xenomity.com/entry/Java-8-Lambda-Expression%EA%B3%BC-%EB%B3%80%EA%B2%BD%EB%90%9C-Interface%EC%9D%98-%EB%AA%A8%ED%98%B8%ED%95%A8)
- [Java8#01. Lambda Expression](http://multifrontgarden.tistory.com/124)
- [Java 8 Optional](http://javaiyagi.tistory.com/443)
- [Functional Programming Wiki](https://en.wikipedia.org/wiki/Functional_programming)
- [First-class Object Wiki](https://en.wikipedia.org/wiki/First-class_citizen)
- [First-class Function](http://zetawiki.com/wiki/1%EA%B8%89_%ED%95%A8%EC%88%98)
