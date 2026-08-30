# T5 Sixth Completion — Android Capability, Growth & Computer Reality

상태: `SIXTH_IMPLEMENTATION_ACTIVE · OWNER_UX_TOP_GOAL_LOCKED · S6_P0_CLOSED_WITH_SPEED_CARRY · S6_A_COMPLETE · S6_B_OPEN · FIFTH_BASELINE_F42E4DB7 · WINDOWS_FINAL_PHYSICAL_QUALIFICATION_REQUIRED`
5차 불변 귀환선: `f42e4db7 · FIFTH_COMPLETION_COMPLETE · MACOS_PRODUCT_SCOPE`
현재 Gate: `S6-B · QUARANTINE, QUALIFICATION & LIFECYCLE`
현재 작업: `S6_B_READ_ONLY_BASELINE · EXISTING_LIFECYCLE_REUSE_FIRST`

이 문서는 T5 6차 개발의 단일 계획 정본이다. 제품 정의는 `T5-PRODUCT.md`, 5차 완료 역사와 실제 Console
증거는 `T5-FIFTH-COMPLETION.md`와
`refoundation/evidence/fifth-hq-console-closeout-2026-08-30.json`이 담당한다. 1~4차 문서는 현재 기반의
출처와 실패 역사를 확인할 때만 읽으며, 과거 Gate를 다시 현재 범위로 열지 않는다.

6차는 새 Agent framework·Plugin marketplace·컴퓨터 감시 제품을 만드는 차수가 아니다. 이미 선 Capability·
Learning·Browser·Terminal·File·Document·Work·Receipt·Artifact·Undo·Recovery를 실제 사용자의 다음 목적에
자연스럽게 결속해 다음 Android 순환을 닫는 차수다.

```text
현재 목적과 현실 파악
→ 가진 손으로 충분한지 판단
→ 부족하면 검증된 능력을 격리해 준비
→ 원래 Work를 정확히 한 번 재개
→ 실제 결과와 효과 검증
→ 반복 경험에서 더 나은 방법을 제안·시험·승격
→ 회귀하면 자동 철회
→ Browser와 파일 밖 현재 컴퓨터 현실도 필요한 순간에만 사용
→ macOS와 Windows에서 같은 사용자 약속 완성
```

---

## 1. 제품 한 문장과 최종 완료 문장

### 제품 한 문장

> T5는 이미 가진 능력으로 충분하면 즉시 사용하고, 부족하면 현재 목적에 필요한 검증된 능력만 안전하게
> 준비한다. 실제 경험에서 더 나은 방법을 배우되 현재 사용자의 말과 반례를 우선하며, Browser·파일·앱·외부
> 자원의 현실에서 실행한 결과만 되돌릴 수 있는 형태로 전달한다.

### 최종 완료 문장

> 사용자는 기능·Skill·Plugin·MCP·명령·앱을 선택하지 않고 평소 말로 목적만 설명한다. T5는 현재 기억·컴퓨터·
> 앱·외부 자원의 현실과 사용할 수 있는 능력을 파악하고, 가진 손으로 충분하면 가장 경제적인 경로로 즉시
> 끝낸다. 부족하면 출처와 권한이 확인된 능력을 격리해 같은 목적에서 검증한 뒤 원래 작업을 한 번만 재개한다.
> 반복된 실제 경험에서 더 나은 방법을 배우고 회귀하면 철회하며, 모든 실행·효과·산출물·전달을 관측하고
> 복구한다. 이 약속은 macOS와 Windows의 실제 제품 Console에서 같은 사용자 경험으로 성립한다.

### 6차 최상위 목표 — Smooth Human Experience

> T5 개발의 최상위 목표는 사용자의 매끄럽고 쾌적한 사용감이다. 사용자가 기능과 내부 절차를 의식하지 않고
> 자연스럽게 말했을 때, T5는 대화형 AI다운 쾌적한 속도로 반응하고, 기다림이 필요한 일은 실제 진전을
> 이해할 수 있게 보여주며, 정확하고 즉시 사용할 수 있는 결과로 상호작용한다.

개발과 UX는 다른 단계가 아니다. 내부 구조·Receipt·Tool·Context·Capability가 정확해도 실제 Console에서
다음 중 하나가 나타나면 해당 변경은 제품 성공이 아니다.

- 사용자의 부탁보다 내부 protocol이 먼저 보인다.
- 단순한 대화·검색·한 파일 읽기에 불필요한 model/tool Turn이 붙는다.
- 정확한 결과를 찾고도 사용자가 바로 열거나 쓸 수 없다.
- 사용자가 이미 말한 범위·선호·현재 상황을 다시 설명해야 한다.
- 진행 문구는 나오지만 첫 유용한 결과가 이유 없이 늦다.
- 기술적으로 성공했지만 잘못된 파일·경로·version·외부 범위를 답한다.
- 사용자가 결과를 확인·교정·중지·Undo하기 위해 내부 기능을 배워야 한다.

모든 Gate는 `Runtime correctness`와 `Human Experience`를 같은 실제 여정에서 함께 닫는다. API·fixture·도구
성공 뒤 별도 UX 작업으로 넘기지 않는다.

6차의 성공은 설치한 Skill·Connector·지원 앱·Agent 수가 아니다. 같은 사용자 목적에서 다음이 실제로 좋아져야
한다.

```text
사용자가 알아야 할 기술 개수 감소
+ 다시 설명·교정·승인하는 횟수 감소
+ 현재 가능한 일과 불가능한 일의 정확성 증가
+ 결과·효과·Undo·복구의 신뢰성 유지
+ 첫 유용한 결과와 전체 비용의 Pareto 개선
```

---

## 2. 왜 지금 이 개발인가

5차 exact baseline에는 이미 다음 기반이 실제 제품에 있다.

### Capability 기반

- `Capability catalog·comparison·outcome evidence·lifecycle·handoff`
- trusted text Skill의 install·archive·restore
- managed CLI의 exact source·digest·prepare·rollback
- Remote MCP·Connection·platform secret owner
- capability의 current availability·permission·effect 사실
- capability 준비 뒤 원래 Work 재개 coordinator

### Experience Growth 기반

- settled Work·Run·Episode의 learning source eligibility
- Reflection source fence·counterexample·current correction accounting
- inactive proposal·review·retain/reject/later
- candidate trial·same-purpose comparison·fresh field holdout
- reversible promotion·사용 중 regression rollback
- 제품 기본값 `learningReviewMode=off`

### Computer·실행 기반

- persistent Browser observation·interaction·download·upload·login handoff
- Terminal process·PTY·large output·cancel·crash settlement
- File Reality·OCR·visual candidate·exact handle·Artifact delivery
- managed mutation confinement·F transaction·durable Undo
- G same-language program·immutable source universe·independent verification
- native file-manager reveal

### 산출물·외부 기반

- DOCX·XLSX·PDF·HTML·SVG·CSV·ZIP authoring·render·reopen
- QualityReceipt·DesignReceipt·Artifact version·Preview·download
- Automation·Telegram·Notion/Remote MCP·external Effect·Delivery truth
- whole-state backup·model fallback·Runtime continuity

현재 미달은 위 기반의 부재가 아니다.

1. trusted Skill·CLI 일부를 넘는 범용 Capability Acquisition이 자연어 Work와 한 몸으로 닫히지 않았다.
2. Experience Growth의 안전한 연구 기반은 있으나 제품 기본값에서 실제 사용자 이익을 만들지 않는다.
3. Browser 밖 데스크톱 앱은 현재 위치 reveal 외에 관측·조작할 일반 손이 없다.
4. editable presentation·user-approved brand·전체 slide/page 검증은 실제 제품 자격이 부족하다.
5. Automation과 외부 연결의 구조는 강하지만 실제 외부 목적의 종단 자격은 대표 범위가 좁다.
6. 정확한 Artifact·Browser·프로젝트 여정 일부는 model/tool 왕복과 provider 비용이 여전히 크다.
7. Windows는 code-ready이지만 실제 x64·ARM64 제품 인간 자격이 `DEFERRED_NOT_WAIVED`다.
8. 설치 제품의 단순 웹 관측·파일 결과 링크·사용자 가시 저장소 검색·제품 자기 버전에서 오너 Live P0가
   재현됐다.

