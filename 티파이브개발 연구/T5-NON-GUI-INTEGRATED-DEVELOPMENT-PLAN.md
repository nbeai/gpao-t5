# T5 비GUI 통합 개발 계획 — 지능·방법·문서·청각·성능

기록일: 2026-08-31
기준 source: `7a47f69afb1480c887d7bf641dad062c584e28f9`
상태: `ABSORBED_INTO_T5_NX · RESEARCH_HISTORY · NO_LONGER_CURRENT_DEVELOPMENT_SOURCE`
현재 제품 변경: `0`

## NX-2 승계 상태

이 문서는 현재 개발 계획이 아니라 6차 이후 비GUI 연구를 NX로 전환한 역사다. 남은 제품 개발 책임은
`T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md`로 승계됐다.

- NG-0·NG-1·NG-2: 완료된 성능·streaming·Tool economy 역사로 재개하지 않는다.
- NG-3: NX2-3 Cognitive Flow·Practical Judgment 자격으로 승계한다.
- NG-4·NG-5: NX-1 Reality·Method·Evidence·Closure에 흡수됐으므로 다시 만들지 않는다.
- NG-6: NX2-4 Auditory Intelligence로 승계한다.
- NG-7: NX2-7 Experience Promotion으로 승계한다.
- NG-HQ: NX2-HQ의 속도·정확성·결과 품질·인간 체감과 clean second pass로 강화됐다.

따라서 이 문서의 세부 순서로 제품 Gate를 열지 않으며, NX-2 정본과 충돌하면 NX-2가 우선한다.

## 0. 범위와 판정

이 계획은 `티파이브개발 연구/`의 모든 문서와 현재 6차 source·증거를 대조해 작성한 비정본 후속 개발안이다.
현재 6차 완료 상태를 다시 열거나, 연구 문서의 모든 아이디어를 한 번에 제품에 넣는 계획이 아니다.

이 계획에서 제외하는 GUI는 다음을 뜻한다.

- 새 Desktop Computer Use Hand
- AX/UIA·화면 캡처·좌표 행동
- Console CSS·레이아웃·시각 디자인 재개발
- 레거시 GUI source 복원

다만 이미 제품에 존재하는 Browser Hand의 **호출 계약과 성능**, 그리고 모델 답변을 실시간 전달하는 **응답
스트리밍**은 GUI 기능 확장이 아니라 현재 실행·소통 경로의 성능이므로 포함한다.

최종 판정:

> 현재 T5는 새 Agent framework가 필요한 상태가 아니다. 이미 선 Context·Work·Terminal·File·Document·Browser·
> Artifact·Undo·Capability·Experience Growth를 보존하면서, 모델 왕복과 Tool contract의 밀도를 높이고, 복합 문서
> 현실과 청각 현실을 기존 Android 순환에 결속하는 것이 다음 개발의 중심이다.

---

## 1. 연구실 전체 자료에서 확인한 공통 원리

연구실 자료는 기능 목록이 아니라 다음 하나의 순환을 서로 다른 깊이에서 설명한다.

```text
사용자 목적과 현재 교정
→ 현재 Reality·Context
→ 모델의 Speak / Observe / Ask / Act / Compose / Make / Stop 판단
→ 가장 적절한 Hand 또는 임시 Method
→ 실제 실행·Effect·Artifact
→ 독립 readback·coverage·unknown
→ 사용자 결과·교정·중단
→ 검증된 경험만 다음 목적의 후보
```

문서별 역할:

| 연구 | 역할 | 현재 제품과의 관계 |
|---|---|---|
| Cognitive Flow | 전체 판단·행동·교정·중단 순환 | 5·6차에 상당 부분 구현, 남은 실패만 보강 |
| Practical Judgment | 사용자 표현 격차와 적정 깊이 | 제품 미적용, rigidity 위험이 큼 |
| Method Runtime | 여러 Hand를 bounded 방법으로 조합 | 실제 model/tool 왕복 병목이 재현돼 연구 개통 조건 성립 |
| Document Reality | 복합 문서의 인식·관계·근거·대사 | 현재 기반은 강하나 혼합 packet의 반복 실제 자격 부족 |
| Auditory Intelligence | local audio/video 청각기관 | 현재 명시적 STT gap, 제품 구현 0 |
| Cognitive Flow HQ | 위 후보의 실제 인간 자격 | 후보가 생긴 뒤에만 실행 |
| Computer Use | 마지막 desktop GUI Hand | 이 계획에서 제외 |

---

## 2. 현재 T5의 정확한 출발점

### 2.1 이미 완성된 기반

#### 판단·Context

- Direct 요청은 Work·Tool 없이 답할 수 있다.
- 실제 Hand가 필요할 때만 Work가 결속된다.
- directory-first Tool surface와 `tool_search`가 있다.
- 관련 Memory 후보와 exact source reopen이 있다.
- current user correction이 과거 Memory·Skill보다 우선한다.
- Evidence 중복·오래된 Browser 관측을 logical transcript에서 축약한다.
- provider continuity와 model fallback의 portable canonical context가 있다.
- 충분한 결과 뒤 자연스럽게 종료하는 Natural Agency가 있다.

#### 실행·회복

- Terminal foreground·background·PTY·stdin·resize·cursor output·대출력 회수
- managed process parent-death containment·restart settlement·Stop·late effect 차단
- effect preflight·before/after observation·unknown·blind retry 차단
- managed mutation confinement·atomic publication·exact rollback
- 다중 파일 transaction·durable Undo
- G same-language program·immutable source universe·independent observer·Artifact handoff

#### Reality·결과

- File Reality filename·system index·content·OCR·visual candidate·duplicate/version·organization
- PDF·DOCX·XLSX·HWP/HWPX/XLS·이미지·ZIP 읽기
- PDF page·XLSX cell/formula·document coverage
- `bind_sources`·source manifest·CSV/TSV reconciliation
- DOCX·XLSX·PPTX·PDF·HTML·SVG·CSV·ZIP authoring·render·reopen
- Artifact Preview·Download·Reveal·Version·Delivery
- Browser persistent tab·observed ref·action 후 readback

#### Capability·Experience

- Skill·CLI·Remote MCP 준비와 원래 Work exact-once resume
- proposal reviewer가 제품 기본에서 활성화되되 foreground 비개입
- 실제 incident signal이 있는 여러 Work에서만 learning review
- AB/BA·near-miss·independent field·fresh purpose
- managed procedural Skill만 reversible promotion·regression rollback

### 2.2 현재 실제 미달

#### 응답 체감

- provider가 stream을 반환해도 Adapter가 전체 body를 받은 뒤 해석한다.
- Console의 `answer_delta`는 실행 완료 후 전체 답을 한 번 전달한다.
- 장문 직접 답변에서 model 1·Tool 0이어도 첫 실제 문장이 약 81초 뒤에 보인 표본이 있다.

#### 성능 원장

- model/tool calls·tokens·전체 wall은 측정한다.
- TTFT, Tool preflight/execute/post-observe, raw/projected bytes, repeated/new Evidence, round별 비용은 한 원장에
  충분히 결속되지 않는다.

#### 모델–Tool 왕복

- AgentLoop는 한 model response의 여러 parallel Tool을 실행할 수 있다.
- 실제 프로젝트 HQ에서는 model 17·Tool 16처럼 Turn당 Tool 하나가 반복됐다.
- 현재 병렬 실행은 모든 호출이 parallel일 때만 활성화되는 all-or-nothing 구조다.
- 모델에게 독립 관측을 한 response에 묶는 짧은 운용 계약이 없다.

#### Tool contract·Context

- Browser action은 이미 `after` observation을 반환하지만 모델이 snapshot을 다시 호출한 표본이 있다.
- `tool_search no_match`, managed 경계에서 not-executed `exec`, private localhost `web_read`처럼 목적 진전이 없는
  호출이 실제 경로에 있었다.
