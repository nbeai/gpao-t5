# TG-5A 종료 행렬 — 보강 증거

- 작성: 2026-07-29 · Claude 구현선 · **자체 검증**(독립 감사 대기)
- 대상: `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md` §0 의 TG-5A 종료 행렬 10건
- 착수 전 선언: `docs/03-verification/T5-TG-5A-CLOSURE-PRE-WIRING-DECLARATION-2026-07-29-ko.md`
- 판정 표기 규율(감사 계약 §2): 아래 수치는 전부 **구현자 자체 검증**이다. 독립 통과가 아니다.

---

## 1. 행렬 10건의 현재 상태

| # | 종료 조건 | 상태 | 어디서 닫혔나 |
|---|---|---|---|
| 1 | 누적 원장이 아니라 고정 시간창의 턴 사실만 | **닫힘** | `turn-facts.js` `TURN_FACT_WINDOWS`(직전 턴 하나) · `turn.js` `원장창()` · 서버가 `turnLedgerStart`·`prevTurnLedgerStart` 공급 |
| 2 | 지시 관계 3값 · 같은 지시는 충돌 아님 | **닫힘** | `tcell-admission.js` `judgeDirective()` · admission 이 `contradicts` 일 때만 거절 |
| 3 | 모델 전 맥락 역할 / 계획 뒤 권한·값 역할 분리 | **닫힘** | `STAGE_ROLES` 두 집합 · `turn.js` 가 **두 자리**에서 호출 · `등급판정()` 이 pre_model 에서 `tierKnown:false` |
| 4 | pending 이 아니라 실제 부여 권한 원장 | **닫힘** | `grantSnapshotFromSession` **제거** → `grantFromConsumedApproval`+`grantSnapshotFromLedger` · 서버가 소비 시점에 기록 |
| 5 | 웹·채널·승인·거절 공통 준비 경계 | **닫힘** | `supplyAdmissionSources()` 단일 자리 · 승인/거절 분기 **앞**으로 admission 이동 · 채널 경로 배선 |
| 6 | 관찰 생산 경로가 anchor 저장 | **닫힘** | `anchorFor()` + 관찰 생산자 **4개 전수**(turn·userRequest·correction·automationResult) |
| 7 | registry 실행 **전** 바이트 ↔ 실행 후 바이트 | **닫힘** | 관통 시험이 서버 시작 전에 `실행전바이트` 캡처 |
| 8 | A2 무grant 는 정확히 권한 사유 | **닫힘** | 실제 A2 계획을 만들도록 시험 수정(`slack.post`) · 사유 4개 허용 → 권한 하나 |
| 9 | 반대시험 묶음 | **닫힘** | `test/tcell-admission-closure.test.js` 10건 |
| 10 | 조용한 환경 공식 gate PASS + 문서 동기화 | **미완** | 게이트 CPU 만 남음(아래 §3) · 문서는 이 커밋에서 동기화 |

---

## 2. 필드별 「조회 / 주장」 전수 점검 (§0-A (5) 요구)

손으로 적은 목록은 다음에 또 어긋나므로 **소스에서 뽑았다.**

### 저장소 조회로 확인하는 것 — 호출자가 뭐라 하든 무시한다

```
input.principleStore    ← id                                    (세포 본문)
input.evidenceStore     ← cell.trace.observationRefs[]           (근거 존재)
input.confirmationStore ← requestFacts.confirmationRefs[id]      (사용자 확인)
input.grantStore        ← authorityFacts.grantRef                (부여된 권한)
```

네 조회 모두 `조회()` 를 지나며, **부재와 오류를 구분**한다(오류는 `degraded`).

### 호출자가 주는 재료 — 전부 `turn-facts.js` 가 **사실에서 유도**한다

| 필드 | 어디서 왔나 | 주장인가 |
|---|---|---|
| `requestFacts.project` | `ctx.workspaceId` = 서버의 `store.dir` | 사실(서버가 아는 경로) |
| `requestFacts.subject` | `workingState.subjects` 중 **이번 턴** 것 | 사실(턴 결과에서 유도) |
| `requestFacts.facts` | `ledgerWindow.previousTurn` = 실제 영수증 | 사실(원장) |
| `requestFacts.directives` | `memorySuggestion`(모델 제출 or 정규식) | **구조화 신호** — 원문 추측 아님 |
| `requestFacts.confirmationRefs` | `session.principleConfirmations` | 사실(세션 저장) |
| `authorityFacts.actionTier` | `plan.needsApproval[].tier` = **커널 판정** | 사실(post_plan 에서만) |
| `authorityFacts.tierKnown` | 계획 유무 | 사실 — pre_model 은 항상 `false` |
| `authorityFacts.estimatedTier` | `intent.authorityBoundary`(정규식) | **추정임을 이름이 말한다.** 권한을 열지 않는다 |
| `authorityFacts.actionKind/target` | `plan.toolsToUse[0]` · `sendArgs[action].target` | 사실(post_plan 에서만) |
| `authorityFacts.grantRef` | 위 세 요소로 만든 **조회 키** | 키는 주장 — 조회된 grant 의 세 요소를 **다시 대조**한다 |

