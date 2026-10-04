# Devlog in the SKY - Yet Another Developer's Blog

## 로컬 미리보기

```sh
git submodule update --init --recursive
hugo server --bind 127.0.0.1 --port 1313
```

한국어 홈은 <http://localhost:1313/ko/>, 영어 홈은 <http://localhost:1313/en/>입니다.
Git 서브모듈로 고정한 Hextra v0.13.0을 사용합니다. Node나 별도 웹폰트 서비스 없이 Hugo Extended로 빌드합니다.

## 빌드와 검증

GitHub Actions는 Hugo Extended **0.146.0**을 사용하며, 로컬 **0.166.0**에서도 검증했습니다.

```sh
hugo version
hugo --environment production --gc --minify --destination /tmp/devlog-public
```

정확한 CI 버전을 확인할 때는 Hugo 공식 릴리스의 0.146.0 Extended 실행 파일로 같은 빌드 명령을 실행하세요.
두 버전은 점이 포함된 일부 ACOR 글의 경로를 다르게 생성하므로, 공개 주소 검증은 CI 버전으로 수행합니다.
게시글 파일이나 기존 댓글 식별자는 변경하지 않습니다.

홈과 검색 진입 페이지는 `layouts/`, 본문과 코드 색상은 `assets/css/custom.css`에서 조정합니다.
테마 내부 파일 대신 사이트 템플릿으로 제목 앵커, 코드 공백과 복사, 태그 페이지, 댓글과 RSS 호환성을 유지합니다.
기존 PaperMod 서브모듈은 롤백을 위해 남겨 두었습니다.