- 기본 Tool 수는 작지만 `attachment` 등 복합 schema가 크다.
- provider append continuity가 오래된 Tool result wire를 계속 보존할 수 있다.

#### 문서 현실

- 개별 문서 읽기·생성·대사는 강하다.
- 저해상도·회전·도장·체크박스·다단 표·PDF/XLSX/이미지 혼합 packet의 공통 실제 자격은 부족하다.
- 최종 자연어 주장과 exact page/sheet/row/cell 근거를 일반 사용자가 즉시 재개방하는 공통 projection은 미확인이다.

#### 청각 현실

- audio/video kind는 식별한다.
- 현재 `speech_transcription_not_connected`·`video_understanding_not_connected`를 정직하게 반환한다.
- reusable STT helper·model generation·decode·chunk coverage·Transcript Artifact 제품 경로는 없다.

#### Method composition

- G 프로그램은 local source와 output을 안전하게 처리한다.
- Terminal 프로그램이 File·Document·Browser·Memory·Capability·Artifact 같은 T5 Hand를 제한적으로 직접 호출하는
  공통 방법 경로는 없다.
- 복합 Work에서 모델이 모든 Hand 사이의 현장 감독자로 남는다.

### 2.3 현재 실제 성능 표본

| 목적 | Wall | Model/Tool | Provider tokens | 판정 |
|---|---:|---:|---:|---|
| 장문 직접 정리 | 서버 81.3초 | 1/0 | 17,788 | 생성 중 본문 미노출 |
| 서울 날씨 개선 | 13.455초 | 2/1 | 29,682 | 정확, client Web 속도 carry |
| 이름 파일 검색 | 18.767초 | 복수 | 미상 | filename phase 약 7.75초 |
| editable PPTX 개선 | 31.150초 | 10/9 | 152,696 | 53.880초·15/14 대비 개선 |
| 기존 프로젝트·Browser | 약 86~90초 | 17/16 | 약 26만~34만 | Turn당 Tool 하나 |
| 6차 통합 파일·문서·프로젝트 | 286.824초 | 28/26 | 1,229,863 | 정확·Undo PASS, 경제성 carry |

이 표본은 한 최적화로 모두 해결할 수 없음을 보여준다.

```text
Direct 장문       → output streaming·generation
단순 현재 정보    → Web Hand 자체 latency·source density
파일 검색         → index·content/OCR observation
복합 프로젝트     → model/tool round·Context 누적·Tool contract
```

---

## 3. 전체 개발 헌법

### 3.1 성능은 품질의 대체재가 아니다

```text
정확성·완전성·권한·current correction·Effect·Artifact·Undo 무회귀
AND 사용자 목적 성공률 유지 또는 향상
AND first useful·wall·calls·tokens·bytes의 Pareto 개선
```

### 3.2 Runtime은 의미를 선택하지 않는다

- 업무명·파일형식·감정 표현 정규식 Router 금지
- 고정 Intent enum·ActionPlan·DAG 금지
- Runtime은 dependency·identity·scope·권한·실행·Effect·coverage만 판정
- 방법·깊이·관련성·완료·중단은 모델 책임

### 3.3 기계적으로 닫히는 구간만 한 호흡으로 묶는다

모델 판단이 다시 필요한 지점:

- 새 Evidence가 의미를 바꿈
- 사용자 결정 필요
- action의 권한·effect가 달라짐
- 실패 뒤 방법 변경
- 결과가 목적에 충분한지 판단

Runtime이 묶을 수 있는 지점:

- 실행→대기→직접 readback
- 파일 생성→hash→reopen→Artifact handoff
- process start→readiness
- exact observed controls의 비파괴 입력 묶음
- 다수 read-only source의 filter·join·aggregate

### 3.4 한 Gate·한 실패 가족

