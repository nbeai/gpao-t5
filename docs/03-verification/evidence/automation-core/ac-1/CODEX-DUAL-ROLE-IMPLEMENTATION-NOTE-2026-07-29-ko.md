# AC-1 Codex 겸임 구현 기록

- 기준선: `6ce88bf`
- 브랜치: `codex/automation-ac1`
- 역할: **겸임 구현** — Codex가 구현과 자체 실행 감사를 함께 수행했으므로 병합 전 Claude 독립 감사 필요

현재 작업:
SkillDefinition, TriggerSpec, AgentProfile, AutomationJob, AgentRun, AuthorityEnvelope의 순수 계약과 v1→v2 migration·저장 기반.

이미 통과한 범위:
P-OP-7 제품 동작은 기준선 그대로 유지. `server.js`, `turn.js`, `live-context.js`와 기존 P-OP-7 수정 파일은 변경하지 않음.

현재 차단:
기능 차단 없음. 프로젝트 gate의 CPU 측정은 AC-1 없는 원본도 동일하게 49.2초로 40초 기준을 넘었으므로 AC-1 회귀가 아닌 실행 환경 불일치로 분류.

지정 후속:
AC-2에서 v2 SkillDefinitionStore를 실제 lifecycle에 연결. AC-3 이후 scheduler/runner가 AutomationJobStore와 RunLedger를 소비.

원인 미분류 관찰:
없음.

다음 작업과 종료 조건:
Claude가 계약·migration·저장 원자성·권한 축소를 독립 감사하고, 통과한 커밋만 P-OP 기준선 이후에 병합. 실행기·스케줄러·UI는 이 커밋에서 열지 않음.

## 자체 검증

- AC-1 집중 반대시험: 16건 통과
- 전체 회귀: 1,194건 통과, 실패 0
- 원본 비교 게이트:
  - AC-1 worktree: 테스트 1,194건 통과, CPU 49.2초
  - 변경 없는 원본: 테스트 1,178건 통과, CPU 49.2초
  - 판정: CPU 초과는 변경과 무관. 기준선은 올리지 않음.
