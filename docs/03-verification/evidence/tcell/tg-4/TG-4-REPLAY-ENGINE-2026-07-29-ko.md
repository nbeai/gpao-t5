# TG-4 · Replay 엔진과 통계 (2026-07-29 · Claude 단일 구현선 · 독립 감사 대기)

신규: `src/kernel/l5-growth/tcell-replay-engine.js` · 검사 `test/tcell-replay-engine.test.js`(11건).
**배선 없음** — TG-2 저장소·TG-3 후보를 실제 입력으로 소비하지 않는다(통합은 자체 검증 뒤 단계).

## 구조 경계 (§9.3) — replay 는 실행하지 않는다
도구·손·네트워크·파일을 **인자로도 받지 않고 import 하지도 않는다.** 계획과 authority 결정
수치만 비교한다. 검사로 고정: 소스에 실행 수단(tools·fetch(·handler(·exec·spawn·runCommand·
require(·import(·writeFile·appendFile·child_process) 문자열 0 · import 는 `tcell-core`·`tcell-replay` 둘뿐.
(원리 *종류* 이름 `execution` 은 실행 수단이 아니므로 검사에서 분리한다.)

## 구현
- 5종 replay(§9.1): structural(계약 검증) · historical/transfer/boundary(사례 기대 대조) ·
  counterfactual(baseline vs candidate 수치 비교).
- 최소 suite(§9.2): positive·negative·boundary 필수, **행동과 연결되는 원리**(execution/automation/
  authority/workflow)는 authority 사례도 필수. 빠진 사례가 있으면 전체 통과가 아니다 —
  "안 돌려서 실패가 없다"는 통과가 아니다.
- Wilson 하한(§10.1): 외부 라이브러리 0. 표본 없음·이상 입력은 0, 범위 0..1.
- **성공 판정은 exit 0 이 아니다**: 개선 관찰 + 사용자 정정·권한 위반·wrong-anchor 없음.
- counterfactual 은 **마찰 지표**(불필요 질문·턴 수·도구 호출·정정)를 함께 본다 — 정확도가 올라도
  마찰이 늘면 통과가 아니다(원칙 0-A-1·§0.1 효과 판정).
- 전이(§10.2): 임계 상수 한 곳(TCELL_THRESHOLDS). 서로 다른 turn 근거 2개 미만이면 M1 상한.
- `applyTransition` 은 **authority tier 를 건드리지 않는다** — 성숙도가 올라도 승인 요구는 그대로.

## 명세 TG-4 검사 5건
1. positive 만 통과 → 승격 실패 ✓ (+최소 suite 미달·사례 0건도 통과 아님)
2. negative 가 정상 흐름을 망치면 실패 ✓
3. authority case 실패면 **격리** — 표본 100/100 이어도 quarantined·영향 none ✓
4. 점수가 높아도 A2 자동 승인 0 — 승격 후에도 requiresUserConfirmation 유지 ✓
5. replay 통과한 A0/A1 원리는 불필요한 승인 없이 M3 제한 범위 입장 가능(plan_hint·default_value),
   단 answer_anchor 는 아님 ✓
추가: total function(임의 입력 무예외 — 비배열 cases 방어 결함 1건을 검사가 잡아 수정) ·
전이 계단(근거 turn·표본·정정률·transfer 각각의 상한).

전체 회귀 **1276건 통과** · 게이트 **PASS**(CPU 23.2s · 벽시계 11.6s) — 자체 검증.