- 아래 전체를 동시에 구현하지 않는다.
- 앞 Gate가 현재 T5로 이미 충분하면 제품 변경 0으로 닫는다.
- 같은 가정의 두 후보가 actual 사용자 이익을 만들지 못하면 세 번째 조건 patch 금지.

---

## 4. 개발 단계

## NG-0 — Current Performance & Cognitive Baseline

상태 목표: `PRODUCT_CHANGE_0`

### 목적

기능별 숫자가 아니라 사용자 목적 하나의 전체 흐름을 한 시간축으로 분해한다.

### 추가 계측

```yaml
modelCall:
  contextBuildMs:
  providerDispatchMs:
  timeToFirstDeltaMs:
  generationMs:
  inputTokens:
  cachedTokens:
  outputTokens:
  instructionBytes:
  toolDefinitionBytes:
  historyBytes:
  toolReceiptBytes:

toolCall:
  queueMs:
  preflightMs:
  executeMs:
  postObserveMs:
  settleMs:
  rawResultBytes:
  projectedResultBytes:
  novelEvidence:
  repeatedEvidence:
  outcome:

surface:
  firstFeedbackMs:
  firstGroundedMs:
  firstAnswerDeltaMs:
  finalVisibleMs:
```

### 기준선 Mission

1. Direct 짧은 답
2. 장문 정리
3. 단순 현재 정보
4. 모호한 파일 검색·전달
5. 복합 문서 대사
6. 프로젝트 수정·test·Browser·stop

### 종료

각 Mission의 주 병목이 `generation / Tool wall / model round / Context / algorithm / surface`로 분리된다.

---

## NG-1 — Semantic Answer Streaming

### 목적

모델이 생성한 첫 사용자 문장을 provider delta 직후 보여준다.

### 구현

- Adapter의 `response.text()` 전체 buffering을 incremental SSE parser로 변경
- 공통 `onTextDelta`·`onAnswerReset` 계약
- reasoning·Tool args·비밀은 stream하지 않음
- 첫 delta 즉시, 이후 60~80ms adaptive flush
- Tool call·fallback·cancel에서 provisional answer reset
- 최종 누적 text와 canonical final digest 대조
- 중간 delta 영구 Conversation 저장 0

### 합격

- provider delta→visible p95 120ms 이하
- current gpt-5.5 장문 표본 first semantic 목표 2초 이내
- model/tool/tokens/request bytes 증가 0
- 최종 답 중복·불일치 0

---

## NG-2 — Tool & Round Performance Spine

### NG-2A Model-selected Parallel Calls

- provider capability가 있으면 `parallel_tool_calls`를 명시
- 짧은 공통 instruction family 하나:
  - 결과를 보기 전에도 독립인 관측만 같은 response에 묶음
  - effectful·승인·결과 의존 호출은 순차 유지
- 해당 문장은 source incident·probe와 결속하고 필요 없으면 제거 가능

### NG-2B Segmented Execution

현재 all-or-nothing 병렬을 safe wave로 변경한다.

```text
parallel read wave
→ sequential effect wave
→ parallel verification wave
```

Tool별 `executionMode(args)`를 허용한다.

- read-only·idempotent·서로 다른 scope는 parallel 후보
- 같은 파일·같은 tab·같은 external target effect는 순차
- preflight는 먼저 끝내고 허용된 호출만 실행
- 결과는 모델 source order로 결속

### NG-2C Tool Contract Density

#### Terminal

- managed `start + readiness` 공통 계약
- readiness: stdout pattern / port / local HTTP / timeout
- 결과 lifetime: `publishable / internal_intermediate / diagnostic / temporary`

#### Browser

- 기존 `after` observation을 authoritative postcondition으로 명시
- `additionalSnapshotNeeded` 사실 제공
- 같은 observation의 bounded non-submit input batch만 후보화
- navigation·modal·effect 발생 시 즉시 중단

#### File Reality

