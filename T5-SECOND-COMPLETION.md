# T5 Second Completion — Current Development Source

상태: `SECOND_COMPLETION_ACTIVE`
현재 Gate: `S2-A1 RESOURCE CONTROL — READY`
기준 source: `81f29d23`
배포 상태: `0.1.8 REVOKED · 새 package 생성 금지`

이 문서는 T5 2차 완성의 유일한 현재 작업 계획이다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은
`AGENTS.md`, 1차 완성의 역사·실패 원본·과거 Gate는 `T5-REFOUNDATION.md`가 담당한다.

## 1. 기준선과 목적

오너 결정에 따라 현재 T5를 1차 완성으로 규정한다. 다음 코어와 Hand를 재창립하거나 대체하지 않는다.

- 모델이 목적·계획·도구 선택·복구·사용자 문장을 판단하는 작은 `AgentLoop`
- `ConversationLedger·RunLedger·MemoryLedger·AuthorityStore·AutomationStore`
- 요청·허용·실행·효과·전달·목적 완료를 분리하는 Receipt 계약
- Terminal의 command·cwd·process·stdout·stderr·exit 현실
- Document의 file identity·hash·structure·coverage·render·reopen 현실
- 공개 Web, Connection, Remote MCP, Telegram, Attachment, Artifact, Skill, Capability lifecycle
- 현재 콘솔 대화·진행·결과물·보관·복원 UX
- 제품 진입점에서 은퇴한 전용 Browser

2차 완성은 기능 확장이 아니라 현재 코어의 원리가 복합·장기 사용자 목적에서도 예외 없이 작동하도록
연결·고도화하는 `Core Completion & Hardening`이다.

전용 Browser 퇴출의 원인은 전용 프로필 자체가 아니다. 기존 T5가 대형 UI 관측을 일반 Web의 기본 읽기
수단으로 사용하고, 접근성 트리·요소 ref·탭·URL·입력 영역을 담은 같은 관측을 이후 model call마다 다시
넣으며, 실패 때 `관측→행동→재관측`을 반복하고 새 Run에서도 긴 Conversation·ToolReceipt를 재투입한 구조가
원인이다. 공개 정보는 Search·Fetch 계열 Hand로 끝내고, UI 행동은 사용자가 exact UI 조작을 맡겼으며 표준
API·Connector·CLI 대안이 없을 때만 별도 자격화한다.

1천만 token 사건의 자원 판정은 직접 귀속과 동반 흐름을 합치지 않는다.

| 측정 | 실제값 | 의미 |
|---|---:|---|
| 전체 사용량 | 10,146,162 tokens | 19개 대상 Run·107 model calls |
| Browser 결과 직접 입력 | 약 2,140,275 tokens · 21.1% | Browser 결과 bytes에 직접 귀속 |
| 최초 Browser 관측 | 약 212,607 tokens | 처음 모델에 공급된 관측 |
| 이후 반복 재주입 | 약 1,844,162 tokens | Browser 직접 부담의 약 90.0% |
| Browser를 호출한 Run 전체 | 5,853,678 tokens · 57.7% | Browser와 함께 발생한 흐름, 직접 비용 아님 |
| Browser 기록이 입력에 있던 call 전체 | 9,591,048 tokens · 94.5% | Browser 기록과 동반된 흐름, 직접 비용 아님 |

Browser 결과를 제외해도 약 800만 tokens가 남는다. 다른 도구 결과·긴 대화·실패 복구·Run 분할의 반복도
같은 Information Control 결함이다. 동일 과업 A/B 없이 Browser의 인과적 추가 비용을 위 표의 동반 흐름
전체로 승격하지 않고 `unknown`으로 남긴다.

대화창은 사용자와 T5가 함께 공유하는 유일한 제품 세계다. 사용자가 말한 것, T5가 이해한 것, 실제로 한 일,
현재 상태와 결과가 이 세계에서 끊기지 않아야 한다. Terminal이 현실에서 무엇인가를 할 수 있게 하는 가장
기초적인 Hand라면, 그다음 기반은 Conversation·Situation·Work·Evidence·Memory·Capability를 현재 목적에
맞게 모델에 공급하는 `Information Control`이다.

### 사용자 완료 문장

> 사용자가 평소 말로 목적을 말하면 T5는 현재 상황·기억·능력·권한·자원을 정확히 구성해 모델의 능력을
> 최대한 사용한다. 적은 왕복과 작은 문맥으로 적절한 손을 선택하고 실패하면 다른 실제 방법을 찾는다.
> 여러 대화·시간·자동화를 건너도 목적을 잃지 않으며, 실행·효과·전달·결과를 다시 확인한 뒤에만 완료한다.

