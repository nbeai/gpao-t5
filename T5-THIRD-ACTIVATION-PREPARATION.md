# T5 3차 고도화 — 활성화 전 준비 정본

상태: `OWNER_ACTIVATED_S3A · S3T_PASS_WITH_OBSERVATION · S3M_ACTIVE_UNTOUCHED · S3UX_REGISTERED · S3CA_REGISTERED_IMPLEMENTATION_LOCKED · OPTIMIZATION LOCKED`

현재 공식 Release Gate: `SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER`

현재 공식 Release Gate와 2차 완성의 진행 정본은 계속 `T5-SECOND-COMPLETION.md`가 담당한다. 이 문서는
그 Release 상태는 변경하지 않는다. 오너는 2026-08-26 S3-A 측정선을 활성화하고 Terminal-first 고도화를
`PASS WITH OBSERVATION`으로 닫았으며, Life Continuity는 별도 개발 세션에서 exact Gate 단위로 진행한다. 외부
Capability의 개발자 명시 설치와 자연어 자기확장을 한 엔진으로 다루는 S3-CA는 연구·계획만 등록하고 제품
구현은 S3-A 결과와 오너의 명시적 개통 전까지 잠근다. 2.0 설치본 실제 사용자가 확인한 장기 작업의 불안·
교정·결과 전달·효과 사고 가족은 S3-UX 연구 입력과 기존 S3-A coverage에 비식별로 등록하되, 진행 중인 S3-M
문서·source·시험은 이 반영에서 변경하지 않는다. 이 문서는 측정·반대시험·판정의 범위와 최적화 전 금지선을
유지한다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은 `AGENTS.md`가 우선한다.

## 1. 활성화 전 판정

```text
2차 Release Gate: 변경 없음
3차 개발선: S3-A 측정 활성 · S3-T 완료 · S3-M 별도 진행 · S3-UX 연구 등록 · S3-CA 연구 등록/구현 잠금 · S3-PW 대기
현재 허용 작업: S3-A 측정·판정, 오너가 연 exact 한 Gate, S3-UX/S3-CA 실제 실패·완료 문장·반대시험의 제품 변경 0 연구
현재 금지 작업: 측정 결과를 전제한 구조 변경·성능 최적화, S3-UX/CA 제품 hot path 선구현, 여러 큰 개발선 동시 개통
```

서명 identity 부재라는 Release 외부 blocker를 3차 소스 변경으로 해결한 것처럼 기록하지 않는다. 반대로
S3-A 준비가 Release package의 서명·공증 완료 조건을 대신하지도 않는다. Release 작업과 S3-A는 서로 다른
scope·evidence·판정을 유지한다.

### 현재 개발선 등록부

이 표는 새 정본이 아니라 이 문서가 소유하는 현재 상태 index다. 각 상세 계약과 evidence는 해당 개발선의
기존 문서·source를 가리키며 같은 사실을 반복하지 않는다.

| 개발선 | 소유 책임 | 현재 상태 |
|---|---|---|
| S3-A | 실제 사용자 목적의 phase·critical path·observer effect | 활성 · 미완료 |
| S3-T | 모델과 Terminal의 환경·process·PTY·출력 recall·플랫폼 실행 | `PASS WITH OBSERVATION` · 완료 |
| S3-M | Life Continuity·Memory Stewardship·내부 Reflection/Principle/Skill | 별도 개발 세션 진행 · 이 반영에서 변경 0 |
| S3-UX | Work Reality·교정/취소/복구·인간용 Receipt·Artifact/Effect 안심 | 설치본 실패 등록 · 제품 구현 미개통 |
| S3-CA | Capability Reality·개발자 확장 설치·자연어 안전 획득·lifecycle | 연구 승인 · 제품 구현 잠금 |
| S3-PW | Windows installer·app shell·공통 제품 자격 | 대기 |

