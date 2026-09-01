# T5 Selection-Scoped Side Exploration 연구·개발 계획

기록일: 2026-09-01
조사 저장소: `/Users/jyp/Developer/t5-sixth`
조사 branch: `codex/t5-sixth-android-experience`
조사 HEAD: `7a47f69afb1480c887d7bf641dad062c584e28f9` (`Close sixth source human HQ`)
5차 불변 귀환선: `f42e4db7bcf6ecb0cb0cc13ffb7499f2b6961be0`
상태: `OWNER_REQUESTED_PLAN · RESEARCH_COMPLETE · MIGRATED_TO_NX_RESEARCH · NX2_SE_PLANNED · PRODUCT_IMPLEMENTATION_NOT_OPEN`
후보 흐름: `Selection → Side Exploration → Explicit Apply → Work Revision`

현재 NX 이관:

- 현재 개발 정본: `/Users/jyp/Developer/t5-windows/T5-NX.md`
- 현재 전체 계획: `T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md`
- 귀속 Gate: `NX2-SE — Selection-Scoped Side Exploration`
- 고정 순서: `NX2-3 Cognitive Flow 종료 뒤 · NX2-4 Auditory 이전`
- 현재 상태: 연구·계획만 이관, 제품 source·Console entry·Tool surface 변경 0
- 제품 구조: `same-T5 read-only side projection` 뒤 explicit apply만 canonical Work로 승격
- 구현 시작 조건: 현재 NX exact head에서 Conversation·Work·Context·Progress·Artifact·Undo 경계를 다시 감사하고
  오너가 NX2-SE Gate를 명시적으로 개통

이 기능은 범용 Desktop GUI나 Console 장식이 아니다. canonical 대화의 exact selection anchor를 좁은 read-only
탐색 Context로 열고, 사용자가 명시적으로 적용할 때만 current Work R+1 correction 또는 provenance가 있는 derived Work로
승격하는 Cognitive Flow·Work Continuity 기능이다.

## NX-2 공통 승격 계약

NX-2 귀속: `NX2-SE — Selection-Scoped Side Exploration`

오른쪽 패널이 보이거나 side 답변이 생성됐다는 사실만으로 완료하지 않는다. 제품 승격에는 다음이 모두 필요하다.

- side 기능을 사용하지 않는 Direct·Work의 Context bytes·model/Tool calls·TTFT가 정확히 무회귀한다.
- 선택한 canonical messageId·revision·Unicode/Markdown offset·digest가 exact하게 결속된다.
- side 질문·답은 apply 전 main Conversation·Memory·Work·Artifact·Effect에 0만큼 영향을 준다.
- side answer는 같은 modelFactory·Interaction Core를 사용하되 read-only Hand boundary를 지킨다.
- explicit apply는 stale target을 거부하고 active R+1·paused resume·completed derived Work를 exact-once로 정산한다.
- 결과 Artifact·Effect·Undo·Delivery는 apply 뒤 기존 T5 경계에서만 생성된다.
- 실제 Console에서 선택→옆 탐색→Stop/reconnect→적용→main 결과→Undo 전체 흐름과 인간 이해 속도를 확인한다.
- clean second whole-flow와 접근성·좁은 창·긴 Markdown·한글 selection을 통과한다.

새 Agent·별도 Memory·별도 Method·별도 Work/Artifact Store가 필요하거나 side branch가 main Context에 자동 혼입되면
후보를 폐기한다. 상세 공통 성능·정확성·결과 품질·인간 체감 기준은
`T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md`가 관리한다.

## 0. 결론

이 기능은 T5에 구현할 가치가 높고, 현재 아키텍처 위에서 구현 가능하다. 다만 핵심은 오른쪽에 작은 채팅창을
붙이는 일이 아니다.

> 하나의 T5가 현재 Conversation·Work·Reality를 유지한 채, 사용자가 선택한 한 지점을 좁게 투영해 잠시 깊게
> 탐색하고, 사용자가 명시적으로 반영할 때만 current Work correction 또는 source provenance가 있는 derived Work로
> 승격하는 기능이다.

정답 구조는 다음과 같다.

```text
Canonical Conversation message
        ↓ immutable message anchor
Selection-scoped context projection
        ↓ same modelFactory + same runAgent + read-only Hand boundary
Side exploration messages
        ↓ no Work write / no Effect / no Artifact publication
Explicit user apply
        ↓ exact target provenance + expected revision + idempotent admission
Derived Work 또는 명시적 Work correction revision
        ↓ normal T5 execution / verification / Artifact / Effect / Undo
Canonical main Conversation result
```

새 Agent, 별도 persona, 별도 Memory, 별도 Method engine, 별도 Artifact store를 만들지 않는다. 사이드 탐색은
`ConversationLedger` 안의 typed side events에서 파생되는 read model이고, 추론은 현재 T5의 `modelFactory`와
`runAgent`를 그대로 사용한다. 실행이 필요한 순간에는 사이드 런이 직접 실행하지 않고 기존 Work admission으로
승격한다.

현재 HEAD의 가장 중요한 구조적 미달은 두 가지다.

1. UI에 보이는 메시지와 canonical `messageId`·source revision·텍스트 offset을 안전하게 결속하는 selection
   anchor 계약이 없다.
2. 진행 중 Work는 R+1 교정이 가능하지만, 완료된 Work 선택을 새 실행으로 반영할 때 기존 completion 불변성을
   보존하는 `derived Work` provenance와, 같은 `workId` 재개가 정말 필요한 경우의 명시적 reopen 계약이 없다.

따라서 첫 구현은 패널 CSS가 아니라 exact anchor RED와 `derived Work` 기본 후보의 provenance RED에서 시작해야 한다.
같은 `workId`의 completed Work R+1 reopen은 기본 정답이 아니라 별도 A/B 후보이며, 기존 settlement·Delivery·Episode·
Learning 불변식을 모두 보존한다는 증거가 있을 때만 채택한다.

## 1. 이번 계획의 권한과 현재 Gate

### 1.1 조사 정본과 현재 개발 정본

- 제품 정의: `/Users/jyp/Developer/t5-windows/T5-PRODUCT.md`
- 현재 유일 개발 정본: `/Users/jyp/Developer/t5-windows/T5-NX.md`
- 현재 Gate: `NX-1 FIRST FLAGSHIP MASTERY · INTEGRAL OUTCOME METHOD`
- 현재 작업: 혼합 문서 정산에서 현재 제품보다 빠르고 정확하며 품질 높은 Integral Method 후보 자격
- 이 문서의 파일 감사 기준: 6차 완료 source `7a47f69a`이며 현재 NX source와 같다고 간주하지 않음

이 문서는 연구 폴더의 비정본 계획이다. 현재 NX-1을 중단하거나 Selection 기능을 자동으로 구현 승인하지 않는다.
실제 구현 전에는 현재 NX exact head에서 Conversation·Work·Context·Integral Method·Console 경계를 다시 감사하고,
오너가 별도의 Selection Exploration Gate를 열어야 한다.

