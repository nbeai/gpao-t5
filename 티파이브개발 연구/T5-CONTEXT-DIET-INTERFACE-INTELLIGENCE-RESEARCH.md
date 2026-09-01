# T5 Context Diet & Interface Intelligence 연구·개발 계획

기록일: 2026-09-01
조사 기준: T5 NX `9e2daf0c`
상태: `RESEARCH_COMPLETE · OWNER_GATE_OPEN · CX_0_COMPLETE · CX_1_COMPLETE · CX_2_CLOSED_NO_CURRENT_DRIFT · CX_3_CURRENT · PRODUCT_CHANGE_0`

사용자 완료 문장:

> T5는 모델이 이미 잘하는 일을 긴 지시로 다시 가르치지 않는다. 현재 목적에 필요한 현실·능력·근거만 정확한 순간에
> 공급하고, 실행·권한·효과·복구는 Runtime이 맡는다. 그 결과 직접 대화는 더 빨리 시작되고 자연스러우며, 복합 작업은
> 정확성과 회복력을 잃지 않고 더 적은 Context·왕복·비용으로 완료된다.

오너 결정으로 NX2-1이 `CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT`으로 봉인돼 NX2-2가 개통됐다. 현재 slice는
제품 변경 0의 `CX-0 Prompt Surface Inventory`이며 제품 instruction과 provider wire는 아직 수정하지 않는다.

## NX-2 공통 승격 계약

NX-2 귀속: `NX2-2 — Context Diet & Interface Intelligence`

이 연구는 Prompt 길이·schema bytes·코드 줄을 줄였다는 이유로 완료하지 않는다. 제품 승격에는 다음이 모두 필요하다.

- Direct 요청의 TTFT와 자연스러운 언어 품질이 현재 T5보다 좋아지거나 최소 무회귀한다.
- Single Reality의 final wall·model/Tool round가 줄고, 불필요한 Method·capability 발견은 0이다.
- NX2-1 Multi-source·Crafted Artifact의 source truth·핵심값·Human Closure 품질이 유지된다.
- 장기 대화·Memory·현재 교정·provider reasoning continuity가 깨지지 않는다.
- instruction·Tool·Skill·Memory·Evidence마다 owner·incident·countertest가 있고 validator와 Tool schema는 SSOT다.
- 최소 두 모델에서 같은 공통 contract를 사용하며 모델별 Prompt·Tool fork를 만들지 않는다.
- 실제 Console에서 `Enter→첫 반응→첫 유용 결과→최종 답→후속 사용`을 확인한다.

후보가 Context를 줄였지만 정확성·결과 품질·교정 수용을 낮추거나 Direct를 딱딱하게 만들면 폐기한다. 상세 공통
합격식과 순서는 `T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md`가 관리한다.

---

## 1. 결론

개발 가치가 높다. 그러나 목표는 “Prompt 80% 삭제”가 아니다.

```text
나쁜 목표
→ 문장을 많이 지운다

좋은 목표
→ 모델의 다음 판단과 실제 사용자 성과에 기여하지 않는 Context를 제거하거나 제자리로 옮긴다
```

T5는 이미 다음 기반을 갖고 있다.

- instruction family manifest
- Direct·Work admission
- historical conversation projection
- ToolReceipt·Browser observation 압축
- deferred Tool·tool_search
- on-demand Skill search/view
- selected Memory recall
- provider continuity·cache/context receipt
- Resource wall·calls·tokens·bytes 계측
- strict Tool schema·runtime validator
- Integral Method·ClaimEvidence

따라서 새 Context Engine·Prompt CMS·Memory Store를 만들지 않는다. 현재 instruction·Tool·Skill·Context의 소유권을
재정렬하고, 실제 모델별 A/B에서 이익 있는 변경만 승격한다.

---

## 2. 외부 연구에서 채택할 것과 확인되지 않은 주장

### 2.1 공식적으로 확인되는 원리