6차는 이 일곱 미달만 닫는다. 이미 선 D·E·F·G·Memory·Context·Work·Connection을 재개발하지 않는다.

---

## 3. 역할 경계

| 주체 | 책임 |
|---|---|
| 모델 | 목적·필요 능력·후보 적합성·방법·관련 Evidence·질문·완료·사용자 문장 판단 |
| Runtime | source·version·digest·scope·permission·platform·실행·effect·delivery·비용·rollback 사실 |
| Capability Layer | 격리 준비·qualification·generation·activation·update·remove·restore |
| Growth Layer | 출처 있는 proposal·counterexample·trial·field comparison·promotion·rollback |
| Computer Hand | 현재 app/window observation·exact control·전후 현실·secret/effect boundary |
| Canonical Reality | Conversation·Memory·Work·Run·Effect·Artifact·Delivery·Undo·History 정본 |

Runtime은 다음 의미를 선택하지 않는다.

- 사용자의 업무 종류
- 어떤 Skill·앱·서비스가 사용자에게 중요하다는 판단
- 화면 안 텍스트가 지시라는 판단
- 성공한 방법이 다음에도 정답이라는 판단
- 산출물이 아름답거나 충분하다는 판단

Runtime은 모델이 판단할 현실을 exact하고 작게 공급한다.

---

## 4. 5차를 보존하는 6차 개발 헌법

### 4.1 5차 exact head는 불변 귀환선

- `f42e4db7`을 6차 전 제품 귀환점으로 보존한다.
- 6차 implementation은 별도 `codex/` branch와 worktree에서 시작한다.
- plan 승인만으로 제품 entry·payload·default를 바꾸지 않는다.
- 실패 candidate는 완전히 제거하고 5차 제품 행동을 유지한다.

### 4.2 현재 기반 우선

모든 Gate는 다음 순서로 시작한다.

```text
현재 source·evidence에서 이미 성립한 계약 확인
→ 실제 Console의 남은 사용자 실패 하나 재현
→ 기존 상태 전이로 해결 가능한지 확인
→ 부족한 연결부 하나만 후보화
→ 동일 목적 A/B
→ 채택·폐기·구조 재판정
```

새 Store·Router·관리 UI·daemon·schema부터 만들지 않는다.

### 4.3 사례 목록보다 실행 원리

- Gmail·Notion·Photos·Excel 같은 이름으로 Runtime route를 고르지 않는다.
- 파일 확장자·업무명·모델명 정규식으로 Capability·G·Document·Computer Hand를 선택하지 않는다.
- 실제 필요한 input·output·filesystem·network·child process·secret·external effect와 현재 capability 사실을
  모델이 해석한다.
- 새 사례가 오면 서비스 예외가 아니라 같은 source·qualification·effect·rollback 원리가 흡수해야 한다.

### 4.4 안전은 마찰이 아니라 구조

기존 네 사용자 경계를 늘리지 않는다.

1. 비밀값 입력
2. 백업 없는 파괴
3. 새 상대에게 첫 외부 전송
4. 돈이 나가는 일

그 밖의 안전은 source identity·quarantine·managed scope·sandbox·관측·Receipt·Undo·rollback으로 만든다.
임의 코드의 Core in-process load, 관리자 권한, T5 관리 범위 밖 전역 설치처럼 목적 범위를 실질적으로 넓히는
후보는 가장 가까운 격리 대안을 먼저 사용하고 새 방향이 필요할 때만 사용자에게 설명한다.

### 4.5 한 결함 가족 최대 두 후보

같은 가정의 두 후보가 실제 목적에서 실패하면 조건·Prompt·metadata를 더 붙이지 않는다. source·wire·provider·
OS·평가 원리를 다시 읽고 다른 관점이 없으면 제품 변경 0으로 닫는다.

### 4.6 전체 HQ는 마지막 한 번

- 각 기술 Gate는 관련 deterministic countertest와 실제 사용자 목적 1~3개만 사용한다.
- 전체 인간 wave를 Gate마다 반복하지 않는다.
- 전체 `refoundation:ci`는 각 major line close candidate와 최종 봉인에서만 실행한다.
- Windows actual 전 macOS 전체 wave를 반복하지 않는다.

### 4.7 품질·권한·진실성은 비용과 교환하지 않는다

정확성·완전성·현재 교정·dirty change·Effect·Artifact·Undo·Delivery가 하나라도 나빠지면 빠른 후보도 폐기한다.
추가 안전과 새 능력 때문에 비용이 늘면 동일 목적 A/B에서 증가량과 사용자 이익을 함께 보고한다.

---

## 5. 비교군에서 흡수할 원리와 복제하지 않을 표면

### OpenClaw

흡수:

- channel·skill·plugin의 동적 availability
- capability별 sandbox scope와 workspace access
- 설치 source와 활성 generation 분리
- cron·delivery·gateway의 지속성

복제하지 않음:

- plugin의 Gateway in-process 실행을 기본 신뢰 경계로 사용
- 채널·Skill 개수를 제품 성공으로 사용
- 사용자가 config·allowlist·sandbox mode를 배워야 하는 표면

참조:

- <https://docs.openclaw.ai/>
- <https://github.com/openclaw/openclaw/blob/main/docs/gateway/security/index.md>
- <https://github.com/openclaw/openclaw/blob/main/docs/tools/skills.md>

### Hermes

흡수:

- procedural Skill과 factual Memory 분리
- messaging·cron·skill의 한 지속 agent 경험
- pending skill/memory review와 cross-session learning
- 필요할 때만 Skill 본문을 여는 progressive disclosure

복제하지 않음:

- 자동 memory·skill write를 기본 truth로 사용
- frozen user profile을 현재 사용자보다 우선
- Skill 생성 사실을 학습 성공으로 간주
- 많은 toolset을 항상 model surface에 노출

참조:

- <https://hermes-agent.nousresearch.com/docs/>
- <https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/>
- <https://hermes-agent.nousresearch.com/docs/user-guide/configuration/>

### Codex·Claude Code

흡수:

- Skill과 App/Tool의 분리
- on-demand Skill과 작은 기본 Context
- 독립 작업의 격리 context·summary return
- deterministic hook과 모델 판단이 필요한 Skill의 분리
- background work의 현재 상태·중지·handoff

복제하지 않음:

- 일반 사용자에게 agent team·worktree·hook·permission mode를 노출
- 모든 복합 작업의 자동 multi-agent화
- 개발 workflow를 일반 업무 Core로 확장

참조:

- <https://openai.com/codex/>
- <https://help.openai.com/en/articles/20001256-plugins-in-codexOpenAI>
- <https://code.claude.com/docs/en/features-overview>
- <https://code.claude.com/docs/en/agents>

### Claude Computer Use·OpenHands

흡수:

- desktop observation과 action을 application-controlled environment에서 실행
- arbitrary code와 untrusted extension의 격리 runtime
- local·container·remote workspace에서 같은 execution interface
- 현재 action과 observation의 명시적 왕복

복제하지 않음:

- screenshot 전체를 매 turn 전송
- 모든 작업을 Docker/VM에 넣어 로컬 앱·사용자 파일 현실을 잃음
- Browser·Terminal·Computer의 중복 손을 동시에 기본 노출

참조:

- <https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool>
- <https://docs.openhands.dev/openhands/usage/architecture/runtime>
- <https://docs.openhands.dev/sdk/guides/agent-browser-use>

### 최신 안전 연구의 중단선

Computer Use와 self-improving Skill은 다음 반대시험을 반드시 포함한다.

- 웹·화면의 indirect prompt injection
- 여러 정상 단계로 분해된 cumulative unsafe effect
- 한 번의 위험한 성공이 durable Skill로 굳는 misevolution
- Skill authoring·retrieval·fresh execution·actual effect 분리

참조:

- <https://proceedings.neurips.cc/paper_files/paper/2025/hash/1c9818387f5dd0a0bc151214660f059d-Abstract-Datasets_and_Benchmarks_Track.html>
- <https://openreview.net/pdf?id=UMauKu2azg>
- <https://arxiv.org/abs/2608.06477>
- <https://openreview.net/pdf/f78c7628291a3b4253b1a75bfb09030d96107c34.pdf>