### 최상위 합격식

```text
부드럽고 유연한 사용자 경험
AND 비교군 대비 가벼움·속도
AND 목적당 경제성·정확성·완전성
AND 첫 실패를 전체 불가능으로 승격하지 않는 복구력
```

정직한 중단은 사용자 문장 진실성이지 목적 달성이나 개발 완료가 아니다.

## 2. 개발 원리

```text
상태 밀도: 같은 사실의 정본은 하나
관측 밀도: identity·structure·coverage·handle로 현실 공급
도구 밀도: 전용 로봇팔보다 표준 생태계를 다루는 범용 Hand
왕복 밀도: 한 model·tool batch가 목적에 만드는 실제 진전
증거 밀도: 호출 수가 아니라 완료 claim을 증명하는 Receipt
```

모델은 목적 해석·계획·검색어·방법 선택·실패 해석·대체 경로·완료 의미를 담당한다. 런타임은 identity·
revision·자원 회계·권한·실행 전후 관측·effect·delivery·중복 방지·취소·복구만 강제한다. Intent router,
vendor 정규식, 고정 workflow, 사이트 selector를 Core 판단으로 만들지 않는다.

## 3. 전체 순환과 정본

```text
사용자 목적·교정
→ Conversation admission
→ Work 목적·revision
→ Situation·Memory·Capability·Evidence projection
→ 주 모델 판단
→ Hand 실행
→ Run·Effect·Delivery Receipt
→ Settlement
→ 미달이면 다른 방법, 달성이면 모델의 사용자 답
→ Episode pointer와 검증된 Skill·Capability 개선
```

### 유지하는 정본

- Conversation: 대화 사건. 실제 모델 입력은 ContextReceipt가 증명
- Run: 한 실행 시도의 model·tool·effect·surface 사건
- Memory: 사용자가 말한 사실·선호·결정
- Automation: schedule·timezone·recurrence·dispatch
- Authority: 제안·위임·승인·소비
- Capability lifecycle: 준비·검증·적용·복원

### 허용하는 새 정본 두 개

1. `ResourceLedger`: 여러 Run·내부 호출의 시간·문맥·토큰·도구·비용·진전을 원자적으로 관측·정산
2. `WorkStore`: 여러 Conversation·Run·Automation occurrence를 하나의 지속 목적·revision에 결속

둘 다 append-only event store다. Situation·Context·UI·Episode·자기 상태는 파생 projection이다.

## 4. 비교군에서 흡수할 구조

| 검증 원리 | 참고 | T5 적용 | 가져오지 않음 |
|---|---|---|---|
| 호출 전 context precheck·큰 tool result guard | OpenClaw `5527dfea` | AgentLoop·projection | 전용 Browser·장시간 timeout |
| queue·steer·followup·interrupt | OpenClaw | durable input | 내부 용어 노출 |
| execution/delivery·cron claim | OpenClaw | Automation | agent 종료를 목적 완료로 승격 |
| tool pruning·summary input bound | Hermes `0c713049` | checkpoint·projection | 대형 Python compressor 포팅 |
| anti-thrash·outer error control·wall wrap-up | Hermes | Resource Control | 무제한 turn·독립 child 자원 |
| max calls·cancel·compaction | Responses | adapter·AgentLoop | 목적 전체 제어를 provider에 위임 |
| bounded turn·권한 도구면·resume | Claude Code | Run·Capability | 코딩 제품 범위 복제 |

비교군 코드를 섞지 않고 검증된 동작·알고리즘·반대시험을 현재 작은 JavaScript 코어에 재구현한다.

## 5. Gate

### S2-A0 — Incident & Reference Fixtures — COMPLETE

제품 동작 변경 없이 다음 실패를 비식별·결정적 replay로 고정한다.

```text
19 Runs · 107 model calls · 10,146,162 tokens
Browser direct input 약 21% · Browser 결과 반복 입력 약 90%
automation false success · message admission loss · process residual
```

replay는 전체 token, Browser 직접 입력, 최초 관측, 반복 재주입, Browser 호출 Run 전체, Browser 기록 포함
model call 전체, non-Browser context·tool 반복, 새 Evidence 없는 자원 증가를 분리한다. 직접 귀속량과 같은
scope에서 함께 발생한 사용량을 합치지 않으며 인과 비용은 동일 과업 A/B가 없으면 `unknown`이다.

비밀값·메일 본문·개인정보는 제거하고 상태·크기·digest·관계만 보존한다. 19개 대상 Run과 역사 문서의
20개 전체 Run 범위 차이는 fixture manifest에서 포함·제외 identity와 이유로 해소한다.

