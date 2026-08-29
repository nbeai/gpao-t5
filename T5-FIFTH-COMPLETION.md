# T5 Fifth Completion — Android Judgment & Context Runtime

상태: `FIFTH_COMPLETION_ACTIVE · CJ0_CJ5_COMPLETE · CJ6_WIRE_CONTEXT_OPEN`
4차 귀환 기준: `fe51c8c5 · FOURTH_COMPLETION_COMPLETE_MACOS_PRODUCT_SCOPE`
4차 release-only 후속선: `8c2a3b05 · 0.4.0 packaging lineage · 설치 자격 진행과 5차 개발은 분리`
5차 구현 기준·branch·worktree: `fe51c8c5 · codex/t5-fifth-context-judgment-plan · /Users/jyp/Developer/t5-fifth-plan`

이 문서는 T5 5차 개발의 단일 계획 정본이다. 제품 정의는 `T5-PRODUCT.md`, 4차 완료 역사와 실제
사용자 증거는 `T5-FOURTH-COMPLETION.md`와 `refoundation/evidence/s4-hq-console-closeout-2026-08-30.json`이
담당한다. 4차 설치 패키지 제작·검증은 별도 작업이며 이 문서 때문에 중단·변경하지 않는다.

오너는 5차 전체 계획 완료를 승인했다. 4차 완성선을 자동 병합·덮어쓰기하지 않고 현재 별도 branch와
worktree에서 CJ0부터 순서대로 진행한다. 돈 지출·새 외부 상대 전송·비밀값 입력·백업 없는 파괴는 기존 제품
경계를 유지하며, 이 승인으로 의미·권한·외부 효과 범위를 새로 넓히지 않는다.

`Android`는 사용자의 상황을 이해하고 필요한 순간에 적절한 눈·기억·손을 사용하는 지능의 비유다. 모바일
운영체제를 뜻하지 않는다. 4차가 강한 몸·손·안전·복구를 완성했다면 5차는 그 능력을 언제, 왜, 얼마나 사용할지
아는 판단과 Context를 완성한다.

---

## 1. 제품 한 문장과 최종 완료 문장

### 제품 한 문장

> T5는 모든 말을 Tool 사용 문제로 보지 않는다. 먼저 강한 모델로 현재 상황을 이해하고, 목적을 실제로
> 바꾸는 기억·대화·현실·Evidence만 선택하며, 필요한 순간에만 가장 적합한 손을 사용해 빠르고 정확하고
> 경제적으로 목적을 끝낸다.

### 최종 완료 문장

> T5는 평범한 대화에서는 강한 LLM의 지능과 언어 품질을 가볍고 자연스럽게 제공하고, 최신 정보·개인 맥락·
> 실제 행동이 필요할 때만 관련 Context와 능력을 정확히 결속한다. 긴 대화·교정·재시작·모델 전환 뒤에도
> 사용자의 현재 목적과 중요한 결정을 잃지 않으며, 불필요한 검색·질문·도구·행동 없이 해야 할 때 해야 할
> 일을 수행하고 충분하면 멈춘다.

5차의 성공은 Prompt bytes·Tool 수·token 감소가 아니다. 같은 사용자 목적에서 판단·언어·기억·실행 품질을
유지하거나 높이면서 불필요한 Context·왕복·행동을 줄이고 사용자가 T5의 일머리와 눈치가 좋아졌다고 느끼는 것이다.

---

## 2. 왜 지금 이 개발인가

4차까지 다음 기반이 실제 제품에서 섰다.

- 자연어 파일 발견·OCR·시각 후보·Artifact 전달
- 대형 Terminal output·process ownership·crash settlement
- managed mutation confinement·atomic publication·Undo
- multi-file structured authoring
- model-authored program의 격리·독립 검증·Artifact 발행
- 신규·기존 프로젝트의 build·Browser 기능 확인·재시작·Undo
- Conversation·Work·Memory·Resource·Effect·Delivery의 canonical state
- 실제 Console 진행·교정·재접속·Telegram 연속성

그러나 같은 강한 모델이 다음과 같이 불필요하게 무거워질 수 있다.

- 직접 답할 질문에도 큰 instruction·Tool surface·Work framing이 들어감
- 현재 판단을 바꾸지 않는 Memory·과거 Assistant·ToolReceipt가 섞임
- Tool 발견을 위해 추가 model turn이 발생하거나 반대로 필요한 Tool을 놓침
- 최종 답 직전에도 중간 실패·후보·기술 로그가 남아 언어 품질을 방해함
- provider continuation·reasoning·cache와 깨끗한 canonical rebuild가 충돌함
- 충분히 끝났는데 추가 확인·검색·행동으로 확대함

따라서 5차는 기능 추가 차수가 아니다.

```text
Context Runtime
+ Judgment Intelligence
+ Natural Agency
```

- `Context Runtime`: 현재 model call에 무엇을 어떤 권위·순서·크기로 공급하는가
- `Judgment Intelligence`: 직접 답·공개 근거·개인 맥락·행동·질문·정지 중 무엇이 적합한가
- `Natural Agency`: 필요한 순간에 필요한 만큼만 개입하고 충분하면 멈추는가

이 개발이 성공하면 T5는 Tool·Connector 수 경쟁을 넘어 다음 제품이 된다.

> 강한 모델의 지능, 개인의 장기 기억, 로컬 컴퓨터의 현실, 실제 효과·결과·복구를 한 사람과의 지속적인
> 관계 안에서 가장 적은 고신호 Context로 결속하는 제품.

---

## 3. 재개발하지 않는 정본과 역할 경계

### Canonical Reality — 진실

다음 원장은 그대로 유지한다.