`/Users/jyp/Documents/Codex/.../T5-SELECTION-SIDE-EXPLORATION-RESEARCH.md` 열람용 사본은 최초 조사본이며 이 교정 이후
정본이 아니다. NX 이관 시 현재 연구 파일에서 새 사본을 생성하고 digest를 다시 확인한다.

### 1.2 작업 트리 사실

조사 시점 작업 트리는 branch 변경 없이 다음 미추적 사용자 파일을 포함했다.

- `docs/00-product/GPAO-T5-기술-기능-소개-ko.docx`
- `docs/00-product/GPAO-T5-일반인-소개-ko.docx`
- `티파이브개발 연구/` 전체

이 계획은 위 기존 파일을 수정·정리·stage하지 않는다. 연구 폴더가 현재 Git 미추적이라는 사실도 제품 구현 완료나
정본 편입을 뜻하지 않는다.

### 1.3 시작 전 일곱 줄

1. 제품 약속: 사용자는 T5를 배우지 않고 평소 말로 목적을 맡기며 T5가 실제로 끝낸다.
2. 현재 Gate: NX-1 Integral Outcome Method가 CURRENT이며 Selection Exploration은 연구 상태다.
3. 후보 완료 문장: 사용자는 답의 일부를 선택해 같은 T5와 옆에서 탐색하고, 명시적으로 반영한 내용만 정확한
   current correction 또는 derived Work로 이어진다.
4. 이미 선 증거: canonical Conversation·Work·Run·Progress·Artifact·Effect·Undo·Recovery와 busy correction이 있다.
5. 가장 큰 미달: exact selection anchor와 completed source에서 새 실행으로 이어지는 derived provenance 계약이 없다.
6. 변경 방식: 기존 원장과 실행 경계를 재사용하고 selection projection·explicit apply seam만 추가한다. apply 이후의
   복합 실행은 현재 NX Integral Method가 필요할 때 재사용한다.
7. non-goals: 새 Agent, 새 Memory, 새 Method Runtime, 별도 Work/Artifact store, 화면 복제, 자동 반영.

### 1.4 NX 이관 전 필수 조건

이 문서는 아래 조건을 만족하기 전 현재 NX 저장소에 구현 지시로 사용할 수 없다.

1. NX-1 CURRENT Gate를 중단하지 않고 오너가 Selection Gate의 순서를 명시한다.
2. `/Users/jyp/Developer/t5-windows` exact head에서 아래 파일 감사를 다시 수행한다.
   - ConversationLedger·projection·checkpoint
   - WorkStore·transition·input settlement·completion
   - current Integral Method contract·activation·ClaimEvidence
   - Console progress·Stop·Artifact·Undo
3. 6차와 NX 사이 실제 diff에서 바뀐 identity·event·Context·Tool surface를 이 문서에 반영한다.
4. 연구 문서는 현재 NX 연구 색인에 편입하되 `PRODUCT_IMPLEMENTATION_NOT_OPEN`을 유지한다.
5. 오너가 Gate를 열면 정본에는 이 문서 전체를 복사하지 않고 현재 Gate·완료 문장·첫 RED·중단선만 링크한다.
6. 현재 NX의 Direct·Integral Method·Artifact 경계를 복제하는 새 코드가 필요하면 구현을 중단한다.

## 2. 참조 스크린샷에서 가져올 것과 버릴 것

원본 스크린샷에서 관측된 유용한 상호작용은 다음이다.

- 본문 텍스트를 선택하면 선택 지점 가까이에 작은 세 가지 액션이 나타난다.
- `채팅에 추가`, `더 자세히`, `사이드 채팅에 질문하기`가 한 번의 선택에서 이어진다.
- 오른쪽 패널 상단에 선택한 짧은 문구가 남아 현재 탐색 대상을 잃지 않는다.
- 중앙 문서를 유지한 채 오른쪽에서 독립적인 질문·답을 이어간다.

그대로 복제하지 않을 부분은 다음이다.

- 원본의 흰 floating card, 패널 chrome, 아이콘, 크기·모서리·문구를 복제하지 않는다.
- 메인 대화와 사이드 대화의 입력·중지 상태가 같은 것처럼 보이게 하지 않는다.
- `추가`를 누르는 즉시 실제 Work가 바뀌는 모호한 의미를 만들지 않는다.
- 오른쪽 패널을 항상 보이는 개발자 environment panel로 만들지 않는다.

T5식 번역은 다음과 같다.

```text
선택 직후 작은 bar
  [대화에 인용] [이 부분 더 보기] [옆에서 질문]

오른쪽 탐색면
  선택한 부분
  "여기서는 아직 작업이 바뀌지 않아요"
  같은 T5의 질문·답
  적용할 지시가 있을 때만 [현재 작업에 반영]
```

## 3. 현재 구현의 파일 단위 감사

### 3.1 Conversation

#### `refoundation/src/conversation-ledger.js`

현재 사실:

- Session별 append-only JSONL 원장이다.
- `conversation_started`, `message`, `message_aborted`, `checkpoint`를 읽어 canonical entries를 만든다.
- message는 immutable `messageId`, `runId`, `recordedAt`, role/content를 가진다.
- 알려지지 않은 event type은 sequence/schema가 맞으면 원장에 남지만 현재 projection에는 나타나지 않는다.

재사용:

- side exploration을 별도 DB로 만들지 않고 이 원장에 typed side event로 추가한다.
- main `entries`는 지금처럼 user/assistant/tool message만 반환해 일반 Conversation과 provider history를 오염시키지 않는다.
- 별도 `explorations` projection을 같은 `read()` 결과에서 파생한다.

필요 변경:

- side event schema validation과 idempotent append 메서드
- source message sequence/content digest 검증
- incomplete side turn과 apply transaction 재구성
- whole-state restore 뒤 dangling anchor 검증

#### `refoundation/src/conversation-projection.js`

현재 사실:

- 과거 terminal/browser ToolReceipt를 compact factual projection으로 바꾼다.
- 최신 Browser state, large output recall, durable Undo pointer를 보존한다.

경계:

- side messages를 normal provider history에 자동 삽입하지 않는다.
- side projection은 이 파일의 main-history 역할을 바꾸지 않는 별도 projector로 둔다.

#### `refoundation/src/conversation-checkpoint.js`

현재 checkpoint는 main conversation prefix와 최근 tail만 다룬다. side event를 checkpoint summary에 섞으면 사용자가
반영하지 않은 탐색이 main context의 합의처럼 승격될 수 있다. 첫 버전에서는 side events를 checkpoint 대상에서
제외하고, side branch 자체의 bounded history는 별도 projection budget으로 제한한다.

#### `refoundation/src/information-context.js`

현재 구현은 main Conversation에서 과거 assistant/tool segment를 pointer로 줄이고 모든 user correction을 inline으로
보존한다. side projection은 이 정책을 재사용하되 다음을 보장해야 한다.

- 선택 원문과 현재 side 질문은 절대 생략하지 않는다.
- main의 다른 오래된 assistant/tool segment는 기존 recall pointer를 사용한다.
- 선택하지 않은 side branch는 context에 들어가지 않는다.
- side 사용이 없는 Direct 요청의 context byte는 정확히 0 증가한다.

