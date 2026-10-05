---
title: Various Terminology Used in the Workplace
description: "Terms I've used or picked up at work, such as MECE, dogfooding, ISO 8601, housekeeping jobs, and on-the-fly, written down so I don't forget them."
date: 2022-05-26T14:32:18+09:00
tags: [terminology, business, software-engineering]
---

I'm writing down terms I've used, or happened to learn, while communicating and working on the job, so I don't forget them and can look them up now and then.

## MECE

![Characteristics of MECE](https://img1.daumcdn.net/thumb/R1280x0/?scode=mtistory2&fname=https%3A%2F%2Fk.kakaocdn.net%2Fdn%2FbYCnyj%2FbtqJOzL4NOj%2F8agJdkErNXz8GC58hNZttk%2Fimg.png)
Source: [MECE, logical analysis without overlaps or gaps](https://techness.tistory.com/m/entry/%EC%A4%91%EB%B3%B5%EA%B3%BC-%EB%88%84%EB%9D%BD%EC%97%86%EB%8A%94-%EB%85%BC%EB%A6%AC%EC%A0%81-%EB%B6%84%EC%84%9D-MECE)

Short for [`Mutually Exclusive Collectively Exhaustive`](https://en.wikipedia.org/wiki/MECE_principle), it means splitting the options for solving a problem so that they don't overlap and nothing is left out. You could call it `no overlaps, no gaps`.

I know it's really a management term, but I think it applies just as well to software engineering. Removing duplicate code and keeping things simple while including every feature that's needed is what software design and development principles mostly talk about.

When picking action items to resolve an issue or sketching out software features, deliberately trying to apply this idea often led to a good design or solution.

**References**
- [How do you build software..? (I don't really know either)](https://velog.io/@junsugi/%EB%AC%BC%EC%98%A4%EB%A6%84%EB%8B%AC-%EC%97%B4%EC%97%BF%EC%83%88)
- [The basis of software design is MECE.](https://bigzero37.tistory.com/48)

---

## Dogfooding

The phrase reportedly became well known in 1988, when Microsoft manager Paul Maritz sent an internal email titled "Eating our own Dogfood" to test manager Brian Valentine, pushing employees to use the company's own products more. ([Wikipedia](https://en.wikipedia.org/wiki/Eating_your_own_dog_food))
It's a sort of slang (?) that means **the people who build software using it themselves**.


When I use software I built following the user scenarios, improvement points jump out at me, like 'wouldn't it be better to handle it this way?' or 'I didn't think about this part, I should fix it!'.

No matter how much I thought it through while designing or building software, I often missed things. Given that experience, I think it's important for developers to use their own product and improve it, with the mindset of giving users a more polished product.

---

## ISO 8601

[ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) is the standard for dates and times. Working with data that follows the standard cut down the waste of writing my own parsing or handling all sorts of edge cases. **When dealing with data, follow the standard whenever possible**.

---

## Ice breaking

Ice breaking is easing a stiff, tense atmosphere with a light topic before getting into the main discussion.
Formal discussions and work tend to create stiff, businesslike relationships, so it seems good to make good use of ice-breaking techniques.

---

## Housekeeping job

I often used this term for jobs that periodically do small chores on a server (log rotation, etc.).

---

## On-the-fly

I used it now and then to mean on the spot, as things come up.

When working with colleagues, I used it to mean I'd help right away whenever a request came in, and occasionally with something attached, like `on-the-fly transcoding` or `on-the-fly compression`, to mean the server processes something immediately.

---

**To be continued...**