개발선 표는 일정표가 아니다. S3-A 뒤 구조가 자동 개통되지 않으며, 오너가 연 한 제품 개발선만 hot path를
변경한다. S3-M6는 내부 학습 Skill만, S3-CA는 외부 Skill·MCP·CLI·Plugin 획득만 소유한다. S3-UX는 기존
Run·Tool·Effect·Artifact truth의 인간용 projection과 통제 표면을 소유하며 모델 의미 판단이나 새 원장을
소유하지 않는다.

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

현재 Terminal 개발선은 commit `9c96d9fbc2db9e950ebc4cb73ff5653fa55d35fb`와
`refoundation/evidence/s3-terminal-windows-github-qualification-2026-08-26.json`을 기준으로
`PASS WITH OBSERVATION` 종료했다. 아래 T1A·T1B·T2A는 그 결론에 이른 단계별 결함과 수리 기록이며 현재
Terminal 상태를 되돌리지 않는다. physical Windows UI 인간 자격·Windows sandbox-first·Windows ARM64 실제
실행·signed installer는 완료 범위 밖 관측으로 유지한다.

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

### S3-T1B — Secret confinement candidate

제품 배선 전 결정적 macOS fixture에서 다음 두 조건을 함께 자격화했다.

```text
generic Terminal: normal file read 가능 · canonical secret root read 차단 · Keychain CLI exec 차단
brokered CLI: 등록 action만 실행 · 내부 secret 사용 가능 · stdout/stderr exact secret redaction
```

첫 Seatbelt 표본은 `/var/...` secret root가 실제 `/private/var/...` identity와 달라 차단을 우회했다. secret
root를 실행 전 `realpath`로 결속하고 결속 실패를 열린 실행으로 낮추지 않은 뒤 실제 표본이 통과했다.
candidate 자격 뒤 `TerminalPlatformAdapter`를 제품에 연결해 macOS generic Terminal에서 T5 credential roots의
직접 read와 `/usr/bin/security` 실행을 차단했다. 일반 파일·일반 CLI·PTY·process는 유지한다. 개인 `.ssh`와
third-party CLI credential roots는 broker 없이 막지 않는다. Windows는 아직 미자격 passthrough 사실을
receipt에 남기며 GitHub Windows runner와 격리 Windows VM에서 별도로 자격한다. Linux는 제품 목표가 아니며
비대상 passthrough 사실만 유지한다. 따라서 전체 secret confinement나 Windows 자격 완료가 아니다.
근거: `refoundation/evidence/s3-t1b-secret-confinement-candidate-2026-08-26.json`,
`refoundation/evidence/s3-t1b-product-confinement-2026-08-26.json`.

registered CLI broker의 제품 계약은 exact executable·단일 foreground action·direct argv·secret redaction·
content-free receipt로 세웠다. compound shell과 미등록 action은 generic Terminal fallback으로 우회하지 않는다.
아직 실제 사용자 credential capability를 등록하지 않았으므로 사용 가능한 authenticated CLI가 늘었다고
주장하지 않는다. 다음 실제 CLI는 사용자 수요와 공식 CLI 계약을 특정한 별도 자격 뒤에만 등록한다.

### S3-T2A — Foreground output exact recall

잘린 foreground stdout·stderr는 process record를 지우기 전에 Session·Run 소유의 0600 object로 보존한다.
모델은 계속 작은 head/tail과 생략량만 받고, 잘린 결과가 실제로 생긴 다음 턴에만 `terminal_output` schema가
활성화된다. exact handle·stream·offset으로 bounded range를 읽으며 원래 command를 재실행하지 않는다.
다른 Session handle은 404로 닫고 재시작 뒤에도 같은 range를 읽는다. 전체 출력 보존기간·disk 회전과
generic personal secret output 분류는 아직 미완료이며, 무한 보존을 약속하지 않는다.

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

