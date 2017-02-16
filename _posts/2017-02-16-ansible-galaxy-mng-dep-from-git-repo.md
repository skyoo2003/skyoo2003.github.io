---
layout: post
title:  Ansible Galaxy, Managing dependencies from a git repository
date:   2017-02-16T17:31:36+0900
categories: [all, ansible]
permalink: /post/:year/:month/:day/:title
published: true
---

## Push the Ansible Role into git repository

먼저, Ansible Role 을 개발하기 위한 Git repository를 생성한다. 그리고, Ansible Role 초기 프로젝트 구조를 Ansible Galaxy 를 사용하여 생성한다.

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

## Pull the Ansible Role from git repository

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

## Write 'requirements.yml'

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

## References

[1] [Ansible-Galaxy Document](http://docs.ansible.com/ansible/galaxy.html){:target="_blank"}

[2] [Reusing ansible roles with private git repos and dependency management](https://opencredo.com/reusing-ansible-roles-with-private-git-repos-and-dependencies/){:target="_blank"}
