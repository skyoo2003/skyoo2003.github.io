---
layout: post
title:  alternatives 명령어 알아보기
date:   2017-03-17T11:13:43+0900
categories: [all, linux]
permalink: /post/:year/:month/:day/:title
published: true
---

`alternatives` (레드헷의 경우, `update-alternatives` 동일)는 심볼릭 링크를 생성, 제거, 관리, 조회할 수 있는 기능을 제공하는 GNU 라이센스의 커맨드라인 툴 입니다. 즉, 심볼릭 링크를 통해서 특정 커맨드에 대해 디폴트 버전 혹은 경로를 정의할 수 있습니다. 데비안 계열의 리눅스에는 `update-alternatives` 라는 커맨드만 제공되고 있으며 이유는 perl 언어에 대한 의존성을 제거하기 위해 스크립트가 재구현이 되었다고 합니다. 레드헷, 데비안 계열로 제공하는 기능이 조금씩 다르지만, 이번에는 공통적으로 포함하는 기능에 대해서만 정리하고자 합니다.

이해를 쉽게하기 위해, 각각의 기능을 설명할 때, 메이븐을 시스템에 설치한 뒤에 심볼릭 링크로 연결하는 방법을 정리하도록 하겠습니다. 때문에 메이븐이 `/usr/lib/maven-*` 경로에 설치되어 있다고 가정합니다. 해당 툴은 메이븐 이외의 다른 응용도 충분히 가능합니다.

## 생성하기 (--install)

`--install` 액션을 통해 심볼릭 링크를 생성할 수 있습니다. `/etc/alternatives` 에 `<name>`으로 지정한 이름으로 생성되고 `<path>`의 경로로 심볼릭 링크가 생성됩니다. 이후, `<link>` 에 명시된 경로에 `/etc/alternatives/<name>` 의 심볼릭 링크를 연결해줍니다.

커맨드라인 사용법은 아래와 같습니다.

```bash
# Redhat
$ alternatives --install <link> <name> <path> <priority> [--slave <link> <name> <path>]*
# Debian
$ update-alternatives --install <link> <name> <path> <priority> [--slave <link> <name> <path>] ...

<link> : 심볼릭 링크의 경로를 입력합니다.
<name> : /etc/alternatives 에 생성될 심볼릭 링크의 이름을 입력합니다.
<path> : 연결될 패키지의 절대 경로를 입력합니다.
<priority> : 동일 심볼링 링크명을 사용할 경우, 우선순위가 높은 경로를 먼저 사용합니다.
```

```bash
# /usr/local/bin/mvn 심볼릭 링크에 3.3.3 연결
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/maven-3.3.3/bin/mvn 30303

# /usr/local/bin/mvn 심볼릭 링크에 3.3.9 연결
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/maven-3.3.9/bin/mvn 30309
```

## 제거하기 (--remove)

`--remove` 액션을 통해 생성한 심볼릭 링크를 제거할 수 있습니다. 만약에 `<name>` 에 `<path>`와 링크 되어있다면, 다른 적절한 경로로 링크를 변경해주고 대안이 없다면 `alternatives` 에서 해당 `<name>`이 제거됩니다. `--install` 액션으로 생성한 Slave links 들도 동일한 방식으로 업데이트 되거나 제거 됩니다.

```bash
# Redhat
$ alternatives --remove <name> <path>
# Debian
$ update-alternatives --remove <name> <path>
$ update-alternatives --remove-all <name> # alternatives에 등록된 모든 심볼릭 링크를 제거합니다.

<name> : /etc/alternatives 에 생성된 심볼릭 링크의 이름을 입력합니다.
<path> : 연결된 패키지의 절대 경로를 입력합니다.
```

```bash
# mvn 으로 등록된 심볼릭 링크에서 '/usr/lib/maven-3.3.9/bin/mvn' 에 해당하는 패키지 링크 제거 (메이븐 3.3.3이 연결되어 있다면, 제거 후 mvn 은 3.3.3 버전으로 링크가 업데이트 됩니다.)
$ alternatives --remove mvn /usr/lib/maven-3.3.9/bin/mvn
```

## 자동(automatic) 관리 설정하기 (--auto)

