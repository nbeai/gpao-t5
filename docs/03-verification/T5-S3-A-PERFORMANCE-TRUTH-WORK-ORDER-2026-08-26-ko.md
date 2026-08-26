# T5 S3-A Performance Truth — 연구 봉인 및 작업지시서

상태: `S3-A PASS WITH OBSERVATION · MEASUREMENT CLOSED · OPTIMIZATION STILL FORBIDDEN`

현재 공식 Release Gate: `SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER`

이 작업지시서는 `T5-THIRD-ACTIVATION-PREPARATION.md`의 S3-A를 실행하는 유일한 측정 계약이다. 현재 Gate,
2차 완료 판정, Release blocker를 변경하지 않는다. 측정 결과는
`refoundation/evidence/s3-a-performance-truth-close-2026-08-27.json`에서 닫았으며 성능 개선이나 구조 변경을
승인하지 않는다.

## 1. 사용자 목적과 판정 질문

### 사용자 완료 문장

> 같은 목적이라도 첫 실행인지, 이미 열린 T5인지, background 작업이 있는지, 대화가 짧은지 긴지,
> Terra인지 gpt-5.5인지에 따라 기다림의 원인이 달라진다. T5는 이 시간을 실제 경계별로 정직하게 측정해
> 가장 큰 병목만 고치고, 측정 때문에 사용자의 요청·결과·체감을 바꾸지 않는다.

S3-A는 “빠르다”를 증명하지 않는다. 다음 세 질문에 답한다.

1. end-to-end latency의 critical path는 어느 phase와 overlap에 있는가?
2. cold/warm, background on/off, 짧은/긴 Session, model 조건이 각 phase를 어떻게 바꾸는가?
3. 계측 자체가 만든 비용과 제품 행동 변화는 얼마인가?

## 2. 시작 전 동결

측정 manifest에는 다음 identity를 실행 전에 기록한다.

```text
git commit와 dirty path 목록
Node·OS·architecture·machine class·power mode
T5 config digest와 활성 Hand 목록
provider·connection kind·exact model ID
fixture manifest·source bytes·event count·artifact digest
background workload identity와 schedule digest
instrumentation mode와 trace schema version
wall clock·monotonic clock source와 resolution
```

기존 사용자 변경은 스테이지·정리하지 않는다. dirty worktree에서 측정하면 이번 변경과 기존 변경의 path를
manifest에서 분리한다. 실제 홈·개인 계정·실제 외부 write는 사용하지 않는다.

## 3. 제품 영역 coverage와 대표 사용자 목적

기존 `refoundation/config/s2-human-performance-scenarios.json`의 사용자 여정을 재사용하되 성능 측정용 원본은
`refoundation/config/s3-a-performance-truth-portfolio.json`에서 digest로 고정한다. 다음 열 개는 동일한 수의
시험이나 완전 교차 행렬이 아니라 빠뜨리면 안 되는 제품 영역 coverage다.

| ID | 대표 목적 | 주 경계 | 제품 완료 Evidence |
|---|---|---|---|
| PT-01 | 자연스러운 교정 대화와 작은 로컬 확인 | model-only·short tool·surface | 최신 교정·exact 작은 fixture count·내부 용어 0 |
| PT-02 | 최신 로컬 파일을 찾아 읽고 같은 대상을 후속 질문에서 유지 | state·Context·read tool·generation | exact file identity·문서 사실·follow-up target |
| PT-03 | 400개 이상 파일을 분류해 가역적으로 이동하고 count 검증 | long Context·tool batch·verification | movement receipt·source loss 0·read-after-write count |
| PT-04 | XLSX·PDF·DOCX를 함께 읽어 검증된 결과물 작성 | attachment·Context·render·verification | 충돌·unknown 보존·artifact reopen·원본 불변 |
| PT-05 | loopback Telegram에서 caption·파일을 받고 결과 파일 전달 | admission·tool network·delivery | attachment 결속·secret 노출 0·message/file receipt |
| PT-06 | loopback Notion에 쓰고 exact page 재개방 | provider/tool network·unknown effect·verification | write acknowledgement와 exact readback |
| PT-07 | 실행 중 교정·취소·후속 입력을 정확한 surface로 분리 | state revision·model roundtrip·publication | 입력 유실 0·cancel effect 중단·duplicate surface 0 |
| PT-08 | 예약 작업을 claim하고 목적·effect·delivery를 각각 정산 | background·state claim·delivery | stale worker effect 0·false completion 0·terminal delivery |
| PT-09 | 1,000-turn 대화와 반복 checkpoint 뒤 현재 Work 유지 | replay·Context·auxiliary model·recall | 최신 교정·anchor·unknown effect·restart 복원 |
| PT-10 | Memory 교정과 Learning 후보 검토가 foreground를 방해하지 않음 | state projection·background reviewer·publication | stale 주입 0·부적격 승격 0·foreground 우선 |

