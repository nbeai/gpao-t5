# TG-3 · 모델 기반 추출 (2026-07-29 · Claude 단일 구현선 · 독립 감사 대기)

신규: `src/runtime/tcell-extractor.js` · 검사 `test/tcell-extractor.test.js`(12건).

## 독립 감사 반영 (P1 4건 + 명세 잔여 + TG-2 P2)

1. **비밀·불량 관찰 차단**(P1) — 모델 입력 자격은 플래그 하나가 아니라 셋: `modelReadable===true`
   **그리고** `containsSecret!==true` **그리고** `validateObservationEvent().ok`. 번들 생성과
   묶음 나누기가 같은 술어(모델에게줄수있나)를 쓴다.
2. **모델 출력 total validation**(P1) — 출력은 임의 JSON 으로 취급. 배열·숫자·`boundary.validWhen:7`·
   `principle:7`·`trace.observationRefs:'ref'` 등 어떤 모양에도 던지지 않고 결과/격리로 귀결.
   모델이 준 confidence 는 받지 않는다(권한이 아니다).
3. **타이머 누수 해제**(P1) — `finally { clearTimeout }`. 실측 효과: 전체 스위트 벽시계
   **22.09s → 11.70s**, 게이트 PASS(CPU 21.7s). 기준선 20s 는 그대로 유지 — 감사 판단이 옳았다.
4. **명세 잔여 5건**(P1) — 번들 상한 **12**(명세 §7.3) · 프로젝트·주제·신호군 묶음(groupObservations) ·
   의미 중복 수렴(normalizeStatement 토큰 단위 한국어 어미·조사 정규화 + 자카드 affinity →
   `same_center` 는 duplicate, `refines` 는 관계로 보고) · 명시적 지시 레인
   (explicitInstruction.scope 안이면 requiresUserConfirmation=false — 마찰 금지, 원칙 0-A-1) ·
   wake 가 기존 `detectCandidate` 결과를 입력으로 받음(정규식은 판단이 아니라 신호).
5. **TG-2 구조 손상 격리**(P2) — `{"cells":"not-an-array"}` `[1,2,3]` `"문자열"` `{"cells":null}`
   모두 `corrupted:true`, 쓰기 경로도 덮어쓰지 않고 격리 보존.

## 실측 메모
한국어 정규화는 문장 끝만 처리하면 "않는다"와 "않습니다"가 갈린다(affinity 0.71) — **토큰마다**
어미·조사를 벗겨 1.0 으로 수렴시켰다. 다른 의미 문장은 0.0 유지.

전체 회귀 **1254건 통과** · 게이트 **PASS**(CPU 21.7s · 벽시계 11.7s) — 자체 검증, 독립 감사 대기.
명시적 잔여(병렬선 통합 시점): TG-2 의 POM read model · DefaultTarget/Skill/Automation `principleRefs`.
