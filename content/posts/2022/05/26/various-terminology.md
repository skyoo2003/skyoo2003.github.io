---
title: 현업에서 사용했던 각종 용어들 정리
date: 2022-05-26T14:32:18+09:00
tags: [terminology, business, software-engineering]
---

현업에서 의사소통이나 업무를 수행할 때, 사용해보거나 우연히 알게된 용어들을 잊어버리지 않고 종종 찾아보기 위해서 기록해보려 한다. 소프트웨어 엔지니어링뿐만 아니라 비즈니스 전반에서 활용되는 용어들을 정리했다.

## 목차

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

![MECE의 특징](https://img1.daumcdn.net/thumb/R1280x0/?scode=mtistory2&fname=https%3A%2F%2Fk.kakaocdn.net%2Fdn%2FbYCnyj%2FbtqJOzL4NOj%2F8agJdkErNXz8GC58hNZttk%2Fimg.png)
출처: [중복과 누락없는 논리적 분석 MECE](https://techness.tistory.com/m/entry/%EC%A4%91%EB%B3%B5%EA%B3%BC-%EB%88%84%EB%9D%BD%EC%97%86%EB%8A%94-%EB%85%BC%EB%A6%AC%EC%A0%81-%EB%B6%84%EC%84%9D-MECE)

[`Mutually Exclusive Collectively Exhaustive`](https://ko.wikipedia.org/wiki/MECE)의 약자로 어떤 문제를 해결하기 위한 방안이 겹치지 않으면서 빠짐없이 나누는 것을 의미한다. `중복과 누락 없이`라고 할 수 있을 것이다.

### 정의

- **Mutually Exclusive (상호 배타적)**: 각 항목들이 서로 겹치지 않아야 함
- **Collectively Exhaustive (전체 포괄적)**: 모든 가능성을 빠짐없이 포함해야 함

### 소프트웨어 엔지니어링에서의 적용

사실 이 용어는 경영 관련 용어라고는 알고 있지만, 소프트웨어 엔지니어링에 적용하기에도 손색이 없다. 왜냐하면, 중복 코드를 없애고 단순하지만 필요한 기능을 모두 포함하는 것이 소프트웨어 설계나 개발 원칙에 주로 나오는 내용이기 때문이다.

**실제 적용 예시:**

1. **API 설계 시 에러 코드 분류**
   - 4xx: 클라이언트 오류 (400, 401, 403, 404...)
   - 5xx: 서버 오류 (500, 502, 503...)
   - 각 카테고리가 겹치지 않으면서 모든 에러 케이스를 커버

2. **테스트 케이스 작성**
   - 정상 케이스 (Happy Path)
   - 경계값 케이스 (Edge Cases)
   - 예외 케이스 (Error Cases)

3. **마이크로서비스 도메인 분리**
   - 사용자 서비스
   - 주문 서비스
   - 결제 서비스
   - 각 서비스가 독립적이면서 전체 비즈니스를 커버

이슈를 해결하기 위한 액션 아이템들을 선별할 때나 소프트웨어 기능을 구상할 때는 이 개념을 의도적으로 사용하려고 노력하면 좋은 설계나 해결 방안을 도출하는 경우가 많았다.

**참고 링크**
- [소프트웨어는 어떻게 만들죠..?](https://velog.io/@junsugi/%EB%AC%BC%EC%98%A4%EB%A6%84%EB%8B%AC-%EC%97%B4%EC%97%BF%EC%83%88)
- [소프트웨어 설계의 기본은 MECE 이다](https://bigzero37.tistory.com/48)

---

## Dogfooding

1988년, 마이크로소프트의 매니저였던 Paul Maritz가 "Eating our own Dogfood"라는 제목의 내부 이메일에서 테스트 매니저 Brian Valentine에게 직원들이 자사 제품을 더 쓰도록 강요하면서 많이 유명해진 말이다. ([위키 문서](https://en.wikipedia.org/wiki/Eating_your_own_dog_food))

### 정의

한글로 번역하면 `개밥 먹기`라고 하는 일종의 속어로 **소프트웨어를 만드는 사람이 직접 써보는 행위**를 의미한다.

### 소프트웨어 개발에서의 중요성

사용자 시나리오에 따라 내가 만든 소프트웨어를 사용하다보면, 다음과 같은 개선 포인트들이 눈에 들어온다:

- '이렇게 처리하는 게 더 좋겠는데?'
- '이 부분은 고려하지 못했는데 보완을 해야겠군!'
- '이 에러 메시지는 사용자가 이해하기 어렵겠네'

### 실제 사례

| 회사 | 제품 | Dogfooding 방식 |
|------|------|-----------------|
| Microsoft | Windows | 내부 빌드를 먼저 사용 |
| Google | Gmail, Docs | 사내에서 먼저 배포 |
| Slack | Slack | 자사 커뮤니케이션 도구로 사용 |
| Airbnb | Airbnb | 직원들이 직접 숙소 예약 |

소프트웨어를 설계하거나 개발하는 과정에서 아무리 고민하더라도 놓치는 경우가 종종 있다. 이런 경험에 비추어볼 때, 사용자에게는 좀 더 완성도 있는 제품을 제공하겠다는 마인드로 소프트웨어 개발자가 직접 제품을 써보고 보완하는 과정이 중요하다.

---

## ISO 8601

[ISO 8601](https://ko.wikipedia.org/wiki/ISO_8601)은 날짜와 시간 관련된 국제 표준 규격이다.

### 표준 형식

```
날짜: YYYY-MM-DD (예: 2024-01-15)
시간: hh:mm:ss (예: 14:30:00)
날짜와 시간: YYYY-MM-DDThh:mm:ssZ (예: 2024-01-15T14:30:00Z)
```

### 소프트웨어 개발에서의 중요성

표준을 준수하는 데이터를 다루면 다음과 같은 이점이 있다:

1. **파싱 복잡도 감소**: 다양한 날짜 형식을 처리하는 코드 불필요
2. **국제화 지원**: 시간대 처리가 명확
3. **정렬 용이**: 문자열 정렬로 시간순 정렬 가능
4. **디버깅 편의**: 로그에서 시간 파악이 쉬움

### 실제 적용 예시

```python
# Python
from datetime import datetime

now = datetime.now()
iso_format = now.isoformat()  # 2024-01-15T14:30:00.123456

# JavaScript
const now = new Date();
const isoString = now.toISOString();  // 2024-01-15T14:30:00.123Z
```

**데이터를 다룰 땐, 가급적 표준을 준수하자.**

---

## Ice Breaking

본격적인 이야기로 넘어가기 전 편안한 화제로 딱딱하고 긴장된 분위기를 푸는 과정을 아이스 브레이킹이라고 한다.

### 목적

- 참가자 간의 심리적 장벽 완화
- 자유로운 의사소통 환경 조성
- 창의적 아이디어 발산 유도
- 팀 빌딩 및 신뢰 형성

### 실무에서의 활용

아무래도 공식적인 논의나 업무 상에는 경직되고 사무적인 관계가 형성되는 경우가 있는데, 아이스 브레이킹 기법들을 잘 활용하면 효과적이다.

**간단한 아이스 브레이킹 기법들:**

1. **Two Truths and a Lie**: 참가자가 사실 2개와 거짓 1개를 말하고 맞추기
2. **Check-in Question**: "오늘 기분을 날씨로 표현하면?"
3. **Quick Poll**: "아침형 인간 vs 올빼미형 인간"
4. **Photo Share**: "최근 찍은 사진 하나 공유하기"

---

## Housekeeping Job

서버에서 소소한 잡일(로그 로테이팅 등)을 주기적으로 수행하는 작업들을 일컫는 용어로 종종 사용한다.

### 대표적인 Housekeeping 작업

| 작업 | 설명 | 주기 |
|------|------|------|
| Log Rotation | 오래된 로그 파일 압축/삭제 | 일별/주별 |
| Temp File Cleanup | 임시 파일 정리 | 시간별 |
| Session Cleanup | 만료된 세션 정리 | 분별 |
| Database Vacuum | DB 최적화 | 주별/월별 |
| Cache Invalidation | 오래된 캐시 제거 | 시간별 |
| Backup Rotation | 오래된 백업 삭제 | 주별 |

### 구현 예시 (Cron)

```cron
# 매일 자정 로그 로테이션
0 0 * * * /usr/sbin/logrotate /etc/logrotate.conf

# 매시간 임시 파일 정리
0 * * * * find /tmp -type f -mtime +1 -delete

# 매주 일요일 DB 최적화
0 3 * * 0 /usr/bin/vacuumdb -a -f -q
```

---

## On-the-fly

즉석에서, 그때 그때 되는 대로라는 의미로 가끔씩 사용한다.

### 소프트웨어에서의 의미

1. **실시간 처리**: 요청이 들어왔을 때 즉시 처리
2. **동적 생성**: 미리 준비하지 않고 필요할 때 생성
3. **스트리밍**: 전체를 다운로드하지 않고 실시간으로 처리

### 실제 사용 예시

**협업에서의 사용:**
- "이슈 발생하면 on-the-fly로 지원해드릴게요"
- 요청이 오면 바로바로 지원해주겠다는 의미

**기술적 사용:**
- `On-the-fly transcoding`: 서버에서 실시간으로 비디오 포맷 변환
- `On-the-fly compression`: 전송하면서 즉시 압축
- `On-the-fly encryption`: 저장하면서 즉시 암호화

### 장단점

| 장점 | 단점 |
|------|------|
| 저장 공간 절약 | 처리 지연 발생 가능 |
| 항상 최신 데이터 | CPU 사용량 증가 |
| 유연한 대응 | 예측 어려운 성능 |

---

## SLA/SLO/SLI

서비스 신뢰성을 측정하고 관리하는 지표들이다.

### 정의

| 용어 | 풀네임 | 설명 |
|------|--------|------|
| **SLA** | Service Level Agreement | 서비스 수준 협약 (계약) |
| **SLO** | Service Level Objective | 서비스 수준 목표 |
| **SLI** | Service Level Indicator | 서비스 수준 지표 |

### 관계

```
SLI (측정) → SLO (목표 설정) → SLA (계약)
```

### 실제 예시

**가용성 (Availability):**
- SLI: 실제 가동 시간 / 전체 시간 × 100
- SLO: 99.9% 가용성 목표
- SLA: 99.9% 미달 시 서비스 크레딧 지급

**응답 시간 (Latency):**
- SLI: P95 응답 시간
- SLO: P95 응답 시간 200ms 이하
- SLA: 500ms 초과 시 보상

---

## Dogpile Effect

캐시가 만료되었을 때 여러 요청이 동시에 원본 데이터를 가져오려는 현상이다.

### 문제 상황

```
1. 캐시 만료
2. 동시에 100개 요청 도착
3. 100개 요청 모두 DB 쿼리 실행
4. DB 부하 급증 → 장애
```

### 해결 방법

**1. Mutex/Lock 사용:**
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
# 만료 전 미리 갱신
if cache.ttl(key) < 60:  # 60초 남았으면 갱신
    background_task(refresh_cache, key)
```

---

## Thundering Herd

특정 이벤트(서버 재시작, 네트워크 복구 등)로 인해 대량의 요청이 동시에 발생하는 현상이다.

### 발생 시나리오

1. DB 서버 재시작
2. 대기 중이던 수천 개의 연결 시도
3. 동시에 연결 시도 → DB 과부하
4. 연결 실패 → 재시도 → 악순환

### 해결 방법

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

**2. Jitter 추가:**
```python
# 모든 클라이언트가 같은 시간에 재시도하는 것을 방지
wait = base_wait + random.uniform(0, 1)
```

---

## Zero Trust

"신뢰하지 않는다, 항상 검증한다"는 보안 원칙이다.

### 핵심 원칙

1. **Never Trust, Always Verify**: 모든 접근을 검증
2. **Least Privilege**: 최소 권한만 부여
3. **Assume Breach**: 침해됐다고 가정하고 설계

### 전통적 모델 vs Zero Trust

| 구분 | 전통적 모델 | Zero Trust |
|------|------------|------------|
| 신뢰 경계 | 네트워크 경계 | 없음 |
| 인증 | 1회 (로그인 시) | 지속적 |
| 권한 | 광범위 | 최소한 |
| 모니터링 | 선택적 | 모든 활동 |

---

## Shift Left

개발 수명주기의 초기 단계에서 품질 관리 활동을 수행하는 접근 방식이다.

### 전통적 vs Shift Left

```
전통적: [개발] → [테스트] → [배포] → [보안]
Shift Left: [개발 + 테스트 + 보안] → [배포]
```

### 적용 분야

| 분야 | Shift Left 활동 |
|------|-----------------|
| 테스트 | TDD, 단위 테스트 |
| 보안 | SAST, 코드 리뷰 |
| 성능 | 초기 부하 테스트 |
| 운영 | IaC, DevOps |

### 이점

- 버그 조기 발견 → 수정 비용 절감
- 배포 속도 향상
- 품질 향상
- 개발자 역량 강화

---

## Technical Debt

빠른 개발을 위해 당장은 효율적이지만 장기적으로는 추가 비용이 발생하는 선택을 의미한다.

### 유형

1. **의도적 부채**: 일정 맞추기 위해 의식적으로 품질 희생
2. **무의식적 부채**: 경험 부족이나 지식 부족으로 발생
3. **비트 부채**: 소프트웨어 노화로 인한 부채

### 관리 방법

```
1. 부채 기록 (Issue, Wiki)
2. 우선순위 지정 (영향도 × 긴급도)
3. 상환 계획 수립 (스프린트마다 할애)
4. 모니터링 (코드 복잡도, 커버리지)
```

### 부채 vs 투자

| 상황 | 선택 | 이유 |
|------|------|------|
| MVP 개발 | 부채 허용 | 빠른 시장 검증 |
| 핵심 기능 | 부채 최소화 | 장기적 유지보수 |
| POC | 부채 무관 | 폐기 예정 |

---

**To be continued...**

지속적으로 새로운 용어를 발견할 때마다 이 문서를 업데이트할 예정이다. 소프트웨어 엔지니어로서 비즈니스와 기술 양쪽에서 사용되는 용어를 이해하는 것은 효과적인 커뮤니케이션의 핵심이다.