완료 증거: `refoundation/evidence/s2-a0-incident-reference-fixtures-2026-08-24.json`

### S2-A1 — Resource Control — CURRENT

#### 사용자 완료 문장

> T5는 모든 내부 호출의 자원과 진전을 실시간 관측·예측한다. 주 모델은 이 현실을 보고 방법·깊이·병렬성·
> 정산 시점을 선택하며, 런타임은 물리적 한계·사용자 비용 경계·증거 없는 병적 반복만 교정한다.

#### 구현

```text
ResourceLedger
ResourceController
RunLedger·AgentLoop·model adapters 연결
```

Resource event:

```text
ScopeCreated · ResourceObserved · RequestForecasted · ResourceReserved
ReservationCommitted · ReservationReleased · UsageMarkedUnknown
ControlActionRecorded · AnomalyRecorded · ScopeClosed
```

자원 귀속은 다음 세 값을 분리한다.

```text
direct attribution: exact request·result·usage에 직접 귀속
co-occurring scope usage: 같은 Work·Run·call 흐름에서 함께 발생
causal estimate: 동일 과업 A/B로 증명한 증분, 없으면 unknown
```

Browser가 포함된 Run이나 model call의 전체 사용량을 Browser 직접 비용으로 기록하지 않는다. checkpoint·
memory flush·visual observation·adapter retry·tool 내부 호출도 각 scope에서 관측하고 상위 scope에는 중복 없이
정산한다.

#### A1-0 — Accounting Reference Seal — COMPLETE

A1-1 전에 OpenClaw `cc2993c7`, Hermes `91e86763`, 설치된 Codex app-server protocol과 OpenAI·Claude 공식
usage 계약을 좁게 확인했다. 기능을 복제하지 않고 다음 원리만 채택한다.

- `Session → Run → logical call → execution attempt` identity를 분리하고 retry도 실제 provider 요청마다 별도
  attempt로 기록한 뒤 상위 scope에는 한 번만 rollup
- provider fetch 전에 reservation identity를 지속하고, 응답·실패·cancel·crash는 같은 identity의 commit·
  release·unknown 중 하나로 정산
- 병렬 stream/message가 같은 provider response identity와 usage를 반복하면 한 번만 commit
- context의 현재 크기, 호출별 provider usage, Run 누적 usage, child·auxiliary usage를 같은 숫자로 합치지 않음
- checkpoint·compaction·memory flush·visual observation·provider retry·tool 내부 model call·child call은 각자
  child scope를 가지며 parent에는 명시적 관계로 한 번만 귀속
- provider usage가 없거나 crash 복구로 완전한 합계가 없으면 0이 아니라 unknown; 로컬 cost 계산은 estimate
- 회계 event는 content-free bounded numeric·category·identity만 저장하고 prompt·tool args/result·오류 원문을
  복제하지 않으며, 모델 Context와 사용자 답에는 기본 주입하지 않음
- 전경 hot path는 전체 원장 scan 없이 O(1) append·in-memory counter만 사용하고, rollup·disk maintenance는
  파생 비동기 작업으로 분리; 계측 실패가 사용자 답을 바꾸거나 내부 문장을 노출하지 않음

다음은 채택하지 않는다.

- 낮은 고정 turn·tool·token·child 상한과 동일 tool 이름만으로 만드는 anti-thrash를 회계 계약으로 사용
- 누락된 retry·child·crash usage를 0으로 기록하거나 parent total에 추정으로 섞음
- provider별 alias를 그대로 canonical schema로 확산하거나 estimated cost를 청구·권한 진실로 사용
- accounting footer·내부 scope·attempt를 모델 prompt나 기본 사용자 답에 추가
- auxiliary accounting을 best-effort로 조용히 버리거나, 이미 main loop에 든 child usage를 다시 합산
- 매 호출마다 transcript·Run 전체를 다시 읽거나 원문 payload를 회계 원장에 중복 저장

근거: `refoundation/evidence/s2-a1-accounting-reference-seal-2026-08-24.json`

제어 루프:

```text
Observe context·tokens·wall·calls·failures·cost·새 Evidence
→ Forecast 다음 호출의 자원·물리 한계
→ Optimize batch·parallel·projection·reuse·방법·effort 후보
→ 주 모델이 계속·전환·깊이·정산 선택
→ Execute·Commit
→ 병적 route만 교정하고 다른 길은 유지
```

고정된 낮은 기본 상한을 두지 않는다. 강제 개입은 물리적 한계, 사용자가 정한 돈·시간 경계, deterministic
반복, effect-unknown 재실행, 자식 실행 폭주, 새 Evidence 없이 자원만 증가하는 검증된 runaway에 한정한다.
catastrophic fuse는 shadow 실측과 positive control 없이 수치를 고정하지 않는다.

