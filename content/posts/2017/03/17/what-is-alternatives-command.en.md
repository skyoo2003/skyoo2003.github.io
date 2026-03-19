---
title: Understanding the alternatives Command
date: 2017-03-17T11:13:43+09:00
tags: [linux, tutorial]
---

`alternatives` (or `update-alternatives`) is a GNU-licensed command-line tool that provides functionality to create, remove, manage, and query symbolic links. In other words, it allows defining default versions or paths for specific commands through symbolic links. Note that Debian-based Linux distributions only provide the `update-alternatives` command (the original `alternatives` script was reimplemented to remove perl language dependency), and there are some differences in functionality compared to RedHat-based Linux commands, but this article covers only common functionality and options. Examples are based on RedHat.

For easier understanding, I'll use Maven installation on the system and connecting it via symbolic links. Assume Maven is installed at `/usr/lib/apache-maven-*`. Of course, other applications are also possible.

## What is alternatives?

### Overview

In Linux systems, multiple versions of the same program can be installed. For example:
- Java: OpenJDK 8, OpenJDK 11, Oracle JDK
- Python: Python 2.7, Python 3.6, Python 3.9
- Maven: 3.3.9, 3.6.3, 3.8.1

The `alternatives` command solves this problem elegantly through symbolic links.

### How It Works

```
/usr/bin/java → /etc/alternatives/java → /usr/lib/jvm/java-11/bin/java
     ^                    ^                          ^
     |                    |                          |
  User command      Managed by alternatives       Actual binary
```

1. User enters `java` command
2. System follows `/usr/bin/java` symbolic link
3. Points to `/etc/alternatives/java`
4. Finally reaches the actual Java binary

## Creating Symbolic Links (--install)

The `--install` action creates symbolic links. On RedHat, `alternatives` creates symbolic links in `/etc/alternatives/<name>` by default, and stores mode, priority, link, and path information in `/var/lib/alternatives/<name>`. When a symbolic link is created for the first time, a symbolic link to `/etc/alternatives/<name>` is created at the `<link>` path. (`<link>`->`/etc/alternatives/<name>`->`<path>`)

The `--slave` option is used to manage additional commands along with the master symbolic link. For example, when creating a symbolic link for the `java` command, you can also manage additional commands like `javac`, `javadoc`, etc. The `--slave` option can be defined multiple times.

```bash
$ alternatives --install <link> <name> <path> <priority> [--slave <link> <name> <path>]*
<link> : Enter the symbolic link path.
<name> : Enter the symbolic link group name managed by alternatives.
<path> : Enter the absolute path of the package.
<priority> : Specify priority within the link group. Enter as integer; higher is better.
```

```bash
# Create symbolic link for Maven 3.3.3 at /usr/local/bin/mvn
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/apache-maven-3.3.3/bin/mvn 30303
# Create symbolic link for Maven 3.3.9 at /usr/local/bin/mvn
$ alternatives --install /usr/local/bin/mvn mvn /usr/lib/apache-maven-3.3.9/bin/mvn 30309

# You can see symbolic links created at the following paths
$ ll /etc/alternatives/mvn
lrwxrwxrwx 1 root root 35 Mar 18 00:34 /etc/alternatives/mvn -> /usr/lib/apache-maven-3.3.9/bin/mvn
$ ll /usr/local/bin/mvn
lrwxrwxrwx 1 root root 21 Mar 18 00:34 /usr/local/bin/mvn -> /etc/alternatives/mvn

# You can see metadata stored at the following path
$ ll /var/lib/alternatives/mvn
-rw-r--r-- 1 root root 109 Mar 18 00:34 /var/lib/alternatives/mvn
$ cat /var/lib/alternatives/mvn
auto
/usr/local/bin/mvn

/usr/lib/apache-maven-3.3.3/bin/mvn
30303
/usr/lib/apache-maven-3.3.9/bin/mvn
30309
```

Note: To change the paths where alternatives manages symbolic links and metadata, use the `--altdir <directory>` and `--admindir <directory>` command options.

```bash
$ alternatives --altdir /home/user/alternatives --admindir /home/user/alternatives/meta --install /home/user/bin/mvn mvn /usr/lib/maven-3.3.9/bin/mvn 1
```

### Using Slave Option Example

Managing related commands together when installing Java:

```bash
$ alternatives --install /usr/bin/java java /usr/lib/jvm/java-11-openjdk/bin/java 2000 \
  --slave /usr/bin/javac javac /usr/lib/jvm/java-11-openjdk/bin/javac \
  --slave /usr/bin/javadoc javadoc /usr/lib/jvm/java-11-openjdk/bin/javadoc \
  --slave /usr/bin/jar jar /usr/lib/jvm/java-11-openjdk/bin/jar \
  --slave /usr/bin/jps jps /usr/lib/jvm/java-11-openjdk/bin/jps
```

## Removing Symbolic Links (--remove)