`--auto` 액션은 `alternatives` 에 등록된 심볼릭 링크를 자동으로 선택하도록 설정합니다. `--install` 에서 `<priority>` 옵션으로 가장 높은 값으로 설정된 링크를 우선적으로 선택하고 있습니다.
이후에 설명할 `--config` 옵션으로 임의로 선택하는 경우, 자동 모드가 해제됩니다.

```bash
# Redhat
$ alternatives --auto <name>
# Debian
$ update-alternatives --auto <name>

<name> : /etc/alternatives 에 생성된 심볼릭 링크의 이름을 입력합니다.
```

```bash
# mvn 으로 등록된 링크를 자동으로 관리하도록 설정합니다.
$ alternatives --auto mvn
```

## 직접 링크 선택하기 (--config)

`--config` 액션은 `alternatives` 에 등록된 심볼릭 링크를 사용자가 임의로 선택할 수 있는 기능입니다. manual mode 로 변경되고, `--auto` 을 설정한 경우에는 해제됩니다.

```bash
# Redhat
$ alternatives --config <name>
# Debian
$ update-alternatives --config <name>

<name> : /etc/alternatives 에 생성된 심볼릭 링크의 이름을 입력합니다.
```

```bash
$ alternatives --config mvn

There are 2 programs which provide 'mvn'.

  Selection    Command
-----------------------------------------------
*+ 1           /usr/lib/maven-3.3.9/bin/mvn
   2           /usr/lib/maven-3.3.3/bin/mvn

Enter to keep the current selection[+], or type selection number: # 사용하고자 하는 패키지 경로를 선택합니다.
```

## 등록된 링크 정보 확인하기 (--display)

`--display` 액션은 `alternatives` 에 등록된 심볼릭 링크에 대한 등록 정보를 확인할 수 있습니다. 마스터/슬레이브 링크를 포함한 모드 (자동/수동), 현재 링크된 패키지 경로, 연결 가능한 다른 패키지 경로 및 우선순위 값도 확인할 수 있습니다.

```bash
# Redhat
$ alternatives --display <name>
# Debian
$ update-alternatives --display <name>

<name> : /etc/alternatives 에 생성된 심볼릭 링크의 이름을 입력합니다.
```

```bash
# mvn 링크에 대한 패키지 정보 확인
$ alternatives --display mvn
mvn - status is manual.
 link currently points to /usr/lib/maven-3.3.3/bin/mvn
/usr/lib/maven-3.3.9/bin/mvn - priority 30309
/usr/lib/maven-3.3.3/bin/mvn - priority 30303
Current 'best' version is /usr/lib/maven-3.3.9/bin/mvn.

# --auto 설정 후 변경된 mvn 에 대한 mode 확인
$ alternatives --auto mvn
$ alternatives --display mvn
mvn - status is auto.
 link currently points to /usr/lib/maven-3.3.9/bin/mvn
/usr/lib/maven-3.3.9/bin/mvn - priority 30309
/usr/lib/maven-3.3.3/bin/mvn - priority 30303
Current 'best' version is /usr/lib/maven-3.3.9/bin/mvn.
```

## 전체 링크 정보 확인하기 (--list)

`--list` 는 `alternatives` 에 등록된 모든 심볼릭 링크에 대한 정보를 확인할 수 있습니다. 추가로, 데비안의 경우, 특정 심볼릭 링크에 대해서만 가능합니다.

```bash
# Redhat
$ alternatives --list
# Debian
$ update-alternatives --list <name>

<name> : /etc/alternatives 에 생성된 심볼릭 링크의 이름을 입력합니다.
```

```bash
# 로컬 머신에 등록된 모든 심볼릭 링크 리스트 입니다.
$ alternatives --list
java_sdk_1.8.0	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
jre_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre
jre_1.7.0_openjdk	auto	/usr/lib/jvm/jre-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
java_sdk_1.8.0_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
java_sdk_1.7.0	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
mvn	auto	/usr/lib/maven-3.3.9/bin/mvn
java_sdk_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
jre_1.7.0	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64/jre
jre_1.8.0	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre
ld	auto	/usr/bin/ld.bfd
javac	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/bin/javac
java	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre/bin/java
libnssckbi.so.x86_64	auto	/usr/lib64/pkcs11/p11-kit-trust.so
jre_1.8.0_openjdk	auto	/usr/lib/jvm/jre-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
java_sdk_1.7.0_openjdk	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
```
