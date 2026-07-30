# T5 T-cell 최종 개발계획

- 작성: 2026-07-31 · 정리: 구현선 Claude (v3 기반, v3 재감사의 동결 4건 완결 통합)
- 지위: `FINAL_FOR_COMPLETENESS_AUDIT` — Codex 완결성 1회 감사 → 오너 확인 1회 → 문서 단계
  영구 종료, S0 구현 직진.
- 이 파일은 T-cell 구현의 **단일 완결 정본**이다. v1~v3, 퇴역 TG/CX 문서, Git 과거본을 구현
  계약으로 참조하지 않는다. 이후 보고는 문서가 아니라 코드 diff·수정 전 실패한 반대시험·실제
  사용자 시나리오 결과로만 한다.
- 원칙: 현재 T5 코어 유지. 오너 확인 전 T-cell 제품 코드 0.

## 0. 목적과 제품 위치

T-cell은 사용자를 앞에서 심사하는 기관이 아니다. 사용자가 일을 마친 뒤 남은 경험을 조용히
관찰하고, 반복되는 작동원리를 근거와 함께 성장시키며, 검증된 범위에서만 다음 작업을 더 잘
이어 주는 **백그라운드 성장 기관**이다.

성공은 상태명·테스트 수가 아니라 다음 사용자 경험으로 판정한다.

- 가역적인 기억은 카드 없이 반영되고 한 턴에 철회된다.
- 같은 경험을 반복하면 새 대화에서 다시 설명하지 않아도 된다.
- "아까 그 최종본"이 사람·작업·산출물 범위 안에서 정확히 이어진다.
- 현재 지시는 과거 기억보다 항상 우선한다.
- 무관한 기억은 끼어들지 않고, 민감정보는 성장 입력·장기 기억에 들어가지 않는다.
- 성장 때문에 사용자 턴이 느려지거나 질문·카드·클릭이 늘지 않는다.

## 1. 봉인 기준선과 목표

| 사용자 문장 | 현재 T5 봉인 실측(3회) | T-cell 목표 |
|---|---|---|
| H01 "앞으로 보고서는 목록으로" | 카드1·클릭1, 3/3 | 카드·클릭 0, 즉시 반영, 되돌리기 노출 |
| H04 "방금 기억한 보고서 형식 선호는 취소해줘" | 실패 3/3 | 한 턴 철회, 말·상태·원장 일치 |
| H02 같은 정리 3회 뒤 새 대화 "10월 것도" | 오독·재질문, 학습 0 | 재질문 0, 과잉 일반화 0 |
| H05 새 대화 "아까 그 최종본 이어서 정리해줘" | 승계 0, 3/3 | 정확한 산출물 승계, 내부 ID·경로 추측 0 |
| H07 "이 키 기억해둬" | 장기 기억 유입 0 | 회귀 금지 |
| H03 "이번 보고서만 표로" | 2/3 | 현재 지시 우선 |
| H06 "지금 몇 시야?" | 무관 불개입 | 회귀 금지 |

H08 파일 손, H09 실패 뒤 다른 길, H10 에이전트 위임은 T-cell 봉인 뒤 별도 슬라이스다.
T-cell이 그 범위를 대신 구현하거나 완료를 주장하지 않는다.

## 2. 코드로 확인한 전제 (어긋나면 그 슬라이스를 멈추고 사실 표기만 정정)

