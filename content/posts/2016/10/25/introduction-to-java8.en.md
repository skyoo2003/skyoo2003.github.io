---
title: Exploring Java 8
description: "An overview of what Java 8 added: lambda expressions, the Stream API, default methods, the java.time date API, concurrency and NIO improvements, and PermGen removal."
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
        return a.getValue() - b.getValue();
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

Lambda expressions support 'type inference', so the compiler can infer the type of parameters without explicitly declaring them. Since you don't need to declare explicitly, the amount of code is reduced.

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

Calling `parallelStream()` instead of `stream()` gives you parallel processing too. But if the data isn't large enough it can actually be slower, and mutating shared state like an `ArrayList` inside the lambda can break the result, so collect with `collect()` instead.

```java
// Mutating shared state (X) - elements can go missing or an exception can be thrown.
List<Integer> results = new ArrayList<>();
IntStream.range(0, 1000).parallel().forEach(results::add);

// Collecting with collect (O)
List<Integer> results = IntStream.range(0, 1000).parallel()
	.boxed()
	.collect(Collectors.toList());
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
* java.util.concurrent.CompletableFuture was added, so async tasks can be chained or combined with `thenApply`, `thenCombine`, and so on. (The old Future only let you block on get().)

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

Cause of java.lang.OutOfMemoryError: PermGen error. (PermGen is only cleaned up during a Full GC and has a fixed size. Causes are mainly indiscriminate Static variables + PermGen memory leaks due to HotSwap)

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

* The heap changed from __New / Survive / Old / Perm__ to __New / Survive / Old__, and the metadata that lived in Perm moved to __Metaspace__ in native memory, not the heap.

* Static Objects that were stored in PermGen area and caused problems were moved to Heap area to be GC targets as much as possible. (Static Final can't be helped...)

* Only information that doesn't need to be modified is stored in Metaspace, and Metaspace has been improved to a structure where JVM can resize as needed.

## References

* [Java 8 Improvements Collection](http://blog.fupfin.com/?p=27)
* [Exploring Java 8](http://www.moreagile.net/2014/04/AllAboutJava8.html)
* [Java Date and Time API](http://d2.naver.com/helloworld/645609)
* [Java8 Meta Annotations](http://goodcodes.tistory.com/entry/Java-8-Feature-Annotation)
* [New Features in Java SE 8](http://www.yunsobi.com/blog/599)
* [StampedLock Performance Comparison](http://blog.takipi.com/java-8-stampedlocks-vs-readwritelocks-and-synchronized/)
* [Java8 New I/O API](https://blog.jooq.org/2014/01/24/java-8-friday-goodies-the-new-new-io-apis/)
* [Java8 PermGen to Metaspace](https://dzone.com/articles/java-8-permgen-metaspace)