- ConversationLedger
- MemoryLedger·Memory claim·correction·retract·temporal validity
- WorkStore·revision·input settlement·completion
- RunLedger·ResourceLedger
- Effect·Artifact·Delivery·Undo·Recovery
- source RecordRef·exact reopen
- Capability·Connection의 실제 사용 가능 상태

Context에 보이지 않는다고 삭제·망각된 것이 아니다. 필요한 경우 canonical source를 exact handle로 다시 연다.

### Portable Canonical Context — provider를 건너는 현재 의미

- 현재 사용자 원문과 최신 교정
- accepted decision·closed·deferred·do-not-reopen
- current Work·revision·result·unresolved blocker
- completed effect·Artifact·delivery
- source reopen handle
- 모델 전환·Runtime 재시작·backup/restore에 필요한 bounded checkpoint

### Provider-Local Ephemeral Context — 해당 provider에서만 유지 가능한 상태

- native reasoning item
- response continuation
- prompt cache
- provider-native compaction
- opaque provider session identity

Provider-local 상태를 canonical truth로 승격하지 않고, portable context를 provider 최적화 때문에 잃지 않는다.

### 역할 경계

| 주체 | 책임 |
|---|---|
| 모델 | 목적·관련성·깊이·방법·질문·완료·사용자 문장 판단 |
| Runtime | source·identity·revision·scope·bytes·권한·실행·effect·delivery·reopen 사실 |
| Provider Adapter | wire 형식·reasoning continuation·cache·compaction·usage·modality |
| Context Compiler | canonical reality에서 현재 call에 필요한 bounded view 조립 |

Runtime은 단어·업무명·파일 확장자·서비스명·모델명 정규식으로 사용자의 의미를 선택하지 않는다.

---

## 4. 4차를 망가뜨리지 않는 5차 개발 헌법

### 4.1 4차는 불변 귀환선

- 4차 완료 commit `fe51c8c5`를 제품 귀환점으로 유지한다.
- release-only 0.4.0 package lineage와 5차 개발 이력을 섞지 않는다.
- 5차는 승인된 exact baseline에서 별도 branch·worktree로 시작한다.
- 5차 후보 실패가 4차 제품·설치본·정본을 변경하지 못한다.

### 4.2 CJ0는 제품 변경 0

기존 Run·prompt dump·ContextReceipt·TransmissionReceipt·ResourceReceipt를 먼저 재계산한다. 이미 답이 있는
축을 다시 유료 live 실행하지 않는다.

### 4.3 한 번에 한 축만 변경

다음처럼 여러 축을 한 후보에 합치지 않는다.

```text
Prompt 축소
+ Work 생성 지연
+ Tool schema 축소
+ Memory 선택 변경
+ provider session rebuild
```

한 후보는 원인과 결과를 설명할 수 있는 한 상태 전이만 바꾼다.

### 4.4 후보는 기본값이 아니다

- 가능한 경우 shadow·qualification-only·default-off로 시작한다.
- candidate가 실패해도 현재 4차 제품 행동은 유지된다.
- 동일 목적 A/B가 통과하기 전 product default로 승격하지 않는다.

### 4.5 품질·안전은 절대경계

다음 중 하나라도 나빠지면 token·wall·cache가 좋아져도 폐기한다.

- 사용자 현재 요청과 최신 교정
- 필요한 Tool 발견과 실제 기능 범위
- Memory precision·recall·temporal truth
- 결과 정확성·완전성·Artifact·Undo
- Effect·Delivery·unknown 진실성
- 사용자 dirty 변경·권한·비밀 경계
- 실패 뒤 미시도 실제 대안

### 4.6 Direct 최적화가 Agent 능력을 제거하면 실패

직접 질문이 빨라져도 파일·문서·프로그램·프로젝트 요청에서 필요한 Work와 Tool을 열지 못하면 채택하지 않는다.

### 4.7 Provider를 동시에 바꾸지 않는다

기본 자격 provider에서 원리를 확인하고 각 provider의 wire·cache 차이는 Adapter A/B로 분리한다. 모델별 업무
Prompt와 모델별 T5 성격은 금지한다.

### 4.8 같은 결함 가족의 세 번째 patch 금지

같은 가정의 두 후보가 실패하면 문구·조건을 더 붙이지 않는다. 구조·wire·provider·평가 원리를 재검토하고
새 관점이 없으면 제품 변경 0으로 닫는다.

### 4.9 실패를 숨기지 않는다

- 실패한 candidate와 불리한 비용을 evidence에 보존한다.
- fixture·oracle·Prompt를 시험 중 바꿔 초록을 만들지 않는다.
- 자연어 품질을 문자열 일치로 판정하지 않는다.
- 테스트 수·Tool 수·코드 줄 수를 제품 완료로 보고하지 않는다.

### 4.10 전체 중단 조건

다음 중 하나면 5차를 억지로 완료하지 않고 4차를 유지한다.

- 고정 Intent Router나 질문 정규식이 필요함
- 모델별 Prompt·업무별 예외가 증가함
- Direct가 좋아지는 대신 필요한 Agent 기능을 반복해서 놓침
- 중요한 Memory·교정·현재 Work를 잃음
- canonical rebuild가 언어·추론 품질을 설명 불가능하게 악화시킴
- 같은 품질을 유지하는 경제적인 후보가 없음
- 실제 사용자가 4차보다 좋아졌다고 느끼지 못함

```yaml
FIFTH:
  product_candidate: REJECTED_OR_PARTIAL
  fourth_baseline: PRESERVED
  observations: RETAINED
```

5차의 목표는 반드시 성공을 꾸미는 것이 아니라, 성공한 후보만 4차 위에 올리고 실패 후보가 4차를 오염시키지
못하게 하는 것이다.

---