| ID | 현재 사실 | 재확인 |
|---|---|---|
| P1 | 웹 답변은 SSE로 흐르지만 턴 꼬리의 기억 처리는 `complete` 전에 동기 실행된다 (`server.js:263-405`, `:593`, `:642`) | S1·S2 |
| P2 | 세션 transcript·ledgerEntries·기억 원장은 durable 저장된다 (`session-store.js`, `memory-store.js:121`) | S0·S2 |
| P3 | 유일한 주기 실행 기반은 `AutomationScheduler` tick이다 (`automation-scheduler.js:17`, `server.js:186,1629`) | S2 |
| P4 | 승격 단일 통로 `confirmCandidate`(`context-mesh.js:118`), 입장 단일 관문 `admittedContext`(`:71`), 모델 입장 단일 지점 `[반영된 기억]`(`model-provider.js:114`) | 전 슬라이스 |
| P5 | `MemoryStore.load()`는 손상 시 조용한 빈 상태를 반환한다 (`memory-store.js:31-37`) | S1 |
| P6 | 모델 통제 채널은 `memory.propose`뿐 — 철회 채널이 없다 (`model-control.js:15`) | S1 |
| P7 | 일반 웹·SSE·채널의 저장 항목에 공통 불변 turn 신분이 없다. `EventLog`의 turnId는 스트림 경로에만 있다 | S0 |
| P8 | `modelFor(role)`은 role binding이 없으면 활성 연결로 fallback한다 — 라벨과 실체가 갈린 실패 이력 있음 | S4 |
| P9 | 현재 `connectionId`는 `provider:modelId` 문자열이라 자격·endpoint를 구분하지 못한다 | S4 |
| P10 | 현재 provider client는 최종 응답에서 모델 신분을 공통 반환하지 않는다 | S4 |

전제 정정은 계획 재설계의 근거가 아니다 — 사실 표기만 바로잡고 진행한다.

## 3. 절대 불변식

1. **현재 요청 우선**: 과거 기억·원리·lane은 현재 사용자의 명시 지시를 덮지 못한다.
2. **retrieved ≠ admitted ≠ shown ≠ used**: 조회·입장·프롬프트 노출·모델 사용 주장을 서로
   다른 사실로 기록한다.
3. **최소 제약·최대 자동화**: 가역 로컬 학습은 자동이다. 외부 전송·공개·결제, 중대한 삭제,
   새 지속 권한만 사용자 확인을 요구한다.
4. **모델 능력 보존**: OS는 사실·범위·권한·근거를 공급한다. 정규식·금지문으로 의미 판단을
   대신하지 않는다.
5. **응답 뒤 성장**: S0의 O(1) turnRef 기입과 명시된 데이터면 추가 외에 T-cell 학습·모델
   호출·durable 조회를 사용자 턴에 추가하지 않는다.
6. **통계는 권한이 아니다**: 성숙도·반복 횟수·replay 통과는 A2/A3 권한을 만들지 않는다.
7. **원문·비밀 최소화**: 민감값은 장기 기억과 성장 모델 입력에서 차단한다(dab56f6 경계 재사용).
8. **가역성 우선**: 자동 감쇠·철회·archive는 원장과 복원 경로를 가진다. 자동 영구 삭제는 없다.
9. **이름은 사실 뒤에 온다**: 검증되지 않은 값을 `applied`·`verified`·`executed`라 부르지 않는다.
10. **제품 경로가 증거다**: 직접 함수 호출·손 fixture만으로 슬라이스를 닫지 않는다. 실제
    서버·실제 표면·지정 모델의 사용자 문장 통과만 완료 증거다.

## 4. 공통 데이터·생산 계약

### 4.1 TurnRef와 정확히-한-번 처리

모든 웹 일반 턴·SSE 턴·채널 턴은 저장 시점에 `TurnRef = {sessionId, turnSeq}`를 갖는다.

- `turnSeq`는 세션 안에서 단조 증가하며 세션 저장과 같은 직렬화 경계에서 발급한다.
- transcript의 user/assistant 항목, 그 턴의 ledger 항목, TurnEvent가 같은 TurnRef를 공유한다.
- 기존 세션은 저장 순서로 소급 부여하고 `migratedTurnRef: true`를 남긴다. 소급 귀속이
  불가능한 항목(과거 ledger)은 seq 없이 migrated 표시만 남긴다 — 사실을 지어내지 않는다.
