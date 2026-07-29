# TG-5A §0-C 감사 종료 4건 — 보강 증거

- 작성: 2026-07-29 · Claude 구현선 · **자체 검증**(독립 감사 대기)
- 대상: 인수인계 §0-C(Codex BLOCKED 판정)의 종료 조건 4건 — **한 단위로 구현·제출**(오너 지시)
- 착수 전 선언: `docs/03-verification/T5-TG-5A-AUDIT-CLOSURE-WIRING-2026-07-29-ko.md`
- 오너 고정 조건 준수: 정규식·한국어 목록 확대 0건 / 모르는 project 는 null / grant 실버튼·철회 관통 /
  의미 결합 단일 계약 / 4건 일괄 제출 / 게이트 PASS 전 TG-5B 미진입

---

## 1. 4건의 닫힘 상태

| # | §0-C 종료 조건 | 상태 | 구현 |
|---|---|---|---|
| 1 | 실제 project 신분 | **닫힘**(자체 검증) | `currentPlaceOf(workingState)` — G 행렬이 확정한 「지금 자리」 사실의 **단일 계산 자리**(프롬프트 `지금 자리:` 줄과 같은 원천). `anchorFor`·`supplyAdmissionSources`·`buildTurnFacts.project`·grant scope 전수 교체. **자리를 모르면 null — 추측하지 않는다** |
| 2 | 자유문 경계·현재 지시의 의미 결합 | **닫힘** | 단일 계약 = `FACT_ATOMS`(turn-facts 가 사실을 **생산할 때 쓰는** 원자 어휘) + 추출 **모델**이 자유문을 원자에 결합(`cell.binding`) + 반대 지시는 추출기 관계 판정을 `recordCorrection` 으로 지속 → `judgeDirective` 조회. admission 은 순수·동기 유지(핫패스 모델·정규식 0) |
| 3 | bounded grant 생산·철회·공통 대상 신분 | **닫힘** | 승인 카드 [이번만 승인]·[승인하고 24시간 계속 허용] 실버튼(`grantKind`) → 소비 시 원장 기록 → 재사용은 기존 매듭 `ctx.허락한손` → `/grants` 목록·[철회] 버튼. 대상 신분은 `grantTargetOf(args)`(target/path/to) 하나 — 도구 종류 분기 없음 |
| 4 | 확인 원장 오류의 정직한 승계 | **닫힘** | `ConfirmationStore`: ENOENT 만 정상 부재, 그 외 읽기 오류는 **던짐**, 손상 줄은 세어 `degraded:true`(정상 줄은 사용, 바이트 보존). 스냅샷 경계가 degraded 를 `trace.status` 로 승계 |

## 2. 오너 지정 검증 6종

| 검증 | 결과 |
|---|---|
| **실제 OpenAI·Anthropic 어댑터** | `makeProviderModelClient` 실코드가 실제 wire 형식(chat/completions·`/v1/messages`)의 로컬 서버를 관통(OAuth 가짜 서버 선례와 같은 격리 계약). 같은 뜻(원자 결합 매칭)·반대 뜻(contradiction 관계 지속)·무관한 뜻(모르는 원자 비결합·비차단) 3방향 × 2계열 전부 통과. **한계**: 라이브 API 호출은 미수행 — Anthropic 자격이 이 기계에 없어 두 계열 쌍 검증이 불가하다(저장 연결은 chatgpt_oauth 하나). 라이브는 이중 모델 검증 계획의 실행 조건에 따른다 |
| **서로 다른 프로젝트 2개** | 생산 관통: 터미널 영수증(subjectOf)→workingState 자리→관찰 anchor→세포→admission. 자리A 세션은 원리A 만 읽고 원리B 는 **조회 자체를 안 한다**(scopeFiltered=1). 자리 미확정 첫 턴은 project=null → `scope_unknown`(추측 0) |
| **승인·재사용·철회 버튼** | HTTP E2E: [계속 허용]→발송 1→원장 bounded(범위=실제 자리)→같은 요청 **재확인 0·발송 2·`grantsReused` 표면 고지**→[철회]→재확인 부활·무단 발송 0. [이번만]은 원장 0건·재확인 유지. 자리 미확정이면 [계속 허용]을 눌러도 권한 미생성 |
| **저장 장애 주입** | 원장 자리에 디렉터리(EISDIR)→`snapshot()` 던짐→admission trace `degraded`. 손상 줄+정상 줄→정상분 사용+`degraded:true`+바이트 보존. 복구 후 즉시 깨끗(손상 비캐시) |
| **전체 회귀** | **1,329건 통과 · 실패 0** (직전 1,318) |
| **고아 계약** | 통과 — 새 export(`FACT_ATOMS`·`grantTargetOf`·`recordCorrection` 등) 전부 소비, 유예 추가 0건 |