## 5. CJ0 선확정 Known Facts

다음은 현재 source·4차 evidence에서 이미 확인된 사실이다. live 측정 전에 baseline으로 등록한다.

- 전역 instruction은 약 30KB다.
- Tool별 상세 운용 지침 일부가 global instruction에 있다.
- 일반 Turn에도 Work·Working Memory projection이 영향을 줄 수 있다.
- dynamic `runtimeContext`가 instructions에 접합된다.
- current-time block이 user content 뒤에 접합된다.
- Tool activation에 따라 visible schema 집합이 바뀐다.
- Anthropic adapter는 `cache_control`을 사용하지 않는다.
- OpenAI adapter는 `prompt_cache_key`와 provider-native compaction을 사용하지 않는다.
- 같은 provider continuation은 reasoning·cache를 보존할 수 있지만 오래된 Tool input도 유지한다.
- canonical rebuild는 오래된 Context를 제거할 수 있지만 provider-local reasoning·warm cache를 잃는다.

정확한 분류:

- `runtimeContext → instructions`: stable prefix·cache 축
- Tool schema 변화: cache·wire surface 축
- `current time → user content 뒤`: 사용자 원문 권위·초점 축

현재 시각 접합을 cache 결함으로 잘못 기록하지 않는다.

4차 재사용 evidence:

- `refoundation/evidence/s4-hq-console-wave-2026-08-30.json`
- `refoundation/evidence/s4-hq-console-closeout-2026-08-30.json`
- S4-A~P의 prompt dump·Context/Transmission/Resource Receipt
- G 사업·개발·개인 actual
- P 신규·기존 project actual
- 직접 대화 A, 파일 B, 사무 C, 프로그램 D, 프로젝트 E·F, 장기 교정 G, UX H, capability I, channel J

4차 closeout의 수치는 5차의 고정 합격 상한이 아니라 동일 목적 비교 기준이다. provider 분산을 causal 개선으로
과장하지 않는다.

---

## 6. 공통 측정과 채택식

### Context inventory

- stable instruction bytes
- dynamic instruction bytes
- current user bytes
- Conversation bytes
- Memory candidate·selected·reopened bytes
- Work·Situation bytes
- Tool definition count·bytes
- unused Tool bytes
- ToolReceipt·repeated Receipt bytes
- compacted·reopened bytes
- provider actual wire bytes
- cache read/write tokens
- native reasoning/continuation 사용 여부

### 사용자 목적

- 목적 정확성·완전성
- 최신 교정 보존
- 관련 Memory precision·필요 Memory recall
- first useful result
- model/tool calls·tokens·wall
- 불필요한 질문·검색·Tool·행동
- 최종 답 자연스러움·직접성·통찰력
- Effect·Artifact·Undo·Delivery 무회귀
- 같은 일을 다시 맡길 의향

### 공통 채택식

```text
현재 목적 정확성·완전성·권한·진실성 무회귀
AND 목표한 판단·자연스러움·경제성 중 실제 사용자 이익 증가
AND 추가 비용과 제거 비용을 실제 wire·usage로 설명
AND 같은 품질의 더 경제적인 미시도 경로 없음
AND Direct와 Agentic positive control 모두 유지
AND 모델별 Prompt·업무 Router·새 canonical Store 0
```

모든 수치를 동시에 줄일 필요는 없다. 그러나 단순 대화가 느려지거나 기계적으로 변하고도 Context가 작아졌다는
이유로 채택할 수는 없다.

---

## 7. Instruction Lineage & Admission

CJ1에서 개별 자연어 문장을 Runtime identity로 만들지 않는다. 관리 단위는 `instruction family`다.

### Family 종류

- `product_invariant`
- `cross_tool_policy`
- `tool_guidance`
- `measured_failure_guard`
- `interaction_style`
- `candidate`

### Build-time manifest 필수 필드

```yaml
id: stable-family-id
kind: measured_failure_guard
ownerSource: product | tool | adapter | incident
evidence:
  incident: stable-incident-id
  references: []
enforcement:
  current: global_instruction | tool_description | runtime_invariant | fixture
  target: global_instruction | tool_description | runtime_invariant | fixture | remove
countertests: []
appliesTo:
  contextDepth: [direct, public, personal, agentic]
  providers: [portable]
lifecycle:
  status: active | candidate | deprecated
  removeWhen: measurable-condition
```

규율:

- 새 전역 instruction은 오너 제품 불변식이거나 실제 사고·evidence·countertest에 결속되지 않으면 admission 거부
- 같은 실패를 설명하는 family 중복 거부
- Tool 운용법은 가능한 한 Tool description으로 이동
- 긴 절차는 Skill, 구조 검증은 Runtime, 사례는 fixture로 이동
- family 이동·삭제는 동일 목적 A/B와 반대시험 뒤 수행
- 새 Store·Runtime DB·사용자 UI·Prompt CMS 0

manifest는 build-time 검사와 lineage 문서일 뿐 모델 Context에 자동 주입하지 않는다.

---

## 8. Gate

### CJ0 — Current Context Reality Baseline

제품 변경 0으로 현재 Context와 최초 판단 현실을 고정한다.

실행 순서:

```text
기존 S4-A~P·HQ exact-head 증거 재사용
→ 현재 Context 지표 재계산
→ 없는 축만 live 실행
→ 최초 Context 결함 가족 하나만 개통
```

네 깊이:

1. Direct Intelligence
2. Public Grounding
3. Personal Context
4. Agentic Execution

세 영역:

- 경영·개인 판단
- 파일·사무 업무
- 개발·프로젝트

CJ0 신규 live는 기존 증거에 없는 다음 축만 연다.

