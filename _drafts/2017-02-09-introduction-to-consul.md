---
layout: post
title:  Consul 알아보기
date:   2017-02-09T00:15:26+09:00
categories: [all, consul]
permalink: /post/:year/:month/:day/:title
published: true
---

최근 회사에서 플랫폼 개발 프로젝트에 참여하면서 알게된 Consul 이라는 오픈소스에 대해서 정리해보고자 한다. 주로 서비스 설정을 관리하기 위한 공통 데이터 스토어 (Key-Value Store)와 서비스 헬스체크 정도로 활용하게 되었다. 대부분의 기능을 깊게 사용해본 것은 아니지만, 워낙 Consul 에 대한 문서가 존재하지 않아서 한번 정리해보고 싶었다.

Consul은 HashCorp라는 미국의 오픈소스 개발을 전문으로하는 기업에서 개발한 오픈소스 프로젝트로 최근 버전이 0.7.5까지 릴리즈 되었고, 아직도 활발하게 개발이 진행되고 있는 프로젝트이다. 몇 달전부터 Google groups 가입하여 이슈를 Follow 하고 있는데, 다양한 이슈들이 리포트되고 있고, 커미터들의 이슈 대응도 빠른 편이라 앞으로도 기대되는 프로젝트라고 생각한다. (역시 쉬운게 장땡이다...)

대체적으로 기능이 단순하고, 설정도 크게 복잡하지 않아서 사용하기 어렵지 않다. (물론, 메커니즘이나 가십 프로토콜 등의 구체적인 내용은 어렵다 -_-;)

처음에는 Consul이 또 다른 KV Store 정도로만 생각하고 사용하게 되었는데, 문서를 좀 더 읽어보니 다양한 데이터 구조와 명령 체계를 지원하는 Redis와는 비교 자체가 불가능하고 (Consul 이 너무 단순해서...), Consul은 계층 구조(=Key Prefix)의 간단한 KV 데이터를 저장할 수 있다.

사실 먼저 KV Store 에 대해서 언급을 하기는 했는데, Consul의 핵심 기능은 서비스 관리/헬스체크 기능이라 볼 수 있다. KV Store 는 이러한 데이터를 보관하기 위한 Internal Store 정도로 고려되었다가 적당히 쓸만하니 사용자도 필요한 경우 쓸 수 있게 오픈한 것이 아닐까하는 개인적인 생각이 있다.

`Consul은 서비스를 관리하고, 헬스체크 감지, 오류 발생 시 핸들링하는 기능`을 손쉽게 사용할 수 있도록 기능을 제공하는 하나의 솔루션이라고 보면 될 것 같다.

가이드 문서에는 Consul이 어떤 메커니즘에 의해 동작하는지, 가십(Gossip) 프로토콜이 무엇인지 등의 내용을 자세히 정리하고 있지만, 이러한 부분까지 상세히 정리하기에는 필자가 깊게 이해하지 못하고 있어서, 이번에는 `설치`하고 `설정`하고 `돌려`보고 간단하게 `서비스를 등록`한 뒤에 `헬스체크 설정`을 어떻게 하면 되는지의 응용의 관점에서 정리해보고자 한다.

## 설치해보자

Consul은 구글에서 개발한 프로그래밍 언어인 Golang으로 작성되었다. 소스를 빌드하여 사용할 경우, Go 1.8 이상을 필수로 사용해야 한다. 이번엔 사전에 빌드된 압축 파일을 [Consul 다운로드 페이지](https://www.consul.io/downloads.html) 에서 받아서 사용하고자 한다. linux-x64 기준으로 모든 예제가 작성될 예정이다.

```
$ wget https://releases.hashicorp.com/consul/0.7.5/consul_0.7.5_linux_amd64.zip
$ unzip consul_0.7.5_linux_amd64.zip
$ ll consul
-rwxr-xr-x 1 zicprit zicprit 35M  2월 15 04:15 consul
```

Golang 특성 상 압축을 풀면 바이너리 파일 하나만 나온다. 바이너리 파일을 `$PATH`에 잡아주도록 한다.

```
$ mkdir -p ~/bin
$ mv consul ~/bin
$ echo 'export PATH=$HOME/bin/consul:$PATH' > ~/.bash_profile
```

터미널에서 `consul` 커맨드라인을 입력해보면, 아래와 같이 나올 것이다. 정상적으로 나온다면 설치가 완료된 것이다.

```
$ consul
usage: consul [--version] [--help] <command> [<args>]

Available commands are:
    agent          Runs a Consul agent
    configtest     Validate config file
    event          Fire a new event
    exec           Executes a command on Consul nodes
    force-leave    Forces a member of the cluster to enter the "left" state
    info           Provides debugging information for operators
    join           Tell Consul agent to join cluster
    keygen         Generates a new encryption key
    keyring        Manages gossip layer encryption keys
    kv             Interact with the key-value store
    leave          Gracefully leaves the Consul cluster and shuts down
    lock           Execute a command holding a lock
    maint          Controls node or service maintenance mode
    members        Lists the members of a Consul cluster
    monitor        Stream logs from a Consul agent
    operator       Provides cluster-level tools for Consul operators
    reload         Triggers the agent to reload configuration files
    rtt            Estimates network round tri
```

## 설정해보자



## 참고 링크

[1] [Consul 공식 홈페이지](https://www.consul.io/)

[2] [Consul Github 프로젝트](https://github.com/hashicorp/consul)
