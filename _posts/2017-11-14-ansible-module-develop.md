---
layout: post
title:  Ansible Module 개발하기
date:   2017-11-14T21:44:56+09:00
categories: [all, ansible]
permalink: /post/:year/:month/:day/:title
published: true
comments: true
---

Ansible 은 대규모의 서버 장비에 대한 설치 및 어플리케이션의 배포와 서비스 운영에 대한 자동화 부분을 비교적 쉽게 작성할 수 있도록 기능을 제공합니다. 최신 트렌드인 DevOps 를 가능케하는 방법 중에 하나라고 할 수 있습니다. 

* Ansible 은 SSH 를 기반으로 수행되며, 원격 장비의 SSH 접근 권한이 필요합니다. 별도의 데몬이나 에이전트는 필요하지 않습니다.
* 원격 장비 (기본 제공되는 Ansible Module 의 경우) Python-2.6 이상만 시스템에 설치가 되어 있으면 됩니다. (일부 모듈은 별도의 파이썬 모듈을 필요로 하는 경우도 있습니다.)
* Ansible Module 은 멱등성을 보장하는 것을 권장 합니다. 일부, 모듈에 예외적으로 멱등성을 보장하지 않는 경우 문서에 주의사항을 꼭 남겨놓아야 합니다.

### 소개
Ansible Module 은 Ansible Playbook 의 하나의 Task 에서 어떠한 목적을 가지는 일련의 기능 집합이라고 생각할 수 있습니다. 예를 들어, "파일을 A 경로에서 B 경로로 파일을 옮기는 기능" 이 필요할 경우, Ansible 에서 기본 모듈로 제공하는 "file" 모듈을 사용하면 됩니다.

```yaml
tasks:
    - name: move a file from A to B path
      file: src="A" dest="B" # A 의 파일을 B 로 move 합니다.
      register: file_result # file 모듈의 결과를 "file_result" 라는 변수에 저장합니다.
    
    - debug: msg="{{ file_result }}" #  file 모듈이 STDOUT 으로 출력한 결과를 터미널으로 볼 수 있습니다
```

단순히 I/O 관점에서 볼 때, Ansible Module 은 Attributes 로 입력을 전달하고, 입력을 기반으로 일련의 기능을 수행하고 나면, JSON Format 을 STDOUT 으로 출력됩니다. Ansible Module 은 일련의 기능이 수행되는 과정에서 단순 I/O 에 국한하지 않고, 외부 시스템과의 연동과 같이 Side-Effect 를 발생시키는 것도 가능하며, 이는 적절한 범위에서 사용하면 매우 유용할 것 입니다.

### 구현

입력으로 디렉토리 경로를 받고, 해당 경로에 있는 파일 리스트를 반환하는 간단한 모듈 하나를 예제로 만들어보면서 설명하도록 하겠습니다. Python 2.7 / Ansible 2.2 기준으로 작성되었습니다.

---

#### 개발환경 구축

구현을 진행하기에 앞서 먼저 Ansible Module 개발을 위한 환경을 구축해야 합니다. Github 의 Ansible 프로젝트 안에 모듈을 개발할 때 테스트를 할 수 있는 도구를 제공하고 있습니다. 이를 활용하면 사용할 수 있습니다.

```bash
# Ansible Module 이 저장될 library 디렉토리 생성
$ mkdir library; cd library

# Ansible 프로젝트를 Git 저장소로부터 복제한다. 쉘 환경변수를 import 한다.
$ git clone git://github.com/ansible/ansible.git --recursive
$ . ansible/hacking/env-setup

# test-module cli 툴을 사용하여 모듈을 테스트할 수 있다.
$ ansible/hacking/test-module -m ./ls.py -a 'path="."'
```

---

#### 모듈 명세 작성

개발환경 구축을 완료하였다면, Ansible Module 파이썬 스크립트를 편집기로 열고, 먼저 모듈 명세부터 작성하기를 권장합니다. 왜냐하면, 모듈 구현에 앞서 모듈의 I/O 스펙에 대해서 먼저 정의할 수 있다는 점이 구현보다 먼저 선행되면 무엇을 구현하게 될 지 더 명확해지기 때문입니다.

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

---

#### 모듈 개발

모듈 명세 작성이 완료되었으면, Ansible Module 구현을 진행할 수 있습니다. 구현에 앞서 몇가지 사항에 대해서 간략하게 설명하고자 합니다. Ansible Module 은 당연히 파이썬 언어로 작성되며, Python 2 을 공식적으로 지원합니다. Python 3 도 Ansible 2.2 부터 지원을 시작했지만, 일부 모듈이 대응이 되지 않는 부분이 있을 수 있습니다. ( [Ansible Python 3 Support](https://docs.ansible.com/ansible/python_3_support.html){:target="_blank"} )

그리고, Ansible Module 에서 사용하는 파이썬 라이브러리는 가급적 Ansible 에서 기본으로 제공하는 모듈 유틸 라이브러리를 사용하기를 권장하고 있습니다. 다만, 외부 의존성을 사용하는 경우도 가능하며, 이 경우에는 모듈 명세에 반드시 언급을 해주셔야 합니다.

Ansible Module 은 대부분 아래의 순서대로 구현이 진행 됩니다. 

1. 모듈의 속성을 정의하고 속성의 데이터 타입, 필수 여부, 허용 가능한 값, 기본 값 등을 정의합니다.
2. 모듈이 반환할 수 있는 모든 상태 코드를 정의 합니다. 정상 코드 이외의 모든 에러 코드를 반환하는 경우에는 모듈이 수행하기 전과 후의 환경이 동일해야 합니다. (멱등성)
3. 모듈에 입력 받은 속성에 따라 비즈니스 로직을 구현하고, 처리 결과를 JSON Format 생성합니다.
4. 모듈의 모든 처리가 완료되면, exit\_json (정상) 혹은 fail\_json (실패) 중에 하나를 반환해야 합니다.

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

---

#### 모듈 테스트

모듈 구현이 완료된 이후에 의도한 대로 동작하는지 테스트해볼 수 있습니다.

```bash
# 개발이 완료되면 테스트를 진행한다.
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

### 참고 링크

[1] [Ansible Module 개발 공식 가이드](http://docs.ansible.com/ansible/dev_guide/developing_modules.html){:target="_blank"}

[2] [10분 안에 Ansible Module 만들기](http://blog.toast38coza.me/custom-ansible-module-hello-world){:target="_blank"}