- Direct Intelligence의 언어·통찰·Tool 0 품질
- Memory precision·recall·source reopen 품질
- provider cache·actual wire context·continuation/rebuild 차이

반대시험:

- 직접 답할 질문에 exec·Web·Work
- 최신 정보에 내부 기억만 사용
- 개인 자료가 필요한데 일반론만 답함
- 행동 요청에 설명만 하고 종료
- 사용자 결정이 필요한데 임의 확정
- 충분히 끝났는데 추가 행동 확대

완료 문장:

> 현재 T5의 Context 구성 비용과 최초 선택 오류가 직접 대화·공개 정보·개인 맥락·실행에서 기존 증거 재사용과
> 최소 신규 관측으로 분리됐다.

CJ1 개통 조건은 전역 instruction family 하나가 실제 품질·비용 미달과 결속되는 것이다.

CJ0 actual은 4차 synthetic actual 세 Run을 재사용했다. 신규 live·제품 변경은 0이다.

- Direct는 1 model call·Tool 0·3.225초로 정확히 답했지만 첫 request에 instruction 30,693 bytes와 Tool
  definition 20,781 bytes·14개가 함께 전송됐다.
- 신규 프로젝트는 19 model calls·20 tools·596,925 tokens·2,637,449 request bytes였고 current Run 최대
  104,750 bytes, repeated ToolReceipt 최대 88,363 bytes였다.
- 기존 프로젝트는 25 model calls·24 tools·688,770 tokens·3,358,623 request bytes였고 current Run 최대
  115,269 bytes, repeated ToolReceipt 최대 86,236 bytes였다.
- current source의 synthetic `consoleInstructions`는 30,277 bytes·99 lines·4,519 words다.
- `runtimeContext→instructions`, current time의 user content 후접합, ordinary Work·Working Memory, Tool schema
  변화, Anthropic cache_control 부재, OpenAI prompt_cache_key/native compaction 부재를 source known fact로
  확정했다.

첫 결함은 `direct_turn_global_instruction_and_tool_surface`다. 사용자 결과는 성공했으므로 Direct path·Work·Tool을
동시에 바꾸지 않는다. CJ1에서 global instruction family 하나만 분류·이동 후보로 열고 동일 Direct·Agentic
positive control을 비교한다.

근거: `refoundation/evidence/fifth-cj0-context-reality-2026-08-30.json`.

---

### CJ1 — Stable Cognitive Kernel

현재 전역 instruction을 family 단위로 분류한다.

```text
제품 불변식
cross-tool 정책
Tool별 운용법
실측 실패 guard
interaction style
candidate
```

처리 원칙:

- 제품 불변식만 Stable Kernel에 유지
- Tool 운용법은 Tool 활성화 시 description으로 이동
- 긴 절차는 Skill로 이동
- 구조적 강제는 Runtime invariant로 이동
- 과거 결함 예시는 fixture로 이동
- 중복 family 제거
- 고정 byte 목표 없이 family 하나씩 A/B

반대시험:

- instruction을 줄인 뒤 과거 incident 재발
- Tool 설명이 activation 전에 사라져 필요한 Tool 발견 실패
- Stable Kernel 순서 변화로 사용자 현재 지시 권위 하락
- provider마다 다른 T5 성격·완료 기준 발생
- 삭제한 family가 다른 숨은 문장으로 재증식

완료 문장:

> T5의 System Prompt는 모델의 판단 공간을 보존하는 작은 불변 Core가 되고, 모든 instruction family는 출처·
> 소유 경계·반대시험·적용 Context·제거 조건에 결속되며 세부 능력 계약은 필요한 순간에만 로드된다.

CJ1 actual은 개별 문장을 Runtime 객체로 만들지 않고 build-time manifest에서 전역 96개 line 전부를 11개
family로 admission했다. 각 family는 stable id·종류·근거·현재/목표 집행 위치·적용 Context·반대시험·수명·
제거 조건에 결속된다. 첫 실제 이동은 독립적인 `tool.video_caption` 한 family로 제한했다.

- Direct 고정 instruction: 30,277 → 28,650 bytes, 99 → 96 lines
- `video_text`가 보이기 전 caption 전용 규율: 0 bytes
- tool activation 뒤 description: 294 → 1,776 bytes
- model/tool call 변화: activation 전 0
- tool discovery·manual 우선·automatic fallback·caption absence·cache·retry·cleanup: 41/41 통과
- 새 Store·Router·provider별 Prompt·Runtime 의미 판정: 0

이는 모든 family를 즉시 옮겼다는 주장이 아니다. 이동 전 admission과 removal countertest를 강제하는 기반을
완성했고, tool-specific 세부 계약이 필요한 순간에만 로드될 수 있음을 한 family로 증명했다. 나머지 family의
projection은 CJ3·CJ4에서 실제 Context 결함과 결속될 때만 연다.

근거: `refoundation/evidence/fifth-cj1-stable-cognitive-kernel-2026-08-30.json`.

---

### CJ2 — Direct Intelligence & Work Admission

직접 답변이 적합한 요청에서 Agent machinery가 기본값이 되지 않게 한다.

후보:

- 직접 대화 Turn의 active Work 생성 지연
- Working Memory·Situation 비투영
- 진행 상태 미표시
- Tool schema 0 또는 최소 capability request
- model call 1회·tool call 0

Work는 의미 Router가 아니라 다음 실제 사건에서 열린다.

- 모델이 Tool·Evidence·Capability를 요청
- 사용자가 장기 목적을 명시하고 지속 상태가 실제로 필요
- 실제 파일·외부 상태 변경
- 산출물 제작
- 진행·취소·복구가 필요한 실행

금지:

- 단어·문장 정규식 Direct/Work 분류
- 첫 모델이 답하기 전에 별도 Intent model call 강제
- 모든 Turn의 Work brief·purpose schema
- Direct 최적화를 위해 Agent Tool fallback 제거

반대시험:

- 인사·설명·경영 의견에 Work·progress·Tool 발생
- 파일·프로젝트 요청을 Direct로 잘못 종료
- 최신 사실 요청에 Web을 못 엶
- 실행 중 교정이 Work admission 지연 때문에 유실

완료 문장:

> T5는 생각과 대화만 필요한 순간에는 강한 모델의 지능을 가볍게 전달하고, 실제 Work가 시작될 때만 기존
> 실행·진행·취소·복구 상태를 연다.

CJ2 actual은 의미 분류 없이 Work admission의 물리적 순서를 바꿨다. 새 요청은 첫 model response 전에 Work를
만들지 않는다. 모델이 실제 Tool call을 반환하거나, 기존 active Work·실행 중 새 입력·취소처럼 identity가 필요한
사건이 발생할 때 single promise로 Work를 exact once 생성·claim한 뒤 Tool을 실행한다.

- 직접 답변: model 1·Tool 0·Work 0·claim 0·Working Memory projection 0
- agentic 양성 대조: 첫 Tool 전에 `work_bound` exact 1, completion·settlement 유지
- 실행 중 교정·독립 Work·cancel·surface crash·delivery recovery: 무회귀
- G same-language Python 세 model identity와 기존 Terminal/managed process: 무회귀
- Intent Router·정규식·별도 model call·새 Store: 0
- 집중 검사: 52/52

일반 UI의 짧은 요청 수신 표시까지 없앴다는 주장은 하지 않는다. 제거한 것은 모델 판단 전에 만들어지던 Work와
모델 Context의 무의미한 Working Memory다.

근거: `refoundation/evidence/fifth-cj2-direct-work-admission-2026-08-30.json`.

---

### CJ3 — Relevant Memory & Conversation

Memory와 과거 Conversation을 매 Turn 넓게 주입하지 않는다.

후보 흐름:

```text
현재 사용자 요청
→ content-free Memory·Episode candidate
→ 의미 관련성이 실제로 필요할 때 모델 선택
→ exact source reopen
→ bounded context
```

모든 요청에 후보 선택용 추가 model call을 강제하지 않는다. 기존 deterministic relevance로 충분한 positive
control은 유지하고 실제 precision·recall 실패가 있는 축만 후보화한다.

보존 규율:

- 사용자 최신 교정 우선
- current·historical·unknown 분리
- inferred identity 비영속
- source unavailable이면 content 주입 0
- unrelated Memory 주입 0
- private scope의 다른 channel 투영 0
- 새 주제에 과거 Work 자동 부착 0
- 오래된 Assistant·Tool은 handle, 사용자 원문·교정은 보존

반대시험:

- 필요한 과거 결정을 못 찾음
- 동명이인·다른 프로젝트 Memory 혼입
- 과거 Memory가 현재 교정을 덮음
- 관련 Memory가 없는데 selection turn·tokens 증가
- model switch·restart 뒤 source reopen 불일치

완료 문장:

> T5는 사용자를 기억하지만 매 순간 모든 기억을 말하지 않고, 현재 선택을 실제로 바꾸는 기억과 대화만
> 정확한 출처·현재성·scope로 사용한다.

CJ3 actual은 새 Memory·RAG·Store 없이 기존 구조를 현재 제품 계약으로 재자격했다. 오래된 assistant·Tool 구간은
기본 Context에서 bounded handle로 바뀌고 사용자 원문·교정은 inline으로 남는다. Memory content는 자동 주입되지
않고 content-free subject·temporal pointer에서 모델이 선택한 claim만 exact source reopen 뒤 공급된다.

- Terra 78만 자 격리 대화: 지속 사실 2개 선택, 일회성·해결된 오류·assistant 추정·비밀 4개 제외
- checkpoint의 provenance 없는 자동 Memory write: 0, 의도된 `memory_flush_skipped`
- gpt-5.5 현재/과거 Memory: 2/2 exact source reopen, 외부 쓰기 0
- 최신 사용자 교정·private channel scope·natural remember/correct/read/retract/restore: 무회귀
- Conversation·Memory·purpose-history 집중 검사: 19/19
- 제품 source 변경: 0

처음 live runner의 FAIL은 구형 `memory.items`와 폐기된 자동 flush 완료를 요구한 oracle 결함이었다. 이를 제품
성공으로 덮지 않고, long-conversation 선택과 durable temporal Memory 자격을 분리하고 설치 제품과 같은 Keychain
연결·현재 temporal surface를 읽도록 runner만 교정했다. 임의의 대화를 자동으로 장기 Memory에 승격했다는 주장은
하지 않는다.

근거: `refoundation/evidence/fifth-cj3-relevant-memory-conversation-2026-08-30.json`.

---

### CJ4 — Capability Judgment & Tool Economy

현재 visible core Tool과 deferred Tool을 실제 사용자 목적에서 재자격한다.

후보 비교:

```text
A: 현재 core Tool surface
B: tool_search + 최소 직접 Tool
C: stable capability directory + 선택된 schema
```

평가:

- 첫 Tool 선택 정확성
- 필요한 Tool 발견률
- Tool Search 추가 Turn 비용
- 잘못된 Tool 활성화
- Direct 품질·unused Tool bytes
- Tool schema 변화와 provider cache 안정성
- 실행 과업 전체 calls·tokens·wall

원칙:

- Tool을 많이 보여주는 방식으로 발견률을 사지 않음
- Tool을 숨겨 실제 기능을 못 쓰게 하지 않음
- 동일 기능 중복 surface 제거
- 사용 중인 Tool family만 후속 Context에 유지
- 결과 전달은 Runtime의 verified Artifact handoff 우선
- 서비스·업무명 Router 0