- exact hash/revision 기반 text·OCR observation cache
- OCR 2~4 bounded concurrency
- system index·metadata·content·OCR의 증분 index
- stale cache는 exact reopen으로 폐기

#### Attachment·Document

- 현재 Run 상태에 따른 작은 action schema projection
- declared `publishable` output은 verify→Artifact handoff를 기계적으로 결속
- inspect·register·Preview의 중복 projection 제거

#### Web

- exact URL/query/provider/domain별 짧은 cache와 freshness
- ETag·Last-Modified가 있으면 revalidation
- 같은 Conversation follow-up에서 이미 읽은 source pointer 재사용
- source identity 없는 provider-native 답은 계속 미채택

#### Memory·Recall

- exact source revision별 parsed projection cache
- current request에 무관한 Memory Tool surface 증가 0

#### Capability Search

- lexical top-1 fallback 유지
- Tool 이름·설명·return/error contract 정리
- 관측된 parameter error에만 1~2개 Tool Use Example
- 현재 capability category의 작은 지도
- provider-native deferred Tool Search는 Adapter 후보로만 비교

### NG-2D Completion Co-settlement

모델이 같은 response에서 `work_completion` proposal과 model-authored final answer를 함께 만들 수 있는 후보를 비교한다.

- proposal exact 성공→같은 답 게시
- proposal 실패·unknown→답 폐기 후 기존 model call
- Runtime이 답을 작성·수정하지 않음
- final answer가 receipt 결과에 의존하면 기존 경로 유지

### NG-2E Provider Wire Epoch

5차에서 실패한 always rebuild를 재개하지 않는다.

후보 시점:

- Tool-heavy bounded stage 종료
- Artifact milestone 완료
- Browser observation family 종료
- Work revision 전환

해당 시점에만 portable canonical checkpoint로 새 provider epoch를 열고 이후 append continuation을 재개한다.
reasoning continuity·cache·quality가 악화되면 폐기한다.

### NG-2 종료

- 프로젝트·presentation·복합 문서 중 최소 두 Mission에서 목적·품질 무회귀
- 불필요한 `no_match / not_executed / blocked / repeated observation` 감소
- model rounds·request bytes·tokens·wall 중 실질 개선
- Direct·단일 Hand 비용 증가 0

---

## NG-3 — Cognitive Flow & Practical Judgment Hardening

현재 5·6차 기능을 다시 만들지 않는다.

### 이미 선 CF slice

- CF-1 Current Situation 일부
- CF-2 Evidence refinement 일부
- CF-3 Tool economy 일부
- CF-5 Natural stop 일부
- CF-6 Correction reorientation
- CF-8 Experience flow 기반

### 실제 후보

#### NG-3A 표현 격차 baseline

같은 목적을 Expert / Ordinary / Vague / Emotional / Corrected로 최소 pair·trio만 비교한다.

#### NG-3B Current Pulse gap

모델이 current correction·새 Evidence·완료·중요 unknown을 실제로 놓칠 때만 기존 정본에서 작은 pulse를 파생한다.

#### NG-3C On-demand Practical Lens

다음 형식의 원리만 격리 A/B한다.

```yaml
principle:
sourceIncident:
helpsWhen:
mustNotActivateWhen:
requiredReality:
counterexample:
probe:
rollback:
```

전역 Prompt·오너 말투·고정 컨설팅 형식은 금지한다.

#### NG-3D Proportional Stop

모델에는 content-free 사실만 제공한다.

- new/repeated Evidence
- achieved Artifact·Effect
- 남은 unknown
- 다음 행동의 비용·authority·effect kind
- 사용자 범위

모델이 observe / ask / act / stop을 판단한다.

### 합격

- Ordinary/Vague의 목적 invariant가 Expert와 같은 수준
- 질문·Tool·비용 이유 없는 증가 0
- Direct·창작·고민의 rigidity 0
- current correction 우선
- 사용자 가치 결정 대체 0

---

## NG-4 — Bounded Method Runtime

