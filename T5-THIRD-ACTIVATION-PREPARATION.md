# T5 3차 고도화 — 활성화 전 준비 정본

상태: `S3A_PASS_WITH_OBSERVATION · S3_SCOPE_FROZEN · S3T_PASS_WITH_OBSERVATION · S3M_PASS_WITH_OBSERVATION · S3UX_PASS_WITH_OBSERVATION · S3CA_OWNER_OPENED_SEQUENCED · S3CH0_COMPLETE_CH1_ACTIVE · S3VD_CORE_PASS_WITH_OBSERVATION · OPTIMIZATION LOCKED`

현재 공식 Release Gate: `SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER`

현재 공식 Release Gate와 2차 완성의 진행 정본은 계속 `T5-SECOND-COMPLETION.md`가 담당한다. 이 문서는
그 Release 상태는 변경하지 않는다. 오너는 2026-08-26 S3-A 측정선을 활성화하고 Terminal-first 고도화를
`PASS WITH OBSERVATION`으로 닫았으며, Life Continuity는 commit `80dc0305`에서
`PASS WITH OBSERVATION · default off`로 닫았다. 오너가 2026-08-27 개통한 S3-UX1→UX2→UX3→CH-0은
commit `fbba29e7`과 evidence `s3-ux-live-qualification-2026-08-27.json`에서
`PASS WITH OBSERVATION`으로 닫았다. 외부
S3-A는 evidence `s3-a-performance-truth-close-2026-08-27.json`에서 `PASS WITH OBSERVATION`으로 닫았다.
오너는 S3-CH와 S3-CA 구현을 함께 승인했지만 hot path를 동시에 열지 않으며, CH-1→2→3을 순차 자격한 뒤
CA-1→2→3→4를 순차 자격한다. 2.0 설치본 실제 사용자가 확인한 장기 작업의 불안·
교정·결과 전달·효과 사고 가족은 S3-UX 연구 입력과 기존 S3-A coverage에 비식별로 등록하되, 진행 중인 S3-M
문서·source·시험은 이 반영에서 변경하지 않는다. Local Computer History는 CH-0 T5 Work History만 S3-UX에
결속하고 파일·앱·목적별 검색 CH-1~3은 3차의 후속 개발 순서로 확정하되 현재 진행 중인 M·UX보다 먼저
collector를 얹지 않는다. 이 문서는 측정·반대시험·판정의 범위와 최적화 전 금지선을
유지한다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은 `AGENTS.md`가 우선한다.

오너는 2026-08-27 현재 이 문서에 등록된 S3-A·T·M·UX·CA·CH·VD·PW와 종료 Gate인 S3-WA·HQ까지만
3차 완성 범위로 동결했다. 새 기능·새 개발선·새 최적화 축을 3차에 더 추가하지 않는다. 이후 발견되는 좋은
아이디어와 비핵심 관측은 현재 범위를 넓히지 않고 3차 종료 뒤 별도 후속 후보로 남긴다. 등록된 각 기술선의
완료 문장, S3-WA 전체 배선 감사, S3-HQ 내부 인간 자격이 모두 닫히면 3차를 완료하고 종료한다.

## 1. 활성화 전 판정

```text
2차 Release Gate: 변경 없음
3차 개발선: S3-A 완료 · S3-T 완료 · S3-M 완료(default off) · S3-UX/CH-0 완료 · S3-CH1 활성 · S3-CH2~3 순차 대기 · S3-CA 오너 개통/CH3 뒤 CA1 활성 예정 · S3-VD Core 완료 · S3-PW 대기
현재 허용 작업: S3-CH1→2→3 exact 순차 구현·자격, 뒤이은 S3-CA1→2→3→4 exact 순차 구현·자격, 완료선 관측 입력 정리
현재 금지 작업: 측정 결과를 전제한 구조 변경·성능 최적화, S3-UX/CA/VD 제품 hot path 선구현, UX/CH-0 전 CH-1 collector 선행, screen/audio/content capture, 여러 큰 개발선 동시 개통, 새 3차 개발선·기능 범위 추가
```

서명 identity 부재라는 Release 외부 blocker를 3차 소스 변경으로 해결한 것처럼 기록하지 않는다. 반대로
S3-A 준비가 Release package의 서명·공증 완료 조건을 대신하지도 않는다. Release 작업과 S3-A는 서로 다른
scope·evidence·판정을 유지한다.

### 현재 개발선 등록부

이 표는 새 정본이 아니라 이 문서가 소유하는 현재 상태 index다. 각 상세 계약과 evidence는 해당 개발선의
기존 문서·source를 가리키며 같은 사실을 반복하지 않는다.

| 개발선 | 소유 책임 | 현재 상태 |
|---|---|---|
| S3-A | 실제 사용자 목적의 phase·critical path·observer effect | `PASS WITH OBSERVATION` · 완료 |
| S3-T | 모델과 Terminal의 환경·process·PTY·출력 recall·플랫폼 실행 | `PASS WITH OBSERVATION` · 완료 |
| S3-M | Life Continuity·Memory Stewardship·내부 Reflection/Principle/Skill | `PASS WITH OBSERVATION` · default off · 완료 evidence `80dc0305` |
| S3-UX | Work Reality·교정/취소/복구·인간용 Receipt·Artifact/Effect 안심 | `PASS WITH OBSERVATION` · UX1→UX3·CH-0 완료 |
| S3-CA | Capability Reality·개발자 확장 설치·자연어 안전 획득·lifecycle | 오너 개통 · CH-3 뒤 CA-1→4 순차 구현 대기 |
| S3-CH | Local Computer History·과거 Work/파일/앱 provenance | CH-0 완료 · CH-1 활성 · CH-2→3 순차 대기 |
| S3-PW | Windows installer·app shell·공통 제품 자격 | 대기 |
| S3-VD | Visual Deliverable Core·출력 표면 선택·렌더 관측·교정·브랜드 파라미터 | Core `PASS WITH OBSERVATION` · Windows/편집형 PPTX/브랜드 인간 패널은 PW·HQ 자격 대기 |
| S3-WA | Whole-product Wiring Audit·3차 부품의 실제 제품 배선·단일 진실·복구 경계 | 3차 기술 개발 완료 뒤 읽기 전용 감사 대기 |
| S3-HQ | 한국 사업자 Human Reality Qualification·외부 테스터 전 내부 인간 자격 | 실행 체계 완료 · 3차 기술 개발 완료 뒤 실행 대기 |

