---
title: "Ansible Molecule으로 테스트 작성하기"
description: "Ansible Role 테스트 프레임워크 Molecule의 설치 방법과 시나리오, 드라이버, 프로비저너, 베리파이어 개념을 정리한다."
date: 2022-05-26T21:48:32+09:00
tags: [ansible, testing, tutorial, devops]
---

# Molecule 소개

[Molecule](https://molecule.readthedocs.io/en/latest/)는 ansible-community에서 관리하는 Ansible Role용 테스트 프레임워크입니다. Molecule을 사용하면 Ansible Role을 체계적으로 테스트할 수 있으며, 여러 인스턴스, 운영 체제, 가상화 공급자, 테스트 프레임워크 및 테스트 시나리오를 활용한 종합적인 테스트가 가능합니다.

## 왜 Molecule이 필요한가?

Ansible Role을 개발할 때 다음과 같은 문제에 직면합니다:

- **수동 테스트의 한계**: 매번 수동으로 Role을 실행하고 결과를 확인하는 것은 시간이 많이 소요됩니다.
- **다양한 환경 지원**: Ubuntu, CentOS, Debian 등 다양한 OS에서 Role이 정상 동작하는지 확인해야 합니다.
- **지속적 통합**: CI/CD 파이프라인에서 자동으로 테스트를 수행해야 합니다.
- **코드 품질**: Ansible 코드의 품질을 일관되게 유지해야 합니다.

Molecule은 이러한 문제를 해결하기 위해 다음 기능을 제공합니다:

- 다양한 드라이버 지원 (Docker, Podman, Vagrant, EC2 등)
- 자동화된 테스트 수명주기 관리
- 여러 테스트 프레임워크 통합 (Ansible, Testinfra, Goss)
- Lint 도구 통합 (yamllint, ansible-lint)

## 설치하기

### 시스템 요구사항

- Python 3.8 이상
- Docker, Podman 또는 Vagrant (테스트 환경용)
- Ansible 2.10 이상

### 설치 방법

Pip 설치 시 시스템 Python의 의존성을 꼬이게 할 수 있으므로 가급적 Virtualenv로 가상 환경을 만들거나 Pipenv, Poetry 등의 의존성 관리 도구를 사용하는 것을 권장합니다.

```sh
# 가상 환경 생성 (권장)
$ python -m venv .venv
$ source .venv/bin/activate

# docker 및 yamllint, ansible-lint 패키지 추가로 설치
# podman, vagrant, azure, hetzner 도 지원
$ pip install molecule[docker,lint]

# 설치 확인
$ molecule --version
molecule 24.9.0 using python 3.11
    ansible:2.17.0
    delegated:24.9.0 from molecule
    docker:24.9.0 from molecule_docker
```

### 추가 드라이버 설치

```sh
# Podman 드라이버
$ pip install molecule[podman]

# Vagrant 드라이버
$ pip install molecule[vagrant]

# EC2 드라이버
$ pip install molecule[ec2]
```

## Molecule의 핵심 개념

### 시나리오 (Scenario)

시나리오는 테스트 수명주기를 정의하며 기본값은 `default`입니다. 필요에 따라 여러 시나리오를 생성할 수도 있습니다. 예를 들어:

- `default`: 기본 Docker 기반 테스트
- `centos`: CentOS 특화 테스트
- `ubuntu`: Ubuntu 특화 테스트

### 드라이버 (Driver)

드라이버는 테스트 인스턴스를 생성하는 방법을 정의합니다:

| 드라이버 | 용도 | 장점 | 단점 |
|---------|------|------|------|
| Docker | 컨테이너 기반 테스트 | 빠르고 가벼움 | systemd 지원 제한적 |
| Podman | 컨테이너 기반 테스트 | rootless 실행 | Docker와 호환성 고려 필요 |
| Vagrant | VM 기반 테스트 | 완전한 OS 환경 | 상대적으로 느림 |
| EC2 | 클라우드 VM 테스트 | 실제 프로덕션 환경 | 비용 발생 |

### 프로비저너 (Provisioner)

Role을 적용하는 방법을 정의하며 기본적으로 Ansible을 사용합니다.

### 베리파이어 (Verifier)

테스트 결과를 검증하는 방법을 정의합니다:

- **Ansible**: Ansible playbook으로 검증
- **Testinfra**: Python 기반 테스트 프레임워크
- **Goss**: YAML 기반 경량 테스트 도구

## 테스트 작성하기

### 1. 새 Role 생성

기존 Role이 없다면 Molecule로 새 Role을 초기화할 수 있습니다:

```sh
$ molecule init role myrole
```

이 명령은 다음 구조를 생성합니다:

```
myrole/
├── defaults/
│   └── main.yml
├── handlers/
│   └── main.yml
├── meta/
│   └── main.yml
├── molecule/
│   └── default/
│       ├── converge.yml
│       ├── molecule.yml
│       ├── verify.yml
│       └── tasks/
│           └── main.yml
├── tasks/
│   └── main.yml
├── tests/
│   ├── inventory
│   └── test.yml
└── vars/
    └── main.yml
```

### 2. 기존 Role에 Molecule 추가

기존 Role에 Molecule을 추가하려면:

```sh
$ cd /path/to/role
$ molecule init scenario
--> Initializing new scenario default...
Initialized scenario in /path/to/role/molecule/default successfully.
```

### 3. molecule.yml 구성

`/path/to/role/molecule/default/molecule.yml` 파일을 생성하고 다음 내용을 입력합니다:

```yaml
---
dependency:
  name: galaxy
  options:
    requirements-file: ../../requirements.yml
driver:
  name: docker
platforms:
  - name: instance-ubuntu
    image: docker.io/geerlingguy/docker-ubuntu2204-ansible:latest
    pre_build_image: true
    privileged: true
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
    cgroupns_mode: host
  - name: instance-centos
    image: docker.io/geerlingguy/docker-rockylinux9-ansible:latest
    pre_build_image: true
    privileged: true
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
    cgroupns_mode: host
provisioner:
  name: ansible
  config_options:
    defaults:
      host_key_checking: false
verifier:
  name: ansible
lint: |
  set -e
  yamllint -c ../../.yamllint .
  ansible-lint -c ../../.ansible-lint
```

**주요 설정 설명:**

- `dependency.galaxy`: Ansible Galaxy 의존성을 관리합니다.
- `driver.name`: Docker를 사용하여 테스트 인스턴스를 생성합니다.
- `platforms`: 테스트할 플랫폼 목록입니다. 여러 OS를 동시에 테스트할 수 있습니다.
- `privileged: true`: systemd와 같은 기능을 사용하기 위해 필요합니다.
- `provisioner.config_options`: Ansible 설정을 커스터마이즈합니다.

### 4. converge.yml 작성

`/path/to/role/molecule/default/converge.yml`을 생성해 환경 구성 코드를 추가합니다. 이 코드는 Docker 컨테이너를 만든 뒤 Role을 수행하여 환경을 구성합니다:

```yaml
---
- name: Converge
  hosts: all
  become: true
  vars:
    myrole_custom_var: "test_value"
  pre_tasks:
    - name: Update apt cache (Ubuntu)
      apt:
        update_cache: true
        cache_valid_time: 600
      when: ansible_os_family == 'Debian'
      changed_when: false

    - name: Install dependencies
      package:
        name:
          - curl
          - wget
        state: present
  tasks:
    - name: Include myrole
      include_role:
        name: myrole
      vars:
        myrole_param: "{{ myrole_custom_var }}"
```

**작성 팁:**

- `pre_tasks`를 사용하여 Role 실행 전 필요한 설정을 수행합니다.
- `vars`를 사용하여 테스트용 변수를 정의합니다.
- `become: true`로 권한 상승을 활성화합니다.

### 5. verify.yml 작성

`/path/to/role/molecule/default/verify.yml`을 생성하고 검증 코드를 추가합니다. 이 단계에서 실질적인 테스트를 수행합니다:

```yaml
---
- name: Verify
  hosts: all
  become: true
  gather_facts: true
  vars:
    expected_packages:
      - nginx
      - curl
  tasks:
    - name: Check if nginx is installed
      package_facts:
        manager: auto

    - name: Assert nginx is installed
      assert:
        that:
          - "'nginx' in ansible_facts.packages"
        fail_msg: "nginx is not installed"
        success_msg: "nginx is installed successfully"

    - name: Check nginx service status
      service_facts:
      register: services_state

    - name: Assert nginx service is running
      assert:
        that:
          - "'nginx.service' in services_state.ansible_facts.services"
          - "services_state.ansible_facts.services['nginx.service'].state == 'running'"
        fail_msg: "nginx service is not running"
        success_msg: "nginx service is running"

    - name: Check if port 80 is listening
      wait_for:
        port: 80
        timeout: 30
      register: port_check

    - name: Assert port 80 is available
      assert:
        that:
          - port_check is success
        fail_msg: "Port 80 is not listening"
        success_msg: "Port 80 is listening"

    - name: Test HTTP response
      uri:
        url: "http://localhost"
        return_content: true
      register: http_response
      failed_when: "'Welcome' not in http_response.content"

    - name: Verify configuration files exist
      stat:
        path: "/etc/nginx/nginx.conf"
      register: config_file

    - name: Assert configuration file exists
      assert:
        that:
          - config_file.stat.exists
        fail_msg: "nginx.conf does not exist"
        success_msg: "nginx.conf exists"
```

### 6. 고급 검증 with Testinfra

Ansible 대신 Testinfra를 사용하면 더 강력한 테스트를 작성할 수 있습니다:

```yaml
# molecule.yml
verifier:
  name: testinfra
```

```python
# tests/test_default.py
import pytest

def test_nginx_is_installed(host):
    """nginx가 설치되어 있는지 확인"""
    nginx = host.package("nginx")
    assert nginx.is_installed
    assert nginx.version.startswith("1.")

def test_nginx_running_and_enabled(host):
    """nginx 서비스가 실행 중이고 활성화되어 있는지 확인"""
    nginx = host.service("nginx")
    assert nginx.is_running
    assert nginx.is_enabled

def test_nginx_listening_on_port_80(host):
    """80 포트에서 수신 중인지 확인"""
    socket = host.socket("tcp://0.0.0.0:80")
    assert socket.is_listening

def test_nginx_config_exists(host):
    """nginx 설정 파일이 존재하는지 확인"""
    config = host.file("/etc/nginx/nginx.conf")
    assert config.exists
    assert config.is_file
    assert config.user == "root"
    assert config.group == "root"
    assert oct(config.mode) == "0o644"

def test_nginx_response(host):
    """HTTP 응답 확인"""
    response = host.run("curl -s http://localhost")
    assert response.rc == 0
    assert "Welcome" in response.stdout
```

## Molecule 명령어

### 기본 명령어

```sh
$ cd /path/to/role

# 테스트 인스턴스 생성
$ molecule create

# converge.yml 실행 (Role 적용)
$ molecule converge

# 인스턴스에 대한 변경 사항 확인
$ molecule side-effect

# verify.yml 실행 (테스트 검증)
$ molecule verify

# 테스트 인스턴스 제거
$ molecule destroy

# 위 모든 과정을 한 번에 수행
$ molecule test
```

### 유용한 명령어

```sh
# 특정 시나리오로 테스트
$ molecule test -s centos

# 대화형 모드로 디버깅
$ molecule create
$ molecule login
$ molecule destroy

# lint 검사만 수행
$ molecule lint

# 의존성만 설치
$ molecule dependency

# 인스턴스 목록 확인
$ molecule list

# 인스턴스에 명령 실행
$ molecule exec -- ls -la /etc/nginx
```

### 테스트 수명주기

Molecule의 `test` 명령은 다음 단계를 순차적으로 실행합니다:

1. **lint**: 코드 품질 검사
2. **destroy**: 기존 인스턴스 정리
3. **dependency**: 의존성 설치
4. **syntax**: playbook 문법 검사
5. **create**: 테스트 인스턴스 생성
6. **prepare**: 인스턴스 준비 (prepare.yml)
7. **converge**: Role 적용 (converge.yml)
8. **idempotence**: 멱등성 테스트
9. **side-effect**: 부가 효과 테스트
10. **verify**: 결과 검증 (verify.yml)
11. **cleanup**: 정리 (cleanup.yml)
12. **destroy**: 인스턴스 제거

## CI/CD 통합

### GitHub Actions

```yaml
# .github/workflows/molecule.yml
name: Molecule Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        distro:
          - docker.io/geerlingguy/docker-ubuntu2204-ansible:latest
          - docker.io/geerlingguy/docker-rockylinux9-ansible:latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install molecule[docker,lint]
          pip install ansible-core

      - name: Run Molecule tests
        run: molecule test
        env:
          MOLECULE_DISTRO: ${{ matrix.distro }}
```

### GitLab CI

```yaml
# .gitlab-ci.yml
molecule:
  image: docker:latest
  services:
    - docker:dind
  variables:
    DOCKER_TLS_CERTDIR: ""
  before_script:
    - apk add --no-cache python3 py3-pip
    - pip3 install molecule[docker,lint] ansible-core
  script:
    - molecule test
  tags:
    - docker
```

## 모범 사례

### 1. 멱등성 테스트

Role이 여러 번 실행되어도 동일한 결과를 보장해야 합니다:

```sh
# converge를 두 번 실행하여 변경 사항이 없는지 확인
$ molecule converge
$ molecule converge
```

### 2. 다양한 OS 테스트

```yaml
platforms:
  - name: ubuntu-22.04
    image: docker.io/geerlingguy/docker-ubuntu2204-ansible:latest
  - name: rocky-9
    image: docker.io/geerlingguy/docker-rockylinux9-ansible:latest
  - name: debian-12
    image: docker.io/geerlingguy/docker-debian12-ansible:latest
```

### 3. 명확한 검증

```yaml
- name: Verify with clear messages
  assert:
    that:
      - result.rc == 0
    fail_msg: "Command failed: {{ result.stderr }}"
    success_msg: "Command succeeded: {{ result.stdout }}"
```

### 4. 테스트 격리

각 테스트는 독립적으로 실행 가능해야 합니다:

```yaml
- name: Clean up before test
  file:
    path: /tmp/test_data
    state: absent
```

### 5. 디버깅 활성화

```sh
# 상세 로그로 실행
$ MOLECULE_DEBUG=true molecule test

# 인스턴스를 유지하며 디버깅
$ molecule test --destroy=never
```

## 문제 해결

### Docker 권한 문제

```sh
$ sudo usermod -aG docker $USER
$ newgrp docker
```

### systemd 지원 문제

Docker 컨테이너에서 systemd를 사용하려면:

```yaml
platforms:
  - name: instance
    image: docker.io/geerlingguy/docker-ubuntu2204-ansible:latest
    privileged: true
    volumes:
      - /sys/fs/cgroup:/sys/fs/cgroup:rw
    command: /sbin/init
    tmpfs:
      - /run
      - /tmp
```

### 메모리 부족

```yaml
platforms:
  - name: instance
    docker_networks:
      - name: molecule
    networks:
      - name: molecule
    ulimits:
      - nofile:262144:262144
```

## 결론

Molecule은 Ansible Role의 품질을 보장하기 위한 필수 도구입니다. 체계적인 테스트를 통해:

- **신뢰성**: Role이 의도한 대로 동작하는지 확인
- **이식성**: 다양한 OS 및 환경에서의 호환성 보장
- **유지보수성**: CI/CD 통합으로 지속적인 품질 관리
- **생산성**: 수동 테스트 시간 단축

Molecule을 프로젝트에 도입하여 Ansible Role의 품질을 한 단계 높이세요.

## 참고 자료

- [Molecule 공식 문서](https://molecule.readthedocs.io/en/latest/)
- [Ansible Molecule GitHub](https://github.com/ansible-community/molecule)
- [Testinfra 문서](https://testinfra.readthedocs.io/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