Anthropic의 공식 Context Engineering 자료는 Context를 system instruction뿐 아니라 Tool·MCP·external data·history를
포함하는 유한 자원으로 보고, 매 inference에서 유용한 정보만 선별해야 한다고 설명한다.

- https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents

Anthropic의 code execution with MCP 자료는 다음을 제안한다.

- Tool 정의를 필요할 때만 발견
- Tool 결과를 code에서 filter·join한 뒤 모델에 전달
- 복잡한 Tool 왕복을 한 번의 실행으로 줄임

- https://www.anthropic.com/engineering/code-execution-with-mcp

Anthropic `prompt-audit` Skill의 핵심은 indiscriminate shortening이 아니다.

- 오래된 모델의 under-trigger·poor planning·format limitation 때문에 생긴 workaround를 찾음
- 실제 target model과 source incident에 근거해 제거
- load-bearing instruction은 보존
- audit report와 proposed diff를 분리

- https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-audit.md

### 2.2 확인되지 않았거나 과장 가능성이 있는 주장

현재 공식 자료에서 다음은 그대로 사실로 채택하지 않는다.

- Claude Code system Prompt 80% 삭제
- 삭제만으로 coding benchmark 상승
- `/doctor`가 CLAUDE.md·Skill을 자동 다이어트
- 최신 모델은 한 번 말하면 어떤 Context 위치에서도 항상 기억
- memory 자동 저장이 항상 안전

Claude Code GitHub issue에는 `/doctor`가 설치 health 중심이고 project Prompt·Skill configuration 검사는 부족하다는
반대 사실이 있다.

- https://github.com/anthropics/claude-code/issues/21466

---

## 3. 현재 T5 실제 기준선

### 3.1 전역 instruction

현재 `consoleInstructions()` 기준:

- 98 lines
- 29,362 bytes
- `interaction-core.js` v5
- `instruction-family-manifest.json`으로 family provenance 관리

현재 family 종류:

```text
product_invariant
cross_tool_policy
tool_guidance
measured_failure_guard
interaction_style
candidate
```

전역 instruction에는 다음 실제 사고 방지가 섞여 있다.

- 파일 부재 오판·얕은 검색
- source manifest·Artifact handoff
- OCR·시각 후보
- Web search/read/research provenance
- Browser login·tab·modal·effect·user handoff
- Automation·Telegram·new input settlement
- document·program·project result verification
- user-facing language·privacy·scope

이 문장들을 짧다는 이유로 제거하지 않는다.

### 3.2 현재 progressive disclosure

- minimum Tool surface
- deferred tools
- `tool_search`
- Skill catalog search→view
- capability reality
- Memory candidate selection→exact reopen
- historical output handles
- current Browser observation preservation

따라서 progressive disclosure를 새로 개발하지 않고 실제 누출·중복·late loading만 보강한다.

### 3.3 현재 측정 기반

- Context Receipt
- Transmission Receipt
- Information Context report
- Resource Situation
- Run speed receipt
- model/Tool timeline
- cache/cached token
- repeated Evidence

새 telemetry Store를 만들지 않는다. 현재 원장에서 audit report를 재계산한다.

### 3.4 현재 실제 미달 후보

1. 전역 instruction 98줄 중 일부 Tool guidance는 이미 strict schema·runtime invariant와 중복될 수 있다.
2. 같은 의미가 system instruction·Tool description·Skill에 중복될 가능성이 있다.
3. 특정 과거 provider 결함 workaround가 모든 모델에 상주할 수 있다.
4. final answer model이 실행용 전체 Context를 다시 받아 범위·핵심을 잃는 경우가 있다.
5. rich reference·test·Artifact가 있는데도 산문 instruction으로 재설명하는 부분이 있다.
6. 모델별 instruction 필요 차이가 있으나 provider별 장문 Prompt fork는 없다.

이는 변경 확정이 아니라 CX-0에서 측정할 후보 목록이다.

---

## 4. 중심 원리 — Context 소유권

각 정보는 한 정본 위치에만 있어야 한다.