개발선 표는 일정표가 아니다. S3-A 뒤 구조가 자동 개통되지 않으며, 오너가 연 한 제품 개발선만 hot path를
변경한다. S3-M6는 내부 학습 Skill만, S3-CA는 외부 Skill·MCP·CLI·Plugin 획득만 소유한다. S3-UX는 기존
Run·Tool·Effect·Artifact truth의 인간용 projection과 통제 표면을 소유하며 모델 의미 판단이나 새 원장을
소유하지 않는다. S3-CH는 raw activity를 사용자 Memory·persona로 승격하지 않으며 CH-1→2→3의 선행조건과
각 Gate 완료 문장을 지켜 순차 개발한다.

### S3-WA — S3-HQ 전 필수 Whole-product Wiring Audit

S3-WA는 새 기능·리팩터링·완벽화 개발선이 아니다. 각 S3 기술 Gate가 독립적으로 통과한 뒤 실제 제품
진입점부터 사용자 surface까지 서로 연결됐는지 확인하는 일회성 종합 배선 감사다. 진행 중인 개발선의
source가 움직일 때 열지 않고, 3차 기술 개발 완료 기준 commit을 하나 고정한 뒤 시작한다.

다중 에이전트는 다음 책임을 겹치지 않게 읽기 전용으로 조사한다.

```text
실행·진실·정산: 요청→허용→실행→효과→검증→완료→전달
기억·Context·Capability: 실제 import/call graph·source truth·모델 시야·Connection
Work·UX·복구: 교정·취소·crash·restart·장기 작업·Artifact·과거 Work
보안·플랫폼·배포: 비밀·권한·macOS/Windows interface·설치 payload
```

각 발견은 exact 파일·제품 call path·깨지는 사용자 목적·재현 가능한 반대시험을 가져야 한다. 코드 냄새,
스타일, 파일 크기, 더 익숙한 아키텍처라는 이유만으로 결함을 만들지 않는다. 여러 에이전트의 발견은 한
통합 책임자가 중복·전제를 교차 확인하고 다음으로 분리한다.

- **P0/P1 제품 결함**: 실제 사용자 목적·비밀·외부 효과·진실·복구를 깨며 재현됨
- **관측**: 현재 계약은 지키지만 비용·복잡성·플랫폼 자격이 불확실함
- **비채택**: 이론적·스타일성·현재 Gate 밖 개선

감사 중 병렬 제품 수정, 같은 파일 동시 수정, 전면 리팩터링, Prompt 문장 패치, 새 원장·상태 기계·고정
상한 도입을 금지한다. 읽기 전용 감사가 끝난 뒤 P0/P1만 통합 책임자 한 명이 exact 반대시험→최소 수리→
관련 사용자 목적→전체 회귀 순서로 하나씩 닫는다. 같은 결함 가족에 세 번째 patch가 필요하면 수리를
중단하고 본질·원리·구조를 다시 판정한다.

S3-WA 완료 문장:

> 3차 기술 완료 기준 commit에서 네 감사 책임이 실제 제품 import/call graph와 사용자 surface까지 확인됐고,
> 재현된 P0/P1은 순차 수리와 전체 회귀로 닫혔으며, 남은 관측과 비채택은 3차 완료를 거짓으로 만들지 않는
> 이유가 기록됐다. 감사 자체가 제품 행동·Prompt·상태를 바꾸지 않았다.

정확한 순서는 다음이다.

```text
각 S3 기술 개발선의 exact 완료·회귀
→ S3-WA 읽기 전용 다중 에이전트 배선 감사
→ 재현된 P0/P1 순차 수리·전체 회귀
→ developer_fast_feedback
→ pre_tester_reality
→ S3-HQ PASS
→ 외부 인간 테스터
```

### S3-HQ — 3차 완료와 외부 테스터 사이의 필수 Human Reality Gate

S3-HQ는 제품 기능 개발선이 아니라, 각 기술 개발선이 실제 한국 사업자의 목적에서 한 몸으로 작동하는지
외부 테스터의 시간을 쓰기 전에 확인하는 내부 제품 Gate다. 질문 목록이나 기능 smoke가 아니며 다음 세
증거 lane을 함께 사용한다.

```text
실제 테스터·사업자 발화와 공개 이용 사례에 근거한 observed demand
+ 업종·업무를 골고루 다루는 research-derived workflow coverage
+ 미연결·부분 자료·교정·취소·장기 작업의 structural stress
```

증거 강도와 시험 가치는 분리한다. 조사에서 만든 시나리오도 coverage와 반대시험으로 보존하지만 실제 시장
수요라고 주장하지 않는다. 반대로 실제 발화만 모아 현재 알려진 사례에 패치된 제품을 만들지도 않는다.

실행 순서는 다음으로 고정한다.

```text
각 S3 기술 개발선의 exact 완료·회귀와 S3-WA 완료
→ developer_fast_feedback 6개 내부 wave
→ 실패를 제품 구조·Capability/Connection·Fixture/시험·UX·model variance로 판정
→ core 실패를 해당 개발선에서 닫고 영향 wave 재실행
→ pre_tester_reality 16개 내부 wave
→ S3-HQ PASS
→ 외부 인간 테스터와 설치본 평가
```

개발 중인 미완료 기능에 전체 wave를 반복해 시간·token을 쓰지 않는다. 현재 변경이 사용자 목적을 크게
벗어나는지 확인할 필요가 있을 때만 관련 시나리오 1~2개를 선택적으로 사용한다. 전체 wave는 기술 개발 완료
뒤의 종합 자격이며, 외부 테스터가 기본 결함을 찾아주는 디버거가 되게 하지 않는다.

S3-HQ PASS는 다음 논리곱이다.

```text
wave의 모든 scenario 실제 실행
AND scenario별 acceptance 전부 인간 pass/fail 기록
AND 미실행·미평가 0
AND false completion·금지된 외부 효과·내부 기술용어 노출 0
AND 목적·정확성·완결성·사용 난이도·결과 사용성·불확실성 정직성 통과
AND 사용자가 기술 지식을 배워야만 진행되는 경로 0
AND 세 evidence lane 모두 통과
```