열 영역은 다음 일곱 최소 대표 여정으로 먼저 묶는다.

```text
S1 단순 작업 positive control
S2 파일 탐색 병목
S3 대량 파일·XLSX·PDF·DOCX
S4 Telegram·Notion 연결 현실
S5 실행 중 교정·취소·후속 입력
S6 장기 Conversation·checkpoint
S7 Automation·Learning background interference
```

### 2.0 설치본 actual-user incident routing

한 설치본 사용자가 복잡한 프로그램 분석·Notion 결과와 없는 사실의 정직한 처리는 높게 평가했지만 장기 작업의
불가시성, 자연어 교정·취소, 이미지/기존 파일 전달, 대량 파일 효과 사고, 임시 산출물 위생, provider terminal
복구에서 실제 실패를 관측했다. 사람·비밀·실경로·원본 파일은 fixture나 trace에 넣지 않는다. 새 대표 여정을
추가하지 않고 다음처럼 기존 coverage에 비식별 동등 조건을 흡수한다.

| 실패 가족 | 기존 여정 | 추가 관측·oracle |
|---|---|---|
| 장기 Work 불가시성 | S2·S3·S4 | first meaningful milestone, longest invisible interval, 새 Evidence 없는 진전 표시 0 |
| 교정·취소·복구 | S5 | admission→표시, cancel→started child terminal→exact execution claim release→surface, 같은 Work next revision claim, 같은 실패 surface 반복 0 |
| 이미지·기존 파일 전달 | S3·S4 | URL/Markdown 주장 대신 actual bytes·decode/reopen·Artifact surface, 기존 파일 source identity·이름 보존, 요청하지 않은 workspace copy 0 |
| 대량 파일 effect 사고 | S3 | 전후 identity·mode/ACL/flags 관측 범위, openability, reverse plan·rollback, unobserved cause unknown |
| 현재 목적·temporary 위생 | S3·S4 | 현재 목적 우선, managed temporary publication 0, final artifact naming·source Work |
| provider/resource terminal | S1·S5·S6 | 보존 상태·사용 가능한 다음 route·사용자 surface, false completion 0 |
| 인간용 상태 언어 | S1·S5·S7 | 내부 state literal·UUID·RecordRef·ISO 시각 기본 노출 0, 한국어 의미 projection과 exact developer detail 분리 |
| 모델 preamble·runtime milestone | S1·S2·S3 | preamble은 현재 응답 commentary, milestone은 canonical event 뒤에만, 추가 model call·Context injection 0 |
| 입력의 현재 위치 | S5 | queued·consumed·deferred·independent·cancel·unconsumed terminal 상태와 사용자 표면 exact 일치 |
| reconnect·복귀 recap | S5·S6·S7 | event gap 뒤 canonical snapshot 재투영, stale update 0, 한 줄 current-state recap, 새 model call 0 |

positive control은 실제 프로그램·테스트·API 분석의 결과 품질, 불명확 파일의 다중 route 탐색, 없는 사실의
정직한 처리다. 계측·UX 후보가 이 세 행동을 줄이거나 모델 route를 미리 정하면 실패다. S3-A trace sidecar는
계속 모델 Context와 사용자 surface에 0이며, 이후 S3-UX는 canonical Run·Tool·Effect·Artifact 사건만 인간용으로
projection한다.

cancel은 화면에 “멈췄어요”가 나타난 것만으로 합격하지 않는다. 중단 직후 exact durable progress를 읽는 후속
요청이 모델 호출 전에 stale claim으로 거절되지 않고, 취소한 process를 재실행하지 않은 채 같은 Work의 다음
revision으로 이어져야 한다. 기존 파일 전달도 download link와 hash만으로 합격하지 않는다. 사용자가 변환을
요청하지 않았다면 원본 파일명·source identity가 유지되고 사용자 workspace의 새 복사본 수가 0이어야 한다.
일시적인 model/provider wall 변동은 matched repeat 없이 회귀로 확정하지 않지만 model/tool call·request bytes가
증가한 표본은 같은 목적의 다음 A/B를 여는 신호로 기록한다.