**같은 사실을 두 곳에서 계산하는 자리**: 없음. 조회 키 규칙만 두 층에 있고
(`turn-facts.grantKey` / `tcell-store.grantLedgerKey`), 그 둘이 같은 값을 내는지
`행렬 4: 조회 키는 admission 과 원장이 같은 규칙으로 만든다` 가 검사한다.

### fixture 폴백 전수 확인 (v3.1 §19.1 L2-③)

이번 변경 주변의 `deps.X ?? demoY()` 지점:

```
tcellObserver / tcellRegistry / confirmationStore  →  deps.X ?? new C(store.dir)
```

셋 다 **데모 fixture 가 아니라 실제 저장소 클래스**로 떨어진다. 라이브가 데모로 새는 자리는
이번 범위에 없다. `deps.model ?? new StubModelClient()` 는 admission 경로를 지나지 않는다.

---

## 3. 게이트 CPU — A/B 실측 (부하 주장은 측정으로만)

직전 세션이 순간 `ps` 값 하나로 원인을 단정해 틀렸다. 이번엔 **같은 머신·연속 3쌍 교차**로 쟀다.
방법: `git worktree add --detach /tmp/t5-ab-base 68463b7` 후 `{ /usr/bin/time -p npm test; } 2>&1`.

| 회차 | A = 기준선 `68463b7` (1,306건) | B = 현재 (1,318건) | B − A |
|---|---|---|---|
| 1 | 51.36s | 48.42s | **−2.94** |
| 2 | 51.63s | 53.01s | +1.38 |
| 3 | 52.05s | 48.67s | **−3.38** |
| **평균** | **51.68s** | **50.03s** | **−1.65** |

**읽는 법:**

- **내 몫의 순증은 없다.** 검사를 12건 더 하면서도 기준선보다 평균 1.65s 빠르다.
  직전 세션이 실측한 `+4.7s`(매 턴 registry·확인 원장·grant 스냅샷)는 회수됐다 —
  registry 읽기 캐시(mtime+크기) + 세포 0건 조기 종료 + 원장 지연 공급.
- **절대값 ~50s 는 기준선 코드도 같다.** 그러므로 40s 초과의 지배적 원인은 **기계 부하**다.
  같은 스위트가 실행 보드 동결 manifest(`6ce88bf`)에서는 **39.2s** 였다.
- 회차 간 편차가 ±2s 이므로 1회 측정으로는 방향을 말할 수 없다. 3쌍을 교차한 이유다.

**따라서 게이트 CPU 는 이 보강으로 닫히지 않는다. 조용한 환경 재측정이 여전히 종료 조건이다.**
기준선 40s 는 올리지 않았다(`scripts/gate-baseline.json` 무변경).

현재 게이트: **BLOCKED 1건** — CPU 50.2s > 40s. 나머지 전 항목 통과(테스트 1,318건 · 후속 표현 15건 · 의존성 0).

---

## 4. 검증 수치

| 항목 | 결과 |
|---|---|
| 전체 회귀 `npm test` | **1,318건 통과 · 실패 0** (보강 전 1,306건) |
| 새 검사 | admission 계약 2건 재작성 + 관통 3건 신설 + 종료 행렬 반대시험 10건 |
| 고아 계약 검사 | 통과 — 새 export 전부 소비됨, 유예 원장 추가 **0건** |
| 게이트 | BLOCKED 1건(CPU) · 그 외 전 항목 통과 |

### 수정 전 실패 확인 (v3.1 §19.1 L2-① — 반대 테스트 건수)

**추정이 아니라 실행했다.** 기준선 `68463b7` worktree 에 축소판 검사를 넣어 직접 돌렸다
(`/tmp/t5-ab-base/test/before-check.test.js` · `before-wire.test.js`). 새 export 를 쓰는 시험은
모듈 부재로 파일 자체가 죽으므로, **기준선에 존재하는 API 만 쓰는 형태**로 다시 써서 측정했다.

