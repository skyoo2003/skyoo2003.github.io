---
title: "Ansible Molecule with Kind - Kubernetes Automation Testing with Docker"
description: "Step by step, combine Ansible Molecule's delegated driver with KIND to automatically test Ansible roles against a Kubernetes cluster running in Docker."
date: 2022-05-26T22:08:24+09:00
tags: [ansible, kubernetes, testing, tutorial, devops]
---

## [Ansible Molecule](https://github.com/ansible-community/molecule) with [KIND (Kubernetes IN Docker)](https://github.com/kubernetes-sigs/kind)

- Ansible Molecule is a tool that helps you test environment setup by isolating Ansible roles with virtualization.
- KIND is a tool that runs a Kubernetes cluster as docker containers. Used for deploying resources on a Kubernetes cluster and checking them, or verifying application behavior. (ex, Helm Chart)

## Prerequisites

- Install [Docker Engine](https://docs.docker.com/engine/install/)
- Install [KIND](https://kind.sigs.k8s.io/docs/user/quick-start/#installation)
- Install Python libraries
    - `pip install molecule[docker,lint] molecule-docker!=0.3.4 openshift`
        - [Don't use molecule-docker 0.3.4, it has a problem](https://github.com/ansible-community/molecule-docker/issues/57)
- Install Ansible collections
    - `ansible-galaxy collection install community.kubernetes community.docker`


## Writing and Running the Test Scenario

0. Create the Ansible role

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

1. Initialize the Molecule default scenario

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

2. Create the KIND Config manifest file

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

3. Edit the Molecule default scenario configuration

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

4. Edit the Molecule default scenario create playbook

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

5. Edit the Molecule default scenario destroy playbook

```sh
$ vi molecule/default/destroy.yml
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

6. Edit the Molecule default scenario converge playbook

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

7. Edit the Molecule default scenario verify playbook

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
        that: k8s_info_result.resources | length > 0
        fail_msg: "K8S Namespace not exists"
        success_msg: "K8S Namespace exists"
```

8. Test the Molecule default scenario

```sh
# Run the Molecule default scenario test
$ molecule test

# Build the Molecule default scenario environment (Optional)
## Useful when you want to poke around yourself after only the Kubernetes cluster and environment are set up
$ molecule converge

# Tear down the Molecule default scenario environment (Optional)
## If you built the Kubernetes cluster and environment manually, you have to delete it yourself.
$ molecule destroy
```
## Notes

- KIND is built from base/node images
    - The [base image](https://kind.sigs.k8s.io/docs/design/base-image/) has the programs Kubernetes needs to run, such as ubuntu, systemd, and containers
    - The [node image](https://kind.sigs.k8s.io/docs/design/node-image/) is built on the base image for running the kubernetes cluster
    - To match base package versions such as the Ubuntu version with your real environment, you have to build the base/node images yourself following the KIND docs.
- The `k8s_info` module doesn't fail when the resource is missing; it returns an empty `resources` list. So when verifying, check the length of `resources`, not `failed`.
- PS. The `community.kubernetes` collection was later renamed to `kubernetes.core`, so on recent versions use the new collection name.