| 정보 | 소유 위치 | model Context 투영 |
|---|---|---|
| 제품 정체·최상위 상호작용 | 작은 Interaction Core | 모든 Turn 최소 |
| 권한·effect·secret·retry invariant | Runtime code·countertest | 필요한 current fact만 |
| Tool input·enum·상태 전이 | Tool schema·validator SSOT | Tool이 보일 때만 |
| Tool별 복잡 절차 | on-demand Skill | search/view 뒤만 |
| 현재 시간·profile·Work·process | runtimeContext | current delta만 |
| 과거 대화·결정 | Conversation pointer·session recall | 관련 목적에서만 |
| 사용자 사실·선호 | Memory exact source | selected candidate reopen 뒤만 |
| 실행 증거 | Receipt·Artifact·ClaimEvidence | 다음 판단에 필요한 compact fact |
| 디자인·기능 요구 | Artifact contract·test·reference | 산출물 Work에서만 |
| 모델별 능력·한계 | provider capability manifest | adapter가 필요한 최소 차이만 |

같은 문장을 “중요하니까” 여러 층에 복제하지 않는다.

---

## 5. Instruction Family Audit Contract

현재 manifest를 확장해 각 family가 다음을 갖게 한다.

```yaml
id:
kind:
ownerSource:
currentTextDigest:
incidentRefs:
countertests:
currentEnforcement:
targetEnforcement:
modelsQualified:
appliesTo:
measuredBenefit:
removalCondition:
replacementOwner:
lastReviewedAt:
```

분류:

### A. Product invariant

모든 모델에서 필요한 최소 원칙. Interaction Core에 남을 수 있다.

### B. Runtime-enforced duplicate

현재 code·schema·receipt가 이미 막는다. model이 알아야 행동 선택이 달라지는 current fact만 남기고 장문 규칙은 제거
후보.

### C. Tool-local guidance

해당 Tool이 보일 때만 필요한 내용. Tool description 또는 Skill로 이동.

### D. Dated model workaround

과거 모델 결함 때문에 추가됐고 최신 qualified model에서 불필요할 수 있다. AB/BA 후 제거 후보.

### E. Actual incident guard

현재 모델에서도 counterexample을 막는 실측 문장. 대체 invariant가 없으면 유지.

### F. Interaction taste

말투·길이·사용자 경험. Interaction Core에서 최소화하되 인간 HQ로 판정.

문장 수나 bytes만으로 family를 분류하지 않는다.

---

## 6. Tool Contract SSOT

NX-1에서 validator와 Tool schema를 따로 작성해 field·enum drift가 발생했다. 이 사건을 전체 Tool 계약으로 일반화한다.

```text
typed contract constants
├─ JSON schema
├─ runtime validator
├─ model-safe description fragments
├─ test generators
└─ receipt projection
```

적용 조건:

- schema/validator drift 실제 발견
- enum·required field·effect가 중복 정의
- model error가 Prompt 부족이 아니라 interface ambiguity

모든 Tool을 한 번에 재작성하지 않는다. 실제 incident 순서로 이동한다.

Tool description은 다음만 포함한다.

- 이 Tool이 주는 현실
- 언제 필요한가
- 다른 유사 Tool과 경계
- effect·unknown·stop 의미
- schema로 표현할 수 없는 load-bearing 함정

예제 목록·업무별 문장·전역 설명 반복은 제거 후보다.

---

## 7. Progressive Context Architecture

### 7.1 Level 0 — 항상 보이는 최소 Context

- T5 identity
- current user message
- current correction priority
- 최소 Interaction Core
- 현재 visible Tool metadata
- current time/product identity가 실제로 필요할 때의 fact

### 7.2 Level 1 — 발견

- `tool_search`
- Skill search
- Capability Reality
- Memory candidates
- Session/History pointer

본문·전체 schema·과거 원문은 아직 투영하지 않는다.

### 7.3 Level 2 — exact reopen

- 선택한 Tool schema
- 선택한 Skill body
- exact Memory source
- exact Conversation segment
- exact File/Artifact observation

### 7.4 Level 3 — bounded execution

