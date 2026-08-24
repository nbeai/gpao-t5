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

### S2-A0 — Incident & Reference Fixtures

제품 동작 변경 없이 다음 실패를 비식별·결정적 replay로 고정한다.

```text
19 Runs · 107 model calls · 10,146,162 tokens
Browser direct input 약 21% · Browser 결과 반복 입력 약 90%
automation false success · message admission loss · process residual
```

비밀값·메일 본문·개인정보는 제거하고 상태·크기·digest·관계만 보존한다.

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

### S2-A2 — Dense Model Environment

활성 Hand·현재 Situation·관련 Memory·Evidence만 주입한다. stable constitution과 prompt cache를 보존하고
비활성 지침·중복 tool 설명·반복 원문을 제거한다. canonical Receipt는 보존하며 큰 결과에는 exact recall
handle을 준다. W9 blind truncation·extraction model·shared cache·branch research는 열지 않는다.

통과: authority·effect·coverage·교정 손실 0, recall digest 일치, positive control 무회귀, 모델 왕복 증가 0,
uncached input·wall time 감소, Terra·gpt-5.5 반복.

### S2-B — Durable Correction & Recovery

append-only WorkStore, Work revision 출처, 최소 Situation, durable input·steer·followup·cancel, failure 종류,
Completion Proposal·Settlement를 연결한다.

```text
deterministic: 같은 route+args 재실행 0
transient+retrySafe: 동일 재실행 최대 1회
effect unknown: 재실행 0, 현실 재관측만 허용
```

통과: 교정·입력 유실 0, restart 복원, premature stop 0, 거짓 성공 0, 모델 userAnswer 재작성 0.

### S2-C — Time Continuity

Automation occurrence를 workId·resource scope에 결속하고 execution·objective·delivery를 분리한다. 실행 시점
Situation·Capability·authority를 다시 확인하고 claim heartbeat·stale worker 폐기·crash fencing을 적용한다.

통과: recursive automation·모델 종료 성공·delivery 실패 성공·unknown effect retry 0, fault injection,
Telegram loopback, Terra·gpt-5.5 동일 여정.

### S2-D — Connected Reality

실제 사용자 Episode가 연 공식 API·MCP·CLI·Connector·Messenger 하나씩만 자격화한다.

```text
connection truth → resource identity → authority → execution
→ acknowledgement → read-after-write → delivery
```

### S2-E — Growth

검증된 Work·Episode pointer에서 방법 후보를 만들고 격리 replay·baseline A/B·실제 반복 과업 뒤에만
Skill·Capability로 승격한다. 실패 방법 승격·Core 자동 수정은 0이다.

### S2-F — UI-only Hand — NOT OPEN

전용 Browser를 다시 만들지 않는다. 반복 실수요·공식 대안 부재·exact user-owned surface·bounded observation·
secret user control·full authority·잔류 process/window 0·비교군 우위가 함께 증명될 때만 별도 Gate로 연다.

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

새 package는 S2-A~E의 열린 완료 문장, Terminal·Document 무회귀, 공개 웹 가시 Browser 0, resource control
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