### 3.2 Work revision과 input settlement

#### `refoundation/src/work-store.js`

현재 사실:

- Work/Input/Claim/Completion/Result/Cancellation을 append-only event로 보존한다.
- 실행 중 새 입력은 durable admission 뒤 current Work에 적용될 때 revision을 R+1로 올린다.
- paused Work는 `resume_paused`에서 R+1로 재개할 수 있다.
- completed Work는 immutable settlement를 보존하면서 선택 내용을 새 실행에 결속하는 `derivedFromWorkId·
  derivedFromRevision·selectionAnchor` 계약이 없다.
- Work projection의 `sourceMessageId`는 최초 생성 메시지 하나뿐이라 active revision correction과 derived Work의
  source provenance가 약하다.

충돌 위험:

- `/turn/stream-start`를 그대로 호출하면 완료 Work에는 새 Work가 생길 수 있다.
- 진행 중 입력 분류에 맡기면 explicit apply가 `followup/new_work/ambiguous`로 바뀔 수 있다.
- client가 보낸 `workId/revision`을 믿으면 다른 Work나 stale revision에 적용될 수 있다.

필요한 일반화:

- active/busy·active/idle은 현재 Work의 exact R+1 correction을 사용한다.
- paused는 현재 resume 계약을 사용한다.
- completed는 기본적으로 새 Work를 만들고 `derivedFromWorkId`, `derivedFromRevision`, `selectionAnchor`,
  `sourceMessageId`, `sourceInputId`, `reason=selection_apply`를 결속한다.
- 같은 `workId` reopen은 별도 후보로만 자격한다. 기존 `work_settled` event를 수정하거나 과거 completion·delivery·
  Artifact·Episode를 현재 상태로 덮어쓰지 않는다.
- Work history와 learning source는 최초 source뿐 아니라 active revision source 또는 derived provenance를 exact하게
  가리킨다.
- active/busy, active/idle, paused, completed-derived의 explicit apply를 한 coordinator에서 분기한다.

completed 적용 후보 비교:

| 후보 | 기본 의미 | 채택 조건 |
|---|---|---|
| Derived Work — 기본 | 완료 결과는 보존하고 선택을 근거로 새 Work 생성 | provenance·UX·Undo·검색 연속성 PASS |
| Same Work R+1 — 보류 | 기존 Work를 명시적으로 reopen | settlement·Delivery·Episode·Learning 불변성 무회귀와 실제 UX 우위 |

#### `refoundation/src/transition-decision.js`

현재 transition model은 실행 중 들어온 일반 입력의 의미를 판단한다. explicit apply에는 사용자가 이미 transition을
결정했으므로 이 모델이 lane을 다시 고르면 안 된다. apply input은 `steer_current`를 서버가 명시적으로 기록하되,
어느 Work에 적용할지는 stale check를 통과한 canonical target만 사용한다.

#### `refoundation/src/work-transition-tool.js`

현재 Tool은 defer/new/cancel/resume을 위한 모델 호출 surface다. selection apply 전용 Tool을 추가하지 않는다.
사용자 click은 Console의 explicit state transition이며 model Tool call이 아니다.

#### `refoundation/src/input-settlement-scope.js`

apply 뒤 실행되는 correction은 기존 exact input handle, Work/revision, surface receipt 정산을 그대로 통과해야 한다.
사이드 메시지 자체에는 input handle을 만들지 않는다.

### 3.3 Context와 하나의 지능

#### `refoundation/src/agent-loop.js`

현재 `runAgent`는 model response, Tool call, Evidence, resource intervention, final answer를 한 루프로 다룬다. side용
Agent loop를 새로 만들지 않는다.

재사용 계약:

- 같은 `modelFactory`
- 같은 Interaction Core
- 같은 provider connection과 continuity 정책
- 같은 `runAgent`
- side 전용 request/history projection
- side-safe Tool surface만 노출

`same intelligence`는 같은 프로세스 하나라는 뜻이 아니라 목적·판단·모델 계약이 하나라는 뜻이다. side run은 별도
Run identity를 가져야 Stop·비용·복구가 정확하지만 별도 persona/Memory/Agent는 갖지 않는다.

#### `refoundation/src/console-server.js`

현재 `executeTurn()`은 Conversation, Memory, Work admission, Tool registry, Run, result surface, Delivery를 모두 결속한다.
`observationOnly` option은 Work를 만들지 않지만 결과를 main Session assistant transcript에 발행한다. 따라서 이를 그대로
side API로 사용하면 main Conversation이 오염된다.

필요한 seam:

- 공통 model/context/Tool 구성 로직을 작은 helper로 추출한다.
- main `executeTurn`의 Work/result publication은 유지한다.
- `executeSelectionExploration`은 같은 runner를 사용하되 side event surface에만 발행한다.
- side run은 `SessionActivityStore`와 `work_reality`를 갱신하지 않는다.
- apply 뒤에만 기존 main turn scheduling 경로로 들어간다.

#### `refoundation/src/interaction-core.js`

전역 Prompt를 늘리지 않는다. 선택 context의 의미는 side projection의 bounded runtime context로 제공한다. main Direct
요청에 selection instruction이 붙지 않아야 한다.

### 3.4 Progress, Console, Stop

#### `refoundation/src/progress-language.js`

main Work progress 언어는 유지한다. side는 다음 세 상태만 panel 안에서 보여준다.

- `질문을 살펴보고 있어요`
- 실제 read-only Hand 사건이 있을 때의 grounded progress
- `답변 준비됨` 또는 실패/중지

가짜 단계, ETA, percentage는 만들지 않는다.

#### `refoundation/src/session-activity-store.js`와 `work-reality-projection.js`

side 질문은 current Work reality가 아니다. side open/answer/stop으로 main activity generation이나 Work milestone이
바뀌면 실패다. apply가 commit된 뒤에만 normal input projection과 R+1 reality가 나타난다.

#### `refoundation/src/work-cancellation-coordinator.js`

main `멈추기`는 Work/Run/child process settlement를 담당한다. side run은 effectful child가 없으므로 별도
AbortController와 side stop endpoint로 끝낸다.

- main Stop이 side exploration을 Work cancellation로 기록하지 않는다.
- side Stop이 main Work나 managed process를 멈추지 않는다.
- 두 버튼은 각 surface 안에 위치하고 사용자 언어가 달라야 한다.

#### `refoundation/ui/index.html`

현재 UI는 assistant flat body, user bubble, composer 하나의 canonical Stop, unified Artifact surface를 사용한다.
selection 기능은 이 구조를 유지해야 한다.

필요 변경:

- persisted message DOM에 server-issued selection handle 부착
- delegated `selectionchange`/pointer/keyboard handler
- compact action bar
- desktop right panel / narrow bottom sheet
- panel-specific input, progress, stop, apply preview
- session reload 뒤 side branch 재투영

#### `refoundation/ui/markdown.js`

현재 렌더러는 streaming 중 DOM Range가 풀리지 않도록 text node를 겹쳐 맞춘다. 이 장점은 유지한다. 다만 rendered
plain text와 raw Markdown offset은 다르므로 client가 보낸 raw selected text만으로 anchor를 만들면 안 된다.

