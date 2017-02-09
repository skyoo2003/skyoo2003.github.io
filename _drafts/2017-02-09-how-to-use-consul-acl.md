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
* `ID`는 랜덤하게 생성되는 UUID. RPC 요청으로 전달됨. 설정에 `acl_token`을 셋팅하면 기본 토큰 ID로 전달 됨. `?token=` 파라미터로 Override 가능
* `name`은 명확하진 않지만 사용자가 읽을 수 있는 명칭
* `type`은 "client"(=ACL rule을 수정할 수 없는) 혹은 "management"(=모든 action이 허용된) 중에 하나임.
* `rule set`

## References
[1] [title](url){:target="_blank"}
