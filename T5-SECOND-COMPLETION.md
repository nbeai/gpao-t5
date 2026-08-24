# T5 Second Completion — Current Development Source

상태: `SECOND_COMPLETION_ACTIVE`
현재 Gate: `S2-B-F06 SEMANTIC CONTINUITY REOPENED · S2-C PRESERVED`
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

일반 사용자 경험은 기능·성능 축소가 아니라 복잡성 흡수다. 모든 Gate는 비교군과 같은 어려운 목적에서
기능 범위·정확성·완전성·복구력을 유지하거나 높이면서 사용자의 설명·설정·승인·기술 학습을 줄여야 한다.
도구·Context·Prompt를 가볍게 했다는 이유로 필요한 Hand·Evidence·recall·미시도 route를 없애면 실패다.

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

각 Gate 전 플랫폼 확인 계약에 따라 OpenClaw의 Windows·WSL2 경계도 A1-1 전에 봉인했다. Resource Core는
macOS path·mode·PID·signal을 identity나 정산 진실로 쓰지 않는다. Windows의 directory sync·private mode
차이와 WSL의 별도 distro·사용자·생명주기는 storage/process adapter의 관측 사실로만 받는다. WSL 2.6.1.0의
idle 종료와 SYSTEM 계정에서 per-user distro가 보이지 않던 실제 장애는 `실행 요청≠runtime 시작`,
`process 종료≠scope 정산 완료` 반대시험으로 보존한다. Windows 기능이나 WSL 구조는 이번 Gate에서 구현하지
않는다. 근거: `refoundation/evidence/s2-a1-platform-boundary-seal-2026-08-24.json`

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
A1-1 exact accounting shadow — COMPLETE
→ A1-2 anomaly shadow — COMPLETE
→ S2-A2 Information Control
→ A1-3 모델에 Resource Situation 공급 — COMPLETE
→ A1-4 능동 최적화 — COMPLETE
→ A1-5 검증된 병적 폭주에만 최후 개입 — COMPLETE
```

A1-3는 A2 완료 전에는 열지 않는다. 현재의 큰 Context에 Resource Situation을 더하면 모델 입력과 행동을
바꾸면서도 반복 ToolReceipt·과거 원문·비활성 Hand·무관 Memory가 만든 원인을 보존할 수 있다. 먼저 A2에서
장부와 모델 시야를 분리하고 목적에 필요한 최신 Evidence와 정확한 recall handle만 투영한 뒤, 작고 정확해진
Context에 Resource Situation을 추가한다.

A1-3는 정상 efficiency telemetry를 모든 호출에 넣지 않는다. 최신 Evidence가 새로우면 과거 cumulative
anomaly를 다시 투영하지 않고, current repeated/pathology·retry/unknown 또는 기존 고정 상한이 마지막 실제
패턴의 다음 호출에 닿는 전환에서만 bounded Situation을 provider runtime suffix로 한 번 공급한다. stable
constitution prefix, Conversation·Run canonical, 사용자 답은 바꾸지 않는다. 고정 상한과 runtime 실행 정책도
그대로다. 실제 2-turn 경계에서 gpt-5.5는 Situation off일 때 중단됐지만 on일 때 같은 경계에서 정확히 완료했고,
Terra는 off/on 모두 무회귀였다. 근거:
`refoundation/evidence/s2-a1-3-resource-situation-2026-08-24.json`

A1-4는 Situation에 runtime이 만든 최적화 선택지를 추가하지 않고, 모델이 기존 목적·Evidence·Hand를
보고 실제로 한 settle·continue·route change·reobserve·multiple-call 선택만 content-free로 관측한다.
모델이 한 응답에서 함께 선택한 Hand 전부가 명시적 `parallel-safe`인 읽기일 때만 동시 실행하고,
하나라도 쓰기·순차 실행이면 원래 순서를 유지한다. Receipt·transcript·tool wall 회계는 모델 호출
순서와 각 Hand의 실제 실행시간을 보존한다. 경계 임박 충분/불충분 Evidence를 Terra·gpt-5.5에서
구분했고, 3초 독립 Hand gpt-5.5 A/B는 10.963초에서 7.937초로 줄면서 정답·model/tool call을
유지했다. unknown 쓰기는 동일 쓰기 재실행 대신 현실 재관측으로 닫혔다. 고정 상한·중단·답 저작권은
바꾸지 않았다. 근거: `refoundation/evidence/s2-a1-4-active-optimization-2026-08-24.json`

A1-5는 일반·자동화 Run의 16 model turns·24 tools·500K/300K provider tokens·4 failed tools
기본 상한을 제거했다. 새 Evidence가 계속되거나 같은 호출의 결과가 바뀌는 정상 poll은 호출
수로 중단하지 않는다. Process Hand가 pending으로 밝힌 `running`·`stop_requested` poll은
같은 cursor·결과가 반복돼도 no-progress 근거로 쓰지 않고 terminal 관측까지 열어 둔다. 일반
실패는 exact route identity에만 결속하며 다른 args·대상의 미시도 route를 막지 않는다. Hand 전체
차단은 Hand 자체가 `global unavailable`을 명시한 Receipt에서만 자격이 있다. exact route가 terminal인
같은 안정된 결과를 두 번 냈거나 effect-unknown 쓰기를 같은 인자로 재실행하려는 경우에만 해당
route를 한 번 차단하고 모델에게 다른 방법·재관측·정산 기회를 준다. 차단 영수증 후에도 같은
방법만 고집할 때 Run을 멈춘다. 병렬 실행은 운영체제가 관측한 물리 병렬도의 wave로 실행하고,
내부 fan-out Hand는 독점 wave로 외부 fan-out과 곱해지지 않는다. 시작한 병렬 자식은 실행 전
reservation과 개별 settlement를 남기고, cancel은 시작 자식을 닫은 뒤 대기 자식을 실행하지 않는다.
Terra·gpt-5.5 실제 모델은 각각 26개의 새 Evidence를 2 model turns·26 tool calls로 모두 관측하고
정확한 합계를 완성했다. false completion·개입·미정산·내부 용어 노출은 0이었다. runAgent에
사용자 합의나 자격 시험으로 명시적 결속된 경계는 계속 집행하며, 실측 없는 catastrophic fuse
숫자는 새로 만들지 않았다. 근거: `refoundation/evidence/s2-a1-5-last-resort-intervention-2026-08-24.json`

A0 정제본은 19 Run·107 call 자원 곡선만 보존하고 route identity·Evidence fingerprint를 보존하지
않으므로 active stop 지점은 `unknown`으로 남겨 과거 pathology를 발명하지 않았다. 비식별 동등
replay에서 `pathology Situation 공급 → 모델이 선택한 recovery route 실행 → 새 Evidence 0`을
검증한 뒤, 모델의 최종 정산 판단은 받되 추가 Tool 실행을 차단했다. recovery가 새 Evidence를 내면
상태를 즉시 해제하고 다음 미시도 route를 계속 연다.

A1-1은 모든 model adapter의 provider fetch 전 durable reservation, retry attempt 분리, provider usage commit,
crash·cancel unknown, tool wall/call 관측, checkpoint·memory flush·visual observer·automation main과 hosted search
내부 model call 연결을 content-free shadow로 완성했다. 회계 storage가 startRun·reservation·settlement에서
실패하면 기존 Run에 `accounting_degraded`를 한 번 남기고 정상 사용자 작업은 계속하며, 같은 실패를 계측이
반복하지 않는다. Terra·gpt-5.5의 격리된 Terminal·Document·Web·cancel 실제 콘솔 7턴에서 Browser·승인·내부
Resource 문구 0, reservation 23 = 관측 model call 23, commit 22 + cancel unknown 1, 미정산 0을 확인했다.
모델 Context·사용자 답·상한·도구 선택·UI는 바꾸지 않았다. 근거:
`refoundation/evidence/s2-a1-1-exact-accounting-shadow-2026-08-24.json`

A1-2는 도구 결과의 transient fingerprint를 현재 Run 안에서만 비교하고 원장에는 `new·repeated·none`만
남긴다. 새 Evidence가 없거나 같은 Evidence만 반복되는 중 Context가 증가할 때만 pathology 후보이며, 새
Evidence가 계속 생기는 긴 연구는 request·function-output projection이 커져도 efficiency 후보로 분리한다.
provider retry와 cancel·crash unknown은 reliability 후보라서 병적 반복으로 승격하지 않는다. 모든 후보는
content-free shadow이고 모델 Context·답·도구·상한·중단을 바꾸지 않는다.

A0의 19 Run·107 call exact curve에서는 15개 다중 호출 Run이 두 번째 호출부터 efficiency 후보가 됐지만,
정제 fixture에 원본 결과 fingerprint가 없으므로 pathology라고 소급 단정하지 않았다. 실제 gpt-5.5 공개 Web
두 표본은 52.5~78.9초였고, 첫 표본은 새 Evidence 없는 구간 1개를 모델 7회째 pathology 후보로, 두 번째는
새 Evidence 7개를 가진 efficiency 후보로 구별했다. Browser·승인·미정산·내부 Resource 문구는 0이었다.
속도는 여전히 제품 미달이지만 A1-2에서는 관측만 하고 고치거나 중단하지 않는다. 근거:
`refoundation/evidence/s2-a1-2-anomaly-shadow-2026-08-24.json`

통과 조건:

- provider fetch 전 forecast·reservation 100%
- checkpoint·memory·authority·automation usage 누락 0
- 병렬 reservation·crash·중복 commit 정확
- 새 Run·Session의 resource history 초기화 0
- 정상 과업 false intervention·premature stop 0
- 1천만 token replay의 반복·무진전·자원 증가를 폭주 전에 감지·교정
- Terminal·Document·Web 사용자 결과 변화 0

A1-5 뒤 A 전체 인간 판정은
`docs/03-verification/T5-S2-A-HUMAN-CONSOLE-LIVE-PLAN-2026-08-24-ko.md`의 자연어 콘솔 여정으로 수행한다.
기계 검사만으로 A를 닫지 않으며, B·D·F의 현재 미달은 기준선으로만 기록해 A의 구현 범위를 넓히지 않는다.

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

A2-I1 information surface — COMPLETE

- 기본 Web 모델 시야는 bounded `web_research`와 exact `web_read`를 유지하고 partial `web_search` schema는
  `tool_search` 뒤에 연다. 후보 검색이 필요하면 모델이 그대로 복구할 수 있으며 wide Web 표면도 비교선으로
  보존한다.
- 같은 읽기 Evidence가 다시 들어온 경우에만 과거 모델 payload를 latest full Receipt pointer로 바꾼다.
  서로 다른 Evidence와 외부 효과 Receipt는 줄이지 않고, RunLedger·Conversation에는 모든 원문을 보존한다.
- 여러 query의 hosted search child call은 query identity를 분리해 병렬 회계 degradation과 미정산을 막는다.
- 실제 공식 Web에서 Terra는 16.4초·모델 2회·도구 1회, gpt-5.5는 39.8초·모델 4회·도구 3회로 완료했고
  정답·공식 출처·Browser 0·미정산 0이었다. 모델 route 변동이 커서 정확한 causal wall 감소는 주장하지 않는다.

근거: `refoundation/evidence/s2-a2-i1-information-surface-2026-08-24.json`

A2-I2 context relevance — COMPLETE

- 모델 호출마다 과거 Conversation·현재 Memory 후보·현재 사용자 요청·현재 Run ToolReceipt·반복 Receipt·활성
  Hand schema·미사용 비복구 Hand를 content-free로 분리 계측한다.
- 모든 사용자 메시지와 교정, 마지막 사용자 turn 이후 assistant/tool은 inline 유지한다. 그보다 오래된
  assistant/tool 구간은 canonical을 바꾸지 않고 exact sessionId·messageId recall handle로 투영한다.
- 모델이 첫 실제 Hand를 선택한 뒤 같은 family와 `exec·attachment·connection·web_read·tool_search`, 필요한
  `session_search`, 같은 search가 활성화한 dependency 묶음만 유지한다. 다른 family는 모델이 다시 검색해 연다.
- Memory event history는 넣지 않고 기존 bounded current durable 후보만 source session·kind별로 계측한다.
  Work 의미 선택은 B의 work identity가 생기기 전에 런타임이 추측하지 않는다.
- HP-01은 최신 DOCX와 후속 대상을 유지했다. HP-02는 400개 이동·모호 24개·movement receipt·count를,
  HP-03은 guide identity·version·formats·artifact를 재개방해 확인했다. HP-02 request는 19.7%, tokens는 22.0%,
  HP-03 request는 12.8%, tokens는 11.2% 감소했고 paired wall도 감소했으며 model/tool 왕복은 늘지 않았다.

S2-A2 Information Control — COMPLETE. 근거:
`refoundation/evidence/s2-a2-information-control-complete-2026-08-24.json`

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

초장기 Conversation·반복 checkpoint·Work epoch의 상세 완료 조건은
`docs/03-product-plan/T5-SECOND-COMPLETION-LONG-CONTEXT-HARDENING-2026-08-24-ko.md`를 참조한다.

```text
deterministic: 같은 route+args 재실행 0
transient+retrySafe: 동일 재실행 최대 1회
effect unknown: 재실행 0, 현실 재관측만 허용
```

통과: 교정·입력 유실 0, restart 복원, premature stop 0, 거짓 성공 0, 모델 userAnswer 재작성 0.

S2-B — PARTIAL REPAIR, F06 REOPENED. 실행 중 새 사용자 입력은 기존 409 거부 전에 Conversation message와 Work input
pointer로 durable admission된다. 다음 주 모델 boundary에서 모델이 `steer·followup·new_work·cancel`을
`work_transition`으로 선택하고 runtime은 append-only revision·execution claim만 집행한다. B-F01~F05와
process wake 복구는 유지한다. 다만 실패 문장을 tool few-shot에 넣고 같은 문장으로 재시험한 24/24는
일반화 증거가 아니므로 철회한다. stale Run은
최신 Work revision을 propose·settle할 수 없고, classification 전 pending과 classification 후 queued input은 restart 후
복원된다. 모델 완료 문장은 Completion Proposal이며 approval·handoff·effect unknown·delivery 실패가
남으면 `unresolved`, 요구 영수증이 정산된 경우에만 `achieved`다. Terra는 자연어 교정을
내부 용어 노출은 0이어야 한다. 근거: `refoundation/evidence/s2-b-work-conversation-continuity-2026-08-24.json`

사용자 의미와 scheduling을 분리한다. `revise_current_work`는 현재 범위·방법·결과 수정,
`extend_current_work`는 현재 Work를 유지한 단계·결과물 추가, `start_independent_work`만 별도 Work,
`cancel_current_work`는 중단이다. 별도 queued Run은 현재 결과의 선 delivery가 명시됐거나 이미
settlement·delivery됐거나 동일 Work에서 수행할 수 없을 때만 scheduling 결과로 사용한다. revise·extend의
기본은 같은 Work ID·새 revision·현재 Run 안의 순차 실행이다. D는 이 의미 종단 자격 전까지 잠근다.

admission은 본문만이 아니라 Conversation pointer·attachment identity·channel·sender·reply identity를 함께
보존하고 queued 실행에서 같은 사용자 입력을 history와 current request에 중복 투영하지 않는다.
`work_transition`은 pending admission이 있는 model boundary에서만 활성화된다. 단순 model response 종료는
Completion Proposal이 아니며, 모델이 `work_completion`으로 achieved·unresolved를 명시적 제안하고
현재 revision·Receipt blocker를 대조한 경우에만 정산한다.

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

S2-C — REPAIRED COMPLETE. MemoryLedger는 User·Work 현재값의 source message·session·Run·Work revision·subject를
보존한다. 모델에는 현재 요청과 subject가 관련된 User Memory와 exact current Work revision의 Work
Memory만 결정론적으로 투영한다. 같은 subject의 충돌은 최신 source revision이 이기며, 현재 사용자
교정은 저장된 선호보다 우선한다. 완료·취소·다른 Work 기억은 원장에는 남지만 현재 model
Context에서 자동 demotion된다. Working Memory는 Work identity·revision·pending input pointer의 파생
projection이고, Episode는 settlement의 Conversation message·Run pointer이며 원문을 복제하지 않는다. 78만자
실제 Terra 자격에서 durable preference·Work decision만 보존하고 one-off·비밀·추측·해결된 오류를
제외했으며, 새 세션의 현재 교정이 기존 선호를 이겼다. 근거:
`refoundation/evidence/s2-c-memory-portfolio-2026-08-24.json`. 사전 live audit에서 런타임 2글자
의미 선택, 서로 다른 Work revision의 사용자 기억 최신성 비교, 제품에 연결되지 않은 Episode pointer가
확인돼 COMPLETE 판정을 철회했다. 런타임 의미 선택을 제거하고 subject pointer→주 모델 exact read,
독립 subject revision/source order, 실제 `session_search episodes→episode_read` 경로로 교정했다.
Terra·gpt-5.5 78만 자 라이브 자격과 새 코어 692/692를 통과했다. 전체 통합에서 드러난 handoff·followup
publication race도 durable terminal state를 사용자 surface보다 먼저 기록하도록 교정해 기본 제품 통합
105/105를 통과했다.

S2-B 인간 종단 재자격 — F01~F05 + PROCESS WAKE REPAIRED, F06 REOPENED. `fa528923` 뒤 실제 console에서 확인된 attachment
admission 500, envelope·sender·reply 유실, Hand focus 뒤 Completion Proposal 소실,
proposal·settlement blocker 불일치, followup 오분류를 B-R1~R5로 복구했다. Busy input은 inputId
prepare→attachment input link→Conversation append→commit 뒤에만 202가 되며 실패·불완전 restart는 live
partial state 없이 abort된다. 모델은 admission 시점·현재 결과 보존·실행 시간을 보고 의미 중심 선택값으로
사용자 의미와 실행 scheduling 분리는 아직 최종 인간 자격 전이다. 기존 Terra·gpt-5.5 24/24는
prompt와 시험에 같은 실패 문장을 사용했으므로 폐기했다. 근거:
`refoundation/evidence/s2-b-work-conversation-continuity-2026-08-24.json`.

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

## 6. 실제 테스터 성능 여정

`0.1.9` 인간 사용 시험은 원본 화면·개인정보·비밀값·사용자 경로를 저장소에 복제하지 않고
`refoundation/config/s2-human-performance-scenarios.json`의 아홉 목적 여정으로 보존한다. 당시 기준선과
Gate 귀속은 `refoundation/evidence/s2-p019-human-tester-baseline-2026-08-24.json`이 담당한다.

| 단계 | 반드시 닫을 실제 사용자 여정 |
|---|---|
| A2 | 로컬 파일·문서 강점 무회귀, 대형 파일 정리·프로그램 분석의 입력·왕복 밀도 |
| A1-3~5 | 새 Evidence가 계속되는 과업을 고정 상한으로 중단하지 않는 정교한 자원 제어 |
| B·D | Telegram에서도 교정·취소·재개·새 작업을 콘솔 전용 버튼 없이 수행 |
| F Telegram | 수신 파일+caption의 Attachment 결속, 공식 파일 발신·delivery, bot secret 비노출 |
| F Connection | T5와 외부 앱 연결 identity 분리, Notion 권한 현실, write 뒤 read-after-write |
| Release | HP-01~HP-09 전체, 비밀 노출·거짓 완료·고정 상한 중단·가시 Browser 0 |

노출된 connector credential은 폐기·재발급 대상이며 raw tester media는 제품 증거가 아니다. 현재 A2를 채널
기능 확장으로 중단하지 않고, Telegram은 앞선 기반이 선 뒤 첫 Connected Hand 자격 후보로 연다. 다만 모델이
일반 Terminal로 connector secret을 읽어 직접 API를 호출하는 경로는 다음 package의 Release blocker다.

## 7. 기계 자격과 Release

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

## 8. 현재 작업 시작점

S2-A0, A1-1, A1-2, S2-A2, A1-3, A1-4와 A1-5를 완료했다. 다음 한 작업은 새 기능 구현이 아니라
`docs/03-verification/T5-S2-A-HUMAN-CONSOLE-LIVE-PLAN-2026-08-24-ko.md`의 A-H01~A-H08을 실제 개발
콘솔에서 수행하는 S2-A 인간 종단 판정이다. 이 자격을 통과하기 전에 B·D·F 기능을 열거나
Telegram·Notion 미달을 A 구현으로 넓히지 않는다.

A1-2 완료 범위:

```text
새 파일: resource-anomaly-shadow.js · resource-evidence.js
연결: agent-loop.js · resource-controller.js · resource-ledger.js · resource-report.js
검사: 반복 Evidence pathology · 11/10 새 Evidence positive control · cancel reliability · A0 19/107 replay
      · gpt-5.5 공개 Web 두 표본 · 플랫폼 반대시험 · 계측 부담
```

다음 작업 비목표:

```text
WorkStore · Instruction Compiler · Queue · Automation 의미 변경
Memory·Capability · Browser·UI · Multi-agent · 새 Connector
```

같은 결함에 세 번째 patch가 필요하거나 기존 Run·adapter 경계의 작은 변경으로 설명할 수 없으면 구현을
중단하고 구조를 재판정한다.
