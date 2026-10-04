---
title: Ansible Callback Plugin 소개
date: 2017-11-14T21:44:56+09:00
tags: [ansible, tutorial]
---

Ansible Plugin 중에서 **Callback Plugin** 에 관련한 부분만 정리합니다. Callback Plugin 은 Ansible 에서 특정 이벤트 발생 시 데이터를 로깅한다거나 Slack, Mail 등의 외부 채널로 Write 하는 등의 다양한 목적을 달성하기 위해 사용하는 모듈입니다. 참고로 이 내용은 **Ansible 2.2.1.0** 기준으로 작성되었습니다.

## Callback Plugin이란?

### 소개

**Ansible Callback Plugin** 은 Ansible 의 각종 이벤트를 Hooking 해서 해당 시점에 원하는 로직을 수행할 수 있는 플러그인을 말합니다. 이 콜백 플러그인은 Ansible Task, Playbook 등에 대해 "실행 직전", "실행 종료" 등의 이벤트에 대한 콜백 함수를 정의할 수 있도록 지원합니다.

### 활용 사례

Callback Plugin은 다양한 용도로 활용할 수 있습니다:

- **성능 모니터링**: 태스크 실행 시간 측정
- **알림**: Slack, 이메일, SMS 등으로 실행 결과 전송
- **로깅**: 상세한 실행 로그를 파일이나 DB에 저장
- **메트릭 수집**: Prometheus, Datadog 등으로 메트릭 전송
- **감사**: 실행 기록 보존 및 추적

### 동작 방식

기본적으로 Callback Plugin 들은 **callback_whitelist** 라는 Ansible 환경 변수에 등록된 플러그인에 대해서만 콜백 함수가 동작하도록 되어 있습니다. 단, 콜백 모듈을 CALLBACK\_NEEDS\_WHITELIST = False 로 설정한 경우에는 무관합니다.

Callback Plugin은 설정에 등록된 콜백 리스트 순서와 관계없이 Alphanumeric 순(e.g. 1.py → 2.py → a.py)으로 실행됩니다.

## 환경 설정

Callback Plugin을 사용할 때 필요한 Ansible 환경 설정을 정리합니다. 환경변수는 ansible.cfg 파일에 정의하거나 커맨드라인으로 전달할 수 있습니다.

### 주요 설정 변수

* **callback_plugins** : 콜백 플러그인이 있는 디렉토리 위치를 지정합니다.

> (ex) callback_plugins = ~/.ansible/plugins/callback:/usr/share/ansible/plugins/callback

* **stdout_callback** : stdout 에 대한 기본 콜백을 변경합니다. CALLBACK_TYPE = stdout 인 콜백 플러그인 모듈만 지정이 가능합니다.

> (ex) stdout_callback = skippy

* **callback_whitelist** : 콜백을 동작시킬 플러그인 이름을 지정합니다. CALLBACK_NEEDS_WHITELIST = False 인 콜백 플러그인 모듈은 무관합니다.

> (ex) callback_whitelist = timer,mail

### ansible.cfg 예시

```ini
[defaults]
# 콜백 플러그인 디렉토리
callback_plugins = ./callback_plugins:~/.ansible/plugins/callback

# 기본 stdout 콜백
stdout_callback = yaml

# 활성화할 콜백 플러그인 목록
callback_whitelist = profile_tasks,slack,mail
```

### 커맨드라인 옵션

```bash
# 콜백 플러그인 활성화
$ ansible-playbook site.yml -e "ansible_callback_whitelist=profile_tasks,timer"

# 환경변수로 설정
$ ANSIBLE_CALLBACK_WHITELIST=profile_tasks ansible-playbook site.yml
```

## 이벤트 후킹 (Event Hooking)

Ansible 프로젝트의 "lib/ansible/plugins/callback/\_\_init\_\_.py" 의 소스에 존재하는 CallbackBase 클래스의 Public Method가 이벤트 후킹 가능한 콜백 함수를 의미합니다. 

