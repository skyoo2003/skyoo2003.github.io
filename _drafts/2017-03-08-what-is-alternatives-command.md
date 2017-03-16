---
layout: post
title:  alternatives 명령어 알아보기
date:   2017-03-08T16:25:41+0900
categories: [all, linux]
permalink: /post/:year/:month/:day/:title
published: true
---

`alternatives`는 심볼릭 링크를 생성, 제거, 관리, 조회할 수 있는 기능을 제공하는 GNU 라이센스의 커맨드라인 툴 입니다. 즉, 심볼릭 링크를 통해서 특정 커맨드에 대해 디폴트 버전 혹은 경로를 정의할 수 있습니다.

종종 하나의 시스템에서 여러 버전으로 구분된 프로그램을 설치하고 사용할 수 있습니다.

이해를 쉽게하기 위해, 각각의 기능을 설명할 때, 메이븐을 시스템에 설치한 뒤에 심볼릭 링크로 연결하는 방법을 정리하도록 하겠습니다. 때문에 메이븐이 `/usr/lib/maven-*` 경로에 설치되어 있다고 가정합니다. 해당 툴은 메이븐 이외의 다른 응용도 충분히 가능합니다.

## 심볼릭 링크 생성하기 (--install)

`--install` 액션을 수행하면, `/etc/alternatives` 에 `<name>`으로 지정한 이름으로 생성되고 `<path>`의 경로로 심볼릭 링크가 생성됩니다. 이후, `<link>` 에 명시된 경로에 `/etc/alternatives/<name>` 의 심볼릭 링크를 연결해줍니다.

커맨드라인 사용법은 아래와 같습니다. 주의할 점은, `--initscript` 옵션은 Redhat 리눅스에서만 동작합니다.

```bash
$ alternatives --install <link> <name> <path> <priority>
               [--initscript <service>]
               [--family <family>]
               [--slave <link> <name> <path>]*

<link> : 심볼릭 링크의 경로를 입력합니다.
<name> : /etc/alternatives 에 생성될 심볼릭 링크의 이름을 입력합니다.
<path> : 심볼릭 링크가 연결될 패키지의 경로를 입력합니다.
<priority> : 동일 심볼링 링크명을 사용할 경우, 우선순위가 높은 경로를 먼저 사용합니다.
```

```bash
# /usr/local/bin/mvn 심볼릭 링크에 3.3.3 연결
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/maven-3.3.3/bin/mvn 30303

# /usr/local/bin/mvn 심볼릭 링크에 3.3.9 연결
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/maven-3.3.9/bin/mvn 30309
```

## 참고 링크

[1][update-alternatives(8) man page](https://linux.die.net/man/8/update-alternatives)