progress는 tool 이름별 문구 개수를 성과로 삼지 않는다. 실제 상태 변화가 없으면 elapsed 외 새 진전 표시 0,
실제 상태 변화가 있으면 generic “생각 중” 하나로 덮는 invisible interval 0을 목표로 한다. 모델의 commentary는
목적과 첫 행동을 자연스럽게 설명하지만 실행 사실을 증명하지 않으며, runtime milestone은 사용자 문장을
저작하거나 목적을 분류하지 않는다. 두 lane은 화면에서 이어져 보여도 provenance·저장·Context 경계를 분리한다.

실행 중 입력은 접수 surface와 실제 consumption surface를 분리한다. `queued` acknowledgement를 반영 완료로
간주하지 않으며, final assistant message 뒤 도착해 소비되지 못한 교정은 terminal state에 남겨 다음 user turn으로
exact-once 공급한다. reconnect·Session 이동·process restart는 실시간 event history를 재생하는 것만으로 닫지 않고
현재 Work snapshot으로 정합성을 회복한다.

UX 후보 on/off A/B는 추가 provider/model calls, request/context bytes, event bytes·개수, UI CPU·memory, first
feedback, first meaningful milestone, longest invisible interval, wall, 목적·정확성·완전성을 함께 기록한다. 진행을
더 잘 보이게 했다는 이유로 실제 작업 wall·Context·사용자 교정 부담이 증가하면 완료가 아니다.

같은 여정 안에서도 서로 다른 외부 effect나 oracle을 한 성공값으로 합치지 않는다. 기존 증거만으로 phase와
현재 비용을 같은 기준에서 재계산할 수 있으면 새 모델 호출 없이 재사용한다. 모델별로 표현을 바꾸거나 실패 후
prompt를 보강하지 않는다. 짧은/긴 variant를 실제로 비교할 때는 현재 목적·필요 Evidence·정답이 같고 무관한
과거 상태의 양만 달라야 한다.

## 4. 실험 조건의 정확한 뜻

### 4.1 Model

- `terra`: 설치본이 실제 선택한 exact Terra model ID를 기록한다. 현재 예상 이름을 identity로 강제하지 않는다.
- `gpt-5.5`: 실제 connection kind와 exact model ID를 기록한다.

model alias만 기록한 회차는 무효다. provider retry와 각 실제 execution attempt는 별도 span으로 남긴다.

### 4.2 Cold / warm

- `cold_process`: 새 격리 DATA·WORKSPACE에서 새 T5 process를 시작하고 resident projection·connection pool·
  application cache가 없는 첫 eligible turn을 측정한다.
- `warm_resident`: 같은 process와 같은 fixture generation에서 준비용 1회를 완료한 뒤 두 번째 eligible turn을
  측정한다. 준비용 회차는 표본에 넣지 않는다.

OS page cache와 DNS/provider cache까지 강제 제거했다고 주장하지 않는다. 관리자 `purge`나 실제 machine reboot를
기본 절차로 사용하지 않으며, 따라서 `cold_process`를 `machine cold`로 부르지 않는다. warm은 앞 회차의 제품
effect를 재사용하지 않도록 purpose별 새 target identity를 사용하되 동일한 규모와 구조를 유지한다.

### 4.3 Background off / on

- `background_off`: T5가 시작한 automation, learning review, maintenance, checkpoint auxiliary work, 다른 Session
  Run이 없고 fixture loopback도 대상 요청 외 traffic을 만들지 않는다.
- `background_on`: 고정 schedule로 별도 Session의 읽기·Context maintenance·loopback network·검증 작업을
  발생시킨다. 실제 사용자 effect와 돈이 드는 호출은 금지한다.

background workload는 foreground 목적과 같은 CPU·event store·provider path 중 무엇을 공유하는지 명시한다.
단순 `on` 표시는 무효다. background span은 foreground child로 합산하지 않고 독립 trace에 correlation만 둔다.

### 4.4 짧은 / 긴 Session