`PASS WITH OBSERVATION`은 위 core 조건의 실패를 외부 테스터에게 넘기는 수단이 아니다. 모델별 차이나 특정
Capability 부재처럼 제품 범위 판단이 필요한 관측은 원인과 현재 대안을 보존하되, 사용자 목적의 거짓 완료·
오답·사용 불가·통제 상실은 S3-HQ PASS로 승격하지 않는다.

기계 정본과 실행 도구는 다음을 사용한다.

- `refoundation/config/s3-human-business-scenarios.json`
- `npm run refoundation:plan:business-human -- --wave developer_fast_feedback`
- `npm run refoundation:qualify:business-human -- --scenario <id>`
- `npm run refoundation:summarize:business-human -- --room <isolated-room>`
- `npm run refoundation:summarize:business-human-wave -- --wave <id> --room <room> ...`
- `refoundation/evidence/s3-human-business-qualification-system-2026-08-27.json`

새 현장 사례는 원문 의미·사업 상황·당시 연결과 자료·기대 결과·실제 T5 행동·체감 마찰·사용 가능 결과·
수동 복구·재위임 의사를 비식별로 보존한다. 사례 문장을 바로 제품 Prompt나 규칙으로 옮기지 않고, 여러
업종에서 반복되면 본질·원리·구조 개선으로 환류한다.

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
F2 자연어 교정·취소가 즉시 결속되지 않거나, process는 멈췄어도 Work 실행 claim이 남아 다음 입력이 막힘
F3 요청한 이미지·기존 파일이 실제 Artifact bytes가 아니라 URL·깨진 preview·불필요한 변환·새 identity로 전달됨
F4 대량 파일 effect 뒤 mode·ACL·flags·openability·원인·rollback의 forensic truth가 부족함
F5 현재 목적보다 후속 산출을 먼저 실행하고 managed temporary·원본/결과 이름·정리가 Work와 분리되며
   요청하지 않은 복사본이 사용자 작업공간에 남음
F6 provider/resource terminal 뒤 보존 상태와 가능한 다음 route가 사용자에게 이어지지 않음
F7 내부 상태값·식별자·기계 시각이 한국 일반 사용자 화면에 그대로 나타남

P1 실제 프로그램·테스트·API 분석과 외부 문서 반영의 높은 결과 품질
P2 불명확한 로컬 파일을 여러 관측 route로 찾아 실제 내용 확인
P3 없는 사실을 없다고 기록하고 기만적 문서 변조를 거절
```

S3-UX는 F1~F7을 줄이면서 P1~P3를 보존해야 한다. 특정 한국어 문장·서비스·폴더·이미지 검색어를 제품 규칙이나
prompt few-shot으로 추가하지 않는다.

2026-08-27 격리 라이브 콘솔에서 다음 구조 증거를 확보했다. 로컬 자료 계산·근거 설명, 실행 중 교정,
없는 사실의 정직한 처리, 실제 파일 bytes 전달은 기존 강점으로 재확인했다. 반면 장기 작업은 실제 파일
탐색·계산 중에도 약 40초 이상 일반 진행 문구만 보였고, 장기 process cancel 자체는 정확했으나 다음 입력이
모델에 도달하기 전 남은 execution claim에 막혔다. 기존 파일 전달은 bytes·hash가 맞아도 새 이름의 동일
복사본을 사용자 작업공간에 남겼다. M5 기록 화면은 내부 ID를 제거했지만 `active`와 ISO timestamp 같은
기계 표현이 남았다. 이 문장·파일명·시간 수치는 제품 규칙이 아니라 아래 상태 전이와 projection 반대시험의
출발 증거다.

### 비교군에서 채택한 원리와 채택하지 않는 표면

2026-08-27 OpenClaw `67a310b2`, Hermes `03537d69`, Codex `7625bd56`의 공개 source와 Claude Code의
공식 hooks·interactive 계약을 다시 확인했다. 화면과 용어는 복제하지 않고 다음 검증된 원리만 채택한다.

- **OpenClaw**: task 실행·terminal·delivery 상태 분리, 느린 작업에만 지연된 progress, reconnect 뒤 snapshot
  재동기화, cancel 요청과 실제 terminal 분리, progress의 모델 Context 비주입.
- **Hermes**: run lifecycle SSE, steer의 queued·consumed 분리, 너무 늦어 소비되지 않은 steer의 terminal 보존,
  `stopping`을 non-terminal로 유지, reconnect event replay.
- **Codex**: command begin/end correlation, 출력 delta, plan update, pending steer·rejected steer·queued follow-up의
  사용자 가시성, elapsed와 interrupt의 지속 표면.
- **Claude Code**: 작은 task list, compaction 뒤 task 지속, 자리를 비웠다 돌아왔을 때 한 줄 recap, 사용자 행동이
  필요할 때만 notification.

기본 사용자에게 raw command·tool log·reasoning 제목·Run ID·개발자 task board를 노출하지 않는다. utility model로
상시 상태 문구를 만들거나 Hook·별도 classifier를 UX truth의 정본으로 쓰지 않는다. 비교군의 fixed timeout·task
count·background permission 정책도 T5 제품 규칙으로 복제하지 않는다.

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

##### UX1-A — Reality Projection

첫 사용자 표면은 두 출처를 섞지 않고 결합한다.

```text
모델의 짧은 preamble/commentary
  = 현재 목적을 어떻게 이해했고 무엇부터 확인할지 자연스럽게 설명

런타임의 grounded milestone
  = 실제 Run·Tool·Process·Evidence·Artifact·Approval 사건이 바뀐 뒤에만 표시
