---
title: "ACOR v1.3.0: Introducing the Command-Line Tool"
date: 2026-03-17T00:00:00+09:00
tags: [go, redis, acor, tutorial]
---

## Introduction

[ACOR](https://github.com/skyoo2003/acor) v1.3.0 introduces a new command-line tool `acor`. You can now manipulate Aho-Corasick automata directly from the terminal without writing Go code. This post covers the CLI's main features and usage.

## Installation

### Binary Download

Download platform-specific binaries from GitHub Releases:

```bash
# macOS (Apple Silicon)
curl -LO https://github.com/skyoo2003/acor/releases/download/v1.3.0/acor_1.3.0_darwin_arm64.tar.gz
tar xzf acor_1.3.0_darwin_arm64.tar.gz
sudo mv acor /usr/local/bin/

# Linux (x86_64)
curl -LO https://github.com/skyoo2003/acor/releases/download/v1.3.0/acor_1.3.0_linux_amd64.tar.gz
tar xzf acor_1.3.0_linux_amd64.tar.gz
sudo mv acor /usr/local/bin/
```

### Build from Source

```bash
git clone https://github.com/skyoo2003/acor.git
cd acor
make build
```

The built binary will be at `bin/acor`.

## Basic Usage

### Redis Connection Options

The CLI supports various Redis topologies:

```bash
# Standalone
acor -addr localhost:6379 -name mycollection <command>

# Sentinel
acor -addrs localhost:26379,localhost:26380 -master-name mymaster -name mycollection <command>

# Cluster
acor -addrs localhost:7000,localhost:7001,localhost:7002 -name mycollection <command>
```

### Common Options

| Option | Description | Default |
|--------|-------------|---------|
| `-addr` | Single Redis address | `localhost:6379` |
| `-addrs` | Sentinel/Cluster addresses (comma-separated) | |
| `-master-name` | Sentinel master name | |
| `-ring-addrs` | Ring shards (format: `name1=addr1,name2=addr2`) | |
| `-password` | Redis password | |
| `-db` | Redis database number | `0` |
| `-name` | ACOR collection name | (required) |

## Main Commands

### add - Add Keywords

```bash
acor -addr localhost:6379 -name sample add "he"
acor -addr localhost:6379 -name sample add "her"
acor -addr localhost:6379 -name sample add "him"
```

### remove - Remove Keywords

```bash
acor -addr localhost:6379 -name sample remove "him"
```

### find - Search Text

```bash
acor -addr localhost:6379 -name sample find "he is him"
# Output: he
#         him
```

### find-index - Search with Position Information

```bash
acor -addr localhost:6379 -name sample find-index "he is him"
# Output: he: [0]
#         him: [6]
```

### suggest - Autocomplete Suggestions

```bash
acor -addr localhost:6379 -name sample suggest "he"
# Output: he
#         her
```

### suggest-index - Autocomplete with Position Information

```bash
acor -addr localhost:6379 -name sample suggest-index "he"
# Output: he: [0]
#         her: [0]
```

### info - Collection Information

```bash
acor -addr localhost:6379 -name sample info
# Output: Collection: sample
#         Keywords: 3
```

### flush - Delete Collection

```bash
acor -addr localhost:6379 -name sample flush
# Deletes all data in the collection
```

## Practical Examples

### Spam Keyword Management

```bash
# Create spam keyword collection
acor -addr localhost:6379 -name spam add "viagra"
acor -addr localhost:6379 -name spam add "lottery"
acor -addr localhost:6379 -name spam add "winner"

# Check message
acor -addr localhost:6379 -name spam find "Congratulations! You are a lottery winner!"
# Output: lottery
#         winner
```

### Batch Import Keywords from File

```bash
# Keywords file (one per line)
cat keywords.txt
# he
# she
# his
# her
# him

# Batch import
while read keyword; do
  acor -addr localhost:6379 -name sample add "$keyword"
done < keywords.txt
```

### Pipeline Search

```bash
# Search spam keywords in text file
cat message.txt | xargs -0 acor -addr localhost:6379 -name spam find
```

## Input Validation

The CLI validates Redis topology options at startup. Invalid options return an error immediately:

```bash
# Empty address
acor -addrs "," info
# Error: invalid -addrs: empty address

# Invalid Ring format
acor -ring-addrs "invalid" info
# Error: invalid -ring-addrs: expected format name=addr
```

## Conclusion

The v1.3.0 CLI tool makes ACOR easier to use. It's useful for automation when combined with scripts or for quick testing.

For more details, visit the [ACOR GitHub repository](https://github.com/skyoo2003/acor) and [official documentation](https://skyoo2003.github.io/acor/).
