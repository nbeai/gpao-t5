# GPAO-T5 문서 권위 지도

- 날짜: 2026-07-30
- 상태: `current_document_authority_map`
- 목적: 새 세션이 낡은 계획·완료 증거·현재 정본을 섞지 않고 최소한의 문서로 정확히 착수하게 한다.

## 1. 단일 진입 순서

모든 구현·수정·감사·승계는 아래 다섯 문서만 공통으로 먼저 읽는다.

1. `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
2. `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
3. `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
4. `GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md`
5. `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md`

그 뒤 현재 작업에 해당하는 명세 **하나**와 필요한 실행 보드만 읽는다. 모든 과거 계획서를 매번
처음부터 읽지 않는다.

## 2. 절대 판정 순서

문서가 충돌하면 다음 순서로 판정한다.

1. 사용자의 현재 명시 지시와 실제 안전 경계
2. 절대 원칙 §0의 말귀와 §0-A-1·§0-A-2의 최소 안전 바닥 안 최대 자율성
3. 비전 문서의 인간 사용자 경험과 성능 기준
4. Model-OS 운영 순환의 모델/Runtime 책임 분리
5. 현재 세션 인수인계 §0의 Git·런타임·구현 상태
6. 해당 영역의 현재 구현 명세
7. 실행 보드와 검증 증거
8. 과거 계획·감사·봉인 문서

하위 문서가 상위 원칙보다 더 많은 승인·카드·확인·전경 대기를 요구하면 하위 문서가 낡은 것이다.

## 3. 현재 정본

| 역할 | 문서 | 현재 지위 |
|---|---|---|
| 전체 제품 헌법 | `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md` | 최상위 |
| 인간 경험·말귀 | `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md` | 최상위 제품축 |
| 모델-OS 책임 | `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md` | 최상위 구조축 |
| 협업·감사 | `GPAO-T5-INDEPENDENT-AUDIT-AND-COLLABORATION-CONTRACT-2026-07-29-ko.md` | 현재 운영 계약 |
| 현재 사실 | `GPAO-T5-CURRENT-SESSION-HANDOFF-ko.md` §0 | Codex 통합 진실 |
| 개발 환경 | `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md` | 환경 변경 시 |
| 개발 방법 | `GPAO-T5-DEVELOPMENT-METHOD-ASSET-2026-07-28-ko.md` | 작업 설계 시 |

## 4. 작업별 현재 명세

| 작업 | 읽을 문서 | 현재 상태 |
|---|---|---|
| T-cell·기억·POM·성장 | `design/T5-TCELL-GOVERNANCE-ENGINE-IMPLEMENTATION-SPEC-2026-07-28-ko.md` + `design/T5-TCELL-BACKGROUND-CONTROL-PLANE-ENGINEERING-DECISION-2026-07-30-ko.md` | 개발 중 |
| 스킬·트리거·에이전트·자동화 | `design/T5-SKILL-TRIGGER-AGENT-AUTOMATION-IMPLEMENTATION-PLAN-2026-07-29-ko.md` | 병렬 개발 대상 |
| 도구·연결·채널 | `GPAO-T5-P-OP-REFERENCE-ABSORPTION-SUPPLEMENT-2026-07-28-ko.md` | 계약 참고, P-OP 상태 지시 아님 |
| 승인·권한 수명 | `GPAO-T5-APPROVAL-LIFECYCLE-CONTRACT-2026-07-25-ko.md` | 지속·만료 계약 유효, 효과 기반 등급 정합화 지정 |
| 릴리스·설치 | `design/P-DIST-1-INSTALL-PIPELINE.md` | 해당 단계에서만 |

## 5. 역사적 기반과 완료 증거

아래 문서는 삭제하지 않지만 현재 착수 순서나 차단 상태를 정하지 않는다.

- `GPAO-T5-FINAL-DEVELOPMENT-PLAN-2026-07-24-ko.md`: 최초 제품 기반
- `GPAO-T5-DEVELOPMENT-PLAN-v3.0-2026-07-26-ko.md`: 과거 단계 계획
- `GPAO-T5-DEVELOPMENT-PLAN-v3.1-SUPPLEMENT-2026-07-26-ko.md`: 과거 완료 정의 보강
- `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md`: P-OP 실행의 역사적 정본
- `docs/03-verification/T5-FINAL-DUAL-MODEL-HUMAN-SCENARIO-VALIDATION-PLAN-2026-07-28-ko.md`:
  P-OP-7 완료 검증 계획과 회귀 기준
- `docs/03-verification/evidence/**`: 실행 당시 사실

역사 문서의 “현재”, “다음”, “차단” 문장은 작성 당시 시점을 가리킨다. 현재 판단에는 인수인계 §0만 쓴다.

## 6. 전 영역 제품 불변식

다음은 T-cell에 한정되지 않는다.

- 사용자의 현재 말과 목적이 과거 기억·원리·자동화보다 우선한다.
- 모델에는 정확한 현실과 손발을 주고 의미 판단을 문자열·대본으로 빼앗지 않는다.
- 읽기·조사·정리·추론·초안·가역 작업은 자동 진행이 기본이다.
- 승인과 카드는 실제 비가역 외부 효과·새 권한·중대한 대상 불확정에만 쓴다.
- 이미 승인된 bounded grant 범위는 반복해서 묻지 않는다.
- 내부 학습·감사·저장 작업은 사용자 턴을 기다리게 하지 않는다.
- 잘못된 자동화와 학습은 사전 통제 확대보다 rollback·archive·restore로 복구한다.
- 정확도가 유지돼도 질문·카드·클릭·턴·대기가 늘면 제품 회귀다.
- 완료는 코드·검사 수가 아니라 인간 사용자가 더 자연스럽게 목적을 달성하는 것으로 판정한다.
- 과거 안전 기준을 고정한 회귀검사도 최신 상위 원칙보다 우선하지 않는다. 실제 효과와 인간 시나리오로
  재분류하되, 검사를 조용히 약화하거나 통째로 지우지 않는다.

## 7. 문서 변경 규칙

- 현재 상태는 인수인계 §0 한 곳만 갱신한다.
- 영역별 명세는 구조와 종료 계약만 가진다. 현재 커밋·브랜치·다음 작업을 복제하지 않는다.
- 완료된 계획은 역사 표식을 붙이고 현재 차단 문구를 제거하거나 역사 문맥으로 한정한다.
- 새 정본을 만들기 전에 기존 정본을 갱신할 수 있는지 먼저 본다.
- 같은 원칙을 여러 문서에 복제할 때는 원문을 다시 쓰지 않고 절대 원칙 조항을 참조한다.
- 문서 감사 `npm run audit:docs`가 권위 지도·상태·금지된 낡은 문구를 확인한다.