필요 변경:

- canonical Markdown에서 사용자가 실제로 보는 selectable plain-text projection을 만드는 pure function
- projection text와 source mapping 또는 block mapping
- browser와 server가 같은 projection version을 사용
- UTF-16 offset·projection digest·source content digest 검증

### 3.5 Artifact, Effect, Undo, Delivery

#### `refoundation/src/attachment-store.js`
#### `refoundation/src/artifact-publication-projection.js`
#### `refoundation/src/artifact-preview.js`
#### `refoundation/src/workspace-patch-tool.js`
#### `refoundation/src/authoring-undo.js`

side exploration은 기존 Artifact를 read-only reference로 보여줄 수 있지만 새 Artifact/version/publication/Undo를
만들지 않는다. 사용자가 apply한 correction 실행이 새 파일을 만들거나 바꾸면 그때 기존 publication·version·Undo
계약을 그대로 사용한다.

첫 Gate에서 Artifact Preview 내부 selection editing은 열지 않는다. 먼저 main Conversation text selection을 닫고,
후속 Gate에서 exact document/page/cell source anchor가 이미 제공되는 형식만 확장한다.

### 3.6 Method와 Learning

#### 현재 NX Integral Outcome Method

현재 NX-1은 Work-scoped Integral Outcome Method를 qualification 중이다. selection feature를 이유로 별도 Method
schema, nested Tool RPC, Agent orchestration을 만들지 않는다.

side exploration은 현재 자연 경로의 read-only `runAgent` projection이다. apply 전에는 Integral Method를 호출하거나
Method candidate·ClaimEvidence·Artifact를 생성하지 않는다. apply 후 canonical Work 또는 derived Work가 복합 실행을
필요로 할 때만 현재 NX의 normal activation 경계에서 Integral Method를 재사용한다.

apply 후에는 current 또는 derived Work revision이 기존
Hand/Tool path를 다시 판단한다. 여기서 말하는 “Method 재결속”은 새 Method Store가 아니라 최신 Work correction이
다음 모델 판단과 실행 수단 선택에 포함된다는 뜻이다.

side-only Run은 achieved Work가 아니므로 Reflection/Learning source eligibility에서 제외한다. apply 뒤 실제로
settled된 current R+1 또는 derived Work Run만 기존 기준으로 후보가 될 수 있다.

### 3.7 Search, backup, recovery

#### `refoundation/src/session-search-tool.js`

main `conversation.entries`만 검색하므로 side event를 자동 검색하지 않는다. 이는 기본값으로 맞다. 사용자가 반영하지
않은 가지를 과거 main 결정처럼 recall하면 안 된다. side branch 검색은 첫 Gate의 non-goal이다.

#### `refoundation/src/t5-whole-state.js`

Conversation JSONL은 이미 whole-state의 `conversations` component에 포함된다. side events를 같은 ledger에 두면 새
backup component가 필요 없다. restore validator에는 다음 관계만 추가한다.

- exploration session이 존재한다.
- anchor message가 같은 Session ledger에 존재한다.
- apply pointer가 존재하면 해당 Work/Input/Run 관계가 정확하다.
- interrupted side run은 `interrupted`로 남고 blind replay하지 않는다.

## 4. 제품 UX 설계

### 4.1 사용자 흐름

```text
1. 사용자가 persisted user/assistant text 일부를 선택
2. 선택 근처에 작은 action bar 표시
3a. 대화에 인용 → main composer에 quote chip만 추가
3b. 이 부분 더 보기 → panel open + 기본 질문 exact once
3c. 옆에서 질문 → panel open + input focus
4. side question/answer 반복
5. 현재 Work를 바꿀 지시가 생기면 apply preview에 exact text 표시
6. 사용자가 [현재 작업에 반영] 클릭
7. server가 target Work/revision을 다시 검증
8. normal Work correction input으로 durable admission
9. current R+1 또는 derived Work 실행·진행·결과는 main Conversation에서 표시
```

### 4.2 세 액션의 의미

#### `대화에 인용`

- main composer에 선택 quote chip과 message handle을 추가한다.
- 아직 Conversation/Work write는 없다.
- 사용자가 Send할 때 일반 main input으로 들어간다.
- quote 원문 전체를 textarea에 복제하지 않아 편집 부담을 줄인다.

#### `이 부분 더 보기`

- panel을 열고 `이 부분을 지금 맥락에서 더 자세히 설명해줘.`와 동등한 제품 intent를 server에 전달한다.
- 이 문구를 raw user text로 몰래 저장하지 않고 action kind와 사용자에게 보이는 짧은 질문으로 기록한다.
- Work change 0이다.

#### `옆에서 질문`

- panel을 열고 selection anchor를 상단에 고정한다.
- side input에 focus한다.
- 아직 model call도 Work write도 없다.

### 4.3 패널 정보 구조

```text
┌ 선택한 부분 ───────────────────────── [닫기]
│ “실제 Craft 개발”
│ 이곳의 질문은 현재 작업을 바꾸지 않아요.
├────────────────────────────────────────
│ 사용자 질문
│ T5 답변
│ ...
├ 반영할 지시 ──────────────────────────
│ 제주 데이터는 실제 작업에서도 제외해.
│ [현재 작업에 반영]
├────────────────────────────────────────
│ [질문 입력........................] [보내기]
└────────────────────────────────────────
```

- desktop wide: 360–420px 범위의 floating right overlay. 본 대화면의 폭을 줄이는 flex split은 사용하지 않는다.
- medium: 같은 오른쪽 overlay를 유지하고 main 내용은 그대로 두며 focus trap은 사용하지 않는다.
- narrow/mobile: bottom sheet, selected quote와 input이 먼저 보인다.
- side panel의 작업면은 본 대화창과 즉시 구분되도록 light/dark theme 모두 흰색 배경을 사용한다. 본문 글자·border·
  shadow·focus ring은 흰 배경에서 WCAG 대비를 만족하고, main theme의 색을 그대로 덮어써 가독성을 잃지 않는다.
- panel open 상태에서도 main Work 진행·Stop·Artifact surface는 그대로 보인다.
- `읽기 전용` 같은 개발 용어만 쓰지 않고 `여기서는 아직 작업이 바뀌지 않아요`를 기본 안내로 쓴다.

### 4.4 selection action bar

- 한 message surface 안에서 non-empty selection일 때만 표시한다.
- 두 message를 가로지르는 selection은 `대화에 인용`만 허용하거나 첫 Gate에서는 bar를 숨긴다.
- input, button, approval, secret field, transient stream preview에서는 표시하지 않는다.
- persisted assistant/user message와 table/code text는 허용한다.
- native copy를 막지 않는다.
- Escape, selection collapse, session 이동, scroll boundary 이탈 시 닫는다.
- keyboard selection과 screen reader가 동일 action에 접근할 수 있어야 한다.

### 4.5 apply의 사용자 의미

apply 버튼은 side answer 전체를 자동 실행하지 않는다. 사용자가 반영할 exact instruction을 보고 적용한다.