| 검사 | 보강 전 실행 결과 | 무엇이 깨져 있었나 |
|---|---|---|
| 행렬 1: 창 밖 실패가 감쇠한다 | **실패(실측)** | 누적 원장 전체가 사실이라 두 턴 전 실패가 `실패 직후` 로 살아 있었다 |
| 행렬 2: 같은 지시는 충돌이 아니다 | **실패(실측)** | 같은 문장을 `conflict` 로 거절했다 |
| 행렬 3: 정규식 추정이 확정 권한이 되지 않는다 | **실패(실측)** | `tierKnown` 이 정규식 추정으로 `true` 였다 |
| 행렬 5: 승인 턴이 admission 을 지난다 | **실패(실측)** | 승인 분기가 admission 앞에서 return — `principleTrace` 자체가 없었다 |
| 행렬 6: 관찰이 anchor 를 저장한다 | **실패(실측)** | 호출부가 anchor 를 안 넘겨 전부 `null` |
| 행렬 9: 다른 작업 공간 원리는 조회하지 않는다 | **실패(실측)** | `scope` 개념이 스냅샷에 없었다 |

**실측 6건이 보강 전 코드에서 실패한다**(현재 코드에서는 전부 통과).

정직하게 구분해 남기는 두 부류:

- **보강 전에도 통과한 것 1건** — `행렬 9: 세포 0건이면 원장을 만들지 않는다`.
  기준선은 공급자를 함수로 받으면 **그대로 저장만 하고 호출하지 않았다.** 실제 낭비는
  서버가 `await confirmationStore.snapshot()` 을 **미리** 부른 데 있었고, 그건 이 시험이
  아니라 §3 의 A/B 측정이 잡는다. 이 시험은 회귀 방지용이지 결함 재현이 아니다 —
  감사 계약 §8 기준으로 `미증명`으로 표시한다.
- **보강 전에는 존재할 수 없던 것**(행렬 4·7·8) — 새 계약이라 "수정 전 실패"를 말할 수 없다.
  행렬 4 는 `grantFromConsumedApproval` 자체가 없었고, 행렬 7 은 실행 전 바이트라는 관측점이
  없었으며, 행렬 8 은 **옛 시험이 A2 턴을 만들지도 못했다**(그게 사유 4개를 허용한 이유다).
  이 셋은 "부재"이지 "실패"가 아니므로 위 6건에 세지 않는다.

---

## 5. 이 보강에서 발견해 함께 고친 것 (지적받지 않은 것)

「지적된 인스턴스만 고치지 말고 같은 모양을 전부 훑는다」의 결과다.

1. **`resolveRole` 의 기본 인자가 삭제된 상수를 가리켰다.** 행렬 3 작업 중 `STAGE_ALLOWED_ROLES`
   를 지우면서 드러났다. 검사가 잡았다.
2. **`thisTurn` 창은 구조적으로 항상 비는 죽은 코드였다.** admission 이 도는 모든 자리
   (모델 앞·계획 뒤·승인 소비 뒤)가 **실행 앞**이라 "이번 턴 영수증"은 0건일 수밖에 없다.
   만들어 두면 영원히 비는 계약이 되므로 창을 직전 턴 하나로 줄였다(절대 원칙 7).
3. **관찰 생산자 3개가 anchor 파라미터 자체를 안 받았다.** `observeTurn` 만 고치고 끝냈으면
   `observeUserRequest`·`observeCorrection`·`observeAutomationResult` 는 계속 null 이었다.
4. **행렬 8 시험이 A2 턴을 만들지 못하고 있었다.** `mail.send` 는 demo 에서 `executable:false`
   라 계획에 오르지 않는다. `slack.post` 로 바꿔서야 실제 A2 계획이 섰다 — 옛 시험이 사유 4개를
   허용한 진짜 이유가 이것이었다(권한 경계를 한 번도 지나지 않았다).

## 6. 남은 것과 판정

- **게이트 CPU**: 조용한 환경 재측정 필요. 코드 몫은 A/B 로 회수 확인.
- **판정**: TG-5A 종료 행렬 1~9 **자체 검증 완료 · 독립 감사 대기**. 10 은 CPU 재측정 후.
- **TG-5B 진입**: 금지 유지. 공식 gate PASS 와 독립 봉인 전에는 진행하지 않는다.
- 이 작업은 shadow 라 **사용자 문장 하나가 다르게 끝나지 않는다** — 작업지시서 §6 슬라이스
  경계상 슬라이스 완료로 보고하지 않는다. TG-5 단계의 구현 단위다.
- 운영 순환 칸: **② 현재 맥락·대상**(anchor 생산) · **⑤ 위험·승인 경계**(실제 권한 원장) ·
  **⑥ 실행 원장**(고정 시간창). ⑨ 도달 확인 = **해당 없음**(shadow 의 계약).
- 모델 판단 자리 침범: 없음. 서비스별 분기·금지문·응답 대본을 추가하지 않았다.