The `--remove` action removes created symbolic links. Specifically, it removes from alternatives metadata, and if there are no connectable symbolic links within the `<name>` link group, both `/etc/alternatives/<name>` symbolic link and `/var/lib/alternatives/<name>` are also destroyed. If there are other alternatives, `alternatives` automatically updates to that link.

```bash
$ alternatives --remove <name> <path>
<name> : Enter the symbolic link group name managed by alternatives.
<path> : Enter the absolute path of the package to delete.
```

```bash
# Remove symbolic link metadata for /usr/lib/apache-maven-3.3.9/bin/mvn from mvn symbolic link group
$ alternatives --remove mvn /usr/lib/apache-maven-3.3.9/bin/mvn

# case1) If apache-maven-3.3.3/bin/mvn is connected with the same group name, it updates to that path
$ ll /etc/alternatives/mvn
lrwxrwxrwx 1 root root 35 Mar 18 00:49 /etc/alternatives/mvn -> /usr/lib/apache-maven-3.3.3/bin/mvn
$ ll /var/lib/alternatives/mvn
-rw-r--r-- 1 root root 67 Mar 18 00:49 /var/lib/alternatives/mvn
$ cat /var/lib/alternatives/mvn
auto
/usr/local/bin/mvn

/usr/lib/apache-maven-3.3.3/bin/mvn
30303

# case2) If there are no other alternatives in the mvn symbolic link group, files and links at /etc/alternatives/mvn, /var/lib/alternatives/mvn, and /usr/local/bin/mvn are removed
$ ll /etc/alternatives/mvn
ls: cannot access /etc/alternatives/mvn: No such file or directory
$ ll /var/lib/alternatives/mvn
ls: cannot access /var/lib/alternatives/mvn: No such file or directory
$ ll /usr/local/bin/mvn
ls: cannot access /usr/local/bin/mvn: No such file or directory
```

## Setting Auto Mode (--auto)

The `--auto` action sets alternatives-registered symbolic links to be automatically selected within the link group. It preferentially selects the link with the highest `<priority>` value, and if the automatically selected link is removed, it connects to another alternative link.

```bash
$ alternatives --auto <name>
<name> : Enter the symbolic link group name managed by alternatives.
```

```bash
# Set mvn registered symbolic link group to auto mode
$ alternatives --auto mvn

# You can see 'auto' in the first line of metadata
$ cat /var/lib/alternatives/mvn
auto
/usr/local/bin/mvn

/usr/lib/apache-maven-3.3.3/bin/mvn
30303
/usr/lib/apache-maven-3.3.9/bin/mvn
30309
```

## Setting Manual Mode (--config)

The `--config` action allows users to arbitrarily select from alternatives-registered symbolic links within the link group.

```bash
$ alternatives --config <name>
<name> : Enter the symbolic link group name managed by alternatives.
```

```bash
# Prompts user to input which command to use by default
$ alternatives --config mvn

There are 2 programs which provide 'mvn'.

  Selection    Command
-----------------------------------------------
   1           /usr/lib/apache-maven-3.3.3/bin/mvn
*+ 2           /usr/lib/apache-maven-3.3.9/bin/mvn

Enter to keep the current selection[+], or type selection number: 1

# You can see the symbolic link changed and 'manual' in the first line of metadata
$ ll /etc/alternatives/mvn
lrwxrwxrwx 1 root root 35 Mar 18 00:58 /etc/alternatives/mvn -> /usr/lib/apache-maven-3.3.3/bin/mvn
$ cat /var/lib/alternatives/mvn
manual
/usr/local/bin/mvn

/usr/lib/apache-maven-3.3.3/bin/mvn
30303
/usr/lib/apache-maven-3.3.9/bin/mvn
30309
```

## Viewing Symbolic Link Groups (--display)

The `--display` action shows detailed information about alternatives-registered symbolic link groups. You can see command paths connected to master/slave symbolic links, current mode, currently selected link and other available links, and symbolic link priority values.

```bash
$ alternatives --display <name>
<name> : Enter the symbolic link group name managed by alternatives.
```

```bash
# Check package information for mvn link
$ alternatives --display mvn
mvn - status is manual.
 link currently points to /usr/lib/apache-maven-3.3.3/bin/mvn
/usr/lib/apache-maven-3.3.9/bin/mvn - priority 30309
/usr/lib/apache-maven-3.3.3/bin/mvn - priority 30303
Current 'best' version is /usr/lib/apache-maven-3.3.9/bin/mvn.

# Check changed mvn mode after --auto setting
$ alternatives --auto mvn
$ alternatives --display mvn
mvn - status is auto.
 link currently points to /usr/lib/apache-maven-3.3.9/bin/mvn
/usr/lib/apache-maven-3.3.9/bin/mvn - priority 30309
/usr/lib/apache-maven-3.3.3/bin/mvn - priority 30303
Current 'best' version is /usr/lib/apache-maven-3.3.9/bin/mvn.
```

## Viewing All Symbolic Link Groups (--list)

`--list` shows information about all symbolic links registered in alternatives.

```bash
$ alternatives --list
<name> : Enter the symbolic link group name managed by alternatives.
```

