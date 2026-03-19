---
title: Deep Dive into Java 8 Lambda Expressions
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
(int a, int b) -> {return a + b} // Parameters -> Function logic (+@ return)
```

Summarized as follows:

* Simple lambda syntax may not have braces in the lambda body.

* May not have return.

* Parameters don't need explicit type declaration (type inference).

* The compiler converts lambda syntax to anonymous classes. In other words, it's a form where the compiler is delegated to implement the functional interface.

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
Collections.max(fruits, new Comparator<Fruit> {
  @Override
  public int compare(Fruit o1, Fruit o2) {
      return o1.name.compareTo(o2.name);
  }
});

// TO-BE
Collections.max(fruits, (o1, o2) -> o1.name.compareTo(o2.name) ;
```

The Spring Framework already used behavior parameters using anonymous classes as the 'Template Callback Pattern' design pattern, and now it can be used more concisely with lambda expressions.

### Immutable Free Variables

Java enabled closures through anonymous classes + free variable capture, forcing explicit use of the final modifier on captured variables. In lambda expressions, final doesn't need to be explicitly declared on captured variables, but captured variables still can't be modified, and attempting to modify results in a compile error.

```java
int counter = 0 // Free Variable

new Thread(() -> System.out.println(counter)) // OK
new Thread(() -> System.out.println(counter++)) // Compile Error (Free variable is immutable!)
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

* Creating empty objects

```java
Optional<Member> member = Optional.empty();
```

* Creating non-null objects

```java
Optional<Member> member = Optional.of(memberRepository.findById(1L));
member.get() // NullPointerException !!!
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
member.orElse(new Member("Unknown")).ifPresent(System.out::println);
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
member.filter(m -> m.getRating() >= 4.0)
    .ifPresent(m -> System.out::println)
```

## Advanced Functional Interfaces

### Standard Functional Interfaces

Java 8 provides 43 standard functional interfaces in the `java.util.function` package. Let's look at the most frequently used interfaces.

#### Predicate<T> - Condition Testing

```java
@FunctionalInterface
public interface Predicate<T> {
    boolean test(T t);
    
    default Predicate<T> and(Predicate<? super T> other) { ... }
    default Predicate<T> or(Predicate<? super T> other) { ... }
    default Predicate<T> negate() { ... }
}

// Usage example
Predicate<String> isEmpty = String::isEmpty;
Predicate<String> isNotEmpty = isEmpty.negate();
Predicate<String> isLongerThan5 = s -> s.length() > 5;

// Combination
Predicate<String> isValid = isNotEmpty.and(isLongerThan5);

List<String> filtered = names.stream()
    .filter(isValid)
    .collect(Collectors.toList());
```

#### Function<T, R> - Transformation

```java
@FunctionalInterface
public interface Function<T, R> {
    R apply(T t);
    
    default <V> Function<V, R> compose(Function<? super V, ? extends T> before) { ... }
    default <V> Function<T, V> andThen(Function<? super R, ? extends V> after) { ... }
}

// Usage example
Function<String, Integer> toLength = String::length;
Function<Integer, String> toString = Object::toString;
Function<String, String> pipeline = toLength.andThen(toString);

// compose vs andThen
Function<Integer, Integer> multiplyBy2 = x -> x * 2;
Function<Integer, Integer> add10 = x -> x + 10;

Function<Integer, Integer> multiplyThenAdd = multiplyBy2.andThen(add10); // (x * 2) + 10
Function<Integer, Integer> addThenMultiply = multiplyBy2.compose(add10); // (x + 10) * 2
```

#### Consumer<T> - Consumption

```java
@FunctionalInterface
public interface Consumer<T> {
    void accept(T t);
    
    default Consumer<T> andThen(Consumer<? super T> after) { ... }
}

// Usage example
Consumer<String> print = System.out::println;
Consumer<String> printWithPrefix = s -> System.out.println("Log: " + s);
Consumer<String> combined = print.andThen(printWithPrefix);

combined.accept("Hello"); // Hello \n Log: Hello
```

#### Supplier<T> - Supply

```java
@FunctionalInterface
public interface Supplier<T> {
    T get();
}

