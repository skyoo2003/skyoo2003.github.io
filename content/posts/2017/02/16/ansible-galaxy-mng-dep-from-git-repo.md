---
title: Ansible Galaxy - Git 저장소를 활용하여 Role 의존성 관리하기
description: "Ansible Role을 Git 저장소에 올리고 requirements.yml로 가져오는 방법, private 저장소 인증과 Jenkins·GitHub Actions 연동을 정리한다."
date: 2017-02-16T17:31:36+09:00
tags: [ansible, tutorial]
---

## Git 저장소에 Ansible Role 올리기

먼저 Ansible Role을 개발할 Git repository를 만든 뒤, Ansible Galaxy로 Role의 초기 프로젝트 구조를 생성한다.

* Git repository 를 로컬 머신에 복제한다.

```bash
$ git clone "https://github.com/xxxxx/sample-role.git"
```

* Ansible Role 초기 디렉토리 및 파일 생성한다.

```bash
$ ansible-galaxy init --force sample-role
- sample-role was created successfully

$ tree sample-role/
sample-role/
├── README.md
├── defaults
│   └── main.yml
├── files
├── handlers
│   └── main.yml
├── meta
│   └── main.yml
├── tasks
│   └── main.yml
├── templates
├── tests
│   ├── inventory
│   └── test.yml
└── vars
    └── main.yml
```

* Ansible Role 개발을 진행 한 뒤에 Git repository 에 Push

```bash
$ git commit * -m "Add ansible role" && git push
```

## Git 저장소로부터 Ansible Role 가져오기

* 방법 1) Ansible Galaxy CLI 명령을 통해 다운로드

```bash
$ ansible-galaxy install git+https://github.com/xxxx/sample-role.git,master -p roles/

$ tree roles/
roles/
└── sample-role
    ├── README.md
    ├── defaults
    │   └── main.yml
    ├── handlers
    │   └── main.yml

    ├── meta
    │   └── main.yml
    ├── tasks
    │   └── main.yml
    ├── tests
    │   ├── inventory
    │   └── test.yml
    └── vars
        └── main.yml
```

* 방법 2) 의존성 파일에 명시하고 CLI 명령을 통해 다운로드

```bash
$ vi requirements.yml
- src: git+https://github.com/xxxx/sample-role.git
  version: master

$ ansible-galaxy install -r requirements.yml -p roles/
- extracting sample-role to roles/sample-role
- sample-role was installed successfully

$ tree roles/
roles/
└── sample-role
    ├── README.md
    ├── defaults
    │   └── main.yml
    ├── handlers
    │   └── main.yml

    ├── meta
    │   └── main.yml
    ├── tasks
    │   └── main.yml
    ├── tests
    │   ├── inventory
    │   └── test.yml
    └── vars
        └── main.yml
```

## 'requirements.yml' 작성하기

* src
    * username.role_name : Ansible Galaxy 공식 저장소에 등록된 Ansible Role 을 다운로드할 때 사용.
    * url : Ansible Galaxy 에서 지원하는 SCM으로부터 다운로드할 때 사용.
* scm
    * 연동할 SCM 이름을 명시. 디폴트 값은 'git' (ansible-galaxy 2.2.1.0 기준으로 git, hg 만 지원)
* version
    * tag 명 / commit hash 값 / branch 이름을 명시. 디폴트는 'master'
    * SCM 으로부터 가져올 때에만 사용.
* name
    * 다운로드한 Ansible Role 의 이름을 명시. 기본적으로는 Ansible Galaxy에 등록된 이름 혹은 Git repository 의 이름을 사용.

아래 예시를 참고!

```yaml
# from galaxy
- src: yatesr.timezone

# from GitHub
- src: https://github.com/bennojoy/nginx

# from GitHub, overriding the name and specifying a specific tag
- src: https://github.com/bennojoy/nginx
  version: master
  name: nginx_role

# from a webserver, where the role is packaged in a tar.gz
- src: https://some.webserver.example.com/files/master.tar.gz
  name: http-role

# from Bitbucket
- src: git+http://bitbucket.org/willthames/git-ansible-galaxy
  version: v1.4

# from Bitbucket, alternative syntax and caveats
- src: http://bitbucket.org/willthames/hg-ansible-galaxy
  scm: hg

# from GitLab or other git-based scm
- src: git@gitlab.company.com:mygroup/ansible-base.git
  scm: git
  version: "0.1"  # quoted, so YAML doesn't parse this as a floating-point value
```

## Private Git 저장소 활용하기

### SSH 키 기반 인증

```yaml
# requirements.yml
- src: git@github.com:myorg/private-role.git
  scm: git
  version: v1.0.0
  name: private_role
```

```bash
# SSH 키 설정
$ eval "$(ssh-agent -s)"
$ ssh-add ~/.ssh/id_rsa

# Role 설치
$ ansible-galaxy install -r requirements.yml
```

### Personal Access Token 활용 (HTTPS)

```yaml
# requirements.yml
- src: https://<token>@github.com/myorg/private-role.git
  version: main
  name: private_role
```

### 배포 키 설정

GitHub/GitLab의 Deploy Key 기능을 활용하면 읽기 전용 접근을 안전하게 구성할 수 있다.

