---
title: Managing Python Virtual Environments with pyenv
date: 2017-04-02T01:36:27+09:00
tags: [python, tutorial]
---

When using Python, you'll encounter various version environments. First, distributions like RedHat and Debian have their own system Python installed, and you can also use Python built from source on a per-account basis as needed. Python has major syntax and built-in library differences between 2.x and 3.x versions, and minor versions can have different behaviors or implementations in some features - a free but sometimes risky situation.

Of course, if you only operate one project on a single system and the version will never change, you may not need to worry about this. However, generally, a single system can have various Python projects, and these may often be implemented based on different Python versions. If you reduce cohesion between projects through dependency isolation, individual projects don't need to worry about other environments.

I'd like to introduce pyenv as an open-source solution suitable for these needs! Of course, you can control versions without using open-source tools. It's possible by properly managing environment variables like $PATH and $PYTHON_PATH. However, thinking about dealing with these environment variables in every project seemed like it could be wasteful, so I decided to learn more about pyenv.

## Brief Overview of Core Features

pyenv provides the following features:

- Change Global Python Version per user
- Use Python version management features per project
- Allow overriding Python versions through environment variables
- Query multiple Python versions at specific times. This is useful for libraries or CI tools that run tests on various versions.

And here are the differences from similar solutions:

- No dependency on Python. Implemented in pure shell scripts.
- Need to load Pyenv as an environment variable in the shell. In other words, you need to add pyenv's shim access directory to `$PATH`.
- Can manage virtualenv. You can use virtualenv directly, or automate the process of creating virtual environments through pyenv-virtualenv.

## Understanding How It Works

In Unix/Linux systems, when executing a specific command, the system searches for executable files in the directory list registered in `$PATH` in order. Common commands like `cd` and `rm` work because they're registered in the `$PATH` environment variable. If not registered in `$PATH`, you'd have to specify the executable file with an absolute path like `/bin/cd` or `/bin/rm` every time. `$PATH` searches directories from left to right, and if there are executable files with the same name, the file in the directory found first is used.

When pyenv installation is complete, you initially call `eval $(pyenv init -)`, which registers `PATH=$(pyenv root)/shims:$PATH` in the environment variable. At this point, the path is dynamically created through `$(pyenv root)`, which pyenv project refers to as Hash (or Rehash).

Afterwards, when you install Python through pyenv, it's installed in `$(pyenv root)/versions/<version>` path. Then, binary files are created in the `$(pyenv root)/shims` directory.

### How Shims Work

```
$ python --version
    ↓
pyenv shim (~/.pyenv/shims/python)
    ↓
Version determination (PYENV_VERSION → .python-version → ~/.pyenv/version)
    ↓
Actual Python execution (~/.pyenv/versions/3.9.0/bin/python)
```

## Installation

### Automatic Installation (Recommended)

```bash
# macOS (Homebrew)
$ brew update
$ brew install pyenv

# Linux (pyenv-installer)
$ curl https://pyenv.run | bash
```

### Manual Installation

For initial installation, clone from the official Github project. Installing at `$HOME/.pyenv` is most recommended but not required, so clone to an appropriate path.

```bash
$ git clone https://github.com/pyenv/pyenv.git $HOME/.pyenv
```