반대시험:

- Tool Search 때문에 모든 실행이 한 Turn 느려짐
- 숨긴 Tool을 모델이 발견하지 못함
- 직접 질문이 Tool salience 때문에 절차적으로 변함
- Tool activation 뒤 schema prefix 변화가 cache 이익을 상쇄
- 완료된 Tool이 final Context에 계속 남음

완료 문장:

> T5는 현재 목적에 가장 적합한 능력을 놓치지 않고 선택하며, 관련 없는 Tool을 생각·호출·반복 전송하지 않는다.

CJ4 actual은 `current-core-v1`과 default-off `directory-first-v1`을 gpt-5.5의 같은 세 사용자 목적으로
비교했다. directory-first는 `tool_search + exec + web_read + attachment`만 기본으로 보이고, canonical Memory·
historical recall·Undo pointer가 있을 때 exact opener를 함께 보이며 첫 실제 Tool 선택 뒤 `work_completion`을 연다.

- 직접 의견: 1 model·Tool 0 유지, 첫 schema 14/20,253B → 4/7,509B
- 연결 현실: 3 model·2 Tool 유지, 정확성 유지
- Memory exact reopen: 4 model·3 Tool 유지, 첫 schema 5/8,322B, source reopen 유지
- 세 목적 합계: tokens 73,233 → 64,059, request 392,664B → 342,559B, wall 28.4s → 25.6s
- 실제 사용자 자료·외부 쓰기·업무 Router·정규식: 0

첫 후보는 Memory pointer와 opener를 분리해 불필요한 `tool_search` 1회를 만들었으므로 PARTIAL이었다. 두 번째이자
마지막 후보는 의미가 아니라 canonical pointer 존재 사실에 exact opener를 결속해 호출 무회귀와 비용 개선을
동시에 회복했다. 설치 제품 entry에 이를 채택했다.

연결 확인에서는 사용자 결과가 정확했지만 model이 `work_completion`을 호출하지 않은 관측이 남았다. Tool 선택
조건을 더 붙이지 않고 `agentic_final_without_completion_proposal`을 CJ5로 이월한다.

근거: `refoundation/evidence/fifth-cj4-capability-tool-economy-2026-08-30.json`.

---

### CJ5 — Evidence Refinement & Final Response

Tool 결과의 canonical 보존과 model projection을 분리한다.

```text
raw Tool result
→ canonical Receipt 저장
→ purpose-relevant factual projection
→ exact reopen handle
→ model context
```

제거 후보:

- 반복 ToolReceipt
- settled 큰 output
- 사용하지 않은 검색 후보
- stale Browser snapshot
- 완료된 Tool schema
- 내부 path·ID·명령
- final answer에 필요 없는 recovery detail

유지:

- 현재 사용자 요청·최신 교정
- 목적을 바꾸는 관측 사실
- source identity·revision·coverage·freshness
- conflict·unknown·reopen 가능성
- 실행·effect·Artifact·delivery 상태
- 요청한 결과 형식

중요한 경계:

> 논리적으로 얇은 Evidence projection과 실제 provider wire context 재구성은 같은 일이 아니다.

CJ5에서 final context를 무조건 rebuild하지 않는다. continuation에 이미 들어간 과거 Tool input이 실제 품질·비용
미달을 만드는지 CJ6 provider A/B와 함께 판정한다.

완료 문장:

> T5는 실행의 모든 진실을 원장에 보존하면서 모델에게는 현재 판단과 사용자 답에 필요한 Evidence만 제공하고,
> 논리적 축소를 실제 wire 축소로 과장하지 않는다.

CJ5 actual은 canonical transcript를 바꾸지 않고 최신 ToolReceipt는 exact로, 그보다 오래된 Terminal·Browser
Receipt만 exit·effect·unknown·cursor·head/tail 사실으로 projection하는 후보를 자격했다. 두 24KB 관측에서 두
marker를 모두 답하고 model 3·Tool 2를 유지했다.

그러나 ChatGPT OAuth append continuation A/B의 실제 결과는 tokens 29,447→29,447, request bytes
162,745→162,745로 wire 이익 0이었다. projected arm의 wall은 4.98s→8.15s였으나 단일 provider 분산을 causal
회귀로 단정하지 않는다. 핵심은 이미 provider에 들어간 Tool input이 로컬 logical projection만으로 사라지지
않았다는 사실이다.

따라서 logical projection은 CJ6 비교 후보로 보존하되 설치 제품 기본값은 `full`로 유지했다. CJ4에서 관측한
completion 미호출은 사용자 결과가 정확히 전달된 read-only Work의 resumable 상태였으며, 이를 없애려고 모든
Tool Work에 추가 model turn을 강제하지 않는다. natural stop 품질은 CJ7·최종 HQ에서 다시 본다.

근거: `refoundation/evidence/fifth-cj5-evidence-final-context-2026-08-30.json`.

---

### CJ6 — Long-Horizon Continuity, Wire Context & Cache

Portable canonical context와 provider-local ephemeral context를 분리한다.

Provider별 후보를 사전에 같은 A/B 축으로 등록한다.

| 경로 | 후보 | 보존 | 비용·위험 |
|---|---|---|---|
| OpenAI API | append continuation / provider-native compaction / canonical rebuild | reasoning·cache 또는 clean context | native state와 rebuild trade-off |
| ChatGPT OAuth | append continuation / adapter-session rebuild | subscription reasoning continuity 또는 clean context | native compaction 지원 사실 별도 관측 |
| Anthropic | cached full history / summarized rebuild | cache_control 또는 portable summary | 현재 cache_control 부재부터 측정 |
| Gemini·Upstage | append 가능 범위 / canonical rebuild | provider별 실제 wire 사실 | 기능이 있다고 가정하지 않음 |
| model fallback | portable canonical rebuild | Work·교정·결정·effect·Artifact | provider-local reasoning/cache 이전 불가 |

