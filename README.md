# GPAO-T5

Copyright © 2026 YOON. All rights reserved.

This repository is private and UNLICENSED. Third-party components retain their original licenses; see
[COPYRIGHT](COPYRIGHT), [NOTICE](NOTICE), and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

상태: `CURRENT_NX2_DEVELOPMENT_ENTRY`

현재 공식 개발 작업실은 `/Users/jyp/Developer/t5-nx2-current`, 브랜치는 `codex/t5-nx2-current`다.
이전 `/Users/jyp/Developer/t5-windows` 작업실은 같은 계보의 보존선이며 현재 구현 진입점으로 사용하지 않는다.

## 처음 읽는 순서

1. `AGENTS.md` — 작업 규율과 현재 개발선
2. `T5-PRODUCT.md` — 변하지 않는 제품 정의
3. `T5-NX.md` — 현재 Gate와 제품 상태의 최상위 정본
4. `티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md` — 현재 NX2 Gate의 상세 계약

`T5-REFOUNDATION.md`, `T5-SECOND-COMPLETION.md`, `T5-THIRD-*`, `T5-FOURTH-COMPLETION.md`,
`T5-FIFTH-COMPLETION.md`, `T5-SIXTH-COMPLETION.md`는 완료 역사다. 현재 범위를 열지 않는다.
`T5-NX3.md`는 후속 계획이며 NX2-HQ·Presentation Studio 종료와 오너 개통 전에는 제품 구현 근거가 아니다.

## 현재 Gate

```text
NX2-6 NV-HQ — SINGLE OWNER ACTUAL CONSOLE WAVE
```

NV-3~7은 기술 개발과 격리 자격을 마쳤다. 실제 오너 계정의 메일 본문·첨부·전송과 블로그
초안·Preview·저장/예약/발행·공개 URL 재확인은 한 번의 NV-HQ에서만 판정한다.

## 개발 환경

- Node.js `>=22`; 현재 CI는 Node 24를 사용한다.
- 제품 source·UI·검사·패키지 코드는 `refoundation/` 아래에 있다.
- runtime dependency는 `refoundation/package-lock.json`으로 고정한다.
- 새 worktree는 먼저 dependency를 설치해야 한다.

```bash
git status --short --branch
git rev-parse HEAD
npm ci --prefix refoundation
npm run refoundation:check
npm run refoundation:integration
npm run refoundation:mutation
# 전체 연속 검사
npm run refoundation:ci
```

제품 실행:

```bash
npm start
```

## 판정 경계

- source PASS, package PASS, installed-product PASS, macOS PASS, Windows x64 PASS, Windows ARM64 PASS를 합치지 않는다.
- 자동 검사 성공은 실제 Console 인간 HQ를 대신하지 않는다.
- 설치·서명·공증·staple·upgrade·rollback·uninstall은 exact candidate release Gate에서 별도로 확인한다.
- 빌드·상태·비밀은 source tree에 두지 않는다.
- 현재 사실을 보고할 때는 항상 cwd·branch·HEAD·dirty 여부·artifact identity를 함께 적는다.

현재 세부 상태는 README에 복제하지 않는다. `T5-NX.md` 첫머리와 실제 Git이 유일한 현재 판정이다.
