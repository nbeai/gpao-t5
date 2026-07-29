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

---

# 재감사 차단 3건 + TG-2 읽기 실패 (2026-07-29 · 2차)

**공통 뿌리**: 계약의 *모양*은 만들었으나 *결합*을 하지 않았다 — 면제가 근거와, 관계가 재료와,
전체가 생산 경로와 묶이지 않았다. 넷을 함께 묶어 닫았다.

1. **명시 지시 면제를 세 증거로 결합** — 표식(scope)만으로는 면제 0. ① 근거 결합(후보 trace 가
   그 지시를 기록한 관찰을 실제로 가리킴) ② 내용 결합(후보 문장이 지시 문면에서 나옴, affinity)
   ③ **권한 경계**(principle.type 이 authority/automation 이면 내용이 맞아도 면제 없음 — A2/A3 는
   원칙 0-A-1 상 authority gate). 감사 재현("보고서는 목록으로" → "외부 전송 자동화") 그대로 반대시험.
2. **관계 판정에 재료를 되돌림** — 번들의 existingCandidates 가 center·boundary·anchor 를 싣는다
   (버리고 있었기에 애초에 명세 판정이 불가능했다). 판정은 네 증거: 모델 제안(§7.1) · 문장 affinity ·
   중심 근접 · anchor 일치 · 경계 모순. **경계 모순은 어떤 유사도보다 앞선다**(contradicts).
   중심이 같고 자리가 같고 충돌이 없으면 same_center — 문장 표현 차이는 center 가 추상할 몫이다.
   구조 수정 1건: **anchor 는 모델 주장이 아니라 OS 사실**(§7.2)이므로 근거 관찰에서 유도한다.
3. **생산 경로 연결** — server 후처리에서 `관찰 기록 → wakeSignal(관찰 + 기존 정규식 memorySuggestion)
   → groupObservations → buildEvidenceBundle → extractCandidate → registry.upsert`. 응답 뒤에만,
   in-flight 하나만, 실패는 응답에 닿지 않는다. 저장은 M1/격리·영향 none — TaskContext 미접촉.
   관통 검사: 실패 2회 턴 → 후보가 실제로 registry 에 남고 영향 0(제품 동작 검사).
4. **TG-2 읽기 실패** — ENOENT 만 신규 저장소. 그 밖의 읽기 오류는 **변경 자체를 중단**하고 기존
   저장소를 보존(0o000 재현 반대시험).

검사 14+8+7건 · 전체 회귀 **1258건 통과** · 게이트 **PASS**(CPU 21.8s · 벽시계 11.3s) — 자체 검증.
