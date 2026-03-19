---
title: "ACOR v1.3.0: 커맨드라인 도구 소개"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, tutorial]
---

## 들어가며

[ACOR](https://github.com/skyoo2003/acor) v1.3.0에서 새로운 커맨드라인 도구 `acor`가 추가되었다. 이제 Go 코드를 작성하지 않고도 터미널에서 바로 Aho-Corasick 오토마톤을 조작할 수 있다. 이 포스트에서는 CLI의 주요 기능과 사용법을 살펴본다.

## 설치

### 바이너리 다운로드

GitHub Releases에서 플랫폼별 바이너리를 다운로드할 수 있다:

```bash
# macOS (Apple Silicon)
curl -LO https://github.com/skyoo2003/acor/releases/download/v1.3.0/acor_1.3.0_darwin_arm64.tar.gz
tar xzf acor_1.3.0_darwin_arm64.tar.gz
sudo mv acor /usr/local/bin/

# Linux (x86_64)
curl -LO https://github.com/skyoo2003/acor/releases/download/v1.3.0/acor_1.3.0_linux_amd64.tar.gz
tar xzf acor_1.3.0_linux_amd64.tar.gz
sudo mv acor /usr/local/bin/
```

### 소스에서 빌드

```bash
git clone https://github.com/skyoo2003/acor.git
cd acor
make build
```

빌드된 바이너리는 `bin/acor`에 생성된다.

## 기본 사용법

### Redis 연결 옵션

CLI는 다양한 Redis 토폴로지를 지원한다:

```bash
# Standalone
acor -addr localhost:6379 -name mycollection <command>

# Sentinel
acor -addrs localhost:26379,localhost:26380 -master-name mymaster -name mycollection <command>

# Cluster
acor -addrs localhost:7000,localhost:7001,localhost:7002 -name mycollection <command>
```

### 공통 옵션

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `-addr` | Redis 단일 주소 | `localhost:6379` |
| `-addrs` | Sentinel/Cluster 주소 목록 (쉼표 구분) | |
| `-master-name` | Sentinel 마스터 이름 | |
| `-ring-addrs` | Ring 샤드 (형식: `name1=addr1,name2=addr2`) | |
| `-password` | Redis 비밀번호 | |
| `-db` | Redis 데이터베이스 번호 | `0` |
| `-name` | ACOR 컬렉션 이름 | (필수) |

## 주요 명령어

### add - 키워드 추가

```bash
acor -addr localhost:6379 -name sample add "he"
acor -addr localhost:6379 -name sample add "her"
acor -addr localhost:6379 -name sample add "him"
```

### remove - 키워드 삭제

```bash
acor -addr localhost:6379 -name sample remove "him"
```

### find - 텍스트 검색

```bash
acor -addr localhost:6379 -name sample find "he is him"
# 출력: he
#       him
```

### find-index - 위치 정보와 함께 검색

```bash
acor -addr localhost:6379 -name sample find-index "he is him"
# 출력: he: [0]
#       him: [6]
```

### suggest - 자동완성 제안

```bash
acor -addr localhost:6379 -name sample suggest "he"
# 출력: he
#       her
```

### suggest-index - 위치 정보와 함께 자동완성

```bash
acor -addr localhost:6379 -name sample suggest-index "he"
# 출력: he: [0]
#       her: [0]
```

### info - 컬렉션 정보

```bash
acor -addr localhost:6379 -name sample info
# 출력: Collection: sample
#       Keywords: 3
```

### flush - 컬렉션 삭제

```bash
acor -addr localhost:6379 -name sample flush
# 컬렉션의 모든 데이터 삭제
```

## 실전 예제

### 스팸 키워드 관리

```bash
# 스팸 키워드 컬렉션 생성
acor -addr localhost:6379 -name spam add "viagra"
acor -addr localhost:6379 -name spam add "lottery"
acor -addr localhost:6379 -name spam add "winner"

# 메시지 검사
acor -addr localhost:6379 -name spam find "Congratulations! You are a lottery winner!"
# 출력: lottery
#       winner
```

### 파일에서 키워드 일괄 등록

```bash
# 키워드 파일 (한 줄에 하나씩)
cat keywords.txt
# he
# she
# his
# her
# him

# 일괄 등록
while read keyword; do
  acor -addr localhost:6379 -name sample add "$keyword"
done < keywords.txt
```

### 파이프라인으로 검색

```bash
# 텍스트 파일에서 스팸 키워드 검색
cat message.txt | xargs -0 acor -addr localhost:6379 -name spam find
```

## 입력 검증

CLI는 시작 시 Redis 토폴로지 옵션을 검증한다. 잘못된 옵션은 즉시 에러를 반환한다:

```bash
# 빈 주소
acor -addrs "," info
# 에러: invalid -addrs: empty address

# 잘못된 Ring 형식
acor -ring-addrs "invalid" info
# 에러: invalid -ring-addrs: expected format name=addr
```

## 마치며

v1.3.0의 CLI 도구로 ACOR을 더 쉽게 사용할 수 있게 되었다. 스크립트와 결합하여 자동화하거나, 빠르게 테스트할 때 유용하다.

더 자세한 내용은 [ACOR GitHub 저장소](https://github.com/skyoo2003/acor)와 [공식 문서](https://skyoo2003.github.io/acor/)를 참고하자.