비교군은 원리의 출처이지 T5 화면·용어·아키텍처의 정본이 아니다.

---

## 6. 공통 측정과 채택식

### 사용자 목적

- 정확성·완전성·사용 가능 결과
- 현재 사용자 원문과 최신 교정
- 다시 설명·질문·승인·수동 복구 횟수
- first useful result·total wall
- model/tool calls·provider bytes·tokens
- local CPU·memory·disk·download/install bytes
- capability 준비 재사용률과 stale invalidation
- target 밖 effect·external write·orphan·blind retry·false completion
- Artifact·Preview·version·Undo·rollback·Delivery
- 사용자가 같은 일을 다시 맡길 의향

### 공통 채택식

```text
현재 목적 정확성·완전성·권한·진실성 무회귀
AND 실제 Console의 자연스러움·쾌적한 속도·결과 즉시 사용성 통과
AND 내부 protocol·기술 용어·경로를 사용자가 배울 필요 0
AND 목표한 새 사용자 이익이 실제 Console에서 증가
AND 현재 기반을 재사용하고 새 canonical system 0
AND 추가 비용과 제거 비용을 actual usage로 설명
AND 같은 품질의 더 경제적인 미시도 경로 없음
AND 서로 다른 세 목적에서 전용 업무 규칙 없이 같은 원리 성립
AND target 밖 effect·orphan·blind retry·false completion 0
```

속도는 모든 작업을 짧게 끝내라는 고정 초가 아니다.

```text
짧은 목적: 행정 Turn 없이 빠르게 결과
긴 목적: first useful result가 빠르고 실제 진전·중지·교정이 자연스러움
결과 목적: 사용자가 즉시 열고 확인하고 이어서 사용할 수 있음
```

모델 응답 시간이 긴 것과 T5가 불필요한 왕복을 만든 것을 구분한다. provider variance를 Runtime patch로
덮지 않지만, 제품 구조가 만든 추가 model Turn·중복 Evidence·불필요한 검증은 사용자 체감 P0로 다룬다.

모든 Gate가 세 목적 live를 필요로 하지는 않는다. deterministic contract와 한 실제 목적이 원리를 충분히 닫으면
다른 두 목적은 기존 current-head evidence를 재사용할 수 있다.

---

## 7. Gate

### S6-0 — Exact Baseline & Incident Constitution

제품 변경 0에서 시작한다.

재사용:

- 5차 exact head `f42e4db7`
- 3차 CA·M6 연구 source와 countertest
- 4차 J·K deferred evidence
- 4차 D·E·F·G·P actual
- 5차 CJ0~7 Context/Transmission/Resource/HQ evidence
- 외부 테스터의 파일·Excel·ZIP·STT·Notion·Telegram·Browser·Automation 요구

새 live 실행은 기존 evidence에 없는 다음 축만 연다.

1. 현재 제품에서 자연어 capability gap이 실제로 어떻게 끝나는가
2. `learningReviewMode=off`와 proposal mode가 foreground를 바꾸는가
3. Browser 밖 desktop app 목적을 현재 어떤 대안으로 처리하는가
4. editable presentation·brand·external mission의 실제 최초 미달
5. 현재 가장 비싼 세 사용자 여정의 exact repeated Evidence

금지:

- 후보 구현
- 새 대형 fixture matrix
- 실제 사용자 HOME·계정·비밀·외부 write
- 과거 미달을 current failure로 자동 승격

완료 문장:

> 5차 exact 제품의 현재 강점과 6차 일곱 미달이 `이미 성립·부분 성립·실제 실패·미측정`으로 분리됐고,
> 최초 구현을 여는 사용자 실패 하나와 positive control이 고정됐다. 제품 행동은 바뀌지 않았다.

---

### S6-P0 — Conversational Baseline & File Result Truth

2026-08-30 오너의 실제 설치 제품 `0.5.0` Chrome Console에서 네 결함을 직접 재현했다. 대화 화면만 보고
추론하지 않고 exact Run·Tool·Context receipt, 설치 product source, user-visible local file reality를 대조했다.
개인 파일명·경로·대화 원문은 기계 evidence에 저장하지 않는다.

근거: `refoundation/evidence/s6-owner-live-p0-baseline-2026-08-30.json`.

#### P0-01 — Commodity Conversation Observation Latency

현재 상태: `CLIENT_HAND_QUALIFIED · SINGLE_ATTACHMENT_QUALIFIED · PROVIDER_NATIVE_GROUNDING_REJECTED_SOURCE_TRUTH · UX_SPEED_PARTIAL · PRODUCT_INSTALL_NOT_YET_BUILT`

단순 서울 날씨 한 건의 실제 경로는 다음이었다.

```text
tool_search
→ web_research 3 sources·약 21KB result
→ work_completion
→ final answer
```

실측:

- wall 20.170초
- model calls 4
- tool calls 3
- provider tokens 47,501
- request bytes 229,594
- 전역 instruction 28,967 bytes가 네 요청에 반복 결속
- 정답·기상청 출처는 정확했으나 사용자 목적에 비해 관측·행정 Turn이 과함

이는 날씨 전용 기능 요청이 아니다. 가벼운 대화형 AI 표면을 다음 세 lane으로 자격한다.

```text
DIRECT:
  model 1 · Tool 0

BOUNDED_CURRENT_OBSERVATION:
  현재 웹·정확한 URL·작은 read-only lookup
  → 관련 foundational Hand를 별도 capability-discovery Turn 없이 선택
  → client tool이면 one tool round trip 뒤 final
  → provider-native server grounding이 더 정확하고 경제적이면 같은 response 안에서 사용

SINGLE_ATTACHMENT_READ:
  현재 첨부 identity가 이미 보임
  → one exact inspect/reopen
  → final
```

`tool_search`와 `work_completion`은 일반적으로 나쁜 것이 아니다. 드문 capability와 effect가 있는 장기 Work에는
계속 필요하다. 하지만 bounded read-only observation에서 별도 model Turn 전체를 독점해선 안 된다.

후보 A/B:

- 현재 directory-first + deferred Web
- 작은 foundational current-information Hand를 기본 surface에 유지
- provider-native server search/grounding을 Adapter capability로 사용하고 T5 source·Transmission truth로 정규화
- bounded read-only Work가 final answer 전 completion 의식을 요구하지 않는 실행 계약

후보를 묶어 한 번에 채택하지 않는다. visible schema bytes·cache·direct 품질과 실제 wall을 한 축씩 비교한다.
Runtime은 사용자 문장을 날씨·뉴스·가격 enum으로 분류하지 않는다. 모델이 현재성이 필요한지와 어떤 Hand를
쓸지 판단하고 Runtime은 tool execution/effect가 bounded read-only인지 사실로만 판정한다.

반대시험:

- 인사·생각·설명 요청에 Web salience 증가
- 최신성이 필요한 질문을 모델이 검색하지 않음
- 한 출처면 충분한 질문에 deep research·다중 source·큰 result
- source snippet만으로 원문 읽기 성공 주장
- 작은 PDF·DOCX·XLSX 한 개 읽기에 tool search·Work completion 추가 Turn
- 빠른 답을 위해 source·현재성·불확실성·citation을 제거

완료 문장:

> T5는 가벼운 대화는 즉시 답하고, 단순한 현재 정보와 한 첨부는 필요한 한 번의 관측만 수행해 대화형 AI다운
> 속도로 정확한 근거와 답을 제공하며, 복합 조사·행동이 필요할 때만 전체 Work 경로를 연다.

첫 후보 actual은 기존 `web_research`를 새 Tool로 복제하지 않고 directory-first의 foundational Hand로 보이게
했으며, narrow current fact에 `sourceLimit=1`을 허용하고 해당 bounded observation 뒤 `work_completion`을
활성화하지 않았다. 같은 gpt-5.6-terra·같은 synthetic public fixture에서 5차 exact 경로는 `tool_search`만 사용한
뒤 단서를 다시 물어 목적에 실패했고, 6차 후보는 `web_research` 한 번으로 exact source를 읽고 두 번째 model
call에서 정확한 답을 냈다. 직접 생각 대화는 model 1·Tool 0을 유지했다.

근거: `refoundation/evidence/s6-p0-01-bounded-web-candidate-2026-08-30.json`.

