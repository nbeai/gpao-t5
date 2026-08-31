# T5 Method Runtime 연구 — 목적 기반 동적 수단 합성

기록일: 2026-08-30
조사 기준 head: `4e6a0770`
상태: `CONCEPT_IDENTIFIED · CURRENT_GAP_MAPPED · NOT_APPROVED_FOR_IMPLEMENTATION`

## 1. 연구 질문

T5가 수많은 전용 Agent·Tool을 미리 만드는 로봇팔 플랫폼을 넘어, 컴퓨터라는 기존 신체를 이해하고 현재
사용자 목적에 필요한 방법 자체를 동적으로 구성하는 안드로이드가 될 수 있는가.

핵심 가설은 다음과 같다.

> LLM은 목적·상황·방법·완료를 판단하고, Terminal은 OS·CLI·프로그램을 조합하는 범용 실행 기반이 되며,
> T5 Runtime은 identity·authority·execution·effect·verification·Artifact·cancel·recovery를 제공한다. 이 세
> 요소가 현재 Work의 한 임시 방법으로 결속되면 T5는 준비된 도구를 고르는 Agent를 넘어 방법을 합성하는
> 컴퓨터 안드로이드에 가까워진다.

기술명 후보:

- `Purpose-Driven Dynamic Capability Synthesis`
- `T5 Purpose Execution Engine`
- `T5 Method Runtime`
- `Work-scoped Dynamic Method Execution`

이 문서에서는 `T5 Method Runtime`을 사용한다.

## 2. Terminal의 정확한 역할

Terminal은 T5의 여러 손 중 하나이면서 동시에 기존 손을 조합하고 새 손을 만드는 범용 근육이다.

```text
일반 Tool
→ 정해진 입력과 정해진 행동

Terminal
→ 환경 관측
→ 기존 OS·CLI·프로그램 실행
→ 파이프·반복·계산·변환
→ 작은 프로그램 제작
→ 새로운 실행 방법 구성
```

LLM은 의미를 실행 명령으로 바꾸는 데 강하고 Terminal은 텍스트·process·exit·stderr라는 모델 친화적 계약을
제공한다. 그러나 LLM과 raw shell만 연결하면 권한·범위·중복 효과·거짓 완료가 취약하다. 현재 T5의 D·E·F·G와
Work·Evidence·Effect·Artifact·Undo·Recovery가 이 위험을 제한하는 신경계다.

Terminal은 가장 강한 후보 기반이지만 연구 시작 전에 정답으로 확정하지 않는다. 동일 목적에서 현재 모델 Tool
loop, 기존 bounded Hand, procedural Skill, provider-native programmatic tool calling과 비교하며, 다른 경로가 같은
품질을 더 정확하고 경제적으로 달성하면 Terminal Method 후보를 폐기한다.

## 3. 목표 순환

```text
Direct
→ 모델이 바로 답할 수 있으면 Tool 0으로 답함

Use
→ 기존 Hand 하나로 충분하면 즉시 사용

Compose
→ 여러 기존 Hand를 목적에 맞는 순서로 조합

Make
→ 적절한 수단이 없으면 작은 프로그램·방법을 현재 Work 안에서 제작

Verify
→ 실행·효과·결과를 프로그램과 독립적으로 관측

Deliver
→ 실제 Artifact·Preview·외부 결과를 사용자에게 전달

Learn
→ 반복 이익이 독립적으로 증명된 방법만 재사용 후보로 승격하고 회귀 시 철회
```

사용자는 Tool·CLI·Skill·Capability·프로그램을 선택하지 않고 목적만 말한다.

## 4. 현재 T5에서 이미 선 부분

### Direct

- 직접 질문은 Work·Tool 없이 1 model call로 답할 수 있다.
- 모든 입력을 무조건 Agent Work로 만들지 않는다.

### Use

- File·Document·Terminal·Browser·Web·Connection·Capability Hand가 존재한다.
- `Capability Reality`가 `usable_now·needs_auth·preparable·degraded·incompatible·unknown`과 권한·비용·source를
  작게 공급한다.
- 업무명·확장자·모델명 정규식 Router가 아니라 모델이 현재 목적과 Reality로 방법을 고른다.

### Make

- G는 모델 작성 Python·shell을 writable COW snapshot에서 exact 1회 실행한다.
- 원본 write·network·선언 밖 output을 막고 source universe와 output을 독립 검증한다.
- F transaction·Undo·durable batch handoff·Artifact 등록·cleanup을 연결한다.

### Verify·Deliver

- 파일·hash·revision·format·source coverage·effect·Artifact·Delivery·Undo를 독립 확인한다.
- 실행 요청, 허용, 실제 실행, local effect, external effect, 사용자 목적을 한 success로 합치지 않는다.

### Learn

- 실제 achieved Work·사용자 교정·실패 후 다른 route 성공·반례에서 방법 proposal을 만든다.
- AB/BA·near-miss·independent field·fresh purpose·wall/calls/tokens를 비교한다.
- 첫 자동 활성 범위는 reversible managed procedural Skill이며 회귀하면 archive한다.

## 5. 현재 가장 큰 미달