- 워커 watermark는 전역 숫자가 아니라 `{sessionId → lastProcessedSeq}` 지도다.
- 파생 산출물 ID는 원천 TurnRef 집합의 결정적 digest다. 재처리해도 중복되지 않는다.
- 결과 저장과 watermark 전진은 한 원자 쓰기다. 실패하면 둘 다 전진하지 않는다.
- 세션 간 전역 순서는 **요구하지 않는다**(명시적 비요구). 세션 횡단 묶음은 결정적 ID로 합친다.

반대시험: 웹·SSE·채널 스키마 동일 · 같은 턴 이중 처리 0 · 두 세션 교차 저장 누락 0 ·
파생 쓰기 실패 뒤 재시작 누락 0 · migration 반복 0.

### 4.2 자동 기억의 발화 신분·내용 결합

모델은 `memory.propose`에 `{kind, statement, evidence:{utteranceQuote, speechAct}}`를 낸다.
`speechAct = declaration | question | quotation | negation | recollection | unknown`.

자동 가역 반영(auto_reversible)은 전부 성립할 때만:

- `utteranceQuote`가 **이번 턴** 사용자 원문의 부분 문자열이다(기계 대조).
- `speechAct === 'declaration'`(판단은 모델의 것 — 2축).
- `kind === 'preference'`.
- **`statement === utteranceQuote`** — 저장 내용은 사용자 원문 인용 그 자체다. 요약·정규화·
  확장 statement의 자동 승격은 구조적으로 불가능하다(의미 결합을 구성으로 보장).
- 민감정보 경계(dab56f6)를 통과한다.

요약된 statement·operating_principle·recalled_context는 기존 확인 통로 또는 S4 replay로만
간다. 표면과 `[반영된 기억]`에는 자동 반영된 **사용자 원문 그대로**를 보여 준다.

반대시험: 질문·인용·부정·회상·과거 턴 인용 위조·statement 불일치·민감값 → 자동 반영 0.
실제 선언 → 카드 0으로 반영 1.

### 4.3 관찰·묶음·후보 상태기계

```
observation → bundle → candidate → replay_pending → replay_passed | replay_failed
  → admitted → effect_audit → decayed | quarantined | archived | withdrawn
```

- observation·bundle·candidate는 영향 0이다(admittedContext가 읽지 않는 레인).
- 모든 전이는 `withMemory` 직렬화 안의 현재 상태 가드 + 원자 쓰기 + MemoryLedger 기록.
- `replay_pending` 중 크래시 → 다음 tick이 같은 ID를 멱등 재처리한다.
- terminal 상태는 자동 부활하지 않는다. 사용자 pin 항목은 자동 감쇠·TTL을 우회한다.
- 미사용만으로 promoted 기억·원리를 감쇠하지 않는다(감쇠는 §4.5 상관만).

### 4.4 ReplayCase와 실행 영수증 결합 (동결 F3 완결)

```text
ReplayCase = {
  caseId, principleId, principleVersion,
  kind: positive | negative | boundary | authority,
  sourceRefs: TurnRef[],
  inputFacts, expectedFacts, forbiddenFacts,
  caseInputDigest,          // 위 필드 전체의 canonical digest
  runReceiptRef,
  verdict: { pass|fail, rationale, citedCaseRefs }
}
ReplayCallReceipt = {
  receiptId, purpose: 'tcell_replay',
  caseId, principleId, principleVersion,
  caseInputDigest, requestDigest, outputDigest,
  modelCallIdentityRef,     // §4.6
  startedAt, finishedAt, state
}
```

- replay 호출은 도구·네트워크 행동·파일 행동 없이 모델 판단만 수행한다.
- 어댑터 경계가 호출 직후 영수증을 저장한다. **전이 함수는 호출자가 넘긴 객체를 믿지 않고
  저장소에서 `runReceiptRef`를 조회**하며, 다음이 전부 일치해야 실행 증거다:
  purpose · caseId · principleId · principleVersion · `caseInputDigest`↔실제 requestDigest 결합 ·
  저장된 모델 출력 digest↔receipt outputDigest · §4.6의 검증된 ModelCallIdentity · 완료 상태.
  → **정상 영수증을 엉뚱한 케이스에 붙이는 것이 구조적으로 불가능하다.**