- 질문만 한 상태: apply 없음
- 사용자가 명령형 correction을 쓴 상태: 그 문장을 apply preview로 사용 가능
- T5 답에서 제안을 얻은 상태: `이 내용을 반영`은 사용자 편집칸을 먼저 채우고 exact instruction을 확인시킨다.
- double click: request idempotency로 한 번만 commit
- stale Work: `작업이 그 사이 바뀌었어요. 최신 상태를 확인한 뒤 다시 반영해 주세요.`

### 4.6 source별 apply 결과

| source와 현재 상태 | apply 결과 |
|---|---|
| 같은 Work가 실행 중 | explicit `steer_current` admission, safe boundary에서 R+1 |
| 같은 Work가 active idle | 즉시 exact input attach, R+1 실행 예약 |
| 같은 Work가 paused | 기존 resume 계약으로 R+1 |
| source Work가 completed | 기본은 새 derived Work 생성, 과거 Work/revision/anchor provenance 결속 |
| source가 Direct이고 Work가 없음 | 새 Work 생성, `derived_from_selection` 관계 기록 |
| 다른 Work가 현재 active | 자동 rebind 금지, original/current 선택 요구 |
| cancellation recovery/unknown effect | apply 차단, recovery 먼저 |

## 5. 상태 모델

### 5.1 SelectionAnchor

```yaml
schema: t5.selection-anchor.v1
anchorId: opaque deterministic handle
explorationId: uuid
sessionId: canonical internal id
sourceMessageId: canonical internal id
sourceMessageSequence: integer
sourceRole: user | assistant
sourceRunId: uuid | null
sourceContentDigest: sha256
projectionVersion: selectable-markdown-v1
projectionDigest: sha256
startUtf16: integer
endUtf16: integer
quote: exact projection slice
prefix: bounded disambiguation text
suffix: bounded disambiguation text
createdAt: ISO timestamp
```

client가 `quote`나 offset을 결정권으로 갖지 않는다. server가 canonical source에서 같은 projection을 다시 만들고
digest·slice를 검증한 뒤 anchor를 발급한다.

### 5.2 SideExploration projection

```yaml
schema: t5.selection-exploration.v1
explorationId:
anchor:
state: open | answering | stopped | failed | closed
messages:
  - sideMessageId:
    role: user | assistant
    content:
    runId: uuid | null
    recordedAt:
workSnapshot:
  relation: same_work | direct_no_work | unavailable
  targetHandle: opaque | null
  revision: integer | null
  status: active | paused | completed | cancelled | null
apply:
  state: not_requested | prepared | committed | stale | blocked | failed
  requestId: uuid | null
  inputHandle: opaque | null
  resultingRevision: integer | null
  resultingWorkHandle: opaque | null
  relation: current_revision | resumed | derived_work | null
```

public projection에는 raw `sessionId/messageId/workId/runId/hash/path`를 노출하지 않는다. UI는 opaque handle과 사용자
문구만 받는다.

### 5.3 ConversationLedger side events

권고 event family:

- `selection_exploration_opened`
- `selection_side_message_appended`
- `selection_side_run_started`
- `selection_side_run_settled`
- `selection_apply_prepared`
- `selection_apply_committed`
- `selection_apply_aborted`
- `selection_exploration_closed`

main `message` event와 구분해 normal conversation projection/search/checkpoint에 들어가지 않게 한다.

### 5.4 Work correction·derivation event

active Work correction 권고 event:

```yaml
type: work_revision_opened
workId:
baseRevision:
revision:
sourceInputId:
sourceMessageId:
reason: explicit_user_correction
sourceKind: main_conversation | selection_exploration
```

completed Work 선택의 기본 권고 event:

```yaml
type: work_derived_from_selection
workId: new canonical Work id
revision: 1
derivedFromWorkId:
derivedFromRevision:
selectionAnchorId:
sourceInputId:
sourceMessageId:
reason: explicit_selection_apply
```

두 event 모두 side 전용 편법이 아니라 explicit correction provenance를 강화하는 일반 경계다. completed source를 같은
`workId`로 reopen하는 event는 별도 자격 없이는 추가하지 않는다.

## 6. 서버 계약

### 6.1 endpoint

권고 surface:

```text
POST /selection-explorations
GET  /selection-explorations/:handle
POST /selection-explorations/:handle/stream-start
GET  /selection-explorations/:handle/stream
POST /selection-explorations/:handle/stop
POST /selection-explorations/:handle/apply
POST /selection-explorations/:handle/close
```

모든 route는 기존 local console guard, same-origin, body limit, exact field allowlist를 통과한다.

### 6.2 open request

```json
{
  "sessionId": "...",
  "messageHandle": "opaque",
  "projectionVersion": "selectable-markdown-v1",
  "projectionDigest": "...",
  "startUtf16": 120,
  "endUtf16": 131
}
```

server 검증:

1. Session이 user-visible이고 deleted가 아니다.
2. handle이 그 Session의 한 user/assistant persisted message로 정확히 resolve된다.
3. source content/sequence가 변하지 않았다.
4. selection은 한 message projection 안에 있고 non-empty다.
5. offset이 projection boundary 안이다.
6. quote에 credential-like data가 있으면 model 전송 전 차단하거나 redacted local quote만 허용한다.

### 6.3 side turn request와 SSE

```json
{
  "requestId": "uuid",
  "question": "이게 실제 작업에 어떤 영향을 줘?"
}
```

SSE event:

- `trace_status`
- `activity_event` — read-only 실제 관측이 있을 때만
- `answer_reset`
- `answer_delta`
- `side_state`
- `recoverable_error`
- `complete`

main `work_reality`, `session_activity`, `artifact`, `delivery` event는 side stream에 보내지 않는다.

### 6.4 side context projection

최소 sufficient context 순서:

1. exact selected quote
2. source message의 bounded containing block 또는 full message가 budget 안이면 full message
3. 직전/직후 user-assistant exchange의 bounded canonical text
4. source Run의 public evidence/artifact pointers
5. side branch의 prior user/assistant messages
6. current Work handle의 status/revision과 `not applied` fact
7. 현재 side user question

selected source는 instruction이 아니라 quoted data로 frame한다. user question만 current instruction이다. web/tool raw output,
secret, internal command/path, private reasoning은 투영하지 않는다.

### 6.5 side-safe Tool policy

첫 제품 candidate는 두 단계로 연다.

#### SE-2A — Tool 0 explanation

- 선택 메시지·near context·기존 public evidence만 사용
- Work write 0
- external read 0
- direct model quality와 isolation을 먼저 자격

#### SE-2B — read-only Hand

필요성이 실제 실패로 확인될 때만 다음 metadata contract를 도입한다.

```yaml
selectionExploration:
  availability: read_only | unavailable
  externalEffect: false
  localMutation: false
  secretInput: false
```

tool name 문자열 allowlist만으로 안전을 만들지 않는다. Tool definition이 이 capability metadata를 선언하고 runtime이
effect preflight와 함께 검사한다.

첫 후보의 정확한 경계:

| capability | side 허용 | 추가 사실 |
|---|---|---|
| 현재 선택·bounded Conversation context | 허용 | main history·checkpoint 변경 0 |
| canonical conversation/session recall | 허용 | 현재 사용자 소유 Session·read-only |
| exact existing Artifact/source read | 허용 | 새 Preview publication·version 0 |
| public web search/read | 후속 SE-2B 후보 | network observation receipt, submit·login·download 0 |
| Memory recall | 후속 후보 | selection 목적에 관련된 exact source만, write·promotion 0 |
| Browser navigate/snapshot/click/fill | 금지 | visible/external interaction 없음 |
| Terminal·program·workspace patch | 금지 | local process·mutation 0 |
| Connection·credential·Capability install | 금지 | secret·auth·new capability 0 |
| Delivery·Telegram·external send | 금지 | 외부 상대 effect 0 |
| Automation·Memory/Skill/Learning write | 금지 | future·persistent state 0 |
| Integral Method·Artifact creation | apply 전 금지 | apply 뒤 canonical Work에서만 선택 가능 |

웹 읽기는 local mutation이 없더라도 실제 network observation이다. `externalEffect:false` 하나로 뭉개지 않고
`networkRead:true`, observed host, timeout·failure를 receipt에 남긴다. Browser action, Terminal, workspace patch,
connection, delivery, automation, memory write는 unavailable이다.

### 6.6 apply request

```json
{
  "requestId": "uuid",
  "instructionMessageHandle": "opaque-side-message",
  "expectedTargetHandle": "opaque-work",
  "expectedRevision": 3
}
```

server는 side assistant 답을 instruction으로 직접 사용하지 않는다. handle은 user-authored side message 또는 사용자가
확정한 apply draft만 resolve할 수 있다.

### 6.7 apply two-phase exact-once

```text
validate side + anchor + target revision
→ WorkStore.prepareInputAdmission(source=selection_exploration, requestId)
→ ConversationLedger.append main user message
→ WorkStore.commitInputAdmission
→ ExplicitCorrectionCoordinator.commit current R+1 / paused resume / completed derived Work
→ ConversationLedger.append selection_apply_committed
→ normal execution scheduling
```

crash recovery:

- prepared input만 있고 main message가 없으면 abort
- main message와 prepared input이 있으면 commit/reconcile
- correction 또는 derived Work commit이 있고 side committed event가 없으면 reconciliation event를 append
- result ready 이후 crash는 기존 pending-surface recovery를 사용
- 같은 `requestId` 재요청은 동일 result를 반환하고 revision을 다시 올리지 않는다.

## 7. 보안·안전·프라이버시

### 7.1 instruction/data 분리

- selected text, source message, tool evidence는 data frame이다.
- side user question만 instruction authority를 가진다.
- 선택 본문 안의 `이전 지시 무시` 같은 텍스트가 runtime policy를 바꾸지 못한다.
- side answer는 apply 전까지 Work instruction이 아니다.

### 7.2 credential boundary

현재 UI의 credential-like paste 방어를 side composer에도 재사용한다. client-only 복제 대신 reusable validator를 만들고
server route에도 적용한다. 차단된 text는 Conversation/Run/model request에 남기지 않는다.

### 7.3 cross-session과 stale identity

- 다른 Session의 message handle과 exploration handle 조합은 404/409로 fail-closed한다.
- source digest, projection digest, Work revision 중 하나라도 바뀌면 apply를 막는다.
- client가 보내는 `workId/runId/messageId` raw 값은 받지 않는다.
- closed/deleted Session과 hard-cancelled Work에는 적용하지 않는다.

### 7.4 effect boundary

side mode의 불변식:

```text
Work events changed = 0
Artifact publications = 0
local mutation = 0
external effect = 0
Delivery = 0
Memory write = 0
Learning candidate = 0
```

read-only Hand가 이 불변식을 위반하면 receipt 성공 여부와 관계없이 candidate를 폐기한다.

### 7.5 bounds

숫자는 UX 품질 기준이 아니라 abuse/resource safety cap으로만 둔다.

- 한 selection quote: 최대 8 KiB
- 한 side user message: 최대 8 KiB
- 한 branch projection: 최대 128 KiB
- open branch 수와 message 수는 baseline에서 실제 사용을 측정한 뒤 bounded cap 결정
- side run resource accounting은 기존 Run ledger에 기록

### 7.6 retention과 삭제

- side events는 parent Conversation의 보존/backup/delete lifecycle을 따른다.
- Session 삭제 시 side branch만 orphan으로 남지 않는다.
- panel close는 UI close이며 기록 삭제가 아니다.
- 영구 삭제 UX는 현재 Session deletion 계약과 함께 다루고 첫 Gate에서 별도 destructive button을 만들지 않는다.

## 8. 파일별 구현 계획

### 새 파일 후보

| 파일 | 책임 |
|---|---|
| `refoundation/src/selectable-message-projection.js` | Markdown→visible text projection, mapping, digest, anchor validation |
| `refoundation/src/selection-exploration-projection.js` | Conversation side events→bounded public/private branch projection |
| `refoundation/src/selection-exploration-runtime.js` | same model/runAgent를 side-safe context·Tool policy로 실행 |
| `refoundation/src/explicit-work-correction.js` | target resolve, stale check, active R+1·paused resume·completed derived Work, idempotent apply coordinator |
| `refoundation/ui/selection-exploration.js` | selection bar, panel/sheet, side SSE, apply UX |

### 기존 파일 변경

| 파일 | 변경 |
|---|---|
| `conversation-ledger.js` | side event append/validation/projection, request idempotency |
| `work-store.js` | active revision source provenance, paused resume, completed derived Work provenance |
| `memory-portfolio.js` | episode pointer가 exact revision source를 가리키도록 수정 |
| `learning-source-eligibility.js` | side-only Run 제외, apply 후 settled revision만 포함 |
| `console-server.js` | side endpoints/SSE, shared runner seam, session public branch summaries, route serving |
| `console-session-store.js` | side를 transcript/title/turn count에 넣지 않음을 유지; apply main entry metadata만 허용 |
| `markdown.js` | selectable text pure projection과 browser/server parity |
| `index.html` | panel shell/CSS, message handle binding, integration hook |
| `session-search-tool.js` | 기본 exclusion을 반대시험으로 고정; 필요하면 명시 flag 없이 side 검색 금지 |
| `work-reality-projection.js` | apply commit 이후에만 current R+1 또는 derived Work input fact 표시 |
| `t5-whole-state.js` | restored side anchor/apply relationship validation |
| `console-config.js` | qualification feature flag/default-off 설정이 필요할 때만 추가 |

`console-server.js`가 이미 매우 크므로 selection logic을 inline으로 더 쌓지 않는다. 다만 전체 server 재설계도 하지 않고,
side feature가 필요한 seam만 추출한다.

## 9. RED 반대시험

### 9.1 anchor

1. raw Markdown offset과 rendered text offset이 다른 link/bold/list/table selection.
2. 한글 NFC/NFD, emoji surrogate pair, combining mark에서 UTF-16 boundary가 어긋남.
3. 같은 quote가 message 안에 두 번 나타나지만 prefix/suffix가 다름.
4. selection 후 source digest가 달라짐.
5. 두 message를 가로질러 selection.
6. streaming preview를 선택했으나 아직 canonical message가 없음.
7. 다른 Session handle replay.
8. quote에 HTML/script/link payload가 있음.

