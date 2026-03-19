---
title: Exploring Java 8
date: 2016-10-25T21:33:00+09:00
tags: [java, tutorial]
---

This article summarizes the features added in Java 8. It covers the overall content, and more detailed information can be found in the attached related links.

## Summary of New Features

### Lambda Expression (a.k.a Anonymous Method)

The foundation of Java's lambda expressions is based on 'lambda calculus' proposed by Alonzo Church in the 1930s. It's a formal system that abstracts function definition, function application, and recursive functions! For more details, refer to [Lambda Calculus Wiki](https://en.wikipedia.org/wiki/Lambda_calculus).

You can understand it as supporting anonymous method creation syntax.

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

In the existing Java, you had to create a thread, implement an anonymous class, and override the method. This structure forces class implementation even for simple code and generates unnecessary code.
With lambda expressions, you can write code more simply and focus more on the code you originally intended to implement. Additionally, when implementing a 'functional interface', you don't need to specify which method to override. I'll explain functional interfaces in detail later.

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

Lambda expressions support 'type inference', so the runtime can infer the type of parameters without explicitly declaring them. Since you don't need to declare explicitly, the amount of code is reduced.

#### Practical Lambda Patterns

**Simplifying Event Handlers**

```java
// Java 7
button.addActionListener(new ActionListener() {
    @Override
    public void actionPerformed(ActionEvent e) {
        System.out.println("Button clicked!");
    }
});

// Java 8
button.addActionListener(e -> System.out.println("Button clicked!"));
```

**Conditional Execution Pattern**

```java
public static void processIfValid(String input, Consumer<String> processor) {
    if (input != null && !input.isEmpty()) {
        processor.accept(input);
    }
}

// Usage
processIfValid(userData, data -> saveToDatabase(data));
processIfValid(logMessage, msg -> logger.info(msg));
```

**Lazy Initialization**

```java
public class ExpensiveResource {
    private Supplier<HeavyObject> heavyObject = () -> {
        HeavyObject instance = createHeavyObject();
        heavyObject = () -> instance; // Memoization
        return instance;
    };
    
    public HeavyObject getHeavyObject() {
        return heavyObject.get();
    }
}
```

### Stream API

The Stream API is an effective use of lambda expressions, providing a new mechanism for handling the Collection interface. Pipeline/lazy/parallel processing are provided through the same interface, enabling functional programming.

Referred to ['lambda-resort' Github](https://github.com/benelog/lambda-resort)

```java
List<Guest> guests = repository.findAll();
return guests.stream()
	.filter(g -> company.equals(g.getCompany()))
	.sorted(Comparator.comparing(Guest::getGrade))
	.map(Guest::getName)
	.collect(Collectors.toList());
```

This logic creates a stream from a container, filters only guest objects with the same company, sorts by guest.grade in ascending order, extracts only guest names, and creates a list again.
Parts that could be complex with existing for-each loops become simpler and clearer.

#### Advanced Stream API

**Parallel Stream**

```java
// Sequential processing
long count = data.stream()
    .filter(s -> s.length() > 5)
    .count();

// Parallel processing
long count = data.parallelStream()
    .filter(s -> s.length() > 5)
    .count();
```

Cautions when using parallel streams:
- Only effective when data size is sufficiently large
- Avoid thread-unsafe operations
- Not suitable for order-dependent operations

```java
// Bad example: Shared state modification
List<Integer> results = new ArrayList<>();
IntStream.range(0, 1000).parallel()
    .forEach(i -> results.add(i)); // ConcurrentModificationException possible

// Good example: Thread-safe collection
List<Integer> results = IntStream.range(0, 1000).parallel()
    .boxed()
    .collect(Collectors.toList());
```

**Custom Collector**

```java
public class StringJoiner implements Collector<CharSequence, StringBuilder, String> {
    
    @Override
    public Supplier<StringBuilder> supplier() {
        return StringBuilder::new;
    }
    
    @Override
    public BiConsumer<StringBuilder, CharSequence> accumulator() {
        return (sb, cs) -> {
            if (sb.length() > 0) sb.append(", ");
            sb.append(cs);
        };
    }
    
    @Override
    public BinaryOperator<StringBuilder> combiner() {
        return (sb1, sb2) -> {
            if (sb1.length() > 0) sb1.append(", ");
            sb1.append(sb2);
            return sb1;
        };
    }
    
    @Override
    public Function<StringBuilder, String> finisher() {
        return StringBuilder::toString;
    }
    
    @Override
    public Set<Characteristics> characteristics() {
        return Collections.emptySet();
    }
}

// Usage
String result = names.stream().collect(new StringJoiner());
```

**Grouping and Partitioning**

```java
// Grouping
Map<Department, List<Employee>> byDept = employees.stream()
    .collect(Collectors.groupingBy(Employee::getDepartment));

// Grouping + Aggregation
Map<Department, Double> avgSalaryByDept = employees.stream()
    .collect(Collectors.groupingBy(
        Employee::getDepartment,
        Collectors.averagingDouble(Employee::getSalary)
    ));

// Multi-level grouping
Map<Department, Map<Grade, List<Employee>>> byDeptAndGrade = employees.stream()
    .collect(Collectors.groupingBy(
        Employee::getDepartment,
        Collectors.groupingBy(Employee::getGrade)
    ));

// Partitioning
Map<Boolean, List<Employee>> partitioned = employees.stream()
    .collect(Collectors.partitioningBy(e -> e.getSalary() > 50000));
```

### Default Method

In Java's rigid interface system, adding a method to an interface affects all implementations. Somewhere in the Concrete/Abstract Class implementing the interface, overriding is required.

Previously, this was resolved through various workarounds:
1. Using helper classes
2. Adding extension interfaces
3. Extension through abstract classes, etc.

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

The implementation of forEachRemaining doesn't force implementation in inherited classes, leaving room for extension through overriding.

Implementation through inheritance takes precedence over interface default methods! (Override method > Default method)

Diamond Problem can occur!

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
	/* Compile error! (Pen inherits unrelated defaults for draw() from Red and Blue) */
}
```

Can be avoided by explicitly defining which interface's default method to use:

```java
public interface Pen extends Red, Blue, Green {
	default void draw() { Red.super.draw(); }
}
```

Static methods can also be included in interfaces / No need to separate into utility classes:

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

### New Date API Based on Joda Time (JSR 310)

#### Problems with Basic Date Classes

The date-related classes provided in JDK until Java7 had many problems. Eventually, utility libraries like Joda Time emerged to resolve some issues, but the Java community officially proposed a new standard.

First, I've briefly summarized what problems existing date-related code could have. (This content was referenced from [3].)

* Not immutable!
Java's Date/Calendar classes allow free modification of internal objects through Getter/Setter. Thread safety is not guaranteed, making it vulnerable to malicious code.

* Constant misuse

```java
(1) calendar.add(Calendar.SECOND, 2);
(2) calendar.add(Calendar.OCTOBER, 2);
```
Even if you wanted to manipulate in seconds as in (1), writing as in (2) doesn't cause an error during compilation. You can only recognize the logical error during runtime.

```java
(1) calendar.set(1582, Calendar.OCTOBER , 4);
(2) calendar.set(1582, 10, 4);
```
You can set the date 1582-10-4 as in (1). Since 'OCTOBER == October' is generally recognized, if you don't use constants and set with arbitrary integers, you may get different results than intended.
The value of Calendar.OCTOBER constant is '9', so setting it to 10 means setting it to November.

* Inconsistent day-of-week constants

Calendar.get(Calendar.DAY_OF_WEEK) represents Sunday as 1 (=Calendar.SUNDAY).
On the other hand, if you get a Date object with calendar.getTime() and get the day of the week with Date.getDay() method, Sunday becomes 0.

#### Introduction to New Date Standard (JSR-310)

A new API for date and time was added with the JSR-310 standard. It was influenced by several open sources like Joda Time, Time And Money, and ICU.

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

#### Practical Date API Usage

**Date Calculations**

```java
LocalDate today = LocalDate.now();
LocalDate nextWeek = today.plusWeeks(1);
LocalDate lastDayOfMonth = today.with(TemporalAdjusters.lastDayOfMonth());
LocalDate nextMonday = today.with(TemporalAdjusters.next(DayOfWeek.MONDAY));

// Period between two dates
Period period = Period.between(startDate, endDate);
long days = ChronoUnit.DAYS.between(startDate, endDate);
```

**Time Zone Handling**

```java
ZonedDateTime seoul = ZonedDateTime.of(
    LocalDateTime.of(2024, 1, 1, 9, 0),
    ZoneId.of("Asia/Seoul")
);

ZonedDateTime ny = seoul.withZoneSameInstant(ZoneId.of("America/New_York"));
// Seoul 9am = New York 7pm previous day
```

**Date Parsing and Formatting**

```java
DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
LocalDateTime dateTime = LocalDateTime.parse("2024-01-15 10:30:00", formatter);
String formatted = dateTime.format(formatter);
```

### Improved Meta-annotation Support

Meta-programming is used for development convenience and productivity. It's a development method where annotations are placed on methods or properties and information is dynamically retrieved.
Java 8 added the '@Repeatable' annotation, and annotations inherit Context. Almost everything can be expressed with annotations, including local variables, generic types, superclasses and interface implementations, and even method Exception definitions. For more details, refer to link [4].

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface Filters {
    Filter[] value();
}

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

### Concurrency API Improvements

* New methods added to java.util.concurrent.ConcurrentHashMap to support streams and lambda expressions
* java.util.concurrent.ForkJoinPool multi-core ExecutorService implementation (JDK7+) / ForkJoinPool.commonPool() method added so you can allocate without creating ForkJoinPool objects
* java.util.concurrent.locks.StampedLock was added to improve performance issues with java.util.concurrent.locks.ReadWriteLock. Not only is it faster by itself, but it also provides Optimistic Lock for even faster operation. See link [5] for details. See link [6] for performance comparison.
* Classes supporting atomic operations for counting/accumulation (DoubleAccumulator, DoubleAdder, LongAccumulator, LongAdder) were added. See link [5] for details.

#### CompletableFuture Usage

`CompletableFuture` was added in Java 8, making asynchronous programming even more convenient.

```java
// Creating async task
CompletableFuture<String> future = CompletableFuture.supplyAsync(() -> {
    return expensiveOperation();
});

// Chaining
CompletableFuture<Integer> result = future
    .thenApply(String::length)
    .thenApply(len -> len * 2);

// Combining
CompletableFuture<String> future1 = CompletableFuture.supplyAsync(() -> "Hello");
CompletableFuture<String> future2 = CompletableFuture.supplyAsync(() -> "World");

CompletableFuture<String> combined = future1
    .thenCombine(future2, (s1, s2) -> s1 + " " + s2);

// Exception handling
CompletableFuture<String> handled = future
    .exceptionally(ex -> "Error: " + ex.getMessage())
    .thenApply(s -> "Result: " + s);
```

### IO/NIO Extensions

### Methods added to IO/NIO related classes / Usability improvements through Stream API

```java
BufferedReader.lines();
Files.list (Path)
Files.walk (Path, int FileVisitOption ...)
Files.walk (Path, FileVisitOption ...)
Files.find (Path, int BiPredicate, FileVisitOption ...)
Files.lines (Path, Charset)
DirectoryStream.stream ()
```

Some of the added methods listed.

```java
Files.list(new File(".").toPath())
     .filter(p -> !p.getFileName().toString().startsWith("."))
     .limit(3)
     .forEach(System.out::println);
```

Example listing files that don't start with '.' in the current directory.

#### java.util.Base64 class added

```java
// Encoding
String asB64 = Base64.getEncoder().encodeToString("Hello, World!".getBytes("utf-8"));
System.out.println(asB64); // Equals to "SGVsbG8sIFdvcmxkIQ=="

// Decoding
byte[] asBytes = Base64.getDecoder().decode("SGVsbG8sIFdvcmxkIQ==");
System.out.println(new String(asBytes, "utf-8"));
```

### Removal of Permanent Generation from Heap

Cause of java.lang.OutOfMemoryError: PermGen error. (PermGen heap memory is not garbage collected. Causes are mainly indiscriminate Static variables + PermGen memory leaks due to HotSwap)

#### Changed JVM Options

PermGen related JVM options are now ignored, and new JVM options have been added.

* Removed JVM Options

```bash
-XX:PermSize # PermGen area size at JVM startup

-XX:MaxPermSize # PermGen area maximum size
```

* Added JVM Options

```bash
-XX:MetaspaceSize # Metaspace area size at JVM startup

-XX:MaxMetaspaceSize # Metaspace area maximum size (if not set, JVM adjusts automatically)

+@ -XX:MinMetaspaceFreeRatio # Metaspace minimum capacity ratio

+@ -XX:MaxMetaspaceFreeRatio # Metaspace maximum capacity ratio
```

#### PermGen to Metaspace

Refer to the content summarized in link [7] for detailed changes.

Briefly summarized as follows:

__Permanent until Java7__

1. Class Meta information (can be considered as pkg path information, text information)
2. Method Meta information
3. Static Object
4. Constant String Object
5. Array object Meta information related to class
6. JVM internal objects and JIT optimization information

__Metaspace and Heap separation in Java8__

1. Class Meta information -> Moved to Metaspace area
2. Method Meta information -> Moved to Metaspace area
3. Static Object -> Moved to Heap area
4. Constant String Object -> Moved to Heap area
5. Array object Meta information related to class -> Moved to Metaspace area
6. JVM internal objects and JIT optimization information -> Moved to Metaspace area

In summary:

* Heap area structure changed from __New / Survive / Old / Perm / Native__ to __New / Survive / Old / Metaspace__.

* Static Objects that were stored in PermGen area and caused problems were moved to Heap area to be GC targets as much as possible. (Static Final can't be helped...)

* Only information that doesn't need to be modified is stored in Metaspace, and Metaspace has been improved to a structure where JVM can resize as needed.

## Java 8 Migration Guide

### Existing Code Refactoring Checklist

**1. Convert Anonymous Classes to Lambdas**

```java
// Before
Runnable r = new Runnable() {
    @Override
    public void run() {
        System.out.println("Hello");
    }
};

// After
Runnable r = () -> System.out.println("Hello");
```

**2. Convert for Loops to Streams**

```java
// Before
List<String> names = new ArrayList<>();
for (User user : users) {
    if (user.isActive()) {
        names.add(user.getName());
    }
}

// After
List<String> names = users.stream()
    .filter(User::isActive)
    .map(User::getName)
    .collect(Collectors.toList());
```

**3. Convert Null Checks to Optional**

```java
// Before
String name = user != null ? user.getName() : "Unknown";

// After
String name = Optional.ofNullable(user)
    .map(User::getName)
    .orElse("Unknown");
```

**4. Convert Date/Calendar to New Date API**

```java
// Before
Calendar cal = Calendar.getInstance();
cal.set(2024, Calendar.JANUARY, 15);
Date date = cal.getTime();

// After
LocalDate date = LocalDate.of(2024, 1, 15);
```

### Migration Cautions

**Performance Considerations**

```java
// Streams may be slower for small collections
List<String> smallList = Arrays.asList("a", "b", "c");

// In such cases, traditional for-each may be more efficient
for (String s : smallList) {
    System.out.println(s);
}

// Streams are advantageous for large collections
largeCollection.stream()
    .filter(...)
    .map(...)
    .collect(...);
```

**Serialization Caution**

```java
// Lambdas can be serialized but it's not recommended
// Use explicit interfaces if necessary
@FunctionalInterface
public interface SerializableFunction<T, R> 
    extends Function<T, R>, Serializable {
}
```

## Troubleshooting

### Common Problems

**1. StreamAlreadyClosedException**

```java
// Bad example
Stream<String> stream = Files.lines(path);
stream.forEach(System.out::println);
stream.count(); // Exception!

// Good example
try (Stream<String> stream = Files.lines(path)) {
    stream.forEach(System.out::println);
}
```

**2. ConcurrentModificationException**

```java
// Bad example
List<String> list = new ArrayList<>(Arrays.asList("a", "b", "c"));
list.stream().forEach(s -> list.add(s.toUpperCase())); // Exception!

// Good example
List<String> upper = list.stream()
    .map(String::toUpperCase)
    .collect(Collectors.toList());
```

**3. NullPointerException in Streams**

```java
// Problem code
List<String> names = users.stream()
    .map(User::getName) // NPE if user is null
    .collect(Collectors.toList());

// Safe code
List<String> names = users.stream()
    .filter(Objects::nonNull)
    .map(User::getName)
    .collect(Collectors.toList());
```

## References

* [Java 8 Improvements Collection](http://blog.fupfin.com/?p=27)
* [Exploring Java 8](http://www.moreagile.net/2014/04/AllAboutJava8.html)
* [Java Date and Time API](http://d2.naver.com/helloworld/645609)
* [Java8 Meta Annotations](http://goodcodes.tistory.com/entry/Java-8-Feature-Annotation)
* [New Features in Java SE 8](http://www.yunsobi.com/blog/599)
* [StampedLock Performance Comparison](http://blog.takipi.com/java-8-stampedlocks-vs-readwritelocks-and-synchronized/)
* [Java8 New I/O API](https://blog.jooq.org/2014/01/24/java-8-friday-goodies-the-new-new-io-apis/)
* [Java8 PermGen to Metaspace](https://dzone.com/articles/java-8-permgen-metaspace)
