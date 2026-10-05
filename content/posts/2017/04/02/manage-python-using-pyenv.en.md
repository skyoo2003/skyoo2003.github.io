---
title: Managing Python Virtual Environments with pyenv
description: "How pyenv's shims work, plus installation, environment variables, and key commands for managing multiple Python versions per project on one machine."
date: 2017-04-02T01:36:27+09:00
tags: [python, tutorial]
---

If you use Python for a while, you run into a lot of different version environments. Distributions like Redhat and Debian ship their own system Python, and depending on the need you may also build Python from source per account. Python differs in syntax and built-in libraries between the 2.x and 3.x major versions, and some features can behave or be implemented differently between minor versions too. It's a free but sometimes risky situation.

Of course, if you only run a single project on a single system, or the version is never going to change, you may not need to worry about it. But a system usually hosts several Python projects, and they are often built on different Python versions. If you reduce the coupling between projects by isolating their dependencies, each project doesn't have to care about the other environments.

I'd like to introduce pyenv as an open source solution that fits this need! Of course, you can control versions without it. Managing environment variables like $PATH and $PYTHONPATH properly is enough. But having to think about those variables in every project felt like a bit of a waste, which is why I looked into pyenv in detail.

## Key Features at a Glance

The features pyenv provides, briefly:

- You can change the global Python version per user.
- You can manage the Python version per project.
- Overriding the Python version with an environment variable is allowed.
- You can look up multiple Python versions at once. This is useful for libraries or CI tools that run tests against several versions.

And here is how it describes the differences from similar solutions:

- It doesn't depend on Python. It's implemented in pure shell script.
- pyenv has to be loaded into the shell as environment variables. In other words, the directory for pyenv's shims has to be added to `$PATH`.
- It can manage virtualenv. You can use virtualenv directly, or automate the process of creating virtual environments with pyenv-virtualenv.

## How It Works

On Unix and Linux systems, when you run a command, the shell searches the directory list in `$PATH` in order for an executable file. Everyday commands like `cd` and `rm` work because their directories are in `$PATH`. Without that, you'd have to give the absolute path every time, like `/bin/cd` or `/bin/rm`. Directories in `$PATH` are searched left to right, and if the same executable name exists in several of them, the one found first wins.

Once pyenv is installed, `eval $(pyenv init -)` is called at startup and registers `PATH=$(pyenv root)/shims:$PATH`. Here the path is resolved dynamically through `$(pyenv root)`.

When you install Python through pyenv afterwards, each version goes into `$(pyenv root)/versions/<version>`. And inside `$(pyenv root)/shims`, shim scripts are created with the same names as the executables, like `python` and `pip`. A shim intercepts the command and hands it to the executable of the actual version, and pyenv calls regenerating shims for newly installed executables a Rehash.

## Installation

For the first install, clone the official GitHub project. Installing to `$HOME/.pyenv` is the most recommended location, but it isn't required, so put it wherever makes sense.

```bash
$ git clone https://github.com/pyenv/pyenv.git $HOME/.pyenv
```

Set the following environment variables in the rc file for your shell. (I use zsh. If you use bash, edit .bash_profile.)

```bash
$ vi ~/.zshrc
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
```

**[Caution]** With bash, on some systems BASH_ENV is set up to call .bashrc, and putting the lines above in .bashrc can cause an infinite loop. (Make sure to add them to .bash_profile.)

Finally, run the following command to apply the changes.

```bash
$ exec $SHELL
```

