---
title: "Ansible Molecule with Kind - 도커를 활용한 쿠버네티스 자동화 테스트 작성"
description: "Ansible Molecule의 delegated 드라이버와 KIND를 조합해 도커 위 쿠버네티스 클러스터에서 Ansible Role을 자동 테스트하는 과정을 단계별로 정리한다."
date: 2022-05-26T22:08:24+09:00
tags: [ansible, kubernetes, testing, tutorial, devops]
---

# Ansible Molecule with KIND 소개

[Ansible Molecule](https://github.com/ansible-community/molecule)과 [KIND (Kubernetes IN Docker)](https://github.com/kubernetes-sigs/kind)를 조합하여 쿠버네티스 자동화 테스트 환경을 구축하는 방법을 소개합니다.

## 개요

### Ansible Molecule

Ansible Molecule은 가상화 기술로 고립된 환경을 만들어 Ansible Roles를 테스트할 수 있게 도와주는 프레임워크입니다. 다양한 드라이버를 지원하며 Kubernetes 환경에서는 Delegated 드라이버로 KIND와 통합할 수 있습니다.

### KIND (Kubernetes IN Docker)

KIND는 Kubernetes 클러스터를 Docker 컨테이너로 동작시켜주는 도구입니다. 로컬 환경에서 빠르고 가볍게 Kubernetes 클러스터를 생성할 수 있어 다음과 같은 용도로 활용됩니다:

- Helm Chart 테스트
- Kubernetes 리소스 배포 검증
- 어플리케이션 동작 확인
- CI/CD 파이프라인 통합 테스트

### 왜 Molecule + KIND인가?

| 장점 | 설명 |
|------|------|
| **빠른 피드백** | 로컬에서 몇 분 내에 전체 클러스터 테스트 가능 |
| **비용 절감** | 클라우드 리소스 없이 Kubernetes 테스트 수행 |
| **재현성** | 항상 동일한 테스트 환경 보장 |
| **CI/CD 통합** | GitHub Actions, GitLab CI 등과 쉽게 통합 |
| **멱등성 검증** | Role이 여러 번 실행되어도 안전한지 확인 |

## 사전 요구사항

### 시스템 요구사항

- **운영체제**: Linux, macOS, Windows (WSL2)
- **메모리**: 최소 8GB RAM (16GB 권장)
- **CPU**: 최소 4코어
- **디스크**: 최소 20GB 여유 공간

### 필수 설치 항목

#### 1. Docker Engine 설치

```sh
# Ubuntu/Debian
$ curl -fsSL https://get.docker.com | sh
$ sudo usermod -aG docker $USER

# macOS
$ brew install --cask docker

# 설치 확인
$ docker --version
Docker version 24.0.7, build afdd53b
```

#### 2. KIND 설치

```sh
# Linux
$ curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
$ chmod +x ./kind
$ sudo mv ./kind /usr/local/bin/kind

# macOS
$ brew install kind

# 설치 확인
$ kind version
kind v0.20.0 go1.20.10 linux/amd64
```

#### 3. kubectl 설치

```sh
# Linux
$ curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
$ chmod +x kubectl
$ sudo mv kubectl /usr/local/bin/

# macOS
$ brew install kubectl

# 설치 확인
$ kubectl version --client
```

#### 4. Python 라이브러리 설치

```sh
# 가상 환경 생성 (권장)
$ python -m venv .venv
$ source .venv/bin/activate

# Molecule 및 관련 패키지 설치
# 주의: molecule-docker 0.3.4 버전은 버그가 있어 사용 금지
$ pip install 'molecule[docker,lint]' 'molecule-docker!=0.3.4' openshift

# 설치 확인
$ molecule --version
molecule 24.9.0 using python 3.11
```

#### 5. Ansible Collections 설치

```sh
# Kubernetes 관련 collections 설치
$ ansible-galaxy collection install community.kubernetes community.docker

# 설치된 collections 확인
$ ansible-galaxy collection list
# community.kubernetes:2.0.0
# community.docker:3.4.0
```

## 테스트 시나리오 작성 및 실행

### Step 0: Ansible Role 생성

먼저 테스트할 Ansible Role을 생성합니다:

```sh
$ ansible-galaxy role init myrole
- Role myrole was created successfully

$ tree myrole
myrole
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

Role의 `meta/main.yml`에 collection 의존성을 추가합니다:

```yaml
# myrole/meta/main.yml
---
collections:
  - name: community.kubernetes
    version: ">=2.0.0"
  - name: community.docker
    version: ">=3.0.0"

dependencies: []

galaxy_info:
  author: your_name
  description: Kubernetes namespace management role
  license: MIT
  min_ansible_version: "2.12"
  platforms:
    - name: Ubuntu
      versions:
        - focal
        - jammy
```

Role의 `tasks/main.yml`을 작성합니다:

```yaml
# myrole/tasks/main.yml
---
- name: Ensure the K8S Namespace exists
  kubernetes.core.k8s:
    api_version: v1
    kind: Namespace
    name: "{{ namespace_name | default('myrole-ns') }}"
    kubeconfig: "{{ kube_config }}"
    state: present
  register: namespace_result

- name: Display namespace creation result
  debug:
    msg: "Namespace {{ namespace_name | default('myrole-ns') }} created successfully"
  when: namespace_result.changed

- name: Create ConfigMap in namespace
  kubernetes.core.k8s:
    kubeconfig: "{{ kube_config }}"
    state: present
    definition:
      apiVersion: v1
      kind: ConfigMap
      metadata:
        name: "{{ configmap_name | default('myrole-config') }}"
        namespace: "{{ namespace_name | default('myrole-ns') }}"
      data:
        APP_ENV: "{{ app_env | default('development') }}"
        LOG_LEVEL: "{{ log_level | default('info') }}"
  register: configmap_result

- name: Create Deployment in namespace
  kubernetes.core.k8s:
    kubeconfig: "{{ kube_config }}"
    state: present
    definition:
      apiVersion: apps/v1
      kind: Deployment
      metadata:
        name: "{{ deployment_name | default('myrole-app') }}"
        namespace: "{{ namespace_name | default('myrole-ns') }}"
      spec:
        replicas: "{{ replicas | default(1) }}"
        selector:
          matchLabels:
            app: myrole-app
        template:
          metadata:
            labels:
              app: myrole-app
          spec:
            containers:
              - name: nginx
                image: nginx:latest
                ports:
                  - containerPort: 80
  register: deployment_result
```

### Step 1: Molecule Default 시나리오 초기화

```sh
$ cd myrole

$ molecule init scenario \
    --dependency-name galaxy \
    --driver-name delegated \
    --provisioner-name ansible \
    --verifier-name ansible \
    default

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
```

**드라이버 선택 설명:**

- `delegated`: KIND와 같은 외부 도구를 사용할 때 선택합니다. Molecule이 직접 인스턴스를 관리하지 않고 사용자 정의 플레이북에 위임합니다.

### Step 2: KIND Config 매니페스트 파일 생성

```sh
$ mkdir -p molecule/default/manifests
```

```yaml
# molecule/default/manifests/kindconfig.yaml
---
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
networking:
  kubeProxyMode: ipvs
  podSubnet: "10.244.0.0/16"
  serviceSubnet: "10.96.0.0/12"
nodes:
  - role: control-plane
    image: kindest/node:v1.27.3@sha256:3966ac761ae0136263ffdb6cfd4db23ef8a83cba8a463690e98317add2c9ba72
    kubeadmConfigPatches:
      - |
        kind: InitConfiguration
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "ingress-ready=true"
    extraPortMappings:
      - containerPort: 80
        hostPort: 8080
        protocol: TCP
      - containerPort: 443
        hostPort: 8443
        protocol: TCP
  - role: worker
    image: kindest/node:v1.27.3@sha256:3966ac761ae0136263ffdb6cfd4db23ef8a83cba8a463690e98317add2c9ba72
  - role: worker
    image: kindest/node:v1.27.3@sha256:3966ac761ae0136263ffdb6cfd4db23ef8a83cba8a463690e98317add2c9ba72
```

**KIND 설정 설명:**

| 옵션 | 설명 |
|------|------|
| `kubeProxyMode` | kube-proxy 모드 (iptables, ipvs) |
| `podSubnet` | Pod 네트워크 CIDR |
| `serviceSubnet` | Service 네트워크 CIDR |
| `extraPortMappings` | 호스트-컨테이너 포트 매핑 |
| `kubeadmConfigPatches` | kubeadm 설정 패치 |

### Step 3: Molecule Default 시나리오 설정 수정

```yaml
# molecule/default/molecule.yml
---
dependency:
  name: galaxy
  options:
    requirements-file: ../../requirements.yml
driver:
  name: delegated
platforms:
  - name: instance
    groups:
      - k8s
provisioner:
  name: ansible
  inventory:
    host_vars:
      localhost:
        kind_name: myk8s
        kind_config: manifests/kindconfig.yaml
        kube_config: /tmp/kind/kubeconfig.yaml
        namespace_name: myrole-ns
        configmap_name: myrole-config
        deployment_name: myrole-app
        app_env: testing
        log_level: debug
        replicas: 2
  env:
    ANSIBLE_FORCE_COLOR: "true"
    ANSIBLE_STDOUT_CALLBACK: yaml
verifier:
  name: ansible
lint: |
  set -e
  yamllint -c ../../.yamllint .
  ansible-lint -c ../../.ansible-lint
```

### Step 4: Molecule Default 시나리오 생성 플레이북 수정

```yaml
# molecule/default/create.yml
---
- name: Create
  hosts: localhost
  connection: local
  gather_facts: false
  vars:
    kind_download_url: https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
  tasks:
    - name: Check if KIND is installed
      command: kind version
      register: kind_check
      changed_when: false
      failed_when: false

    - name: Fail if KIND is not installed
      fail:
        msg: "KIND is not installed. Please install KIND first."
      when: kind_check.rc != 0

    - name: Create kubeconfig directory
      file:
        path: "{{ kube_config | dirname }}"
        state: directory
        mode: '0755'

    - name: Check if cluster already exists
      command: kind get clusters
      register: existing_clusters
      changed_when: false

    - name: Delete existing cluster if exists
      command: "kind delete cluster --name {{ kind_name }}"
      when: kind_name in existing_clusters.stdout

    - name: Create Kubernetes cluster with KIND
      command: >-
        kind create cluster
          --name {{ kind_name }}
          --config {{ kind_config }}
          --kubeconfig {{ kube_config }}
          --wait 5m
      register: create_result
      changed_when: true

    - name: Wait for cluster to be ready
      command: kubectl --kubeconfig {{ kube_config }} wait --for=condition=Ready nodes --all --timeout=300s
      changed_when: false

    - name: Display cluster info
      command: kubectl --kubeconfig {{ kube_config }} cluster-info
      register: cluster_info
      changed_when: false

    - name: Show cluster info
      debug:
        var: cluster_info.stdout_lines
```

### Step 5: Molecule Default 시나리오 삭제 플레이북 수정

```yaml
# molecule/default/destroy.yml
---
- name: Destroy
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Check if cluster exists
      command: kind get clusters
      register: existing_clusters
      changed_when: false
      failed_when: false

    - name: Delete Kubernetes cluster
      command: >-
        kind delete cluster
          --name {{ kind_name }}
          --kubeconfig {{ kube_config }}
      when: kind_name in existing_clusters.stdout
      register: delete_result
      changed_when: true

    - name: Remove kubeconfig file
      file:
        path: "{{ kube_config }}"
        state: absent
      when: kind_name in existing_clusters.stdout

    - name: Clean up kubeconfig directory
      file:
        path: "{{ kube_config | dirname }}"
        state: absent
      when:
        - kind_name in existing_clusters.stdout
        - kube_config | dirname != '/tmp'

    - name: Display cleanup result
      debug:
        msg: "Cluster {{ kind_name }} has been destroyed"
      when: kind_name in existing_clusters.stdout
```

### Step 6: Molecule Default 시나리오 환경 구축 플레이북 수정

```yaml
# molecule/default/converge.yml
---
- name: Converge
  hosts: localhost
  connection: local
  gather_facts: false
  collections:
    - community.kubernetes
    - kubernetes.core
  vars:
    kube_config: /tmp/kind/kubeconfig.yaml
  pre_tasks:
    - name: Verify cluster connectivity
      kubernetes.core.k8s_info:
        kubeconfig: "{{ kube_config }}"
        kind: Namespace
        name: default
      register: cluster_status

    - name: Display cluster status
      debug:
        msg: "Cluster is ready and accessible"
      when: not cluster_status.failed
  tasks:
    - name: Include myrole
      include_role:
        name: "myrole"
```

### Step 7: Molecule Default 시나리오 검증 플레이북 수정

```yaml
# molecule/default/verify.yml
---
- name: Verify
  hosts: localhost
  connection: local
  gather_facts: false
  collections:
    - community.kubernetes
    - kubernetes.core
  vars:
    kube_config: /tmp/kind/kubeconfig.yaml
    expected_namespace: myrole-ns
    expected_configmap: myrole-config
    expected_deployment: myrole-app
  tasks:
    - name: Verify Namespace exists
      kubernetes.core.k8s_info:
        kind: Namespace
        name: "{{ expected_namespace }}"
        kubeconfig: "{{ kube_config }}"
      register: namespace_info

    - name: Assert Namespace exists and is active
      assert:
        that:
          - not namespace_info.failed
          - namespace_info.resources | length > 0
          - namespace_info.resources[0].status.phase == "Active"
        fail_msg: "Namespace {{ expected_namespace }} does not exist or is not active"
        success_msg: "Namespace {{ expected_namespace }} exists and is active"

    - name: Verify ConfigMap exists
      kubernetes.core.k8s_info:
        kind: ConfigMap
        namespace: "{{ expected_namespace }}"
        name: "{{ expected_configmap }}"
        kubeconfig: "{{ kube_config }}"
      register: configmap_info

    - name: Assert ConfigMap exists with correct data
      assert:
        that:
          - not configmap_info.failed
          - configmap_info.resources | length > 0
          - "'APP_ENV' in configmap_info.resources[0].data"
          - configmap_info.resources[0].data.APP_ENV == "testing"
        fail_msg: "ConfigMap {{ expected_configmap }} does not exist or has incorrect data"
        success_msg: "ConfigMap {{ expected_configmap }} exists with correct data"

    - name: Verify Deployment exists
      kubernetes.core.k8s_info:
        kind: Deployment
        namespace: "{{ expected_namespace }}"
        name: "{{ expected_deployment }}"
        kubeconfig: "{{ kube_config }}"
      register: deployment_info

    - name: Assert Deployment exists
      assert:
        that:
          - not deployment_info.failed
          - deployment_info.resources | length > 0
        fail_msg: "Deployment {{ expected_deployment }} does not exist"
        success_msg: "Deployment {{ expected_deployment }} exists"

    - name: Wait for Deployment to be ready
      kubernetes.core.k8s_info:
        kind: Deployment
        namespace: "{{ expected_namespace }}"
        name: "{{ expected_deployment }}"
        kubeconfig: "{{ kube_config }}"
      register: deployment_status
      until:
        - deployment_status.resources | length > 0
        - deployment_status.resources[0].status.readyReplicas is defined
        - deployment_status.resources[0].status.readyReplicas == deployment_status.resources[0].spec.replicas
      retries: 30
      delay: 10

    - name: Verify Deployment is fully ready
      assert:
        that:
          - deployment_status.resources[0].status.readyReplicas == deployment_status.resources[0].spec.replicas
        fail_msg: "Deployment {{ expected_deployment }} is not fully ready"
        success_msg: "Deployment {{ expected_deployment }} is fully ready"

    - name: Verify Pods are running
      kubernetes.core.k8s_info:
        kind: Pod
        namespace: "{{ expected_namespace }}"
        label_selectors:
          - "app=myrole-app"
        kubeconfig: "{{ kube_config }}"
      register: pod_info

    - name: Assert Pods are in Running state
      assert:
        that:
          - pod_info.resources | length > 0
          - pod_info.resources | selectattr('status.phase', 'equalto', 'Running') | list | length == pod_info.resources | length
        fail_msg: "Not all Pods are in Running state"
        success_msg: "All Pods are in Running state"
```

### Step 8: Molecule Default 시나리오 테스트

```sh
# 전체 테스트 수행 (생성 → 검증 → 삭제)
$ molecule test

# 개별 단계 수행
$ molecule create      # KIND 클러스터 생성
$ molecule converge    # Role 적용
$ molecule verify      # 테스트 검증
$ molecule destroy     # 클러스터 삭제

# 디버깅 모드
$ molecule create
$ molecule converge
$ kubectl --kubeconfig /tmp/kind/kubeconfig.yaml get all -n myrole-ns
$ molecule destroy

# 인스턴스 유지하며 디버깅
$ molecule test --destroy=never
$ molecule login       # 컨테이너 접속
```

## 고급 구성

### 다중 클러스터 테스트

```yaml
# molecule/multi-cluster/molecule.yml
---
dependency:
  name: galaxy
driver:
  name: delegated
platforms:
  - name: cluster-v1.27
    groups:
      - k8s
      - v1.27
  - name: cluster-v1.26
    groups:
      - k8s
      - v1.26
provisioner:
  name: ansible
  inventory:
    host_vars:
      cluster-v1.27:
        kind_name: test-v127
        kind_image: kindest/node:v1.27.3
      cluster-v1.26:
        kind_name: test-v126
        kind_image: kindest/node:v1.26.6
```

### Helm Chart 테스트

```yaml
# molecule/default/converge.yml (with Helm)
---
- name: Converge with Helm
  hosts: localhost
  connection: local
  vars:
    kube_config: /tmp/kind/kubeconfig.yaml
  tasks:
    - name: Add Helm repository
      kubernetes.core.helm_repository:
        name: bitnami
        repo_url: https://charts.bitnami.com/bitnami

    - name: Deploy NGINX Helm chart
      kubernetes.core.helm:
        name: nginx
        chart_ref: bitnami/nginx
        kubeconfig: "{{ kube_config }}"
        namespace: nginx
        create_namespace: true
        values:
          replicaCount: 2
          service:
            type: ClusterIP
```

## CI/CD 통합

### GitHub Actions

```yaml
# .github/workflows/molecule-kind.yml
name: Molecule Test with KIND

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
        k8s-version:
          - v1.27.3
          - v1.26.6
          - v1.25.11
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install 'molecule[docker,lint]' openshift
          ansible-galaxy collection install community.kubernetes community.docker

      - name: Install KIND
        uses: helm/kind-action@v1
        with:
          version: v0.20.0

      - name: Run Molecule tests
        run: molecule test
        env:
          KIND_NODE_VERSION: ${{ matrix.k8s-version }}
```

## 문제 해결

### KIND 클러스터 생성 실패

```sh
# Docker 로그 확인
$ docker logs <container_id>

# KIND 상세 로그
$ kind create cluster --retain --verbosity 10

# 리소스 정리
$ docker system prune -af
$ kind delete clusters $(kind get clusters)
```

### 메모리 부족 문제

```yaml
# KIND 설정에서 단일 노드로 변경
nodes:
  - role: control-plane
    image: kindest/node:v1.27.3
```

### 네트워크 문제

```sh
# Docker 네트워크 재생성
$ docker network prune
$ kind delete cluster
$ kind create cluster --config kindconfig.yaml
```

## 주의사항

### KIND 이미지 구성

KIND는 base 이미지와 node 이미지로 구성됩니다:

- **[Base 이미지](https://kind.sigs.k8s.io/docs/design/base-image/)**: Ubuntu, systemd, containers 등 쿠버네티스가 동작할 수 있는 기반 프로그램이 설치된 이미지
- **[Node 이미지](https://kind.sigs.k8s.io/docs/design/node-image/)**: Base 이미지를 기준으로 Kubernetes 클러스터 동작을 위한 이미지

Ubuntu 버전 등의 기반 패키지 버전을 실제 환경과 동일하게 맞추려면 KIND 문서를 참고하여 직접 이미지를 빌드해야 합니다.

```sh
# 커스텀 node 이미지 빌드
$ kind build node-image --base-image ubuntu:22.04
```

### 리소스 제한

KIND 클러스터는 Docker 컨테이너에서 실행되어 호스트 시스템의 리소스를 공유하므로, 대규모 테스트에서는 메모리와 CPU 사용량에 주의하세요.

## 결론

Ansible Molecule과 KIND를 조합하면 로컬 환경에서 완전한 Kubernetes 테스트 환경을 구축할 수 있습니다. 이를 통해:

- **개발 생산성 향상**: 빠른 피드백 루프로 개발 속도 개선
- **비용 절감**: 클라우드 리소스 없이 완전한 테스트 수행
- **CI/CD 통합**: 자동화된 파이프라인에서 안정적인 테스트 수행
- **코드 품질 향상**: 체계적인 테스트로 Ansible Role 신뢰성 확보

이 조합을 활용하여 Kubernetes 자동화 코드의 품질을 한 단계 높이세요.

## 참고 자료

- [Molecule 공식 문서](https://molecule.readthedocs.io/)
- [KIND 공식 문서](https://kind.sigs.k8s.io/)
- [Ansible Kubernetes Collection](https://docs.ansible.com/ansible/latest/collections/community/kubernetes/)
- [KIND Node Images](https://github.com/kubernetes-sigs/kind/releases)