```bash
# List of all symbolic link groups registered on local machine
$ alternatives --list
java_sdk_1.8.0	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
jre_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre
jre_1.7.0_openjdk	auto	/usr/lib/jvm/jre-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
java_sdk_1.8.0_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
java_sdk_1.7.0	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
mvn	auto	/usr/lib/maven-3.3.9/bin/mvn
java_sdk_openjdk	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
jre_1.7.0	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64/jre
jre_1.8.0	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre
ld	auto	/usr/bin/ld.bfd
javac	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/bin/javac
java	auto	/usr/lib/jvm/java-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64/jre/bin/java
libnssckbi.so.x86_64	auto	/usr/lib64/pkcs11/p11-kit-trust.so
jre_1.8.0_openjdk	auto	/usr/lib/jvm/jre-1.8.0-openjdk-1.8.0.121-0.b13.el7_3.x86_64
java_sdk_1.7.0_openjdk	auto	/usr/lib/jvm/java-1.7.0-openjdk-1.7.0.131-2.6.9.0.el7_3.x86_64
```

## Practical Examples

### Java Version Management

```bash
# Install and register OpenJDK 8
$ alternatives --install /usr/bin/java java /usr/lib/jvm/java-1.8.0-openjdk/bin/java 1800 \
  --slave /usr/bin/javac javac /usr/lib/jvm/java-1.8.0-openjdk/bin/javac

# Install and register OpenJDK 11
$ alternatives --install /usr/bin/java java /usr/lib/jvm/java-11-openjdk/bin/java 1100 \
  --slave /usr/bin/javac javac /usr/lib/jvm/java-11-openjdk/bin/javac

# Switch Java version
$ alternatives --config java

# Check current Java version
$ java -version
```

### Python Version Management

```bash
# Register Python 3.6
$ alternatives --install /usr/bin/python python /usr/bin/python3.6 1

# Register Python 3.8
$ alternatives --install /usr/bin/python python /usr/bin/python3.8 2

# Switch Python version
$ alternatives --config python
```

### Jenkins CI/CD Usage

```groovy
pipeline {
    agent any
    
    stages {
        stage('Set Java Version') {
            steps {
                sh 'alternatives --set java /usr/lib/jvm/java-11-openjdk/bin/java'
            }
        }
        
        stage('Build') {
            steps {
                sh 'mvn clean package'
            }
        }
    }
}
```

## Troubleshooting

### Common Problems

**1. Insufficient Permissions**

```bash
failed to create /var/lib/alternatives/java.new: Permission denied
```

Solution:
```bash
$ sudo alternatives --install ...
```

**2. Link Group Does Not Exist**

```bash
failed to read link /usr/bin/java: No such file or directory
```

Solution:
```bash
# Must perform install first
$ alternatives --install /usr/bin/java java /path/to/java 1
```

**3. Understanding Priority**

```bash
# Higher priority is automatically selected
$ alternatives --install /usr/bin/java java /path/to/java8 800
$ alternatives --install /usr/bin/java java /path/to/java11 1100

# java11 is selected in auto mode
$ alternatives --auto java
```

## Differences in Debian/Ubuntu

Debian-based systems use the `update-alternatives` command:

```bash
# Debian/Ubuntu
$ sudo update-alternatives --install /usr/bin/java java /usr/lib/jvm/java-11/bin/java 1
$ sudo update-alternatives --config java
$ sudo update-alternatives --display java
$ sudo update-alternatives --list

# Options are the same
# --install, --remove, --config, --auto, --display, --list
```

## Best Practices

### 1. Priority Strategy

```bash
# Use version number as priority
# Java 8.0.121 → 80121
# Java 11.0.2 → 110002
# Maven 3.3.9 → 30309
# Maven 3.6.3 → 30603
```

### 2. Actively Use Slave Option

```bash
# Manage related commands together
$ alternatives --install /usr/bin/java java /path/to/java 1 \
  --slave /usr/bin/javac javac /path/to/javac \
  --slave /usr/bin/javadoc javadoc /path/to/javadoc \
  --slave /usr/bin/jar jar /path/to/jar \
  --slave /usr/bin/jps jps /path/to/jps
```

### 3. Automate with Script

```bash
#!/bin/bash
# install-java.sh

JAVA_HOME=$1
PRIORITY=$2

alternatives --install /usr/bin/java java $JAVA_HOME/bin/java $PRIORITY \
  --slave /usr/bin/javac javac $JAVA_HOME/bin/javac \
  --slave /usr/bin/javadoc javadoc $JAVA_HOME/bin/javadoc \
  --slave /usr/bin/jar jar $JAVA_HOME/bin/jar

echo "Java installed. Current version:"
java -version
```

## References

- [Linux alternatives Manual](https://linux.die.net/man/8/alternatives)
- [Debian update-alternatives](https://manpages.debian.org/stable/dpkg/update-alternatives.1.en.html)
- [RHEL System Administrator's Guide](https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/7/html/system_administrators_guide/)