승격 순서:

```text
A1-1 exact accounting shadow
→ A1-2 anomaly shadow
→ A1-3 모델에 Resource Situation 공급
→ A1-4 능동 최적화
→ A1-5 검증된 병적 폭주에만 최후 개입
```

통과 조건:

- provider fetch 전 forecast·reservation 100%
- checkpoint·memory·authority·automation usage 누락 0
- 병렬 reservation·crash·중복 commit 정확
- 새 Run·Session의 resource history 초기화 0
- 정상 과업 false intervention·premature stop 0
- 1천만 token replay의 반복·무진전·자원 증가를 폭주 전에 감지·교정
- Terminal·Document·Web 사용자 결과 변화 0

비목표:

```text
WorkStore · Instruction Compiler · Queue · Automation 의미 변경
Memory·Capability 변경 · Browser·UI · Multi-agent · 새 Connector
```

### S2-A2 — Information Control

Conversation 전체나 Memory 전체를 넣지 않고 모델 호출 직전에 다음을 조립한다.

```text
Stable Constitution
→ 현재 사용자 발화·교정
→ 현재 Run과 조건부 Situation
→ 관련 Evidence·미확인 effect
→ 출처 있는 Memory 후보
→ 현재 ready Capability와 활성 Tool Definition
```

Conversation은 공동 세계의 canonical 사건, ContextReceipt는 모델이 실제로 본 입력, Context Compiler는 둘
사이의 파생 제어면이다. A2 첫 단계는 현재 발화·Run을 사용하고, B가 선 뒤 Work 목적·revision을 같은 입력
계약에 추가한다.

Information Control 구현:

- stable constitution과 prompt cache 보존
- 비활성 Hand 지침·중복 tool 설명·반복 tool 원문 제거
- canonical Receipt 전량 보존, 큰 결과는 identity·coverage·head/tail·exact recall handle로 투영
- Browser를 포함한 UI 관측은 비밀값을 제외한 exact 실행 증거를 원장에 보존하되, 모델에는 현재 목적에 필요한
  최신 bounded 관측만 한 번 공급하고 이미 공급한 동일 관측의 후속 model call 재주입은 0
- UI 행동 뒤에는 변경된 화면·network·effect를 새 identity로 재관측하고, 과거 snapshot·ref·tab을 현재
  조작 상태로 재사용하지 않음
- Memory 후보는 exact 대상 identity·source·scope·최신 revision·사용자 교정을 기준으로 결정론적 검색
- 후보를 현재 목적에 사용할지와 충돌의 의미는 주 모델이 판단
- 과거 assistant 문장으로 현재 시간·로그인·연결·process를 추론하지 않고 Situation에서 관측

W9 blind truncation·별도 extraction model·shared cache·branch research·vector-only Memory 선택은 열지 않는다.

통과:

- authority·effect·coverage·사용자 교정 손실 0, recall digest 일치
- 현재 목적 유지·잘못된 과거 사실 주입·불필요 Memory·반복 tool output을 각각 계측
- 동일 UI 관측의 반복 재주입 0, canonical 관측 손실 0, stale UI ref 재사용 0
- 비활성 Hand guidance 0, 모델 왕복 증가 0
- current fact·폐쇄집합·Terminal·Document·Web positive control 무회귀
- uncached input·wall time 감소, Terra·gpt-5.5 반복

### S2-B — Work & Conversation Continuity

append-only WorkStore, Work revision 출처, 최소 Situation, durable input·steer·followup·new_work·cancel,
failure 종류, Completion Proposal·Settlement를 연결한다.

```text
deterministic: 같은 route+args 재실행 0
transient+retrySafe: 동일 재실행 최대 1회
effect unknown: 재실행 0, 현실 재관측만 허용
```

통과: 교정·입력 유실 0, restart 복원, premature stop 0, 거짓 성공 0, 모델 userAnswer 재작성 0.

### S2-C — Memory Portfolio

새 만능 Memory 저장소를 만들지 않고 기존 정본의 역할과 모델 주입 경계를 완성한다.

```text
User Memory: 사용자가 말한 사실·선호·결정
Working Memory: 현재 Work의 결정·미확인·재개 지점 projection
Episode: Conversation·Run·Receipt를 가리키는 과거 경험 색인
Skill: 실제 과업에서 검증된 방법
Capability Memory: 현재 사용 가능성·요건·과거 성능
Situation: 매번 관측하는 휘발성 현실, Memory 아님
```

