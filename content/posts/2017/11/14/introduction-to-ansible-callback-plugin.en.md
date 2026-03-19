---
title: Introduction to Ansible Callback Plugin
date: 2017-11-14T21:44:56+09:00
tags: [ansible, tutorial]
---

This article focuses only on **Callback Plugin** among Ansible Plugins. Callback Plugin is a module used for various purposes such as logging data when specific events occur in Ansible, or writing to external channels like Slack, Mail, etc. This content is based on **Ansible 2.2.1.0**.

## What is Callback Plugin?

### Introduction

**Ansible Callback Plugin** refers to plugins that can hook into various Ansible events and execute desired logic at those points. These callback plugins support defining callback functions for events like "before execution" and "after execution" for Ansible Tasks, Playbooks, etc.

### Use Cases

Callback Plugin can be used for various purposes:

- **Performance Monitoring**: Measure task execution time
- **Notifications**: Send execution results via Slack, email, SMS, etc.
- **Logging**: Store detailed execution logs in files or DB
- **Metrics Collection**: Send metrics to Prometheus, Datadog, etc.
- **Auditing**: Preserve and track execution records

### How It Works

By default, Callback Plugins only execute callback functions for plugins registered in the **callback_whitelist** Ansible environment variable. However, if the callback module has CALLBACK\_NEEDS\_WHITELIST = False, this doesn't apply.

Also, Callback Plugins execute in alphanumeric order (e.g., 1.py → 2.py → a.py), regardless of the order registered in the callback list configuration.

## Environment Configuration

Here are various Ansible environment settings for using Callback Plugin. These environment variables can be defined in ansible.cfg or passed via command line.

### Key Configuration Variables

* **callback_plugins**: Specify the directory location of callback plugins.

> (ex) callback_plugins = ~/.ansible/plugins/callback:/usr/share/ansible/plugins/callback

* **stdout_callback**: Change the default callback for stdout. Only callback plugin modules with CALLBACK_TYPE = stdout can be specified.

> (ex) stdout_callback = skippy

* **callback_whitelist**: Specify plugin names to activate callbacks. Callback plugin modules with CALLBACK_NEEDS_WHITELIST = False are unaffected.

> (ex) callback_whitelist = timer,mail

### ansible.cfg Example

```ini
[defaults]
# Callback plugin directory
callback_plugins = ./callback_plugins:~/.ansible/plugins/callback

# Default stdout callback
stdout_callback = yaml

# List of callback plugins to activate
callback_whitelist = profile_tasks,slack,mail
```

### Command Line Options

```bash
# Activate callback plugins
$ ansible-playbook site.yml -e "ansible_callback_whitelist=profile_tasks,timer"

# Set via environment variable
$ ANSIBLE_CALLBACK_WHITELIST=profile_tasks ansible-playbook site.yml
```

## Event Hooking

The Public Methods of the CallbackBase class in the source code at "lib/ansible/plugins/callback/\_\_init\_\_.py" in the Ansible project represent callback functions that can hook into events.

When implementing a Callback Plugin, inherit from the CallbackBase class and Override the events you want to use. If you want callback functions to only work for events in Ansible 2.0 or later, Override methods with the "v2_" prefix.

### Event Types

```python
# Below is a list of overridable methods.
# When implementing callback plugins for Ansible 2.0+, add v2_ prefix.

# Play level events
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

# Task level events
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

# File change events
def on_file_diff(self, host, diff):
    pass
```

## Implementation Example

The Ansible Plugin below is borrowed from the [[jlafon/ansible-profile]](https://github.com/jlafon/ansible-profile) project.

Briefly, this plugin loads task execution times of a playbook into memory, then displays task execution times before the playbook finishes. Refer to the code content for understanding, and see comments for plugin explanations.

```python
import datetime
import os
import time
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    """
    A plugin for timing tasks
    """
    # Class attributes required for callback plugin
    CALLBACK_VERSION = 2.0 # Specify callback plugin version
    CALLBACK_TYPE = 'notification' # Use one of 'stdout', 'notification', 'aggregate'
    CALLBACK_NAME = 'profile_tasks' # Define callback module name. Used when registering in Whitelist
    CALLBACK_NEEDS_WHITELIST = True
    
    # Plugin initialization
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.stats = {}
        self.current = None
    
    # Logic executed when each Task in Playbook starts
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
    
    # Logic executed when Playbook completes
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

### Execution Example

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

## Advanced Examples

### Slack Notification Plugin

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

### Log File Plugin

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

### Metrics Collection Plugin

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

## Standard Callback Plugin List

Ansible provides various standard Callback Plugins:

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

## Best Practices

### 1. Set CALLBACK_TYPE Correctly

```python
# stdout: Change output format (set via ansible.cfg's stdout_callback)
CALLBACK_TYPE = 'stdout'

# notification: Send external notifications (whitelist required)
CALLBACK_TYPE = 'notification'

# aggregate: Data collection and analysis (whitelist may not be required)
CALLBACK_TYPE = 'aggregate'
```

### 2. Use Environment Variables

```python
# Inject configuration via environment variables
def __init__(self):
    super(CallbackModule, self).__init__()
    self.webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    self.enabled = os.getenv('CALLBACK_ENABLED', 'true').lower() == 'true'

def playbook_on_stats(self, stats):
    if not self.enabled:
        return
    # ... execute logic
```

### 3. Error Handling

```python
def send_notification(self, message):
    try:
        response = requests.post(self.webhook_url, json=message)
        response.raise_for_status()
    except requests.RequestException as e:
        # Only log notification failures to not affect playbook execution
        self._display.warning(f"Failed to send notification: {e}")
```

### 4. Use v2 API

```python
# Use Ansible 2.0+ events
def v2_runner_on_ok(self, result):
    """Called when a task succeeds"""
    host = result._host.name
    task = result._task.name
    
    # Access result data
    if 'stdout' in result._result:
        print(f"{host} | {task} | {result._result['stdout']}")
```

## References

- [Ansible Callback Plugin](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#callback-plugins)
- [Custom Callback Plugin Example](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#developing-callback-plugins)
- [Standard Callback Plugin List](https://github.com/ansible/ansible/blob/devel/lib/ansible/plugins/callback)
- [Ansible Callback Plugins Documentation](https://docs.ansible.com/ansible/latest/collections/index_callback.html)
