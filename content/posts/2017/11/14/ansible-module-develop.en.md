---
title: Developing Ansible Modules
date: 2017-11-14T21:44:56+09:00
tags: [ansible, tutorial]
---

Ansible provides features that make it relatively easy to write automation for large-scale server installation, application deployment, and service operations. It's one of the methods enabling DevOps, 

* Ansible runs over SSH and requires SSH access to remote machines. No separate daemons or agents are needed.
* Remote machines (for default Ansible Modules) only need Python 2.6 or higher installed. (Some modules may require additional Python modules.)
* Ansible Modules are recommended to guarantee idempotency. For modules that exceptionally don't guarantee idempotency, be sure to document warnings.

## Introduction

An Ansible Module can be thought of as a set of functions with a specific purpose in one Task of an Ansible Playbook. For example, if you need to "move a file from path A to path B", you can use the "file" module provided by default in Ansible.

```yaml
tasks:
    - name: move a file from A to B path
      file: src="A" dest="B" # Move file from A to B
      register: file_result # Store file module result in "file_result" variable
    
    - debug: msg="{{ file_result }}" # View file module STDOUT output in terminal
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
2. Define all status codes the module can return. When returning any error code other than success codes, the environment before and after module execution should be identical. (Idempotency)
3. Implement business logic based on module input attributes and generate JSON Format results.
4. When all module processing is complete, return either exit_json (success) or fail_json (failure).

```python
from ansible.module_utils.basic import *

import urllib
import urllib2
import sys
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
    return no_error_status_code, True, files

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

{"files": ["./ls.py"], "invocation": {"module_args": {"path": "."}}, "changed": true}


***********************************
PARSED OUTPUT
{
    "changed": true, 
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

## Advanced Module Development

### Python 3 Support

```python
#!/usr/bin/env python3
from ansible.module_utils.basic import AnsibleModule

def main():
    module = AnsibleModule(
        argument_spec=dict(
            path=dict(type='str', required=True),
            recursive=dict(type='bool', default=False),
        ),
        supports_check_mode=True
    )
    
    path = module.params['path']
    recursive = module.params['recursive']
    
    if module.check_mode:
        module.exit_json(changed=False, msg="Check mode: would list files")
    
    try:
        files = list_files(path, recursive)
        module.exit_json(changed=True, files=files)
    except Exception as e:
        module.fail_json(msg=str(e))
```

### Check Mode Support

```python
def main():
    module = AnsibleModule(
        argument_spec=fields,
        supports_check_mode=True
    )
    
    if module.check_mode:
        # In check mode, don't make changes
        # Just report what would happen
        module.exit_json(
            changed=False,
            msg="Check mode: would list files",
            files=[]
        )
    
    # Normal execution
    result = perform_operation(module.params)
    module.exit_json(changed=True, result=result)
```

### Idempotency Implementation

```python
def ensure_file(module, path, content):
    """Ensure file exists with specified content"""
    
    # Check if file already exists with correct content
    if os.path.exists(path):
        with open(path, 'r') as f:
            if f.read() == content:
                # No change needed - idempotent
                module.exit_json(changed=False, msg="File already exists with correct content")
    
    # Make the change
    with open(path, 'w') as f:
        f.write(content)
    
    module.exit_json(changed=True, msg="File created/updated")
```

### Error Handling Best Practices

```python
def main():
    module = AnsibleModule(argument_spec=fields)
    
    try:
        result = process_file(module.params['path'])
        module.exit_json(changed=True, result=result)
    except PermissionError as e:
        module.fail_json(msg=f"Permission denied: {str(e)}")
    except FileNotFoundError as e:
        module.fail_json(msg=f"File not found: {str(e)}")
    except Exception as e:
        module.fail_json(msg=f"Unexpected error: {str(e)}")
```

### Module Documentation

```python
DOCUMENTATION = """
---
module: custom_file
short_description: Manage custom files
description:
    - This module creates, updates, or deletes custom files with specified content.
    - Supports check mode for previewing changes without making them.
version_added: "1.0.0"
author: "Your Name (@yourgithub)"
options:
    path:
        description:
            - The full path to the file to manage.
        required: true
        type: str
    content:
        description:
            - The content to write to the file.
        required: false
        type: str
        default: ""
    state:
        description:
            - Whether the file should exist or not.
        required: false
        type: str
        choices: ['present', 'absent']
        default: 'present'
notes:
    - This module supports check mode.
    - This module is idempotent.
seealso:
    - module: file
    - module: copy
"""

EXAMPLES = """
- name: Create a file
  custom_file:
    path: /tmp/myfile.txt
    content: "Hello, World!"

- name: Update a file
  custom_file:
    path: /tmp/myfile.txt
    content: "Updated content"

- name: Remove a file
  custom_file:
    path: /tmp/myfile.txt
    state: absent
"""

RETURN = """
path:
    description: The path of the file managed
    type: str
    returned: always
    sample: "/tmp/myfile.txt"
content:
    description: The content written to the file
    type: str
    returned: when state is present
    sample: "Hello, World!"
size:
    description: The size of the file in bytes
    type: int
    returned: when state is present
    sample: 13
"""
```

## Testing

### Unit Tests

```python
import unittest
from ansible.modules.files import ls

class TestLsModule(unittest.TestCase):
    
    def test_listing_files(self):
        """Test file listing"""
        params = {'path': '/tmp'}
        status_code, changed, files = ls.listing(params)
        self.assertEqual(status_code, 0)
        self.assertIsInstance(files, list)
    
    def test_invalid_path(self):
        """Test invalid path"""
        params = {'path': '/nonexistent'}
        status_code, changed, files = ls.listing(params)
        self.assertEqual(status_code, 1)
        self.assertEqual(files, [])

if __name__ == '__main__':
    unittest.main()
```

### Integration Testing with Molecule

```yaml
# molecule/default/molecule.yml
dependency:
  name: galaxy
driver:
  name: docker
platforms:
  - name: instance
    image: centos:7
provisioner:
  name: ansible
verifier:
  name: ansible
```

```yaml
# molecule/default/tests/test_default.yml
---
- name: Test ls module
  hosts: all
  tasks:
    - name: List files in /tmp
      ls:
        path: /tmp
      register: result
    
    - name: Assert module succeeded
      assert:
        that:
          - result.changed
          - result.files is defined
```

## Best Practices

### 1. Clear Error Messages

```python
# Good: Clear error message
if not os.path.exists(path):
    module.fail_json(msg=f"Path '{path}' does not exist. Please verify the path and try again.")

# Bad: Vague error message
if not os.path.exists(path):
    module.fail_json(msg="Error!")
```

### 2. Detailed Documentation

Include comprehensive DOCUMENTATION, EXAMPLES, and RETURN sections.

### 3. Logging and Debugging

```python
def main():
    module = AnsibleModule(argument_spec=fields)
    
    # Debug information logging
    module.debug(f"Processing path: {module.params['path']}")
    
    try:
        result = process_file(module.params['path'])
        module.exit_json(changed=True, result=result)
    except Exception as e:
        module.fail_json(msg=f"Failed to process file: {str(e)}")
```

## References

- [Ansible Module Development Official Guide](http://docs.ansible.com/ansible/dev_guide/developing_modules.html)
- [Build Ansible Module in 10 Minutes](http://blog.toast38coza.me/custom-ansible-module-hello-world)
- [Ansible Module Utils](https://docs.ansible.com/ansible/latest/dev_guide/developing_module_utilities.html)
- [Python 3 Support](https://docs.ansible.com/ansible/python_3_support.html)