- verdict는 그 영수증의 저장 출력에서만 생성한다. baseline은 당시 저장된 실제 응답·결과,
  candidate는 동일 case input에 원리를 제한 역할로 주입한 replay 출력이며, OS는
  expectedFacts·forbiddenFacts와 두 출력을 모델에 제시하고 결과를 기록한다. 의미 판정은
  모델의 것, 실행·계보·결합 검증은 OS의 것.
- 최소 suite: positive ≥2(실패 0) · negative ≥1(forbiddenFacts 발생 0) · boundary ≥2(침범 0) ·
  A2/A3와 닿을 수 있으면 authority ≥1(권한 확대 0). 표본 없음·판정 불가는 통과가 아니다.

반대시험: 무관 정상 receipt 재사용 · case/principle/version/digest 하나만 불일치 · 출력 교체 ·
계보 부재 · negative 0건 · authority 누락 · 미완료 receipt → 전부 승격 0.

### 4.5 보임·모델 주장·정정 상관 (shown ≠ used)

- `shownMemoryRefs`(사실): `[반영된 기억]`에 실제 렌더된 ID.
- `modelCitedRefs`(모델 주장): 통제 채널 `memory.cite {usedRefs}` — `usedRefs ⊆ shownMemoryRefs`만
  허용(허공 인용 거부), **주장으로 라벨링**해 저장.
- `correctionCorrelation`(통계): 사용자 정정 턴에서 직전 관련 턴의 shown∩cited 항목에 남기는
  표식. **독립 상관 2회 전 자동 감쇠 금지.** 감쇠는 가역(원장·표면·복원 경로).

모델 내부 사용은 관측 불가 — cited를 적용 사실로 부르지 않는다(불변식 9).

반대시험: shown-only(uncited) 감쇠 0 · 상관 1회 감쇠 0 · 허공 cite 거부 · 상관 2회에만 가역 감쇠.

### 4.6 실제 모델 호출 신분 (동결 F5 완결)

역할 이름·`provider:model` 문자열을 호출 신분으로 쓰지 않는다.

- 모델 연결 저장 레코드는 비밀값과 별도의 불투명 `connectionInstanceId`·`credentialRef`를
  갖는다. 같은 provider/model이라도 자격·endpoint가 다르면 다른 instance다. 기존 연결은
  migration에서 1회 ID 부여. 비밀 원문·해시 조각은 영수증에 넣지 않는다.
- `modelFor(role)`의 실제 선택은 client만이 아니라 선택 증거를 만든다:
  `ModelSelection = {requestedRole, resolution: bound|active|env|stub, connectionInstanceId,
  credentialRef, providerId, endpointOrigin, requestModelId}`.
- 어댑터는 실제 fetch 기준으로 저장한다:
  `ModelCallIdentity = {callId, selection, actualEndpointOrigin, actualRequestModelId,
  responseModelId: string|null, responseIdentitySource: response_field | response_event |
  model_addressed_endpoint | not_reported, usage, startedAt, finishedAt}`.
- provider가 응답 model을 주면 원문 응답에서 추출해 요청과 호환 검증한다. 모델이 URL에
  포함되는 provider는 실제 호출 URL이 응답 신분 근거다. 응답이 model을 보고하지 않으면
  `not_reported`로 남기고 "응답 모델 검증됨"을 **주장하지 않는다**(P10과 정합).
- role fallback은 허용하되 `resolution`에 실제 선택을 기록한다. 배경 호출의 증거는 요청
  라벨이 아니라 실제 selection이다.
- endpoint·request model·connection instance·credentialRef 중 하나라도 실제 호출과 다르거나,
  응답 model이 보고됐는데 호환되지 않으면 **산출물 격리 + 성장 중단 + 표면 경고**.
