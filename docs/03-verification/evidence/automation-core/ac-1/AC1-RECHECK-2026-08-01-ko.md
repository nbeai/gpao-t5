# AC-1 재대조 — W1 기준선·계약 동결 (2026-08-01)

- 성격: 배치 2(AC-2·3·4) 착수 전 **본선 정리 기록**. 새 설계 문서가 아니다 — 정본 계획은
  `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md` 그대로다.
- 근거: D-W1 읽기 전용 조사(정본 `a7f839e` ↔ `codex/automation-ac2` @ `53cdaa3`, 병합기점 `6c5efa8`)
  + 본선 대조. 조사 원문은 세션 기록, 이 문서는 채택 결과만 남긴다.
- 확정 사실: AC-1 v2 계약·저장(`automation-contracts.js` 839줄, 4store)은 편입 후 무변경이나
  **프로덕션 소비자 0**(검사 2파일만 소비). 런타임은 아직 v1 선(`SkillStore`·`AutomationStore`·
  `automation-engine.tickAutomation`)을 돈다. 드리프트는 AC-1 자체가 아니라 그 뒤 봉인된
  T-cell·배치 1 계약(replay 영수증·민감 2층·통제 채널·work-contract)과의 간격이다.

## 1. `codex/automation-ac2` 재사용 / 재구현 / 폐기 표

| 자산 | 판정 | 근거 |
|---|---|---|
| `normalizeSkillProposal` 정규화 골격(NFC·JSON 왕복·결정 정렬·contentHash→id·호출자 지정 상태 무시) | **재사용(수정 후)** | 정본 `contentHash`·`skillHashSource` 철학과 일치. 민감 게이트 추가 필수(위험 R2) |
| replay `assess()`의 외부효과 0·미선언 capability 차단 | **재사용** | 정본에 대응물 없음, boundary 정의와 일치. 증거 공급원만 교체 |
| `replayDigest`(wall-clock 배제 재현성) | **재사용** | `caseInputDigestOf` 철학과 동일 |
| 낙관적 재검사(replay 중 skill 변경 시 증거 폐기) | **재사용** | `reviewJobSkillBinding`과 같은 방향 |
| `test/skill-definition.test.js` 8건 | **재사용** | authority·민감 케이스 추가 필요 |
| `test/skill-replay.test.js` 14건 | **부분 폐기** | 반증 설계는 유지, 본문은 영수증 계약으로 재작성 |
| 직렬화 큐(인스턴스 전역) | **재구현** | 정본 `automation-run-ledger.serialize(key)` 키별 큐로 통일 |
| `SKILL_PROPOSE_CONTROL_SCHEMA` 별도 파일 선언 | **폐기 ①** | 통제 채널은 `model-control.js` 단일 등록부+`splitModelControlCalls` 단일 경계(두 진실 금지). 스키마 문안만 재사용 |
| `runSkillReplay` 호출자 선언 증거 모델 | **폐기 ②** | `tcell-replay.verifyReplayEvidence`(저장소 재조회·digest 결합·호출 신분)와 정면 충돌 — 그 파일이 명시 금지한 패턴 |
| `REPLAY_KINDS` 3종·종류당 1건 | **폐기 ③** | 정본 `SUITE_MINIMUM {p2/n1/b2/authority1}` 이 봉인 계약 |
| `SkillClosureService`의 `SkillDefinitionStore` 직결 | **폐기 ④** | v1/v2 이중 저장 절단(본선 소유) 선행 필요 |
| replay runner의 `src/runtime/` 배치 | **폐기 ⑤** | 통제·판정 층과 실행기 층 혼재 |

## 2. 공통 AgentRun 계약 — **동결**

배치 2의 세 작업선은 실행기를 만들지 않는다. 다음이 계약이다.

1. **실행기는 하나다**: AgentRun 실행은 `turn.js executePlan` 걸음 루프의 **파라미터화**로 만든다
   (세션 의존 제거 + owner·budget·envelope·heartbeat 4요소 추가 — 4요소의 계약은 AC-1
   `validateAgentRun`에 이미 있다). 수동·예약·위임 실행이 같은 러너를 쓴다(계획 §5.1).
