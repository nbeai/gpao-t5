# AC-1 Codex 겸임 구현 기록

- 기준선: `6ce88bf`
- 브랜치: `codex/automation-ac1`
- 역할: **겸임 구현** — Codex가 구현과 자체 실행 감사를 함께 수행했으므로 병합 전 Claude 독립 감사 필요

현재 작업:
SkillDefinition, TriggerSpec, AgentProfile, AutomationJob, AgentRun, AuthorityEnvelope의 순수 계약과 v1→v2 migration·저장 기반.

이미 통과한 범위:
P-OP-7 제품 동작은 기준선 그대로 유지. `server.js`, `turn.js`, `live-context.js`와 기존 P-OP-7 수정 파일은 변경하지 않음.

현재 차단:
`324f281` 재감사에서 확인된 Run claim 신분 탈취·시간 역행·영수증 변조를 보강함. 새 커밋 독립 재감사 대기.

지정 후속:
AC-2에서 v2 SkillDefinitionStore를 실제 lifecycle에 연결. AC-3 이후 scheduler/runner가 AutomationJobStore와 RunLedger를 소비.

원인 미분류 관찰:
없음.

다음 작업과 종료 조건:
Claude가 계약·migration·저장 원자성·권한 축소를 독립 감사하고, 통과한 커밋만 P-OP 기준선 이후에 병합. 실행기·스케줄러·UI는 이 커밋에서 열지 않음.

## 독립 감사 보강

- Run 저장을 직렬화된 append-only event와 별도 current snapshot으로 분리
- 서로 다른 Run 무손실, 동일 occurrence 정확히 하나, 같은 Run lifecycle 전이 기록
- descriptor `toolKind` 기반 send 기본 deny(`slack.post` 포함)
- malformed input에서 모든 validator 비예외 `{ok:false, errors}`
- v1 workspace migration은 synthetic Skill/Profile을 dependency-first로 설치하고 Job을 마지막에 전환
- standalone Job migration은 참조가 없으면 `needs_review`
- old/new reader compatibility projection과 기존 `canInfluence`/`tickAutomation` 관통
- Skill 내용과 contentHash 재계산 일치 강제
- claimed/running/waiting owner·heartbeat, terminal finishedAt, 정본 idempotency key 강제
- 손상 격리본도 0600

## 2차 독립 감사 보강

- 최초 queued 뒤 skill/trigger/agent snapshot은 불변
- Run authority는 이전 봉투 안에서 축소만 허용하고 budget 수치는 증가 불가
- 전이 함수와 실행원장이 같은 확장 거부 계약을 각각 확인
- paused Skill은 구형 reader에서도 영향 0, admitted로 재개하면 v2 active로 왕복
- 실행 event를 정본으로 두고 current snapshot은 load 때 정합 확인·재구축
- event 성공 뒤 snapshot 실패는 성공을 실패로 뒤집지 않고 `snapshotWritten:false`로 표면화
- 같은 정확 event 재시도는 이벤트를 중복하지 않고 snapshot만 복구
- 개별 AutomationJobStore가 먼저 만든 부분 이관 v2도 workspace migration이 synthetic 참조를 만들고 의도 상태를 복원
- v2 이관 뒤 기존 승인 경로가 만든 새 v1 Job도 dependency-first migration을 거쳐 저장 전후 같은 scheduled 의미와 실행 가능성을 유지

## 3차 독립 감사 보강

- queued는 owner·heartbeatAt·startedAt·finishedAt이 모두 null
- owner와 startedAt은 queued→claimed에서만 설정하고 이후 일반 전이에서 불변
- heartbeatAt과 updatedAt은 비감소
- active 상태는 finishedAt을 가질 수 없고 terminal은 finishedAt >= startedAt
- receipts는 이전 배열을 동일 prefix로 보존하고 뒤에만 추가
- 일반 전이에서 owner 교체 금지. stale recovery 소유권 교체는 AC 후속 전용 경계로 분리
- append 내부의 중복 snapshot 정합화 I/O를 제거하고 event 기록 뒤 한 번만 투영

## 자체 검증

- AC-1 집중 반대시험: 31건 통과
- 전체 회귀: 1,209건 통과, 실패 0
- 프로젝트 gate: PASS, CPU 38.0초 / 40초, 벽시계 14.7초
