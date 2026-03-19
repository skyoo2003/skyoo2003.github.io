---
title: Ansible Galaxy - Managing Role Dependencies Using Git Repositories
date: 2017-02-16T17:31:36+09:00
tags: [ansible, tutorial]
---

## Uploading Ansible Role to Git Repository

First, create a Git repository for developing an Ansible Role. Then, generate the initial Ansible Role project structure using Ansible Galaxy.

* Clone the Git repository to your local machine.

```bash
$ git clone "https://github.com/xxxxx/sample-role.git"
```

* Generate Ansible Role initial directory and files.

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

* After developing the Ansible Role, push to Git repository.

```bash
$ git commit * -m "Add ansible role" && git push
```

## Downloading Ansible Role from Git Repository

### Method 1) Download via Ansible Galaxy CLI

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

### Method 2) Specify in dependency file and download via CLI

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

## Writing 'requirements.yml'

* src
    * username.role_name: Used to download Ansible Roles registered in the official Ansible Galaxy repository.
    * url: Used to download from SCMs supported by Ansible Galaxy.
* scm
    * Specify the SCM name to integrate. Default is 'git' (as of ansible-galaxy 2.2.1.0, only git and hg are supported)
* version
    * Specify tag name / commit hash / branch name. Default is 'master'
    * Only used when downloading from SCM.
* name
    * Specify the name of the downloaded Ansible Role. By default, uses the name registered in Ansible Galaxy or the Git repository name.

See the examples below:

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

## Using Private Git Repositories

### SSH Key Based Authentication

```yaml
# requirements.yml
- src: git@github.com:myorg/private-role.git
  scm: git
  version: v1.0.0
  name: private_role
```

```bash
# SSH key setup
$ eval "$(ssh-agent -s)"
$ ssh-add ~/.ssh/id_rsa

# Install roles
$ ansible-galaxy install -r requirements.yml
```

### Personal Access Token (HTTPS)

```yaml
# requirements.yml
- src: https://<token>@github.com/myorg/private-role.git
  version: main
  name: private_role
```

### Deploy Key Setup

You can use GitHub/GitLab's Deploy Key feature to securely configure read-only access.

```bash
# Generate deploy key
$ ssh-keygen -t ed25519 -C "deploy@myserver" -f deploy_key

# Register public key in Git repository
# Settings > Deploy keys > Add deploy key
```

## CI/CD Pipeline Integration

### Jenkins Pipeline Example

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

### GitHub Actions Example

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

## Role Version Management Strategy

### Semantic Versioning

```
MAJOR.MINOR.PATCH

MAJOR: Incompatible API changes
MINOR: Backwards-compatible feature additions
PATCH: Backwards-compatible bug fixes
```

```yaml
# Version ranges not supported in requirements.yml
# Instead, specify exact version
- src: git+https://github.com/xxxx/sample-role.git
  version: v1.2.3  # Exact version
```

### Branch Strategy

```
main (or master)
├── develop
│   ├── feature/new-feature
│   └── bugfix/issue-123
├── release/v1.2.0
└── hotfix/v1.1.1
```

### Version Pinning in Production

```yaml
# Production requirements.yml
- src: git+https://github.com/xxxx/nginx-role.git
  version: v2.1.0  # Pinned with tag

- src: git+https://github.com/xxxx/mysql-role.git
  version: abc123def456  # Pinned with commit hash (safer)
```

## Advanced Role Dependency Management

### Nested Dependencies

You can define dependencies on other Roles within a Role.

```yaml
# roles/web-server/meta/main.yml
dependencies:
  - role: common
    vars:
      common_var: value
  - role: nginx
    when: web_server_type == 'nginx'
```

### Conditional Dependencies

```yaml
# Install dependencies only under certain conditions
dependencies:
  - role: nginx
    when: web_server == 'nginx'
  - role: apache
    when: web_server == 'apache'
```

## Troubleshooting

### Common Problems

**1. Role Not Found**

```bash
ERROR! the role 'sample-role' was not found
```

Solution:
```bash
# Check role paths
$ ansible-galaxy list
# /etc/ansible/roles
# /home/user/.ansible/roles

# Install with specified path
$ ansible-galaxy install -r requirements.yml -p ./roles
```

**2. Version Conflict**

```bash
ERROR! conflicting role requirements
```

Solution:
```yaml
# Use different names when different versions are needed
- src: git+https://github.com/xxxx/nginx-role.git
  version: v1.0.0
  name: nginx_v1

- src: git+https://github.com/xxxx/nginx-role.git
  version: v2.0.0
  name: nginx_v2
```

**3. Git Authentication Failure**

```bash
Permission denied (publickey)
```

Solution:
```bash
# Check SSH key
$ ssh -T git@github.com

# Add key to SSH agent
$ eval "$(ssh-agent -s)"
$ ssh-add ~/.ssh/id_rsa
```

**4. Installation in Proxy Environment**

```bash
# Proxy settings
$ export https_proxy=http://proxy.company.com:8080
$ ansible-galaxy install -r requirements.yml
```

## Best Practices

### 1. Explicit Version Management

```yaml
# Good: Explicit version
- src: git+https://github.com/xxxx/role.git
  version: v1.2.3

# Avoid: Branch name (in production)
- src: git+https://github.com/xxxx/role.git
  version: main  # Branch can change
```

### 2. Local Development Environment

```bash
# ansible.cfg
[defaults]
roles_path = ./roles:~/.ansible/roles
collections_path = ./collections:~/.ansible/collections
```

### 3. Role Validation

```bash
# Validate with ansible-lint
$ ansible-lint roles/sample-role/

# Test with molecule
$ molecule test
```

### 4. Minimize Dependencies

```yaml
# meta/main.yml
dependencies: []  # Avoid unnecessary dependencies
```

## References

- [Ansible-Galaxy Document](http://docs.ansible.com/ansible/galaxy.html)
- [Reusing ansible roles with private git repos and dependency management](https://opencredo.com/reusing-ansible-roles-with-private-git-repos-and-dependencies/)
- [Ansible Best Practices](https://docs.ansible.com/ansible/latest/user_guide/playbooks_best_practices.html)
- [Molecule Testing Framework](https://molecule.readthedocs.io/)