2. **손 실행·영수증의 유일한 진실은 `ToolRunner.run`**. scheduler·skill·agent 어느 것도
   도구를 직접 부르지 않는다. v1 `tickAutomation`의 `tools.run()` 직접 호출은 AC-3에서 제거.
   scheduler는 AgentRun 생성에서 책임 종료.
3. **권한 판정의 유일한 진실은 `authority.js`**(`toolActionKind`→`decideAutoGrant`/
   `isExecutionAllowed`). envelope는 그 위의 **추가 제한**이며 확장 불가(`authorityWithin`).
   실행 시점 재판정 필수 — 승인 시점 플래그로 대체 금지(위험 R7).
4. **Skill replay = envelope A0 + externalEffects 0 을 강제한 AgentRun.** 증거는
   `tcell-replay` 계약(케이스 digest ↔ 요청 digest 결합·저장소 재조회·호출 신분) 그대로.
5. **claim·중복 차단은 `claimAgentRun` + `AutomationRunLedger` occurrence 유일성** 재사용.
   idempotencyKey = `jobId:scheduledFor:skillVersion:skillHash`(기존 계약).
6. **완료↔전달 분리의 기계 사실은 `work-contract.js`**(`bindDeliverableReceipt`·
   `unsatisfiedDeliverables`) 재사용 — 세 번째 진실 금지.
7. **통제 채널 3종**(`skill.propose`·`automation.propose`·`agent.propose`)은
   `MODEL_CONTROL_SCHEMAS` 한 배열에만 선언하고 같은 분리 경계를 지난다. 자식 실행도 같은
   경계를 지나야 `agent.create` 재귀가 막힌다(`childToolAllowlist` 재사용).
8. **순수 계약 파일 위치**: `src/kernel/l5-growth/agent-run.js`(신규, AC-4 소유) —
   전이·게이트·교집합만, 의존 0. 실행 루프는 `src/runtime/agent-runner.js`.
9. **미확정으로 남기는 것**(AC-4 제안 → 본선 통합 시 확정): 걸음 루프의 `ctx.pending`
   승인 대기와 AgentRun `waiting_approval`의 배선 — 단, **새 승인 체계 금지·기존 pending
   계약 재사용**은 지금 동결한다.

## 3. 위험 처분 (현재 차단 / 지정 후속 / 관찰)

| # | 내용 | 처분 |
|---|---|---|
| R2b | 자동화 후보 statement·args 민감 원문 durable 저장 | **현재 차단 → W1에서 종결**: `자동화후보저장가능`(공용 경계 재사용) + 반대시험(수정 전 실패 실측) + 돌연변이 154번 |
| R5 | `AutomationStore.save`가 skills.json·agent-profiles.json까지 재작성 → 병렬 런타임 충돌 | **현재 차단 → W2 서두 본선 직렬**(v1/v2 절단과 한 묶음) |
| R4/1.3 | skills.json v1/v2 왕복 드리프트(stale·retired·quarantined 소실)+전체 배열 재저장 | **현재 차단 → W2 서두 본선 직렬**: 런타임을 v2 store로 전환(절단), 왕복 제거 |
| R1 | `allowedKinds` 어휘 혼용(authority kind ↔ 도구 id) | **현재 차단 → W2 서두 본선 직렬**: 어휘를 authority kind로 확정, 도구 id는 별도 필드. `automation-contracts.js` 변경은 본선 재봉인 |
| R3 | `/skills/:id/approve` 한 POST에서 replay→승인→승격 연속 실행(우회 통로) | 지정 후속 — AC-2 완료 조건에 라우트 재작성 포함(라우트 배선은 본선) |
| R6 | tick 재진입 방지가 프로세스 로컬, 영속 claim 미사용 | 지정 후속 — AC-3(§8.2 claim 배선) |
| R7 | 실행 시점 권한 재검증 부재 | 지정 후속 — AC-3/AC-5(계약 §2-3이 방향 동결) |
| R8 | `authorityHints` 무소비인데 hash 포함(권한 선언 오독 여지) | 지정 후속 — AC-2에서 결정(hash 경계 명시) |
| R10 | v1 `job.executions[]` ↔ v2 run ledger 두 원장 | 지정 후속 — AC-3 통합 시 단일화(본선 조정) |
| R11 | 계획서 `schemaVersion:1` 표기 ↔ 코드 정본 `=2` | **W1 문서 정합화**: 계획서에 정오 주석 1줄 |
| R9·R2 | ac2 자산 자체 결함(격리 미검증·민감 게이트 부재) | §1 폐기/재구현 표에 흡수 |