- Integral Method
- code execution
- filter·join·aggregate
- compact ClaimEvidence

### 7.5 Level 4 — Human Closure epoch

실행용 전체 source·제외 내용·Tool args를 final answer model에 다시 주지 않는다.

```text
user purpose·current correction
+ verified core claims
+ important unknown
+ selected presentation facts
+ requested output form
→ model-authored final answer
```

과거 Context는 Receipt에 보존하되 final epoch에 자동 상속하지 않는다. third model turn을 만들지 않는다.

---

## 8. Rich Reference 우선

산문으로 뭉개지 않고 실제 매체를 사용한다.

| 목적 | 우선 source |
|---|---|
| 기능 완료 | executable test·state oracle |
| UI·디자인 | actual HTML·CSS·screenshot·DESIGN.md·render |
| 문서 품질 | actual PDF/DOCX/XLSX·purpose contract·render |
| API·Tool | strict schema·fixture·official docs |
| 프로그램 | code·test·sample input/output |
| 사용자 취향 | explicit approved artifact·correction history |

Rich source는 자동으로 좋은 Context가 아니다. exact purpose에 관련된 부분만 reopen하고 untrusted data로 frame한다.

---

## 9. Memory·Experience 경계

영상의 “자동 Memory”를 그대로 채택하지 않는다.

- 현재 사용자 correction이 항상 우선.
- 모델이 유용하다고 느낀 사실만으로 Memory 확정 금지.
- 사실·선호·결정·Episode·Skill·Method를 분리.
- Experience는 actual outcome·source·performance·counterexample과 결속.
- 한 번 성공한 방법은 candidate이며 independent field qualification 전에는 active Skill이 아님.
- 오래된 Memory·Method는 current difference에서 archive·rollback.

개선 목표는 수동 저장 제거가 아니라, 필요한 후보를 자동 제안하고 검증 비용을 줄이는 것이다.

---

## 10. 모델·provider 정책

T5는 한 최신 모델 전용 제품이 아니다.

### 공통 최소 Core

모든 qualified provider에서 필요한 제품 identity·current correction·truth·tool use 원칙.

### Capability-aware Context

- structured outputs 신뢰도
- parallel Tool support
- native continuity/cache
- image input
- tool choice enforcement
- context limit
- known actual incidents

adapter가 capability fact를 제공하되 provider 이름별 장문 Prompt를 만들지 않는다.

### 자격 matrix

- gpt-5.5 qualified default
- Terra comparison/holdout
- Anthropic Messages
- Gemini
- Upstage

모든 모델의 결과 문체를 같게 만들지 않는다. 제품 불변식·Tool 계약·Reality truth만 공통이다.

---

## 11. 실제 Baseline Mission

### Direct

1. `안녕.`
2. 긴 글 요약
3. 경영 의견·아이디에이션

기준: model 1·Tool 0·Work 0, first delta·완료·자연스러움.

### Single Hand

1. 서울 오늘 날씨
2. 정확한 URL 읽기
3. 이름이 분명한 파일 하나 찾기

기준: 필요한 Hand 1회 중심, 불필요한 Tool discovery·Work·검증 0.

### Multi-source

1. NX 정산 구매·계약·비용
2. 최신 외부 보고서
3. OCR 이미지 찾기

기준: source·coverage·strict scope·wall·rounds·tokens.

### Browser·External

1. login handoff
2. local project Browser QA
3. Telegram/Automation result delivery

기준: current state·effect·Stop·unknown·duplicate 0.

### Crafted Artifact

1. XLSX
2. PDF/DOCX
3. PPTX·HTML/dashboard

기준: factual·functional·visual·human quality.

---

## 12. 개발 Gate

### CX-0 — Prompt Surface Inventory

제품 변경 0.

- system instructions
- Interaction Core
- Tool descriptions/schema
- Skill metadata/body
- Memory/Conversation projections
- runtimeContext
- provider wire
- final epoch

각 surface의 bytes·중복 n-gram·owner·incident·probe·model을 기계 보고서로 만든다.