단일 attachment read의 directory-first deterministic 제품 경로도 `inspect → final` 두 model call과
`work_completion` 비노출을 통과했다. read-only list·inspect·document page search/reopen만 이 경계를 사용하며
register/finalize·output publication은 기존 Work 계약을 유지한다.

설치 제품과 같은 저장 OpenAI Search provider·gpt-5.6-terra의 actual에서는 실제 서울 날씨를 13.455초·model 2·
Tool 1·29,682 tokens·122,914 request bytes로 정확히 답했다. 오너 Live baseline 20.170초·model 4·Tool 3·47,501
tokens·229,594 bytes보다 개선됐고 `tool_search·work_completion`은 0이었다. 실제 모델 single attachment도
2.783초·model 2·Tool 1로 통과했다.

그러나 narrow 날씨 요청에서도 모델은 sourceLimit 4를 선택했고 Web Hand는 여섯 source를 반환했다. 정확한
결과라도 13초대는 최상위 UX 완료 기준에 충분하지 않다. 같은 결함 가족에 sourceLimit 조건을 더 붙이지 않고,
provider-native server search/grounding이 같은 model response에서 source와 답을 결속하는 두 번째 후보를 실제
gpt-5.6-terra로 자격했다. wall 3.097~4.637초·model 1·server search 1·약 4.9K tokens와 Direct Web call 0은
통과했지만, 현재 response의 `web_search_call.action.sources`는 `{name,type}`만 제공하고 URL·title identity와
citation annotation을 제공하지 않았다. source truth를 증명할 수 없어 후보 source·test·runner는 제품에서 모두
제거했다. 속도만 빠른 답을 채택하지 않는다.

근거: `refoundation/evidence/s6-p0-01-provider-native-rejection-2026-08-30.json`.

같은 방향의 세 번째 provider parser·Prompt patch를 붙이지 않는다. P0-01은 client Hand의 정확성·2 model call
구조와 attachment 개선을 보존하되 실제 날씨 13초대는 `UX_SPEED_PARTIAL`로 남긴다. 다음 관점은 S6-A의
검증된 typed current-data capability와 provider가 source identity를 실제 제공하는 future adapter contract에서
재평가하며, P0-02·03·04 진행을 막지 않는다.

#### P0-02 — Exact File Result Affordance

현재 상태: `ACTUAL_BROWSER_CONSOLE_QUALIFIED · EXACT_NATIVE_REVEAL_QUALIFIED`

최근 보고서 두 개의 검색 정확성과 속도는 만족스러웠다. 그러나 실제 Console은 다음 상태였다.

- `file_reality`는 exact file handle·displayName·file location을 관측했다.
- 최종 답의 파일 제목은 plain text였다.
- 모델이 별도로 출력한 `~/Downloads/` 폴더 문자열만 `path-links.js`가 `href="#"`로 바꿨다.
- `/computer/reveal`은 model-authored path를 받고 없거나 불완전하면 nearest existing parent를 연다.
- 따라서 사용자가 요청한 `파일 제목 클릭 → Finder/Explorer exact file 선택` 계약이 없다.

사용자 계약:

```text
모든 exact local-file search result
→ 사람이 읽는 파일 제목 자체가 clickable
→ raw path는 기본 답에 표시하지 않음
→ click은 model text가 아니라 Runtime-owned exact file identity/opaque handle 사용
→ click 직전 current file identity 재검사
→ macOS open -R exact file / Windows Explorer select exact file
→ stale·missing이면 nearest parent를 성공으로 꾸미지 않고 현재 사실 표시
```

파일 다운로드·Preview와 Finder/Explorer reveal은 다른 행동이다. 기존 file handle·RecordRef·Attachment·native
computer reveal 중 가장 작은 결속을 재사용하며 새 File Store를 만들지 않는다. 대화 재접속·Runtime restart 뒤에도
가능한 existing canonical identity로 링크를 복원한다.

반대시험:

- 같은 이름의 다른 파일 reveal
- 모델이 틀린 path를 써도 UI가 그 path를 신뢰
- 파일이 사라졌는데 부모 폴더를 열고 성공 표시
- Finder 링크를 만들려고 모든 search result를 무거운 Artifact로 복제
- 사용자에게 절대경로·내부 handle·schema 노출
- 제목이 아닌 별도 `위치` 줄을 눌러야 함

완료 문장:

> T5가 찾은 로컬 파일은 제목만 누르면 Finder나 파일 탐색기에서 정확한 그 파일이 선택되며, 사용자는 기술
> 경로를 읽거나 복사할 필요가 없다.

첫 후보는 `file_reality` canonical Receipt의 displayName·locationText·bytes·modifiedAt만 surface file reference로
투영한다. UI는 모델 답 안의 같은 파일 제목만 link로 만들고 click 시 exact-file flag와 현재 identity facts를
`/computer/reveal`에 보낸다. 서버는 bytes·mtime을 재검사하고 macOS `open -R` 또는 Windows Explorer select를
사용한다. stale·missing·directory이면 nearest parent fallback 없이 실패한다. 모델이 작성한 path와 새 Store는 0이다.

focused 43/43에서 exact title segment·macOS/Windows invocation·stale identity fail-closed·File Reality Console
surface·기존 Console lifecycle을 통과했다. 실제 Chrome Console에서는 Runtime의 분해형 Unicode 파일명과
모델 표기의 조합형 Unicode를 같은 파일로 결속했고, 모델이 한 글자를 잘못 쓴 제목도 같은 확장자·작은 거리의
유일한 Runtime exact title로 교정해 링크했다. 제목 클릭 뒤 Finder가 그 exact filename을 선택했다. UI는 모델
문장에 나타난 파일 후보와 직접 Evidence가 있는 후보만 링크하며 다른 bounded 후보를 무더기로 투영하지 않는다.

근거: `refoundation/evidence/s6-p0-02-exact-file-title-reveal-2026-08-30.json`.

#### P0-03 — User-Visible Storage Scope & Filename-First Recall

현재 상태: `ACTUAL_MODEL_CONSOLE_QUALIFIED · SPEED_OBSERVATION_REMAINS`

사람 이름 관련 파일 찾기의 현재 실제 결과는 실패였다.

현재 Run:

- wall 20.479초
- model calls 6·tool calls 5
- provider tokens 159,900·request bytes 652,325
- File Reality search 7.501초
- roots 20·entries 115,586·files 99,115·content probes 2,000
- coverage `truncated=true`
- 한 content match만 최종 선택
- 이름이 직접 들어간 파일은 없다고 단정

실제 컴퓨터에는 사용자에게 보이는 iCloud Drive에 query token이 파일명에 직접 들어간 파일 두 개가 있었다.
해당 iCloud Drive root만 Unicode-normalized filename scan하면 약 0.04초에 두 파일 모두 관측됐다.

원인:

1. `discoverMacOSComputerFileRoots`는 전체 `Library`를 안전하게 제외한다.
2. 별도 `local-sync-capability`는 exact iCloud Drive root를 이미 발견할 수 있다.
3. 이 user-visible local sync root가 File Reality `computer` scope에 결속되지 않았다.
4. 검색은 전체 walk 뒤 content probe와 점수 경쟁을 하며 filename evidence와 content evidence의 coverage를
   독립 정산하지 않는다.
5. coverage가 truncated인데 모델이 filename absence를 보편 사실로 확대했다.
6. 모델이 `inspect`에 네 handle을 한 번에 넣었지만 실제 action은 one-handle contract여서 오류 Turn이 추가됐다.

최소 수리 원리:

```text
qualified user-visible roots
  = standard user roots
  + already-observed local sync roots
  - whole Library/package/private roots

search phases
  1. normalized exact/substring filename evidence across every qualified root
  2. metadata/location evidence
  3. bounded content/document/OCR evidence only when needed

coverage
  filenameScope: complete | partial | unavailable
  contentScope: complete | partial | unavailable
  visualScope: complete | partial | unavailable
```

filename exact/substring match와 content mention은 모두 관련 결과지만 같은 점수 하나로 합치지 않는다. 이름 match는
사용자가 가장 직접 확인할 결과 lane으로 먼저 보이고, content match는 별도 관련 파일로 함께 제공한다. Runtime은
그 사람이 파일의 주인·대상·작성자라고 의미 선택하지 않는다.

