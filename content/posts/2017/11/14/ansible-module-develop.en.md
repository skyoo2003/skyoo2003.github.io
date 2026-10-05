---
title: Developing Ansible Modules
description: "A walkthrough of building a custom Ansible module: dev setup, documentation spec, implementation, testing, parameter validation, and Check and Diff mode support."
date: 2017-11-14T21:44:56+09:00
tags: [ansible, tutorial]
---

Ansible provides features that make it relatively easy to write automation for large-scale server installation, application deployment, and service operations. It's one of the methods enabling DevOps, 

* Ansible runs over SSH and requires SSH access to remote machines. No separate daemons or agents are needed.
* Remote machines (for default Ansible Modules) only need Python 2.6 or higher installed. (Some modules may require additional Python modules.)
* Ansible Modules are recommended to guarantee idempotency. For modules that exceptionally don't guarantee idempotency, be sure to document warnings.

## Introduction

An Ansible Module can be thought of as a set of functions with a specific purpose in one Task of an Ansible Playbook. For example, if you need to "copy a file on the remote host from path A to path B", you can use the "copy" module provided by default in Ansible.

```yaml
tasks:
    - name: copy a file from A to B path
      copy: src="A" dest="B" remote_src=yes # Copy file A on the remote host to B
      register: copy_result # Store copy module result in "copy_result" variable
    
    - debug: msg="{{ copy_result }}" # View copy module STDOUT output in terminal
```

From a simple I/O perspective, an Ansible Module receives input through Attributes, performs a set of functions based on the input, and outputs JSON Format to STDOUT. Ansible Modules are not limited to simple I/O during function execution; they can also cause side-effects such as integration with external systems, which can be very useful when used appropriately.

## Implementation

Let's create a simple module as an example that takes a directory path as input and returns a list of files in that path. Written for Python 2.7 / Ansible 2.2.

### Development Environment Setup

Before implementing, you first need to set up an environment for Ansible Module development. The Ansible project on Github provides tools for testing when developing modules. You can use these.

```bash
# Create library directory where Ansible Modules will be stored
$ mkdir library; cd library

# Clone Ansible project from Git repository. Import shell environment variables.
$ git clone git://github.com/ansible/ansible.git --recursive
$ . ansible/hacking/env-setup

# Test module using test-module cli tool
$ ansible/hacking/test-module -m ./ls.py -a 'path="."'
```

### Writing Module Specification

After completing development environment setup, open the Ansible Module Python script in an editor. It's recommended to write the module specification first. Because defining the module's I/O spec before implementation makes it clearer what you'll be implementing.

```python
#!/usr/bin/env python2

DOCUMENTATION = """
module: ls
short_description: Listing files in a given path
"""

EXAMPLES = """
- name: listing files in current directory
  ls: path="."
"""
```

### Module Development

Once module specification is complete, you can proceed with Ansible Module implementation. Before implementation, let me briefly explain a few things. Ansible Modules are of course written in Python and officially support Python 2. Python 3 support started from Ansible 2.2, but some modules may not be compatible. ([Ansible Python 3 Support](https://docs.ansible.com/ansible/python_3_support.html))

Also, Ansible Modules are recommended to use module utility libraries provided by Ansible by default. However, using external dependencies is also possible, in which case it must be mentioned in the documentation.

Ansible Modules are mostly implemented in the following order:

1. Define module attributes and specify data types, required status, allowed values, default values, etc.
2. Define all status codes the module can return. When returning any error code other than success codes, the environment before and after module execution should be identical. (If a failure leaves things half changed, you can't be sure what happens when you run it again.)
3. Implement business logic based on module input attributes and generate JSON Format results.
4. When all module processing is complete, return either exit_json (success) or fail_json (failure).

```python
from ansible.module_utils.basic import *

import os

no_error_status_code = 0
error_status_code = 1 

status_msg = {
    error_status_code: "ERROR!",
}

def listing(params):
    path = params['path']
    if not os.path.exists(path):
        return error_status_code, False, []

    files = []
    for dirname, dirnames, filenames in os.walk(path):
        for subdirname in dirnames:
            files.append(os.path.join(dirname, subdirname))
        for filename in filenames:
            files.append(os.path.join(dirname, filename))
    # Only lists files and changes nothing, so changed is False.
    return no_error_status_code, False, files

def main():
    fields = {
        "path": {"required": True, "type": "str"},
    }
    module = AnsibleModule(argument_spec=fields)
    status_code, has_changed, files = listing(module.params)

    if status_code == 0:
        module.exit_json(changed=has_changed, files=files)
    else:
        module.fail_json(msg=status_msg[status_code])

if __name__ == '__main__':
    main()

```

### Module Testing

After module implementation is complete, you can test whether it works as intended.

```bash
# Test after development is complete
$ ansible/hacking/test-module -m ./ls.py -a 'path="."'
* including generated source, if any, saving to: /home/zicprit/.ansible_module_generated
* ansiballz module detected; extracted module source to: /home/zicprit/debug_dir
***********************************
RAW OUTPUT

{"files": ["./ls.py"], "invocation": {"module_args": {"path": "."}}, "changed": false}


***********************************
PARSED OUTPUT
{
    "changed": false, 
    "files": [
        "./ls.py"
    ], 
    "invocation": {
        "module_args": {
            "path": "."
        }
    }
}
```

## References

- [Ansible Module Development Official Guide](http://docs.ansible.com/ansible/dev_guide/developing_modules.html)
- [Build Ansible Module in 10 Minutes](http://blog.toast38coza.me/custom-ansible-module-hello-world)