- `short_session`: 현재 Work 하나, 사용자/assistant 합계 8 turn 이하, canonical source 256 KiB 이하,
  대형 과거 ToolReceipt 없음.
- `long_session`: 최소 1,000 turn, current·paused·completed Work 혼합, 세 번 이상의 checkpoint/projection 역사,
  terminal·Web·문서 ToolReceipt와 exact recall anchor를 포함한 고정 fixture.

Session 길이는 provider token 수로 정의하지 않고 canonical event count·source bytes·Work 구성으로 기록한다.
긴 fixture의 현재 사용자 목적과 필요한 Evidence는 짧은 fixture와 의미상 같아야 하며, 무관 history가 정답을
바꾸지 않아야 한다.

## 5. 적응형 표본과 실행 순서

완전 교차 행렬과 목적별 동일 표본 수는 금지한다. 다음 순서로 필요한 표본만 연다.

```text
coverage별 기존 evidence 재계산 가능성 확인
→ 일곱 대표 여정의 가장 작은 기준 표본
→ phase·품질·비용 차이와 unknown 확인
→ 차이가 나온 원인 축 하나를 matched pair로 확대
→ 같은 방향이 반복되거나 불확실성이 해소될 만큼만 추가
→ 원인이 갈리면 다음 관련 축, 아니면 중단
```

초기 표본은 S1 positive control과 기존 evidence에서 가장 큰 wall·request·checkpoint 비용이 관측된 여정을
우선한다. Terra/gpt-5.5는 모델·provider 차이가 질문인 여정에서만 둘 다 실행한다. cold/warm은 state·connection
reuse가 질문일 때, short/long은 replay·Context가 질문일 때, background off/on은 간섭이 질문일 때만 pair한다.
처음 작은 표본에서 차이가 없는데 표를 채우기 위해 다른 축을 자동 확장하지 않는다.

확대 근거는 단일 최솟값이 아니라 paired 방향, 분산, 목적 달성·정확성 차이, phase provenance다. 표본이 적어
결론을 낼 수 없으면 `unmeasured`가 아니라 `insufficient_sample`로 남기고, 다음 한 pair가 어떤 불확실성을
줄이는지 명시한 경우에만 추가한다.

실행 규율:

1. fixture generation과 expected oracle을 먼저 봉인한다.
2. model별 block 안에서 process/background/session 순서를 seeded randomization한다.
3. cold와 warm은 같은 fixture family의 pair로 묶고, background off/on도 같은 target shape로 pair한다.
4. 실패 회차도 삭제하지 않는다. environment invalid, provider unavailable, product failure를 구분한다.
5. transient provider retry는 원래 sample의 child attempt이며 새 성공 sample로 세지 않는다.
6. 매 유효 회차 뒤 effect·target·process 잔류를 확인하고 다음 격리 generation을 사용한다.
7. clock drift, thermal throttling, battery/power mode 변경, provider incident는 exclusion reason과 함께 보존한다.

모델의 비결정성을 숨기기 위해 최솟값만 보고하지 않는다. 실제로 확대한 matched condition별 `n`, median,
p90, MAD 또는 bootstrap CI,
실패율, unknown 비율을 함께 보고한다.

## 6. 공통 trace와 시간 회계

모든 span은 content-free `t5.s3a.performance-span.v1` sidecar에 기록한다.

```text
traceId · runId · sessionClass · conditionCell
spanId · parentSpanId · lane · phase · attempt
monotonicStartNs · monotonicEndNs · durationNs
wallStartedAt · status · reason
bytesIn · bytesOut · itemCount
providerTimingSource · clockSource
```

원문, prompt, tool args/result, 파일명, URL, 비밀값은 저장하지 않는다. 필요한 동일성은 SHA-256 digest와 bounded
count로만 증명한다. timestamp는 append 완료 시각 하나로 대체하지 않고 실제 경계 직전에 monotonic clock으로
찍는다. wall clock은 trace 상관관계에만 쓰며 duration 계산은 monotonic clock을 쓴다.

### 요청 wall과 phase 합계

```text
foreground wall = surface visible terminal - turn admitted
exclusive phase time = child/overlap을 제외한 해당 phase 시간
critical-path contribution = foreground 종단을 실제로 지연한 span 구간
co-occurring time = 같은 wall window에 있었지만 직접 귀속할 수 없는 시간
```