```

모델 preamble은 별도 model call로 만들지 않고 현재 응답의 commentary phase를 사용한다. Runtime milestone은
모델이 다시 읽는 Conversation·Context·ToolReceipt에 넣지 않는 content-free UI projection이다. 모델 문장이
“확인했다”고 말해도 대응하는 실행 사실이 없으면 milestone으로 승격하지 않으며, 런타임은 목적·계획 문장을
정규식이나 tool-name phrase table로 저작하지 않는다.

진행 표면은 문구 순환기가 아니다. canonical 실행 사건을 다음 최소 사실로 투영한다.

```text
현재 목적
+ 마지막으로 완료·확인한 의미 있는 단계
+ 지금 실제로 실행·검증·대기 중인 종류
+ 새 Evidence가 생긴 시각 또는 변화 없는 기다림
+ 사용자 행동이 필요한 정확한 경계
```

파일명·명령·검색어·내부 ID를 그대로 보여주지 않더라도 `자료를 찾는 중 → 필요한 자료를 확인함 → 계산·검증
중`처럼 현실이 바뀐 사실은 구분한다. 관측 가능한 새 사건이 있는데도 일반적인 “생각 중” 문구 하나로 전체
구간을 덮으면 실패다. 새 사건이 없으면 같은 단계의 elapsed만 갱신하고 일을 더 한 것처럼 표현하지 않는다.

모든 사건을 보여주지 않는다. 다음 중 하나가 실제로 변할 때만 현재 활동을 교체한다.

```text
의미 있는 단계 완료
새 Evidence 확보
실행 ↔ 검증 ↔ publication ↔ 외부/자식 대기 전환
승인·로그인·비밀 입력·선택 등 사용자 행동 필요
실패·degraded·unknown·복구 가능성 변화
```

짧은 작업은 진행 panel 없이 바로 결과로 끝날 수 있다. 같은 poll·heartbeat·동일 상태는 문구를 새로 만들지
않고 elapsed만 갱신한다. 하나의 compact 현재 작업 표면만 기본으로 보이며, 과거 milestone·사용한 능력·파일·
검증·Undo는 사용자가 펼칠 때만 보인다.

##### UX1-B — Input·Control Continuity

실행 중 사용자가 보낸 말은 transcript에 보이는 것만으로 충분하지 않다. canonical admission·claim·consumption
사실에 따라 다음 중 현재 의미 하나를 사용자에게 보여준다.

```text
현재 작업에 반영 예정
현재 작업에 반영됨
현재 결과 전달 뒤 이어서 실행
별도 작업으로 대기
취소 요청 접수
이번 경계에서 소비되지 못해 다음 입력으로 보존
```

`queued`를 `consumed`로 표시하지 않는다. 모델의 마지막 답 뒤 도착해 소비되지 않은 교정은 사라지거나 완료된
것처럼 보이지 않고 다음 user turn으로 exact-once 보존한다. 사용자 원문·attachment envelope·sender/reply
identity는 admission 정본에 한 번만 남고 progress surface가 복제 저장하지 않는다.

취소의 사용자 terminal은 process signal 전송 시점이 아니다. 다음 전이가 전부 정산된 뒤에만 “멈췄어요”로
닫는다.

```text
cancel admitted
→ 시작한 model/tool/process child settle
→ unknown external effect 보존
→ exact Work revision execution claim release
→ interrupted/resumable 또는 cancelled disposition commit
→ cancel surface publication
→ 다음 사용자 입력이 같은 Work의 새 revision 또는 명시한 새 Work로 claim 가능
```

취소 뒤 단순 상태 확인이 모델 호출 전 `already claimed`에 막히면 cancel 성공이 아니다. 기존 process를 다시
실행하지 않고 마지막 durable output·progress·Receipt를 읽어 이어갈 수 있어야 한다.

Session 전환·화면 reconnect·process 재시작 뒤 실시간 event 누락을 정답으로 간주하지 않는다. 현재 Work의
canonical snapshot을 다시 투영하고, 사용자가 자리를 비웠다 돌아오면 다음 네 사실 중 존재하는 것만 한 줄로
요약한다.

```text
마지막으로 완료한 의미 있는 단계
현재 진행·대기·중단 상태
사용자 행동 필요 여부
보존된 결과·다음 가능한 행동
```

recap은 전체 transcript 요약이나 새 model call이 아니다. exact 현재 상태에서 만드는 bounded projection이며
오래된 progress event가 새 snapshot을 덮지 못하도록 run/revision identity에 결속한다.

#### S3-UX2 — Human Receipt & Artifact Hygiene

사용한 능력, 실제 생성·수정·전달한 결과, 검증 상태와 복원 가능성을 일반 사용자 언어로 접을 수 있는 표면에
보인다. raw command는 개발자 상세에서만 exact Receipt로 접근한다. 이미지·문서·기존 로컬 파일은 실제 bytes·
MIME·decode/reopen·hash·Attachment/Artifact publication이 선 뒤에만 전달됐다고 표시한다.

파일은 Work source·temporary·verification artifact·final artifact·published copy·trash/rollback으로 구분하고,
사람이 이해할 이름과 source Work를 가진다. 취소·실패 뒤 temporary를 사용자 폴더에 흩어 두지 않으며 최종
결과만 사용자 공간에 publication한다.

사용자가 “그 기존 파일 자체”를 요청하면 원본 path를 모델 Context나 URL에 노출하지 않고도 기존 file identity·
bytes·hash·사용자 파일명을 output handle에 직접 결속한다. 변환·편집·새 이름을 요청하지 않았다면 사용자
작업공간에 `cp`로 동일 복사본을 만들거나 임의 이름으로 바꾸지 않는다. transport상 staging copy가 필요하면
T5 managed temporary 영역에서 만들고 publication 후 정리하며, 사용자에게는 원본 이름과 동일성·변환 여부를
정확히 표시한다. 새 산출물이 필요한 작업과 기존 파일 전달은 같은 artifact 경로를 사용하되 source identity를
합치지 않는다.

일반 사용자 표면은 내부 상태를 직역하지 않는다. `active`, `pending_surface`, UUID, RecordRef, ISO timestamp는
기본 화면에 노출하지 않고 `현재 사용 중`, `전달 준비 중`, `오늘`, `지난 기록`처럼 현재 의미를 한국어로
projection한다. 감사에 필요한 exact state·identifier·시각은 접힌 개발자 상세나 출처 Receipt에서만 볼 수
있으며, 번역이 원래 상태의 불확실성을 지우면 안 된다.

Human Receipt는 내부 로그가 아니라 `확인한 것·만들거나 바꾼 것·실제로 검증한 것·복원 가능성·아직 모르는
것`만 기본으로 보여준다. 사용한 앱·연결·파일은 일반 이름으로 표시하고 raw command·경로·hash·exact 시각은
접힌 개발자 상세에서만 접근한다. 주의가 필요하지 않은 정상 작업은 최종 답과 결과 card 외 추가 panel을
강제로 펼치지 않는다.

#### S3-UX3 — Effect Forensics & Recovery

대량 이동·권한·설정·package 작업은 실행 전후의 exact target identity와 가능한 mode·ACL·flags·ownership·
content/entry count·사용자 openability를 분리 관측한다. 한 move log에 명령이 없다는 이유로 전체 사고 원인을
배제하지 않고, 관측하지 않은 원인은 `unknown`으로 둔다. recovery는 이전 상태·실행 diff·reverse plan·실제
rollback Receipt를 사용하며 광범위한 chmod·재이동을 원인 확인 없이 덧붙이지 않는다.

### 속도·Context·표면 밀도 계약

S3-UX는 기다림을 설명한다는 이유로 실제 작업을 더 느리게 만들 수 없다.

- progress·recap·receipt projection 때문에 추가 provider/model call `0`
- progress event의 모델 Context·Conversation 재주입 bytes `0`
- raw tool output·명령·사용자 원문·비밀·실경로의 progress payload 포함 `0`
- 동일 event의 중복 화면 publication `0`
- 빠른 작업의 불필요한 spinner·panel·task list `0`
- 실시간 stream 누락 뒤 canonical snapshot과 다른 사용자 상태 `0`

event는 bounded·deduplicated·coalesced projection이며 장기 원장 전체를 매 tick 다시 읽지 않는다. utility model
digest는 기본 경로에서 사용하지 않고, 주 모델 commentary가 없는 provider에서도 runtime milestone만으로
안심·통제 계약이 성립해야 한다.

### 최종 인간 자격의 최소 여정

새 표본 행렬을 만들지 않고 기존 S3-A 대표 여정에 다음 경계를 흡수한다.

1. 짧은 작업은 UX가 방해하지 않고 바로 끝난다.
2. 긴 로컬 분석은 실제 milestone·elapsed·stop이 보이고 결과 품질을 유지한다.
3. model/tool/process 각각의 경계에서 교정의 queued·consumed·미소비 상태가 정확하다.
4. model/tool/process 각각의 경계에서 cancel 뒤 claim이 풀리고 같은 Work가 재개된다.
5. 승인·로그인·비밀 입력·외부 기다림은 일반 실행과 구분되고 exact Work가 자동 재개된다.
6. Session 이동·reconnect·process restart 뒤 current snapshot과 한 줄 recap이 일치한다.
7. 기존 파일·새 결과·이미지는 실제 bytes로 열리고 source identity·이름·temporary 위생을 지킨다.
8. provider 실패·unknown external effect·delivery 실패에서 보존 상태와 다음 route가 보인다.
9. Console·Telegram은 같은 canonical Work truth를 각 채널 밀도에 맞게 투영한다.
10. Terra·gpt-5.5에서 목적·정확성·wall·model/tool calls·Context·사용자 교정/승인 부담이 2.0 positive control보다
    나빠지지 않는다.

### S3-A·Terminal·CA·PW 접합

- S3-A는 F1~F7을 기존 S2·S3·S4·S5 대표 여정에 흡수해 first meaningful milestone, longest invisible interval,
  cancel-to-stop, cancel-to-claim-release, same-Work recovery, original artifact identity, unrequested workspace copy,
  사용자용 상태 언어와 artifact/effect verification을 측정한다. 대표 여정 수를 늘리거나 trace를 사용자
  surface에 직접 노출하지 않는다.
- S3-T는 완료된 process·PTY·output recall·platform execution 기반으로 유지하며 S3-UX 때문에 재개하지 않는다.
- S3-CA는 기능이 존재하지만 degraded인 상태와 실제 부재를 구분하고, 안전한 Secret Input·Capability 연결과
  실제 이미지/Artifact route를 같은 Work에 제공한다.
- S3-PW는 macOS·Windows application icon·secret input·Finder/Explorer open·Activity/Receipt 표면의 동일 사용자
  계약을 최종 제품 자격에서 확인한다.
- S3-M은 기억의 의미·교정·망각·출처를 소유하고, S3-UX는 그 truth의 인간 언어·recap·receipt만 소유한다.
- 설정 catalogue·연결 준비·비밀 입력은 S3-CA/PW 책임이며 S3-UX가 가짜 버튼이나 두 번째 연결 상태를 만들지 않는다.
- S3-CH0은 기존 Conversation·Work·Run·Effect·Artifact·Resource truth를 과거 작업 검색·재개용으로 투영하며
  S3-UX의 Activity/Receipt surface에서 닫는다. 파일·앱 collector나 screen recorder는 이 접합으로 열리지 않는다.

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
AND S3-UX Work Visibility, Control & Outcome Reassurance including CH-0 T5 Work History
AND S3-CH Local Computer History CH-0~3
AND S3-CA Capability Reality & Safe Acquisition
AND S3-VD Visual Deliverable Core
AND S3-PW가 필요한 Windows 공통 자격
AND S3-WA Whole-product Wiring Audit·재현 P0/P1 close
AND S3-HQ developer_fast_feedback·pre_tester_reality 내부 인간 자격
AND macOS·Windows 실제 사용자·비교군 Release
```