inspect schema는 action별 실제 cardinality와 provider strict schema가 일치해야 한다. 한 file reopen만 허용할지,
작은 여러 후보를 parallel/bounded reopen할지는 actual Context·wall A/B로 정하되 invalid batch Turn을 만들지 않는다.

반대시험:

- iCloud·Dropbox·Google Drive·OneDrive local root를 전체 Library 허용으로 확대
- sync app 존재를 remote sync 성공으로 주장
- filename 결과가 content probe budget에 밀려 누락
- decomposed/composed Unicode 파일명 불일치
- coverage partial에서 `없다` 단정
- filename token이 다른 사람·문맥이라는 의미를 Runtime이 선택
- 첫 이름 결과를 찾았다는 이유로 다른 requested related files를 숨김

완료 문장:

> 사용자가 이름·문구·대략적인 위치로 파일을 찾으면 T5는 Desktop·Documents·Downloads와 실제로 관측된 로컬
> 동기화 폴더를 같은 컴퓨터 범위에서 빠르게 확인하고, 파일명에 직접 맞는 결과와 내용에 관련된 결과를 구분해
> 빠짐없이 보여주며, 확인하지 못한 범위를 없다고 말하지 않는다.

첫 후보는 기존 `discoverLocalSyncRoots`가 관측한 iCloud·Dropbox·Google Drive·OneDrive local root를 standard
computer roots 앞에 결속하고, 전체 Library는 계속 제외한다. File Reality는 content walk 전에 Unicode-normalized
filename depth-first 관측을 수행하고 filename 직접 일치를 content mention보다 먼저 정렬한다. coverage는
`filenameScope·contentScope·visualScope`로 분리한다.

실제 오너 iCloud Drive read-only 재자격은 개인 이름·경로·내용을 출력·evidence에 저장하지 않은 상태에서
filename match 2/2, filenameScope complete, 1,635 entries, 약 7.75초를 관측했다. 기존 content lane은 partial로
정직하게 남았다. focused 33/33에서 모호한 content 검색·최근 보고서·OCR·중복·stale handle·정리·rollback·
Capability truth를 보존했다.

근거: `refoundation/evidence/s6-p0-03-user-visible-filename-reality-2026-08-30.json`.

실제 gpt-5.6-terra Chrome Console에서 사용자가 폴더를 말하지 않은 자연어 요청은 `computer` scope를 선택했고,
파일명 직접 일치 2개와 내용 언급 2개를 분리해 보여줬다. filename scope 밖의 전체 파일시스템 coverage는 partial로
정직하게 표시해 false absence는 0이었다. wall 18.767초·model 3·Tool 2·35,499 tokens·172,579 request bytes였고,
정확성은 통과했지만 첫 파일 검색 속도는 후속 경제성 관측으로 남긴다. read-only search·inspect는 별도
`work_completion` 의식 없이 끝나며, 파일 변경·발행 경로의 완료 계약은 유지한다.

#### P0-04 — Product Self-Version Truth

현재 상태: `ACTUAL_SOURCE_PRODUCT_QUALIFIED · INSTALLED_PRODUCT_REBUILD_PENDING`

같은 Live 대화에서 사용자가 현재 버전을 물었을 때 T5는 `상호작용 코어 v5`를 답하고 배포 build는 확인할 수
없다고 말했다. 실제 설치 앱의 `CFBundleShortVersionString`과 `CFBundleVersion`은 모두 `0.5.0`이었다.

Interaction Core version·product release version·model version은 서로 다른 사실이다. 제품 self-state는 model
기억이나 Prompt 문구가 아니라 설치 manifest·Runtime build identity에서 공급한다.

완료 문장:

> 사용자가 T5 버전을 물으면 현재 설치 제품 버전과 필요한 경우 Interaction Core·모델을 서로 혼동하지 않고
> 실제 Runtime 사실로 정확히 답한다.

첫 후보는 macOS launcher가 실행 중 앱의 `CFBundleShortVersionString`을 읽어 `T5_PRODUCT_VERSION`으로 전달하고,
Console이 이를 stable current product identity와 self-state에 공급한다. Prompt·Interaction Core·model ID에 version
숫자를 하드코딩하지 않는다. focused countertest에서 `0.5.0` manifest fact가 Direct model 1·Tool 0 답과
self-state에 정확히 나타났다. 실제 Chrome Console에서도 candidate product identity `0.6.0-dev`를 model 1·Tool 0으로
그대로 답했다. 설치본 manifest→Runtime actual은 별도 설치 제품 자격에서 확인하며 source Gate를 다시 열지 않는다.

근거: `refoundation/evidence/s6-p0-04-product-version-truth-2026-08-30.json`.

#### S6-P0 공통 종료 조건

현재 판정: `CLOSED_WITH_P0_01_SPEED_CARRY_TO_S6_A · P0_02_03_04_ACTUAL_CONSOLE_QUALIFIED`

```text
날씨·현재 단일 fact·exact URL·작은 단일 attachment가 불필요한 administrative Turn 없이 완료
AND direct conversation model 1·Tool 0 무회귀
AND exact file title click→exact Finder/Explorer selection
AND user-visible local sync root의 filename match 누락 0
AND filename/content/visual coverage partial의 false absence 0
AND 제품 version truth 정확
AND 업무·서비스·질문 Intent Router 0
AND 새 canonical Store 0
AND 전체 File Reality·Artifact·Memory·Connection positive control 무회귀
```

S6-P0는 S6-A보다 먼저 닫는다. 이 P0를 Capability Acquisition이나 Computer Hand로 우회하지 않는다.

2026-08-30 closeout에서 P0-02·03·04와 bounded attachment는 실제 Chrome Console·focused regression·전체
CI에서 닫혔다. P0-01의 generic client Web은 오너 설치 baseline보다 model/tool/bytes/wall을 줄이고 source truth를
보존했지만 실제 서울 날씨 11.089초는 최상위 쾌적성 기준에 충분하지 않았다. source identity가 없는 빠른
provider-native 후보는 폐기했고 같은 방향의 세 번째 patch를 금지했다. 따라서 P0를 미완료 채로 반복하지 않고,
현재 정보를 검증된 typed capability로 더 경제적으로 관측할 수 있는지 S6-A의 첫 실제 결함으로 이월한다.

근거: `refoundation/evidence/s6-p0-closeout-2026-08-30.json`.

---

### S6-A — Capability Reality & Admission

현재 상태: `COMPLETE · ACTUAL_MODEL_QUALIFIED · NO_NEW_STORE_ROUTER_OR_DEFAULT_SCHEMA`

현재 분산된 Connection·Capability catalog·managed Skill·CLI·MCP·platform reality를 새 Store 없이 한 현재 사실로
모델에 공급한다.

모델이 알아야 할 최소 사실:

```text
usable_now | available_inactive | needs_auth | preparable | degraded | incompatible | unknown
+ input/output capability
+ local/external execution
+ required secret·filesystem·network·child·external effect
+ platform·architecture
+ observed quality·cost·failure alternative
+ exact source/qualification handle
```

Runtime은 사용자의 업무명으로 capability를 고르지 않는다. 모델이 현재 목적과 위 사실을 보고 `기존 손 사용·
준비·사용자 경계·추가 조사·현재 불가능`을 판단한다.

반대시험:

- installed record만 있고 executable·credential·permission이 없는데 usable 주장
- 현재 대안이 있는데 새 package 검색
- capability 부재를 모델 변경으로 떠넘김
- catalog 전체·비활성 schema·Skill 본문을 기본 Context에 투영
- 다른 Session·channel의 capability를 현재 권한으로 재사용

완료 문장:

> T5는 현재 목적에 이미 사용할 수 있는 손, 부족한 이유, 준비 가능한 대안과 현재 불가능을 작고 정확하게
> 구분하며, 모델이 그 현실을 보고 가장 경제적인 방법을 선택한다.

첫 slice는 기존 `capability-reality.js` 연구 계약을 새 Store 없이 제품 entry에 결속했다. 이 Tool은 기본 schema에
상주하지 않고 실제 capability gap에서 `tool_search`로 한 번 발견되며, current Connection과 bundled catalog를
`usable_now·preparable·degraded…`로 분리한다. read-only Reality 확인은 `work_completion` Turn 없이 답으로 끝난다.
focused 15/15에서 Direct 기본 표면 비증가·한 번 발견·closed reality enum·acquisition 미개통을 확인했다.

