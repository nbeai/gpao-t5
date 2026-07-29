# TG-5A 종료 행렬 — 착수 전 배선 선언

- 작성: 2026-07-29 · Claude 구현선 · 착수 **전** 작성(사후 정당화 아님)
- 근거: `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md` §0-A (5) 「대응 절차」
  — 계약마다 세 줄을 먼저 적는다: **소비 지점 / 그 지점을 지나는 검사 / 배선 안 하면 이유와 시점**.
  세 번째가 비면 착수하지 않는다.

이번 보강에서 만드는 계약은 **전부 이번 커밋에서 배선한다.** 유예 항목은 없다.
아래 표의 「미배선 사유·시점」이 모두 `없음(이번 커밋에서 배선)`인 것이 이 문서의 요점이다.

## 착수 전 실측 — 무엇이 실제로 안 붙어 있었나

행렬을 닫기 전에 코드에서 직접 확인한 사실이다. 추정이 아니다.

| # | 실측 | 위치 |
|---|---|---|
| 1 | `buildTurnFacts(receipts: ledger.entries, ledgerStart: 0)` — 세션 **누적 원장 전체**가 이번 턴 사실이 된다. 세 턴 전 실패가 영원히 `실패 직후` 로 매치된다 | `turn.js:405-410` |
| 2 | `contradicts.push(지시.statement)` + `충돌판정` 의 문장 동일 비교 — 사용자가 **세포와 같은 원칙**을 다시 말하면 충돌로 거절된다 | `turn-facts.js:72`, `tcell-admission.js:297` |
| 3 | `tierKnown: TIER.includes(intent.authorityBoundary)` — `intent.js:32` 의 **정규식 추정**이 확정 권한으로 쓰인다. admission 은 모델 호출 **전**에 도는데 계획 역할까지 판정한다 | `turn-facts.js:90` |
| 4 | `grantSnapshotFromSession` 이 `session.pendingApprovals` 를 읽는다 — **누르기 전의 승인**이 grant 원장 노릇을 한다. 게다가 제품의 실제 `grantScope.kind` 는 `once/session/persist` 인데 admission 은 `'bounded'` 를 요구한다 → **어떤 실제 승인도 이 경로를 통과할 수 없다** | `tcell-store.js:396-411`, `contracts.js:179`, `turn.js:698` |
| 5 | `runChannelInboundTurn` 은 `ctx.admissionSources` 를 설정하지 않는다 → 채널 경로는 admission 을 아예 안 지난다. `runTurn` 의 승인(A)·거절(B) 분기는 admission 블록보다 **앞에서 return** 한다 → 승인·거절도 안 지난다 | `server.js:1501-1537`, `turn.js:278·312 vs 404` |
| 6 | `observeTurn` 은 `anchor` 파라미터를 받지만 호출부가 안 넘긴다 → 모든 관찰 anchor 가 null → 추출된 세포 anchor 도 null. **관통 시험은 `원리.anchor = {project: dir}` 를 손으로 심어** 이 미배선을 가리고 있었다 | `server.js:381`, `tcell-extractor.js:215`, `test/tcell-admission.test.js:226` |
| 7 | registry 불변 검사가 admission **후**에 두 번 읽어 비교한다 — 실행 전 바이트가 없다 | `test/tcell-admission.test.js:249·284` |
| 8 | A2 무grant 관통이 `authority / authorityUnknown / boundary / conflict` **네 사유 중 아무거나** 통과시킨다 — 권한 경계를 증명하지 못한다 | `test/tcell-admission.test.js:319` |

## 계약별 세 줄

