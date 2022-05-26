---
title: "Ansible Molecule으로 테스트 작성하기"
date: 2022-05-26T21:48:32+09:00
tags: [ansible, testing]
---

# [Molecule](https://molecule.readthedocs.io/en/latest/)

ansible-community 에서 관리하는 Ansible role용 테스트 프레임워크. Molecule는 여러 인스턴스, 운영 체제 및 배포, 가상화 공급자, 테스트 프레임 워크 및 테스트 시나리오를 사용한 테스트를 지원.

## 설치하기

Pip 설치 시, 시스템 파이썬의 의존성을 꼬이게할 수 있으므로 가급적 Virtualenv로 가상 환경을 만들거나 Pipenv, Poetry 등의 의존성 관리 도구 사용하는 것을 권장.

```sh
# docker 및 yamllint, ansible-lint 패키지 추가로 설치. (podman, vagrant, azure, hetzer 도 지원)
$ pip install molecule[docker,lint] 
```

## 테스트 작성

1. `/path/to/role/molecule/default` 경로에 디렉토리 생성. (default 는 기본 시나리오. 다른 이름으로 시나리오 추가 가능함)
2. `/path/to/role/molecule/default/molecule.yml` 파일 생성 후 아래 내용 입력.

```yaml
---
dependency:
  name: galaxy
  options:
    requirements-file: ../../requirements.yml
driver:
  name: docker
platforms:
  - name: instance
    image: docker.io/python:3.6-slim-buster
    pre_build_image: true
provisioner:
  name: ansible
verifier:
  name: ansible
lint: |
  set -e
  yamllint -c ../../.yamllint .
  ansible-lint -c ../../.ansible-lint
```

3. `/path/to/role/molecule/default/converge.yml` 생성 후 환경 구성 코드 추가

도커 컨테이너를 만들고 난 이후에 Role 수행으로 환경을 구성하기 위한 코드를 삽입. (웹 서버 배포 등)

```yaml
---
- name: Converge
  hosts: all
  tasks:
    - include_role:
        name: "myrole"
```

4. `/path/to/role/molecule/default/verify.yml` 생성 후 검증 코드 추가

환경 구성 이후 환경을 검증하기 위한 코드를 삽입 (실질적인 테스트 수행 단계)

```yaml
---
- name: Verify
  hosts: all
  gather_facts: false
  tasks:
    - assert:
         that: "{{ condition }}"
```

## 실행하기

```sh
$ cd /path/to/role
$ molecule create # 의존성 설치 및 도커 컨테이너 구동
$ molecule converge # converge.yml 구동
$ molecule verify # verify.yml 구동
$ molecule destroy # 의존성 및 도커 컨테이너 제거
$ molecule test # 위 과정을 한방에 수행
```
