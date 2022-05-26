---
title:  pyenv 파이썬 버전 가상 환경 관리
date:   2017-04-02T01:36:27+0900
tags: [python]
---

파이썬이라는 언어를 사용하다보면 다양한 버전 환경에 직면하게 된다. 먼저, Redhat, Debian 등의 배포판에는 자체에 설치된 시스템 파이썬이 존재하고, 필요에 따라 계정별로 소스 빌드를 통해 파이썬을 사용할 수도 있다. 파이썬은 크게 2.x 와 3.x 의 메이저 버전에 따라 문법과 내장 라이브러리의 차이가 있으며, 마이너 버전에 따라 일부 기능의 동작 방식이나 구현이 달라질 수 있는 자유롭지만 때론 위험한 상황에 직면해 있다.

물론, 단일 시스템에서 하나의 프로젝트만을 운용한다거나 버전이 절대 변경될 가능성이 없다면 특별히 고민하지 않아도 될 수 있다. 하지만, 일반적으로 하나의 시스템에는 다양한 파이썬 프로젝트들이 존재할 수 있고 이들은 종종 다양한 파이썬 버전에 기반하여 구현이 되어 있을 수 있다. 의존성 분리를 통해 프로젝트 간에 응집력을 줄인다면, 개별 프로젝트는 다른 환경에 대한 고민을 하지 않아도 된다.

위와 같은 니즈에 적합한 오픈소스 솔루션이 pyenv 이라고 소개하고 싶다! 물론, 오픈소스를 활용하지 않고 충분히 버전을 통제할 수 있다. $PATH, $PYTHON_PATH 등의 환경변수를 적절히 관리하면 가능하다. 다만, 매 프로젝트에서 이러한 환경변수를 다루는 것까지 고민하는 것은 어떻게보면 낭비가 될 수도 있다는 생각에 pyenv에 대해서 자세히 알아보게 되었다.

## 핵심 기능 간략 소개

pyenv가 제공하는 기능은 간략하게 다음과 같다.

- 사용자 별로 Global Python Version 을 변경할 수 있다.
- 프로젝트 단위로 파이썬 버전을 관리하는 기능을 사용할 수 있다.
- 환경변수를 통해 파이썬 버전을 오버라이딩하는 것도 허용된다.
- 특정 시점에 여러 파이썬 버전을 조회할 수 있다. 이는 다양한 버전에서 테스트를 수행하는 라이브러리나 CI툴 등에서 유용하다.

그리고, 유사한 솔루션과의 차이점은 다음과 같다고 소개하고 있다.

- 파이썬에 의존성이 없다. 순수한 쉘 스크립트로 구현되어 있다.
- 쉘에서 Pyenv를 환경변수로 로딩할 필요가 있다. 즉, `$PATH` 에 pyenv's shim 을 접근하기 위한 디렉토리를 추가해주어야 한다.
- virtualenv 를 관리할 수 있다. 직접 virtualenv 를 사용할 수도 있으며, 혹은 pyenv-virtualenv 를 통해 가상환경을 만드는 일련의 프로세스를 자동화할 수 있다.

## 동작 원리 이해하기

유닉스, 리눅스 시스템에서는 특정 명령을 수행할 때, `$PATH`에 등록된 디렉토리 리스트에서 실행 가능한 파일 (Executable file)을 순서대로 찾도록 되어 있다. 일반적으로 사용하는 `cd`, `rm` 등의 명령어도 `$PATH`라는 환경변수에 등록이 되어 있기 때문에 가능하다. 만약 `$PATH`에 등록되지 않았다면, 매번 `/bin/cd`, `/bin/rm`과 같이 절대 경로로 실행 가능한 파일을 명시해주어야 한다. `$PATH`에서 왼쪽->오른쪽 순서로 디렉토리를 탐색하고, 동일한 실행 파일명을 가지고 있다면, 먼저 발견된 디렉토리의 실행 파일을 사용하게 된다.

pyenv 설치를 완료하면 `eval $(pyenv init -)` 를 초기에 호출하는데, 이 때 `PATH=$(pyenv root)/shims:$PATH` 와 같이 환경변수에 등록된다. 이 때, `$(pyenv root)` 를 통해 동적으로 경로가 생성되는데, 이를 pyenv 프로젝트에선 Hash (혹은 Rehash) 된다고 언급한다.

이후 pyenv 를 통해 파이썬을 설치하게 되면, `$(pyenv root)/versions/<version>` 의 경로에 버전별로 설치된다. 그리고, 바이너리 파일들은 `$(pyenv root)/shims` 디렉토리 안에 생성된다.

## 설치하기

최초 설치시에는 공식 Github 프로젝트에서 복제하여 가져온다. `$HOME/.pyenv` 에 설치하는 것을 가장 권장하고 있으나 필수는 아니므로 적절한 경로에 가져온다.

```bash
$ git clone https://github.com/pyenv/pyenv.git $HOME/.pyenv
```