## 3. 보강 전 실패 실측 (v3.1 §19.1 L2-①)

기준선 `b7ffa6a` worktree 에 기준선 API 만 쓰는 축소판을 넣어 실행했다
(재현 파일: `BEFORE-0C-REPRO.test.js.txt` — 이 폴더에 보존).

| 검사 | 보강 전(`b7ffa6a`) | 보강 후(현재) |
|---|---|---|
| §0-C-1 관찰 project=실제 자리 | **실패** (store.dir 였다) | 통과 |
| §0-C-2 같은 뜻 경계 매칭 | **실패** (`boundary_not_satisfied`) | 통과 |
| §0-C-3 `/grants` 존재 | **실패** (라우트 없음) | 통과 |
| §0-C-4 읽기 불능이 던짐 | **실패** (빈 원장 위장) | 통과 |

**4/4 실측.** stash 방식은 신규 파일이 남아 import 붕괴만 보여서 쓰지 않았다(전 세션 정정 준수 — 측정은 worktree 로만).

## 4. 게이트·성능

- 게이트: **BLOCKED 1건** — CPU 53.8s/40s. 그 외 전 항목 통과(후속 표현 15 유지 · 의존성 0).
- 이번 변경 A/B(같은 머신 연속): `b7ffa6a` **52.21s**(1,318) ↔ 현재 **53.42s**(1,329).
  +1.21s 는 새 검사 11건(서버 6회 기동 + wire 서버 2계열)의 시험 자체 비용이다 — 핫패스 회귀 아님.
  admission 핫패스에 추가된 것은 원자 문자열 비교(동기)뿐이다. 조용한 환경 재측정은 여전히 종료 조건.
- 지시문 예산: 사실 어휘(원자 8개·원자당 60자 상한)와 고정 지시문(1000자 상한)을 **갈라서** 검사
  (`tcell-extraction-wire.test.js` — 어휘가 대본 비대를 가리지 않게).

## 5. fixture 폴백 전수 (§19.1 L2-③)

이번 변경 주변: `supplyAdmissionSources`·`anchorFor`·grant 경로는 `deps` 폴백을 **새로 만들지 않았다.**
서버의 기존 `deps.tools ?? demoTools()` 등은 시험 주입용이며, 이번 시험은 전부 실제 저장소
(`TCellRegistry`·`TCellObserver`·`ConfirmationStore`·세션 파일)를 쓴다. 라이브가 데모로 새는 신규 지점 0.

## 6. 정직한 한계와 설계 결정 (감사가 먼저 볼 것)

1. **반대 지시의 의미 판정은 다음 턴부터 유효하다.** 판정은 모델이 있는 자리(턴 후 추출)에서
   내려지고 correction 으로 지속된다. 같은 턴 안에서는 글자 부정(`!문장`)만 잡힌다 — 같은 턴의
   사용자 원문은 모델이 직접 보므로(shadow 에서 영향 0) 사용자 체감 왜곡은 없다. TG-5B 주입 전에
   이 지연이 문제인지 재평가한다.
2. **원자 어휘는 8개다** — turn-facts 가 실제로 생산하는 사실만. 생산되지 않는 원자는 죽은
   어휘이므로 넣지 않았다. 어휘 확장은 turn-facts 의 생산 확장과 함께만 유효하다.
3. **[계속 허용]은 24시간 session 하나다.** persist(영구)는 TG-5C 표면 몫으로 남겼다 —
   원장·조회는 이미 지원한다(`GRANT_REUSABLE_KINDS`).
4. **grant 재사용은 실제 승인 흐름을 바꾼다**(shadow 밖 P-OP 영역). 이는 T-cell 영향이 아니라
   절대 원칙 0-A-1 「bounded grant 안의 반복 실행은 다시 묻지 않는다」의 최초 배선이며,
   오너가 이번 지시로 명시 승인했다.
5. `correction` 철회(사용자가 반대 지시를 무른 경우)는 TG-5C 표면 몫 — `withdrawn:true` 필드를
   admission 이 이미 존중한다(계약만 먼저 배선).

## 7. 판정

- §0-C 4건: **자체 검증 완료 · 독립 감사 대기.**
- 남은 차단: 조용한 환경 공식 gate 재측정(행렬 10) 하나.
- TG-5B: 진입 금지 유지.
- 운영 순환 칸: ②(실제 자리 사실) · ⑤(bounded grant 실경계) · ⑥(grant 원장·확인 원장 정직성).
  ⑨ 도달: **승인 카드 버튼·허용 범위 목록·철회 버튼·재사용 고지가 웹 표면에 실제로 추가됐다**
  (`index.html` — 이 부분은 shadow 가 아니라 P-OP 표면이다).
- 모델 판단 침범: 없음 — 의미 판정을 정규식·목록으로 대체하지 않고 모델(추출기)에 두었다.