// Usage - Lazy initialization
public class LazyLoader {
    private Supplier<ExpensiveObject> supplier = () -> {
        ExpensiveObject obj = createExpensiveObject();
        supplier = () -> obj; // Memoization
        return obj;
    };
    
    public ExpensiveObject get() {
        return supplier.get();
    }
}

// Usage - Factory
Supplier<List<String>> listFactory = ArrayList::new;
List<String> list = listFactory.get();
```

#### BinaryOperator<T> - Binary Operation

```java
@FunctionalInterface
public interface BinaryOperator<T> extends BiFunction<T, T, T> {
    static <T> BinaryOperator<T> minBy(Comparator<? super T> comparator) { ... }
    static <T> BinaryOperator<T> maxBy(Comparator<? super T> comparator) { ... }
}

// Usage example
BinaryOperator<Integer> sum = Integer::sum;
BinaryOperator<String> concat = (s1, s2) -> s1 + s2;

// Used in Stream.reduce()
int total = numbers.stream().reduce(0, sum);
String result = words.stream().reduce("", concat);
```

### Custom Functional Interfaces

You can define your own when standard interfaces can't express what you need.

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

// Usage example
List<File> files = paths.stream()
    .map(ThrowingFunction.unchecked(File::new))
    .collect(Collectors.toList());
```

## Advanced Method References

Method references are a way to express lambda expressions more concisely.

### Static Method Reference

```java
// Lambda
Function<String, Integer> parser = s -> Integer.parseInt(s);

// Method reference
Function<String, Integer> parser = Integer::parseInt;

// Usage
List<Integer> numbers = strings.stream()
    .map(Integer::parseInt)
    .collect(Collectors.toList());
```

### Instance Method Reference

```java
// Instance method of a particular object
String prefix = "Hello, ";
Predicate<String> startsWith = prefix::startsWith;

// Instance method of an arbitrary object
Function<String, Integer> length = String::length;
BiPredicate<String, String> equals = String::equals;

// Usage
List<Integer> lengths = strings.stream()
    .map(String::length)
    .collect(Collectors.toList());
```

### Constructor Reference

```java
// Default constructor
Supplier<List<String>> listSupplier = ArrayList::new;
List<String> list = listSupplier.get();

// Parameterized constructor
Function<Integer, List<String>> listFactory = ArrayList::new;
List<String> list = listFactory.apply(10);

// Complex example
record Person(String name, int age) {}

BiFunction<String, Integer, Person> personFactory = Person::new;
Person person = personFactory.apply("John", 30);

// Usage in Stream
List<Person> people = names.stream()
    .map(name -> new Person(name, 0))
    .collect(Collectors.toList());
```

## Lambdas and Closures

### Closure Concept

A closure is a function that captures variables from its enclosing environment and can access those variables.

```java
public class ClosureExample {
    public static void main(String[] args) {
        int x = 10;  // Free variable
        
        // Lambda captures x (closure)
        Function<Integer, Integer> addX = y -> y + x;
        
        System.out.println(addX.apply(5));  // 15
    }
}
```

### Java's Closure Limitations

Java's lambdas are effectively restricted closures. Captured variables must be effectively final.

```java
public class ClosureLimitation {
    public static void main(String[] args) {
        int counter = 0;  // Not effectively final
        
        // Compile error!
        Runnable r = () -> {
            // counter++;  // Can't modify captured variable
            System.out.println(counter);  // Reading is OK
        };
    }
}
```

### Workarounds

```java
// Method 1: Use Atomic
AtomicInteger counter = new AtomicInteger(0);
Runnable r = () -> counter.incrementAndGet();

// Method 2: Use array (not recommended)
int[] counter = {0};
Runnable r = () -> counter[0]++;

// Method 3: Use wrapper class
class Counter {
    int value = 0;
}
Counter counter = new Counter();
Runnable r = () -> counter.value++;
```

## Lambda Performance Considerations

### JVM Optimization

Java 8 lambdas are implemented using `invokedynamic` bytecode, allowing the JVM to perform runtime optimization.

```java
// Lambdas are different from anonymous classes
Runnable r1 = () -> System.out.println("Hello");

// The above code is NOT compiled as:
// new Runnable() { ... }

// Instead, it uses invokedynamic for JVM optimization
```

### Performance Benchmark

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