병렬 tool, streaming, background 작업의 duration을 더해 foreground wall로 보고하지 않는다. 합계가 wall을 넘는
것은 overlap 표에서는 허용하지만 critical path 값으로는 금지한다.

## 7. phase 경계

### P1. State read / replay

시작: turn admission이 durable해지고 실행이 그 identity를 claim한 직후.

종료: Conversation·Run·Work·Memory·Authority·Capability의 이번 turn용 immutable source snapshot과 필요한
projection identity가 준비된 시점.

다음 child를 분리한다.

```text
store open/stat/read
new bytes replay
resident projection reuse
cross-writer refresh
checkpoint/recovery read
```

전체 process start는 `startup` lane에 별도로 기록한다. cold startup을 state replay에 숨겨 넣지 않는다.

### P2. Context compilation

시작: source snapshot 준비.

종료: exact provider request body와 tool schema가 sealed되고 request digest·ContextReceipt가 생성된 시점.

projection selection, exact recall, runtime context, attachment encoding, provider wire conversion, JSON serialization을
child로 나눈다. provider request가 sealed된 뒤 계측 정보가 body에 추가되면 실패다.

### P3. Provider queue / network

클라이언트에서 직접 관측하는 경계:

```text
dispatch requested
connection acquired
request headers/body sent
response headers received
first response byte
last response byte
```

provider가 공식 timing을 제공할 때만 provider queue, prefill, generation, network transfer를 그 source와 함께
세분한다. 공식 timing이 없으면 dispatch→first byte를 `provider_wait_unresolved`로 기록한다. 이 값을 network나
queue라고 단정하거나 model generation에서 빼지 않는다. DNS/TLS/connection-pool timing도 runtime이 실제로
관측한 경우에만 network child로 쓴다.

### P4. Model generation

공식 provider server timing 또는 timestamp가 있는 stream event만 직접 경계로 사용한다.

```text
generation accepted/start (provider-observed when available)
first semantic token/event
last semantic token/event
usage terminal
```

TTFT를 곧바로 queue, prefill 또는 reasoning time으로 해석하지 않는다. non-streaming adapter나 server timing이
없는 회차는 `provider_wait_and_generation_combined`로 남기고 generation 단독값을 만들지 않는다. tool-call
generation과 final-answer generation은 logical call별로 분리한다.

### P5. Tool execution

시작: 권한 판정이 끝난 exact tool call을 executor가 받는 시점.

종료: 실행 outcome과 raw execution receipt가 terminal이 된 시점.

queue wait, process spawn, local I/O, remote service wait, output collection을 가능한 범위에서 child로 나눈다.
권한 대기와 사용자 승인 대기는 `authority/user_wait` lane이며 tool execution으로 합치지 않는다.

### P6. Verification

시작: 실행 receipt가 생기고 목적 완료에 필요한 현실 재관측을 시작한 시점.

종료: exact outcome·coverage·blocker가 확인되어 completion proposal을 대조할 수 있는 시점.

read-after-write, artifact reopen/render, count/hash 비교, external acknowledgement 확인을 분리한다. 도구 하나가
실행과 검증을 함께 하면 내부 receipt의 phase marker로 나누고, 나눌 수 없으면 combined span으로 정직하게
남긴다.

### P7. Surface publication

시작: verified result와 사용자 답이 `result_ready_pending_surface`가 된 시점.

종료: console에서는 durable persist 뒤 실제 client 관측 acknowledgement, channel에서는 delivery terminal이
된 시점. 둘이 모두 있으면 각각 별도 surface span이다.

serialization, session append, broadcast, client render acknowledgement, channel send/ack를 child로 나눈다.
서버 persist를 사용자가 봤다는 사실로 승격하지 않는다. client acknowledgement가 없으면 `visible unknown`이다.

### P8. Background interference

background interference는 foreground 내부 phase가 아니라 paired 인과 추정이다.

```text
interference(matched pair) = background_on - background_off
```

foreground phase별 wall delta와 CPU time, event-loop delay, disk bytes/ops, provider wait, queue depth를 함께 본다.
background span duration 전체를 foreground 비용으로 귀속하지 않는다. pair 밖 동시 활동은 `co-occurring`이며
causal estimate가 아니다.

## 8. provider 내부 경계의 정직성

S3-A가 요구하는 분리 측정은 숫자를 억지로 채우라는 뜻이 아니다.