S3-CA의 다음 작업은 제품 코드가 아니라, 현재 능력으로 끝나는 positive control 하나와 미등록 외부 능력이
필요한 실제 사용자 실패 하나의 목적·원본·종료점·비목표를 고정하는 것이다.

## 11. S3-CH — Local Computer History 등록 계약

S3-CH의 목적은 컴퓨터를 상시 녹화하는 것이 아니다. 사용자가 파일명·위치·정확한 날짜를 기억하지 못해도
과거에 T5와 했던 일과 허용한 업무 범위의 실제 파일·앱 흐름을 찾아 이어가고 복구하는 것이다.

```text
잘못된 제품:
모든 화면·대화·입력을 기록하는 감시형 Recall

T5 제품:
출처 있는 Work·파일·앱 metadata를 로컬에서 결속하고
현재 목적에 필요한 작은 과거 조각만 회수하는 작업 History
```

### 사용자 완료 문장

> 사용자는 “지난번 그 일”, “어제 쓰던 견적서”, “지난주 재고 정리 때 쓴 자료”처럼 평소 말로 과거 작업과
> 파일을 찾고 같은 목적에서 이어간다. T5는 실제 기록·현재 사실·잠정적 추론을 구분하며, 화면·대화·비밀을
> 상시 녹화하지 않고 사용자가 허용한 로컬 범위에서만 작은 Evidence를 회수한다.