## 4. AC-2·AC-3·AC-4 소유권 표 (동결)

**단독 소유(신규 포함)**
- AC-2: `src/kernel/l5-growth/skill-closure.js`·`skill-replay.js`(신규)·`src/surface/skill-service.js`(신규)·`skill-learning.js`·`l2-plan/skill-descriptor.js`(정리) + `test/skill-*.test.js`
- AC-3: `src/runtime/trigger-provider.js`·`job-claimer.js`(신규)·`src/kernel/l5-growth/trigger-spec.js`(신규)·`automation-scheduler.js`·`automation-engine.js`(축소)·`l5-growth/automation.js` + `test/automation.test.js`·`automation-safety.test.js`·`trigger-provider.test.js`
- AC-4: `src/kernel/l5-growth/agent-profile.js`·`agent-run.js`(신규)·`src/runtime/agent-runner.js`·`agent-run-registry.js`(신규)·`src/surface/agent-profile-store.js` + `test/agent-*.test.js`

**전 작업선 읽기 전용(수정 금지)**: `tcell-*.js` 전부(S0~S5 봉인)·`sensitive-text.js`·
`work-contract.js`·`authority.js`·`action-plan.js`·`tool-receipt.js`·`ledger.js`·
`contracts.js`·`versioned-json-store.js`·정본 계획서.

**본선만 수정(shared)**: `server.js`(라우트·store·워커 배선 — 최대 충돌면)·`turn.js`(걸음 루프
파라미터화)·`tool-runner.js`·`live-context.js`·`model-control.js`(**통제 3슬롯은 본선이 배치 2
착수 전에 미리 뚫는다**)·`tool-descriptor.js`/`tool-schema.js`·`automation-contracts.js`(동결,
변경=본선 재봉인)·`skill-store.js`/`automation-store.js`/`automation-workspace-migration.js`
(v1/v2 절단)·`automation-run-ledger.js`(AC-3·4 공동 소비 조정)·AC-1 검사 2파일.

**병렬 최대 충돌면 3**: `server.js` 라우트 / `model-control.js` 배열+분리 경계 /
`automation-run-ledger.js` — 셋 다 본선 소유로 흡수했다.

## 5. 배치 2 착수 전 본선 직렬 선행 작업 (W2 서두, 병렬 열기 전)

1. v1/v2 이중 저장 절단(R4·R5): 런타임 소비자를 v2 store로 전환, workspace migration 재작성 경계 정리
2. R1 어휘 확정(`automation-contracts.js` 본선 재봉인 + AC-1 검사 갱신)
3. `model-control.js`에 통제 3슬롯 사전 배선(스키마 자리+분리 경계 반환 필드)
4. 이후 A(AC-2)·B(AC-3)·B′(AC-4) 병렬 개방

## 6. W1에서 실제로 바뀐 것

- R2b 종결: `automation.js` `자동화후보저장가능` + `server.js` 후보 저장 게이트,
  반대시험 1건(수정 전 실패 실측 — 경계의 값-끝 한정 계약 안 형태로 계측 교정), 돌연변이 154번.
- 계획서 §5.2 schemaVersion 정오 주석 1줄.
- 이 문서(재대조 기록) + 인수인계 §3 기준선 실측 갱신 + 진행표 §6 변경 원장 소급 1행(S 지적).