| 관측 가능성 | 기록 |
|---|---|
| client와 provider 양쪽 경계가 공식 timestamp로 있음 | 직접 phase 값 |
| client dispatch/stream만 있고 server timing 없음 | combined provider wait/generation |
| 동일 목적의 controlled A/B만 있음 | causal estimate와 CI |
| 같은 Run에서 함께 발생했을 뿐 | co-occurring scope time |
| 어느 것도 없음 | `unknown` |

`wall - model - tool = queue/network` 같은 잔차 계산은 금지한다. GC, event loop, serialization, verification,
publication, scheduling gap이 잔차에 함께 들어가기 때문이다.

## 9. 측정 구조 비용 반대시험

계측은 세 mode로 비교한다.

```text
O0 off: 기존 제품 event와 기존 receipt만, S3-A sidecar 없음
O1 clock-only: span boundary를 memory ring buffer에 기록, disk flush 없음
O2 full-shadow: content-free sidecar 기록·종료 후 집계
```

### 결정적 fixture 반대시험

같은 seed·clock script·fixture provider·tool receipts로 O0/O1/O2를 먼저 작은 교차 순서 표본으로 수행한다.
digest 변화나 측정 가능한 overhead가 보이면 그 mode와 경계만 반복 확대한다. 차이가 없는 mode를 임의의
고정 횟수까지 채우는 일을 합격 조건으로 만들지 않는다.

필수 동일성:

```text
provider request body digest
tool name/order/args digest
authority decision digest
execution/effect/verification receipt digest
assistant surface semantic fixture digest
Run terminal state와 event order (S3-A sidecar 제외)
```

필수 비용:

```text
turn wall delta
event-loop delay delta
process CPU delta
max RSS delta
bytes written per Run
trace flush count와 blocking write count
```

O1/O2 때문에 순서·digest·effect가 하나라도 바뀌면 제품 비개입 실패다. 비용은 median과 p90, absolute와
percentage를 모두 보고한다. 상한은 실측 전 임의로 합격값을 정하지 않는다. 다만 1ms 미만으로 반올림하거나
0으로 기록하지 않는다.

### 실제 모델 paired 반대시험

Terra와 gpt-5.5의 S1 short/warm/background-off에서 O0/O2를 먼저 한 pair씩 수행한다. 제품 route·digest·품질
차이나 observer overhead가 보일 때만 해당 모델을 반복 확대한다. 모델 출력
문구의 exact equality는 요구하지 않지만 다음은 같아야 한다.

- exact provider request body digest와 tool surface digest
- 목적·target identity·권한·도구 route·effect·verification·surface 수
- 모델 Context에 S3-A schema·span·clock·trace identity 노출 0
- 사용자 답에 내부 phase·path·clock·trace 노출 0

실제 모델의 자연 변동과 계측 비용은 결정적 fixture 결과 없이 분리 판정하지 않는다.

## 10. 제품 비개입 반대시험

다음 mutation/negative control이 모두 실패해야 한다.

1. S3-A trace field 하나를 provider request에 주입하면 request digest test가 실패한다.
2. sidecar append를 foreground에서 동기 fsync하도록 바꾸면 overhead control이 실패한다.
3. background span을 foreground child로 합산하면 critical-path accounting test가 실패한다.
4. server timing 없는 TTFT를 model generation으로 라벨링하면 provenance test가 실패한다.
5. 계측 writer 오류를 throw해 turn을 중단하면 fail-open product invariant test가 실패한다.
6. raw prompt·tool output·secret canary를 trace에 넣으면 content-free/privacy test가 실패한다.
7. surface persist를 visible로 기록하고 client ack를 생략하면 publication truth test가 실패한다.
8. 측정 mode에 따라 tool order 또는 completion outcome을 바꾸면 behavioral digest test가 실패한다.

시험은 실제 계측 행동을 제거하거나 위 오염을 넣었을 때 빨개져야 한다. 문자열 snapshot만으로 통과시키지
않는다.

## 11. 결과표와 판정

실행한 표본과 확대된 matched condition 결과는 최소 다음 열을 가진다.

```text
purpose · model identity · cold/warm · background state · session class · n
startup · state read/replay · context compilation
provider wait/network provenance · model generation provenance
tool execution · verification · surface persist · surface visible/delivery
foreground wall · critical path · overlap · unclassified gap
CPU · RSS · disk bytes · provider tokens · request bytes
cached/uncached input tokens · model/tool calls · first feedback/action/useful result
user turns · corrections · approvals · purpose achieved · false completion · effect unknown · failure rate
```