2026-09-01 actual inventory에서 global 98줄·29,742 bytes, family 12개 exact coverage, Direct Tool 7개·provider
10,826 bytes, Skill metadata 1,839 bytes·on-demand body 15,579 bytes, empty runtimeContext 485 bytes를 확인했다.
삭제는 0이며 다음은 family별 provenance field와 enforcement 위치를 분류하는 CX-1이다.

근거: `refoundation/evidence/nx2-cx0-context-surface-inventory-2026-09-01.json`.

### CX-1 — Family Provenance Audit

- 98줄 전부 family와 exact digest 결속
- source incident 없는 문장은 candidate
- Runtime duplicate·Tool-local·dated workaround 분류
- audit report와 proposed diff만 생성
- 제품 적용 0

2026-09-01 actual audit에서 12개 family를 `KEEP 5·MOVE 2·REVISE 4·REMOVE_CANDIDATE 0·UNKNOWN 1`로 분류했다.
stale countertest 이름 5개는 실제 보호 assertion이 있는 현재 test로 proposed mapping만 만들었고 manifest·instruction은
수정하지 않았다.

근거: `refoundation/evidence/nx2-cx1-instruction-family-provenance-audit-2026-09-01.json`.

### CX-2 — Tool Contract SSOT Pilot

NX actual에서 drift가 재현된 Tool 한 가족만 선택한다.

- constants→schema/validator/description/test
- Prompt workaround 삭제
- model call-shape·error rate A/B

2026-09-01 current audit에서는 historical drift가 모두 이미 SSOT·strict countertest로 닫혀 있었고, Attachment·File Reality
action contract도 현재 Runtime branch와 일치했다. provider-visible current drift를 발명하지 않아 pilot 없이 제품 변경 0으로
종료했다.

근거: `refoundation/evidence/nx2-cx2-tool-contract-ssot-admission-2026-09-01.json`.

### CX-3 — Instruction Ownership Migration

한 family씩 이동한다.

```text
global → Runtime
global → Tool description
global → on-demand Skill
duplicate → one owner
dated workaround → qualification removal
```

각 이동마다 Direct holdout과 실제 incident countertest를 함께 실행한다.

### CX-4 — Progressive Disclosure Refinement

- Tool metadata 최소화
- Skill search/view
- exact Memory reopen
- Context delta
- final Human Closure epoch

현재 기능을 다시 만들지 않고 leakage·late discovery만 수리한다.

### CX-5 — Multi-model Qualification

같은 Mission·source·authority로 model matrix AB/BA.

- 공통 Core
- capability-aware differences
- provider cache/continuity
- Tool selection·recovery

### CX-6 — Product Integration

qualification에서 이긴 family만 적용한다. global Prompt bytes 감소는 결과이지 목표가 아니다.

### CX-HQ — Human Context Qualification

실제 Console에서 입력→first response→Tool/Progress→final answer·Artifact·correction·Stop까지 확인한다.

---

## 13. 파일별 계획

### 새 파일 후보

| 파일 | 책임 |
|---|---|
| `refoundation/src/context-surface-audit.js` | 현재 원장에서 Context surface·bytes·owner 재계산 |
| `refoundation/src/instruction-family-audit.js` | manifest provenance·incident·probe·replacement 분류 |
| `refoundation/src/tool-contract-definition.js` | 선택 Tool family의 schema/validator SSOT 공통 primitive |
| `refoundation/scripts/run-context-diet-qualification.mjs` | model·Mission AB/BA runner |
| `refoundation/config/context-diet-missions.json` | fixed Mission·oracle·holdout |

### 기존 파일 변경 후보

| 파일 | 허용 변경 |
|---|---|
| `console-model-factory.js` | qualification에서 제거/이동이 이긴 exact family만 |
| `interaction-core.js` | 공통 최소 Core actual 우위가 있을 때만 새 version |
| `instruction-family-manifest.json` | provenance·model·measured benefit·replacement owner |
| `agent-loop.js` | 새 Context Engine 금지; current projection seam만 필요한 경우 |
| `information-context.js` | audit measurement·exact delta |
| `conversation-projection.js` | 실제 반복/lost evidence가 재현된 경우만 |
| `tool-search.js` | discovery 실패/overexposure actual이 있을 때만 |
| `skill-runtime.js` | progressive loading 계약 무회귀 |
| provider adapters | capability manifest·cache/context truth, Prompt fork 금지 |