현재 H09와 6차 통합 여정은 단계별 model/tool 왕복 병목의 실제 근거다. 따라서 `MR-0` baseline은 열 수 있다.

### NG-4A MR-0 후보 비교

같은 fixture에서 비교한다.

```text
A 현재 model Tool loop
B 기존 Hand의 더 높은 밀도
C procedural Skill
D provider-native programmatic tool calling
E T5 read-only Method Capsule
```

### NG-4B Read-only Method Capsule

첫 범위:

- exact File/Document handles
- read-only observation
- filter·join·rank·deduplicate·aggregate·validate
- network·secret·external effect 0
- 결과는 compact Evidence candidate
- source 전체와 coverage는 Runtime이 보존

모델은 bounded stage의 목적·허용 Hand·출력 evidence를 작성한다. Runtime은 방법의 의미를 선택하지 않는다.

### NG-4C Verified Local Result

read-only 후보가 이기면 기존 F/G·Artifact를 연결한다.

- declared local output
- independent readback
- publishable handoff
- Undo·cleanup
- current correction·cancel·restart

### NG-4D 제한적 Hand Composition

실제 이익이 계속될 때만 Hand를 하나씩 추가한다.

우선순위:

1. File + Document
2. pure calculation
3. Artifact publication
4. bounded Web read-only

Browser action·Connection write·secret·external effect는 첫 범위에서 제외한다.

### 합격

- 단계별 모델 왕복 감소
- intermediate raw 결과의 Context 유입 감소
- 정확성·coverage·source·Artifact·Undo 동일
- Direct·단일 Hand schema 비용 0
- 모델이 Method를 선택하지 않아도 자연 경로가 더 좋으면 PASS

---

## NG-5 — Document Reality & Reconciliation

새 문서 플랫폼·업종 Agent·DocumentPacket Store를 만들지 않는다.

### NG-5A DR-0 actual baseline

세 목적:

1. 발주·입고·세금계산·거래명세 대조
2. 계약서 revision의 금액·기간·책임 차이
3. 카드·영수증·세금계산 증빙 누락

변형:

- 정상 digital
- 회전·저해상도·손상 scan
- 병합 셀·다단 표·페이지 넘김
- 체크박스·도장·서명
- PDF·XLSX·이미지 혼합
- 여러 revision·필수 문서 누락·distractor

원인:

```text
perception / selection / relation / reconciliation / evidence_ux / method_cost
```

### NG-5B Perception

현재 parser·PDF text·local OCR·visual observation을 먼저 비교한다. 반복 실패 가족에서만 새 local parser/OCR 또는
외부 Document AI를 후보화한다.

### NG-5C Work Document Set

새 Store 없이 현재 Work·source handle·coverage에서 파생한다.

```yaml
selectedSources:
observedRevisions:
observedCoverage:
candidateRoles:
relationEvidence:
unreadOrUnclassified:
missingEvidence:
```

문서 역할·관계는 모델이 판단하고 Runtime은 identity·revision·coverage만 보증한다.

### NG-5D Claim-to-Source

중요 주장만 exact page/sheet/row/cell/time 위치와 결속한다.

- observed value
- normalized value
- calculation lineage
- coverage·uncertainty
- 원문 위치 없는 주장은 citation으로 표시하지 않음

### NG-5E Reconciliation

기존 `bind_sources`·source manifest·G·Artifact를 혼합 packet에서 자격한다.

- same event/party/item relation
- value/date/quantity match
- duplicate/unmatched/ambiguous/conflicting
- deterministic calculation
- 전체 output coverage

### NG-5F 결과 사용성

- 지금 결론
- 차이·누락
- 근거표
- 미확인
- 원문 위치
- 바로 가능한 다음 행동
- XLSX/PDF/DOCX·Version·Undo

### 합격

- 서로 다른 세 목적에서 전용 업무 규칙 없이 같은 원리
- false approval·false completion 0
- 사용자가 결론을 원문에서 확인·교정 가능
- 정상 문서의 가벼운 경로 무회귀

