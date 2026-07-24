# GPAO-T5 Scenario Replay Audit

- Status: `phase_4_sealed`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `0a0a47b`
- Scenario Spec: `GPAO-T5-SCENARIO-REPLAY-SPEC-2026-07-24-ko.md`
- Prior evidence: `GPAO-T5-UX-ARCHITECTURE-AUDIT-2026-07-24-ko.md`

## 0. 판정

`통과`.

GPAO-T5 Scenario Replay Spec 은 Phase 4 산출물로 봉인한다.

## 1. 확인한 것

- 총 44개 시나리오.
- 12개 필수 범주 모두 포함.
- 감사 지정 8단계 흐름이 공통 형식으로 정의되어 있다.
- 사용자 원요구인 `자연스러운 웹챗 + 고기능 실행 UI`가 상위 판정선으로 들어가 있다.
- BEAI5 자연스러움 회귀 시나리오가 negative test 로 들어가 있다.
- UX 안티 대시보드 검증 시나리오가 들어가 있다.
- billing_blocked / rate_limited 오분류 방지 시나리오가 들어가 있다.
- 외부 전송, 공개 게시, 민감정보 전송 직전 unmask, 승인 거부 시 안전 정지가 들어가 있다.

## 2. 감사 중 보강한 것

초안은 통과 수준이었다. 다만 `GrowthCandidate`라는 표현이 Phase 2 Kernel Contract의 독립 계약처럼
읽힐 수 있었다.

Codex 감사에서 다음 경계를 명시했다.

- Phase 4 에서 자동화 후보는 새 계약이 아니다.
- 자동화 후보는 `FollowUpEvent(decision=queue) + AuthorityGrant(A2 활성화) + ToolReceipt(실행/실패 시)` 조합으로 표현한다.
- Phase 5 자동화 구현 전 별도 계약으로 승격할지 다시 결정한다.

## 3. 통과 이유

이 시나리오 명세는 단순 수량 채우기가 아니라 T5의 핵심 사용자 경험을 검증한다.

- 사용자는 채팅만 한다고 느껴야 한다.
- 복잡한 작업은 도구, 권한, 원장, 복구가 뒤에서 이어져야 한다.
- 도구 실패는 실패대로 정직하게 보여야 한다.
- 권한이 필요한 행동은 멈춰야 한다.
- 내부 상태는 기본 화면을 점유하지 않아야 한다.
- BEAI5의 자연스러운 판단·언어·산출물 품질을 망치면 실패로 본다.

## 4. Phase 5 지시

다음 단계는 `Phase 5 First Build Slice`다.

이제 제품 코드에 들어간다.

첫 구현 범위는 전체 14개 화면이 아니라 아래 한 흐름이다.

```text
Work Chat
+ SelfStateSnapshot
+ BEAI5 Task Context Packet
+ ActionPlan
+ Authority A0-A3
+ Truth Ledger
+ Connection status
+ Follow-up Queue
```

Phase 5 착수 전 지시서에는 반드시 다음을 포함한다.

- 구현 범위
- 파일/폴더 구조
- 첫 acceptance 시나리오
- 실패 테스트
- 실행 검증 방법
- UI 안티 대시보드 기준
- 자연스러움 회귀 기준
- ToolReceipt userSafeSummary / diagnosticTrace 분리

## 5. 닫는 말

Phase 4 Scenario Replay 는 닫는다.

다음 단계는 Phase 5 First Build Slice 다.