### 5.1 단계별 모델 현장 감독

복합 작업에서 모델이 각 Hand 사이를 매번 다시 호출한다.

```text
model → search
model → inspect
model → another inspect
model → exec
model → author
model → verify
model → register Artifact
model → final
```

결과는 정확할 수 있지만 model/tool 왕복, 반복 Context, 같은 Evidence 재개방, 불필요한 재검증이 증가한다.
현재 S6-J의 반복 reopen·Browser 재검증·Artifact projection 비용이 같은 결함 가족의 관측이다.

### 5.2 Terminal 세계와 T5 Hand 세계의 분리

Terminal 프로그램은 OS·CLI·Python·shell을 조합할 수 있지만 다음 T5 내부 Hand를 안전하게 직접 호출하지 못한다.

- File Reality opaque handle
- Document bounded observation
- Browser observation/action
- Attachment·Artifact
- Memory reopen
- Capability Reality
- Authority·Effect·Undo

따라서 Terminal은 강하지만 T5 내부 감각·손과 같은 프로그램 안에서 결속되지 않는다. 모델이 중간 감독자로
남는다.

### 5.3 G의 현재 제품 범위

현재 G product adapter는 macOS의 `local_change`, workspace 안 새 output, declared targets, Python/shell,
network·외부 child가 필요 없는 파일 생성 중심이다. 같은 언어·원본 보존·독립 검증은 강하지만 다음은 범위 밖이다.

- 프로그램 안의 T5 Tool RPC
- Browser·Connection·Memory·Approval 결합
- external effect
- 모든 기존 파일 mutation
- Windows physical product qualification
- 장기 상호작용 방법 전체

4차는 nested Tool RPC·Agent Team·DAG planner·Programmatic Tool Orchestration을 의도적으로 열지 않았다.

### 5.4 현재 컴퓨터 affordance 발견의 부분성

Capability Reality는 T5가 관리하는 Skill·CLI·MCP·Connection·catalog·platform reality에는 강하다. 하지만 사용자
컴퓨터에 이미 설치된 모든 앱·CLI·library·로그인 상태를 의미 단위의 검증된 affordance로 자동 파악하지 않는다.

Terminal로 `command -v`, `--help`, version·probe를 관측할 수 있지만 그 관측이 자동으로 current capability의
quality·cost·permission·source 사실로 승격되지는 않는다.

### 5.5 현재 방법의 최소 의미 보존

Work·Run·Evidence는 실행 사실을 보존하지만 모델이 현재 선택한 방법의 다음 의미를 공통 형태로 작게 보존하지 않는다.

```yaml
purpose:
exactInputs:
chosenHands:
confirmedFacts:
remainingObservation:
allowedEffects:
expectedOutputs:
stopConditions:
fallbacks:
```

고정 ActionPlan이나 Workflow DB가 필요하다는 뜻은 아니다. provider 전환·Context compaction·Runtime restart·사용자
교정 뒤에도 현재 방법의 이유와 중단 조건을 다시 구성하는 비용이 남는다는 뜻이다.

### 5.6 실행 검증과 사용자 목적 판단의 연결

Runtime은 파일·hash·effect·Artifact를 강하게 확인하지만 결과가 사용자의 실제 목적에 충분한지는 모델이 판단한다.
이 역할 분리는 맞다. 다만 검증 Evidence가 흩어지면 모델이 이미 성공한 뒤 더 검사하거나 보조 검사 실패를 전체
실패로 해석할 수 있다. compact purpose evidence handoff가 더 좋아질 여지가 있다.

### 5.7 Experience Growth의 현재 한계

Experience Growth는 managed procedural Skill까지 자동 승격할 수 있다. external package·secret scope·Core·외부
전송·새 program backend·OS별 affordance·GUI 운동 패턴은 자동 학습 범위가 아니다. 현재는 안전을 위해 맞는
제한이며 후속 확장은 실제 사용자 이익과 독립 자격이 있을 때만 검토한다.

## 6. 화룡점정 후보 — Work-scoped Method

모델이 고정 workflow를 선택하는 것이 아니라 현재 목적의 작은 임시 방법을 작성하고 Runtime이 실행 진실을 맡는다.

```yaml
Method:
  workRevision:
  purpose:
  exactInputs:
  allowedHands:
  allowedEffects:
  procedure:
  checkpoints:
  expectedOutputs:
  stopConditions:
```

```text
모델의 현재 방법
        ↓
T5 Method Runtime
  ├─ Terminal·OS·CLI
  ├─ File Reality
  ├─ Document
  ├─ Browser
  ├─ Capability
  ├─ Artifact
  └─ Effect·Undo
        ↓
compact new Evidence·failure·decision boundary
        ↓
모델의 다음 판단 또는 최종 답
```

Runtime은 목적·업무 종류·최적 방법을 선택하지 않는다. exact input, active capability, authority, 실제 call, effect,
checkpoint, output, settlement만 책임진다. 새로운 중요한 Evidence·사용자 결정·실패에서만 모델로 돌아간다.

### 6.1 비교할 실행 후보

