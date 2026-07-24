# GPAO-T5 Reference Inventory Audit

- Status: `phase_0_sealed`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `50ef4c3`
- Inventory: `GPAO-T5-REFERENCE-INVENTORY-2026-07-24-ko.md`
- Protocol: `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`

## 0. 판정

`통과`.

GPAO-T5 Phase 0 Reference Inventory 는 봉인 가능하다.

다만 이 통과는 "제품 코드 착수 가능"이 아니라, 계획서 로드맵상 다음 단계인 Phase 1 Product Constitution 으로 넘어갈 수 있다는 뜻이다. 코드 착수는 계획서대로 Phase 5 부터다.

## 1. 확인한 것

- 총 55행.
- 대상 8종 커버:
  - GPAO-T3 17행
  - lab_un/OpenClaw 14행
  - native-runtime 6행
  - Claude Code 6행
  - ChatGPT 5행
  - Codex 2행
  - OpenHands 2행
  - BEAI5 3행
- 4분류 집계:
  - 원리흡수 35
  - 추가검증 14
  - 재사용가능 3
  - 폐기 3
- 11개 기능군 커버 확인.
- 6층위 커버 확인.
- T5 매핑 6태그(표면, 커널, 라우터, 권한, 원장, 복구) 커버 확인.
- BEAI5 전용 행 3개 확인.
- Codex 감사 메모 55행 입력 확인.

## 2. 통과 이유

이 인벤토리는 Reference-First 원칙에 맞게 T3, lab_un/OpenClaw, native-runtime, Codex, Claude Code, ChatGPT, OpenHands, BEAI5 를 같은 표 안에서 비교 가능하게 만들었다.

특히 다음 점이 통과 근거다.

1. OpenClaw/lab_un 을 정본으로 삼지 않고 원리흡수/추가검증 중심으로 제한했다.
2. Codex, Claude Code, ChatGPT 의 비공개 구현과 고유 화면을 복제 대상으로 두지 않았다.
3. T3 에서 가져올 수 있는 것과 폐기할 것을 분리했다.
4. BEAI5 를 별도 행으로 올려 T5 의 핵심 축이 빠지지 않게 했다.
5. native-runtime 을 L0 State Kernel 후보로 발견했지만, baseline seal 전 연구물로 묶어 성급한 정본화를 막았다.

## 3. 고위험 판정

다음은 Phase 1~2 에서 반드시 결정해야 한다.

1. `native-runtime` vs `T3` 커널 이전 기준
   - native-runtime 은 L0 State Kernel 후보로 강하다.
   - 그러나 baseline seal 전 연구물이다.
   - Phase 1 에서 "T5 L0 기준은 native-runtime 구조를 우선 참고하되, T3의 검증된 사용자 흐름을 병합한다"는 방향으로 결정하는 것이 현재 최선이다.

2. `T3-RECOVERY-001`
   - 재사용 가능 후보지만, T3에서 사용자면/진단면 정화가 섞인 문제가 있었다.
   - T5 이전 시 Recovery Envelope 는 사용자 메시지와 내부 진단 데이터를 분리해야 한다.

3. `T3-VAULT-001`
   - 고객정보 금고는 재사용 가능 후보이나 권한, 삭제, 장기기억 경계가 크다.
   - Phase 1 에서는 제품 철학과 권한 계약만 정하고, UI/삭제 기능은 현재 비범위로 둔다.

4. lab_un/OpenClaw 라이선스
   - 원리흡수는 가능하다.
   - 코드 재사용은 아직 금지한다.
   - transitive dependency 실사 전에는 재사용 가능으로 승격하지 않는다.

5. OpenHands
   - 공식 문서와 MIT 라이선스 근거만 있다.
   - 실소스/실행 검증이 없어 Phase 0 봉인을 막지는 않지만, 구현 근거로 쓰기 전 추가 검증이 필요하다.

## 4. Phase 1 지시

다음 산출물은 `GPAO-T5-PRODUCT-CONSTITUTION-2026-07-24-ko.md` 로 한다.

Phase 1 작성 기준:

1. T5 를 "T3 + 기능 추가"로 정의하지 않는다.
2. T5 를 OpenClaw, Codex, Claude Code, ChatGPT, OpenHands 의 wrapper 로 정의하지 않는다.
3. T5 의 독립 OS 정체성은 Operational Selfhood, BEAI5 Model Operation, 사용자 목적 달성, 권한/원장/복구 계약으로 선언한다.
4. Phase 0 인벤토리의 흡수 결과를 헌법 수준 원칙으로 압축한다.
5. 코드 작성은 하지 않는다.

Claude Code 는 Product Constitution 초안을 작성한다.
Codex 는 정본성, 철학, 금지선, Phase 2 연결성을 감사한다.

## 5. 닫는 말

Phase 0 Reference Inventory 는 닫는다.

다음 단계는 Phase 1 Product Constitution 이다.