| 계약 | ① 소비 지점 | ② 그 지점을 지나는 검사 | ③ 미배선 사유·시점 |
|---|---|---|---|
| `TURN_FACT_WINDOWS` · 고정 시간창 턴 사실 | `turn.js` 원리입장계산 → `buildTurnFacts({ledgerWindow})`. 창 밖 영수증은 사실이 되지 않는다 | 관통 `오래된 실패는 이번 턴 사실이 아니다`(3턴 전 실패 → `실패 직후` 미매치, 세포 거절) | 없음 — 이번 커밋에서 배선 |
| `judgeDirective` · 지시 관계 3값 | `tcell-admission.js` 하나판정 → `충돌판정` 이 3값을 소비. `reinforces` 는 거절 사유가 아니다 | 관통 `같은 지시는 충돌이 아니다`(사용자가 세포와 같은 원칙 재발화 → 입장 유지) + `반대 지시는 충돌이다` | 없음 — 이번 커밋에서 배선 |
| `ADMISSION_STAGES` · pre_model / post_plan | `turn.js` 두 자리: ① 모델 호출 앞(맥락 역할만, `tierKnown:false`) ② `buildActionPlan` 뒤·실행 앞(권한·값 역할, 계획 tier) | 관통 `계획 역할은 모델 전에 입장하지 못하고, 계획 뒤 유효 grant 에서만 입장한다` | 없음 — 이번 커밋에서 두 자리 모두 배선 |
| `grantSnapshotFromLedger` · 실제 부여 권한 원장 | `tcell-admission.js` 권한판정 ← `server.js` 가 **소비된 승인**만 `session.grants` 에 기록 | 관통 `once 승인은 소비돼도 grant 가 아니다` · `session/persist 승인 소비 뒤 계획 역할이 입장한다` · `철회하면 즉시 못 들어온다` | 없음 — 이번 커밋에서 배선. `grantSnapshotFromSession` 은 **삭제**한다(대체 아님, 제거) |
| `observationAnchor` · 관찰 anchor 생산 | `server.js` 의 관찰 호출 **전수**(turn·userRequest·correction·automationResult) → 추출기 `근거자리` → 세포 `anchor` → admission 범위판정 | 관통 `수동 주입 없이 실제 생산 경로만으로 범위가 맞는다`(시험에서 `원리.anchor` 수동 주입 **삭제**) | 없음 — 이번 커밋에서 네 경로 전부 배선 |

## 전수 훑기 약속(실패패턴 대응)

`§0-A (5)` 의 「지적된 인스턴스만 고치지 말고 같은 모양을 전부 훑는다」에 대한 이번 범위의 목록:

- **관찰 생산자 4개 전수**: `observeTurn` 만 고치고 `observeUserRequest`/`observeCorrection`/`observeAutomationResult` 를 두지 않는다.
- **턴 진입점 4개 전수**: `/turn`(웹) · `/turn/stream` · 승인 · 거절 · 채널 인바운드가 **같은 준비 경계** 하나를 지난다.
- **판단 재료 필드별 조회/주장 전수 점검**: 제출 전에 `admission` 이 쓰는 모든 필드를 「조회한 사실 / 호출자 주장」으로 분류해 출력하고 증거에 첨부한다.

## 필독 문서를 다 읽은 뒤 추가된 제약 (2026-07-29 보강)

착수 선언을 먼저 쓴 뒤 `AGENTS.md` 필독 순서를 전부 읽었다. **이번 범위를 실제로 바꾸는 제약
일곱 개**가 나왔다. 아래는 선언에 추가되는 구속이며, 읽기 전 계획으로는 놓쳤을 것들이다.

