---
title: "Ansible Molecule with Kind - Kubernetes Automation Testing with Docker"
date: 2022-05-26T22:08:24+09:00
tags: [ansible, kubernetes, testing, tutorial, devops]
---

# Introduction to Ansible Molecule with KIND

Learn how to set up a Kubernetes automation testing environment by combining [Ansible Molecule](https://github.com/ansible-community/molecule) with [KIND (Kubernetes IN Docker)](https://github.com/kubernetes-sigs/kind).

## Overview

### Ansible Molecule

Ansible Molecule is a framework that helps test Ansible Roles in isolated environments using virtualization technologies. It supports various drivers and can integrate with KIND using the Delegated driver for Kubernetes environments.

### KIND (Kubernetes IN Docker)

KIND is a tool that runs Kubernetes clusters as Docker containers. It allows you to quickly and easily create Kubernetes clusters locally, making it useful for:

- Helm Chart testing
- Kubernetes resource deployment verification
- Application behavior validation
- CI/CD pipeline integration testing

### Why Molecule + KIND?

| Advantage | Description |
|-----------|-------------|
| **Fast Feedback** | Complete cluster testing locally in minutes |
| **Cost Savings** | Perform Kubernetes tests without cloud resources |
| **Reproducibility** | Always guarantee identical test environments |
| **CI/CD Integration** | Easily integrate with GitHub Actions, GitLab CI, etc. |
| **Idempotence Verification** | Ensure Roles are safe to run multiple times |

## Prerequisites

### System Requirements

- **Operating System**: Linux, macOS, Windows (WSL2)
- **Memory**: Minimum 8GB RAM (16GB recommended)
- **CPU**: Minimum 4 cores
- **Disk**: Minimum 20GB free space

### Required Installations

#### 1. Docker Engine Installation

```sh
# Ubuntu/Debian
$ curl -fsSL https://get.docker.com | sh
$ sudo usermod -aG docker $USER

# macOS
$ brew install --cask docker

# Verify installation
$ docker --version
Docker version 24.0.7, build afdd53b
```

#### 2. KIND Installation

```sh
# Linux
$ curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
$ chmod +x ./kind
$ sudo mv ./kind /usr/local/bin/kind

# macOS
$ brew install kind

# Verify installation
$ kind version
kind v0.20.0 go1.20.10 linux/amd64
```

#### 3. kubectl Installation

```sh
# Linux
$ curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
$ chmod +x kubectl
$ sudo mv kubectl /usr/local/bin/

# macOS
$ brew install kubectl

# Verify installation
$ kubectl version --client
```

#### 4. Python Libraries Installation

```sh
# Create virtual environment (recommended)
$ python -m venv .venv
$ source .venv/bin/activate

# Install Molecule and related packages
# Note: molecule-docker version 0.3.4 has a bug and should not be used
$ pip install 'molecule[docker,lint]' 'molecule-docker!=0.3.4' openshift

# Verify installation
$ molecule --version
molecule 24.9.0 using python 3.11
```

#### 5. Ansible Collections Installation

```sh
# Install Kubernetes-related collections
$ ansible-galaxy collection install community.kubernetes community.docker

# Verify installed collections
$ ansible-galaxy collection list
# community.kubernetes:2.0.0
# community.docker:3.4.0
```

## Writing and Running Test Scenarios

### Step 0: Create Ansible Role

First, create the Ansible Role to test:

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

Add collection dependencies to the Role's `meta/main.yml`:

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

Write the Role's `tasks/main.yml`:

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

### Step 1: Initialize Molecule Default Scenario

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

**Driver Selection Explanation:**

- `delegated`: Choose this when using external tools like KIND. Molecule doesn't directly manage instances but delegates to custom playbooks.

### Step 2: Create KIND Config Manifest File

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

**KIND Configuration Explanation:**

| Option | Description |
|--------|-------------|
| `kubeProxyMode` | kube-proxy mode (iptables, ipvs) |
| `podSubnet` | Pod network CIDR |
| `serviceSubnet` | Service network CIDR |
| `extraPortMappings` | Host-container port mappings |
| `kubeadmConfigPatches` | kubeadm configuration patches |

### Step 3: Modify Molecule Default Scenario Configuration

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

### Step 4: Modify Molecule Default Scenario Create Playbook

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

### Step 5: Modify Molecule Default Scenario Destroy Playbook

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

### Step 6: Modify Molecule Default Scenario Converge Playbook

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

### Step 7: Modify Molecule Default Scenario Verify Playbook

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

### Step 8: Run Molecule Default Scenario Test

```sh
# Run full test (create → verify → destroy)
$ molecule test

# Run individual steps
$ molecule create      # Create KIND cluster
$ molecule converge    # Apply Role
$ molecule verify      # Test verification
$ molecule destroy     # Delete cluster

# Debug mode
$ molecule create
$ molecule converge
$ kubectl --kubeconfig /tmp/kind/kubeconfig.yaml get all -n myrole-ns
$ molecule destroy

# Debug while keeping instances
$ molecule test --destroy=never
$ molecule login       # Access container
```

## Advanced Configuration

### Multi-Cluster Testing

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

### Helm Chart Testing

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

## CI/CD Integration

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

## Troubleshooting

### KIND Cluster Creation Failure

```sh
# Check Docker logs
$ docker logs <container_id>

# KIND verbose logging
$ kind create cluster --retain --verbosity 10

# Clean up resources
$ docker system prune -af
$ kind delete clusters $(kind get clusters)
```

### Memory Issues

```yaml
# Change to single node in KIND config
nodes:
  - role: control-plane
    image: kindest/node:v1.27.3
```

### Network Issues

```sh
# Recreate Docker network
$ docker network prune
$ kind delete cluster
$ kind create cluster --config kindconfig.yaml
```

## Important Notes

### KIND Image Composition

KIND consists of base images and node images:

- **[Base Image](https://kind.sigs.k8s.io/docs/design/base-image/)**: Image with foundational programs installed for Kubernetes to run, such as Ubuntu, systemd, and containers
- **[Node Image](https://kind.sigs.k8s.io/docs/design/node-image/)**: Image based on the base image with components for Kubernetes cluster operation

To match the version of base packages like Ubuntu with your actual environment, you need to build custom images by referring to the KIND documentation.

```sh
# Build custom node image
$ kind build node-image --base-image ubuntu:22.04
```

### Resource Limitations

KIND clusters run in Docker containers and share the host system's resources. Be mindful of memory and CPU usage when running large-scale tests.

## Conclusion

Combining Ansible Molecule with KIND allows you to build a complete Kubernetes testing environment locally. This provides:

- **Improved Development Productivity**: Faster development with quick feedback loops
- **Cost Savings**: Complete testing without cloud resources
- **CI/CD Integration**: Reliable testing in automated pipelines
- **Higher Code Quality**: Ensured Ansible Role reliability through systematic testing

Use this combination to take your Kubernetes automation code quality to the next level.

## References

- [Molecule Official Documentation](https://molecule.readthedocs.io/)
- [KIND Official Documentation](https://kind.sigs.k8s.io/)
- [Ansible Kubernetes Collection](https://docs.ansible.com/ansible/latest/collections/community/kubernetes/)
- [KIND Node Images](https://github.com/kubernetes-sigs/kind/releases)
