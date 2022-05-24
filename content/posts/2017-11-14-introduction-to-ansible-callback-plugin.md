---
title:  Ansible Callback Plugin 소개
date:   2017-11-14T21:44:56+09:00
tags: [ansible]
---

Ansible Plugin 중에서 **Callback Plugin** 에 관련한 부분만 정리합니다. Callback Plugin 은 Ansible 에서 특정 이벤트 발생 시 데이터를 로깅한다거나 Slack, Mail 등의 외부 채널로 Write 하는 등의 다양한 목적을 달성하기 위해 사용하는 모듈입니다. 참고로 이 내용은 **Ansible 2.2.1.0** 기준으로 작성되었습니다.

### 소개

**Ansible Callback Plugin** 은 Ansible 의 각종 이벤트를 Hooking 해서 해당 시점에 원하는 로직을 수행할 수 있는 플러그인을 말합니다. 이 콜백 플러그인은 Ansible Task, Playbook 등에 대해 "실행 직전", "실행 종료" 등의 이벤트에 대한 콜백 함수를 정의할 수 있도록 지원합니다.

기본적으로 Callback Plugin 들은 **callback_whitelist** 라는 Ansible 환경 변수에 등록된 플러그인에 대해서만 콜백 함수가 동작하도록 되어 있습니다. 단, 콜백 모듈을 CALLBACK\_NEEDS\_WHITELIST = False 로 설정한 경우에는 무관합니다.

그리고, Callback Plugin 의 실행 순서는 Alphanumeric 순으로 실행됩니다. (e.g. 1.py → 2.py → a.py) 설정에 등록된 콜백 리스트 순서와는 무관합니다.

### 환경 설정

Callback Plugin 을 사용하기 위한 각종 Ansible 환경 설정을 정리합니다. 이 환경변수들은 ansible.cfg 파일에 정의해서 사용해도 되며, 커맨드라인을 통해 전달하는 방식도 가능합니다.


* **callback_plugins** : 콜백 플러그인이 있는 디렉토리 위치를 지정합니다.

> (ex) callback_plugins = ~/.ansible/plugins/callback:/usr/share/ansible/plugins/callback

* **stdout_callback** : stdout 에 대한 기본 콜백을 변경합니다. CALLBACK_TYPE = stdout 인 콜백 플러그인 모듈만 지정이 가능합니다.

> (ex) stdout_callback = skippy

* **callback_whitelist** : 콜백을 동작시킬 플러그인 이름을 지정합니다. CALLBACK_NEEDS_WHITELIST = False 인 콜백 플러그인 모듈은 무관합니다.

> (ex) callback_whitelist = timer,mail

### 이벤트 후킹 (Event Hooking)

Ansible 프로젝트의 "lib/ansible/plugins/callback/\_\_init\_\_.py" 의 소스에 존재하는 CallbackBase 클래스의 Public Method가 이벤트 후킹 가능한 콜백 함수를 의미 합니다. 

Callback Plugin 을 구현하는 경우, CallbackBase 클래스를 상속해서 사용할 이벤트를 Override 하시면 됩니다. 만약, Ansible 2.0 버전 이상에 해당하는 이벤트에만 콜백 함수가 동작하기를 원하하는 경우에는 함수에 "v2_" 접두어를 붙인 메소드를 Override 하시면 됩니다.

```python
# 아래는 오버라이딩 가능한 메소드 리스트 입니다.
# Ansible 2.0 이상의 콜백 플러그인을 구현하시는 경우에는 v2_ 접두사를 추가로 붙여주시면 됩니다. (e.g.
def set_play_context(self, play_context):
    pass
def on_any(self, *args, **kwargs):
    pass
def runner_on_failed(self, host, res, ignore_errors=False):
    pass
def runner_on_ok(self, host, res):
    pass
def runner_on_skipped(self, host, item=None):
    pass
def runner_on_unreachable(self, host, res):
    pass
def runner_on_no_hosts(self):
    pass
def runner_on_async_poll(self, host, res, jid, clock):
    pass
def runner_on_async_ok(self, host, res, jid):
    pass
def runner_on_async_failed(self, host, res, jid):
    pass
def playbook_on_start(self):
    pass
def playbook_on_notify(self, host, handler):
    pass
def playbook_on_no_hosts_matched(self):
    pass
def playbook_on_no_hosts_remaining(self):
    pass
def playbook_on_task_start(self, name, is_conditional):
    pass
def playbook_on_vars_prompt(self, varname, private=True, prompt=None, encrypt=None, confirm=False, salt_size=None, salt=None, default=None):
    pass
def playbook_on_setup(self):
    pass
def playbook_on_import_for_host(self, host, imported_file):
    pass
def playbook_on_not_import_for_host(self, host, missing_file):
    pass
def playbook_on_play_start(self, name):
    pass
def playbook_on_stats(self, stats):
    pass
def on_file_diff(self, host, diff):
    pass
```