S3-A에서 다음 작업을 열 때는 shadow 계측 계약을 반대시험부터 세운다. 이 문장은 이미 별도로 개통된 S3-M의
현재 exact Gate를 되돌리거나 S3-CA 구현을 자동 개통하지 않는다. 제품 hot path 변경이나 최적화는 각 개발선의
오너 개통과 실제 증거 없이 다음 작업이 아니다.

## 9. S3-UX — Work Visibility, Control & Outcome Reassurance 등록 계약

S3-UX는 UI 재디자인이나 모델 사고 원문 공개가 아니다. 2.0 설치본 실제 사용자가 복잡한 프로그램 분석·
Notion 결과 품질은 높게 평가하면서도 장기 작업 중 무엇이 진행되는지 알 수 없어 불안했고, 자연어 교정·취소·
복구·이미지 전달·파일 효과 사고에서 통제권을 잃은 실제 실패를 기존 truth에서 인간이 이해할 projection으로
닫는 개발선이다. 원본 피드백의 사람·경로·비밀·실제 파일은 저장소에 복제하지 않고 다음 비식별 실패 가족과
positive control만 사용한다.

```text
F1 장기 Work의 완료 milestone·현재 활동·새 Evidence·기다림이 보이지 않음
F2 자연어 교정·취소가 즉시 결속되지 않고 회복권이 늦거나 같은 실패 surface가 반복됨
F3 요청한 이미지·기존 파일이 실제 Artifact bytes가 아니라 URL·깨진 preview·불필요한 변환으로 전달됨
F4 대량 파일 effect 뒤 mode·ACL·flags·openability·원인·rollback의 forensic truth가 부족함
F5 현재 목적보다 후속 산출을 먼저 실행하고 managed temporary·결과 이름·정리가 Work와 분리됨
F6 provider/resource terminal 뒤 보존 상태와 가능한 다음 route가 사용자에게 이어지지 않음

P1 실제 프로그램·테스트·API 분석과 외부 문서 반영의 높은 결과 품질
P2 불명확한 로컬 파일을 여러 관측 route로 찾아 실제 내용 확인
P3 없는 사실을 없다고 기록하고 기만적 문서 변조를 거절
```

S3-UX는 F1~F6을 줄이면서 P1~P3를 보존해야 한다. 특정 한국어 문장·서비스·폴더·이미지 검색어를 제품 규칙이나
prompt few-shot으로 추가하지 않는다.

### 사용자 완료 문장

> 시간이 오래 걸리는 작업에서도 사용자는 T5가 실제로 완료한 단계, 현재 진행 중인 일, 새로 확인한 결과,
> 기다리는 현실, 사용자 행동이 필요한 경계와 현재까지 보존된 상태를 이해한다. 언제든 평소 말이나 멈춤
> 표면으로 교정·취소·재개할 수 있고, 결과가 파일·이미지·외부 효과라면 사용자가 실제로 열고 확인할 형태로
> 전달된다. 내부 사고·prompt·원문 검색어·명령·비밀·민감 경로·Run/Tool ID는 노출하지 않는다.

### 세 제품 Gate

#### S3-UX1 — Work Reality & Control

기존 Run·model·tool·process·Evidence·approval·capability·surface 사건에서 의미 있는 완료 milestone과 현재
활동을 순서대로 projection한다. 정확한 전체 단계 수를 모르면 percentage·ETA를 만들지 않는다. elapsed는
클라이언트가 계산하고 heartbeat를 원장에 누적하지 않는다. Session 이동·재시작 뒤 같은 Work 현실을 복원하며,
자연어 교정·취소와 버튼 cancel은 같은 durable admission·process settlement·surface 결과로 이어진다.

#### S3-UX2 — Human Receipt & Artifact Hygiene

사용한 능력, 실제 생성·수정·전달한 결과, 검증 상태와 복원 가능성을 일반 사용자 언어로 접을 수 있는 표면에
보인다. raw command는 개발자 상세에서만 exact Receipt로 접근한다. 이미지·문서·기존 로컬 파일은 실제 bytes·
MIME·decode/reopen·hash·Attachment/Artifact publication이 선 뒤에만 전달됐다고 표시한다.

