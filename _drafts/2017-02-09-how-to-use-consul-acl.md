---
layout: post
title:  How to use Consul ACL
date:   2017-02-09T18:48:15+09:00
categories: [all, consul]
permalink: /post/:year/:month/:day/:title
published: true
---

## Overview

Consul (컨설? 컨슐?) 에서 제공하는 ACL 기능에 대해서 간단하게 정리하고, 설정 및 사용법에 대해서 기술하고자 한다.

## Scope

* Consul-0.4 : KV Store 에 대한 ACL 정책 적용 가능
* Consul-0.5 : Service 까지 ACL 정책 적용 가능
* Consul-0.6+ : Service discovery / User events / Encryption keyring operation 까지 ACL 정책 적용 가능

## Design

* 모든 토큰은 `ID`, `name`, `type`, `rule set` 로 구성되어 있음
* `ID`는 랜덤하게 생성되는 UUID. RPC 요청으로 전달됨. Consul agent 설정에 `acl_token`을 정의하면 디폴트 토큰 ID로 사용됨. HTTP API 파라미터에 `?token=` 로 Override 가능
* `name`은 사용자가 읽을 수 있는 명칭. ACL의 목적을 나타내는 의미있는 네이밍이 필요함.
* `type`은 "client"(=ACL rule을 수정할 수 없는) 혹은 "management"(=모든 action이 허용된) 중에 하나임.
* `rule set`은 HCL (HashiCorp Configuration Language) 문법에 따라 작성된다.
```
```
* `acl_default_policy`는 토큰이 없을 때, ACL 기본 정책을 의미함. "allow", "deny" 중에 하나. 디폴트는 "allow"


## References
[1] [title](url){:target="_blank"}