---

## NG-6 — Auditory Intelligence

현재 제품의 가장 명확한 새 기관 gap이다.

### 첫 후보

```yaml
helper: t5-whisper-host
engine: whisper.cpp
qualityModel: whisper-large-v3-turbo
decode:
  macOS: AVFoundation
  Windows: Media Foundation
execution: separate managed process
modelAsset: on-demand exact generation
localOnlyDefault: true
```

### NG-6A Engine baseline

whisper.cpp full/quantized, macOS MLX positive control, Windows faster-whisper positive control을 같은 한국어 corpus에서 비교한다.

### NG-6B Audio Reality

- exact source·digest·duration·container·track·codec
- native streaming decode→16k mono PCM
- multiple/no audio track
- source pre/post revalidation

### NG-6C Helper·Model lifecycle

- exact source·commit·license·digest
- resumable download·disk preflight
- active generation·update·rollback·remove
- helper package, weight on-demand
- model 준비 중 model polling 0
- original Work exact-once resume

### NG-6D Managed Transcription

- chunk·VAD·timestamp·progress
- cancel·crash·restart·partial output
- late transcript·orphan·blind retry 0
- GPU/RAM admission

### NG-6E Coverage Truth

- expected/decoded/processed interval
- gap·overlap·duplicate
- silence·music·noise·repetition
- 중요한 이름·숫자의 original segment reopen

### NG-6F Transcript Result

- raw TXT/JSON/SRT/VTT
- derived MD/DOCX 회의록
- 결정·담당자·기한
- correction→Artifact version 2
- Download·Reveal·Telegram/Notion delivery

### 합격

- 45초·20분·2시간 한국어 목적
- names·numbers·timestamp·coverage
- local-only transmission truth
- Stop·restart·Session continuity
- macOS·Windows 공통 의미

비목표: 상시 microphone·wake word·통화 녹음·TTS·voice clone·speaker diarization·전체 audio 자동 index.

---

## NG-7 — Experience Growth Integration

S6-D/E를 재개발하지 않는다.

NG-3~6의 실제 성공·실패가 생긴 뒤 다음만 확인한다.

- 반복 설명·교정이 실제로 감소하는가
- 검증된 Method·Document·Auditory 절차가 다음 유사 목적에서 선택되는가
- current source·hardware·user correction이 달라지면 과거 방법을 버리는가
- 후보 잡동사니가 쌓이지 않는가
- 회귀 시 managed Skill active 제거와 이전 경로 복원이 되는가

Core·external package·secret·external effect의 자동 학습 범위는 열지 않는다.

---

## 5. 실행 우선순위

```text
NG-0 성능·Flow baseline
→ NG-1 답변 스트리밍
→ NG-2 Tool·Round Performance Spine
→ NG-3 Cognitive Flow·Practical Judgment
→ NG-4 Bounded Method Runtime
→ NG-5 Document Reality
→ NG-6 Auditory Intelligence
→ NG-7 Experience integration
→ NG-HQ
```

단, NG-0의 원인에 따라 분기한다.

```text
문서 perception 실패가 먼저면 NG-5
model/tool round가 먼저면 NG-2→NG-4
사용자 표현·깊이 판단 실패가 먼저면 NG-3
audio 목적이면 NG-6
```

여러 major Gate를 동시에 제품화하지 않는다. 독립 read-only source 조사와 fixture 준비만 병렬화할 수 있다.

---

## 6. NG-HQ — 비GUI Android 전체 자격

### 실제 인간 Mission

1. Direct 의견·장문 정리·창작
2. 최신 정보·정확한 URL·심층 조사
3. 모호한 파일·OCR·대형 문서
4. 혼합 문서 대사·결과 문서
5. 프로그램·프로젝트·Terminal·Browser
6. 긴 녹음·자막·회의록
7. 교정·dual-control·Stop·restart
8. Artifact·Version·Undo·Delivery
9. Experience 재사용·rollback