파일은 Work source·temporary·verification artifact·final artifact·published copy·trash/rollback으로 구분하고,
사람이 이해할 이름과 source Work를 가진다. 취소·실패 뒤 temporary를 사용자 폴더에 흩어 두지 않으며 최종
결과만 사용자 공간에 publication한다.

#### S3-UX3 — Effect Forensics & Recovery

대량 이동·권한·설정·package 작업은 실행 전후의 exact target identity와 가능한 mode·ACL·flags·ownership·
content/entry count·사용자 openability를 분리 관측한다. 한 move log에 명령이 없다는 이유로 전체 사고 원인을
배제하지 않고, 관측하지 않은 원인은 `unknown`으로 둔다. recovery는 이전 상태·실행 diff·reverse plan·실제
rollback Receipt를 사용하며 광범위한 chmod·재이동을 원인 확인 없이 덧붙이지 않는다.

### S3-A·Terminal·CA·PW 접합

- S3-A는 F1~F6을 기존 S2·S3·S4·S5 대표 여정에 흡수해 first meaningful milestone, longest invisible interval,
  cancel-to-stop, recovery visible, artifact/effect verification을 측정한다. 대표 여정 수를 늘리거나 trace를
  사용자 surface에 직접 노출하지 않는다.
- S3-T는 완료된 process·PTY·output recall·platform execution 기반으로 유지하며 S3-UX 때문에 재개하지 않는다.
- S3-CA는 기능이 존재하지만 degraded인 상태와 실제 부재를 구분하고, 안전한 Secret Input·Capability 연결과
  실제 이미지/Artifact route를 같은 Work에 제공한다.
- S3-PW는 macOS·Windows application icon·secret input·Finder/Explorer open·Activity/Receipt 표면의 동일 사용자
  계약을 최종 제품 자격에서 확인한다.

S3-UX 구현은 진행 중인 S3-M exact qualification과 동시에 제품 hot path를 바꾸지 않는다. S3-M source·계획·
시험은 이 개발선 등록에서 변경하지 않으며, 현재 exact M 작업의 commit/evidence가 닫힌 뒤 오너가 S3-UX의
한 Gate를 명시적으로 연다.

## 10. S3-CA — Capability Reality & Safe Acquisition 등록 계약

S3-CA는 Plugin 관리 화면이나 새 marketplace가 아니다. `T5-PRODUCT.md`가 이미 약속한 다음 생명주기를
개발자 명시 설치와 일반 사용자 자연어 요청에서 한 acquisition·qualification·lifecycle로 완성하는 개발선이다.

```text
사용자 목적 → 현재 현실·능력 확인 → 부족한 능력 판단 → 검증된 후보 발견
→ 출처·권한·비용·적합성 확인 → 필요한 능력만 준비 → 원래 목적 재개
→ 실제 결과 검증 → 개선·교체·비활성·제거 → 필요하면 복원
```

### 사용자 완료 문장

> 개발자는 local·Git exact ref·registry·remote MCP source를 명시해 외부 확장을 inspect·설치·활성·비활성·
> update·제거·rollback할 수 있다. 일반 사용자는 확장 형식을 몰라도 평소 말로 목적을 설명하면 T5가 지금
> 가능한 일과 부족한 능력·사용자 행동이 필요한 경계·아직 불확실한 부분을 빠르게 구분하고, 가장 가벼운
> 대안을 조사·검증·준비해 같은 Work를 정확히 한 번 재개하고 실제 목적 달성까지 확인한다.

설치 성공, runtime 등록, 모델 노출, 실제 호출, 사용자 목적 달성은 하나의 `success`로 합치지 않는다.
개발자 표면과 자연어 표면은 같은 source identity·qualification·install record·activation generation·rollback을
사용한다.

### 네 제품 Gate