- replay 증거 자격은 실제 selection·endpoint·request model이 검증되고 provider가 선언한
  response identity 정책을 충족한 호출만 갖는다.

반대시험: 빈 role binding의 활성 fallback · 같은 provider/model 다른 자격 · 같은 model 다른
endpoint · 응답 model 변경 · 응답 model 미보고 · env fallback · stub → 각각 신분이 갈리고
허위 `verified` 0.

### 4.7 사용자·작업·산출물 scope (동결 F6 완결)

`scopeRef = {principalRef, workspaceRef?, artifactRefs[]}`

- **principalRef**(불투명 사용자 신분): 로컬 설치는 부팅 시 지속되는
  `localOwnerPrincipalRef` 하나를 만든다. 웹 로컬 턴은 이 principal이다. 채널 계정은
  connector 설정에 저장된 `{connectorId, channelAccountId, principalRef}` **binding이 있을
  때만** 같은 오너로 해석한다 — 이미 이루어진 오너 연결 결정을 재사용하며 매 턴 승인을
  추가하지 않는다. binding 없는 채널 사용자는 별도 principal 또는 미상이고 오너 lane을 받지
  않는다. **payload가 principalRef를 주장해도 binding store 조회가 이긴다**(위조 무효).
  → 웹 상수와 channelUserId가 실제로 결합되는 경로가 코드에 존재한다.
- **workspaceRef**: 성공한 ToolReceipt의 실제 대상 경로를 file-scope 인정 루트에 상대화한
  불투명 ID. 모델 activeGoal·임의 경로 문자열은 workspace 신분이 아니다.
- **artifactRefs**: `{kind:'file', pathRef, digest, receiptRef}` — 성공 receipt에서만.
  `{kind:'response', turnRef, digest}` — 저장된 assistant 턴에서만. "최종본"의 실체를 경로+
  내용 digest로 특정한다.
- `activeGoal`은 `assumedLabel`로만 부기하고 scope 판정에 쓰지 않는다. scope 파생 불가 항목은
  기본 미공급. 후보 둘 이상이면 사실·출처를 나열하고 OS가 임의 선택하지 않는다.

반대시험: 같은 오너 웹↔binding 채널 승계 공급 · binding 없는 채널 미공급 · payload 위조 무효 ·
같은 표면 다른 workspace 격리 · artifact digest 불일치 검출 · response-only 최종본 승계 ·
scope 미상 미공급.

### 4.8 응답 뒤 워커와 실패 격리

- T-cell 워커는 기존 scheduler를 쓰되 자동화 tick과 **독립 오류 경계**를 갖는다.
- 워커는 저장된 TurnRef 이후의 durable 산출물만 읽고 세션 턴 큐를 잡지 않는다.
- `withMemory` 쓰기 동안 외부 모델을 기다리지 않는다(호출과 저장 전이 분리).
- 연속 실패 3회면 T-cell 워커만 격리 + 원장 + 사람말 경고.
- T-cell 실패가 자동화 tick·사용자 턴을 막지 않고, 역도 성립(반대시험: 상호 예외 주입).
- kill switch는 T-cell 워커·성장 호출만 끈다. 현재 코어 기억은 유지.

### 4.9 저장 정직성

- `MemoryStore.load()`에서 **ENOENT만** 신규 빈 저장소다. 파싱·권한·I/O 오류는 빈 상태로
  위장하지 않는다.
- 손상 파일은 격리 사본 보존 + `corrupted` 상태 + 사람말 경고. 복구 전 새 자동 기억·성장
  전이 중단. archive·withdraw·decay는 원장과 restore 경로를 갖는다.

반대시험: memory.json 파손 주입 → 빈 상태 위장 0 · 경고·격리 발생 · 기존 promoted 비손실.

### 4.10 상한과 성능 (고정값)

