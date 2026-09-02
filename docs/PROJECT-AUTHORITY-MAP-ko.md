# GPAO-T5 프로젝트 권위 지도

상태: `CURRENT_NX2`

- 공식 개발 작업실: `/Users/jyp/Developer/t5-nx2-current`
- 공식 개발 브랜치: `codex/t5-nx2-current`
- 현재 제품 정본: `T5-NX.md`
- 제품 정의: `T5-PRODUCT.md`
- 작업 규율: `AGENTS.md`

## 1. 권위 순서

| 순서 | 책임 | 문서·사실 |
|---:|---|---|
| 1 | 제품 목적 | `T5-PRODUCT.md` |
| 2 | 현재 Gate·완료·미달 | `T5-NX.md` 첫머리와 해당 Gate 본문 |
| 3 | 현재 Gate 상세 계약 | `티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md` |
| 4 | 실제 상태 | 현재 worktree의 cwd·branch·HEAD·`git status`·실행 결과 |
| 5 | 완료 역사 | `T5-REFOUNDATION.md`, `T5-SECOND-COMPLETION.md`, `T5-THIRD-*`, `T5-FOURTH-COMPLETION.md`, `T5-FIFTH-COMPLETION.md`, `T5-SIXTH-COMPLETION.md` |
| 6 | 연구·후속 계획 | `티파이브개발 연구/`, `T5-NX3.md` |

문서와 Git이 다르면 구현을 시작하지 않는다. 현재 상태를 고칠 때는 새 인수인계나 새 정본을 만들지 않고
위 기존 정본의 잘못된 current 표기만 교정한다.

## 2. 현재 개발선

현재 Gate는 `NX2-6 NV-HQ — SINGLE OWNER ACTUAL CONSOLE WAVE`다. NV-3~7 기술 개발은 완료됐지만
실제 계정의 본문·첨부·전송·블로그 외부 effect는 NV-HQ 전에는 PASS가 아니다.

다음은 현재 제품 완료에 합산하지 않는다.

- NX2-7 Experience Promotion
- NX2-HQ whole human qualification
- NX2-PS Presentation Studio
- NX3 Developer & Connection Intelligence
- package·설치·서명·공증·Windows 물리 자격

## 3. 작업실 분류

| 작업실 | 역할 |
|---|---|
| `/Users/jyp/Developer/t5-nx2-current` | 현재 canonical NX2 개발선 |
| `/Users/jyp/Developer/t5-windows` | canonical 전환 전 동일 계보 보존선 |
| `/Users/jyp/Developer/t5-nx2-development-plan` | NX2 계획 형성 역사 |
| `/Users/jyp/Developer/t5-sixth` | 6차 완료 역사 |
| `/Users/jyp/Developer/t5-p-op` | 0.3.1/Refoundation 보존 작업선 |
| `/Users/jyp/Developer/t5-presentation-studio` | NX2-HQ 뒤 감사할 후속 후보, 현재 제품 아님 |

다른 worktree의 PASS·미커밋 변경·artifact를 현재선으로 이전하지 않는다. 필요하면 exact commit을 현재 Gate의
반대시험과 함께 감사한 뒤 명시적으로 승격한다.

## 4. Git과 배포 진실

- 커밋 전 `git status`와 대상 diff를 확인하고 경로를 명시해 stage한다.
- 현재 branch는 upstream과 clean한 상태로 유지한다.
- source PASS는 package·설치본·macOS·Windows x64·Windows ARM64 PASS가 아니다.
- 동일 version 문자열보다 exact source commit·payload digest·서명·설치 readback을 우선한다.
- 현재 Gate 종료 뒤에도 최종 인간 HQ 전에는 deployable candidate라고 부르지 않는다.