자신이 사용하는 쉘에 적당한 rc 파일에 아래의 환경변수를 설정한다. (필자는 zsh 쉘을 사용하고 있다. bash 쉘을 사용하는 경우 .bash_profile 파일을 수정하면 된다.)

```bash
$ vi ~/.zshrc
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
```

**[주의사항]** bash 쉘을 사용하는 경우, 일부 시스템에서 BASH_ENV가 .bashrc 를 호출하게끔 되어 있는 경우, .bashrc 에 위의 내용을 넣는 경우 무한루프에 빠질 수 있으니 주의가 필요함. (반드시 .bash_profile 에 추가해야만 한다.)

최종적으로, 위의 변경사항을 반영하기 위해 아래의 커맨드를 수행한다.

```bash
$ exec $SHELL
```

__설정 가능한 환경변수 정리__

`PYENV_VERSION` 사용할 파이썬 버전을 명시한다.

`PYENV_ROOT` pyenv 가 설치될 루트 디렉토리를 명시한다. (기본값: ~/.pyenv)

`PYENV_DEBUG` pyenv 디버그 정보 노출 여부 cf. `pyenv --debug <subcommand>`

`PYENV_HOOK_PATH` pyenv hooks 기능에서 사용할 탐색 경로를 정의한다. pyenv hooks 기능은 pyenv 명령이 특정 시점에 지정한 스크립트가 동작되길 원할 때 사용하는 전문가 옵션이므로 자세한 내용은 다음의 위키를 참조하도록 한다. [pyenv hook wiki 참조](https://github.com/pyenv/pyenv/wiki/Authoring-plugins#pyenv-hooks){:target="_blank"}

`PYENV_DIR`	`.python-version` 파일을 찾기위한 경로를 입력한다. (기본값: $PWD)

`PYTHON_BUILD_ARIA2_OPTS` pyenv는 `$PATH`에 aria2c 바이너리의 경로가 정의되고 실행 가능하다면, `aria2` 를 사용하여 파이썬 소스를 다운로드 받는데, 이 때 사용하는 옵션을 전달하기 위한 환경변수이다. bandwidth 조절이나, 커넥션 수 등을 조절할 수 있다. [aria2c options](https://aria2.github.io/manual/en/html/aria2c.html#options){:target="_blank"}

## 최신 또는 특정 버전 선택하기

공식 릴리즈되지 않은 최신 커밋의 버전을 사용하고자 하는 경우, 아래의 명령을 호출한다.

```bash
$ cd $(pyenv root)
$ git pull
```

만약, 릴리즈된 특정 태그를 명시하여 사용하고 싶다면, 아래의 명령을 호출한다. (예를 들어, v1.0.9 버전을 사용한다. v0.9.4 를 사용한다. 등...)

```bash
$ cd $(pyenv root)
$ git fetch
$ git tag
git tag
v0.1.0
v0.1.1
v0.1.2
--- 생략 ---
$ git checkout v1.0.9
```

## 삭제하기

설치된 pyenv 디렉토리를 제거한 뒤에 위에 설정한 환경 변수를 모두 제거하면 된다.

```bash
$ rm -rf $(pyenv root)
$ vi ~/.zshrc
# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"
```

## 명령어 알아보기

pyenv 설치가 완료되었다면, 이제 pyenv에서 제공하는 명령어에 대해서 정리하려고 한다. 모든 명령어를 정리하지는 않고, 자주 사용하고 필수적인 내용만 다루어보려고 한다. 기타 명령어나 최신 버전에 추가된 명령어 등을 확인하려면, [pyenv COMMANDS](https://github.com/pyenv/pyenv/blob/master/COMMANDS.md){:target="_blank"} 페이지를 참조하도록 한다.

### 파이썬 설치하기

특정 파이썬 버전을 설치하거나, 설치 가능한 파이썬 버전 리스트를 볼 수 있다.

* 특정 버전의 파이썬 설치

```bash
$ pyenv install 2.7.12
Downloading Python-2.7.12.tar.xz...
-> https://www.python.org/ftp/python/2.7.12/Python-2.7.12.tar.xz
Installing Python-2.7.12...
Installed Python-2.7.12 to /Users/lukas/.pyenv/versions/2.7.12
```

파이썬 빌드 중 컴파일 옵션을 설정할 필요가 있는 경우, `CONFIGURE_OPTS` 환경변수를 통해 설정이 가능하다.

HTTP(S) 프록시 설정이 필요한 경우에는 `http_proxy`, `https_proxy` 환경변수를 사전에 설정하면 된다.

필수 패키지/라이브러리 설치, CPU 아키텍처 선택 등의 다양한 빌드 문제를 정리한 부분은 [common build problems wiki](https://github.com/pyenv/pyenv/wiki/Common-build-problems){:target="_blank"} 페이지를 참조하도록 한다.

* 설치 가능한 전체 파이썬 리스트 조회

```bash
$ pyenv install -l
Available versions:
  2.1.3
  2.2.3
  2.3.7
--- 생략 ---
```

### 파이썬 삭제하기

이미 설치된 파이썬을 삭제할 때 사용한다. 모든 버전에 대해서 삭제할 필요가 있고, pyenv 를 더이상 사용하지 않을 경우에는 `rm -rf $(pyenv root)` 를 통해 영구적인 삭제가 가능하다. 다만, `pyenv uninstall` 명령을 사용하는 경우에는 다른 가용한 파이썬으로 대체하여 준다.

```bash
pyenv uninstall 2.7.12
pyenv: remove /Users/lukas/.pyenv/versions/2.7.12? y # y/n 중에 하나 입력!
```

### 파이썬 버전 관리하기

pyenv는 다양한 파이썬 버전을 다루게 되는데 몇가지 환경변수를 응용하여, 필요에 따라서 다양한 버전을 선택할 수 있고 복수의 버전을 선택할 수도 있다.

먼저, pyenv가 파이썬을 선택할 때, `$PYENV_VERSION` > `$PYENV_DIR/.python-version` > `$PYENV_ROOT/version`순으로 우선순위가 정의되어 있으며, 각각의 값은 `pyenv shell`, `pyenv local`, `pyenv global` 의 명령을 통해서 설정할 수 있다.

즉, `python 호출` -> `pyenv가 명령어 후킹` -> `우선 순위에 따라 사용할 버전 정보 획득` -> `해당 버전 파이썬 실행` 과 같다.

추가로 특이한 점은 복수의 파이썬 버전을 선택할 수 있다는 점이다. 만약에 2.7.13과 3.4.6 버전을 사용하기로 한다면? `pyenv (shell|local|global) 2.7.13 3.4.6` 과 같이 설정하면 된다. 이렇게 설정한 경우, `python` 명령을 호출하면, 2.7.13 버전의 파이썬이 호출된다. 만약에 3.4.6 버전을 디폴트로 사용하고자 한다면? `pyenv (shell|local|global) 3.4.6 2.7.13` 과 같이 순서만 바꾸면 된다.

구체적인 내용은 아래에 정리해보도록 하겠다.

#### pyenv shell

쉘에서 파이썬 버전을 관리하기 위한 명령이다. 즉, `$PYENV_VERSION` 환경변수를 설정하여 사용할 버전을 명시하는데, 이 환경변수는 다른 설정 방법 중에서 가장 높은 우선순위를 가지고 있다. 만약에 스크립트 단위로 파이썬 버전이 달라져야한다는 경우와 같이 실행 시점에 버전이 결정되어야할 필요가 있을 때 유용하다.

```bash
$ echo $PYENV_VERSION # 환경변수의 값이 비어있다.

$ pyenv shell 3.4.6
$ echo $PYENV_VERSION # 환경변수에 설정된 것을 볼 수 있다.
3.4.6
```

```bash
$ pyenv shell 2.7.13 3.4.6
$ echo $PYENV_VERSION
2.7.13:3.4.6
```

#### pyenv local

특정 디렉토리에서 파이썬 버전을 관리하기 위한 명령어이다. 더 정확히는 `$PYENV_DIR/.python-version`에 사용할 파이썬 버전을 정의하는 명령어라고 할 수 있다. 특별히 `$PYENV_DIR` 환경변수를 설정하지 않았다면, 기본값으로 `$PWD` 즉, 현재 디렉토리에 해당 파일이 생성되는 것을 알 수 있다.

```bash
$ pyenv local 3.4.6
$ ll .python-version # 현재 디렉토리에 .python-version 파일이 생성되었다.
-rw-rw-r--  1 lukas  staff     6B  4  2 01:10 .python-version
$ cat .python-version # 내가 설정한 파이썬 버전이 정의되어 있다.
3.4.6
```

```bash
$ pyenv local 2.7.13 3.4.6
$ cat .python-version # 복수의 버전이 정의되어 있다. python 명령어 수행 시, 2.7.13 버전이 수행된다.
2.7.13
3.4.6
```

#### pyenv global

시스템의 파이썬 버전을 관리하기 위한 명령이다. 더 정확히는 `$PYENV_ROOT/version`에 사용할 버전을 정의하기 위한 명령어이다. `$PYENV_ROOT` 환경변수를 특별히 정의하지 않았다면 기본적으로 `~/.pyenv` 를 기본값으로 가지고 있다.

```bash
$ pyenv global 3.4.6
$ ll ~/.pyenv/version # $PYENV_ROOT/version 경로에 파일이 생성되었다.
-rw-r--r--  1 lukas  staff    13B  4  2 01:30 /Users/lukas/.pyenv/version
$ cat ~/.pyenv/version # 내가 설정한 파이썬 버전이 정의되어 있다.
3.4.6
```

```bash
$ pyenv global 2.7.13 3.4.6
$ cat ~/.pyenv/version
2.7.13
3.4.6
```

## 참고 링크

[1] [github.com/yyuu/pyenv](https://github.com/yyuu/pyenv){:target="_blank"}
