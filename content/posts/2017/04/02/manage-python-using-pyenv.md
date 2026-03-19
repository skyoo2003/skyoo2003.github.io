---
title: pyenv 파이썬 버전 가상 환경 관리
date: 2017-04-02T01:36:27+09:00
tags: [python, tutorial]
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

### Shim의 동작 방식

```
$ python --version
    ↓
pyenv shim (~/.pyenv/shims/python)
    ↓
버전 결정 (PYENV_VERSION → .python-version → ~/.pyenv/version)
    ↓
실제 파이썬 실행 (~/.pyenv/versions/3.9.0/bin/python)
```

## 설치하기

### 자동 설치 (권장)

```bash
# macOS (Homebrew)
$ brew update
$ brew install pyenv

# Linux (pyenv-installer)
$ curl https://pyenv.run | bash
```

### 수동 설치

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

### 설정 가능한 환경변수 정리

| 환경변수 | 설명 | 기본값 |
|---------|------|--------|
| `PYENV_VERSION` | 사용할 파이썬 버전 명시 | |
| `PYENV_ROOT` | pyenv 설치 루트 디렉토리 | `~/.pyenv` |
| `PYENV_DEBUG` | 디버그 정보 노출 여부 | |
| `PYENV_HOOK_PATH` | hooks 탐색 경로 | |
| `PYENV_DIR` | `.python-version` 파일 탐색 경로 | `$PWD` |
| `PYTHON_BUILD_ARIA2_OPTS` | aria2 다운로드 옵션 | |

## 최신 또는 특정 버전 선택하기

공식 릴리즈되지 않은 최신 커밋의 버전을 사용하고자 하는 경우, 아래의 명령을 호출한다.

```bash
$ cd $(pyenv root)
$ git pull
```

만약, 릴리즈된 특정 태그를 명시하여 사용하고 싶다면, 아래의 명령을 호출한다.

```bash
$ cd $(pyenv root)
$ git fetch
$ git tag
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

pyenv 설치가 완료되었다면, 이제 pyenv에서 제공하는 명령어에 대해서 정리하려고 한다.

### 파이썬 설치하기

특정 파이썬 버전을 설치하거나, 설치 가능한 파이썬 버전 리스트를 볼 수 있다.

```bash
# 특정 버전의 파이썬 설치
$ pyenv install 3.9.0
Downloading Python-3.9.0.tar.xz...
-> https://www.python.org/ftp/python/3.9.0/Python-3.9.0.tar.xz
Installing Python-3.9.0...
Installed Python-3.9.0 to /Users/lukas/.pyenv/versions/3.9.0

# 설치 가능한 전체 파이썬 리스트 조회
$ pyenv install -l
Available versions:
  2.1.3
  2.2.3
  2.3.7
--- 생략 ---
  3.9.0
  3.9-dev
  anaconda3-2020.07
  miniconda3-latest
--- 생략 ---

# 특정 접두사로 필터링
$ pyenv install -l | grep "3.9"
  3.9.0
  3.9.1
  3.9.2
```

### 빌드 옵션 설정

```bash
# 컴파일 옵션 설정
$ CONFIGURE_OPTS="--enable-shared" pyenv install 3.9.0

# 프록시 설정
$ export https_proxy=http://proxy.company.com:8080
$ pyenv install 3.9.0

# 병렬 빌드
$ PYTHON_MAKE_OPTS="-j4" pyenv install 3.9.0
```

### 파이썬 삭제하기

이미 설치된 파이썬을 삭제할 때 사용한다.

```bash
$ pyenv uninstall 3.9.0
pyenv: remove /Users/lukas/.pyenv/versions/3.9.0? y
```

### 파이썬 버전 관리하기

pyenv는 다양한 파이썬 버전을 다루게 되는데 몇가지 환경변수를 응용하여, 필요에 따라서 다양한 버전을 선택할 수 있고 복수의 버전을 선택할 수도 있다.

우선순위: `$PYENV_VERSION` > `$PYENV_DIR/.python-version` > `$PYENV_ROOT/version`

#### pyenv shell

쉘에서 파이썬 버전을 관리하기 위한 명령이다. 가장 높은 우선순위를 가진다.

```bash
$ pyenv shell 3.9.0
$ python --version
Python 3.9.0

# 복수 버전 설정
$ pyenv shell 3.9.0 2.7.18
$ python --version    # 첫 번째 버전 사용
Python 3.9.0
$ python2 --version   # 두 번째 버전 사용
Python 2.7.18
```

#### pyenv local

특정 디렉토리에서 파이썬 버전을 관리하기 위한 명령어이다.

```bash
$ cd ~/projects/myproject
$ pyenv local 3.9.0
$ cat .python-version
3.9.0

# 복수 버전 설정
$ pyenv local 3.9.0 2.7.18
$ cat .python-version
3.9.0
2.7.18
```

#### pyenv global

시스템 전체의 기본 파이썬 버전을 관리하기 위한 명령이다.

```bash
$ pyenv global 3.9.0
$ cat ~/.pyenv/version
3.9.0

# 복수 버전 설정
$ pyenv global 3.9.0 2.7.18
$ cat ~/.pyenv/version
3.9.0
2.7.18
```

### 버전 확인 명령어

```bash
# 현재 활성화된 파이썬 버전
$ pyenv version
3.9.0 (set by /Users/lukas/projects/myproject/.python-version)

# 설치된 모든 파이썬 버전
$ pyenv versions
  system
  2.7.18