### 9.2 side isolation

1. side 질문 전후 WorkStore events byte가 동일하다.
2. main Session transcript/title/turn count가 동일하다.
3. main context, Memory, Reflection, Learning candidate가 동일하다.
4. side Stop이 main Run/process를 중지하지 않는다.
5. main Stop이 side를 Work cancellation으로 기록하지 않는다.
6. side model이 mutation Tool을 요청해도 actual call 0이다.
7. side failure가 main Work를 unresolved로 바꾸지 않는다.
8. side answer가 main Conversation search에 나타나지 않는다.

### 9.3 context correctness

1. exact selected source와 current question이 항상 공급된다.
2. unrelated side branch는 공급되지 않는다.
3. stale current Work facts를 source Work 사실로 말하지 않는다.
4. selected prompt-injection text가 instruction authority를 얻지 않는다.
5. Artifact/source pointer가 없는데 있는 것처럼 만들지 않는다.
6. context budget 초과 시 선택 원문과 질문을 보존하고 먼 context부터 줄인다.

### 9.4 explicit apply

1. 클릭 전 Work event 0, 클릭 후 exact one admission.
2. active busy Work의 safe boundary 전에 stale Tool tail이 실행되지 않는다.
3. active busy R3에 apply하면 정확히 R4 한 번.
4. completed R2에 apply하면 기본 후보는 새 derived Work이며 `derivedFromWorkId·derivedFromRevision·anchor`가 exact하다.
5. 같은 workId reopen 후보는 별도 반대시험에서 과거 settlement·Delivery·Episode·Learning을 바꾸지 않을 때만 허용된다.
6. Direct source에 Work가 없으면 fake revision이 아니라 derived new Work.
7. 다른 Work가 active면 silent rebind 0.
8. double click/retry가 revision 또는 derived Work를 두 번 만들지 않는다.
9. apply 준비 뒤 source Work revision이 바뀌면 409.
10. assistant side answer handle은 user confirmation 없이는 거부된다.
11. crash 지점별 reconcile이 model/tool/external effect를 blind replay하지 않는다.
12. exact persisted main surface 뒤에만 input executed terminal.
13. revision 또는 derived Work의 Episode/source pointer가 correction message를 가리킨다.

### 9.5 Progress/Artifact/Undo

1. side progress가 main Work reality/version을 바꾸지 않는다.
2. side read-only receipt가 Artifact card나 effect receipt를 만들지 않는다.
3. apply 후 생성된 Artifact v2는 기존 family/version/Preview/Download/Reveal을 사용한다.
4. apply 후 file mutation Undo는 exact current preimage에서만 가능하다.
5. side close가 Artifact/Work Undo처럼 보이지 않는다.

### 9.6 reconnect/backup

1. reload 뒤 open branch와 settled messages가 복원된다.
2. answering 중 Runtime crash는 interrupted로 보이고 자동 재실행하지 않는다.
3. backup→restore 뒤 anchor와 parent message 관계가 유지된다.
4. dangling parent/apply Work pointer는 activation 전에 거부된다.
5. deleted Session의 branch가 sidebar/search에 나타나지 않는다.

### 9.7 UI·접근성

1. mouse drag, Shift+Arrow, touch selection에서 action 접근 가능.
2. native copy/context menu 유지.
3. narrow/light/dark/reduced-motion에서 panel 사용 가능.
4. panel open/close 뒤 main scroll·selection·composer draft 유지.
5. main와 side Stop을 스크린리더 이름으로 구분.
6. stream 중 main DOM update가 finalized selection panel을 닫지 않음.
7. stale apply button은 disabled가 아니라 정확한 이유와 다음 행동을 제공.

## 10. 기존 회귀 suite

필수 focused suite:

- `work-store.test.js`
- `turn-admission.integration.js`
- `input-settlement-scope.test.js`
- `qh3-input-settlement-boundary.test.js`
- `conversation-projection.test.js`
- `conversation-checkpoint.test.js`
- `session-search-tool.test.js`
- `work-reality-projection.test.js`
- `work-cancellation-recovery.integration.js`
- `artifact-publication-projection.test.js`
- `sixth-ux-conversational-workspace.test.js`
- `t5-whole-state.test.js`
- `whole-state-component-registry.test.js`

조사 중 현재 HEAD에서 다음 focused baseline을 실행했다.

```text
node --test --test-concurrency=1 \
  refoundation/test/work-store.test.js \
  refoundation/test/turn-admission.integration.js \
  refoundation/test/conversation-projection.test.js \
  refoundation/test/work-reality-projection.test.js \
  refoundation/test/sixth-ux-conversational-workspace.test.js
```

결과: `68 pass · 0 fail`.

구현 candidate는 focused green만으로 끝내지 않고 `npm run refoundation:check`, 관련 product integration, actual Console
human journey를 통과해야 한다. package·signing·Windows 물리 자격은 Selection 기능 연구와 무관하므로 이 Gate에
섞지 않는다.

## 11. 개발 Gate와 단계

### SE-0 — Product delta 0 baseline

목적:

- 긴 assistant answer에서 사용자가 copy/paste로 후속 질문하는 현재 click/keystroke/맥락 손실을 실제 Console에서 측정
- source quote, Work state, Artifact evidence가 필요한 세 mission 수집
- 기능 없이도 현재 main follow-up이 충분한 경우를 negative control로 확보

통과:

- 서로 다른 세 목적 분야에서 같은 selection friction이 재현된다.
- 단순 copy action만으로 충분한 경우와 side exploration이 필요한 경우가 분리된다.

중단:

- 실제 friction이 재현되지 않거나 main follow-up이 같은 비용으로 충분하면 구현하지 않는다.

### SE-1 — Canonical anchor와 read model

제품 변화:

- persisted message selection handle
- exact visible-text projection
- ConversationLedger side events/projection
- panel에 selection quote만 표시, model call 0

통과:

- Unicode/Markdown/stale/cross-session RED 전부 green
- main Conversation/context/search/Work write delta 0

### SE-2 — Same-T5 side answer

제품 변화:

- same modelFactory/runAgent
- Tool 0 side context projection
- panel SSE/Stop/reconnect

통과:

- 별도 persona/Memory/Work 0
- 선택 문맥 이해가 main copy/paste 대비 정확성·설명 부담에서 우위
- main Direct context/calls/wall delta 0

중단:

- side answer가 main follow-up보다 반복해서 나쁘거나 context 오염을 만든다.
- 같은 지능을 유지하려고 main executeTurn 전체를 복제해야 한다.

### SE-3 — Explicit apply와 revision provenance

제품 변화:

- apply draft
- idempotent two-phase admission
- active Work correction R+1·paused resume
- completed/Direct source의 derived Work
- revision·derivation source provenance

통과:

- click 전 Work delta 0
- click 후 exact one correction 또는 derived Work
- stale/double/crash/other-Work 반대시험 green
- normal Work completion/result surface/Delivery settlement 재사용