Set the following environment variables in the appropriate rc file for your shell. (I'm using zsh shell. If using bash shell, modify the .bash_profile file.)

```bash
$ vi ~/.zshrc
export PYENV_ROOT="$HOME/.pyenv"
export PATH="$PYENV_ROOT/bin:$PATH"
eval "$(pyenv init -)"
```

**[Caution]** When using bash shell, if BASH_ENV calls .bashrc on some systems, adding the above content to .bashrc may cause an infinite loop, so be careful. (Must add to .bash_profile.)

Finally, run the following command to reflect the above changes:

```bash
$ exec $SHELL
```

### Configurable Environment Variables

`PYENV_VERSION` Specify the Python version to use.

`PYENV_ROOT` Specify the root directory where pyenv will be installed. (Default: ~/.pyenv)

`PYENV_DEBUG` Whether to expose pyenv debug information cf. `pyenv --debug <subcommand>`

`PYENV_HOOK_PATH` Define the search path to use in pyenv hooks feature. The pyenv hooks feature is an expert option used when you want a specified script to run at specific times during pyenv commands, so refer to the following wiki for details. [pyenv hook wiki](https://github.com/pyenv/pyenv/wiki/Authoring-plugins#pyenv-hooks)

`PYENV_DIR` Enter the path to find the `.python-version` file. (Default: $PWD)

`PYTHON_BUILD_ARIA2_OPTS` If pyenv finds the aria2c binary path in $PATH and it's executable, it uses `aria2` to download Python source. This environment variable passes options for that. You can control bandwidth, number of connections, etc. [aria2c options](https://aria2.github.io/manual/en/html/aria2c.html#options)

## Selecting Latest or Specific Version

To use the latest commit version that hasn't been officially released, run the following command:

```bash
$ cd $(pyenv root)
$ git pull
```

If you want to use a specific released tag, run the following command. (For example, using v1.0.9 version, using v0.9.4, etc.)

```bash
$ cd $(pyenv root)
$ git fetch
$ git tag
git tag
v0.1.0
v0.1.1
v0.1.2
--- omitted ---
$ git checkout v1.0.9
```

## Uninstallation

After removing the installed pyenv directory, remove all environment variables set above.

```bash
$ rm -rf $(pyenv root)
$ vi ~/.zshrc
# export PYENV_ROOT="$HOME/.pyenv"
# export PATH="$PYENV_ROOT/bin:$PATH"
# eval "$(pyenv init -)"
```

## Understanding Commands

Now that pyenv installation is complete, let's summarize the commands provided by pyenv. I won't cover all commands, only frequently used and essential content. To check other commands or commands added in newer versions, refer to the [pyenv COMMANDS](https://github.com/pyenv/pyenv/blob/master/COMMANDS.md) page.

### Installing Python

You can install specific Python versions or see the list of installable Python versions.

* Install specific Python version

```bash
$ pyenv install 2.7.12
Downloading Python-2.7.12.tar.xz...
-> https://www.python.org/ftp/python/2.7.12/Python-2.7.12.tar.xz
Installing Python-2.7.12...
Installed Python-2.7.12 to /Users/lukas/.pyenv/versions/2.7.12
```

### Build Options

If you need to set compile options during Python build, you can set them through the `CONFIGURE_OPTS` environment variable.

```bash
# Enable optimizations
$ CONFIGURE_OPTS="--enable-optimizations" pyenv install 3.9.0

# Enable shared library
$ CONFIGURE_OPTS="--enable-shared" pyenv install 3.9.0

# Enable debug symbols
$ CONFIGURE_OPTS="--with-pydebug" pyenv install 3.9.0
```

If HTTP(S) proxy settings are needed, set `http_proxy` and `https_proxy` environment variables beforehand.

For various build issues like required packages/libraries installation and CPU architecture selection, refer to the [common build problems wiki](https://github.com/pyenv/pyenv/wiki/Common-build-problems) page.

* View list of all installable Python versions

```bash
$ pyenv install -l
Available versions:
  2.1.3
  2.2.3
  2.3.7
--- omitted ---
```

### Uninstalling Python

Used to delete already installed Python. If you need to delete all versions and no longer use pyenv, you can permanently delete with `rm -rf $(pyenv root)`. However, using the `pyenv uninstall` command substitutes with another available Python.

```bash
pyenv uninstall 2.7.12
pyenv: remove /Users/lukas/.pyenv/versions/2.7.12? y # Enter y or n!
```

### Managing Python Versions

pyenv handles various Python versions and can select different versions as needed and even multiple versions by using various environment variables.

First, pyenv has the following priority when selecting Python: `$PYENV_VERSION` > `$PYENV_DIR/.python-version` > `$PYENV_ROOT/version`. Each value can be set through `pyenv shell`, `pyenv local`, and `pyenv global` commands.

In other words: `python call` -> `pyenv hooks command` -> `get version info according to priority` -> `execute that version of Python`.

Additionally, a unique feature is that you can select multiple Python versions. If you decide to use versions 2.7.13 and 3.4.6? Just set `pyenv (shell|local|global) 2.7.13 3.4.6`. With this setting, when you call the `python` command, Python version 2.7.13 is called. If you want to use version 3.4.6 as default? Just change the order to `pyenv (shell|local|global) 3.4.6 2.7.13`.

Let me summarize the details below.

#### pyenv shell

This command manages Python versions in the shell. In other words, it sets the `$PYENV_VERSION` environment variable to specify the version to use, and this environment variable has the highest priority among other setting methods. It's useful when Python version needs to change per script or when version needs to be determined at execution time.

```bash
$ echo $PYENV_VERSION # Environment variable is empty

$ pyenv shell 3.4.6
$ echo $PYENV_VERSION # You can see it's set in the environment variable
3.4.6
```

```bash
$ pyenv shell 2.7.13 3.4.6
$ echo $PYENV_VERSION
2.7.13:3.4.6
```

#### pyenv local

This command manages Python versions in specific directories. More precisely, it's a command that defines the Python version to use in `$PYENV_DIR/.python-version`. If you haven't specially set the `$PYENV_DIR` environment variable, by default this file is created in `$PWD`, i.e., the current directory.

```bash
$ pyenv local 3.4.6
$ ll .python-version # .python-version file was created in current directory
-rw-rw-r--  1 lukas  staff     6B  4  2 01:10 .python-version
$ cat .python-version # The Python version I set is defined
3.4.6
```

```bash
$ pyenv local 2.7.13 3.4.6
$ cat .python-version # Multiple versions are defined. When running python command, version 2.7.13 executes
2.7.13
3.4.6
```

#### pyenv global

This command manages system Python versions. More precisely, it's a command to define the version to use in `$PYENV_ROOT/version`. If you haven't specially defined the `$PYENV_ROOT` environment variable, it defaults to `~/.pyenv`.

```bash
$ pyenv global 3.4.6
$ ll ~/.pyenv/version # File was created at $PYENV_ROOT/version path
-rw-r--r--  1 lukas  staff    13B  4  2 01:30 /Users/lukas/.pyenv/version
$ cat ~/.pyenv/version # The Python version I set is defined
3.4.6
```

```bash
$ pyenv global 2.7.13 3.4.6
$ cat ~/.pyenv/version
2.7.13
3.4.6
```

### Version Check Commands

```bash
# Currently active Python version
$ pyenv version
3.9.0 (set by /Users/lukas/projects/myproject/.python-version)

# All installed Python versions
$ pyenv versions
  system
  2.7.18
* 3.9.0 (set by /Users/lukas/projects/myproject/.python-version)
  3.8.5
```

## Using pyenv-virtualenv

pyenv-virtualenv is a pyenv plugin that manages virtualenv.

### Installation

```bash
# macOS (Homebrew)
$ brew install pyenv-virtualenv

# Linux
$ git clone https://github.com/pyenv/pyenv-virtualenv.git $(pyenv root)/plugins/pyenv-virtualenv
```

### Shell Settings

```bash
$ vi ~/.zshrc
eval "$(pyenv virtualenv-init -)"
$ exec $SHELL
```

### Creating Virtual Environments

```bash
# Create virtualenv based on Python 3.9.0
$ pyenv virtualenv 3.9.0 myproject-env

# List virtual environments
$ pyenv virtualenvs
  myproject-env (created from ~/.pyenv/versions/3.9.0)

# Activate virtualenv
$ pyenv activate myproject-env

# Deactivate
$ pyenv deactivate

# Delete virtual environment
$ pyenv uninstall myproject-env
```

### Auto-activation per Project

```bash
$ cd ~/projects/myproject
$ pyenv local myproject-env
# Now entering this directory automatically activates the virtual environment
```

## Practical Examples

### Django Project Setup

```bash
# Install required Python version
$ pyenv install 3.9.0

# Create virtual environment
$ pyenv virtualenv 3.9.0 django-app-env

# Set virtual environment for project
$ cd ~/projects/django-app
$ pyenv local django-app-env

# Install Django
$ pip install django
$ django-admin startproject mysite .
```

### Using with tox (Multi-version Testing)

```bash
# Install multiple Python versions
$ pyenv install 3.7.9 3.8.5 3.9.0

# Set multiple versions for project
$ pyenv local 3.9.0 3.8.5 3.7.9

# tox.ini
[tox]
envlist = py37,py38,py39

[testenv]
deps = pytest
commands = pytest

# Run tox
$ tox
```

### CI/CD Usage

```yaml
# GitHub Actions example
name: Python CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: [3.7, 3.8, 3.9]
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Install pyenv
        run: |
          curl https://pyenv.run | bash
          echo "$HOME/.pyenv/bin" >> $GITHUB_PATH
          echo "$HOME/.pyenv/shims" >> $GITHUB_PATH
      
      - name: Install Python ${{ matrix.python-version }}
        run: pyenv install ${{ matrix.python-version }}
      
      - name: Run tests
        run: |
          pyenv global ${{ matrix.python-version }}
          pip install -r requirements.txt
          pytest
```

## Troubleshooting

### Common Problems

**1. Build Failure**

```bash
ERROR: The Python ssl extension was not compiled. Missing the OpenSSL lib?
```

Solution (Ubuntu/Debian):
```bash
$ sudo apt-get install -y build-essential libssl-dev zlib1g-dev libbz2-dev \
    libreadline-dev libsqlite3-dev wget curl llvm libncurses5-dev \
    libncursesw5-dev xz-utils tk-dev libffi-dev liblzma-dev python-openssl
```

Solution (macOS):
```bash
$ brew install openssl readline sqlite3 xz zlib
$ export LDFLAGS="-L$(brew --prefix openssl)/lib"
$ export CPPFLAGS="-I$(brew --prefix openssl)/include"
$ pyenv install 3.9.0
```

**2. Command Not Found**

```bash
pyenv: command not found
```

Solution:
```bash
# Check environment variable
$ echo $PATH | grep pyenv

# Re-apply shell settings
$ source ~/.zshrc  # or ~/.bash_profile
```

**3. Version Not Changing**

```bash
$ pyenv global 3.9.0
$ python --version
Python 2.7.16  # Not changed
```

Solution:
```bash
# Regenerate shims
$ pyenv rehash

# Restart shell
$ exec $SHELL
```

**4. Permission Issues**

```bash
permission denied: ~/.pyenv/versions/3.9.0
```

Solution:
```bash
$ sudo chown -R $(whoami) ~/.pyenv
```

## Best Practices

### 1. Commit .python-version per Project

```bash
# Commit .python-version file to Git
$ cd ~/projects/myproject
$ pyenv local 3.9.0
$ git add .python-version
$ git commit -m "Add Python version specification"
```

### 2. Manage with requirements.txt

```bash
# Create virtualenv and install dependencies
$ pyenv virtualenv 3.9.0 myproject
$ pyenv local myproject
$ pip install -r requirements.txt
$ pip freeze > requirements.txt
```

### 3. .python-version and runtime.txt

PaaS like Heroku uses `runtime.txt`:

```
# runtime.txt
python-3.9.0
```

### 4. Combining pyenv with poetry

```bash
# Manage Python version with pyenv
$ pyenv local 3.9.0

# Manage dependencies with poetry
$ pip install poetry
$ poetry init
$ poetry add django
$ poetry install
```

## References

- [github.com/pyenv/pyenv](https://github.com/pyenv/pyenv)
- [pyenv-virtualenv](https://github.com/pyenv/pyenv-virtualenv)
- [Common build problems](https://github.com/pyenv/pyenv/wiki/Common-build-problems)
- [Python Version Management with pyenv](https://realpython.com/intro-to-pyenv/)
