---
title: "테스트는 통과했는데 바이너리는 죽어 있었다: DevCloud 릴리즈 회고"
description: "boto3 테스트를 통과하고도 실행 즉시 죽는 DevCloud 바이너리를 두 번 배포한 원인인 CGO_ENABLED=0과 GoReleaser 설정, 재발 방지책을 회고한다."
date: 2026-09-30T00:00:00+09:00
lastmod: 2026-10-05T00:00:00+09:00
tags: [go, devcloud, release-engineering, security]
---

## 들어가며

참고로 이 글은 2026-10-05에 보완했으며, v1.2.0 이후 main의 [`734b839`](https://github.com/skyoo2003/devcloud/tree/734b83995a3f750f0db827ec9299bc8ed81a530c)를 기준으로 설명한다.

[DevCloud](https://github.com/skyoo2003/devcloud)는 릴리즈마다 boto3 호환성 테스트를 통과한 뒤에야 바이너리를 내보내는데, v1.0.0 당시에는 이 테스트가 775개였다. 그런데 v1.0.0을 전후해서 이 게이트를 모두 통과하고도 **실행하자마자 죽는** 바이너리를 두 번이나 배포했다. 직접적인 원인은 달랐지만 두 번 모두 게이트가 검증한 바이너리와 사용자가 내려받는 바이너리가 같지 않았다.

이 글에서는 그 두 사건에 더해 한 달 뒤 v1.1.1에서 고친 보안 결함 하나를 돌아보려 한다. 세 사건 모두 코드 몇 줄을 바꾸면 고칠 수 있었지만 "왜 그동안 아무 검사도 이것을 잡지 못했는가"를 이해하는 데 시간이 걸렸다.

## 사건 1: CGO_ENABLED=0과 cgo 전용 드라이버

### 증상

DevCloud는 서비스 상태를 SQLite에 저장하고 GoReleaser로 크로스 컴파일할 때는 `CGO_ENABLED=0`으로 빌드한다. 그런데 당시 저장소에 쓰던 `mattn/go-sqlite3` 드라이버는 cgo 없이는 동작하지 않아 이 빌드 설정과 맞지 않았다.

문제는 이 조합이 동작하지 않으면서도 **컴파일은 된다**는 점이었다. 드라이버가 cgo를 끈 빌드용 스텁을 함께 배포하기 때문에 컴파일은 통과하고 런타임에서야 실패하는데, 그 결과 v0.2.0부터 태그로 배포한 모든 바이너리가 시작하자마자 다음 메시지를 남기고 종료됐다.

```
init s3: enable WAL: Binary was compiled with 'CGO_ENABLED=0',
go-sqlite3 requires cgo to work. This is a stub
```

tar.gz/zip 아카이브와 Homebrew formula는 모두 처음부터 죽은 상태로 배포됐지만, 컨테이너 이미지는 Dockerfile에서 `sqlite-dev`를 설치하고 `CGO_ENABLED=1`로 빌드했기 때문에 정상이었다. CI도 cgo를 켠 채 돌고 있었으니 대부분의 테스트가 같은 이유로 통과할 수밖에 없었다.

### 수정

해결 방법으로는 SQLite C 코드를 Go로 변환한 `modernc.org/sqlite` 드라이버로 바꾸는 쪽을 택했다. 대상 플랫폼마다 C 툴체인을 준비할 필요가 없고, 다행히 API 차이도 작았다. DynamoDB 정렬 키에 쓰는 `NUMTEXT` 콜레이션은 `RegisterCollationUtf8`이 받는 `func(left, right string) int` 시그니처와 정확히 맞아 그대로 옮길 수 있었다. 패키지의 공개 API도 유지돼 108개 importer를 손대지 않아도 됐으며 디스크 포맷은 여전히 SQLite라 기존 데이터 디렉토리도 그대로 열린다.

다만 호환성 스위트는 55초에서 63초로 약 15% 느려졌는데, C를 Go로 변환한 코드에서 예상되는 비용이었다.

### 드라이버를 바꾸면 기본값도 바뀐다

드라이버를 교체하고 나서는 기본값 차이도 확인해야 했다. `mattn/go-sqlite3`는 DSN에 아무것도 적지 않아도 연결마다 `PRAGMA busy_timeout`을 5000ms로 설정하는데, DevCloud는 경로만 넘기고 있어 `modernc.org/sqlite`로 바꾸자 이 5초의 대기 시간이 사라졌다. 같은 인터페이스를 구현한다고 기본값까지 같지는 않았던 것이다.

현재 코드는 연결 풀에서 새로 여는 연결에도 설정이 적용되도록 드라이버의 DSN에 `?_pragma=busy_timeout(5000)`을 붙인다. [`modernc.org/sqlite`의 해당 버전 문서](https://pkg.go.dev/modernc.org/sqlite@v1.59.0#Driver.Open)에서 지원하는 설정을 확인할 수 있다.

### 배포하는 빌드 모드로 테스트하기

드라이버 교체와 함께 CI도 바꿔, 이제 모든 빌드와 테스트가 출하 모드인 `CGO_ENABLED=0`으로 돌도록 했다. 워크플로우 여섯 개가 설치하던 `libsqlite3-dev`, Dockerfile 두 개가 설치하던 `gcc/musl-dev/sqlite-dev`, 런타임 이미지의 `sqlite-libs`, 헤더를 설치하라던 문제 해결 문서까지 모두 지웠다.

당시 커밋 메시지에 남긴 문장이 이 사건을 잘 요약해 준다.

> Testing CGO_ENABLED=1 while shipping CGO_ENABLED=0 is how a binary that cannot open its own database passed every gate for two releases.

## 사건 2: 파일 하나만 빌드한 GoReleaser

### 증상

드라이버를 고치고 이틀 뒤 v1.0.0을 공개했는데, 이번에도 공개한 바이너리가 시작하자마자 죽으며 다음 메시지를 남겼다.

```
unknown service: s3
```

DevCloud의 서비스들은 `cmd/devcloud/imports.go`에서 blank import로 레지스트리에 자신을 등록하는데, `.goreleaser.yaml`은 **파일 하나**만 빌드하도록 설정돼 있었다.

```yaml
builds:
- id: devcloud
  binary: devcloud
  main: cmd/devcloud/main.go
```

`go build cmd/devcloud/main.go`처럼 파일을 지정하면 Go는 그 파일만 컴파일해 같은 디렉토리의 `imports.go`를 제외한다. 그래도 `main.go`가 `imports.go`의 심볼을 참조하지 않아 컴파일은 성공하므로, 서비스가 하나도 등록되지 않은 바이너리가 만들어졌다. v1.0.0의 아카이브 여섯 개와 Homebrew formula, 컨테이너 태그 네 개가 모두 이 결과물로 배포됐다.

### 게이트는 왜 통과했나

릴리즈 워크플로우에는 바로 이런 일을 막으려는 단계가 이미 있었고 주석까지 달려 있었다.

```yaml
- name: Build devcloud binary
  # Same build configuration as .goreleaser.yaml, so the 775 tests below
  # exercise the artifact this tag is about to publish.
  run: CGO_ENABLED=0 go build -o dist/devcloud ./cmd/devcloud
```

주석에는 GoReleaser와 같은 설정이라고 적혀 있었지만 실제로 일치한 것은 `CGO_ENABLED`뿐이었다. 게이트가 **패키지**를 빌드할 때는 `imports.go`가 포함돼 775개 테스트가 정상 바이너리를 상대로 통과한 반면, 사용자가 받은 바이너리는 한 번도 테스트한 적이 없었다.

### 수정

이를 고치려고 GoReleaser가 패키지를 빌드하도록 `main: ./cmd/devcloud`로 바꾸고 게이트도 GoReleaser 자체로 빌드하게 했다.

```yaml
- name: Build devcloud binary with GoReleaser
  uses: goreleaser/goreleaser-action@<pinned-sha>  # goreleaser-action v7
  with:
    distribution: goreleaser
    version: "~> v2"
    args: build --single-target --snapshot --clean --id devcloud --output dist/devcloud
```

이제는 게이트와 출하 과정에서 같은 도구에 같은 설정을 넘겨 빌드하므로, "같은 설정"이라는 설명에 의존하지 않아도 된다. 이 수정 커밋으로 v1.0.0 태그를 다시 만들어 배포했다.

## 공통 원인: 게이트가 다른 것을 검증했다

두 사건은 원인이 된 코드는 달랐지만 구조를 놓고 보면 같은 문제였다.

```
            게이트가 검증한 것                 사용자가 받은 것
사건 1   CGO_ENABLED=1 바이너리      ≠   CGO_ENABLED=0 바이너리
사건 2   go build ./cmd/devcloud     ≠   GoReleaser main.go 단일 파일
```

두 경우 모두 "게이트와 릴리즈는 같은 설정이다"라고 믿고 있었고 사건 2에서는 그 믿음을 주석으로까지 적어 두었다. 하지만 주석을 검사하는 장치는 없었으므로, 설정이 같다는 설명을 남기기보다 같은 명령을 실행하게 만드는 편이 확실했다.

## 사건 3: 버킷을 벗어나는 S3 키

릴리즈 문제는 아니지만, "검사가 엉뚱한 것을 지켰다"는 점에서 같은 계열의 사건이 v1.1.1에서 하나 더 있었다.

DevCloud의 S3는 객체를 `baseDir/<account>/<bucket>/<key>` 경로의 파일로 저장하고, 경로 탐색(path traversal)을 막기 위해 결합한 경로가 `baseDir` 아래에 있는지 검사하고 있었다.

그런데 `../victim/secret.txt` 같은 키를 결합하면 `baseDir/<account>/victim/secret.txt`가 되어 **자기 버킷을 벗어나면서도 `baseDir` 안에 머문다.** 따라서 기존 검사를 통과한 공격자는 다른 버킷이나 다른 계정의 객체를 읽고 덮어쓰고 지울 수 있었다. 여러 팀이 인스턴스 하나를 공유한다면 로컬 에뮬레이터에서도 실제 문제가 되는 결함이었다.

수정에 앞서 재현 테스트를 먼저 쓰고(RED), 사용자가 제어하는 모든 경로 구성 요소에 `filepath.IsLocal`을 적용했다.

```go
// objectPath returns the absolute filesystem path for the given object.
// Unlike safePath, the key may contain '/' (e.g. "photos/a.jpg") which is
// valid for S3 object keys. Containment under the bucket is still enforced.
func (fs *FileStore) objectPath(accountID, bucket, key string) (string, error) {
	// ...
	// The key gets IsLocal rather than validPathComponent because '/' is legal
	// in it. Checking the joined path against baseDir alone is not enough: a key
	// like "../victim/secret" leaves its own bucket while staying under baseDir.
	if !filepath.IsLocal(key) {
		return "", fmt.Errorf("invalid path component: %q", key)
	}
	// ...
}
```

Go 1.20에 추가된 `filepath.IsLocal`은 빈 문자열, `..`, `../x`, 절대 경로를 모두 거부하는데, 직접 짠 `Clean` + `HasPrefix` 조합보다 짧을 뿐 아니라 CodeQL이 `go/path-injection`의 차단 지점으로 인식한다는 장점도 있다. 같은 수정을 Lambda 코드 경로와 S3 버킷 디렉토리에도 적용하고 테스트를 추가했다.

다만 `IsLocal`이 확인하는 것은 경로 문자열뿐이라 파일시스템의 심볼릭 링크까지 따라가지는 않는다. 링크를 통한 접근은 별도로 고려해야 하며 정확한 검사 범위는 [Go 공식 문서](https://pkg.go.dev/path/filepath#IsLocal)에서 확인할 수 있다.

결국 사건 1, 2와 마찬가지로 검사 자체는 있었지만 범위가 맞지 않았던 것이고, `baseDir`뿐 아니라 <strong>테넌트(버킷)</strong>를 기준으로 경로를 검사했어야 했다.

## 체크리스트

세 사건을 겪은 뒤로 릴리즈할 때 지키고 있는 규칙을 정리해 보면 다음과 같다.

1. **출하하는 빌드 모드로 테스트한다.** `CGO_ENABLED`, 빌드 태그, `-trimpath` 같은 플래그가 릴리즈와 같아야 한다.
2. **게이트는 릴리즈 도구로 빌드한다.** "같은 설정"이라는 주석 대신 GoReleaser `build --snapshot`을 그대로 실행한다.
3. **바이너리가 시작되는지부터 확인한다.** 775개 테스트보다 먼저 `devcloud` 실행과 서비스 하나 호출이 성공해야 한다.
4. **드라이버를 바꾸면 기본값을 비교한다.** 인터페이스가 같아도 타임아웃, pragma, 풀 크기 같은 숨은 기본값은 다를 수 있다.
5. **경로 검사는 가장 좁은 경계에 건다.** 전체 루트가 아니라 테넌트 단위로 검사해야 한다.

## 마치며

이제 릴리즈 검사는 CGO 없이 패키지를 빌드한 결과물로 스모크 테스트를 실행하며 SQLite의 대기 시간도 DSN에 명시한다. S3 경로는 버킷 안에 머무는지 검사하되, `IsLocal`이 확인하지 않는 심볼릭 링크를 통한 접근은 운영 환경에서 함께 고려해야 한다.

전체 소스 코드는 [github.com/skyoo2003/devcloud](https://github.com/skyoo2003/devcloud)에서 확인할 수 있다.