Compaction 후보 시점:

- 기존 고정 byte threshold
- Tool-heavy phase 종료
- Work milestone 완료
- 새 목적 전환
- provider 전환 준비
- context pathology 관측

반드시 보존:

- current object·output
- latest correction
- accepted decisions
- closed·deferred·do-not-reopen
- current revision
- completed effect·Artifact·delivery
- unresolved blocker·next concrete goal
- exact source reopen handle

측정:

- 정확성·언어 품질·현재 교정
- actual wire bytes·tokens
- cache read/write·hit
- reasoning continuity
- model switch cold-start
- first useful result·total wall

어떤 provider에도 continuation·native compact·rebuild 중 하나를 근거 없이 전역 정답으로 고정하지 않는다.

완료 문장:

> T5는 긴 대화와 작업을 줄여도 사용자 결정·교정·현재 목적·실행 결과를 잃지 않으며, 같은 provider에서는
> 실제로 유리한 native 연속성을 사용하고 다른 provider로도 portable canonical context로 정확히 이어간다.

---

### CJ7 — Natural Timing & Intervention

알잘딱깔센·낄끼빠빠를 문체가 아니라 실제 행동 선택으로 자격한다.

관측 분류:

```text
ANSWER
GROUND_PUBLIC
GROUND_PERSONAL
ACT
ASK
STOP
```

이는 Runtime Intent enum·Router·durable Store가 아니다. 모델이 실제로 선택한 행동을 사후 평가하는 bounded
qualification taxonomy다.

확인할 행동:

- 직접 답할 때 행동하지 않음
- 최신성이 필요할 때만 검색
- 내부 자료가 결과를 바꿀 때만 확인
- 안전하고 명확하면 묻지 않고 진행
- 사용자 결정이 필요하면 최소 질문
- 첫 방법 실패 시 미시도 실제 대안
- 새 Evidence가 없으면 반복 중단
- 목적 달성 시 종료
- 감정·생각을 자동화·파일 변경 대상으로 만들지 않음
- 행동 전 가짜 progress 0

평가식:

```text
올바른 순간
× 올바른 깊이
× 올바른 Context
× 올바른 수단
× 올바른 범위
× 올바른 종료
```

반대시험:

- 사용자가 생각을 말했을 뿐인데 검색·자동화·파일 변경
- 이미 말한 것을 다시 질문
- 충분한 결과 뒤 추가 기능·계획 확대
- capability 부재를 모델 변경·설치 제안으로 떠넘김
- 같은 실패를 다른 문장으로 반복
- Runtime 규칙이 모델의 목적·완료 의미를 대신함

완료 문장:

> T5는 개입해야 할 때 정확히 개입하고, 생각·질문·확인·행동·대기·종료 중 현재 상황에 맞는 하나를
> 자연스럽게 선택한다.

---

## 9. Provider·Model 정책

5차는 특정 모델 전용 T5를 만들지 않는다.

```text
하나의 T5 Core
+ provider별 물리 Adapter
+ 모델별 자격 결과
```

모델·provider별로 달라도 되는 것:

- API wire·tool call·image·streaming 형식
- reasoning item·continuation
- cache·compaction
- context limit·usage 형식
- modality 지원

달라지면 안 되는 것:

- T5 제품 철학·Stable Kernel 의미
- Memory·Work·Tool·Effect·Artifact·Undo 계약
- 사용자 현재 지시 우선
- 목적 완료 기준
- 업무별 예외 코드·모델별 Prompt

현재 지원 Adapter의 conformance와 provider wire A/B를 먼저 수행한다. OpenClaw·Hermes와 모델 선택 폭을 맞추기
위해 새 provider·OpenRouter·local endpoint를 한꺼번에 추가하는 일은 CJ0~CJ7의 자동 범위가 아니다. portable
Context와 Adapter qualification이 선 뒤 오너가 별도 획득 범위를 승인한다.

HQ 운영:

- 실제 전체 인간 자격은 승인된 기본 모델 하나
- 다른 모델은 deterministic Adapter conformance와 작은 대표 qualification
- 한 모델만 판단 실패하면 Core·Prompt를 patch하지 않고 자격 범위를 정직하게 표시
- 여러 모델 공통 실패는 Core/Context 후보
- wire 변환 실패는 Adapter 후보

---

## 10. 인간 시나리오와 비교

각 Gate에서 전체 인간 wave를 반복하지 않는다. 관련 최소 반대시험과 기존 4차 evidence를 사용하고 CJ7 뒤 한 번
통합한다.

### H1 — 직접 판단

> “가격을 올리는 게 맞을까?”

- Tool 0·progress 0
- 현재 가능한 통찰
- 불필요한 계획·업무화 0
- 실제 결정에 필요한 핵심 unknown만 식별

### H2 — 최신 공개 정보

> “오늘 나온 소상공인 정책이 우리 회사에 어떤 의미야?”

- 현재 공식 source
- 필요한 Web만 사용
- 내부 파일이 무관하면 열지 않음

### H3 — 개인 맥락

> “지난번 우리가 정한 가격 정책을 기준으로 보면 어때?”

- 관련 결정만 recall
- source·현재성 확인
- 다른 프로젝트 Memory 혼입 0

### H4 — 모호한 파일

> “한빛상사 견적 사진 찾아줘.”

- 파일명 의존 0
- OCR·metadata·visual의 적절한 선택
- 정확한 이미지 Artifact
- 불필요한 Connection 0