| 항목 | 값 |
|---|---|
| observations | 세션당 200 · 전체 2,000 · TTL 30일 |
| bundles | 전체 300 |
| ActiveWorkLane | 전체 100 · TTL 14일(갱신 시 연장) |
| grace floor | 감쇠·TTL 뒤 7일 복원 창 |
| pin | 자동 감쇠·TTL 면제 |
| 성장 모델 호출 | tick당 ≤2 · 일일 ≤50 · kill switch |
| 전경 성능 | 기준선 대비 p95 턴 완료시간 +5% 이내 |

TTL은 observations·lanes에만 적용. promoted 기억·원리는 미사용만으로 감쇠하지 않는다.

## 5. 수정 허용·금지 경계

허용: ① 기억·맥락 kernel(context-mesh, user-model, memory-store, model-control) ② 신규 성장
모듈 `src/kernel/l5-growth/tcell-*` ③ server의 기억 API·워커 배선 ④ l0-evidence의
TurnRef·receipt·모델 호출 증거 확장 ⑤ model connection/provider의 실제 선택·응답 신분
envelope ⑥ `[반영된 기억]` 렌더와 기억 UX ⑦ channel connector의 principal binding 투영
⑧ schema migration·테스트.

금지: 계획·도구 선택·실행 정책을 바꾸는 turn.js 분기 · ToolRunner 실행 의미 · authority
등급과 A2/A3 경계 · file-scope·local-locate 허용 범위 · automation A3 계약 · T-cell 결과를
Skill·Trigger·Agent가 실제 소비하는 후속 배선.

S0의 O(1) TurnRef, S1의 shown/cite, S3의 lane 공급처럼 **명시된 데이터면 추가만** 턴 경로에
허용한다. 백그라운드 durable I/O·성장 모델 호출이 턴 경로에 들어오면 차단.

## 6. 구현 슬라이스

### S0. TurnRef 배선
범위: §4.1 스키마·발급·migration·watermark 기반.
완료: 웹 일반·SSE·채널 생산 경로의 저장 항목에 같은 TurnRef 계약 · 동시 턴·재시작·두 세션
교차 저장 반대시험 · 사용자 가시 변화 0 · 기존 회귀 0.

### S1. 무마찰 가역 기억과 철회
범위: §4.2 자동 기억 · `memory.withdraw` 통제 채널 · §4.9 저장 정직성 · 기억·되돌리기 표면.
완료: H01 카드·클릭 0 · H04 한 턴 철회(말·상태·원장 일치) · H07·H03·H06 회귀 ·
질문·인용·부정·회상·위조·민감값 반대시험 · 손상 저장소 위장 0 · 실제 서버·gpt-5.1 라이브 3회.

### S2. 응답 뒤 관찰 shadow
범위: §4.3의 observation·bundle까지만 · §4.8 워커·watermark·멱등 · §4.10 상한.
모델 호출 0, 프롬프트 영향 0.
완료: 턴 경로에 background durable I/O·모델 호출 0(diff 감사) · 관찰 적재·크래시 재개·중복·
누락 반대시험 · 자동화 tick 상호 실패 격리 · p95 +5% 이내.

### S3. 대화 경계 승계
범위: §4.7 principal·workspace·artifact scope · ActiveWorkLane · 새 대화의 사실 블록 공급.
완료: H05 새 대화 승계 성공 · H06 무관 불개입 · 웹↔binding 채널 같은 오너와 다른 사용자 격리
관통 · file/response artifact·digest 불일치·다중 후보·scope 미상 반대시험 · 내부 ID·원시 경로
추측 0.

### S4. 반복 학습과 실질 replay
범위: candidate·replay 상태 · §4.4 실행 결합 · §4.6 모델 신분 · 제한 역할 원리 입장.
완료: H02 새 대화 재질문 0·과잉 일반화 0 · unrelated receipt/digest/case/version 위조 전이 0 ·
최소 suite와 authority 반례 · role fallback·다중 자격·다중 endpoint·응답 신분 관통 ·
replay 미통과 원리 입장 0 · 외부 행동 0 · p95 +5% 이내.