```bash
# 배포 키 생성
$ ssh-keygen -t ed25519 -C "deploy@myserver" -f deploy_key

# 공개 키를 Git 저장소에 등록
# Settings > Deploy keys > Add deploy key
```

## CI/CD 파이프라인 통합

### Jenkins Pipeline 예시

```groovy
pipeline {
    agent any
    
    stages {
        stage('Install Dependencies') {
            steps {
                sh 'ansible-galaxy install -r requirements.yml -p roles/'
            }
        }
        
        stage('Lint') {
            steps {
                sh 'ansible-lint site.yml'
            }
        }
        
        stage('Test') {
            steps {
                sh 'molecule test'
            }
        }
        
        stage('Deploy') {
            steps {
                sh 'ansible-playbook -i inventory/production site.yml'
            }
        }
    }
}
```

### GitHub Actions 예시

```yaml
name: Ansible CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'
      
      - name: Install Ansible
        run: pip install ansible ansible-lint
      
      - name: Install Roles
        run: ansible-galaxy install -r requirements.yml -p roles/
      
      - name: Lint Playbook
        run: ansible-lint site.yml
      
      - name: Run Molecule Tests
        run: |
          pip install molecule[docker]
          molecule test
```

## Role 버전 관리 전략

### 시맨틱 버저닝 (Semantic Versioning)

```
MAJOR.MINOR.PATCH

MAJOR: 호환되지 않는 API 변경
MINOR: 하위 호환되는 기능 추가
PATCH: 하위 호환되는 버그 수정
```

```yaml
# requirements.yml에서 버전 범위 지정 (지원하지 않음)
# 대신 정확한 버전 명시 권장
- src: git+https://github.com/xxxx/sample-role.git
  version: v1.2.3  # 정확한 버전
```

### 브랜치 전략

```
main (또는 master)
├── develop
│   ├── feature/new-feature
│   └── bugfix/issue-123
├── release/v1.2.0
└── hotfix/v1.1.1
```

### 운영 환경에서의 버전 고정

```yaml
# 운영 환경 requirements.yml
- src: git+https://github.com/xxxx/nginx-role.git
  version: v2.1.0  # 태그로 고정

- src: git+https://github.com/xxxx/mysql-role.git
  version: abc123def456  # 커밋 해시로 고정 (더 안전)
```

## Role 의존성 관리 심화

### 중첩 의존성

Role 내에서 다른 Role에 대한 의존성을 정의할 수 있다.

```yaml
# roles/web-server/meta/main.yml
dependencies:
  - role: common
    vars:
      common_var: value
  - role: nginx
    when: web_server_type == 'nginx'
```

### 조건부 의존성

```yaml
# 특정 조건에서만 의존성 설치
dependencies:
  - role: nginx
    when: web_server == 'nginx'
  - role: apache
    when: web_server == 'apache'
```

## 트러블슈팅

### 자주 발생하는 문제

**1. Role을 찾을 수 없음**

```bash
ERROR! the role 'sample-role' was not found
```

해결:
```bash
# Role 경로 확인
$ ansible-galaxy list
# /etc/ansible/roles
# /home/user/.ansible/roles

# 경로 지정하여 설치
$ ansible-galaxy install -r requirements.yml -p ./roles
```

**2. 버전 충돌**

```bash
ERROR! conflicting role requirements
```

해결:
```yaml
# 서로 다른 버전이 필요한 경우, 이름을 구분
- src: git+https://github.com/xxxx/nginx-role.git
  version: v1.0.0
  name: nginx_v1

- src: git+https://github.com/xxxx/nginx-role.git
  version: v2.0.0
  name: nginx_v2
```

**3. Git 인증 실패**

```bash
Permission denied (publickey)
```

해결:
```bash
# SSH 키 확인
$ ssh -T git@github.com

# SSH 에이전트에 키 추가
$ eval "$(ssh-agent -s)"
$ ssh-add ~/.ssh/id_rsa
```

**4. 프록시 환경에서의 설치**

```bash
# 프록시 설정
$ export https_proxy=http://proxy.company.com:8080
$ ansible-galaxy install -r requirements.yml
```

## 모범 사례

### 1. 명시적 버전 관리

```yaml
# 좋은 예: 명시적 버전
- src: git+https://github.com/xxxx/role.git
  version: v1.2.3

# 피해야 할 예: 브랜치명 사용 (운영 환경)
- src: git+https://github.com/xxxx/role.git
  version: main  # 브랜치는 변경될 수 있음
```

### 2. 로컬 개발 환경 구성

```bash
# ansible.cfg
[defaults]
roles_path = ./roles:~/.ansible/roles
collections_path = ./collections:~/.ansible/collections
```

### 3. Role 검증

```bash
# ansible-lint로 Role 검증
$ ansible-lint roles/sample-role/

# molecule로 Role 테스트
$ molecule test
```

### 4. 의존성 최소화

```yaml
# meta/main.yml
dependencies: []  # 불필요한 의존성 피하기
```

## 참고 링크

- [Ansible-Galaxy Document](http://docs.ansible.com/ansible/galaxy.html)
- [Reusing ansible roles with private git repos and dependency management](https://opencredo.com/reusing-ansible-roles-with-private-git-repos-and-dependencies/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
- [Molecule Testing Framework](https://molecule.readthedocs.io/)