### H5 — 업무 산출물

> “지난달 자료를 분석해서 보고서와 엑셀로 만들어줘.”

- Work·D·F·G·Artifact
- 정확성·전달·Undo
- final context의 기술 로그 최소

### H6 — 프로젝트 제작

> “상담 신청이 있는 홈페이지를 만들어 실제 화면으로 보여줘.”

- P project continuity
- build·Browser·핵심 기능
- 교정 후 같은 project
- server stop·Artifact

### H7 — 장기 대화

- 50턴 이상 여러 주제
- 교정·철회·보류
- checkpoint·Runtime restart
- 같은 provider continuation
- provider fallback
- compaction 전후 결정·Work·Artifact 일치

### H8 — 멈춰야 하는 순간

> 사용자가 감정·생각·가능성을 말했을 뿐 실행을 요청하지 않음

- 검색·자동화·파일 변경 0
- 자연스러운 대화
- 요청하지 않은 해결 프로젝트 0

비교군:

- 동일 모델 direct response
- 4차 T5
- 5차 candidate T5
- ChatGPT 사용자 경험
- 필요한 경우 Claude Cowork·Codex·OpenClaw·Hermes의 검증된 원리

자연어는 Blind 인간 비교와 목적 oracle로 판정한다. 경쟁군 화면·용어·아키텍처를 복제하지 않는다.

---

## 11. 명확한 비목표

- 고정 Intent Router·Intent enum·질문 정규식
- 사용자에게 Chat·Work·Code 모드 선택 요구
- 모든 Turn의 Work brief·purpose schema
- 새 Memory DB·RAG 플랫폼·Work Store
- 모든 Memory·Conversation 자동 주입
- 모든 Tool 기본 노출 또는 무조건 숨김
- 모델별 거대 Prompt·업무별 Prompt
- 사용자 persona 확정
- 새 Agent Team 제품
- Context Engine plugin 생태계
- 개별 Prompt 문장을 Runtime 객체·Store로 관리
- Prompt 문장 추가로 모델 품질 실수 덮기
- provider 전체 동시 재작성
- 새 provider·Connector·Capability Acquisition의 무제한 확대
- 4차 D·E·F·G·P 기능 재개발
- 4차 package·설치 자격을 5차 성공으로 주장
- macOS 성공을 Windows 물리 PASS로 주장

---

## 12. 실행·Git·증거 규율

승인 뒤 시작 순서:

```text
4차 exact baseline 확인
→ 별도 5차 branch·worktree
→ CJ0 제품 변경 0
→ CJ1
→ CJ2
→ CJ3
→ CJ4
→ CJ5
→ CJ6
→ CJ7
→ 전체 인간 비교 한 번
→ 전체 CI·clean tree
→ 5차 종료 또는 관측 종료
```

각 Gate:

```text
실제 사용자 실패
→ 실제 Context dump·wire·Receipt 확인
→ 가장 작은 candidate
→ 동일 목적 A/B
→ 채택 또는 완전 폐기
→ 작은 evidence JSON
→ clean commit
```

- 기존 변경과 packaging 작업은 사용자 소유이며 건드리지 않는다.
- `git add -A`, amend, 자동 merge 금지
- candidate 실패 코드를 제품에 남기지 않는다.
- 같은 사실의 새 총괄 문서를 반복 생성하지 않는다.
- evidence에는 원문 Prompt·개인정보·비밀·실경로를 복제하지 않는다.

---

## 13. 5차 최종 판정

### 완료 가능

```yaml
FIFTH_COMPLETION:
  context_runtime: QUALIFIED
  judgment_intelligence: QUALIFIED
  natural_agency: QUALIFIED
  fourth_capabilities: NO_REGRESSION
  provider_specific_prompt: 0
  intent_router: 0
  new_canonical_store: 0
```

### 부분 또는 관측 종료

실제 사용자 이익이 증명되지 않거나 위험이 품질 경계를 넘으면 해당 Gate를 완료로 꾸미지 않는다.

```yaml
FIFTH_COMPLETION:
  status: CLOSED_WITH_OBSERVATION
  adopted_candidates: []
  fourth_baseline: PRESERVED
  deferred_questions: RECORDED
```

### 최종 제품 판정

> 5차는 Context를 줄인 차수가 아니라 T5가 현재 사용자와 상황을 더 정확히 이해하고, 필요한 기억과 현실을
> 놓치지 않으며, 해야 할 때만 가장 적합한 수단을 사용하고, 충분하면 자연스럽게 멈추는 지능 완성 차수다.

---

## 14. 오너 승인 기록

오너는 다음 전체 규율과 CJ0~CJ7 완료 목표를 승인했다.

- [x] 5차 제품 한 문장과 최종 완료 문장
- [x] 4차 `fe51c8c5` 귀환선과 release/package 분리
- [x] CJ0~CJ7 순서
- [x] Instruction Family build-time 관리와 전역 instruction admission
- [x] Direct 최적화의 Agent positive control
- [x] Memory 선택의 추가 model call 비강제
- [x] Tool 발견률과 Tool economy의 동시 평가
- [x] Evidence projection과 provider wire rebuild 분리
- [x] provider별 continuation/native compaction/rebuild A/B
- [x] CJ7 taxonomy가 Runtime Intent enum이 아님
- [x] 같은 결함 가족 세 번째 patch 금지
- [x] 5차 전체 중단·4차 귀환 조건
- [x] 전체 인간 비교는 CJ7 뒤 한 번만 수행
- [x] Windows `DEFERRED_NOT_WAIVED`

CJ0는 제품 변경 0으로 시작한다. 각 Gate의 candidate는 동일 목적 A/B 전 product default가 아니다.