Generally, lambdas perform slightly better or similar to anonymous classes. There may be slight overhead on first invocation, but the difference becomes negligible after JVM optimization.

### Memory Usage

```java
// Non-capturing lambdas may be optimized as singletons
Runnable r1 = () -> System.out.println("Hello");
Runnable r2 = () -> System.out.println("Hello");
// r1 == r2 may be true (depends on JVM implementation)

// Capturing lambdas create new instances
String msg = "Hello";
Runnable r3 = () -> System.out.println(msg);
Runnable r4 = () -> System.out.println(msg);
// r3 != r4
```

## Lambda Debugging

### Stack Trace Issues

Lambda expressions appear differently in stack traces compared to anonymous classes.

```java
public class LambdaStackTrace {
    public static void main(String[] args) {
        List<Integer> list = Arrays.asList(1, 2, 3, null);
        
        try {
            list.stream()
                .map(i -> i + 1)  // NPE occurs
                .forEach(System.out::println);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

Stack trace:
```
java.lang.NullPointerException
    at LambdaStackTrace.lambda$main$0(LambdaStackTrace.java:7)
    at java.util.stream.ReferencePipeline$3$1.accept(ReferencePipeline.java:193)
    ...
```

### Debugging Tips

```java
// 1. Extract lambda to separate method
list.stream()
    .map(this::addOne)  // Debug point can be set here
    .forEach(System.out::println);

private Integer addOne(Integer i) {
    return i + 1;  // Breakpoint here
}

// 2. Use peek()
list.stream()
    .peek(i -> System.out.println("Before: " + i))
    .map(i -> i + 1)
    .peek(i -> System.out.println("After: " + i))
    .forEach(System.out::println);

// 3. Logging wrapper
public static <T> T log(String name, T value) {
    System.out.println(name + ": " + value);
    return value;
}

list.stream()
    .map(i -> log("input", i))
    .map(i -> i + 1)
    .forEach(System.out::println);
```

## Lambda Best Practices

### 1. Keep Lambdas Concise

```java
// Bad: Too long lambda
list.stream()
    .filter(item -> {
        if (item == null) return false;
        if (item.getValue() == null) return false;
        return item.getValue() > 0 && item.isActive();
    })
    .forEach(...);

// Good: Extract to separate method
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

### 2. Explicit Types Only When Needed

```java
// Unnecessary type specification
list.stream()
    .map((String s) -> s.toUpperCase())
    .collect(Collectors.toList());

// Clean form
list.stream()
    .map(String::toUpperCase)
    .collect(Collectors.toList());

// When type specification is needed (ambiguous)
executor.execute((Runnable) () -> doSomething());
```

### 3. Avoid Side Effects

```java
// Bad: Modifying external state
List<String> results = new ArrayList<>();
list.stream()
    .forEach(item -> results.add(transform(item)));  // Side effect!

// Good: Use pure functions
List<String> results = list.stream()
    .map(this::transform)
    .collect(Collectors.toList());
```

### 4. Combine Optional with Lambda

```java
// Bad: Null checks
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

// Good: Optional + Lambda
return Optional.ofNullable(user)
    .map(User::getAddress)
    .map(Address::getCity)
    .map(String::toUpperCase)
    .orElse("UNKNOWN");
```

## References

- [Java 8 Lambda Introduction](http://www.slideshare.net/madvirus/8-35205661)
- [Java 8 Lambda Introduction and Meaning Consideration](http://www.slideshare.net/gyumee/java-8-lambda-35352385)
- [Java 8 Lambda Expression and Ambiguity of Changed Interface](http://www.xenomity.com/entry/Java-8-Lambda-Expression%EA%B3%BC-%EB%B3%80%EA%B2%BD%EB%90%9C-Interface%EC%9D%98-%EB%AA%A8%ED%98%B8%ED%95%A8)
- [Java8#01. Lambda Expression](http://multifrontgarden.tistory.com/124)
- [Java 8 Optional](http://javaiyagi.tistory.com/443)
- [Functional Programming Wiki](https://en.wikipedia.org/wiki/Functional_programming)
- [First-class Object Wiki](https://en.wikipedia.org/wiki/First-class_citizen)
- [First-class Function](http://zetawiki.com/wiki/1%EA%B8%89_%ED%95%A8%EC%88%98)