PS. The installation steps for pyenv have changed a few times since I wrote this. These days `brew install pyenv` is the easy way on macOS, and the shell setup also differs a bit by version, so if you're on a recent version it's safer to follow the [official README](https://github.com/pyenv/pyenv#set-up-your-shell-environment-for-pyenv).

__Configurable environment variables__

`PYENV_VERSION` Specifies the Python version to use.

`PYENV_ROOT` Specifies the root directory where pyenv is installed. (Default: ~/.pyenv)

`PYENV_DEBUG` Whether to print pyenv debug information. cf. `pyenv --debug <subcommand>`

`PYENV_HOOK_PATH` Defines the search path for pyenv hooks. pyenv hooks is an expert option for running your own scripts at specific points of a pyenv command, so see the wiki for details. [pyenv hook wiki](https://github.com/pyenv/pyenv/wiki/Authoring-plugins#pyenv-hooks)

`PYENV_DIR` The path used to look for the `.python-version` file. (Default: $PWD)

`PYTHON_BUILD_ARIA2_OPTS` If the aria2c binary is on `$PATH` and executable, pyenv downloads Python sources with `aria2`, and this variable passes options to it. You can tune things like bandwidth or the number of connections. [aria2c options](https://aria2.github.io/manual/en/html/aria2c.html#options)

## Using the Latest or a Specific Version

To use the latest commit that hasn't been officially released yet, run the following.

```bash
$ cd $(pyenv root)
$ git pull
```

If you want to pin a specific released tag, run the following. (For example, use v1.0.9, or use v0.9.4, etc...)

```bash
$ cd $(pyenv root)
$ git fetch
$ git tag
v0.1.0
v0.1.1
v0.1.2
--- omitted ---
$ git checkout v1.0.9
```

## Uninstalling

Remove the installed pyenv directory, then remove all the environment variables set above.

```bash
$ rm -rf $(pyenv root)
$ vi ~/.zshrc
# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"
```

## Commands

With pyenv installed, let's go over the commands it provides. I won't cover all of them, only the frequently used and essential ones. For the rest, or commands added in newer versions, see the [pyenv COMMANDS](https://github.com/pyenv/pyenv/blob/master/COMMANDS.md) page.

### Installing Python

You can install a specific Python version or list the versions available to install.

* Install a specific Python version

```bash
$ pyenv install 2.7.12
Downloading Python-2.7.12.tar.xz...
-> https://www.python.org/ftp/python/2.7.12/Python-2.7.12.tar.xz
Installing Python-2.7.12...
Installed Python-2.7.12 to /Users/lukas/.pyenv/versions/2.7.12
```

If you need to set compile options during the build, use the `CONFIGURE_OPTS` environment variable.

If you need an HTTP(S) proxy, set the `http_proxy` and `https_proxy` environment variables beforehand.

For the various build problems, such as required packages and libraries or choosing a CPU architecture, see the [common build problems wiki](https://github.com/pyenv/pyenv/wiki/Common-build-problems) page.

* List every installable Python version

```bash
$ pyenv install -l
Available versions:
  2.1.3
  2.2.3
  2.3.7
--- omitted ---
```

### Removing Python

Used to remove an installed Python. If you need to remove every version and won't use pyenv anymore, `rm -rf $(pyenv root)` removes it for good. But if the removed version was set in `pyenv global` or `.python-version`, you have to switch that to another version yourself.

```bash
$ pyenv uninstall 2.7.12
pyenv: remove /Users/lukas/.pyenv/versions/2.7.12? y # answer y or n!
```

### Managing Python Versions

pyenv deals with many Python versions, and by using a few environment variables you can pick whichever version you need, or even several versions at once.

First, when pyenv picks a Python, the priority is `$PYENV_VERSION` > `$PYENV_DIR/.python-version` > `$PYENV_ROOT/version`, and each value can be set with `pyenv shell`, `pyenv local`, and `pyenv global`.

In short: `python is called` -> `pyenv hooks the command` -> `gets the version to use by priority` -> `runs Python of that version`.

Another interesting point is that you can select multiple Python versions. What if you want both 2.7.13 and 3.4.6? Set `pyenv (shell|local|global) 2.7.13 3.4.6`. With this setting, calling `python` runs 2.7.13. What if you want 3.4.6 as the default? Just swap the order: `pyenv (shell|local|global) 3.4.6 2.7.13`.

Let's go over the details below.

#### pyenv shell

A command for managing the Python version in the shell. It specifies the version through the `$PYENV_VERSION` environment variable, which has the highest priority among the configuration methods. It's useful when the version has to be decided at run time, for example when each script needs a different Python version.

```bash
$ echo $PYENV_VERSION # The variable is empty.

$ pyenv shell 3.4.6
$ echo $PYENV_VERSION # Now it's set.
3.4.6
```

```bash
$ pyenv shell 2.7.13 3.4.6
$ echo $PYENV_VERSION
2.7.13:3.4.6
```

#### pyenv local

A command for managing the Python version in a specific directory. More precisely, it writes the Python version to use into `$PYENV_DIR/.python-version`. If you haven't set `$PYENV_DIR`, the default is `$PWD`, so the file is created in the current directory.

```bash
$ pyenv local 3.4.6
$ ll .python-version # .python-version was created in the current directory.
-rw-rw-r--  1 lukas  staff     6B  4  2 01:10 .python-version
$ cat .python-version # The version I set is there.
3.4.6
```

```bash
$ pyenv local 2.7.13 3.4.6
$ cat .python-version # Multiple versions are defined. Running python uses 2.7.13.
2.7.13
3.4.6
```

#### pyenv global

A command for managing the system-wide Python version. More precisely, it writes the version to use into `$PYENV_ROOT/version`. If you haven't set `$PYENV_ROOT`, it defaults to `~/.pyenv`.

```bash
$ pyenv global 3.4.6
$ ll ~/.pyenv/version # The file was created at $PYENV_ROOT/version.
-rw-r--r--  1 lukas  staff    13B  4  2 01:30 /Users/lukas/.pyenv/version
$ cat ~/.pyenv/version # The version I set is there.
3.4.6
```

```bash
$ pyenv global 2.7.13 3.4.6
$ cat ~/.pyenv/version
2.7.13
3.4.6
```

## References

- [github.com/pyenv/pyenv](https://github.com/pyenv/pyenv)
