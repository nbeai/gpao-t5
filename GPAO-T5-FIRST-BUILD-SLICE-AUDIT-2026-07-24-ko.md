# GPAO-T5 First Build Slice Audit

- Status: `conditional_pass`
- Date: 2026-07-24
- Auditor: Codex
- Audited commit: `2153aa9`
- Target: Phase 5 First Build Slice — Work Chat kernel vertical

## 0. 판정

`조건부 통과`.

Claude Code의 첫 제품 코드 착수는 올바른 방향이다. 순수 ESM JavaScript, 빌드 단계 없음, 런타임 의존성 0이라는 선택은
T3의 dist/치환/산출물 괴리 사고를 피하려는 결정으로 타당하다. 테스트하는 코드가 곧 실행되는 코드라는 점도
절대원칙 1에 맞다.

다만 이 슬라이스를 `제품 품질 통과`로 닫기에는 아직 이르다. 현재는 **결정적 스텁 기반 Work Chat 수직 검증**이다.
실 LLM, 실 connector, 영속 원장, 실제 장기 세션, 실제 visual regression 은 아직 없다. 따라서 다음 단계는 기능 확장이 아니라
사용자 표면과 디자인 품질을 함께 고정하는 밀도화여야 한다.

## 1. 확인한 것

Codex가 실제로 확인한 항목:

- `npm test` 실행: 36개 테스트 모두 통과.
- 로컬 서버 실행: `PORT=4317 npm start`로 Work Chat 서버 기동.
- HTTP 사용자 경로 확인:
  - 단순 대화: fast path 응답.
  - 조사 요청: 도구 실행 후 Truth Ledger confirmed 투영.
  - 슬랙 게시 요청: A2 승인 게이트에서 실행 전 정지.
  - 승인 후 슬랙 게시: 실행 후 confirmed 투영.
  - 메일 발송 불가: 보낸 척하지 않고 blocked/unconfirmed 처리.
  - 차단된 페이지 조사: blocked/unconfirmed + 다음 행동 제시.
- 기본 HTML/CSS 구조 확인:
  - 첫 화면은 채팅 중심.
  - 상태는 작은 칩으로 접혀 있음.
  - 승인 카드는 대화 안에 인라인으로 나타남.
  - Truth Ledger는 작은 `근거 보기` 토글로 접힘.

## 2. 좋은 점

이 구현은 Phase 0~4 문서가 실제 코드로 내려오기 시작한 첫 지점이다.

- Work Chat을 중심에 둔 것은 사용자 원요구와 맞다.
- 전체 14개 화면을 한 번에 만들지 않고 첫 수직 흐름만 잡은 것은 맞다.
- A2 승인 게이트가 대화 안에서 작동한다.
- billing/rate_limit 오분류 테스트가 들어갔다.
- ToolReceipt의 `userSafeSummary` / `diagnosticTrace` 분리 방향이 살아 있다.
- 턴 간 원장 누출을 실서버에서 발견하고 재발 테스트를 넣은 것은 매우 좋다.
- 내부 도구 id가 승인 카드에 노출되던 문제를 라벨로 고친 것도 맞다.

## 3. 조건부 보완 필요

### 3.1 접힌 상태 패널도 사용자 표면이다

현재 `SelfStateSummary.ready`는 실행 가능한 도구를 raw id로 반환한다.

근거:

- `src/kernel/l0-evidence/self-state.js`: `ready`가 `t.id`를 그대로 반환.
- `src/surface/web/index.html`: 상태 패널이 `s.ready.join(', ')`을 그대로 표시.

기본 화면에는 숨겨져 있지만, 사용자가 상태칩을 열면 `web.collect`, `local.file`, `slack.post` 같은 내부 id가 보일 수 있다.
이건 안티 대시보드 원칙의 회색지대가 아니라 사용자 표면 누출이다.

보완 지시:

- 상태 패널의 ready 목록도 `toolLabel` 기준 사용자 언어로 표시한다.
- 테스트에 “상태 패널/summary에서 raw tool id 비노출” 불변식을 추가한다.
- 내부 id는 매칭 키와 diagnosticTrace에만 둔다.

### 3.2 디자인 감사 증거가 부족하다

Claude 보고에는 브라우저 확인이 있었지만 저장소에는 시각 증거가 남아 있지 않다. T3에서 겪은 문제를 생각하면,
Phase 5부터 디자인은 코드 리뷰만으로 통과시키면 안 된다.

보완 지시:

- 데스크톱, 좁은 모바일 폭, 승인 카드 상태, 근거 토글 상태의 스크린샷을 evidence로 남긴다.
- 화면이 OpenClaw/T3 계승선에 있는지 다음 기준으로 판정한다:
  - 채팅이 첫 표면인가.
  - 내부 상태가 화면을 점유하지 않는가.
  - 좌측/상단/입력창/메시지 밀도가 사용자에게 부담스럽지 않은가.
  - 승인·근거·복구가 대화를 끊지 않고 이어지는가.
  - 버튼과 텍스트가 모바일에서 겹치거나 잘리지 않는가.

### 3.3 자연스러움은 아직 스텁이다

현재 `StubModelClient`는 커널 흐름을 검증하기 위한 결정적 응답기다. 따라서 BEAI5 수준의 말귀, 판단, 대화 유연성이
실제로 구현됐다고 볼 수 없다.

보완 지시:

- 다음 밀도화에서 실제 모델 경계 또는 BEAI5 Task Context Packet 생성/투입 경로를 붙인다.
- 스텁 응답과 실제 모델 응답을 같은 시나리오로 비교한다.
- 자연스러움 회귀(S38~S41)는 “말투”가 아니라 사용자의 목적을 알아듣고 막힘 없이 이어가는지로 판정한다.

### 3.4 승인 후 실행 재요청 방식은 더 안전하게 고정해야 한다

UI는 승인 버튼 클릭 시 `r.plan.understoodTask`를 다시 `/turn`으로 보낸다. 현재 slice-1에서는 동작하지만,
실제 모델/도구가 붙으면 원문·계획·승인 grant가 분리되어 꼬일 수 있다.

보완 지시:

- 승인 후에는 가능하면 “원래 Intent/ActionPlan + 승인된 action”을 이어받는 구조로 고정한다.
- 재해석이 필요한 경우에도 원문, understoodTask, approvedActions의 불변식을 테스트한다.

## 4. Phase 5 다음 지시

Claude Code는 다음 순서로 진행한다.

1. `SelfStateSummary.ready` 사용자 라벨화 + raw id 비노출 테스트 추가.
2. First Build Slice 시각 감사 evidence 경로 생성.
3. 데스크톱/모바일/승인 카드/근거 토글 스크린샷 저장.
4. 실제 visual/interaction 체크 결과를 audit handoff에 남김.
5. 그 다음에 BEAI5 모델 경계 또는 실제 모델 어댑터 설계로 이동.

## 5. 상태 언어

현재 상태는 다음과 같이 말한다.

- 맞는 말: `Phase 5 제품 코드 착수 성공`, `Work Chat 첫 수직 흐름 조건부 통과`, `스텁 기반 실행 검증 통과`.
- 틀린 말: `T5 UI 완성`, `BEAI5 대화 성능 구현 완료`, `제품 품질 최종 통과`, `디자인 검증 완료`.

Phase 5 첫 코드는 방향이 맞다. 그러나 T5가 T3의 실수를 반복하지 않으려면, 이제부터 디자인과 사용자 표면을
기능 테스트와 같은 급의 감사 게이트로 다룬다.
