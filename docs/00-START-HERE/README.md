# 여기서 시작한다 — 현재 NX2 세션

상태: `CURRENT_ENTRY · NO_DUPLICATE_PRODUCT_TRUTH`

이 문서는 현재 상태를 복제하지 않고 정본으로 안내한다.

## 1. 먼저 기계 사실을 고정한다

```bash
pwd
git status --short --branch
git rev-parse HEAD
node --version
```

공식 작업실은 `/Users/jyp/Developer/t5-nx2-current`, 브랜치는 `codex/t5-nx2-current`다.
다르면 구현을 시작하지 말고 `git worktree list`와 `T5-NX.md`를 먼저 대조한다.

## 2. 읽는 순서

1. `../../AGENTS.md`
2. `../../T5-PRODUCT.md`
3. `../../T5-NX.md`
4. `../../티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md`

현재 Gate와 직접 연결된 evidence·source·test만 그다음 읽는다. 1~6차 문서는 완료 역사이며,
`T5-NX3.md`와 Presentation Studio는 현재 Gate를 자동으로 열지 않는다.

## 3. worktree 준비와 검사

```bash
npm ci --prefix refoundation
npm run refoundation:check
npm run refoundation:integration
npm run refoundation:mutation
```

짧은 검사와 제품 통합을 한 번에 실행하려면 `npm run refoundation:ci`를 사용한다. localhost·macOS sandbox
검사가 권한 오류로 실패하면 제품 회귀로 확정하기 전에 실제 로컬 권한에서 같은 명령을 재실행한다.

## 4. 절대 경계

- 사용자에게 멈춰 묻는 기본 경계는 비밀 입력, 백업 없는 파괴, 새 상대 첫 전송, 돈이다.
- 실제 HOME·계정·자격증명으로 자동 시험하지 않는다.
- source·package·설치본·플랫폼 PASS를 서로 이전하지 않는다.
- 테스트 수·호출 수·코드 존재를 사용자 목적 완료로 보고하지 않는다.
- 현재 Gate 밖 기능과 새 정본을 편의상 만들지 않는다.

현재 작업은 `T5-NX.md` 첫머리의 한 Gate만 따른다.