모든 Memory 후보는 source message·scope·recordedAt·revision·conflict를 보존한다. 사용자 교정이 과거 기억보다
우선하며, Memory 부재를 과거 사건 부재로 사용하지 않는다. 전체 Memory 주입·고정 Persona·출처 없는 추론
지속·새 의미 선택 모델은 금지한다.

통과: 사용자 교정 반영 100%, 잘못된 현재 상황 승격 0, Episode 원문 중복 0, 관련 후보 recall 유지,
불필요 Memory token 감소, restart·모델 전환 뒤 같은 Work 재개.

### S2-D — Time Continuity

Automation occurrence를 workId·resource scope에 결속하고 execution·objective·delivery를 분리한다. 실행 시점
Situation·Capability·authority를 다시 확인하고 claim heartbeat·stale worker 폐기·crash fencing을 적용한다.

통과: recursive automation·모델 종료 성공·delivery 실패 성공·unknown effect retry 0, fault injection,
Telegram loopback, Terra·gpt-5.5 동일 여정.

### S2-E — Learning

검증된 Work Settlement와 Episode pointer에서만 방법 후보를 만든다.

```text
반복 Work → 성공·교정 Evidence → 방법 후보 → 격리 replay
→ baseline A/B → 실제 반복 과업 → Skill·Capability 승격 → 회귀 rollback
```

모델 주장만으로 Episode 성공, 실패 방법 승격, 사용자 교정 누락, Core 자동 수정은 0이다. 학습은 설명·교정·
시간·목적당 비용을 줄이고 정확도를 유지할 때만 승격한다.

### S2-F — Hand & Connected Reality

Information Control·Work·Memory·Time·Learning 기반이 선 뒤, 실제 사용자 Episode가 연 Hand·공식 API·MCP·
CLI·Connector·Messenger 하나씩만 자격화한다.

```text
connection truth → resource identity → authority → execution
→ acknowledgement → read-after-write → delivery
```

긴급 P0 복구 외의 넓은 Web·Connection·App 기능 확장은 앞선 정보 기반보다 먼저 열지 않는다.

### S2-G — UI-only Hand — NOT OPEN

현재 전용 Browser를 다시 만들지 않는다. 이는 전용 프로필 자체를 영구 금지하는 판정이 아니라 일반 Web
읽기와 대형 UI 관측 누적 구조의 퇴출이다. 반복 실수요·공식 API/Connector/CLI 대안 부재·exact user-owned
surface·bounded observation·원장과 모델 projection 분리·동일 관측 반복 재주입 0·secret user control·full
authority·행동 뒤 effect/delivery 재관측·잔류 process/window 0이 함께 서야 별도 Gate로 연다. 동일 사용자
목적을 표준 Hand와 A/B해 시간·tokens·성공률·사용자 개입에서 비교군 우위가 없으면 채택하지 않는다.

## 6. 기계 자격과 Release

각 Gate는 순서대로 다음을 통과한다.

```text
Contract → Property → Fault injection → Incident replay → Mutation
→ Terra·gpt-5.5 반복 → 비교군 Pareto → 인간 종단 → 설치 package
```

비교 합격:

```text
정확도·완전성·사용자 마찰 무회귀
AND 시간·비용·사용자 개입 중 하나 이상 명확한 우위
AND 사용자 허용 경계를 넘는 큰 열세 없음
AND false completion 0
AND 실행 가능한 미시도 route가 남은 blocked 0
```

새 package는 S2-A0~E와 실제로 열린 F Gate의 완료 문장, Terminal·Document 무회귀, 공개 웹 가시 Browser 0, resource control
우회 0, 상태 단일 정본, 외부 효과·중복 실행 회귀 0, 비교군 Gate, 설치·재시작·상태 보존, 서명·공증·rollback,
미측정 핵심 사용자 여정 0이 모두 성립한 뒤에만 만든다.

## 7. 현재 작업 시작점

현재 작업은 A0 fixture를 먼저 고정한 뒤 A1-1 exact accounting shadow만 구현한다.

첫 변경 범위:

```text
새 파일: resource-ledger.js · resource-controller.js
연결: run-ledger.js · agent-loop.js · console-model-factory.js · model adapters
검사: resource ledger · crash/idempotency · shadow accounting · incident replay
```

첫 변경 비목표:

```text
WorkStore · Instruction Compiler · Queue · Automation 의미 변경
Memory·Capability · Browser·UI · Multi-agent · 새 Connector
```

같은 결함에 세 번째 patch가 필요하거나 기존 Run·adapter 경계의 작은 변경으로 설명할 수 없으면 구현을
중단하고 구조를 재판정한다.