### CH-0 — T5 Work History

CH-0은 새 collector나 새 원장이 아니다. 기존 Conversation·Work·Run·Effect·Artifact·Resource·RecordRef의
현재 truth를 S3-UX Activity/Receipt 표면과 과거 Work 검색에 투영한다.

사용자는 다음을 자연어로 할 수 있어야 한다.

- T5가 과거에 수행한 작업과 결과 찾기
- 사용한 파일·앱·연결과 검증 상태 확인
- 완료·부분 완료·취소·실패·unknown 구분
- exact 결과물 다시 열기·전달하기
- 남은 단계부터 같은 Work 재개
- T5가 만든 변경과 사용자·system·unknown 변경을 잘못 합치지 않기

CH-0은 S3-UX에서 구현·자격하며 3차 완료 범위에 포함한다. 과거 전체 transcript·ToolReceipt를 모델 Context에
재주입하지 않고 local metadata filter→작은 후보→exact handle 순으로 회수한다.

### CH-1 — Scoped File Activity

CH-1은 S3-UX와 CH-0이 닫힌 뒤 시작한다. macOS FSEvents·Spotlight와 Windows USN Journal·Windows Search의
공식 platform boundary를 adapter로 사용하고, 사용자가 허용한 업무 폴더의 metadata 변화만 다룬다.

```text
created | modified | moved | deleted | opened_when_observable
+ occurredAt
+ stable file identity 또는 availability
+ T5 Work/Run 결속 여부
+ actor: t5 | user | system | unknown
+ coverage: metadata_only
```

OS journal은 “무엇이 바뀌었다”는 증거이지 “왜 바뀌었다”는 증거가 아니다. T5 receipt가 없는 human/system
변경의 원인을 모델이 지어내지 않고 `unknown`으로 둔다. 파일 내용·hash·excerpt는 현재 사용자 목적에서 exact
재열람이 필요하고 기존 권한이 허용할 때만 별도 관측한다.

### CH-2 — Coarse App Activity

CH-2는 CH-1의 정확성·비용·privacy 자격 뒤 시작한다. 기본 범위는 foreground app identity·coarse duration·
AFK·현재 Work와의 명시적 결속뿐이다. window title·document title·전체 URL·browser history·채팅/메일 제목과 본문은 기본 수집하지
않는다. 앱 사용 시간은 사용자 선호·직업·성과의 증거가 아니며 MemoryClaim·persona로 자동 승격하지 않는다.

사용자는 기록 상태, pause/private mode, 포함·제외 앱, 삭제·내보내기, 현재 저장량을 이해할 수 있어야 한다.
다른 OS 사용자·remote desktop·private browsing·비밀 입력 surface는 수집 범위 밖이다.

### CH-3 — Purpose-Bounded History Intelligence

CH-3은 CH-0~2의 raw event를 모델에게 모두 주는 단계가 아니다.

```text
현재 사용자 목적
→ local time·Work·app·folder metadata filter
→ local FTS/OS index의 작은 후보
→ sensitivity·scope redaction
→ 모델이 후보 관련성 판단
→ 선택한 exact RecordRef만 재열람
→ 답·파일 열기·Work 재개·복구
```

raw activity는 Memory가 아니다. Episode는 과거 Work/Activity의 pointer이고, Memory는 사용자가 말한 사실·선호·
결정이며, Reflection은 여러 Episode의 잠정적 해석이다. 현재 교정은 과거 활동과 추론보다 우선한다.

### 절대 비목표와 개인정보 경계

다음 기능은 S3-CH에 포함하지 않으며 후속 screen Recall 자리도 예약하지 않는다.

- 상시 screenshot·screen video·OCR
- microphone·meeting audio 상시 기록
- keylogging·입력 문자 기록
- clipboard 원문 상시 기록
- 비밀번호·OTP·API key·결제·신분정보 수집
- private/incognito browser 기록
- 전체 URL·browser history·채팅·메일 본문 상시 수집
- raw History의 provider/model Context 일괄 전송
- 활동량으로 사용자 persona·직업·성과·선호 자동 판정

로컬 저장과 모델 전송은 별도 경계다. 기록이 로컬에 있어도 외부 provider 모델에 excerpt를 보내면 외부 전송이므로
현재 목적·scope·sensitivity에 필요한 최소 projection만 사용한다. 기록·index·Episode·Library·export·backup의
삭제 가능성과 unknown 외부 copy는 ForgetPlan·ForgetReceipt에서 분리한다.

### 속도·저장·플랫폼 계약

- foreground model/tool/file 작업의 wall·CPU·I/O 체감 저하 0
- 동일 metadata heartbeat/event의 병합과 bounded batch
- 사용자 원문·파일 내용 없는 metadata-first 저장
- hidden fixed retention·disk quota로 조용히 기록 손실 0
- 저장량·보존 상태·삭제 가능성의 사용자 가시성
- macOS·Windows 같은 사용자 약속, 교체 가능한 collector adapter
- collector 실패는 사용자 Work 실패나 거짓 History 성공으로 승격하지 않음

CH-1~3의 자격은 ActivityWatch 같은 event 기반 비교군과 동일 사용자 목적 A/B를 먼저 사용한다. 새 collector가
OS native index·기존 local capability보다 정확성·비용·사용자 부담에서 우위가 없으면 만들지 않는다.

### 3차 개발 순서

```text
CH-0 T5 Work History: S3-UX 책임으로 구현·자격
→ CH-1 Scoped File Activity: CH-0 뒤 구현·자격
→ CH-2 Coarse App Activity: CH-1 뒤 구현·자격
→ CH-3 Purpose-Bounded History Intelligence: CH-2 뒤 구현·자격
screen/audio/content Recall: 제품 범위 밖
```