```text
A. 현재 모델의 단계별 Tool loop
B. 기존 Hand 하나의 더 좋은 bounded 결과
C. 검증된 procedural Skill
D. provider-native programmatic tool calling
E. Terminal 기반 read-only Method Capsule
```

Method Runtime 연구의 목적은 E를 채택하는 것이 아니라, A의 실제 병목을 같은 품질로 가장 작게 줄이는 실행 경계를
찾는 것이다. B·C·D가 더 낫다면 새 Runtime을 만들지 않는다.

`Method` 계약은 모든 작업에 상주하지 않는다. Direct·단일 Hand 요청에서 Method schema·Context·model call·Tool
surface 증가는 0이어야 한다. 복합 Work에서도 모델이 현재 목적에 필요하다고 선택한 한시적 execution envelope이며,
Work·Run·Evidence와 중복되는 계획 원장이 아니다.

## 7. 이 개념이 아닌 것

- 새 Intent Router
- 업무별 DAG·ActionPlan library
- 모든 과업의 거대 Planner
- Agent Team·다중 Agent orchestration
- 모든 Tool을 자동 병렬 실행하는 engine
- 모델 판단을 Runtime 정규식으로 대체
- 현재 Work·Run·Evidence와 중복되는 새 Store
- Terminal raw shell에 무제한 권한 부여
- 한 번 성공한 프로그램의 자동 영구 Skill화

## 8. 연구·자격 순서

6차 UX·최종 HQ 전에는 구현하지 않는다.

### MR-0 — Current Natural Path Baseline

복합 여정 하나의 exact model calls·tool calls·tokens·wall·반복 Evidence·첫 유용한 결과를 측정한다. 현재 자연 경로가
이미 충분히 경제적이면 Method Runtime을 열지 않는다.

첫 후보는 여러 문서의 관측·값 추출·계산·대조·ClaimEvidence 생성처럼 read-only 비중이 높은 목적이 적합하다.

MR-0은 위 A~E 중 현재 제품에서 가능한 경로를 같은 fixture·model·source·authority로 비교한다. 단계별 Tool loop가
정확성이나 비용의 주 병목이 아니면 MR-1을 열지 않는다.

### MR-1 — Read-only Method Capsule

제품 변경 전에 qualification-only로 제한된 read-only Hand만 제공한다.

- exact source handles
- bounded File·Document observation
- pure calculation
- network·secret·external effect 0
- output은 compact Evidence candidate
- 실제 사용자 파일 변경 0

모델이 단계마다 Tool을 호출하는 baseline과 같은 목적 A/B를 수행한다.

### MR-2 — Verified Local Result

MR-1이 정확성·완전성 무회귀와 wall·calls·tokens 이익을 증명할 때만 F/G·Artifact를 연결한다. declared local output,
independent readback, Undo, cleanup을 유지한다.

### MR-3 — Bounded Hand Composition

실제 병목이 계속될 때만 File·Document 외 Hand를 하나씩 연다. Browser·external effect·secret·Computer Use를 첫
범위에 함께 넣지 않는다.

### MR-HQ — General User Reality

- 사용자는 기능·프로그램·방법을 선택하지 않음
- current correction이 진행 중 Method보다 우선
- 같은 effect 중복 실행 0
- 직접 답변·단일 Hand 요청 비용 증가 0
- baseline과 같은 정확성·완전성·Artifact·Undo
- first useful result·wall·calls·tokens 중 실제 이익
- 모델/provider 변경에도 같은 Runtime 계약
- macOS actual 뒤 Windows adapter 의미 보존

## 9. 채택·폐기 기준

채택 조건:

```text
정확성·완전성·권한·effect·Artifact·Undo 무회귀
AND 단계별 model/tool 왕복이 실제로 감소
AND 첫 유용한 결과 또는 wall·tokens가 의미 있게 개선
AND current correction·cancel·restart가 method를 정확히 중단·재결속
AND 기본 Direct·단일 Hand Context 비용 증가 0
```

폐기 조건:

- 모델이 Method를 사용하지 않음
- 기존 exec·G 경로보다 느리거나 비쌈
- 고정 schema가 처음 보는 업무를 제한
- Runtime이 목적·방법을 선택하게 됨
- intermediate 결과가 새 사실 원장으로 중복됨
- same defect family의 세 번째 조건 patch가 필요함
- actual user purpose는 실패하지만 fixture만 통과함

## 10. 현재 결정

이 개념은 현재 T5의 구조적 미달을 설명하는 연구 가설이며 6차 제품 개발 승인이 아니다. 현재 T5에는 이미 많은
구성 요소가 있고 새 거대 engine을 만드는 것이 목적이 아니다.

> 부족한 것은 또 하나의 강한 Tool이 아니라, 모델이 작성한 하나의 임시 방법 안에서 Terminal과 T5 내부 Hand를
> 제한적으로 조합하는 공통 운동 신경이다.

이는 현재 가장 유력한 구조 가설이지 Terminal Method 채택 결론이 아니다. 6차 UX·강화 HQ를 먼저 완료한다. 이후
실제 model/tool 왕복 병목이 재현될 때 `MR-0`에서 A~E를 비교하고, 현재 경로가 이미 충분하면 제품 변경 0으로 닫는다.