### 구현 예제

아래의 Ansible Plugin 은 [[jlafon/ansible-profile]](https://github.com/jlafon/ansible-profile){:target="_blank"} 프로젝트를 차용하였다는 점을 먼저 알려드립니다.

이 플러그인에 대해서 간략하게 설명하자면, playbook의 task의 수행 시간을 메모리에 적재한 뒤에 playbook이 종료되기 전 태스크의 수행 시간을 Display 해주는 간단한 플러그인 입니다. 코드의 내용을 참고해주시면 이해가 될 것으로 생각되고, 플러그인에 대해서 설명이 필요한 부분은 주석을 참고하시면 됩니다.

```python
import datetime
import os
import time
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    """
    A plugin for timing tasks
    """
    # 아래는 콜백 플러그인에 필수로 정의되어야 하는 클래스 속성 입니다.
    CALLBACK_VERSION = 2.0 # 콜백 플러그인 버전을 명시 합니다.
    CALLBACK_TYPE = 'notification' # 'stdout', 'notification', 'aggregate' 중에 하나를 사용합니다
    CALLBACK_NAME = 'profile_tasks' # 콜백 모듈의 이름을 정의 합니다. Whitelist 에 등록할 때 사용됩니다.
    CALLBACK_NEEDS_WHITELIST = True
    
    # 콜백 플러그인의 초기화 부분이 들어갑니다.
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.stats = {}
        self.current = None
    
    # Playbook 내의 각 Task가 실행 될 때, 수행되는 로직을 구현합니다.
    def playbook_on_task_start(self, name, is_conditional):
        """
        Logs the start of each task
        """
        if os.getenv("ANSIBLE_PROFILE_DISABLE") is not None:
            return
        if self.current is not None:
            # Record the running time of the last executed task
            self.stats[self.current] = time.time() - self.stats[self.current]
        # Record the start time of the current task
        self.current = name
        self.stats[self.current] = time.time()
    
    # Playbook이 완료되었을 때, 수행되는 로직을 구현합니다.
    def playbook_on_stats(self, stats):
        """
        Prints the timings
        """
        if os.getenv("ANSIBLE_PROFILE_DISABLE") is not None:
            return
        # Record the timing of the very last task
        if self.current is not None:
            self.stats[self.current] = time.time() - self.stats[self.current]
        # Sort the tasks by their running time
        results = sorted(
            self.stats.items(),
            key=lambda value: value[1],
            reverse=True,
        )
        # Just keep the top 10
        results = results[:10]
        # Print the timings
        for name, elapsed in results:
            print(
                "{0:-<70}{1:->9}".format(
                    '{0} '.format(name),
                    ' {0:.02f}s'.format(elapsed),
                )
            )
        total_seconds = sum([x[1] for x in self.stats.items()])
        print("\nPlaybook finished: {0}, {1} total tasks.  {2} elapsed. \n".format(
                time.asctime(),
                len(self.stats.items()),
                datetime.timedelta(seconds=(int(total_seconds)))
                )
          )
```

아래는 'profile_task' Callback Plugin 의 출력 예시 입니다.

```bash
ansible <args here>
<normal output here>
PLAY RECAP ********************************************************************
really slow task | Download project packages-----------------------------11.61s
security | Really slow security policies-----------------------------------7.03s
common-base | Install core system dependencies-----------------------------3.62s
common | Install pip-------------------------------------------------------3.60s
common | Install boto------------------------------------------------------3.57s
nginx | Install nginx------------------------------------------------------3.41s
serf | Install system dependencies-----------------------------------------3.38s
duo_security | Install Duo Unix SSH Integration----------------------------3.37s
loggly | Install TLS version-----------------------------------------------3.36s
```

### 참고 링크
[1] [Ansible Callback Plugin](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#callback-plugins){:target="_blank"}

[2] [Custom Callback Plugin 예제](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#developing-callback-plugins){:target="_blank"}

[3] [표준 Callback Plugin 리스트](https://github.com/ansible/ansible/blob/devel/lib/ansible/plugins/callback){:target="_blank"}
