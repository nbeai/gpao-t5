# GPAO-T5 Product Constitution Audit

- Status: `phase_1_sealed`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `7198b0b`
- Status: `RETIRED_HISTORY`
- Constitution: `docs/archive/retired-plans/GPAO-T5-PRODUCT-CONSTITUTION-2026-07-24-ko.md`
- Prior evidence: `GPAO-T5-REFERENCE-INVENTORY-AUDIT-2026-07-24-ko.md`

## 0. 판정

`통과`.

GPAO-T5 Product Constitution 은 Phase 1 산출물로 봉인한다.

## 1. 확인한 것

- T5 정체성을 Original AI Operating System 으로 선언했다.
- "T3 + 기능 추가"가 아니라고 명확히 금지했다.
- OpenClaw, Codex, Claude Code, ChatGPT, OpenHands 의 wrapper 가 아니라고 명확히 금지했다.
- 독립 OS 와 기능 많은 챗앱의 판정 기준을 자기파악, BEAI5, 목적 달성, 권한/원장/복구 계약으로 고정했다.
- Operational Selfhood 를 부가 기능이 아니라 존재 조건으로 선언했다.
- BEAI5 를 OS가 정렬할 구조와 모델이 생성할 판단·언어 영역으로 분리했다.
- Phase 0 감사의 고위험 5건을 헌법 조항으로 반영했다.
- Phase 2 Kernel Contract 로 넘어갈 대상이 명확하다.

## 2. 감사 중 보강한 것

초안은 대체로 통과 수준이었다. 다만 계획서 Phase 1 요구사항 중 `Reference-first absorption을 T5의 기본 개발 방식으로 고정`한다는 항목이 명시 조항으로 약했다.

Codex 감사에서 `3.1 Reference-First Absorption` 조항을 추가해 다음을 헌법에 직접 고정했다.

- T5는 바닥부터 재발명하지 않는다.
- 흡수는 복제가 아니다.
- T3, lab_un/OpenClaw, native-runtime, Codex, Claude Code, ChatGPT, OpenHands, BEAI5를 해부하되 T5 고유 OS 기관으로 재구성한다.
- 코드, 브랜드, 화면, config schema, runtime path, 비공개 구현은 정본으로 삼지 않는다.

## 3. 남은 결정

Phase 2 착수 전 또는 Phase 2 초입에서 결정해야 한다.

1. `BEAI5 Integration Contract` 를 독립 문서로 둘지, Phase 2 Kernel Contract 내부 장으로 둘지 결정한다.
2. native-runtime baseline seal 확인을 Phase 2 첫 작업으로 수행한다.
3. T3 재사용 가능 후보 3건은 코드 이전 전 사용자면/진단면 분리, 권한 계약, 실패 테스트를 요구한다.
4. lab_un/OpenClaw 는 라이선스·의존성 실사 전 코드 재사용 금지 상태를 유지한다.

## 4. Phase 2 지시

다음 산출물은 `GPAO-T5-KERNEL-CONTRACT-2026-07-24-ko.md` 로 한다.

Phase 2 는 다음을 계약으로 만든다.

- IntentPacket
- ActionPlan
- AuthorityGrant
- ToolReceipt
- ContextAdmissionPacket
- SelfStateSnapshot
- LLM-ready Task Context Packet
- simple chat fast path / complex work path 분리
- 자연스러움 훼손 방지 gate
- BEAI5 Integration Contract

제품 코드는 아직 쓰지 않는다.

## 5. 닫는 말

Phase 1 Product Constitution 은 닫는다.

다음 단계는 Phase 2 Kernel Contract 다.
