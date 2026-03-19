---
title: Various Terminology Used in the Workplace
date: 2022-05-26T14:32:18+09:00
tags: [terminology, business, software-engineering]
---

I'm documenting terms I've encountered or learned while communicating and working in the workplace, so I won't forget them and can refer back to them occasionally. This collection covers terminology used not only in software engineering but across business in general.

## Table of Contents

1. [MECE](#mece)
2. [Dogfooding](#dogfooding)
3. [ISO 8601](#iso-8601)
4. [Ice Breaking](#ice-breaking)
5. [Housekeeping Job](#housekeeping-job)
6. [On-the-fly](#on-the-fly)
7. [SLA/SLO/SLI](#sla-slo-sli)
8. [Dogpile Effect](#dogpile-effect)
9. [Thundering Herd](#thundering-herd)
10. [Zero Trust](#zero-trust)
11. [Shift Left](#shift-left)
12. [Technical Debt](#technical-debt)

---

## MECE

![MECE Characteristics](https://img1.daumcdn.net/thumb/R1280x0/?scode=mtistory2&fname=https%3A%2F%2Fk.kakaocdn.net%2Fdn%2FbYCnyj%2FbtqJOzL4NOj%2F8agJdkErNXz8GC58hNZttk%2Fimg.png)
Source: [Logical Analysis MECE without Duplication and Omission](https://techness.tistory.com/m/entry/%EC%A4%91%EB%B3%B5%EA%B3%BC-%EB%88%84%EB%9D%BD%EC%97%86%EB%8A%94-%EB%85%BC%EB%A6%AC%EC%A0%81-%EB%B6%84%EC%84%9D-MECE)

[`Mutually Exclusive Collectively Exhaustive`](https://en.wikipedia.org/wiki/MECE) is an acronym meaning dividing solutions to a problem so they don't overlap while covering everything completely. In other words, `without duplication and omission`.

### Definition

- **Mutually Exclusive**: Items should not overlap with each other
- **Collectively Exhaustive**: All possibilities should be included without exception

### Application in Software Engineering

While this term is known as a business management concept, it's equally applicable to software engineering. This is because eliminating duplicate code while keeping things simple but including all necessary functionality is a common principle in software design and development.

**Practical Application Examples:**

1. **Error Code Classification in API Design**
   - 4xx: Client errors (400, 401, 403, 404...)
   - 5xx: Server errors (500, 502, 503...)
   - Each category doesn't overlap while covering all error cases

2. **Writing Test Cases**
   - Normal cases (Happy Path)
   - Boundary cases (Edge Cases)
   - Exception cases (Error Cases)

3. **Microservice Domain Separation**
   - User Service
   - Order Service
   - Payment Service
   - Each service is independent while covering the entire business

When selecting action items to resolve issues or conceptualizing software features, intentionally using this concept often leads to good designs and solutions.

**References**
- [How do you make software..?](https://velog.io/@junsugi/%EB%AC%BC%EC%98%A4%EB%A6%84%EB%8B%AC-%EC%97%B4%EC%97%BF%EC%83%88)
- [The Foundation of Software Design is MECE](https://bigzero37.tistory.com/48)

---

## Dogfooding

In 1988, Paul Maritz, a manager at Microsoft, sent an internal email titled "Eating our own Dogfood" to test manager Brian Valentine, urging employees to use more of their own products, which made the term famous. ([Wiki Article](https://en.wikipedia.org/wiki/Eating_your_own_dog_food))

### Definition

Translated literally as `eating dog food`, this is a slang term meaning **the act of software creators using their own products**.

### Importance in Software Development

When using your own software according to user scenarios, improvement points become visible:

- 'This could be handled better this way!'
- 'I didn't consider this part, need to improve it!'
- 'This error message would be hard for users to understand'

### Real-World Examples

| Company | Product | Dogfooding Method |
|---------|---------|-------------------|
| Microsoft | Windows | Using internal builds first |
| Google | Gmail, Docs | Deploying internally first |
| Slack | Slack | Using as internal communication tool |
| Airbnb | Airbnb | Employees booking accommodations themselves |

No matter how much thought goes into software design and development, things are often missed. Based on this experience, the process of developers directly using and improving products with the mindset of providing a more complete product to users is important.

---

## ISO 8601

[ISO 8601](https://en.wikipedia.org/wiki/ISO_8601) is an international standard for date and time representations.

### Standard Format

```
Date: YYYY-MM-DD (e.g., 2024-01-15)
Time: hh:mm:ss (e.g., 14:30:00)
Date and Time: YYYY-MM-DDThh:mm:ssZ (e.g., 2024-01-15T14:30:00Z)
```

### Importance in Software Development

Handling data that follows standards has the following benefits:

1. **Reduced Parsing Complexity**: No need for code to handle various date formats
2. **Internationalization Support**: Clear timezone handling
3. **Easy Sorting**: Chronological sorting possible with string sorting
4. **Debugging Convenience**: Easy to identify times in logs

### Practical Application Examples

```python
# Python
from datetime import datetime

now = datetime.now()
iso_format = now.isoformat()  # 2024-01-15T14:30:00.123456

# JavaScript
const now = new Date();
const isoString = now.toISOString();  // 2024-01-15T14:30:00.123Z
```

**When handling data, try to follow standards whenever possible.**

---

## Ice Breaking

The process of using comfortable topics to ease a stiff and tense atmosphere before moving on to serious discussions.

### Purpose

- Reducing psychological barriers between participants
- Creating an environment for free communication
- Encouraging creative idea generation
- Team building and trust formation

### Usage in Practice

Official discussions and work often create stiff and formal relationships, but using ice breaking techniques effectively can be beneficial.

**Simple Ice Breaking Techniques:**

1. **Two Truths and a Lie**: Participants tell two truths and one lie, others guess
2. **Check-in Question**: "If you described today's mood as weather?"
3. **Quick Poll**: "Morning person vs Night owl"
4. **Photo Share**: "Share one recent photo"

---

## Housekeeping Job

A term used to describe tasks performed periodically on servers for minor maintenance (log rotation, etc.).

### Representative Housekeeping Tasks

| Task | Description | Frequency |
|------|-------------|-----------|
| Log Rotation | Compress/delete old log files | Daily/Weekly |
| Temp File Cleanup | Clean up temporary files | Hourly |
| Session Cleanup | Clean up expired sessions | Per minute |
| Database Vacuum | DB optimization | Weekly/Monthly |
| Cache Invalidation | Remove old cache | Hourly |
| Backup Rotation | Delete old backups | Weekly |

### Implementation Example (Cron)

```cron
# Log rotation daily at midnight
0 0 * * * /usr/sbin/logrotate /etc/logrotate.conf

# Clean temp files every hour
0 * * * * find /tmp -type f -mtime +1 -delete

# DB optimization every Sunday
0 3 * * 0 /usr/bin/vacuumdb -a -f -q
```

---

## On-the-fly

Meaning "on the spot" or "as it happens," used occasionally.

### Meaning in Software

1. **Real-time Processing**: Processing immediately when a request comes in
2. **Dynamic Generation**: Creating things when needed rather than in advance
3. **Streaming**: Processing in real-time without downloading everything

### Actual Usage Examples

**In Collaboration:**
- "If issues arise, I'll support you on-the-fly"
- Meaning providing support immediately when requests come in

**Technical Usage:**
- `On-the-fly transcoding`: Real-time video format conversion on server
- `On-the-fly compression`: Immediate compression during transmission
- `On-the-fly encryption`: Immediate encryption during storage

### Pros and Cons

| Advantages | Disadvantages |
|------------|---------------|
| Saves storage space | Possible processing delay |
| Always latest data | Increased CPU usage |
| Flexible response | Unpredictable performance |

---

## SLA/SLO/SLI

Metrics for measuring and managing service reliability.

### Definitions

| Term | Full Name | Description |
|------|-----------|-------------|
| **SLA** | Service Level Agreement | Service level contract |
| **SLO** | Service Level Objective | Service level objective |
| **SLI** | Service Level Indicator | Service level indicator |

### Relationship

```
SLI (Measurement) → SLO (Goal Setting) → SLA (Contract)
```

### Practical Examples

**Availability:**
- SLI: Actual uptime / Total time × 100
- SLO: 99.9% availability target
- SLA: Service credit if below 99.9%

**Latency:**
- SLI: P95 response time
- SLO: P95 response time under 200ms
- SLA: Compensation if exceeding 500ms

---

## Dogpile Effect

A phenomenon where multiple requests simultaneously try to fetch original data when cache expires.

### Problem Scenario

```
1. Cache expires
2. 100 requests arrive simultaneously
3. All 100 requests execute DB queries
4. DB load spikes → Failure
```

### Solutions

**1. Using Mutex/Lock:**
```python
def get_data(key):
    data = cache.get(key)
    if data is None:
        with distributed_lock(key):
            data = cache.get(key)  # Double check
            if data is None:
                data = db.query(key)
                cache.set(key, data, ttl=3600)
    return data
```

**2. Cache Warming:**
```python
# Refresh before expiration
if cache.ttl(key) < 60:  # If 60 seconds left, refresh
    background_task(refresh_cache, key)
```

---

## Thundering Herd

A phenomenon where a large number of requests occur simultaneously due to specific events (server restart, network recovery, etc.).

### Occurrence Scenario

1. DB server restarts
2. Thousands of pending connection attempts
3. All try to connect simultaneously → DB overload
4. Connection failure → Retry → Vicious cycle

### Solutions

**1. Exponential Backoff:**
```python
import time
import random

def connect_with_backoff(max_retries=5):
    for attempt in range(max_retries):
        try:
            return db.connect()
        except ConnectionError:
            wait = (2 ** attempt) + random.random()
            time.sleep(wait)
```

**2. Adding Jitter:**
```python
# Prevent all clients from retrying at the same time
wait = base_wait + random.uniform(0, 1)
```

---

## Zero Trust

A security principle of "never trust, always verify."

### Core Principles

1. **Never Trust, Always Verify**: Verify all access
2. **Least Privilege**: Grant minimum permissions
3. **Assume Breach**: Design assuming compromise

### Traditional Model vs Zero Trust

| Aspect | Traditional Model | Zero Trust |
|--------|-------------------|------------|
| Trust Boundary | Network perimeter | None |
| Authentication | Once (at login) | Continuous |
| Permissions | Broad | Minimal |
| Monitoring | Selective | All activity |

---

## Shift Left

An approach of performing quality control activities in the early stages of the development lifecycle.

### Traditional vs Shift Left

```
Traditional: [Development] → [Testing] → [Deployment] → [Security]
Shift Left: [Development + Testing + Security] → [Deployment]
```

### Application Areas

| Area | Shift Left Activities |
|------|----------------------|
| Testing | TDD, Unit tests |
| Security | SAST, Code reviews |
| Performance | Early load testing |
| Operations | IaC, DevOps |

### Benefits

- Early bug detection → Reduced fix costs
- Faster deployment
- Improved quality
- Enhanced developer capabilities

---

## Technical Debt

Choices that are efficient in the short term for fast development but incur additional costs in the long run.

### Types

1. **Intentional Debt**: Consciously sacrificing quality to meet deadlines
2. **Unintentional Debt**: Occurring due to lack of experience or knowledge
3. **Bit Rot**: Debt from software aging

### Management Methods

```
1. Document debt (Issue, Wiki)
2. Set priorities (Impact × Urgency)
3. Create repayment plan (Allocate each sprint)
4. Monitor (Code complexity, coverage)
```

### Debt vs Investment

| Situation | Choice | Reason |
|-----------|--------|--------|
| MVP Development | Accept debt | Quick market validation |
| Core Features | Minimize debt | Long-term maintenance |
| POC | Debt irrelevant | Planned for disposal |

---

**To be continued...**

I plan to continuously update this document whenever I discover new terminology. As a software engineer, understanding terms used in both business and technology is key to effective communication.