Callback Plugin 을 구현하는 경우, CallbackBase 클래스를 상속해서 사용할 이벤트를 Override 하시면 됩니다. 만약, Ansible 2.0 버전 이상에 해당하는 이벤트에만 콜백 함수가 동작하기를 원하하는 경우에는 함수에 "v2_" 접두어를 붙인 메소드를 Override 하시면 됩니다.

### 이벤트 종류

```python
# 아래는 오버라이딩 가능한 메소드 리스트 입니다.
# Ansible 2.0 이상의 콜백 플러그인을 구현하시는 경우에는 v2_ 접두사를 추가로 붙여주시면 됩니다.

# Play 수준 이벤트
def set_play_context(self, play_context):
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

# Task 수준 이벤트
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

# 파일 변경 이벤트
def on_file_diff(self, host, diff):
    pass
```

## 구현 예제

아래의 Ansible Plugin 은 [[jlafon/ansible-profile]](https://github.com/jlafon/ansible-profile) 프로젝트를 차용하였다는 점을 먼저 알려드립니다.

이 플러그인에 대해서 간략하게 설명하자면, playbook의 task의 수행 시간을 메모리에 적재한 뒤에 playbook이 종료되기 전 태스크의 수행 시간을 Display 해주는 간단한 플러그인 입니다.

```python
import datetime
import os
import time
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    """
    A plugin for timing tasks
    """
    # 콜백 플러그인에 필수로 정의되어야 하는 클래스 속성
    CALLBACK_VERSION = 2.0 # 콜백 플러그인 버전
    CALLBACK_TYPE = 'notification' # 'stdout', 'notification', 'aggregate' 중 하나
    CALLBACK_NAME = 'profile_tasks' # 콜백 모듈 이름. Whitelist 등록 시 사용
    CALLBACK_NEEDS_WHITELIST = True
    
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.stats = {}
        self.current = None
    
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

### 실행 예시

```bash
ansible-playbook site.yml
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

## 고급 활용 예제

### Slack 알림 플러그인

```python
import json
import requests
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'notification'
    CALLBACK_NAME = 'slack_notification'
    CALLBACK_NEEDS_WHITELIST = True
    
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    
    def playbook_on_stats(self, stats):
        if not self.webhook_url:
            return
        
        message = {
            "text": f"Playbook completed",
            "attachments": [{
                "color": "good" if stats.failures == 0 else "danger",
                "fields": [
                    {"title": "Hosts", "value": stats.processed, "short": True},
                    {"title": "Failures", "value": stats.failures, "short": True},
                    {"title": "Changed", "value": stats.changed, "short": True},
                ]
            }]
        }
        
        requests.post(self.webhook_url, json=message)
```

### 로그 파일 기록 플러그인

```python
import os
import json
from datetime import datetime
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'aggregate'
    CALLBACK_NAME = 'log_file'
    CALLBACK_NEEDS_WHITELIST = False
    
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.log_file = os.getenv('ANSIBLE_LOG_FILE', '/var/log/ansible.log')
        self.start_time = None
    
    def playbook_on_start(self):
        self.start_time = datetime.now()
        self._log("Playbook started")
    
    def playbook_on_stats(self, stats):
        duration = (datetime.now() - self.start_time).total_seconds()
        self._log(f"Playbook completed in {duration:.2f}s - Failures: {stats.failures}")
    
    def runner_on_failed(self, host, res, ignore_errors=False):
        self._log(f"Task failed on {host}: {res}")
    
    def _log(self, message):
        with open(self.log_file, 'a') as f:
            f.write(f"{datetime.now().isoformat()} - {message}\n")
```

### 메트릭 수집 플러그인

```python
import os
import requests
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'aggregate'
    CALLBACK_NAME = 'metrics_collector'
    CALLBACK_NEEDS_WHITELIST = False
    
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.metrics_url = os.getenv('METRICS_URL')
        self.metrics = []
    
    def playbook_on_task_start(self, name, is_conditional):
        self.current_task = name
        self.task_start = time.time()
    
    def playbook_on_stats(self, stats):
        if not self.metrics_url:
            return
        
        payload = {
            "metrics": self.metrics,
            "summary": {
                "hosts": stats.processed,
                "failures": stats.failures,
                "changed": stats.changed,
            }
        }
        
        requests.post(self.metrics_url, json=payload)
```

## 표준 Callback Plugin 목록

Ansible은 다양한 표준 Callback Plugin을 제공합니다:

| Plugin | Type | Description |
|--------|------|-------------|
| actionable | notification | Show only tasks that need action |
| aws_resource_tags | notification | Add AWS resource tags to resources |
| cgroup_memory_recap | aggregate | Profile max memory usage |
| cgroup_perf_recap | aggregate | Profile system activity |
| context_demo | stdout | Demo plugin |
| counter_enabled | stdout | Count tasks |
| debug | stdout | Debug output |
| default | stdout | Default output |
| dense | stdout | Minimal output |
| foreman | notification | Send events to Foreman |
| full_skip | stdout | Show skipped tasks |
| hipchat | notification | Send events to HipChat |
| jabber | notification | Send events to Jabber |
| json | stdout | JSON output |
| junit | aggregate | Write JUnit XML |
| log_plays | aggregate | Log playbook results |
| logdna | notification | Send events to LogDNA |
| logentries | notification | Send events to Logentries |
| logstash | aggregate | Send events to Logstash |
| mail | notification | Send email |
| nrdp | notification | Send events to NRDP |
| null | stdout | No output |
| oneline | stdout | One line output |
| osx_say | notification | Use macOS say command |
| profile_roles | aggregate | Profile roles |
| profile_tasks | aggregate | Profile tasks |
| say | notification | Use say command |
| selective | stdout | Selective output |
| skippy | stdout | Hide skipped tasks |
| slack | notification | Send events to Slack |
| splunk | notification | Send events to Splunk |
| stderr | stdout | Output to stderr |
| sumologic | notification | Send events to Sumologic |
| syslog_json | aggregate | JSON to syslog |
| timer | aggregate | Profile time |
| tree | stdout | Tree output |
| unixy | stdout | Unix-style output |
| yaml | stdout | YAML output |

## 모범 사례

### 1. CALLBACK_TYPE 올바르게 설정

```python
# stdout: 출력 형식 변경 (ansible.cfg의 stdout_callback로 설정)
CALLBACK_TYPE = 'stdout'

# notification: 외부 알림 전송 (whitelist 필요)
CALLBACK_TYPE = 'notification'

# aggregate: 데이터 수집 및 분석 (whitelist 불필요 가능)
CALLBACK_TYPE = 'aggregate'
```

### 2. 환경변수 활용

```python
# 설정을 환경변수로 주입받기
def __init__(self):
    super(CallbackModule, self).__init__()
    self.webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    self.enabled = os.getenv('CALLBACK_ENABLED', 'true').lower() == 'true'

def playbook_on_stats(self, stats):
    if not self.enabled:
        return
    # ... 로직 실행
```

### 3. 에러 처리

```python
def send_notification(self, message):
    try:
        response = requests.post(self.webhook_url, json=message)
        response.raise_for_status()
    except requests.RequestException as e:
        # 알림 전송 실패가 playbook 실행에 영향을 주지 않도록 로깅만 함
        self._display.warning(f"Failed to send notification: {e}")
```

### 4. v2 API 사용

```python
# Ansible 2.0+ 이벤트 사용
def v2_runner_on_ok(self, result):
    """Called when a task succeeds"""
    host = result._host.name
    task = result._task.name
    
    # 결과 데이터 접근
    if 'stdout' in result._result:
        print(f"{host} | {task} | {result._result['stdout']}")
```

## 참고 링크

- [Ansible Callback Plugin](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#callback-plugins)
- [Custom Callback Plugin 예제](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#developing-callback-plugins)
- [표준 Callback Plugin 리스트](https://github.com/ansible/ansible/blob/devel/lib/ansible/plugins/callback)
- [Ansible Callback Plugins Documentation](https://docs.ansible.com/ansible/latest/collections/index_callback.html)
