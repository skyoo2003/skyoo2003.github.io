---
title: Introduction to Ansible Callback Plugin
description: "How Ansible callback plugins hook into playbook events to log results or notify Slack, covering how they work, ansible.cfg settings, and available events."
date: 2017-11-14T21:44:56+09:00
tags: [ansible, tutorial]
---

Among Ansible plugins, this post covers only the **Callback Plugin**. A Callback Plugin is a module used for all sorts of purposes when a specific event happens in Ansible, such as logging data or writing to external channels like Slack or Mail. For reference, this was written against **Ansible 2.2.1.0**.

## Introduction

An **Ansible Callback Plugin** is a plugin that hooks into Ansible's various events so you can run your own logic at that point. It lets you define callback functions for events such as "right before execution" and "execution finished" on Ansible Tasks, Playbooks, and so on.

By default, callback functions only run for plugins registered in the **callback_whitelist** Ansible setting. This doesn't apply if the callback module sets CALLBACK\_NEEDS\_WHITELIST = False.

Also, Callback Plugins run in alphanumeric order. (e.g. 1.py → 2.py → a.py) The order of the callback list in the configuration doesn't matter.

## Configuration

Here are the Ansible settings for using Callback Plugins. You can define them in ansible.cfg or pass them on the command line.


* **callback_plugins** : The directory where callback plugins live.

> (ex) callback_plugins = ~/.ansible/plugins/callback:/usr/share/ansible/plugins/callback

* **stdout_callback** : Changes the default callback for stdout. Only callback plugin modules with CALLBACK_TYPE = stdout can be set here.

> (ex) stdout_callback = skippy

* **callback_whitelist** : Names of the plugins whose callbacks should run. Callback plugin modules with CALLBACK_NEEDS_WHITELIST = False are not affected.

> (ex) callback_whitelist = timer,mail

## Event Hooking

The public methods of the CallbackBase class in "lib/ansible/plugins/callback/\_\_init\_\_.py" of the Ansible project are the callback functions you can hook events with.

To implement a Callback Plugin, inherit the CallbackBase class and override the events you want to use. If you want your callbacks to run only for Ansible 2.0+ events, override the methods with the "v2_" prefix.

```python
# Below is the list of methods you can override.
# For Ansible 2.0+ callback plugins, add the v2_ prefix. (e.g. v2_runner_on_ok)
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

## Implementation Example

First, note that the Ansible Plugin below is borrowed from the [[jlafon/ansible-profile]](https://github.com/jlafon/ansible-profile) project.

Briefly, it's a simple plugin that keeps the run time of each playbook task in memory and displays those times before the playbook ends. The code should be self-explanatory, and the comments cover the parts of the plugin that need explaining.

```python
import datetime
import os
import time
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    """
    A plugin for timing tasks
    """
    # Class attributes every callback plugin must define.
    CALLBACK_VERSION = 2.0 # Callback plugin version.
    CALLBACK_TYPE = 'notification' # One of 'stdout', 'notification', 'aggregate'
    CALLBACK_NAME = 'profile_tasks' # Name of the callback module, used when adding it to the whitelist.
    CALLBACK_NEEDS_WHITELIST = True
    
    # Initialization of the callback plugin.
    def __init__(self):
        super(CallbackModule, self).__init__()
        self.stats = {}
        self.current = None
    
    # Logic that runs when each Task in the Playbook starts.
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
    
    # Logic that runs when the Playbook finishes.
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

Below is sample output of the 'profile_tasks' Callback Plugin.

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

PS. Since I wrote this, almost the same feature ships with Ansible as `profile_tasks`. (These days it lives in the `ansible.posix` collection.) Also, from Ansible 2.11 the `callback_whitelist` setting was renamed to `callbacks_enabled`, so keep that in mind on recent versions.

## References
- [Ansible Callback Plugin](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#callback-plugins)
- [Custom Callback Plugin example](http://docs.ansible.com/ansible/dev_guide/developing_plugins.html#developing-callback-plugins)
- [Standard Callback Plugin list](https://github.com/ansible/ansible/blob/devel/lib/ansible/plugins/callback)
