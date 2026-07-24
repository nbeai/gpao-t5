# GPAO-T5 UX Architecture Audit

- Status: `phase_3_sealed`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `fa2718b`
- UX Architecture: `GPAO-T5-UX-ARCHITECTURE-2026-07-24-ko.md`
- Prior evidence: `GPAO-T5-KERNEL-CONTRACT-AUDIT-2026-07-24-ko.md`

## 0. 판정

`통과`.

GPAO-T5 UX Architecture 는 Phase 3 산출물로 봉인한다.

## 1. 확인한 것

- Kernel Contract 를 사용자 표면으로 번역한다는 원칙이 명확하다.
- 14개 표면이 모두 정의되었다.
- 각 표면은 역할, 근거 계약, 6요소, 대화 흐름과의 관계, 비범위를 가진다.
- 6요소가 Kernel Contract 필드에 매핑되어 있다.
- 첫 빌드 슬라이스가 14개 전체가 아니라 Work Chat 중심의 한 흐름으로 좁혀져 있다.
- 픽셀, 컴포넌트, 실제 UI 구현은 Phase 5 로 미뤄져 있다.
- Truth Ledger 와 Recovery 에서 `userSafeSummary` / `diagnosticTrace` 분리 원칙이 반영되어 있다.

## 2. 감사 중 보강한 것

초안은 통과 수준이었다. 다만 사용자 우려와 T5 철학상 한 가지 금지선을 더 명확히 했다.

`1.2 안티 대시보드 원칙`을 추가했다.

이유:

- T5는 복잡한 개발자 대시보드가 아니다.
- 내부 계약과 표면이 많아질수록 사용자의 첫 경험은 더 단순해야 한다.
- 기본 화면은 Work Chat 이고, 상태 표면은 필요할 때만 열린다.
- 사용자는 "시스템을 조작한다"고 느끼기보다 "말하면 일이 이어진다"고 느껴야 한다.

## 3. 통과 이유

이 UX Architecture 는 P2 계약을 화면으로 잘 번역했다.

- SelfStateSnapshot 은 자기파악 표시와 Model Router 로 내려왔다.
- AuthorityGrant 는 인라인 승인과 Approval Center 로 내려왔다.
- ToolReceipt 는 Truth Ledger 와 Recovery 로 내려왔다.
- ContextAdmissionPacket 은 Memory / Context Center 로 내려왔다.
- FollowUpEvent 는 Work Chat 과 Today 흐름으로 내려왔다.
- BEAI5 자연스러움 기준은 내부용어 비노출, 대화 흐름 비점유, 안티 대시보드 원칙으로 내려왔다.

## 4. Phase 4 지시

다음 산출물은 `GPAO-T5-SCENARIO-REPLAY-SPEC-2026-07-24-ko.md` 로 한다.

Phase 4 는 40개 이상 인간 사용자 시나리오를 작성한다.

반드시 포함할 범주:

- 단순 대화
- 복합 작업
- 장기 프로젝트
- 도구 사용
- 도구 실패
- 외부 전송 승인
- 기억 승격
- 복구
- 자동화 후보
- 멀티 프로젝트
- BEAI5 자연스러움 회귀
- UX 안티 대시보드 검증

각 시나리오는 다음 흐름을 가져야 한다.

```text
사용자 발화
-> SelfStateSnapshot
-> IntentPacket
-> ActionPlan 또는 fast_chat
-> AuthorityGrant
-> ToolReceipt
-> Truth Ledger / Recovery
-> 다음 대화 연결
```

제품 코드는 아직 쓰지 않는다.

## 5. 닫는 말

Phase 3 UX Architecture 는 닫는다.

다음 단계는 Phase 4 Scenario Replay 다.
