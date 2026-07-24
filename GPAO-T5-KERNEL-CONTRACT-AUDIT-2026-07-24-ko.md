# GPAO-T5 Kernel Contract Audit

- Status: `phase_2_sealed`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `f5c3777`
- Contract: `GPAO-T5-KERNEL-CONTRACT-2026-07-24-ko.md`
- Prior evidence: `GPAO-T5-PRODUCT-CONSTITUTION-AUDIT-2026-07-24-ko.md`

## 0. 판정

`통과`.

GPAO-T5 Kernel Contract 는 Phase 2 산출물로 봉인한다.

## 1. 확인한 것

- Phase 2 첫 작업인 native-runtime baseline seal 확인이 수행되었다.
- native-runtime 은 production baseline seal 미달성으로 판정되어 T5 정본으로 승격되지 않았다.
- BEAI5 Integration Contract 는 감사 지시대로 Kernel Contract 내부 장으로 포함되었다.
- 다음 계약이 모두 정의되었다.
  - IntentPacket
  - ActionPlan
  - AuthorityGrant
  - ToolReceipt
  - ContextAdmissionPacket
  - SelfStateSnapshot
  - LLM-ready Task Context Packet
  - simple chat fast path / complex work path
  - 자연스러움 훼손 방지 gate
  - BEAI5 Integration Contract

## 2. 감사 중 보강한 것

초안은 통과 수준이었다. 다만 두 가지를 Codex 감사에서 직접 보강했다.

1. ToolReceipt 에 `diagnosticTrace` 필드를 추가했다.
   - 이유: T3에서 사용자면과 진단면이 섞였던 회귀를 막기 위해, `userSafeSummary` 와 내부 진단 데이터를 계약상 분리해야 한다.

2. 문서 상태와 마지막 문구를 `Codex 감사 통과 · Phase 2 봉인`으로 정리했다.
   - 이유: 초안 잔여 문구가 남아 있으면 다음 에이전트가 Phase 2 상태를 오독할 수 있다.

## 3. 통과 이유

이 계약은 헌법의 네 기둥을 데이터 계약으로 내렸다.

- Operational Selfhood 는 SelfStateSnapshot 으로 내려왔다.
- 사용자 목적 달성은 IntentPacket 과 ActionPlan 으로 내려왔다.
- 권한/원장/복구는 AuthorityGrant 와 ToolReceipt 로 내려왔다.
- BEAI5 는 OS가 정렬할 구조와 모델이 생성할 판단·언어의 경계로 내려왔다.
- 단순 대화와 복잡 작업을 분리해 자연스러움과 실행력을 동시에 보존했다.

## 4. Phase 3 지시

다음 산출물은 `GPAO-T5-UX-ARCHITECTURE-2026-07-24-ko.md` 로 한다.

Phase 3 은 Kernel Contract 를 사용자 표면으로 번역한다.

반드시 설계할 표면:

- Work Chat
- Today / Home OS
- Project Rooms
- Memory / Context Center
- Tool / Connection Center
- Task / Automation Center
- Canvas / Workboard
- Local PC Workspace
- Channel Inbox
- Approval Center
- Evidence / Truth Ledger
- Recovery Center
- Growth Center
- Model Router

각 화면은 다음을 보여야 한다.

- 현재 가능한 일
- 막힌 일
- 다음 안전 행동
- 필요한 승인
- 실행/도구/원장 상태
- 사용자의 대화 흐름을 방해하지 않는 자기파악 표시

제품 코드는 아직 쓰지 않는다.

## 5. 닫는 말

Phase 2 Kernel Contract 는 닫는다.

다음 단계는 Phase 3 UX Architecture 다.
