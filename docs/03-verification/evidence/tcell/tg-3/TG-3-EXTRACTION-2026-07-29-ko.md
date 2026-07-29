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

---

# 생산 관통 (2026-07-29 · 3차) — "가짜 모델에서만 도는 추출"을 실제 모델까지 연결

1. **전용 구조화 추출 메시지 경계**(model-provider.js `buildExtractionMessages`) — 추출 호출이
   일반 조립을 타서 실제 모델에게 `user:""` 가 가던 결함을 닫았다. `tc.tcellExtract` 가 있으면
   조립 첫 줄에서 전용 경계로 빠진다. 사실만 싣는다: 이번 발화 · 관찰(참조+요약) ·
   **기존 후보의 중심과 경계**(관계 판정 재료) · 명시 범위 · 출력 JSON 계약. 대화 이력 미포함.
   지시문 예산 상한 검사(900자)로 대본 비대화를 막는다.
2. **실제 어댑터 와이어 관통** — 가짜 HTTP 로 OpenAI·Claude 양 스펙에서 요청 본문에
   관찰 참조(`ledger:s:1`)·요약·기존 후보 중심이 실제로 실려 나가는지 확인. 구성은
   `resolveModelConfigFromInput`(사용자 연결 경로와 동일)으로 만든다. 응답 해석까지 관통.
3. **명시 지시의 안정적 근거** — `observeUserRequest`(참조 `request:세션:턴번호`)를 추가하고,
   생산 경로가 **이번 턴의 그 참조**를 명시 지시 근거로 넘긴다(예전엔 "첫 user_correction"을
   추측으로 집어 정상 발화엔 근거가 없고 옛 정정과 오결합할 수 있었다). 같은 턴 중복 관찰 0.
4. **레인 분리**(정본 S-TG-1) — `preference` 는 기존 기억 레인이 담당하고 추출을 깨우지 않는다.
   `operating_principle` 만 T-cell 레인. TG-2 이관표와 같은 경계로 두 곳이 어긋나지 않는다.
   관통 검사: "앞으로 짧게 요점만" 발화 → T-cell 후보 **0건**.
5. **현재 턴 묶음 우선** — 이번 턴이 만든 관찰 참조를 포함한 묶음에 우선순위를 준다(과거의 큰
   묶음이 현재 발화를 밀어내지 않는다).
6. **관계 보존** — 판정된 relation 을 후보의 growth 에 함께 저장(왜 이 후보가 남았는지의 근거).

검사: 와이어 4건 · 관찰/레인 10건 · 추출 14건 · registry 8건.
전체 회귀 **1263건 통과** · 게이트 **PASS**(CPU 21.9s · 벽시계 11.5s) — 자체 검증.

---

# 재감사 P1 2건 (2026-07-29 · 4차) — 원문 비저장 · 선호 유입 차단

1. **일반 발화 원문을 관찰하지 않는다** — `observeUserRequest` 는 이제 **구조화된 운영 원리
   문장만** 받는다(부르는 쪽이 레인을 판정). 그마저도 저장 직전 `looksLikeSecret` 선별을 거쳐
   비밀 모양이면 일반화 문장으로 바뀌고 모델 가독이 닫힌다. `activeTarget` 도 원문이 아니라
   구조화 문장만 싣는다. 선별은 의미 판정이 아니라 **보관 안전망**이다(자격 접두사 + 고엔트로피
   장문 토큰만 — 목록으로 뜻을 판정하지 않는다).
2. **선호 유입 차단 — 두 겹**
   · 레인: `memorySuggestion.kind === 'preference'` 인 턴은 추출 자체를 건너뛴다.
   · **뿌리**: 정규식이 못 잡는 선호 발화까지 막으려면 레인 판정만으로는 부족했다(실측:
     `detectCandidate` 가 "앞으로 …짧게 요점만 말해줘"를 null 로 반환). 그래서 **이번 턴이 새
     근거를 만들지 않았으면 추출하지 않는다**를 규칙으로 세웠다 — 옛 wake 플래그만으로 과거
     관찰을 다시 처리하지 않는다. 성장은 새 사실에서만 자란다.

반대시험(감사 지정 그대로): 과거 실패 2건으로 wake 가 켜진 세션에서 명시적 선호 발화 →
T-cell 후보 **0**(대조군: 실패 턴에서는 정상 후보 1 생성 확인) · 추출 호출 증가 0 ·
선호 문면이 관찰 파일·추출 입력 어디에도 없음. 비밀·개인정보·일반 발화 원문 관찰 파일 0건.

전체 회귀 **1265건 통과** · 게이트 **PASS**(CPU 22.3s · 벽시계 11.5s) — 자체 검증.