두 번째 slice는 기존 managed Skill surface, managed CLI manifest·active generation, 현재 platform·architecture를
같은 content-free Reality에 합쳤다. CLI status 관측은 reconciliation write 없이 실행되고, Skill 본문·managed path·
digest·사용자 파일은 provider에 투영하지 않는다. source coverage는 current Connection·bundled catalog·managed
Skill·managed CLI·host platform별로 complete/partial을 분리한다.

첫 actual gpt-5.6-terra는 “실행하지 마”의 `executing`을 짧은 Tool 이름 `exec`와 접두어 일치로 오선택해
Capability Reality를 사용하지 않았다. 짧은 Tool name은 exact token이 아니면 긴 자연어 단어와 prefix만으로
선택하지 않는 일반 검색 원리로 수리했다. 동일 문장 재시험은 `tool_search → capability_reality → final`만 사용해
현재 사용 가능·인증 필요·준비 후보·현재 전용 날씨 capability 부재를 구분했다. wall 9.915초·model 3·Tool 2·
26,560 tokens·140,745 request bytes·work_completion 0·설치/실행/외부 effect 0이었다.

마지막 slice는 required secret·filesystem·network·child/external effect와 exact source handle을 existing manifest·
policy·active generation에서 파생했다. source별 coverage가 complete가 아닐 때 universal absence를 주장할 수 없고,
서로 다른 source가 같은 fact id를 주장하면 첫 항목을 임의 선택하지 않고 닫힌다.

최종 actual gpt-5.6-terra는 동일 자연어 요청에서 `tool_search → capability_reality → final`만 사용했다. 34 facts·
19,777 receipt bytes, wall 12.202초·model 3·Tool 2·29,174 tokens·150,423 request bytes였으며 설치·실행·외부 effect·
work_completion은 0이었다. 이는 전체 능력 목록을 요청한 여정의 측정치이며 일반 대화의 기본 Context 비용은 0이다.
모델은 현재 usable, needs-auth, preparable과 typed weather capability 부재, generic Web 대안을 정확히 구분했다.

전체 CI는 제품 통합 201/203·실패 0·Windows 물리 자격 2 skip·mutation 2/2로 닫혔다. 첫 두 CI에서 동일
after-delivery 후속 Work의 마지막 Run append와 임시 root 삭제가 경합한 사실을 숨기지 않았다. 테스트 sleep을
늘리지 않고 Runtime shutdown이 이미 시작한 scheduled Work promise를 정산한 뒤 connection을 닫도록 수리했고,
최종 전체 CI에서 같은 결함은 재현되지 않았다.

따라서 S6-A 완료 문장은 성립한다. catalog에 typed current-data capability가 없다는 사실은 숨기지 않고 S6-B/C의
첫 acquisition 목적 후보로 이월한다. S6-A가 날씨 속도 자체를 해결했다고 주장하지 않는다.

근거: `refoundation/evidence/s6-a-capability-reality-baseline-2026-08-30.json`.
actual 근거: `refoundation/evidence/s6-a-capability-reality-product-2026-08-30.json`.

---

### S6-B — Quarantine, Qualification & Lifecycle

현재 상태: `OPEN · READ_ONLY_BASELINE_FIRST · PRODUCT_CANDIDATE_0`

새 package engine을 만들지 않고 기존 source identity·managed store·Capability lifecycle·Effect·rollback을 확장한다.

지원 순서는 실제 실패가 연 종류만 하나씩 연다.

1. Agent Skill
2. managed CLI
3. remote MCP
4. 별도 process executable extension
5. declarative T5 package

첫 완료에서 Core in-process arbitrary Plugin은 제외한다.

상태 전이:

```text
candidate
→ source_resolved
→ quarantined
→ structurally_checked
→ task_qualified
→ installed_inactive
→ current_scope_active
→ actual_purpose_verified
→ reusable
→ updated | rolled_back | archived | removed
```

필수 Evidence:

- source owner·exact ref/version·artifact digest·license
- dependency·install script·entrypoint
- platform·architecture·filesystem·network·secret·external effect
- prompt/data injection boundary
- positive control·counterexample·same-purpose result
- install/update/remove/rollback 후 physical reality
- Context·log·error의 secret 원문 0

scanner·별점·download 수·공식 catalog 존재는 단독 합격이 아니다. 새 generation은 과거 qualification과 권한을
자동 상속하지 않는다.

완료 문장:

> T5는 외부 능력을 Core와 사용자 파일에서 격리해 준비하고, 정확한 source와 현재 컴퓨터에서 같은 사용자
> 목적을 실제로 통과한 generation만 활성화하며 실패·update·제거 뒤 이전 검증 상태로 복구한다.

---

### S6-C — Natural Acquisition & Exact Work Resume

사용자는 Skill·CLI·MCP·Plugin을 말하지 않는다. 자연어 목적에서 현재 capability gap이 실제로 확인될 때만 S6-B를
사용한다.

```text
current Work/revision
→ existing capability exhausted or exact requirement missing
→ model requests candidate investigation
→ Runtime source·permission·cost facts
→ managed qualification
→ activation generation commit
→ original Work exact once resume
→ actual purpose·Artifact·Effect·Delivery verification
```

일반 exec command를 정규식으로 package 필요 요청으로 분류하지 않는다. 모델이 프로그램·공식 CLI·MCP·Computer
Hand 중 무엇이 필요한지 판단하며 Runtime은 각 경로의 실제 요구를 공급한다.

반대시험:

- 설치만 성공하고 원래 목적은 실패했는데 achieved
- 준비 중 사용자 교정·취소 유실
- Runtime crash 뒤 install·external effect·Work blind retry
- 같은 capability를 Session마다 재설치
- 사용자가 이미 말한 비밀·scope를 다시 질문
- 현재 경량 대안보다 느린 capability를 장식품으로 채택

세 대표 목적:

- 긴 녹음 STT·요약·원문 Artifact
- 현재 없는 public data/CLI 처리
- 공식 remote workspace read 또는 bounded write

완료 문장:

> 사용자는 필요한 능력의 이름을 몰라도 목적만 말하며, T5는 부족한 능력을 안전하게 준비한 뒤 같은 작업을
> 중복 실행 없이 이어가 실제 결과까지 전달한다.

---

### S6-D — Experience Growth Proposal & Review

기존 Reflection·Learning source를 default-on으로 바꾸기 전에 proposal-only 제품 A/B를 연다.

source가 될 수 있는 것:

- 실제 achieved Work
- exact user correction
- actual Tool/Effect/Artifact/Delivery terminal
- 서로 다른 Work·Run의 반복 가능한 method trace
- independent counterexample

source가 될 수 없는 것:

- 모델의 자기 평가
- Run completed 하나
- 사용자 persona 추론
- 외부 화면·문서의 instruction
- 한 번의 성공
- effect unknown·delivery 실패·unresolved Work

proposal은 적용이 아니다. 사용자가 자연어로 `검토용으로 남김·사용하지 않음·나중에`를 선택할 수 있고,
foreground 작업과 기본 Context를 바꾸지 않는다.

측정:

- proposal precision
- 사용자 current correction 충돌
- foreground 추가 call·wall·Context
- duplicate/overfit proposal
- proposal source reopen 가능성
- 개인정보·비밀·일회성 identifier 복제 0

완료 문장:

> T5는 실제로 끝난 여러 경험과 반례에서 재사용 가능한 방법 후보만 출처와 함께 제안하며, 아직 배운 능력이나
> 사용자 사실로 적용하지 않는다.

---

### S6-E — Field Qualification, Promotion & Rollback

S6-D proposal을 기존 Learning trial·comparison·Capability lifecycle로 검증한다.

```text
proposal
→ baseline/candidate alternating replay
→ source Work와 독립된 holdout
→ fresh field purpose
→ correctness·completeness·correction·effect·delivery
→ wall·calls·tokens Pareto
→ reversible activation
→ actual use observation
→ regression rollback
```