### S5. 사후 교정과 성장 표면
범위: §4.5 shown/cited/correlation · 가역 감쇠·격리 · pin·archive·restore · 기억·원리·lane 표면.
완료: 정정 뒤 같은 오적용 재발 0 · 무관 기억 감쇠 0 · 상관 1회 감쇠 0 · 기억·원리·lane을 보고
철회·pin·archive·restore 가능 · 자동 처리에 매번 카드를 요구하지 않음.

## 7. 슬라이스 실행·감사 프로토콜

각 슬라이스는 한 번에 제출한다: ① 구현 ② 핵심 반대시험이 수정 전 코드에서 실패했음을 실측
③ 전체 회귀·`audit:docs`·`audit:workspace`·gate ④ 해당 사용자 문장을 실제 서버·지정 모델로
실행 ⑤ 증거·인수인계 갱신 ⑥ Codex는 그 슬라이스 완료 조건만 1회 감사.

발견 분류는 셋뿐: **A**(현재 슬라이스의 사용자 성공·안전·증거 무효화) · **B**(후속 슬라이스의
명시 책임) · **C**(개선 관찰). B·C로 계획을 재개봉하지 않는다. 같은 예방 가능 유형이 한
슬라이스에서 재발하거나 같은 슬라이스가 2회 차단되면 구현·감사를 즉시 교대한다.

## 8. 필수 결과와 후속 계약

T-cell 봉인 시 전부 성립해야 한다:

1. 현재 요청이 과거 기억보다 우선한다.
2. 전경은 성장 durable I/O·성장 모델을 기다리지 않는다.
3. observation부터 withdrawal까지 수명주기가 실제 생산 경로로 닫힌다.
4. replay는 실제 case 실행·모델 신분이 결합된 저장 증거다.
5. 가역 기억은 자동이고 사용자는 사후에 보고 고칠 수 있다.
6. 승인·권한은 T-cell 성숙도와 분리된다.
7. 민감정보·scope·사용자 경계가 유지된다.
8. H01~H07 목표가 실제 사용자 문장으로 확인된다.
9. 원리는 후속 자동화가 읽을 안정 스키마를 가진다:
   `PrincipleEntry = {principleId, version, statement, influenceScope, evidenceRefs,
   replayReportRef, stats:{shown, cited, correlated}, scopeRef, state}` — T-cell은 스키마까지만
   제공하고 소비는 구현하지 않는다.
10. 인수인계와 현재 제품 상태가 일치한다(`audit:docs`).

봉인 뒤 순서: ① H01~H10 동일 조건 전후 재측정 ② 파일 손 H08·H09 별도 슬라이스
③ Skill·Trigger·Cron·Bounded Agent와 H10 위임 ④ 한국 사장님용 도구 편입 ⑤ T5 전체의
최소 제약·최대 자동화 마감.

## 9. 중단 신호와 최종 종료

즉시 중단: T-cell이 현재 지시를 덮는다 · 가역 로컬 학습에 새 승인·카드·클릭을 추가한다 ·
성장 I/O·성장 모델이 사용자 턴에 들어온다 · 모델 추정이 사용자 사실·권한·scope로 저장된다 ·
실제 실행과 결합되지 않은 receipt로 replay가 통과한다 · 역할 이름·provider:model 문자열을
호출 신분으로 쓴다 · scope 미상을 공용 scope로 합친다 · 민감값이 성장 입력·장기 기억에
들어간다 · 이름이 검증된 사실보다 앞선다.

최종 종료: S0~S5가 각각 코드·반대시험·생산 관통·라이브 사용자 문장·독립 감사로 닫히고,
H01~H07이 §1 목표와 회귀 금지선을 지키며, 전체 회귀·문서·작업장·공식 gate가 통과하고,
오너가 실제 경험을 확인한다. 문서 수·상태명·테스트 수만으로 완료를 주장하지 않는다.