### 공통 UX·성능

- submit ack
- first feedback
- first semantic/grounded result
- 실제 진행
- final result
- correction·Stop
- Preview·Download·Reveal·Undo

### 절대 경계

- P0 0
- 핵심 P1 0
- 실제 사용자 목적·end-state PASS
- target 밖 Effect 0
- source·revision·coverage·unknown 정직
- 모델 reasoning·private Context 노출 0
- Direct·단일 Hand 무회귀
- Windows PASS는 물리 자격한 범위만 주장

### 성능 판정

```text
Round Yield
= 새롭고 검증된 목적 관련 Evidence / model call

Tool Density
= 실제 실행 + 직접 readback + 재사용 handle / Tool call

Context Density
= 다음 판단을 바꿀 수 있는 사실 / provider input bytes
```

호출 수가 줄어도 정확성·사용성·Evidence가 줄면 실패다.

---

## 7. 전체 비목표

- Computer Use·AX/UIA·좌표 행동·상시 screenshot
- Console 시각 디자인·CSS 재개발
- 새 Intent Router·업무 enum·거대 Planner
- 모든 Tool의 무조건 병렬 실행
- 모든 작업의 Method Runtime
- 모든 경험의 자동 Skill 승격
- 업종별 Agent·문서 workflow pack
- 새 Memory/RAG/Fact/DocumentPacket 영구 Store
- provider 하나의 기능을 T5 Core 의미로 고정
- 정확성·독립 검증·Undo를 제거한 속도 개선
- 현재 6차 source의 성공을 package·Windows PASS로 이전

---

## 8. 시작 일곱 줄

실제 개발 세션은 아래를 current source에서 다시 확인한다.

1. **제품 약속**: 사용자는 기능을 배우지 않고 평소 말로 목적을 맡긴다.
2. **현재 Gate**: 위 NG Gate 중 오너가 실제로 연 하나.
3. **완료 문장**: 해당 Gate의 사용자 완료 결과.
4. **이미 선 기반**: 6차 exact source의 재사용할 Hand·Store·Receipt·Evidence.
5. **가장 큰 미달**: current actual에서 재현된 한 실패 가족.
6. **변경 방식**: 기존 상태 전이의 가장 작은 연결부 또는 알고리즘 보강.
7. **Non-goals**: 다른 연구 Gate·GUI·새 Store·Router·package 범위.

---

## 9. 현재 권고

가장 먼저 열 가치가 있는 것은 `NG-0→NG-1→NG-2`다.

이유:

- 현재 actual이 이미 첫 semantic output과 model/tool 왕복 병목을 증명한다.
- Direct·Web·File·Document·Project 모든 후속 개발의 측정 기반이 된다.
- 새 업무 기능을 만들지 않고 현재 T5 전체의 체감·비용·정확성을 동시에 개선할 수 있다.
- NG-2가 선 뒤에야 Method Runtime이 정말 필요한 범위와 각 Tool 자체의 약점이 분리된다.

그 다음은 `NG-3`과 `NG-5`다. Cognitive Flow의 상당 부분은 이미 있으므로 전역 지능 Engine을 만들지 않고 표현 격차·
과잉 검증·적정 중단의 actual 실패만 다룬다. Document Reality는 현재 강한 기반을 가장 큰 실무 가치로 전환하는 첫
고가치 자격선이다.

`NG-6 Auditory`는 독립된 큰 기관 개발이다. 명확히 필요하지만 성능 spine·현재 release와 섞지 않고 별도 Gate로
연다.

최종 문장:

> 다음 T5 개발은 기능 수를 늘리는 경쟁이 아니다. 이미 가진 눈·손·기억·척추가 더 적은 왕복과 더 높은 증거
> 밀도로 움직이게 하고, 그 위에 복합 문서와 청각 현실을 같은 identity·authority·effect·Artifact·recovery 계약으로
> 결속하는 성능·지능 완성 개발이다.