각 단계는 앞 단계의 사용자 완료 문장과 macOS·Windows interface·privacy·비용 반대시험이 통과되면 다음 단계로
진입한다. 새 오너 승인을 반복 요구하는 잠금은 두지 않지만 여러 collector와 의미 계층을 한 번에 열지 않는다.
3차 완료는 CH-0~3 전체를 요구한다.

## 12. S3-VD — Visual Deliverable Core 등록 계약

S3-VD는 별도 디자인 제품이나 캔버스 편집기가 아니다. 사용자가 보고서·대시보드·도식·차트·문서·발표자료처럼
시각 품질이 목적 달성에 영향을 주는 결과물을 요청했을 때, 모델이 내용과 표현을 판단하고 T5가 실제 렌더·
전체 범위·글자·색·접근성·편집 가능성을 관측해 쓸 수 있는 결과로 끝내는 내재 능력이다.

현재 T5의 HTML·SVG natural preview, Artifact source/download, Semantic·Domain·Structural·Screen·Print
QualityReceipt, current-Run pixel observation, macOS WKWebView·Quick Look renderer, Sharp qualified decode,
bundled `diagrams` Skill을 재사용한다. 새 원장이나 두 번째 Artifact 체계를 만들지 않는다.

### 사용자 완료 문장

> 사용자는 내용과 목적을 평소 말로 설명한다. T5는 화면용·인쇄용·편집용·도식용 중 목적에 맞는 형식을
> 선택하고 한글·데이터·사용자가 승인한 브랜드 자료를 보존해 실제 결과물을 만든다. 전체 페이지나 artboard를
> 렌더해 잘림·겹침·폰트·대비·내용 누락·접근성·편집 가능성을 확인하고, 미달이면 모델이 실제 관측을 보고
> 고친 뒤 원본 구조·시각 출력·다운로드와 확인하지 못한 부분을 함께 전달한다.

### 표현층과 책임 경계

| 사용자 목적 | 기본 후보 | 지켜야 할 경계 |
|---|---|---|
| 화면 보고서·대시보드·온보딩·고정 인포그래픽 | HTML/CSS artboard | network-free render·한글 조판·semantic HTML |
| 인쇄·고정 배포 | HTML/CSS 또는 기존 document structure → PDF | 전체 page·print geometry·text extraction |
| 도식·관계·차트 mark·아이콘 | SVG·Mermaid·Graphviz 중 실제 renderer가 선 최소 형식 | 문단 text 좌표 직작성 금지·viewBox·label·source 보존 |
| 편집 가능한 문서 | 기존 qualified DOCX 구조 | HTML preview를 editable DOCX 성공으로 승격 금지 |
| 편집 가능한 발표자료 | qualified PPTX 구조 또는 현재 capability boundary | HTML/PDF가 아름답다는 이유로 editable PPTX를 주장하지 않음 |

SVG `<text>`는 기본 자동 줄바꿈이 없고 CSS 경로도 일반 HTML 조판보다 호환성 부담이 크므로 문단·복합
지면의 기본 저작 언어로 사용하지 않는다. 단순 label·도식·차트에는 계속 사용한다.

```text
모델: 내용 구조·정보 위계·출력 surface·시각 표현·브랜드 적용·수정·종료 판단
Runtime: renderer·font·viewport/page·geometry·render bytes·text/color/accessibility·전체 unit 관측
사용자: 승인한 브랜드 자료와 필요할 때의 주관적 미감·실제 사용 가능성 최종 판단
```

Runtime은 업종·문구·색 이름·template keyword로 디자인을 선택하지 않는다. “예쁘다·세련됐다·브랜드답다”를
기계 점수로 판정하거나 고정 layout·palette·font 크기로 모델 판단을 대신하지 않는다.

### VD0 — Visual Failure Constitution & Baseline

제품 변경 전에 한국어 one-page 보고서, source-backed chart, 관계 diagram, 인쇄 PDF, editable office 결과에서
다음을 재현한다.

- raw SVG 문단의 줄바꿈·overflow, 한글 금칙·font fallback·glyph 손실
- 일부 artboard만 보고 전체 확인 주장, source parse 성공의 visual PASS 승격
- 차트 값·단위·범례·순서의 원본 불일치, 색만으로 상태 구분
- glyph path SVG의 접근 가능한 text 거짓 주장
- HTML/PDF의 editable DOCX·PPTX 거짓 승격
- 승인 없는 브랜드 추론·지속, visual 교정이 새 내용 오류나 무진전 반복을 만드는 상태

일러스트 생성 benchmark와 미감 점수는 지면·업무 결과물의 제품 기준선으로 사용하지 않는다.

### VD1 — Renderer Interface & Korean Qualification

renderer를 미리 선택하지 않고 동일 계약으로 Satori+resvg 계열, macOS WKWebView helper 재사용, Windows
WebView2 또는 동등 native helper를 A/B한다.

```text
render(sourceKind, sourceIdentity, viewportOrPage, fontBundle, outputKind)
→ engine·platform identity + source/output digest + rendered units
+ text/font/geometry facts + duration·memory·failure boundary
```

Satori의 Flexbox 중심 CSS subset·TTF/OTF/WOFF·명시 font 공급·WOFF2 미지원 계약을 전제로 한다. 공식 목록의
`wordBreak: keep-all` 존재만으로 한국어 조판을 자격하지 않고, 실제 어절·금칙·혼합 숫자·표·긴 제목·fallback을
macOS·Windows에서 비교한다. renderer는 외부 network·script·form·file escape를 닫고 font license·재배포와
package 비용을 측정한다. WKWebView 선례를 Core의 macOS 전제로 굳히지 않는다.

### VD2 — Factual DesignReceipt

별도 미적 원장을 만들지 않고 기존 QualityReceipt에 다음 관측 사실을 공급한다.