---

## 14. A/B 규율

모든 변경은 현재 제품 A와 후보 B를 비교한다.

```text
AB / BA
same source
same model
same authority
same fixture
same output oracle
```

측정:

- instruction bytes
- active Tool schema bytes
- historical/memory/runtime/evidence bytes
- provider request bytes
- input/output/cached tokens
- first visible·first useful·final wall
- model·Tool rounds
- Tool selection accuracy
- required question count
- source·Effect·Artifact truth
- correction·Stop·Undo
- 인간 자연스러움·경직성·다시 맡길 의향

provider noise가 큰 wall은 paired median과 order를 함께 본다.

---

## 15. 합격식

```text
제품 불변식·source·Effect·Recovery 무회귀
AND Direct Tool/Work 0 유지
AND first visible 또는 final wall 실질 개선
AND provider bytes·tokens 감소 또는 명확한 품질 이익
AND Tool selection·fallback·완료 정확성 무회귀
AND Ordinary 표현 목적 성공 무회귀
AND 답변 획일화·과잉 계획 감소
AND current correction·Stop·Undo PASS
AND 두 모델 이상 구조 호환
AND 실제 인간 Console 선호 우위
```

임의 80% 삭제율·파일 길이·문장 수는 합격 기준이 아니다.

---

## 16. 중단·폐기 기준

- target model 근거 없이 “최신 모델은 알아서 한다”며 지운다.
- actual incident·countertest가 있는 문장을 대체 enforcement 없이 제거한다.
- global Prompt를 줄이고 Tool description에 같은 문장을 그대로 복제한다.
- provider별 거대 Prompt fork를 만든다.
- Direct를 빠르게 하려고 recovery Hand·exact Evidence를 제거한다.
- Tool schema에서 표현 가능한 enum·required를 산문 예시로 유지한다.
- Memory 자동 저장을 source 검증 없이 연다.
- final epoch가 verified claim 대신 전체 source packet을 다시 받는다.
- 한 모델의 한 표본만 보고 공통 Core를 변경한다.
- bytes는 줄었지만 wall·정확성·인간 체감이 개선되지 않는다.
- 같은 regression에 세 번째 문구 patch가 필요하다.

---

## 17. 커밋 순서

1. `Inventory every T5 context surface`
2. `Bind instruction families to incidents and probes`
3. `Derive one Tool contract from a single source`
4. `Move Tool-local guidance out of the global core`
5. `Project only current evidence into Human Closure`
6. `Qualify the smaller context across models`
7. `Close the T5 context diet in the actual Console`

한 커밋에 여러 instruction family를 동시에 옮기지 않는다.

---

## 18. 첫 작업

제품 코드를 수정하지 않는다.

```text
consoleInstructions 98줄
→ line/family/digest
→ 동일/유사 문장 위치
→ 현재 Runtime·Tool·Skill enforcement
→ source incident·countertest
→ model별 actual 필요성
→ KEEP / MOVE / REVISE / REMOVE_CANDIDATE
```

첫 산출물은 삭제 diff가 아니라 audit report다. `REMOVE_CANDIDATE`는 A/B를 통과하기 전 삭제하지 않는다.

---

## 19. 최종 완료 문장

> T5의 Context는 지침 창고가 아니라 현재 목적의 판단 환경이다. 제품 불변식은 Runtime과 테스트가 지키고, Tool은
> strict interface로 말하며, 복잡한 절차와 기억은 필요할 때만 열린다. 여러 모델은 같은 T5의 현실·권한·복구 계약을
> 유지하면서 각자의 지능을 최대한 발휘하고, 사용자는 더 빠른 첫 반응과 더 자연스럽고 정확한 결과를 경험한다.