자동 활성화 가능한 첫 범위는 T5 관리 procedural Skill뿐이다. external package 설치, secret scope 확대, Core
수정, 외부 전송, 돈이 드는 행동은 Experience Growth가 수행하지 않는다.

사용자 review를 모든 저위험 승격에 강제하지 않는다. exact independent qualification과 reversible managed scope가
성립하면 자동 활성화할 수 있으며, 사용자는 변경 이력·출처·효과를 확인하고 비활성·철회·복원할 수 있다.

반대시험:

- unsafe success가 durable Skill로 승격
- candidate가 authoring만 되고 fresh Session에서 사용되지 않음
- retrieval은 됐지만 current correction보다 우선
- faster-but-wrong·same-source holdout·dependent evaluator
- 회귀 뒤 Skill이 active로 남음
- 오래된 method가 더 나은 current capability를 가림

완료 문장:

> T5는 실제 경험에서 검증된 더 나은 방법만 다음 작업에 사용하고, 사용자가 덜 설명하고 덜 고쳐도 같은
> 품질을 내며, 회귀하거나 현재 교정과 충돌하면 즉시 이전 방법으로 돌아간다.

---

### S6-F — Scoped Computer Observation

Browser·Terminal·File로 충분하지 않은 실제 desktop app 목적 하나가 재현될 때만 Computer Hand를 연다.

관측 범위:

- current foreground application identity
- current authorized window identity
- bounded accessibility structure
- 현재 목적에 필요한 visible text·control·state
- accessibility로 부족할 때만 bounded screenshot crop
- secret·password·OTP·payment·identity field presence
- observation scope·freshness·coverage·untrusted content

화면 내용은 Evidence이며 instruction authority가 아니다. app/web 문구가 Tool·Terminal·Connection·외부 전송을
지시해도 사용자 지시로 승격하지 않는다.

Browser·공식 API·인증 CLI가 같은 목적을 더 정확하고 경제적으로 해결하면 Computer Hand를 사용하지 않는다.

금지:

- 상시 screenshot·screen video·OCR
- keylogging·clipboard 원문 수집
- 전체 accessibility tree provider 전송
- window title·메일·채팅 본문 상시 History
- 좌표·control map의 durable 사용자 persona화

완료 문장:

> T5는 사용자가 현재 맡긴 데스크톱 앱의 필요한 화면 현실만 관측하고, 비밀과 화면 속 지시를 분리하며,
> 보지 않은 앱·창·상태를 안다고 말하지 않는다.

---

### S6-G — Scoped Computer Action & Recovery

S6-F observation이 발급한 exact current control만 행동에 사용한다.

```text
fresh observation
→ exact app/window/control handle
→ intended effect·authority preflight
→ one bounded action or safe batch
→ app/window/file/network/external effect observation
→ user purpose comparison
→ cancel·rebind·rollback or honest unknown
```

stale window·modal·tab·control은 자동 좌표 fallback으로 우회하지 않는다. current reality를 다시 관측하고 같은
사용자 목적에서 한 번 재결속한다. 비밀 입력은 모델·Conversation·screenshot·log를 거치지 않는 전용 surface가
소유한다.

필수 보안 holdout:

- visual prompt injection
- cross-origin 또는 다른 app 정보의 외부 전송
- 정상 행동 여러 개의 cumulative unsafe effect
- stale control·창 종료·modal·앱 crash
- cancel 뒤 late action·orphan helper
- user-visible success와 실제 file/account effect 불일치

세 대표 목적:

- Notes/Voice Memos 또는 동등 local content handoff
- authenticated office app의 bounded edit/export
- API·CLI가 없는 legacy desktop workflow의 read→one reversible action→readback

완료 문장:

> 사용자는 이미 사용하는 데스크톱 앱을 자연어로 맡기며, T5는 현재 화면과 control을 정확히 확인한 뒤
> 허용한 범위의 행동만 하고 실제 결과를 다시 읽어 전달하며, 실패·취소·앱 종료 뒤 멋대로 계속하지 않는다.

---

### S6-H — Professional Deliverable Completion

새 디자인 앱 없이 기존 Document·Structured Authoring·DesignReceipt·Artifact를 완성한다.

우선 실제 미달:

- editable PPTX 전체 slide·font·overflow·source trace
- user-approved brand source와 current correction
- screen·print·editable·presentation medium truth
- 여러 version의 부분 교정과 exact lineage
- 긴 source attachment의 외부 결과 전달

흐름:

```text
사용자 목적·사용처
→ output medium 선택
→ 기존 authoring Hand
→ 전체 page/slide render
→ factual content·geometry·font·glyph·contrast·accessibility receipt
→ model repair
→ exact reopen
→ Artifact version·Preview·download·Undo
```

HTML/PDF가 아름답다는 이유로 editable PPTX를 주장하지 않는다. template·palette·font·업종으로 디자인을
Runtime이 선택하지 않는다. 브랜드는 사용자 승인 source와 current correction만 사용한다.

완료 문장:

> T5는 보고서·표·문서·발표자료를 실제 사용 매체에 맞게 만들고 모든 page·slide를 다시 확인하며, 사용자가
> 부분 교정을 말하면 같은 결과물 lineage에 반영해 편집 가능한 최종본과 미확인을 함께 전달한다.

---

### S6-I — Actual External Mission

Connector 수를 늘리는 Gate가 아니다. 기존 Connection·Automation·Effect·Delivery가 실제 외부 사용자 목적을
끝내는지 대표 공식 연결에서 자격한다.

지원 순서:

```text
read-only current reality
→ one reversible write or draft
→ exact external readback
→ scheduled occurrence with fresh capability/authority
→ Delivery and user surface
```

대표 목적은 실제 사용자 수요가 있고 human-controlled test account를 준비할 수 있는 최대 세 개만 선택한다.

- mail/attachment
- calendar/schedule
- workspace document/file handoff

자동 CI는 mock·loopback·synthetic account만 사용한다. 실제 계정 자격은 사용자가 직접 통제하는 별도 human
qualification에서만 실행하고 새 상대·비밀·비용 경계를 그대로 유지한다.

필수 반대시험:

- schedule 생성 성공을 미래 목적 성공으로 승격
- 실행 시 capability·로그인·authority stale
- 외부 ACK 유실 뒤 blind retry
- read 요청이 account state를 변경
- Console-origin 결과의 잘못된 channel delivery 주장
- 실제 URL·page/file readback 없이 완료

완료 문장:

> T5는 연결과 예약이 존재한다는 이유로 일을 끝냈다고 말하지 않고, 실행 시점의 권한과 현실을 다시 확인해
> 외부 결과가 실제로 생기고 다시 열리며 사용자에게 도착했을 때만 목적 완료로 전달한다.

---

### S6-J — Economy Close

새 Context architecture를 만들지 않는다. S6-A~I actual에서 사용자 이익을 유지한 채 가장 비싼 결함 가족 최대
세 개만 연다.

현재 우선 후보:

1. 같은 Evidence·source의 반복 reopen
2. Browser/Computer navigate·snapshot·action 뒤 불필요한 재검증
3. Artifact verify·inspect·register·completion 사이 중복 projection

실제 profiler는 다음을 분리한다.

- local deterministic work
- provider wait·generation
- tool execution
- verification
- publication·delivery
- repeated Context bytes
- first useful result와 final completion

금지:

- global Prompt 재작성
- 모든 provider canonical rebuild
- 정확성·독립 검증·Undo 제거
- fixed call/token/time cap
- 모델별 업무 Prompt
- 결과가 늦다는 이유로 false partial completion

완료 문장:

> T5는 6차의 새 능력과 기존 정확성·복구를 보존하면서 같은 Evidence와 검증을 이유 없이 반복하지 않고,
> 사용자가 첫 유용한 결과를 더 빨리 받으며 전체 비용 증가가 실제 이익으로 설명된다.

---

### S6-L — Windows Physical Product Qualification

새 Windows 제품을 만들지 않는다. S6-A~J가 닫힌 exact head에서 같은 T5 의미가 실제 Windows 손에서 성립하는지
자격한다.

순서:

1. physical Windows x64
2. physical Windows ARM64
3. product Console human journeys

필수 현실:

- PowerShell·CMD·`.cmd` direct argv
- ConPTY·Job Object process tree·crash containment
- DPAPI secret owner
- NTFS ACL·hardlink·junction·reparse·case·volume identity
- Windows Search·OCR·document/presentation render
- Browser·Computer Hand·file reveal
- Capability install/update/rollback/remove
- Artifact·Undo·backup/restore
- actual model·channel·external mission representative

GitHub runner·WSL·emulation·cross-build는 physical PASS를 대신하지 않는다. x64 성공은 ARM64 성공을 대신하지 않는다.

완료 문장:

> 같은 T5 머리·기억·능력 획득·성장·컴퓨터 손·결과·복구 약속이 macOS와 Windows의 실제 제품 Console에서
> 각각 성립한다.

---

### S6-HQ — Final Android Human Qualification

모든 기술 Gate가 닫힌 exact clean head에서 한 번만 실행한다. runner는 fixture 준비·원장 회수·oracle에만
사용하고, 사용자의 시작·입력·진행·교정·결과·Preview·Undo·재접속은 실제 Console UI에서 수행한다.

필수 인간 목적은 기능별 smoke가 아니라 다음 열 개 mission이다.

1. 직접 대화·단일 현재 정보·한 첨부: interactive latency positive control
2. 최신 공개 조사: current official source와 정직한 external boundary
3. 장기 Memory·현재 교정·forget
4. standard·local sync 범위의 filename/content/OCR 파일 발견·title reveal·exact delivery
5. 복합 Excel·문서·editable presentation·version·Undo
6. 처음 보는 목적의 capability gap→safe acquisition→exact Work resume
7. 반복 목적의 Experience Growth→덜 설명→회귀 rollback
8. Browser·desktop app의 현재 화면→action→readback
9. external mission·scheduled execution·actual Delivery
10. 장기 실행·busy input·cancel·Runtime restart·backup/restore·Windows

비교:

- 5차 exact baseline
- 6차 candidate
- 동일 모델의 direct response/available hands
- OpenClaw·Hermes·Codex·Claude/OpenHands에서 확인한 같은 목적의 원리

경쟁군의 화면·기능 수를 비교하지 않는다. 다음 사용자 성과를 비교한다.

- 목적 정확성·완전성·결과 사용성
- 사용자가 배워야 하는 기술·설정·승인
- first useful result·wall·calls·tokens·bytes
- capability 준비와 재사용
- current correction·Memory precision
- target 밖 effect·prompt injection·false completion
- cancel·restart·rollback·remove
- 같은 일을 다시 맡길 의향

HQ 중 재현된 P0/P1만 통합 책임자 한 명이 순차 수리한다. P2 미관·경미한 비용은 기록하되 완료 blocker로
무한 확대하지 않는다. 같은 결함 가족의 세 번째 patch는 금지한다.

최종 합격식:

```text
S6-P0·S6-A~J exact 완료 또는 정직한 제품 변경 0 관측 종료
AND macOS actual mission PASS
AND Windows x64·ARM64 physical mission PASS
AND acquisition·growth·computer·external effect의 false completion 0
AND 현재 사용자 원문·교정·Memory·dirty change·권한 무회귀
AND target 밖 effect·orphan·blind retry·late action 0
AND Artifact·Preview·download·version·Undo·rollback 실제 작동
AND 5차보다 이유 없는 first useful result·calls·tokens 악화 없음
AND 전체 CI·clean tree
```

완료 문장은 이 문서 1절의 최종 완료 문장 전체다.

---

## 8. 명확한 비목표

- 사용자에게 Agent Team·Skill·Plugin·MCP·sandbox mode 선택 요구
- 모든 서비스 Connector·모든 메신저·모든 cloud 지원
- Plugin marketplace·별도 Capability ERP·Prompt CMS
- 업종별 Pack·workflow·Intent Router·service mapping
- 새 Memory DB·RAG·graph·persona
- 상시 screen/audio/clipboard/keylogging Recall
- Browser·Computer 화면의 instruction authority
- arbitrary Core in-process code load
- 학습한 Skill의 즉시 영구 활성화
- Experience Growth를 사용자 정체성·성과 평가로 사용
- 모든 작업의 multi-agent화
- 모든 shell을 무거운 VM에 넣기
- G exact actual-read tracing 재개
- 모든 provider·adapter·Prompt 동시 재작성
- 모든 변경 자동 rollback 또는 모든 shell의 완전 confinement 주장
- 자동 domain 구매·결제·Production 무승인 공개
- macOS 성공을 Windows PASS로 주장

---

## 9. 실행·Git·증거 규율

구현 시작 전:

```text
5차 exact head·tag·clean tree 확인
→ 별도 6차 branch/worktree 생성
→ S6-0 제품 변경 0
→ 오너에게 baseline·최초 failure·첫 후보 보고
→ 한 Gate씩 구현
```

각 Gate:

```text
실제 사용자 실패
→ 현재 source·prompt/context/wire/receipt 확인
→ 비교군 원리의 실패 경계 확인
→ 가장 작은 candidate
→ deterministic countertest
→ 동일 목적 actual A/B
→ 채택 또는 완전 폐기
→ 작은 evidence JSON
→ focused regression
→ clean commit
```

- 기존 변경과 다른 worktree는 사용자 소유다.
- `git add -A`, amend, 자동 merge를 사용하지 않는다.
- 실패 candidate source·feature flag·dead schema를 제품에 남기지 않는다.
- 같은 사실의 별도 총괄 문서·인계서·봉인문을 만들지 않는다.
- evidence에는 사용자 원문·실경로·비밀·실계정 자료를 복제하지 않는다.
- major line close 전 full CI를 반복하지 않는다.
- 제품 수정은 통합 책임자 한 명이 수행하고 읽기 전용 감사만 병렬화한다.

---

## 10. 전체 중단·부분 종료 규칙

다음이면 해당 Gate를 성공으로 꾸미지 않는다.

- 실제 사용자 이익 없이 기능·Tool·Context만 증가
- 모델별·업무별 Prompt나 Runtime 의미 Router가 필요
- acquisition이 현재 경량 경로보다 반복 열세
- growth가 current correction·privacy·안전·품질을 침해
- Computer Hand가 화면 지시와 사용자 지시를 분리하지 못함
- 전문 산출물이 source truth·editable medium·전체 coverage를 잃음
- external mission이 actual effect·readback·delivery를 증명하지 못함
- 경제성 후보가 정확성·Undo·독립 검증을 제거해야만 성립
- 같은 결함 가족의 두 후보 실패 뒤 다른 원리가 없음

해당 Gate는 다음처럼 닫는다.

```yaml
status: CLOSED_WITH_OBSERVATION
product_candidate_adopted: 0
current_fifth_capability_preserved: true
failure_and_cost_retained: true
```

단, 다음은 최종 6차 완료에서 유예할 수 없는 물리 blocker다.

- Windows x64·ARM64 physical qualification
- acquisition의 source·qualification·rollback truth
- bounded conversational observation latency와 exact file reveal/search truth
- Experience Growth의 fresh-field safety·regression rollback
- Computer Hand의 prompt injection·secret·effect·cancel 경계
- actual external mission의 effect·readback·Delivery 진실

이 blocker가 실패하면 6차 전체 완료를 주장하지 않는다.

---

## 11. 현재 첫 작업

현재 허용된 작업은 이 정본의 검토와 S6-0 preparation뿐이다. 제품 코드는 아직 열지 않는다.

정확한 다음 순서:

```text
1. f42e4db7에서 6차 독립 worktree 생성
2. 기존 CA·M6·Computer·VD·external·Windows evidence reuse index 작성
3. 현재 source의 product entry와 default-off/research-only 배선 확인
4. 격리 Console의 capability gap·learning off/proposal·desktop app baseline 고정
5. 오너 Live P0 네 가족을 S6-P0에서 순서대로 개통하되 한 번에 한 축만 변경
```

첫 구현 전 오너에게 다음 일곱 줄을 보고한다.

1. 제품 약속
2. 현재 Gate
3. Gate 사용자 완료 문장
4. 이미 선 실제 증거
5. 현재 가장 큰 미달
6. 첫 변경이 미달을 줄이는 방식
7. non-goals

이 일곱 줄이 exact source·실행·evidence에서 확인되지 않으면 구현하지 않는다.