#### S3-CA1 — Capability Reality & Package Contract

현재 설치·연결·권한·실측에서 기계적으로 확인된 `usable_now·available_inactive·needs_auth·degraded·preparable·
unknown·incompatible` 사실만 작게 제공한다. 모델은 사용자 목적과 이 현실을 보고 필요한 능력과 대안을
판단한다. Runtime은 서비스 이름·사용자 표현·키워드 규칙으로 의미를 선택하지 않는다.

실제 반대시험은 제품에 이미지 delivery Hand가 있으나 현재 provider route만 degraded인 상태를 전체 기능 부재로
승격하지 않고, existing bytes→decode→Attachment route와 새 외부 capability 필요를 구분해야 한다. 반대로 실제
runtime·credential·platform이 없는 후보는 설명이나 설치 record만으로 `usable_now`가 될 수 없다.

외부 package는 source·resolved version/commit·artifact digest·kind·platform·entrypoint·필요한 비밀·파일·
network·effect·install/update/remove 전략을 선언한다. 하나의 고정 `trustLevel`로 자동 실행을 결정하지 않고,
publisher/namespace identity·immutable ref·signature/attestation·license·실행 코드·권한·실제 qualification을
독립 Evidence로 보존한다.

#### S3-CA2 — Developer Extension Surface

결정적 positive control로 개발자 명시 설치를 먼저 닫는다. 첫 지원 종류는 Agent Skill, remote/local MCP,
managed CLI, 별도 process로 격리한 executable extension, 선언형 T5 package다. local directory·Git exact ref·
registry package·remote MCP URL을 같은 coordinator로 inspect·install·enable/disable·update·uninstall·rollback한다.

비밀이 필요한 extension은 모델·Conversation·일반 Terminal·임시 `.command` 파일을 입력면으로 사용하지 않는다.
사용자 통제 Secret Input이 원문을 platform Keychain/DPAPI owner에 직접 저장하고, provider/account identity와 실제
permission probe가 성립한 뒤에만 ready generation을 연다. 이미 연결된 OAuth와 별도 API worker identity를 같은
연결로 합치지 않는다.

Codex·Claude·OpenClaw bundle 전체 호환을 약속하지 않는다. Agent Skills·MCP 같은 공개 표준과 선언적으로
정규화 가능한 구성만 adapter로 수용한다. 임의 JavaScript·Python lifecycle hook을 서명된 T5 Core process에
직접 load하는 경로는 첫 완료 범위에서 제외한다.

#### S3-CA3 — Qualification & Lifecycle

후보는 source identity·exact commit/version/hash·license·dependency/install script·prompt injection·OS/architecture·
filesystem/network/secret/external effect·격리 fixture·동일 사용자 목적·제거/복원·Context/오류 비밀 노출을
분리해 확인한다. Scanner·별점·다운로드 수·공식 Registry 존재·Skill의 `allowed-tools` 선언 하나는 합격이 아니다.

Capability 준비 성공과 사용자 전달 성공도 분리한다. 이미지·문서·기존 파일을 제공하는 후보는 실제 bytes·
MIME·decode/reopen·hash·Artifact/Attachment surface까지 동일 사용자 목적에서 확인하며, URL·Markdown·깨진 HTML
preview를 결과 전달로 승격하지 않는다.

```text
candidate → quarantined → structurally_checked → task_qualified
→ installed_inactive → current scope active → actual purpose verified → reusable
```

새 version·commit은 기존 동의를 자동 상속하지 않는다. 기존 검증본을 유지한 채 새 identity를 격리 자격하고,
통과한 generation만 교체한다. 실패·취소·crash는 부분 설치를 활성 상태로 남기지 않는다.

