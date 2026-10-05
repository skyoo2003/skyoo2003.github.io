---
title: "Testing Ansible Roles with Molecule"
description: "A quick note on Molecule for testing Ansible roles, from installation to writing and running a scenario."
date: 2022-05-26T21:48:32+09:00
tags: [ansible, testing, tutorial, devops]
---

## [Molecule](https://molecule.readthedocs.io/en/latest/)

A test framework for Ansible roles maintained by ansible-community. Molecule supports testing with multiple instances, operating systems and distributions, virtualization providers, test frameworks, and test scenarios.

## Installation

Installing with pip can tangle the dependencies of the system Python, so creating a virtual environment with Virtualenv or using a dependency manager like Pipenv or Poetry is recommended.

```sh
# Also installs docker, yamllint, and ansible-lint. (podman, vagrant, azure, hetzner are supported too)
$ pip install molecule[docker,lint] 
```

## Writing Tests

1. Create the `/path/to/role/molecule/default` directory. (default is the default scenario. Scenarios with other names can be added.)
2. Create `/path/to/role/molecule/default/molecule.yml` and enter the following.

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

3. Create `/path/to/role/molecule/default/converge.yml` and add the provisioning code

Insert the code that runs the Role to set up the environment after the docker container is created. (Deploying a web server, etc.)

```yaml
---
- name: Converge
  hosts: all
  tasks:
    - include_role:
        name: "myrole"
```

4. Create `/path/to/role/molecule/default/verify.yml` and add the verification code

Insert the code that verifies the environment after it's set up (this is where the actual testing happens)

```yaml
---
- name: Verify
  hosts: all
  gather_facts: false
  tasks:
    - assert:
         that: "{{ condition }}"
```

## Running

```sh
$ cd /path/to/role
$ molecule create # Install dependencies and start the docker container
$ molecule converge # Run converge.yml
$ molecule verify # Run verify.yml
$ molecule destroy # Remove the docker container
$ molecule test # Do all of the above in one shot
```