* 3.9.0 (set by /Users/lukas/projects/myproject/.python-version)
  3.8.5
```

## pyenv-virtualenv 활용하기

pyenv-virtualenv는 pyenv의 플러그인으로, 가상환경 관리를 자동화한다.

### 설치

```bash
# macOS (Homebrew)
$ brew install pyenv-virtualenv

# Linux
$ git clone https://github.com/pyenv/pyenv-virtualenv.git $(pyenv root)/plugins/pyenv-virtualenv
```

### 쉘 설정 추가

```bash
$ vi ~/.zshrc
eval "$(pyenv virtualenv-init -)"
```

### 가상환경 생성 및 사용

```bash
# 가상환경 생성
$ pyenv virtualenv 3.9.0 myproject-env

# 가상환경 목록
$ pyenv virtualenvs
  myproject-env (created from ~/.pyenv/versions/3.9.0)

# 가상환경 활성화
$ pyenv activate myproject-env

# 가상환경 비활성화
$ pyenv deactivate

# 가상환경 삭제
$ pyenv uninstall myproject-env
```

### 프로젝트별 자동 활성화

```bash
$ cd ~/projects/myproject
$ pyenv local myproject-env
# 이제 해당 디렉토리로 이동하면 자동으로 가상환경 활성화
```

## 실전 활용 예제

### Django 프로젝트 설정

```bash
# 프로젝트 디렉토리 생성
$ mkdir ~/projects/django-app && cd ~/projects/django-app

# 파이썬 버전 설정
$ pyenv local 3.9.0

# 가상환경 생성
$ pyenv virtualenv 3.9.0 django-app-env
$ pyenv local django-app-env

# Django 설치
$ pip install django
$ django-admin startproject mysite .
```

### tox와 함께 사용하기 (다중 버전 테스트)

```bash
# 여러 파이썬 버전 설치
$ pyenv install 3.7.9 3.8.5 3.9.0

# 프로젝트에 복수 버전 설정
$ pyenv local 3.9.0 3.8.5 3.7.9

# tox.ini
[tox]
envlist = py37,py38,py39

[testenv]
deps = pytest
commands = pytest

# tox 실행
$ tox
```

### CI/CD에서 활용

```yaml
# GitHub Actions 예시
name: Python CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.7, 3.8, 3.9]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install pyenv
        run: |
          curl https://pyenv.run | bash
          echo "$HOME/.pyenv/bin" >> $GITHUB_PATH
          echo "$HOME/.pyenv/shims" >> $GITHUB_PATH
      
      - name: Install Python ${{ matrix.python-version }}
        run: pyenv install ${{ matrix.python-version }}
      
      - name: Run tests
        run: |
          pyenv global ${{ matrix.python-version }}
          pip install -r requirements.txt
          pytest
```

## 트러블슈팅

### 자주 발생하는 문제

**1. 빌드 실패**

```bash
ERROR: The Python ssl extension was not compiled. Missing the OpenSSL lib?
```

해결 (Ubuntu/Debian):
```bash
$ sudo apt-get install -y build-essential libssl-dev zlib1g-dev libbz2-dev \
    libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev \
    libncursesw5-dev xz-utils tk-dev libffi-dev liblzma-dev python-openssl
```

해결 (macOS):
```bash
$ brew install openssl readline sqlite3 xz zlib
$ export LDFLAGS="-L$(brew --prefix openssl)/lib"
$ export CPPFLAGS="-I$(brew --prefix openssl)/include"
$ pyenv install 3.9.0
```

**2. 명령어를 찾을 수 없음**

```bash
pyenv: command not found
```

해결:
```bash
# 환경변수 확인
$ echo $PATH | grep pyenv

# 쉘 설정 재적용
$ source ~/.zshrc  # 또는 ~/.bash_profile
```

**3. 버전이 변경되지 않음**

```bash
$ pyenv global 3.9.0
$ python --version
Python 2.7.16  # 변경 안됨
```

해결:
```bash
# shim 재생성
$ pyenv rehash

# 쉘 재시작
$ exec $SHELL
```

**4. 권한 문제**

```bash
permission denied: ~/.pyenv/versions/3.9.0
```

해결:
```bash
$ sudo chown -R $(whoami) ~/.pyenv
```

## 모범 사례

### 1. 프로젝트별 .python-version 커밋

```bash
# .python-version 파일을 Git에 커밋
$ cd ~/projects/myproject
$ pyenv local 3.9.0
$ git add .python-version
$ git commit -m "Add Python version specification"
```

### 2. requirements.txt와 함께 관리

```bash
# 가상환경 생성 후 의존성 설치
$ pyenv virtualenv 3.9.0 myproject
$ pyenv local myproject
$ pip install -r requirements.txt
$ pip freeze > requirements.txt
```

### 3. .python-version과 runtime.txt

Heroku 등의 PaaS에서는 `runtime.txt`를 사용:

```
# runtime.txt
python-3.9.0
```

### 4. pyenv와 poetry 조합

```bash
# pyenv로 파이썬 버전 관리
$ pyenv local 3.9.0

# poetry로 의존성 관리
$ pip install poetry
$ poetry init
$ poetry add django
$ poetry install
```

## 참고 링크

- [github.com/pyenv/pyenv](https://github.com/pyenv/pyenv)
- [pyenv-virtualenv](https://github.com/pyenv/pyenv-virtualenv)
- [Common build problems](https://github.com/pyenv/pyenv/wiki/Common-build-problems)
- [Python Version Management with pyenv](https://realpython.com/intro-to-pyenv/)