phase median만으로 후보 구조를 선택하지 않는다. 사용자 목적 달성, 정확성, 완전성, 회복, 외부 effect,
사용자 surface가 유지된 표본에서만 성능을 비교한다. 실패한 빠른 회차는 우위가 아니다.

### S3-A 통과

```text
열 개 제품 영역 coverage와 기존 evidence 재사용 여부가 모두 정산됨
AND 일곱 최소 대표 여정에서 positive control과 주요 실패 가족이 구분됨
AND 차이가 확인된 축만 필요한 만큼 확대됨
AND phase provenance·unknown·overlap이 정직함
AND background paired causal estimate가 있음
AND O0/O1/O2 비용과 제품 비개입 반대시험 통과
AND Terra·gpt-5.5 실제 paired 반대시험 통과
AND false completion·새 effect duplication·비밀 노출 0
AND 금지된 구조 구현 0
```

provider timing 부재, 유의한 병목 부재, observer overhead 과다도 유효한 관측 결과다. 다만 열 개 coverage 중
근거도 대표 여정도 없는 영역, observer 비개입 미증명, 주요 병목의 phase 미분류가 남으면 S3-A를 완료로 닫지
않는다.

## 12. 결과 뒤 의사결정 규칙

S3-A 결과는 다음 형식으로만 다음 한 작업을 제안한다.

```text
관측된 가장 큰 사용자 critical-path 병목
영향받은 condition과 effect size
직접 증거·causal evidence·unknown
보존해야 할 제품 invariant
가장 작은 후보 변경 하나
반대시험과 rollback
명시적 non-goals
```

SQLite, Prompt 분해, Actor, Outbox, Completion Envelope는 이름만으로 후보가 되지 않는다. 각 구조가 관측된
병목을 줄이는 직접 경계와 더 작은 대안 대비 이점이 있어야 하며, 오너가 별도 한 작업으로 승인해야 한다.

결과가 state replay·lock·I/O를 주요 병목으로 지목한 경우에만 Event Kernel 후보를 연다. provider 입력·Prompt·
모델 왕복이 주요 병목이면 Context·Provider 후보를 먼저 연다. 둘 다 독립적으로 큰 경우에도 서로 개입하지
않는 작은 shadow만 별도 Gate로 제안한다. foreground 사용자 Turn·취소·publication·현재 channel delivery는
checkpoint·index·reviewer·learning보다 항상 우선하며, background 전체 실행시간을 foreground 비용으로
떠넘기지 않는다.

## 13. 현재 실행 순서

```text
coverage·기존 evidence·최소 대표 여정 봉인
→ 비교군 공개 source와 실제 방어 실패 확인
→ content-free span schema와 clock adapter의 test-only prototype
→ O0/O1/O2 결정적 비용·비개입 반대시험
→ S1 positive control과 가장 큰 기존 비용 여정의 작은 표본
→ observer 반대시험 판정
→ 차이가 나온 원인 축만 matched pair 확대
→ phase·critical path·interference 분석
→ S3-A evidence index
→ 오너의 다음 한 작업 결정
```

Terminal-first baseline은 S1·S2·S5를 대체하거나 표본 수를 늘리는 별도 행렬이 아니다. 격리 HOME의
일반 파일과 비밀 fixture, 현재 effect schema, foreground output, background process cursor를 한 결정적
여정으로 관측해 다음 질문만 답한다.

```text
사용 가능한 실제 환경 사실
직접 읽을 수 있는 비밀 fixture 여부
모델이 제출해야 하는 effect 필드·schema bytes
생략 output의 exact recall 가능 여부
같은 process의 delta·stdin·terminal 전이 보존 여부
```

이 baseline만으로 sandbox·credential broker·Terminal Session Driver를 구현하지 않는다. 실제 사용자
목적 A/B에서 가장 큰 간극이 확인된 한 책임만 다음 후보로 제안한다.

첫 구현 작업은 제품 구조 변경이 아니라 test-only shadow 계측과 그 반대시험이다. shadow 계측이 제품 입력이나
행동을 바꾸면 전체 matrix를 실행하지 않고 먼저 측정 구조를 폐기하거나 재설계한다.