| # | 정본 | 이번 범위에 대한 구속 |
|---|---|---|
| 1 | v3.1 §17 성능 기준선 + 실행 보드 동결 manifest | 게이트 CPU 기준선 40s 는 `scripts/gate-baseline.json` 에 있고 **자동 갱신 금지**. 동결 기준선 `6ce88bf` 의 조용한 환경 실측이 **39.2s / 40s** 였다 — 여유는 0.8s 뿐이다. 따라서 내 몫 +4.7s 제거는 "나중에 하면 좋은 것"이 아니라 **차단 해제의 필수 조건**이다 |
| 2 | T-cell 명세 §19 성능 예산 | `turn hot path 추가 동기 CPU: p95 5ms 이하`. admission 준비가 이 예산 안에 들어와야 한다. 정본 수치가 이미 있었고 내 구현은 이것을 초과했다 |
| 3 | v3.1 §19.1 L2(슬라이스 완료 조건) | 제출 증거에 **세 가지**를 남긴다: ① 새 검사가 **수정 전 코드에서 실패**하는 것을 보고 **건수**를 적는다 ② 실제 서버 라이브 실측 ③ **`deps.X ?? demoY()` fixture 폴백 전수 확인**(이번 변경 주변에서 라이브가 데모로 새는 자리) |
| 4 | v3.1 §19.1 L3 고위험 5종 | TG-5A 는 **권한 경계**와 **기억 승격** 둘에 걸린다 → Phase 경계까지 미루지 않고 이 슬라이스에서 깊은 감사 대상이다 |
| 5 | 구조 원칙 §2-B·§2-C·§5 | 매듭은 **코드로 확인한 뒤** 주장한다(논리로 먼저 주장하면 없는 결합을 만든다). 두 번째 현상에서 확인된 매듭은 **같은 날 `scripts/gate.mjs` 에 검사 한 줄**을 늘리고, **일부러 깨뜨려 걸리는지 본 뒤** 원복한다 |
| 6 | T-cell 명세 §6 저장 규칙 + 흡수보충 §8 Scope Isolation | `profile/project/workspace 경계를 넘는 조회는 기본 차단`. 현재 `buildAdmissionSnapshot` 은 `observer.getByRefs` 로 세션 경계를 넘는다. **행렬 6(anchor 생산)이 붙어야 project 경계 필터가 비로소 가능해진다** — 두 항목은 같은 매듭이다 |
| 7 | T-cell 명세 §21 금지 구현 | `사용자가 명시한 선호를 같은 범위에서 다시 확인받기` 가 **금지 구현**으로 명시돼 있다. 지금 코드는 같은 지시를 **충돌로 거절**하므로 그보다 나쁘다 — 행렬 2 는 개선이 아니라 금지 위반의 시정이다 |

### 정본 대비 이름이 다른 검사 파일 (감사 대비 기록)

명세 §18 의 필수 테스트 파일 목록과 현재 파일명이 다르다. 대부분은 같은 계약을 다른 이름으로
담고 있다(`tcell-contracts` = core+observation · `tcell-registry`+`tcell-observer` = store ·
`tcell-extractor`+`tcell-extraction-wire` = extraction · `tcell-replay-engine` = replay+scoring).
**다만 `tcell-turn-integration`·`tcell-authority-invariants` 두 이름은 독립 파일이 없고**
`tcell-admission.test.js` 의 관통·권한 시험이 그 역할을 대신한다. 이름 차이는 명세 §22
「구현 중 조정 가능」에 속한다고 판단하지만, 판단 자체를 감사가 볼 수 있게 여기 남긴다.

### 보고 형식 구속

- 작업지시서 §6 슬라이스 경계: TG-5A 는 shadow 라 **사용자 문장 하나가 다르게 끝나지 않는다.**
  그러므로 이 작업을 **슬라이스 완료로 보고하지 않는다** — TG-5 단계의 구현 단위다.
- 감사 계약 §2: 자체 검증을 독립 감사 통과로 표현하지 않는다.
- 운영 순환 보고 형식: 채운 칸은 **② 현재 맥락·대상 · ⑤ 위험·승인 경계 · ⑥ 실행 원장**,
  ⑨ 도달 확인은 **해당 없음**(shadow — 사용자 표면에 아무것도 도달하지 않는 것이 계약이다).

## 이 문서의 종료 조건

제출 시 이 표의 ②열이 **실제 실행되는 검사 이름**으로 채워져 있고, ③열이 전부
`없음(이번 커밋에서 배선)` 이어야 한다. 하나라도 유예로 바뀌면 그 사유와 시점을
`test/tcell-no-orphan-contracts.test.js` 의 유예 원장에 적는다.
