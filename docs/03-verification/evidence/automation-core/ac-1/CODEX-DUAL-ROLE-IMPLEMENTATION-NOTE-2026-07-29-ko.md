# AC-1 Codex 겸임 구현 기록

- 기준선: `6ce88bf`
- 브랜치: `codex/automation-ac1`
- 역할: **겸임 구현** — Codex가 구현과 자체 실행 감사를 함께 수행했으므로 병합 전 Claude 독립 감사 필요

현재 작업:
SkillDefinition, TriggerSpec, AgentProfile, AutomationJob, AgentRun, AuthorityEnvelope의 순수 계약과 v1→v2 migration·저장 기반.

이미 통과한 범위:
P-OP-7 제품 동작은 기준선 그대로 유지. `server.js`, `turn.js`, `live-context.js`와 기존 P-OP-7 수정 파일은 변경하지 않음.

현재 차단:
독립 감사에서 확인된 Run 동시성·send deny·validator totality·migration 참조/호환·hash 일치·격리본 권한·Run identity 위반을 보강함. 재감사 대기.

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

## 자체 검증

- AC-1 집중 반대시험: 22건 통과
- 전체 회귀: 1,200건 통과, 실패 0
- 프로젝트 gate: PASS, CPU 39.3초 / 40초, 벽시계 14.6초
