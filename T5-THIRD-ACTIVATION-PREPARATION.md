# T5 3차 고도화 — 활성화 전 준비 정본

상태: `OWNER_ACTIVATED_S3A_TERMINAL_FIRST · OPTIMIZATION LOCKED`

현재 공식 Release Gate: `SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER`

현재 공식 Release Gate와 2차 완성의 진행 정본은 계속 `T5-SECOND-COMPLETION.md`가 담당한다. 이 문서는
그 Release 상태는 변경하지 않는다. 오너는 2026-08-26 Terminal-first 고도화를 맡기며 S3-A 측정선을
활성화했다. 이 문서는 측정·반대시험·판정의 범위와 최적화 전 금지선을 유지한다. 제품 정의는
`T5-PRODUCT.md`, 작업 규율은 `AGENTS.md`가 우선한다.

## 1. 활성화 전 판정

```text
2차 Release Gate: 변경 없음
3차 개발선: S3-A Terminal-first 측정 활성
현재 허용 작업: S3-A 측정·판정과 S3-T0가 직접 확인한 login-shell HOME isolation 결함의 좁은 보안 수리
현재 금지 작업: 측정 결과를 전제한 구조 변경과 성능 최적화
```

서명 identity 부재라는 Release 외부 blocker를 3차 소스 변경으로 해결한 것처럼 기록하지 않는다. 반대로
S3-A 준비가 Release package의 서명·공증 완료 조건을 대신하지도 않는다. Release 작업과 S3-A는 서로 다른
scope·evidence·판정을 유지한다.

## 2. 제품 약속과 3차 준비의 목적

> 사용자는 T5를 배우지 않는다. T5가 사용자를 배우고, 사용자가 평소 말로 목적을 말하면 T5는 컴퓨터와
> 외부 자원을 활용해 실제로 끝낸다.

3차 고도화는 내부 구조의 현대화가 목적이 아니다. 사용자가 느끼는 기다림과 장기 사용의 무거움이 어디에서
생기는지 실제 사용자 목적 전체에서 분리 측정하고, 가장 큰 원인이 증명된 뒤에만 그 경계를 바꾸는 것이
활성화 전 목적이다.

### 활성화 전 완료 문장

> 단순 대화부터 Memory·Learning까지 열 개 제품 영역을 빠뜨리지 않고 기존 증거와 최소 대표 여정으로
> 살펴본 뒤, 실제 차이가 확인된 목적만 Terra와 gpt-5.5, cold/warm, background on/off, 짧은/긴 Session의
> 관련 축으로 확대했을 때
> 상태 읽기·replay, Context 구성, provider 대기와 network, model generation, 도구 실행, 검증, 사용자 표면
> publication, background interference의 시간과 불확실성을 서로 잘못 귀속하지 않고 설명할 수 있다. 계측을
> 껐을 때와 켰을 때의 제품 입력·행동·효과·결과가 같고 계측 비용도 수치로 봉인되어야 한다.

## 3. 작업 시작 일곱 줄

1. **제품 약속**: 평소 말로 요청하면 T5가 실제 현실을 사용해 목적을 끝낸다.
2. **현재 Gate**: 2차 완성 완료, 0.2.1 unsigned package 자격 완료, signing external blocker다.
3. **Gate 사용자 완료 문장**: 현재 상황·기억·능력·권한·자원을 정확히 구성해 적은 왕복과 작은 Context로
   목적을 유지하고, 실행·효과·전달·결과를 확인한 뒤에만 완료한다.
4. **이미 선 실제 증거**: resident WorkStore replay 제거, ResourceLedger와 ContextReceipt, Run·effect·surface
   사건, S2 실제 Terra·gpt-5.5 자격, 0.2.1 legacy-free payload 자격이 있다.
5. **현재 가장 큰 미달**: 현재 숫자는 종단 wall·model/tool 합계 중심이어서 긴 Session이나 background
   activity에서 어느 경계가 실제 critical path를 지배하는지 인과적으로 말할 수 없다.
6. **이번 변경이 미달을 줄이는 방식**: 제품 의미나 저장 구조를 바꾸기 전에 같은 사용자 목적의 교차 조건과
   content-free phase span을 동결하고 observer effect를 반대시험한다.
7. **이번 변경의 non-goals**: 공식 Release Gate 변경, 최적화 구현, 저장소 교체, Prompt 재설계, 실행 모델
   변경, UI 재설계, 새 기능·provider·Hand 추가가 아니다.

이 일곱 줄 중 하나라도 Git source·실제 실행·기계 evidence에서 확인되지 않으면 3차 구현을 시작하지 않는다.

