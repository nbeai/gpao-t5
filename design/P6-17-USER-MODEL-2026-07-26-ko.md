# P6-17 · Hermes 학습 루프 흡수 — Slice-3: User Model Separation

작성: 2026-07-26 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: Hermes user model 흡수(복제 아님, T5 admission 구조로 재구성), 헌법 §3-2·§5(라우터가 raw 기억 안 씀),
§5 Context Mesh. P6-17 학습 루프 세 번째(마지막) 조각. 관련: [[gpao-t5-hermes-absorption-roadmap]].

## 왜

학습 루프에서 가장 위험한 건 **"추정한 것"을 "사용자가 승인한 것"처럼 다루는 것**이다. T5가 관찰로 추정한
성향이 슬며시 모델 입력에 들어가면 사용자가 승인하지 않은 판단이 행동을 바꾼다. 그래서 **추정된 성향**과
**승인된 운영 선호**를 kind/schema/lane/API에서 분리한다.

## 절대 경계

- **inferred_trait(추정된 성향)은 관찰만 — 영향 0.** admittedContext/TaskContextPacket에 **절대** 안 들어간다.
  두 겹 방어: (1) `observed` 레인에만 산다(admittedContext는 `promoted`만 읽는다), (2) `isInfluenceEligible`이
  kind로 한 번 더 거부한다(레인이 뚫려 promoted에 잘못 들어가고 userConfirmed까지 켜져도 영향 0).
- **operating_preference(승인된 운영 선호)만** userConfirmed + admission 이후 좁게 입장(관련될 때만).
  context-mesh preference 게이트를 그대로 재사용(candidates→promoted).
- **추정을 승인으로 자동 승격하지 않는다.** 추정은 관찰일 뿐, 사용자가 명시 확인해야 운영 선호가 된다.

## 계약 (`l1-intent/user-model.js`)

- `makeInferredTrait(id, statement, evidence)` — kind `inferred_trait`, `observedOnly:true`, admitted:false. 승격 대상 아님.
- `makeOperatingPreference(id, statement)` — kind `operating_preference` 후보(영향 0).
- `confirmOperatingPreference(pref)` — context-mesh `promote(pref,{userConfirmed:true})` 재사용 → admitted.
- `projectUserModel(memory)` — **"추정됨"과 "반영 중"을 분명히 분리**: `inferredTraits`(admitted:false,
  influence:'none') vs `operatingPreferences`(pending_confirm / admitted). P6-18 표면이 다르게 보여주기 위함.
- 게이트(context-mesh 개정): `isInfluenceEligible`이 `inferred_trait`를 **항상 false**(tier·userConfirmed와
  독립된 불변식 — 안전 바닥과 같은 방어적 이중화).

## 배선 (UI는 최소 API)

- `memory-store`: `observed` 레인 추가(`{candidates, promoted, observed}`). observed는 admittedContext가 안 읽는다.
- `POST /user-model/traits {statement, evidence}` → observed(관찰). `POST /user-model/preferences {statement}` →
  candidate. `POST /user-model/preferences/:id/confirm` → promoted(admitted). `GET /user-model` → 분리된 뷰.

## 테스트 (7, 총 273)

**inferred_trait 영향 0**(userConfirmed 강제해도 eligible 아님) · **promoted 레인에 잘못 들어가도 admittedContext에
안 섞임** · operating_preference는 확인 전 0·확인 후 관련 시만 입장 · projectUserModel 추정↔선호 분리(안 섞임) ·
서버 추정 관찰·선호 확인 후 admitted(GET 분리) · 추정은 observed에만·promoted엔 없음·admittedContext 제외 · 빈 statement 400.

반대 테스트: context-mesh `isInfluenceEligible`의 inferred_trait 거부를 제거하면 "영향 자격 없음"·"promoted 누출"
테스트가 실패 실측 → gate가 load-bearing(레인 분리는 1차 방어, gate는 2차). 라이브: 추정은 influence:'none' 유지,
운영 선호는 pending_confirm→admitted, 둘이 안 섞임.

## 완료/미완료 (사용자 언어)

- **된 것**: T5가 관찰로 짐작한 것("아침형일 수도")은 **화면에 '추정됨'으로만** 남고 답변에 쓰이지 않는다.
  사용자가 "이렇게 해줘(표로 정리)"라고 명시 승인한 운영 선호만 이후 대화에 반영된다. 짐작이 슬며시 답을 바꾸지 않는다.
- **아직 아닌 것**: 추정 근거의 자동 수집(지금은 API로 명시 기록), 추정→선호 전환 제안 UI, P6-18 표면에서
  '추정됨'↔'반영 중' 카드 구분, 프로필/세션별 격리.

## 남은 후속

- P6-18 표면: '추정됨'(influence none)과 '반영 중'(admitted)을 시각적으로 분리(추정을 근거처럼 보이게 금지).
- 추정 자동 감지(관찰 신호)·추정→운영 선호 전환 제안(자동 승격 아님, 사용자 확인).
- P6-17 마무리 → P6-18 사용자 표면 통합으로 이동.