사용자가 이미 되돌릴 수 있는 managed 설치와 목적 수행을 요청했다면 source가 공개 웹이라는 이유만으로
반복 승인하지 않는다. 비밀값 입력·백업 없는 파괴·새 상대 첫 외부 전송·돈이 나가는 일에서 멈추며, T5
관리 영역 밖의 전역 설치·관리자 권한·Core in-process 실행처럼 목적 범위를 실질적으로 넓히는 후보는 가장
가까운 격리 대안을 먼저 제시하고 새 방향이 필요할 때 사용자에게 설명한다.

#### S3-CA4 — Natural-Language Acquisition & Work Resume

주 모델은 현재 목적·Capability Reality·후보 Evidence를 보고 `지금 실행·준비·사용자 경계·추가 조사·안전한
방법 없음`을 판단한다. 별도 intent classifier·한국어 키워드·고정 서비스 mapping을 만들지 않는다. 준비가
필요하면 CA2~3의 같은 엔진을 사용하고, exact Work/revision을 잃지 않은 채 현재 scope에만 능력을 활성화해
한 번 재개한다. 설치만 성공하고 원래 목적이 실패하면 Work는 achieved가 아니다.

### 속도·Context·경제성 계약

평상시 hot path에는 작은 Capability Reality와 현재 활성 Hand만 둔다. 이미 가능한 요청에는 외부 후보 검색을
열지 않고, catalog 전체·비활성 schema·Skill 본문·scanner 결과를 모델 Context에 넣지 않는다. 부족함이 확인된
뒤 local/cached catalog, 외부 registry·웹, 상세 source 조사, 격리 qualification 순으로 필요한 단계만 연다.

qualification cache는 source·resolved commit/version·artifact digest·OS/architecture·T5 policy·fixture identity가
모두 같을 때만 재사용한다. 독립적인 provenance·license·platform·advisory 확인은 안전할 때 병렬화하되 build·
실행·외부 효과·activation은 실제 상태 전이를 보존한다. 별도 auxiliary model을 상시 호출하지 않고, 주 모델이
이미 이해한 목적에서 검색 요구를 만들며 후보 문서 비교가 실제로 필요할 때만 모델 판단을 추가한다.

S3-CA의 합격은 동일 사용자 목적 A/B에서 false `can_do`·false `cannot_do`, capability 판정까지의 wall, 추가
model/tool calls, request bytes·tokens, qualification 재사용, install-to-purpose wall, 사용자 교정·승인 부담을
함께 본다. 측정 전 fixed 후보 수·검색 횟수·timeout·Context quota를 제품 정책으로 만들지 않는다.

### 개발 순서와 종합 Release 의존성

```text
S3-A 결과·오너 개통
→ CA1 Capability Reality
→ CA2 개발자 명시 설치 positive control
→ CA3 격리 qualification·lifecycle
→ CA4 자연어 gap·획득·exact Work 재개
→ macOS·Windows Terra·gpt-5.5 인간 종단과 비교 A/B
```

S3-CA 연구 등록은 S3-M hot path 병행 개통을 뜻하지 않는다. 현재 제품 개발선은 오너가 연 한 작업만 진행한다.
S3-M6는 CA capability의 usage outcome pointer를 Reflection Evidence로 참고할 수 있지만 외부 설치·update·rollback을
수행하지 않는다. S3-CA는 사용자 Memory·Reflection·Principle을 저장하거나 의미 선택하지 않는다.

3차 종합 완료는 각 개발선의 독립 PASS와 최종 사용자 목적 교차 자격을 요구한다.

```text
S3-A Performance Truth
AND S3-T Terminal exact close
AND S3-M Life Continuity
AND S3-UX Work Visibility, Control & Outcome Reassurance
AND S3-CA Capability Reality & Safe Acquisition
AND S3-PW가 필요한 Windows 공통 자격
AND macOS·Windows 실제 사용자·비교군 Release
```

S3-CA의 다음 작업은 제품 코드가 아니라, 현재 능력으로 끝나는 positive control 하나와 미등록 외부 능력이
필요한 실제 사용자 실패 하나의 목적·원본·종료점·비목표를 고정하는 것이다.