- content: source fact·text·data value·unit·legend coverage
- geometry: viewport/page/artboard·overflow·clipping·overlap·out-of-bounds
- typography: requested/loaded/fallback font·glyph coverage·line break·관측 text size
- color: foreground/background contrast·status color 충돌·색각 simulation 뒤 구분 가능성
- layout: alignment·spacing consistency와 hierarchy evidence. 단일 grid나 미적 정답 강제가 아님
- accessibility: heading/table/alt/figcaption/ARIA·text extractability. glyph path는 accessible text가 아님
- delivery: screen·print·editable medium·source/output digest·전체 render coverage

WCAG 대비·OKLab/OKLCH 거리·색각 simulation을 독립 사실로 남기고 하나의 ΔE 숫자로 합격을 대신하지 않는다.
label·shape·pattern도 함께 본다. 이중 축·특정 색 수·“형태 먼저 색은 마지막”은 Skill의 절차와 경고가 될 수
있지만 Runtime 절대 규칙으로 만들지 않는다.

### VD3 — Render→Observe→Model Repair

```text
모델 초안 → runtime render → bounded DesignReceipt + 필요한 artboard pixels
→ 모델이 목적과 관측을 대조 → 수정 또는 정확한 capability boundary
→ 재렌더·전체 coverage → 기존 Artifact registration·publication
```

source 전체·모든 pixel·renderer log를 모델 Context에 누적하지 않는다. 현재 수정에 필요한 최신 관측과 exact
handle만 공급하고 전체 원본은 실행 증거에 둔다. 같은 결함·같은 결과 반복은 기존 Resource Situation·runaway
계약으로 다루며 새 고정 반복 상한을 만들지 않는다.

### VD4 — Brand Parameters, Artifact Surface & Human Qualification

브랜드는 사용자가 승인한 logo·font·color ramp·spacing·tone 자료와 exact source pointer를 parameter로
공급한다. Memory는 사용자가 말한 브랜드 사실·선호·결정만 소유하며, S3-VD가 과거 산출물에서 브랜드를 자동
추론해 지속하지 않는다. 방법은 Skill, renderer와 검사는 Capability/Runtime, 결과와 Receipt는 기존 Artifact가
소유한다.

같은 내용·데이터·브랜드 입력의 current/new A/B에서 정확성·source trace·전체 coverage·한글 overflow·font·
contrast·accessibility·첫 usable preview·전체 wall·model/tool calls·request bytes·tokens·실제 재개방·수동
수정 시간·한국 사업자 인간 패널의 사용 가능성과 재위임 의사를 함께 판정한다.

### 첫 완료 비목표와 S3-CA 경계

- 새 범용 canvas/editor·멀티 artboard 디자인 앱
- 새 HTML→PPTX 변환 engine·PowerPoint 전체 호환 약속
- Typst·Marp Core dependency 내장
- 생성형 이미지·전용 vector model/provider 통합
- 사용자 승인 없는 brand inference
- 고정 template·palette·font·미적 score로 모델 판단 대체
- HTML·SVG·PDF 중 하나를 모든 결과의 단일 표준으로 강제

Typst·Marp·외부 chart/diagram renderer는 S3-CA에서 exact source·license·platform·same-purpose 자격을 거친
선택적 Capability 후보로 둔다. 준비 성공을 결과물 품질 성공으로 합치지 않는다.

### 개발 순서

```text
현재 활성 S3 exact Gate 종료·오너 개통
→ VD0 failure constitution·current baseline
→ VD1 renderer 후보 A/B와 macOS·Windows interface
→ VD2 factual DesignReceipt를 기존 QualityReceipt에 연결
→ VD3 render-observe-model repair
→ VD4 brand parameter·Artifact surface·인간 A/B
→ S3-WA 전체 배선 감사
→ S3-HQ 내부 인간 자격
```

S3-VD 등록은 현재 S3-M·S3-UX·S3-CA hot path 병행 개통을 뜻하지 않는다. 구현 전 실제 사용자 실패 하나와
positive control 하나의 목적·종료점·비목표를 고정하고, 비교군 source가 막는 실패를 T5 반대시험으로 먼저
옮긴다. SVG·Satori·Typst·font의 공식 계약과 현재 T5의 renderer·Artifact·QualityReceipt를 근거로 사용하며,
Gamma·Tome의 시장 성과나 조건이 불명확한 benchmark 숫자는 제품 계약의 증거로 사용하지 않는다.

### 현재 Core 정산 — 2026-08-27

기존 Attachment `inspect`가 current-Run HTML·SVG를 실제 PNG로 렌더하고 factual DesignReceipt와 pixels를
모델에 공급하도록 연결했다. macOS helper는 local-only WKWebView·OCR에 DOM geometry·declared block overlap·
overflow·font·contrast·alt/caption 관측을 추가했고, gradient·투명 배경의 대비는 합격으로 꾸미지 않고
`unmeasured`로 남긴다. 기본 `visual-deliverables` Skill은 지면/도형/편집형 surface 선택, 내부 source key의
사용자 언어 변환, render-inspect-repair-register 절차를 공급한다.

격리된 같은 한국어 운영 현황 과업에서 gpt-5.5와 gpt-5.6-terra가 source fact 보존·내부 field key 0·외부
network/script 0·Skill view·render inspect·실제 pixels·최종 DesignReceipt non-failed·output registration을 모두
통과했다. 첫 실제 표본에서 runner의 Keychain owner·상대경로·UUID 결속 결함과 사용자 화면의 raw field key를
발견해 제품/runner 원리로 교정했으며 실패 기록을 성공으로 덮어쓰지 않는다.

다음은 S3-VD Core 완료로 주장하지 않고 S3-PW·S3-HQ의 최종 자격으로 남긴다.

- Windows WebView2 또는 동등 native renderer actual
- editable PPTX 전체 slide·font·overflow actual
- user-approved brand parameter의 실제 Memory source·인간 패널 A/B
- gradient·image·alpha가 섞인 모든 색 대비의 자동 qualified 판정

구현 전 다시 확인할 직접 source:

- SVG text wrapping·compatibility: <https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Element/text>
- Satori CSS·font·text contract: <https://github.com/vercel/satori/blob/main/README.md>
- Typst SVG accessibility·export: <https://typst.app/docs/reference/svg/>
- Pretendard license·font assets: <https://github.com/orioncactus/pretendard>
- Gamma HTML→structured editable layer 참고: <https://vercel.com/blog/gamma-builds-design-first-agents-with-vercel>