### SE-4 — Read-only source/evidence extension

SE-2에서 source/evidence 미달이 실제로 반복될 때만 연다.

- Tool metadata 기반 side-safe read-only Hand
- parent Run public Evidence/Artifact pointer
- 숫자·주장→source trace

중단:

- effectful Tool 예외를 하나씩 늘려야 한다.
- Method Runtime이나 Artifact store를 먼저 만들어야 한다.

### SE-5 — Human HQ와 clean second pass

실제 Console mission:

1. 긴 분석 문장 선택→의미 질문→닫기, Work delta 0.
2. 결과 표 숫자 선택→근거 질문→existing source 확인.
3. 진행 중 Work 선택→영향 질문→main Work 계속 진행.
4. side correction 명시→apply→active R+1 또는 completed derived Work→final result.
5. apply 후 Artifact v1→v2→Preview/Reveal/Undo.
6. side Stop/main Stop 교차.
7. reload/restart/backup restore.
8. narrow/dark/keyboard/touch.

첫 pass에서 발견·수리하고, clean state에서 같은 전체 흐름을 두 번째로 통과한 뒤에만 후보 완료를 판정한다.

## 12. 단계별 커밋 계획

### Commit 1 — RED: selection identity

권고 메시지: `Add selection anchor countertests`

- 새 anchor/Markdown/Unicode/cross-session tests
- 제품 코드 변화 0

### Commit 2 — canonical side events

권고 메시지: `Persist selection-scoped conversation branches`

- `selectable-message-projection.js`
- `selection-exploration-projection.js`
- `conversation-ledger.js`
- whole-state relation tests

### Commit 3 — same intelligence read-only runtime

권고 메시지: `Run side exploration through the T5 model path`

- shared context/model seam
- Tool 0 side runtime
- side Run ledger metadata
- no Work/Memory/Artifact invariant tests

### Commit 4 — server stream and stop

권고 메시지: `Expose bounded side exploration streams`

- endpoints, SSE, side AbortController, reconnect
- local guard/body/idempotency/security tests

### Commit 5 — Console interaction

권고 메시지: `Add T5 selection exploration surface`

- action bar, right panel/bottom sheet
- quote pin, side input/progress/stop
- light/dark/narrow/accessibility tests

### Commit 6 — Work correction and derivation provenance

권고 메시지: `Preserve exact Work correction and derivation sources`

- `work-store.js`
- `memory-portfolio.js`
- Work history/Learning pointer adjustments
- active R+1·paused resume·completed derived Work RED tests
- same Work reopen은 별도 A/B 증거 없이는 구현하지 않음

### Commit 7 — explicit apply exact-once

권고 메시지: `Promote explicit side corrections into canonical Work`

- `explicit-work-correction.js`
- apply API/UI
- two-phase crash/double/stale tests
- normal result/Artifact/Undo integration

### Commit 8 — qualification closeout

권고 메시지: `Qualify selection side exploration in the actual Console`

- focused + full check
- actual Console evidence
- clean second pass evidence
- current Gate document는 오너가 Gate 채택을 결정한 경우에만 별도 변경

각 commit은 관련 경계 하나를 완결하고, `git add -A/-u` 없이 exact path만 stage한다. 기존 미추적 DOCX/연구 자료를
함께 stage하지 않는다.

## 13. 합격 기준

다음 논리곱이 모두 성립해야 한다.

```text
정확한 persisted selection anchor
AND 같은 T5 model/context contract
AND side 질문 중 Work/Effect/Artifact/Memory write 0
AND explicit apply 전 자동 승격 0
AND exact target Work/revision stale protection
AND apply exact once
AND active correction·paused resume·completed derived Work provenance
AND 기존 Progress/Stop/Artifact/Undo/Delivery 계약 무회귀
AND reconnect/restart/backup 관계 보존
AND 실제 Console에서 copy/paste보다 낮은 인간 맥락 비용
AND clean second whole-flow pass
```

제품 체감 합격:

- 사용자는 선택한 부분을 다시 설명하지 않는다.
- 옆 질문이 실제 작업을 바꿨는지 불안해하지 않는다.
- 적용할 때 무엇이 어느 작업에 들어가는지 이해한다.
- 결과가 main Conversation의 정상 진행·Artifact·Undo 흐름으로 돌아온다.
- 내부 Agent/Thread/Run/Work ID를 배울 필요가 없다.

성능 합격:

- side를 쓰지 않는 Direct·일반 Work의 model calls/context bytes/UI listener cost가 증가하지 않는다.
- side answer의 first feedback과 전체 wall은 같은 질문을 main에 copy/paste한 baseline과 비교한다.
- 정확성·source truth·apply safety가 나빠지면 빠른 candidate도 폐기한다.

## 14. 중단·폐기 기준

다음 중 하나면 기능을 더 얹지 않고 구조를 재판정한다.

- side를 별도 Agent/persona/Memory로 만들어야만 답 품질이 나온다.
- main executeTurn을 두 번째로 복제해 두 실행 코어가 생긴다.
- side 질문이 Work/Effect/Artifact를 직접 바꾸는 예외가 필요하다.
- completed Work를 기존 settlement 영향 감사 없이 같은 `workId`로 reopen한다.
- derived Work provenance를 side 전용 임시 pointer로만 두어 Work history·Episode·Learning에서 끊긴다.
- 같은 selection identity 결함에 세 번째 patch가 필요하다.
- client-selected text를 canonical source 검증 없이 신뢰한다.
- stale Work에 자동으로 최신 Work를 골라 적용한다.
- side answer를 사용자 confirmation 없이 instruction으로 승격한다.
- main Direct context/calls/wall이 증가한다.
- tests는 green이지만 실제 Console에서 panel이 main 진행·읽기·Stop을 방해한다.
- package·signing·Windows 물리 자격을 Selection 기능 Gate에 편의상 함께 연다.

## 15. 권고 첫 작업

구현 Gate가 열리면 첫 작업은 UI mockup이 아니다.

> 현재 NX exact head에서 파일 감사를 갱신한 뒤, `selectable-message-projection`의 Markdown/Unicode exact anchor RED와
> `completed source → derived Work provenance` RED를 먼저 작성한다.

두 RED가 없으면 패널은 보여도 어느 문장을 물었는지, 어느 Work를 바꿨는지, 재시작 뒤 무엇이 반영됐는지 증명할
수 없다. 두 경계가 선 뒤에야 reference screenshot의 interaction을 T5 surface로 안전하게 가져올 수 있다.

## 16. 최종 제품 문장

> T5의 지능은 하나지만 사용자의 생각은 가지를 칠 수 있다. 사용자는 대화의 어느 부분이든 붙잡아 같은 T5와
> 옆에서 더 깊게 이해하고 검토한다. 그 가지는 중심 작업을 몰래 바꾸지 않으며, 사용자가 정확히 반영한 순간에만
> source와 revision이 보존된 current correction 또는 derived Work로 합쳐져 T5의 정상 실행·검증·결과·Undo 흐름을
> 이어간다.
