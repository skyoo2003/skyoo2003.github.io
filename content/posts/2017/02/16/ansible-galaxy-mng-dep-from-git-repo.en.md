---
title: Ansible Galaxy - Managing Role Dependencies Using Git Repositories
description: "How to publish Ansible roles to Git repositories and pull them in with requirements.yml, plus a few tips for private repositories."
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

PS. When pulling a role from a private repository such as an internal GitLab, the SSH form `git@...` from the last example was the easiest. `ansible-galaxy` calls `git clone` internally, so if `ssh -T git@gitlab.company.com` works on that machine, it just works with no extra setup. Putting a token in an HTTPS URL also works, but requirements.yml gets committed to the repository too, so I don't recommend it.

Also, if `version` is a branch name you can get different code on every install, so pinning a tag or commit hash is safer for production.

## References

- [Ansible-Galaxy Document](http://docs.ansible.com/ansible/galaxy.html)
- [Reusing ansible roles with private git repos and dependency management](https://opencredo.com/reusing-ansible-roles-with-private-git-repos-and-dependencies/)
