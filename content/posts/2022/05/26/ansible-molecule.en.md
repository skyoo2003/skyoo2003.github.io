---
title: "Testing Ansible Roles with Molecule"
date: 2022-05-26T21:48:32+09:00
tags: [ansible, testing, tutorial, devops]
---

# Introduction to Molecule

[Molecule](https://molecule.readthedocs.io/en/latest/) is a testing framework for Ansible Roles maintained by the ansible-community. With Molecule, you can systematically test Ansible Roles, enabling comprehensive testing using multiple instances, operating systems, virtualization providers, test frameworks, and test scenarios.

## Why Do You Need Molecule?

When developing Ansible Roles, you face the following challenges:

- **Limitations of Manual Testing**: Manually running and verifying Roles each time is time-consuming.
- **Multi-Environment Support**: You need to ensure Roles work correctly on various operating systems like Ubuntu, CentOS, and Debian.
- **Continuous Integration**: Tests need to run automatically in CI/CD pipelines.
- **Code Quality**: Ansible code quality must be maintained consistently.

Molecule provides the following features to address these challenges:

- Support for various drivers (Docker, Podman, Vagrant, EC2, etc.)
- Automated test lifecycle management
- Integration with multiple test frameworks (Ansible, Testinfra, Goss)
- Lint tool integration (yamllint, ansible-lint)

## Installation

### System Requirements

- Python 3.8 or higher
- Docker, Podman, or Vagrant (for test environments)
- Ansible 2.10 or higher

### Installation Methods

When installing with Pip, it's recommended to create a virtual environment with Virtualenv or use dependency management tools like Pipenv or Poetry to avoid corrupting system Python dependencies.

```sh
# Create virtual environment (recommended)
$ python -m venv .venv
$ source .venv/bin/activate

# Install with docker, yamllint, and ansible-lint packages
# podman, vagrant, azure, hetzner are also supported
$ pip install molecule[docker,lint]

# Verify installation
$ molecule --version
molecule 24.9.0 using python 3.11
    ansible:2.17.0
    delegated:24.9.0 from molecule
    docker:24.9.0 from molecule_docker
```

### Installing Additional Drivers

```sh
# Podman driver
$ pip install molecule[podman]

# Vagrant driver
$ pip install molecule[vagrant]

# EC2 driver
$ pip install molecule[ec2]
```

## Core Concepts of Molecule

### Scenario

A scenario defines the test lifecycle. The default scenario is named `default`, and you can create multiple scenarios as needed. For example:

- `default`: Basic Docker-based testing
- `centos`: CentOS-specific testing
- `ubuntu`: Ubuntu-specific testing

### Driver

A driver defines how test instances are created:

| Driver | Use Case | Advantages | Disadvantages |
|--------|----------|------------|---------------|
| Docker | Container-based testing | Fast and lightweight | Limited systemd support |
| Podman | Container-based testing | Rootless execution | Docker compatibility considerations |
| Vagrant | VM-based testing | Complete OS environment | Relatively slow |
| EC2 | Cloud VM testing | Real production environment | Cost incurred |

### Provisioner

Defines how Roles are applied. Ansible is used by default.

### Verifier

Defines how test results are validated:

- **Ansible**: Validate with Ansible playbooks
- **Testinfra**: Python-based testing framework
- **Goss**: YAML-based lightweight testing tool

## Writing Tests

### 1. Creating a New Role

If you don't have an existing Role, you can initialize a new one with Molecule:

```sh
$ molecule init role myrole
```

This command creates the following structure:

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

### 2. Adding Molecule to an Existing Role

To add Molecule to an existing Role:

```sh
$ cd /path/to/role
$ molecule init scenario
--> Initializing new scenario default...
Initialized scenario in /path/to/role/molecule/default successfully.
```

### 3. Configuring molecule.yml

Create the `/path/to/role/molecule/default/molecule.yml` file with the following content:

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

**Key Configuration Explanations:**

- `dependency.galaxy`: Manages Ansible Galaxy dependencies.
- `driver.name`: Uses Docker to create test instances.
- `platforms`: List of platforms to test. Multiple OS can be tested simultaneously.
- `privileged: true`: Required for features like systemd.
- `provisioner.config_options`: Customizes Ansible settings.

### 4. Writing converge.yml

Create `/path/to/role/molecule/default/converge.yml` and add environment configuration code. After creating Docker containers, execute the Role to configure the environment:

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

**Writing Tips:**

- Use `pre_tasks` to perform necessary setup before Role execution.
- Define test variables using `vars`.
- Enable privilege escalation with `become: true`.

### 5. Writing verify.yml

Create `/path/to/role/molecule/default/verify.yml` and add verification code. This is where actual testing is performed:

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

### 6. Advanced Verification with Testinfra

Using Testinfra instead of Ansible allows you to write more powerful tests:

```yaml
# molecule.yml
verifier:
  name: testinfra
```

```python
# tests/test_default.py
import pytest

def test_nginx_is_installed(host):
    """Check if nginx is installed"""
    nginx = host.package("nginx")
    assert nginx.is_installed
    assert nginx.version.startswith("1.")

def test_nginx_running_and_enabled(host):
    """Check if nginx service is running and enabled"""
    nginx = host.service("nginx")
    assert nginx.is_running
    assert nginx.is_enabled

def test_nginx_listening_on_port_80(host):
    """Check if listening on port 80"""
    socket = host.socket("tcp://0.0.0.0:80")
    assert socket.is_listening

def test_nginx_config_exists(host):
    """Check if nginx config file exists"""
    config = host.file("/etc/nginx/nginx.conf")
    assert config.exists
    assert config.is_file
    assert config.user == "root"
    assert config.group == "root"
    assert oct(config.mode) == "0o644"

def test_nginx_response(host):
    """Check HTTP response"""
    response = host.run("curl -s http://localhost")
    assert response.rc == 0
    assert "Welcome" in response.stdout
```

## Molecule Commands

### Basic Commands

```sh
$ cd /path/to/role

# Create test instances
$ molecule create

# Run converge.yml (apply Role)
$ molecule converge

# Check changes to instances
$ molecule side-effect

# Run verify.yml (test verification)
$ molecule verify

# Remove test instances
$ molecule destroy

# Run all the above steps at once
$ molecule test
```

### Useful Commands

```sh
# Test with specific scenario
$ molecule test -s centos

# Debug in interactive mode
$ molecule create
$ molecule login
$ molecule destroy

# Run lint checks only
$ molecule lint

# Install dependencies only
$ molecule dependency

# View instance list
$ molecule list

# Execute command on instance
$ molecule exec -- ls -la /etc/nginx
```

### Test Lifecycle

Molecule's `test` command executes the following stages sequentially:

1. **lint**: Code quality check
2. **destroy**: Clean up existing instances
3. **dependency**: Install dependencies
4. **syntax**: Check playbook syntax
5. **create**: Create test instances
6. **prepare**: Prepare instances (prepare.yml)
7. **converge**: Apply Role (converge.yml)
8. **idempotence**: Idempotence test
9. **side-effect**: Side effect test
10. **verify**: Verify results (verify.yml)
11. **cleanup**: Clean up (cleanup.yml)
12. **destroy**: Remove instances

## CI/CD Integration

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

## Best Practices

### 1. Idempotence Testing

Roles should guarantee the same result when executed multiple times:

```sh
# Run converge twice to ensure no changes on second run
$ molecule converge
$ molecule converge
```

### 2. Test Multiple Operating Systems

```yaml
platforms:
  - name: ubuntu-22.04
    image: docker.io/geerlingguy/docker-ubuntu2204-ansible:latest
  - name: rocky-9
    image: docker.io/geerlingguy/docker-rockylinux9-ansible:latest
  - name: debian-12
    image: docker.io/geerlingguy/docker-debian12-ansible:latest
```

### 3. Clear Verification

```yaml
- name: Verify with clear messages
  assert:
    that:
      - result.rc == 0
    fail_msg: "Command failed: {{ result.stderr }}"
    success_msg: "Command succeeded: {{ result.stdout }}"
```

### 4. Test Isolation

Each test should be independently executable:

```yaml
- name: Clean up before test
  file:
    path: /tmp/test_data
    state: absent
```

### 5. Enable Debugging

```sh
# Run with verbose logging
$ MOLECULE_DEBUG=true molecule test

# Debug while keeping instances
$ molecule test --destroy=never
```

## Troubleshooting

### Docker Permission Issues

```sh
$ sudo usermod -aG docker $USER
$ newgrp docker
```

### systemd Support Issues

To use systemd in Docker containers:

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

### Memory Issues

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

## Conclusion

Molecule is an essential tool for ensuring the quality of Ansible Roles. Through systematic testing, it provides:

- **Reliability**: Verify that Roles work as intended
- **Portability**: Ensure compatibility across various OS and environments
- **Maintainability**: Continuous quality management through CI/CD integration
- **Productivity**: Reduce manual testing time

Adopt Molecule in your projects to take Ansible Role quality to the next level.

## References

- [Molecule Official Documentation](https://molecule.readthedocs.io/en/latest/)
- [Ansible Molecule GitHub](https://github.com/ansible-community/molecule)
- [Testinfra Documentation](https://testinfra.readthedocs.io/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
