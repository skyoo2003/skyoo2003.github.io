---
title: "Ansible Molecule with Kind - 도커를 활용한 쿠버네티스 자동화 테스트 작성"
date: 2022-05-26T22:08:24+09:00
tags: [ansible, testing]
---

# [Ansible Molecule](https://github.com/ansible-community/molecule) with [KIND (Kubernetes IN Docker)](https://github.com/kubernetes-sigs/kind)

- Ansible Molecule은 Ansible roles를 가상화 기술을 통해 환경을 고립시켜서 환경 구성을 테스트할 수 있게 도와주는 도구.
- KIND는 Kubernetes 클러스터를 도커 컨테이너로 동작시켜주는 도구. 쿠버네티스 클러스터 위에서 리소스를 배치하고 리소스를 확인하거나 어플리케이션 동작을 검증하는 용도로 사용함. (ex, Helm Chart)

## 제약사항

- [Docker Engine](https://docs.docker.com/engine/install/) 설치
- [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) 설치
- Python libraries 설치
    - `pip install molecule[docker,lint] molecule-docker!=0.3.4 openshift`
        - [molecule-docker 0.3.4 버전은 문제가 있어 사용 금지](https://github.com/ansible-community/molecule-docker/issues/57)
- Ansible collections 설치
    - `ansible-galaxy collection install community.kubernetes community.docker`


## 테스트 시나리오 작성 및 실행

0. Ansible role 생성

```sh
$ ansible-galaxy role init myrole
- Role myrole was created successfully

$ tree myrole
myrole
├── README.md
├── defaults
│   └── main.yml
├── files
├── handlers
│   └── main.yml
├── meta
│   └── main.yml
├── tasks
│   └── main.yml
├── templates
├── tests
│   ├── inventory
│   └── test.yml
└── vars
    └── main.yml

$ vi myrole/meta/main.yml
---
collections:
  - community.kubernetes
    
$ vi myrole/tasks/main.yml
---
- name: Ensure the K8S Namespace exists.
  k8s:
    api_version: v1
    kind: Namespace
    name: "myrole-ns"
    kubeconfig: "{{ kube_config }}"
    state: present
```

1. Molecule default 시나리오 초기화

```sh
$ cd myrole

$ molecule init scenario --dependency-name galaxy --driver-name delegated --provisioner-name ansible --verifier-name ansible default
INFO     Initializing new scenario default...
INFO     Initialized scenario in /path/to/myrole/molecule/default successfully.

$ tree molecule
molecule
└── default
    ├── INSTALL.rst
    ├── converge.yml
    ├── create.yml
    ├── destroy.yml
    ├── molecule.yml
    └── verify.yml

1 directory, 6 files
```

2. KIND Config 매니페스트 파일 생성

```sh
$ mkdir -p molecule/default/manifests
$ vi molecule/default/manifests/kindconfig.yaml
---
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  kubeProxyMode: ipvs
nodes:
  - role: control-plane
    image: kindest/node:v1.19.7@sha256:a70639454e97a4b733f9d9b67e12c01f6b0297449d5b9cbbef87473458e26dca
  - role: worker
    image: kindest/node:v1.19.7@sha256:a70639454e97a4b733f9d9b67e12c01f6b0297449d5b9cbbef87473458e26dca
```

3. Molecule default 시나리오 설정 수정

```sh
$ vi molecule/default/molecule.yml
---
dependency:
  name: galaxy
driver:
  name: delegated
platforms:
  - name: instance
provisioner:
  name: ansible
  inventory:
    host_vars:
      localhost:
        kind_name: myk8s
        kind_config: manifests/kindconfig.yaml
        kube_config: /tmp/kind/kubeconfig.yaml
verifier:
  name: ansible
```

4. Molecule default 시나리오 생성 플레이북 수정

```sh
$ vi molecule/default/create.yml
---
- name: Create
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Create Kubernetes in Docker
      command: >-
        kind create cluster
          --name {{ kind_name }}
          --config {{ kind_config }}
          --kubeconfig {{ kube_config }}
      changed_when: true
```

5. Molecule default 시나리오 삭제 플레이북 수정

```sh
$ vi molecule/default/destory.yml
---
- name: Destroy
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Delete Kubernetes in Docker
      command: >-
        kind delete cluster
          --name {{ kind_name }}
          --kubeconfig {{ kube_config }}
      changed_when: true
```

6. Molecule default 사나리오 환경 구축 플레이북 수정

```sh
$ vi molecule/default/converge.yml
---
- name: Converge
  hosts: localhost
  connection: local
  gather_facts: false
  collections:
    - community.kubernetes
  tasks:
    - include_role:
        name: "myrole"
```

7. Molecule default 시나리오 검증 플레이북 수정

```sh
$ vi molecule/default/verify.yml
---
- name: Verify
  hosts: localhost
  connection: local
  gather_facts: false
  collections:
    - community.kubernetes
  tasks:
    - k8s_info:
        kind: Namespace
        name: "myrole-ns"
        kubeconfig: "{{ kube_config }}"
      register: k8s_info_result

    - assert:
        that: not k8s_info_result.failed
        fail_msg: "K8S Namespace not exists"
        success_msg: "K8S Namspace exists"
```

8. Molecule default 시나리오 테스트

```sh
# Molecule default 시나리오 테스트 수행
$ molecule test

# Molecule default 시나리오 환경 구축 (Optional)
## 쿠버네티스 클러스터와 환경 구축까지만 진행한 상태에서 직접 확인해보고 싶을 때 사용 가능
$ molecule converge

# Molecule default 시나리오 환경 제거 (Optional)
## 수동으로 쿠버네티스 클러스터와 환경 구축을 진행한 경우 직접 삭제를 해줘야 함.
$ molecule destory
```
## 주의사항

- KIND는 base/node 이미지로 구성
    - [base 이미지](https://kind.sigs.k8s.io/docs/design/base-image/)는 ubuntu, systemd, containers 등의 쿠버네티스가 동작할 수 있는 기반 프로그램이 설치되는 이미지
    - [node 이미지](https://kind.sigs.k8s.io/docs/design/node-image/)는 base 이미지를 기준으로 kubernetes 클러스터 동작을 위한 이미지
    - Ubuntu 버전 등의 기반 패키지의 버전을 실 환경과 동일하게 맞추려면, base/node 이미지를 KIND 문서를 참고해서 직접 만들어야 함.
