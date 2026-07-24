# P6-3 · 자동화 (Automation) — 첫 슬라이스

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기

## 목표 흐름

```
GrowthCandidate → 사용자 승인 → 예약/대기(ScheduledJob) → tick 실행 → ToolReceipt/Truth Ledger → 취소/만료
```

## 7원칙 → 코드 대응

| 원칙 | 구현 |
| --- | --- |
| 1. 몰래 실행 안 함 | `isJobRunnable`이 `scheduled`+미만료+도달만 허용. tick은 그 외 전부 실행 0. |
| 2. 조용한 후보 제안 | `detectAutomationCandidate`(반복 신호) → `automationSuggestion`. 대화 하단 조용한 카드. |
| 3. 후보 ≠ 실행(승인 전 영향 0) | 후보는 `approved:false`. job이 없으면 tick 실행 경로 자체가 없음. |
| 4. 승인돼도 범위·만료·취소·원장 | `ScheduledJob.grantScope{kind,expiresAt}` + `cancelJob` + `executions[]`(ToolReceipt). |
| 5. 외부 전송 A2 경계 유지 | `external`은 도구 descriptor의 `needsApproval`에서 파생(사용자 입력 불신). 외부 자동화는 **만료 없는 승인 거부**(`needsExpiry`) → 승인 범위로 A2 유지, 만료 후 재승인. |
| 6. 실패·차단·만료·취소 정직 기록 | tick이 실패 receipt를 `executions`에 남기고 job.state를 `failed`/`expired`/`cancelled`로. |
| 7. cron/daemon 전체 금지 | in-process `tickAutomation`(수동/테스트 tick)만. relay·config·daemon 없음. |

## 계약 (신규)

- `src/kernel/l5-growth/automation.js` — `detectAutomationCandidate`, `makeGrowthCandidate`,
  `approveAutomation`, `isJobRunnable`, `jobExpired`, `cancelJob`. `JOB_STATES`.
- `src/runtime/automation-engine.js` — `tickAutomation(jobs, {tools, selfState, now})`. 실행 가능한 job만
  ToolRunner로 호출 → receipt를 job.executions에. 1회 job은 실행 후 completed, interval job은 재예약.
- `src/surface/automation-store.js` — 파일 기반 `{candidates, jobs}`(의존성 0).

## 서버 라우트

- `POST /turn` — 반복 신호면 `automationSuggestion` 후보로만 저장(자동 승인 아님, 중복 제외).
- `GET /automation` — 미승인 후보 + job 요약(state·external·runs·lastResult).
- `POST /automation/approve` — 후보 → ScheduledJob. external은 descriptor 파생, 외부는 만료 필수.
- `POST /automation/tick` — 수동 스케줄러 tick(최소).
- `POST /automation/cancel` — 되돌리기.

## 경계 (A2/승인)

외부 전송 자동화의 A2는 **후보 승인 시점**에 걸린다(job은 승인해야만 존재). 승인은 `grantScope.expiresAt`로
범위가 제한되며, 그 범위 안에서만 tick이 실행한다. 만료 후에는 실행하지 않고 `expired`로 남겨 재승인을
요구한다(Approval Lifecycle과 동일 계약). 즉 per-approval-scope 방식.

## 테스트 (필수 7 + 불변식/원장/실경로)

`test/automation.test.js` (14): 승인 전 실행 0 · isJobRunnable 불변식(목록 아님) · tick 1회 · 만료 미실행 ·
취소 미실행 · 외부 승인 범위·만료 · 원장 기록 · 실패 정직 기록 · 일반 대화 미교란 ·
서버 승인→tick→원장 · 외부 만료 없는 승인 거부 · 취소 job 미실행 · **/turn 실경로 후보 저장(중복 제외)**.

반대 테스트: `isJobRunnable`의 상태 가드 제거 시 취소·만료·재실행·서버취소 4건이 실패 → 가드가 진짜 버그를 잡음.

## 라이브 검증

`매주 로컬 파일 정리해줘` → reply + 조용한 카드 → 승인 → job scheduled → tick 1회(failureState none) →
completed·runs 1. 브라우저에서 카드 렌더·승인·"30일 후 만료"·취소 버튼까지 육안 확인.