### S3-A 출발 관측값

다음 값은 목표나 runtime cap이 아니라 현재 source와 evidence에서 다시 확인한 출발 관측값이다.

```text
core 889/889 · product integration 142/142 · mutation 2/2 killed
refoundation/src/console-server.js 3,698 lines
기본 console instructions 24,262 UTF-8 bytes · 약 5,770 tokens(4 chars/token 단순 환산)
실제 장기 checkpoint 표본 model calls 6
```

검사 수·코드 줄·단순 token 환산은 성과가 아니며, S3-A 동일 목적 A/B의 실제 provider usage·request bytes·
wall·품질을 대신하지 않는다. 근거는 `T5-SECOND-COMPLETION.md`,
`refoundation/evidence/release-0.2.1-isolation-hardening-2026-08-26.json`, 현재 source와
`refoundation/evidence/c1-repeated-restart-checkpoint-live.json`이다.

## 4. S3-A — Performance Truth만 먼저 연다

S3-A의 유일한 질문은 다음과 같다.

> 사용자가 기다리는 시간은 어느 실제 경계에서 발생하며, Session 길이·resident 상태·background activity·
> 모델 조건이 그 경계를 얼마나 바꾸는가?

S3-A는 최적화 Gate가 아니라 관측 Gate다. 코드 변경 전에 단순 대화·짧은 도구, 파일 탐색, 대량 파일,
복합 문서, Telegram, Notion, 실행 중 입력, Automation, 장기 Conversation·checkpoint, Memory·Learning의 열 개
제품 영역 coverage와 oracle을 먼저 고정한다. 열 영역은 같은 수의 시험을 만들거나 모든 조건을 완전 교차하라는
뜻이 아니다. 기존 증거를 먼저 재사용하고 positive control과 실패 가능성이 큰 최소 대표 여정을 실행한 뒤,
차이가 확인된 축만 반복·모델·조건을 확대한다. 구조 후보의 장단점을 논의할 수는 있지만 구현 후보를 성공으로
간주하지 않는다. 측정 전 예상, 측정값, 직접 귀속, 같은 scope의 동반 시간, A/B로 증명한 인과 증분을 각각
분리한다.

상세 실행 계약과 합격식은
`docs/03-verification/T5-S3-A-PERFORMANCE-TRUTH-WORK-ORDER-2026-08-26-ko.md`가 담당한다.

### Terminal-first 중심 가설

오너가 활성화한 중심 가설은 다음이다.

> T5에 연결된 모델이 명령·출력·process·파일 변화를 하나의 연속된 Terminal 세계로 직접 관측하고
> 복구할수록 나머지 컴퓨터 능력도 더 적은 사용자 개입과 왕복으로 발휘된다.

이는 Terminal-only나 무제한 host access를 뜻하지 않는다. 현재 S3-A에서는 같은 사용자 목적에서
환경 현실·비밀 confinement·effect 선언 비용·출력 recall·process continuity의 현재 사실만 측정한다.
Codex의 unified exec, OpenClaw의 process registry, Hermes의 terminal/process, OpenHands의
action/observation에서 실제로 막은 실패를 반대시험으로 옮기되 source를 복사하지 않는다. 제품 hot path
변경은 이 관측과 오너의 다음 한 작업 선택 뒤에만 연다.

### S3-T1A — Login shell isolation repair

S3-T0 결정적 fixture에서 설정한 격리 HOME이 POSIX `-lc` 초기화 뒤 실제 사용자 HOME으로 바뀌고,
일반 문서뿐 아니라 `.ssh`·CLI credential fixture도 `observe` 명령으로 읽히는 직접 결함을 확인했다.
오너의 Terminal-first 개발 활성화에 따라 이 결함 하나만 S3-A 중 좁은 보안 수리로 연다.

```text
trusted login-shell capture → 비밀 없는 PATH 사실만 추출
model command execution → non-login shell + exact configured HOME
capture 실패 → 현재 safe process PATH로 degraded fallback
```

사용자 shell startup 원문·alias·function·비밀 env를 모델 Context나 trace에 넣지 않는다. Windows는 현재
`-NoProfile` 경계를 유지하고, macOS 구현을 Core identity로 만들지 않는다. 이 수리는 SQLite·Prompt·Actor·
Outbox·Completion·Terminal Session Driver·effect schema 축소를 열지 않는다.

완료 문장:

> 격리 실행은 실제 사용자 HOME·startup secret을 읽지 않고, 일반 제품 실행은 사용자의 안전한 CLI PATH를
> 유지하며, 같은 명령·출력·effect·surface 계약을 보존한다.

## 5. S3-A 전 절대 금지선

S3-A 결과와 오너 판정 전에는 다음을 구현하지 않는다.

- 현재 JSONL/event source를 대체하거나 이중 기록하는 **새 SQLite 제품 저장 구조**
- stable/dynamic/tool/runtime 층 등을 전제로 한 **Prompt 구조 분해 또는 재조립**
- Session·Work·Run을 mailbox 실행 단위로 바꾸는 **Actor 구조**
- effect·delivery·publication을 새 전송 원장에 넣는 **Outbox 구조**
- model result·verification·publication을 새 단일 객체로 묶는 **Completion Envelope**
- 위 구조를 정당화하기 위한 migration, dependency, schema, compatibility adapter, feature flag, dead code
- 측정값 없이 정하는 fixed timeout·queue width·cache size·batch size·replay 상한

현재 제품에 이미 존재하는 WorkStore, append-only ledger, ContextReceipt, completion proposal, result publication
사건은 유지한다. 이름이 비슷하다는 이유로 기존 계약을 금지 대상으로 오판하지 않되, 이를 위 후보 구조로
확장·개명·이중화하지 않는다. 기존 연결 상태용 SQLite 사용 여부도 S3-A가 새 저장소 전환을 허가한다는 뜻이
아니다.

금지선 위반은 성능 개선 여부와 무관하게 S3-A 실패다. 발견 즉시 변경을 중단하고 해당 diff를 S3-A
evidence에서 제외한 뒤 공식 Release source가 변하지 않았는지 다시 확인한다.

## 6. S3-A가 보존해야 할 제품 불변식

- 사용자 요청·모델 입력·도구 목록·권한 판정·실행 args·효과·검증·사용자 답의 의미를 계측이 바꾸지 않는다.
- 계측 event와 통계는 모델 Context, tool result, 기본 사용자 surface에 들어가지 않는다.
- prompt·tool args/result·사용자 원문·비밀값을 성능 trace에 복제하지 않는다.
- 요청·허용·실행·로컬 효과·외부 효과·목적 달성을 하나의 `success`로 합치지 않는다.
- 병렬·겹침 span을 단순 합산해 wall time이나 critical path로 보고하지 않는다.
- provider가 공개하지 않은 queue·prefill·decode 경계는 추정값으로 채우지 않고 `unknown`으로 둔다.
- 계측 실패는 사용자 작업을 실패시키거나 성공 답을 바꾸지 않는다.
- S3-A 전용 fixture는 격리 HOME·DATA·WORKSPACE와 loopback 외부 효과만 사용한다.

## 7. 활성화 판정에 필요한 증거

S3-A 완료 주장은 최소 다음 기계 자료를 한 evidence index로 가리켜야 한다.

```text
matrix manifest와 고정 fixture digest
환경·model·provider·build identity
content-free raw span trace와 clock 정보
실제로 확대한 matched condition별 표본·분포·unknown 비율
critical-path와 overlap 판정
background on-off paired delta
observer off-on paired 반대시험
제품 비개입 digest 대조
실패·제외·재실행 사유
후보 구조별 관측 근거 또는 근거 부족
```

통과 조건:

```text
필수 phase의 직접 관측 또는 정직한 unknown
AND 조건별 sample identity와 반복 가능성
AND 계측 on/off에서 제품 input·action·effect·surface 무변경
AND 계측 비용의 wall·CPU·I/O·bytes 상한 실측
AND 어떤 구조 변경도 S3-A 결과로 미리 구현되지 않음
```

S3-A가 특정 병목을 찾지 못하거나 모델/provider 내부 시간이 `unknown`으로 남는 것도 유효한 결과다. 그 경우
구조 구현을 허가하지 않고 더 좁은 관측 한 작업을 제안한다.

## 8. S3-A 뒤에도 자동으로 열리지 않는 것

S3-A 완료는 3차 전체 활성화나 특정 아키텍처 채택이 아니다. 결과 뒤 오너는 사용자 체감, 효과 크기,
정확성·완전성 무회귀, 변경 위험을 보고 다음 한 작업을 별도로 선택한다. SQLite·Prompt 분해·Actor·Outbox·
Completion Envelope는 각각 독립 가설이며 묶음으로 승인되지 않는다.

다음 작업은 S3-A shadow 계측 계약을 반대시험부터 세우는 것이다. 제품 hot path 변경이나 최적화는 아직
다음 작업이 아니다.
