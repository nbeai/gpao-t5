# T5 Sixth Completion — Android Capability, Growth & Computer Reality

상태: `SIXTH_MACOS_SOURCE_CANDIDATE_COMPLETE · OWNER_UX_TOP_GOAL_LOCKED · S6_P0_CLOSED_WITH_SPEED_CARRY · S6_A_COMPLETE · S6_B_COMPLETE · S6_C_COMPLETE_WITH_STT_GAP · S6_D_PRODUCT_ACTIVE_ADMISSION_HARDENED · S6_E_PRODUCT_PIPELINE_ACTIVE_COMPLETE · S6_F_CLOSED_WITH_OBSERVATION · S6_G_NOT_OPEN · S6_H_COMPLETE · S6_I_PHYSICAL_HUMAN_QUALIFICATION_PENDING · S6_J_COMPLETE · S6_WA_COMPLETE_MACOS_WINDOWS_EXPLICIT · S6_UX_PRODUCT_CANDIDATE_COMPLETE_ACTUAL_CONSOLE · TOTAL_HUMAN_HQ_EXECUTION_ACTIVE · MACOS_6_0_PACKAGE_PENDING_AFTER_HQ · WINDOWS_PREPHYSICAL_PLANNED_AFTER_PACKAGE · FIFTH_BASELINE_F42E4DB7 · WINDOWS_DEFERRED_NOT_WAIVED · INSTALLER_NOT_BUILT`
5차 불변 귀환선: `f42e4db7 · FIFTH_COMPLETION_COMPLETE · MACOS_PRODUCT_SCOPE`
현재 Gate: `TOTAL HUMAN HQ → OPTIONAL OWNER LIVE RECHECK → MACOS 6.0 PACKAGE → WINDOWS PRE-PHYSICAL READINESS`
현재 작업: `TOTAL_HQ_EXECUTION · DO_NOT_OPEN_WINDOWS_WORK_OR_BUILD_PACKAGE_BEFORE_HQ_CLOSE`

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

현재 상태: `COMPLETE_EXISTING_PRODUCT_TYPES · DECLARATIVE_OBSERVE_ENGINE_QUALIFIED · UNSOURCED_PRODUCT_ACTIVATION_0`

읽기 전용 baseline에서 기존 기반 39/39를 재자격했다.

- trusted text Skill: managed root 0600·install·recoverable remove·restore가 제품에 존재
- managed CLI: exact version·platform asset·SHA-256·executable probe·inactive/active·update·rollback·remove가 제품에 존재
- Remote MCP: OAuth attempt·credential generation·account identity·scope·refresh·disconnect·unknown effect가 제품에 존재
- capability lifecycle/handoff: same-purpose comparison 전 tested 금지, apply·archive·restore, crash 뒤 blind resume 0이 제품에 존재
- declarative/executable package: closed Machine Manifest, unsafe tree 차단, installed-inactive generation, enable/disable·rollback·remove가
  qualification source로 존재하지만 제품 entry에는 미결속

따라서 Skill·CLI·Remote MCP lifecycle을 다시 만들지 않는다. 현재 첫 실제 공백은 package를 안전하게 저장하는
능력이 아니라, active generation의 declared observe action을 별도 process에서 실제 실행하고 task qualification·
Capability Reality에 결속하는 제품 executor가 없다는 것이다. P0-01 carry의 typed current-data는 이 공백을 여는
대표 목적이 될 수 있지만 Runtime이 날씨라는 업무명으로 route를 고르지는 않는다.

다음 후보는 secret 0·한 HTTPS host·observe-only·closed input/output·source citation을 가진 declarative action 하나를
기존 package store와 D 실행 원장에 결속하는 범위만 검토한다. 같은 package에서 external change·임의 install hook·
Core in-process code·일반 HTTP proxy를 함께 열지 않는다.

근거: `refoundation/evidence/s6-b-lifecycle-baseline-2026-08-30.json`.

첫 qualification slice는 `LocalCapabilityPackageStore.openActive`와 trusted declarative observer helper를 추가했다.
active generation의 package manifest·payload를 exact reopen하고, no-secret·observe-only·한 host·closed scalar args인
action만 별도 process에서 GET으로 실행한다. helper는 credential-free HTTPS, redirect 0, JSON success, 256KiB output,
timeout을 물리 집행하고 Runtime은 returned URL·status·content type을 독립 대조한다. 모델은 URL·header·command를
직접 받지 않는다.

loopback actual은 helper process exact 1회·약 52ms로 source URL과 publisher identity를 보존했다. inactive package,
unknown arg, missing/write action, manifest tamper는 helper/network 전에 닫혔다. 이 과정에서 기존 store가 payload
digest만 저장하고 `capability.json` 자체 digest를 generation에 결속하지 않은 P1을 발견해 manifest digest exact
readback을 추가했다.

외부 weather 후보는 아직 제품에 채택하지 않았다. Open-Meteo free API는 평가·비상업 용도이고 상용 endpoint는
유료 key가 필요하다. 기상청 API허브는 무료이지만 회원가입·개인 authKey가 필요하다. 앞서 provider-native OpenAI
검색도 공식 API 문서상 URL citation을 지원하지만 현재 gpt-5.6-terra actual이 URL/title을 주지 않았으므로 같은
방향의 세 번째 patch를 열지 않는다. 따라서 이번 slice는 executor qualification이며 제품 entry·실제 외부 호출·
자연어 activation은 0이다.

근거: `refoundation/evidence/s6-b-declarative-observe-qualification-2026-08-30.json`.

S6-B 완료 범위는 실제 product-supported Agent Skill·managed CLI·Remote MCP와 qualification-only declarative
observer engine이다. arbitrary executable extension과 Core in-process Plugin은 열지 않았고, 법적·credential·source
경계가 닫히지 않은 외부 package를 제품에 활성화하지 않았다. 이 범위에서 source·generation·격리·task
qualification·inactive install·activation·update·rollback·archive/remove 계약이 성립하므로 S6-B를 닫는다.

focused 46/46과 전체 제품 통합 201/203·실패 0·Windows 물리 자격 2 skip·mutation 2/2를 통과했다.

완료 근거: `refoundation/evidence/s6-b-closeout-2026-08-30.json`.

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

현재 상태: `COMPLETE_SUPPORTED_TYPES · STT_CAPABILITY_GAP_NOT_WAIVED`

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

첫 current-head slice에서 `capability_prepare`와 `cli_prepare`의 실제 model Tool schema에는 `reversible` 필드가
없는데 preflight가 그 금지된 필드를 요구해 정상 install이 항상 `reversible_local_change_required`로 막히는 P1을
재현했다. 두 도구를 공통 Effect 계약인 `local_change + confirmation=not_applicable`에 맞췄다. list/search/preview와
CLI status는 read-only이므로 별도 completion proposal을 열지 않고, 실제 lifecycle mutation에서만 연다.

수리 후 현재 head에서 세 경로 9/9를 통과했다.

- 고객 문의 분류: package 이름 없이 trusted text Skill 검색→설치→같은 Run 목적 완료
- JSON 처리: exact CLI 검증 준비→같은 Run 실제 사용→새 Session 재설치 0
- Linear: 사용자 로그인 handoff→원래 오늘 마감 업무 exact once resume
- 공통: 준비 대기 model polling 0, 두 Session 혼선 0, crash 뒤 blind retry 0, surface crash exact recovery

현재 컴퓨터에는 reusable STT executable·model generation이 없고 `faster-whisper` wheel cache 일부만 있었다. 이는
실행 가능한 capability가 아니다. 비교군의 local Whisper는 package manager 설치와 첫 model download를 요구하고,
hosted transcription은 API key·사용료 경계가 있다. 사용자 몰래 설치·대형 model download·유료 호출을 하지 않았다.
STT는 `CAPABILITY_GAP_NOT_WAIVED`로 최종 HQ와 후속 capability source 결정에 이월한다.

current public-data external actual도 lawful no-secret source를 찾지 못했다. Open-Meteo free endpoint는 비상업·평가,
기상청 API는 개인 authKey가 필요하고, current provider-native OpenAI search는 source identity를 반환하지 않았다.
이를 이유로 S6-C의 검증된 Skill·CLI·Remote MCP resume까지 미완료로 되돌리지는 않는다. supported capability type에서
완료 문장이 성립하므로 S6-C를 닫되 STT·weather 속도는 6차 전체 완료의 비주장으로 보존한다.

focused 24/24와 전체 제품 통합 202/204·실패 0·Windows 물리 자격 2 skip·mutation 2/2를 통과했다.

근거: `refoundation/evidence/s6-c-natural-acquisition-first-slice-2026-08-30.json`.
closeout: `refoundation/evidence/s6-c-closeout-2026-08-30.json`.

---

### S6-D — Experience Growth Proposal & Review

현재 상태: `PRODUCT_ACTIVE_COMPLETE · PROPOSAL_DEFAULT_ON · INCIDENT_ADMISSION_HARDENED · FOREGROUND_NONBLOCKING`

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

current-head 감사에서 learning reviewer·candidate·eligibility·scheduler 핵심 source는 기존 실제 모델 자격 이후
변경되지 않았고 Console 배선만 진화했다. 기존 actual은 gpt-5.6-terra와 gpt-5.5 모두 서로 다른 achieved Episode
두 개에서 proposal exact 1개·model 2 turn·Tool 1을 통과했으며 reviewer wall은 각각 12.125초·12.937초였다.

6차 설치 제품 entry는 이제 `learningReviewMode=proposal`을 기본 사용한다. Core factory 기본값은 off로 유지해
격리 runner·embedding caller가 명시 없이 background work를 시작하지 않는다. achieved Work 2개·quiet 30초·same
source window exact once에서만 reviewer를 열고 foreground는 기다리지 않는다.

실제 gpt-5.6-terra 격리 Console에서 두 파일 생성·exact reopen 목적은 각각 6.458초·4.999초로 먼저 전달됐다.
quiet boundary 뒤 reviewer는 5.742초·model 2·Tool 1·4,077 tokens로 candidate 1개를 만들었고 source pointer 2개·
active event 0이었다. normal Turn의 기본 Context·Tool 증가는 0이다. pending candidate는 설정의 작업 방법 목록에
`검증 중`으로 보이고 source 원문·Run ID·digest는 노출하지 않는다.

근거: `refoundation/evidence/s6-d-proposal-review-closeout-2026-08-30.json`.

오너의 Hermes 비교 피드백 뒤 current 제품 admission을 다시 반대시험했다. 기존 scheduler는 eligible achieved Work
두 개면 reviewer를 열어, 실제 단순 파일 생성·재개방 두 번에서도 `write-and-verify-file-content` 후보 하나를
만들었다. active Skill은 아니었고 다음 일에 강제되지도 않았지만, 반복되면 후보 잡동사니와 background 비용이
쌓일 수 있는 실제 P1이다.

기본 활성은 끄지 않았다. Runtime이 이미 가진 content-free 사건 중 `work revision 변화`, `실패한 방법 뒤 다른
route 성공`, `검증된 resource pathology`가 있는 서로 다른 eligible Work 두 개일 때만 reviewer를 연다. 단순 성공
두 개는 `NOTHING_TO_REVIEW`로 model call 0이며, 사건은 있지만 재사용 방법이 없으면 reviewer의
`NOTHING_TO_LEARN`이 계속 정상 성공이다. 업무명·파일 확장자·사용자 persona Router와 새 Store는 0이다.

실제 gpt-5.6-terra의 단순 파일 생성·재개방 두 건은 foreground 2/2·failed Tool 0·eligible source 2였지만
learning signal·reviewer model·review event·candidate가 모두 0이었다. 반대 positive control인 두 Work의
`첫 방법 실패→다른 route 성공`은 background nonblocking proposal과 기존 AB/BA·near-miss·independent field·
managed Skill promotion·regression rollback을 그대로 통과했다. 실제 인간의 자연스러운 반복 교정 mission에서
설명·교정·wall·calls·tokens 이익은 최종 HQ 전까지 보편 증명으로 과장하지 않는다.

보강 근거: `refoundation/evidence/s6-de-learning-admission-hardening-2026-08-30.json`.

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

현재 상태: `PRODUCT_PIPELINE_ACTIVE_COMPLETE · MANAGED_SKILL_ONLY · NATURAL_TRIAL_REQUIRED`

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

기존 actual model evaluator 증거와 unchanged core source를 재사용하고 current head 13/13을 재계산했다. 제품
end-to-end는 baseline→proposal→AB/BA replay→near-miss→independent field→managed Skill activation→fresh Session
사용→regression archive를 약 735ms deterministic fixture에서 관통했다. faster-but-wrong·다른 목적·source 표현
재사용·same-source field·한 measured lane 열세는 qualification을 만들지 않았다.

실제 gpt-5.6-terra와 gpt-5.5 evaluator는 기존 자격에서 각각 model 2 turn·Tool 1로 same-purpose·correctness·
completeness·near-miss·independent field recommendation을 통과했고 관련 evaluator core는 변경되지 않았다.
현재 제품 통합은 candidate→AB/BA replay→near-miss→independent field→managed Skill activation→fresh Session
사용→regression archive를 관통한다. active learned Skill은 설정에 `경험에서 배움`으로 나타나고 rollback 뒤
사라진다.

actual default-on candidate가 다음 유사 작업에서 선택되지 않은 경우에도 baseline이 정확하고 경제적이면 강제하지
않는다. candidate 사용 횟수가 아니라 같은 품질에서 사용자 교정·wall·calls·tokens의 실제 개선이 promotion
조건이다. Experience Growth는 managed procedural Skill 밖의 external package·secret scope·Core·external effect를
활성화하지 않는다.

제품 활성 근거: `refoundation/evidence/s6-de-experience-growth-product-activation-2026-08-30.json`.

근거: `refoundation/evidence/s6-e-field-promotion-closeout-2026-08-30.json`.

---

### S6-F — Scoped Computer Observation

현재 상태: `CLOSED_WITH_OBSERVATION · PRODUCT_IMPLEMENTATION_ADOPTED_0 · APPLE_NOTES_PURPOSE_UNMET`

current-head 57/57에서 기존 경계를 재자격했다.

- Browser: persistent tab·DOM/accessibility snapshot·login handoff·download/upload는 browser profile 안에서 성립
- File Reality: standard/sync roots의 filename·content·OCR·exact reopen은 성립하되 app private container를 전체
  컴퓨터 검색으로 열지 않음
- Native Computer: exact Finder/Explorer reveal과 folder selection만 성립
- CH2: foreground app identity·AFK coarse metadata만 explicit enable에서 content 0으로 성립
- 미달: 일반 desktop app의 authorized window identity·bounded AX tree·visible control/state·secret field presence

오너 실사용의 Apple Notes 첨부 녹음은 파일 경계 밖 app UI에 존재할 수 있고, 현재 File Reality에서 발견되지 않았다는
사실로 Notes 전체 부재를 말할 수 없다. 이를 첫 결함 가족로 고정한다. 현재 source에는 AXUIElement·ScreenCaptureKit
제품 import가 없고 screenshot fallback도 없다.

Apple 공식 AXUIElement는 assistive client가 accessible app의 element attributes와 actions를 읽는 API이며, 현재
process가 trusted accessibility client인지 별도 확인한다. 첫 후보는 macOS read-only helper가 현재 foreground app의
exact PID·authorized window에서 role·label·enabled/selected/value-presence만 bounded 반환하는 범위다. password·secret·
OTP value, 전체 tree, 다른 app, background polling, action은 열지 않는다. AX가 부족할 때의 screenshot은 별도
Screen Recording permission과 system picker가 필요한 다른 후보이며 이번 slice에서 열지 않는다.

근거: `refoundation/evidence/s6-f-scoped-computer-observation-baseline-2026-08-30.json`.

첫 candidate는 Objective-C native helper와 Runtime adapter로 자격했다. helper는 `AXIsProcessTrusted()`만 읽어
권한 prompt를 만들지 않고, `--allow-app-id`가 현재 foreground bundle과 다르면 AX window·element를 읽기 전에
`scope_mismatch`로 끝난다. 일치할 때 focused window 하나에서 최대 200 nodes·depth 8 hard bound 안의 role·label·
enabled·selected·focused·value-presence를 읽고 secure/password subrole은 value text를 반환하지 않는다.

실제 macOS physical에서는 현재 Safari exact bundle을 40 nodes·depth 4로 관측했고 app scope 일치·roles 12·secret
text violation 0이었다. TextEdit를 허용 대상으로 지정한 mismatch 대조에서는 elements·content fields 0이었다.
Runtime adapter actual도 40 nodes·secret text 0을 재확인했다. UI 원문은 stdout summary·evidence·source tree에
저장하지 않았고 provider call·screen capture·action은 0이다.

아직 사용자 요청에서 authorized app/window handle을 만드는 제품 계약, Console Tool discovery, packaged universal
helper, restart/stale window, Apple Notes 실제 목적은 미자격이다. 다음 slice는 새 Screen Store 없이 현재 Run의
ephemeral scope handle과 packaged helper lifecycle만 연결한다.

근거: `refoundation/evidence/s6-f-macos-scoped-accessibility-qualification-2026-08-30.json`.

제품 배선 후보는 합성 TextEdit에서 `tool_search → foreground → observe`, wall 6.757초·model 4·Tool 3으로
fixture marker와 control 종류를 정확히 관측했다. 그러나 이는 사용자 목적 양성 대조일 뿐 Apple Notes 녹음 현실
개선 증거가 아니다.

Apple Notes actual의 첫 AX 후보는 focused window DFS 200 nodes를 모두 사용하고도 녹음·첨부 hint 0이었다. 두 번째
후보는 focused UI element subtree로 줄여 74 nodes·truncated 0을 만들었지만 녹음·첨부 hint는 다시 0이었다. 두
후보 모두 secret text violation 0이었으나 사용자 목적 이익도 0이다. 중단선에 따라 Screen Recording·OCR·좌표
action을 열지 않고 Console Tool·packaged helper 제품 배선을 모두 제거했다. 최종 S6-F product delta는 0이며
read-only helper/adapter qualification source만 연구 증거로 보존한다.

따라서 S6-F는 `CLOSED_WITH_OBSERVATION · APPLE_NOTES_PURPOSE_UNMET`, S6-G는 `NOT_OPEN`이다. 이 결과를
S6-HQ 비주장에 보존하고 산출물 완성 Gate인 S6-H로 이동한다.

종료 근거: `refoundation/evidence/s6-f-closed-with-observation-2026-08-30.json`.

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

현재 상태: `NOT_OPEN · S6_F_USER_PURPOSE_UNMET`

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

현재 상태: `COMPLETE · EDITABLE_PRESENTATION_ACTUAL_CONSOLE_QUALIFIED · ECONOMY_CARRY_TO_S6_J`

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

현재 head의 실제 공백은 PPTX를 찾고 읽는 능력이 아니라 편집 가능한 PPTX를 제품이 직접 만들고 모든 slide를
다시 연 뒤 Console Preview로 전달하는 경로였다. 첫 독자 OOXML writer는 구조 재개방은 통과했지만 macOS Quick
Look 소비자 미리보기를 bounded 시간 안에 만들지 못해 완전히 폐기했다. 두 번째 후보는 MIT의 유지보수 포크
`@lofcz/pptxgenjs@4.1.17`을 기존 Document CLI 안에만 결속했다. 새 Store·Router·전역 instruction 증가는 0이다.

현재 `create-pptx`는 최대 40장의 닫힌 JSON spec으로 editable 16:9 presentation을 만들고 same-directory atomic
publication 뒤 PPTX 자체를 다시 연다. 모든 slide text·shape geometry·font size·source note·overflow 후보를
관측하며, 사용자 승인 색상과 font만 theme로 받는다. 비사실적 업종 template나 brand를 Runtime이 선택하지 않는다.
외부 claim source는 slide speaker notes의 `[Sources]` block으로 보존한다.

macOS physical fixture 3장은 Quick Look의 `public.html` preview에서 한글 glyph·36pt 제목·본문·글머리표·page
number와 세 slide 전체를 다시 확인했고 unintended overlap·overflow 후보는 0이었다. Console Artifact Preview는
PPTX의 모든 slide를 네트워크·active script 없이 보여주고 원본 editable download를 함께 제공한다. Keynote는
사용자 소유의 기존 import가 진행 중이어서 건드리지 않았고, Microsoft PowerPoint·Windows physical import는
통과했다고 주장하지 않는다.

실제 gpt-5.6-terra 격리 Console의 자연어 3장 경영진 운영계획은 53.880초·model 15·Tool 14·337,251 tokens로
Artifact v1·세 slide Preview·PPTX download·내부 path 비노출을 통과했다. 기능과 사용성은 성립했지만 왕복과
provider 비용은 경제적으로 완료가 아니다. 같은 H 기능에 Prompt patch를 붙이지 않고 S6-J의 첫 actual 비용
가족으로 이월한다. 기존 Artifact family/version·부분 교정·Undo 계약은 형식별 새 Store 없이 그대로 재사용한다.

종료 회귀는 전체 단위 1,919개에서 product source 실패 0이었고, 새 dependency 네 개로 notice 고정 개수만
288→292로 바뀐 한 검사를 exact 수정해 3/3 재시험했다. 제품 통합은 202/204·실패 0·Windows physical 2 skip,
핵심 mutation은 2/2 killed다. 같은 87초 단위 전체를 개수 한 줄 때문에 다시 반복하지 않고 직접 변경 검사와
남은 제품 통합·mutation을 닫았다.

근거: `refoundation/evidence/s6-h-professional-presentation-closeout-2026-08-30.json`.

---

### S6-I — Actual External Mission

현재 상태: `CLOSED_WITH_PHYSICAL_HUMAN_QUALIFICATION_PENDING · PRODUCT_IMPLEMENTATION_ADOPTED_0`

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

current-head source와 전체 제품 통합을 다시 읽은 결과 Telegram의 durable owner·text/file Delivery·unknown ACK
비재실행, Remote MCP의 OAuth·annotation·verified write→exact page readback, Automation의 실행시 capability·authority·
objective effect·Delivery 정산은 이미 제품에 있다. 같은 구조를 다시 만들거나 Connector를 늘릴 결함은 발견되지 않았다.

현재 설치 상태의 content-free local reality는 Remote MCP credential 0, Telegram provider offset·owner binding 1·allowed
owner 1·nonterminal ingress 0이다. 이는 과거 연결과 정산 현실일 뿐 현재 network ready나 새 외부 목적 성공을 뜻하지
않는다. credential·chat identity·message content는 읽거나 증거에 저장하지 않았다.

남은 한 증명은 human-controlled official target에서 `fresh reality → one reversible write/draft → external ACK → exact
readback → user Delivery`를 수행하는 물리 자격이다. 저장소 계약은 실제 계정·credential의 자동 시험을 금지하고
loopback을 external physical PASS로 승격하지 않는다. 따라서 실계정에 임의 메시지·문서·일정을 만들지 않았고,
새 Connector·Prompt·Store로 PASS를 꾸미지 않았다. S6-I 제품 delta는 0이며 이 물리 자격은 S6-HQ blocker로 유지한다.

근거: `refoundation/evidence/s6-i-external-mission-baseline-2026-08-30.json`.

---

### S6-J — Economy Close

현재 상태: `COMPLETE_FIRST_ACTUAL_COST_FAMILY · QUALITY_PRESERVED · P0_SPEED_CARRY_REMAINS`

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

S6-H 첫 actual의 자연어 3장 editable presentation은 정확성·Preview·download는 통과했지만 53.880초·model 15·
Tool 14·337,251 tokens였다. 당시 전역 instruction에는 `create-pptx`가 보였지만 실제로 열린 document-data Skill에는
PPTX의 생성·source notes·reopen·registration 절차가 없었다. Runtime 조건이나 새 Router를 만들지 않고 해당 방법을
on-demand Skill에 결속하고 전역 instruction은 5차 exact bytes로 되돌렸다.

같은 gpt-5.6-terra·같은 격리 Console·같은 사용자 목적 재시험은 31.150초·model 10·Tool 9·152,696 tokens였다.
wall 42.18%, model/tool 각 5회, tokens 54.72%가 줄었고 요청한 세 slide·전체 Preview·editable PPTX download·
Artifact v1·내부 path 비노출은 그대로 통과했다. 일반 Direct의 Context·Tool 비용 증가는 0이다.

첫 bounded runner는 반복 call별 exact reason을 보존하지 않았으므로 남은 skill·attachment 반복을 추측해 세 번째
조건 patch로 줄이지 않는다. 날씨 11.089초와 이름 파일 검색 18.767초·filename phase 7.75초는 정확성 완료가 아니라
최종 HQ 속도 carry다. source identity 없는 provider-native 답이나 filename coverage를 줄이는 후보는 계속 폐기한다.

근거: `refoundation/evidence/s6-j-economy-close-2026-08-30.json`.

---

### S6-WA — Whole Android Seam Audit

현재 상태: `COMPLETE_MACOS · FOUR_P1_REPAIRED · UX_DELTA_EDGES_REAUDITED · WINDOWS_PHYSICAL_EXPLICIT`

`7a640b6e` exact head에서 여섯 read-only lane으로 16개 seam을 감사한 뒤, 단일 통합 책임자가 실제 증폭이
있는 네 P1만 순차 수리했다.

- Console 최초 입력은 HTTP ACK 전 Conversation·Attachment·input에 durable하게 남고, Direct는 Work 0,
  Hand가 필요할 때만 같은 input이 Work revision에 결속된다.
- managed process wake는 successor surface 실패로 소멸하지 않고 claim을 놓아 다시 전달할 수 있다.
- Telegram `sendMessage` dispatch 후 ACK 유실은 retryable failure가 아니라 effect unknown·retry unsafe다.
- learned/managed Skill의 physical mutation 뒤 ledger append가 실패하면 신규 candidate는 제거하고 기존
  active/archive는 exact 원상 복구하며, 복구 자체가 실패할 때만 effect unknown으로 남긴다.

focused 반대시험 97/97과 sandbox 밖 `refoundation:check`의 제품 경계를 재확인했다. S6-UX 이후에는
전체 inventory를 다시 열지 않고 UX가 바꾼 edge만 재감사한다.

근거: `refoundation/evidence/s6-wa-whole-android-seam-audit-2026-08-30.json`.

T5와 같은 유기적 시스템의 실제 성능은 개별 모듈의 최고 점수가 아니라 가장 약한 핵심 연결부와 그 결함의 증폭
범위에 의해 결정된다. 이 Gate는 전체 코드를 다시 설계하거나 여러 Agent가 동시에 고치는 대청소가 아니다.
현재 exact head의 producer→consumer→identity→effect→UX 연결을 읽기 전용으로 전수 지도화하고, 재현된 P0/P1만
통합 책임자 한 명이 이후 순차 수리하도록 한다.

이 감사는 오너가 제시한 세 구조적 관점을 실제 엔지니어링 규율로 사용한다.

```text
Butterfly Effect → 작은 seam perturbation의 전체 사용자 결과 증폭 추적
Fractal          → 같은 불변식이 Tool·Work·Session·Product 규모에서 반복되는지 확인
Knot             → identity·authority·effect·result 연결이 변환 뒤에도 보존되고 필요할 때 정확히 끊기는지 확인
Android          → 뇌·신경·감각·손·기억·면역·대사·피부가 한 목적에서 함께 움직이는지 판정
```

이 개념들은 수학적 증명을 흉내 내는 은유가 아니다. 반대시험·그래프·상태 전이·실제 인간 Mission을 선택하는
감사 방법이다.

#### Android Mechanism Map

| 유기체 역할 | T5 구조 | 연결 실패의 사용자 증상 |
|---|---|---|
| 뇌 | 기반 모델·목적·방법·완료 판단 | 도구부터 고름, 불필요한 질문, 잘못된 완료 |
| 감각 | File/Web/Browser/Computer/Connection observer | 파일·화면·외부 상태를 놓치거나 보지 않고 단정 |
| 신경계 | Context·Conversation·Work·Run·Resource·progress | 교정 유실, 다른 Session 혼입, 먹통 체감 |
| 손 | Terminal·Document·Program·Browser·Capability | 잘못된 대상 실행, 성공했지만 결과 미전달 |
| 기억 | Memory·Episode·Skill·Learning | 일회성 사실 영구화, Skill 중복, 현재 교정 무시 |
| 면역계 | Authority·confinement·secret·rollback·recovery | 범위 밖 효과, prompt injection, blind retry |
| 대사 | tokens·calls·bytes·process·cache·cleanup | 단순 요청 과비용, 고아 process, 느린 UX |
| 순환계 | Artifact·Effect·Delivery·Channel | 결과 identity 유실, version 초기화, 중복 전송 |
| 피부 | Console·Telegram·settings·Artifact UX | 내부 성공이 사용자에게 먹통·혼란·쓸 수 없는 결과로 보임 |

감사는 모듈 수가 아니라 위 기관 사이의 실제 연결을 판정한다.

---

#### WA-1 — Butterfly Perturbation Audit

작은 경계 변화 하나를 주고, 국소 실패가 사용자 결과·효과·복구·UX로 어디까지 증폭되는지 추적한다. 한 probe는
한 사실만 바꾼다.

대표 perturbation:

- 사용자 current correction이 model call 직전에 들어옴
- source revision이 inspect 뒤 publication 전에 바뀜
- 파일의 NFC/NFD 표현만 다름
- exact file이 이동·삭제됨
- Tool ACK는 성공했지만 response가 유실됨
- 외부 write ACK 뒤 readback 불일치
- Runtime이 result ready와 surface 사이에서 종료됨
- provider가 Tool 성공 뒤 transport failure
- Browser tab/window/control이 action 직전에 stale
- Telegram ACK unknown
- background learning candidate가 current correction과 충돌
- Artifact identity pointer 하나가 projection에서 빠짐
- progress event가 final보다 늦게 도착함

각 perturbation은 다음 propagation ledger로 기록한다.

```yaml
origin:
changedFact:
firstAffectedBoundary:
downstreamNodes: []
containedAt:
userVisibleSymptom:
localEffect:
externalEffect:
unknownPreserved:
retryOccurred:
rollbackAvailable:
uxRecovered:
severity:
```

합격:

- 작은 오류가 잘못된 사람·파일·효과·완료로 증폭되지 않음
- 영향은 최초로 진실을 잃는 boundary에서 typed failure/unknown으로 제한
- 사용자 current correction·취소가 이전 계획보다 우선
- repair를 위한 자동 반복이 새 효과를 만들지 않음
- 사용자 표면은 내부 오류 크기와 무관하게 확인 사실·남은 일만 설명

완료 문장:

> T5의 작은 identity·revision·ACK·timing 변화는 사용자 목적과 효과를 조용히 왜곡하지 않고 최초 경계에서
> 제한되며, 영향 범위와 복구 가능성이 exact evidence로 추적된다.

---

#### WA-2 — Fractal Invariant Audit

T5의 핵심 불변식은 규모만 달라질 뿐 모든 층에서 같은 형태로 반복돼야 한다.

Fractal kernel:

```text
목적/요청
→ 현재 reality
→ authority/scope
→ 실행 또는 관측
→ result/effect
→ independent readback
→ settlement
→ user projection
→ cancel/rollback/recovery
```

동일 kernel을 다음 scale에서 대조한다.

| Scale | 예시 |
|---|---|
| Micro | Tool call 하나·파일 한 개·Web read 하나 |
| Meso | Work 하나·다중 Tool·Artifact 하나 |
| Macro | 장기 Conversation·busy input·Runtime restart |
| Cross-surface | Console↔Telegram↔Automation↔settings |
| Cross-provider | 같은 canonical Work의 모델 전환·fallback |
| Cross-platform | macOS adapter↔Windows adapter |
| Growth | Episode→proposal→trial→Skill→rollback |

층별 공통 질문:

1. 누가 요청했는가?
2. 현재 identity·revision은 무엇인가?
3. 누가 허용했는가?
4. 실제로 무엇이 실행·관측됐는가?
5. 로컬·외부 효과는 무엇인가?
6. 무엇을 다시 열어 확인했는가?
7. 무엇이 terminal이고 무엇이 unknown인가?
8. 사용자는 같은 사실을 어떻게 보는가?
9. 취소·재시작·rollback 뒤 무엇이 남는가?

Fractal mismatch 반례:

- Tool에서는 unknown을 보존하지만 Work가 achieved로 합침
- 파일 하나는 version을 보존하지만 ZIP batch가 부분 version을 만듦
- Console은 cancel됐지만 Telegram은 success를 보냄
- local effect는 rollback되지만 Artifact current version은 그대로임
- 모델 전환 뒤 canonical은 같지만 Tool effect를 재실행
- macOS는 exact file reveal, Windows는 nearest parent를 성공으로 표시
- proposal은 reversible이지만 active learned Skill 제거가 불가능

완료 문장:

> 요청·현실·권한·실행·효과·검증·정산·복구의 같은 불변식이 Tool에서 장기 Conversation과 플랫폼까지 반복되며,
> 한 층의 성공이 다른 층의 미확인을 덮지 않는다.

---

#### WA-3 — Knot Identity & Topology Audit

T5의 매듭은 복잡한 코드를 뜻하지 않는다. 한 사용자 목적을 구성하는 identity와 관계가 여러 변환을 거쳐도 같은
결과로 이어지는 연결 그래프다.

핵심 strand:

```text
User Message
→ Conversation
→ Work/revision
→ Run
→ Tool call
→ source RecordRef
→ Effect
→ Artifact family/version
→ Delivery
→ user-visible result
```

보존해야 할 knot invariant:

- owner/Session
- current Work·revision
- source identity·freshness
- authority·scope
- exact actual call
- local/external effect
- Artifact family·version·bytes
- Delivery destination·ACK
- terminal/unknown disposition

Topology-preserving transformation:

- provider 변경
- Context compaction·projection
- Runtime restart
- Session 전환·재접속
- Console↔Telegram surface 이동
- backup→다른 local root restore
- 파일 reveal→Artifact delivery
- candidate→active Skill→rollback

위 변환은 내부 표현을 바꿀 수 있지만 knot invariant를 바꾸면 안 된다.

의도적으로 매듭을 끊는 작업:

- cancel
- forget
- disconnect
- delete
- rollback
- capability remove/archive
- Session deletion

cut operation은 정확한 strand만 끊고 orphan edge를 남기지 않아야 한다.

금지되는 knot:

- 같은 effect에 두 Work/Run owner
- Artifact version 2 뒤 새 version 1 family
- delivered result가 source Run과 연결되지 않음
- input이 Conversation에는 있지만 Work settlement에 없음
- completed process의 wake가 다시 claim됨
- retry cycle이 동일 external effect를 반복
- Memory와 Skill에 같은 사실 중복
- deleted Session이 group/pin 이동으로 부활
- restore가 old absolute path에 묶임

Graph audit record:

```yaml
mission:
nodes: []
edges: []
canonicalOwner:
revisionChain:
effectChain:
artifactLineage:
deliveryChain:
cycles: []
intentionalCuts: []
orphans: []
duplicates: []
crossSurfaceMatch:
restartMatch:
status:
```

완료 문장:

> 한 사용자 목적의 identity·source·effect·Artifact·Delivery strand는 Context·provider·Runtime·channel·backup 변환
> 뒤에도 같은 매듭을 유지하고, cancel·forget·rollback은 의도한 strand만 끊어 중복·orphan·부활을 남기지 않는다.

---

#### WA-4 — Seam Registry

모든 연결부를 다음 closed record로 inventory한다.

```yaml
seamId:
producer:
consumer:
purpose:
canonicalIdentity:
revisionFreshness:
authorityOwner:
inputProjection:
successFact:
failureFact:
unknownFact:
cancelBoundary:
restartBoundary:
rollbackBoundary:
publicProjection:
performanceCost:
macOS:
Windows:
positiveEvidence:
counterEvidence:
currentGap:
score:
```

필수 seam family:

1. Composer→HTTP→Conversation→Work admission
2. Conversation·Memory·Capability→Context→provider wire
3. basic Hand→tool_search→Skill/Capability→actual Tool
4. Tool request→authority→execution→Effect→Receipt
5. Terminal→process→output→wake→stop/restart
6. File roots→filename/content/OCR/visual→handle→inspect
7. exact file→Artifact→Preview/Download/Reveal
8. source bind→F/G/Document→verify→Artifact→Undo
9. Web boundary→Browser→tab/ref→action→readback
10. capability gap→candidate→qualification→activation→Work resume
11. Episode→proposal→trial→Skill→field use→rollback
12. Console↔Telegram↔Automation→external Delivery
13. canonical state→backup→restore→surface rebuild
14. Runtime events→progress→stream→final→result UX
15. Session→pin/group/search/archive/delete/restore
16. common meaning→macOS/Windows adapter

점수:

| 점수 | 의미 |
|---:|---|
| 0 | 연결 없음 |
| 1 | 수동·암묵적·다른 층 추측에 의존 |
| 2 | 정상 happy path만 작동 |
| 3 | typed failure·unknown·coverage 보존 |
| 4 | 교정·취소·재시작·exact-once·rollback 성립 |
| 5 | 실제 인간 UX·경제성·macOS/Windows 자격 |

모든 seam을 5점으로 만들려고 과잉 개발하지 않는다. 사용자 핵심 Mission이 사용하지 않는 seam은 `not_applicable·
unmeasured`로 남길 수 있다. P0/P1 핵심 seam의 0~2점만 완료 blocker다.

---

#### WA-5 — Execution Order & Repair Discipline

```text
현재 exact head freeze
→ multi-agent read-only seam inventory
→ Butterfly perturbation family 분담
→ Fractal scale mismatch 감사
→ Knot graph/orphan/cycle 감사
→ 한 통합 책임자가 중복 findings 정규화
→ P0/P1만 순차 재현
→ S6-UX 구현
→ UX 변경 seam만 delta 감사
→ 총괄 인간 HQ
→ 관련 P0/P1 1회 재시험
```

병렬 감사 lane:

- Context·provider·Tool surface
- Work·Run·Terminal·Recovery
- File·Document·Artifact·Undo
- Capability·Learning·Experience Growth
- Browser·Computer·External·Channel
- UX·Session management·Backup·Platform

감사 Agent는 코드를 수정하지 않는다. finding에는 exact source·현재 evidence·재현 가능한 반례·사용자 증상·severity가
모두 있어야 한다. 통합 책임자 한 명만 수정하며 `git add -A·amend·자동 merge`를 사용하지 않는다.

중단선:

- 함수·파일 수를 전수조사 완료로 사용하지 않음
- 실제 Mission 없는 hypothetical seam을 새 시스템으로 만들지 않음
- 같은 결함 가족 세 번째 patch 금지
- 한 seam 수리가 다른 owner의 canonical truth를 복제하면 재설계
- 테스트는 통과하지만 실제 사용자 Mission이 실패하면 미완료
- P2 미관·코드 스타일을 P0 topology 결함으로 확대하지 않음
- S6-UX 뒤 전체 inventory를 처음부터 반복하지 않고 변경 edge만 재감사

완료 판정:

```yaml
S6_WA:
  seam_registry_complete: true
  p0_unresolved: 0
  p1_unresolved: 0
  duplicate_truth_owner: 0
  orphan_effect_or_artifact: 0
  blind_retry_cycle: 0
  cross_surface_contradiction: 0
  ux_delta_edges_reaudited: true
  windows_unqualified: EXPLICIT
```

완료 문장:

> T5의 뇌·감각·신경·손·기억·면역·순환·피부는 한 사용자 목적의 identity와 사실을 공유하며, 작은 경계 오류는
> 전체 결과로 증폭되지 않고, 같은 불변식이 모든 규모에서 반복되고, 재시작·채널·플랫폼 변환 뒤에도 연결이
> 끊기거나 엉키지 않으며, 취소·forget·rollback은 의도한 관계만 정확히 해제한다.

---

### S6-UX — Conversational Workspace & Result Experience

현재 상태: `PRODUCT_CANDIDATE_COMPLETE · ACTUAL_CONSOLE_MISSIONS_PASS · PRODUCT_INTEGRATION_205_PASS · FINAL_HQ_PENDING`

S6-UX는 기존 canonical progress·Artifact·Undo·Session을 재사용해 다음 사용자 경험을 제품에 결속했다.

- 사용자 메시지는 작은 우측 bubble, T5 답은 860px 평면 document body로 표시한다.
- heading·ordered list·table·code·blockquote의 한국어 읽기 위계와 narrow/dark 테마를 정돈했다.
- 진행 중 입력창에서 교정·첨부·Stop을 하며, 중복 Stop surface는 제거했다.
- Artifact는 한 결과 영역에서 제목·파일 받기·exact Finder/Explorer Reveal·version·durable Undo를 제공한다.
- 고정·수동 group·전체 검색·archive/delete/restore는 기존 Session 정본을 바꾸거나 내용을 복제하지 않는다.
- UI source는 294,397→304,559 bytes로 3.45% 늘었고 새 framework·font·icon package와 Direct model/tool call 증가는 0이다.

실제 Console Browser에서 Direct·긴 답·진행/Stop·Artifact Reveal/Undo·고정/group·narrow·dark를 클릭했고,
제품 통합 205/205가 통과했다. 최종 S6-HQ에서 6차 전체 핵심 여정과 속도 carry를 함께 봉인한다.

근거: `refoundation/evidence/s6-ux-conversational-workspace-2026-08-30.json`.

6차의 기능과 UX를 분리하지 않는다. 이 Gate는 새 작업 엔진이나 예쁜 skin을 만드는 일이 아니다. 이미 선
Conversation·Session activity·Work reality·answer stream·Artifact·Effect·Delivery·Undo를 일반 사용자가 가장 적은
인지 부담으로 이해하고 사용할 수 있는 하나의 대화 작업면으로 정돈한다.

현재 제품에는 이미 다음 진행 기반이 있다.

- 입력 직후 `응답을 준비하고 있어요` 최소 생존 신호
- server `startedAt` 기반 경과시간
- `session_activity·activity_event·tool_progress·evidence_added` 실제 사건
- streamed answer preview와 최종 답의 동일 Markdown renderer
- 실제 Tool 뒤에만 쌓이는 bounded 활동 사실
- 실행 중 멈춤·busy correction·다른 Session 이동
- Session 재진입·Runtime 재시작·Telegram의 canonical 상태 복원
- 완료 시 임시 preview·진행 표면 정리와 Artifact·Work 결과 유지

따라서 위 기반을 새 Store·가짜 milestone·모델 사고 노출로 다시 만들지 않는다. 현재 미달은 다음이다.

1. T5의 긴 답이 큰 말풍선 카드 안에 갇혀 문서처럼 읽기 어렵다.
2. 진행·stream preview·최종 답·결과 파일이 하나의 시각적 흐름으로 충분히 이어지지 않는다.
3. Artifact의 Preview·Download·Reveal·Version·Source·Undo가 여러 카드와 영수증에 분산된다.
4. 입력창이 idle·running·stop·user-action-needed·busy correction 상태를 충분히 명확히 구분하지 않는다.
5. 대화가 늘어도 중요한 대화를 고정하거나 사용자가 직접 묶어 관리할 수 없다.
6. warm한 T5 정체성은 있으나 본문 대비·간격·긴 표·코드·좁은 창의 시각 완성도가 부족하다.

#### UX 제품 한 문장

> 사용자는 T5와 자연스럽게 대화하면서 오래 걸리는 일도 현재 진전을 이해하고, 긴 답을 편안하게 읽으며,
> 결과 파일을 한 자리에서 열고 받고 찾고 수정하고 되돌리고, 중요한 대화를 자신의 일 구조에 맞게 정리한다.

#### UX 헌법

- Codex의 개발자 화면을 복제하지 않고 `작업 리듬·가독성·통제감`만 배운다.
- 사용자 메시지와 T5 답변은 발화 주체가 즉시 구분돼야 한다.
- 사용자 표면은 단순하게 만들되 내부 기능·증거·Undo를 제거하지 않는다.
- 모델 내부 reasoning·명령·query·path·hash·secret을 진행 설명으로 노출하지 않는다.
- UI가 성공 상태를 만들지 않는다. canonical Work·Artifact·Effect·Delivery 사실만 표현한다.
- 예쁜 화면이 잘못된 파일·버전·효과를 가리면 P0다.
- 모든 변경은 실제 Browser screenshot·click·keyboard·좁은 viewport로 확인한다. 문자열 검사만으로 완료하지 않는다.
- 현재 디자인을 한 번에 전면 교체하지 않는다. 한 UX slice마다 동일 실제 대화 A/B 후 채택한다.

---

#### UX-0 — Current Surface Baseline

제품 변경 0으로 현재 설치 제품과 current source의 실제 화면을 다음 viewport에서 기록한다.

```text
Desktop wide:   1440×900
Desktop normal: 1280×800
Narrow window:   900×760
Small laptop:   1024×700
```

고정 fixture:

1. 인사 한 줄
2. 1,500자 이상 제목·목록·표·코드가 있는 긴 답
3. 20초 이상 실제 작업의 진행·stream·최종
4. 단일 Artifact
5. 네 Artifact와 version·Undo
6. 실행 중 busy correction·첨부·Stop
7. 대화 30개·보관·삭제·Telegram origin·진행 중 상태

기록:

- submit acknowledgement·first feedback·first useful·final
- 본문 실제 폭·한 줄 평균 글자 수·scroll 길이
- progress와 final의 중복 영역
- Artifact action 발견 가능성
- keyboard tab order·focus ring·contrast
- tester가 결과를 찾고 열고 되돌리는 데 필요한 click 수

완료 문장:

> 현재 T5 화면의 강점과 여섯 UX 미달이 동일 fixture·viewport·실제 canonical state에서 고정됐고, 첫 시각 변경은
> 사용자 목적 하나만 개선하도록 열린다.

---

#### UX-R — Comparative UX Research & T5 Translation

비교군의 화면을 느낌으로 섞지 않는다. 각 제품에서 T5의 특정 사용자 문제를 실제로 더 잘 푸는 원리만 측정하고,
T5의 canonical state와 일반 사용자 언어에 맞게 다시 설계한다.

참고 역할:

| 비교군 | 주로 확인할 UX | T5가 복제하지 않을 것 |
|---|---|---|
| ChatGPT | 사용자 bubble+assistant flat response, 긴 글, composer, 모바일 리듬 | cloud 전용 상태·브랜드·아이콘 |
| ChatGPT Work | 장기 작업·파일·앱·승인·결과 재진입 | Chat/Work 모드 선택 요구 |
| Codex | 작업 접수감·실제 과정·stream→final·Stop·병행 작업 통제 | branch·diff·commit·subagent·개발 environment panel |
| Claude | 긴 산문·인용·코드·절제된 정보 밀도 | Claude 브랜드·고유 motion |
| Claude Cowork | 파일·Preview·desktop delegation·사용자 개입 | 범용 Computer Use를 기본 손으로 전제 |
| Hermes | Skill·Memory·candidate·active·remove/restore 관리 | 개발자용 설정 밀도·자동 Skill 잡동사니 |
| OpenClaw | channel·Session·Plugin 상태와 대규모 목록 | Plugin marketplace·기술 용어·광범위 권한 기본값 |

오너가 제공한 Codex 실제 화면은 local-only 참고자료로 보존한다. 개인 대화·프로젝트 이름이 포함된 화면이므로 Git
evidence·제품 package에 넣지 않는다.

- `/Users/jyp/Developer/t5-total-hq/references/codex-workspace-ux-reference-1.png`
- `/Users/jyp/Developer/t5-total-hq/references/codex-workspace-ux-reference-2.png`

이 두 화면에서 직접 참고할 것은 다음뿐이다.

- assistant flat reading surface
- 제목·문단·목록·인용의 긴 글 위계
- persistent composer와 화면 하단 안정성
- 45초 작업도 먹통으로 느끼지 않게 하는 경과·과정 리듬
- main conversation과 context/action 영역의 분리 원리

우측 개발 환경 패널 자체는 T5 참고 대상이 아니다. T5에 필요한 대응 개념은 `현재 작업·확인한 자료·결과물·
실제로 바뀐 것·남은 미확인·멈춤·Undo`이며, 이것도 항상 보이는 개발자 패널이 아니라 필요할 때 여는 일반 사용자
결과/과정 표면으로 설계한다.

##### 비교 자료 수집

가능한 경우 실제 제품의 동일 fixture 화면을 다음 상태에서 확보한다.

1. 짧은 직접 답
2. 긴 heading·list·table·code 답
3. 20초 이상 작업 중
4. stream 출력 중
5. 단일·다중 결과 파일
6. 사용자 행동 필요·실패·중지
7. 대화 목록 30개 이상
8. narrow viewport·dark mode

공개 제품은 screenshot과 Browser computed style을 측정한다. 로그인·개인자료·credential·cookie·local storage를
수집하지 않는다. proprietary product의 minified CSS·class명·asset·DOM 전체를 source로 복사하지 않는다.

OpenClaw·Hermes처럼 공개 source를 볼 때도 다음을 먼저 기록한다.

- exact repository·commit
- license
- 해당 CSS/component가 실제 제품 entry에서 사용되는지
- 가져올 원리와 T5에서 바꿀 부분

license가 허용해도 literal CSS copy보다 T5 semantic token과 current DOM에 맞춘 재구현을 우선한다.

##### Computed-style 측정표

각 비교군과 current T5에 대해 같은 viewport에서 다음을 기록한다.

```text
app canvas/background
sidebar width·row height·selected state
conversation reading max-width
assistant body font-size·line-height·color
heading h1/h2/h3 size·margin
paragraph·list·blockquote spacing
user bubble max-width·padding·radius·contrast
assistant container background·border·shadow
code/table overflow·copy affordance
message action size·visibility·focus
progress position·height·density·elapsed time
artifact thumbnail·row/card·primary actions
composer min/max height·padding·attachment chip
desktop/narrow breakpoint
light/dark contrast
motion duration·reduced-motion behavior
```

측정은 디자인 정답이 아니다. T5 candidate는 다음 사용자 성과로 선택한다.

- 긴 답의 핵심 문장을 찾는 시간
- progress와 final을 혼동하지 않는 비율
- Preview·Download·Reveal·Undo 발견 시간과 click 수
- 실행 중 교정·Stop 성공률
- 대화 pin·group·검색 성공 시간
- 한국어 가독성·신뢰·다시 사용 의향

##### Prototype 규율

제품 코드를 바로 여러 방향으로 흔들지 않는다.

```text
current screenshot/DOM fixture
→ isolated static prototype B: T5 hybrid layout
→ current vs B blind visual/task comparison
→ B가 실패하면 원인이 다른 한 후보 C만 허용
→ 채택된 token/layout만 current UI에 이식
```

Prototype은 canonical API·Store를 흉내 내는 새 제품이 아니다. current sanitized session/activity/artifact fixture를
읽는 정적 HTML/CSS 비교물이며 source tree·package entry에 들어가지 않는다.

##### 저작권·정체성 경계

- ChatGPT·Codex·Claude의 CSS·SVG·아이콘·animation·copy를 그대로 사용하지 않는다.
- 비교군 제품명·색·로고·특유 모양을 T5 UI에 남기지 않는다.
- T5의 warm neutral·일반 사용자 언어·결과 진실·Undo가 최종 디자인 정체성이다.
- “ChatGPT처럼 보임”이 아니라 “같은 시간에 더 쉽게 읽고 행동함”을 합격으로 쓴다.

완료 문장:

> 비교군의 실제 화면·computed style·사용자 과업을 같은 기준으로 측정했고, T5 candidate는 브랜드나 CSS 복제가
> 아니라 읽기·진행 이해·결과 사용·통제감의 반복 우위로 선택됐다.

---

#### UX-1 — Hybrid Conversation Layout

대화는 완전 평면도, 모든 메시지 말풍선도 아닌 비대칭 구조를 사용한다.

```text
사용자
  → 우측 정렬의 작고 명확한 message bubble

T5
  → 테두리 없는 평면 document response

진행·경계
  → 작고 임시적인 activity surface

결과물
  → T5 답 바로 아래의 별도 result surface
```

사용자 bubble을 유지하는 이유:

- 입력과 답의 주체를 빠르게 구분
- 긴 대화에서 사용자의 교정 지점을 찾기 쉬움
- 모바일·좁은 창에서도 대화 리듬 유지

T5 bubble을 제거하는 이유:

- 긴 답을 카드 안에 가두지 않음
- 제목·표·목록·코드·인용을 문서처럼 읽음
- Artifact와 본문이 한 큰 흰 카드 안에서 경쟁하지 않음
- ChatGPT·Claude·Codex 사용자에게 익숙한 읽기 구조

Assistant response anatomy:

```text
T5 identity·recorded time — 저대비 한 줄
본문
inline source citation
message actions: Copy · 사용자에게 필요한 후속 행동
Result surface — 있을 때만
Process disclosure — 완료 뒤 접힘, 사용자가 열 때만
```

금지:

- assistant와 user를 같은 정렬·배경으로 만들어 발화 주체 혼동
- 모든 짧은 답에도 큰 heading·card·divider 추가
- 말풍선 제거를 이유로 message time·copy·source identity 삭제
- Runtime 고정 footer를 모든 답 아래 반복

완료 문장:

> 짧은 대화는 가볍고, 긴 T5 답은 문서처럼 읽히며, 사용자 교정과 T5 결과가 긴 대화에서도 즉시 구분된다.

---

#### UX-2 — Typography, Rhythm & Responsive Visual System

새 브랜드를 만드는 것이 아니라 현재 warm neutral T5를 읽기 좋게 정제한다. 색은 의미와 대비로 사용하고 장식
gradient·과도한 shadow·여러 accent를 만들지 않는다.

Semantic design token 후보:

```text
--canvas:          warm neutral app background
--surface:         primary reading surface
--surface-muted:   progress·metadata·sidebar group
--text-primary:    WCAG 4.5:1 이상
--text-secondary:  WCAG 4.5:1 이상, 크기로 의미를 숨기지 않음
--border-subtle:   구조 구분에 필요한 한 단계
--accent:          선택·primary action 하나
--success/warning/danger: 상태 의미에만 사용

spacing: 4 · 8 · 12 · 16 · 24 · 32
body: 15.5~16px / line-height 1.65~1.72
metadata: 12.5~13px, 대비 유지
h1: 28~30px
h2: 21~23px
h3: 17~19px
reading width: 760~880px
```

실제 CSS 값은 screenshot A/B와 한글 glyph·Windows font metric을 보고 확정한다. 숫자를 이유 없이 디자인 법으로
고정하지 않는다.

필수 표현:

- 제목 간격과 heading hierarchy
- ordered list의 실제 start와 1·2·3 증가
- nested bullet과 paragraph spacing
- 긴 code block의 가로 scroll·copy
- 넓은 표의 독립 scroll·sticky header
- blockquote·citation·warning의 차분한 구분
- link·focus·hover·visited의 접근 가능한 상태
- URL·긴 filename·한글/영문 혼합의 안전한 wrap
- image·Artifact preview의 최대 높이와 크게 보기

Responsive:

- narrow window에서는 sidebar collapse 가능
- user bubble 최대 폭을 제한하되 한글 장문이 지나치게 좁아지지 않음
- assistant reading width는 가운데 유지하고 빈 공간이 과도하지 않음
- composer가 결과와 본문을 가리지 않음
- result action은 줄바꿈돼도 순서와 primary action이 유지됨

Theme:

- light/dark가 같은 semantic token 관계를 사용
- dark mode가 단순 색 반전으로 image·code·Artifact contrast를 깨뜨리지 않음
- system preference와 사용자의 명시 선택을 분리해 보존
- theme 전환이 대화·progress·preview 상태를 다시 만들거나 scroll을 바꾸지 않음

Motion:

- 상태 전환 120~200ms 수준의 짧은 motion
- progress shimmer·무한 pulse를 작업 진전으로 사용하지 않음
- `prefers-reduced-motion`에서 기능 손실 0

Rendering performance:

- stream delta마다 전체 transcript를 다시 렌더하지 않음
- progress elapsed 갱신이 대화 목록과 Artifact 전체 repaint를 유발하지 않음
- Markdown streaming render는 읽을 수 있는 간격으로 throttle하되 first useful result를 늦추지 않음
- 300·3,000 Session과 긴 대화에서 initial paint·scroll·search를 별도 측정
- 새 UI framework·대형 icon/font package를 추가하지 않음
- CSS/JS bytes·DOM node·layout shift·long task를 current와 비교하고 설명 없는 회귀를 허용하지 않음

완료 문장:

> T5의 긴 한국어 답·표·코드·결과가 넓은 화면과 좁은 창에서 모두 편안하게 읽히고, 색과 움직임이 실제 상태
> 이해를 돕되 주의를 빼앗지 않는다.

---

#### UX-3 — Grounded Progress to Final Transition

현재 canonical progress를 보존하고 표현만 정돈한다.

진행 흐름:

```text
입력 접수
→ 최소 생존 신호
→ 첫 실제 model/tool 사건
→ 의미 있는 milestone
→ streamed answer preview 또는 first useful result
→ final answer
→ progress 자동 접힘
```

표현 규칙:

- direct answer에서는 생존 신호가 final과 경쟁하지 않도록 짧게 사라짐
- Tool 시작 전에는 구체적인 파일·웹·검증 문구를 만들지 않음
- 같은 단계에 새 Evidence가 없으면 경과시간만 갱신
- 활동 사실은 최근 중요 단계 최대 4~6개
- streamed answer는 final과 같은 위치·renderer를 사용
- final 도착 후 temporary preview·duplicate steps는 제거
- 완료 뒤 `과정 보기`는 실제 milestone만 접힌 형태로 제공
- 과정 보기는 기본 닫힘이며 모델 사고·명령·경로를 보여주지 않음
- degraded·approval·capability needed는 normal progress와 다른 명확한 상태
- Stop 후 `멈추는 중 → 멈췄어요`가 실제 process·claim settlement와 일치

Progress density:

| 작업 | 기본 표현 |
|---|---|
| Direct | 생존 신호 후 즉시 답, process disclosure 없음 |
| Bounded Web/Attachment | 관측 한 줄, source/result 후 final |
| File/OCR | filename·content·visual 단계가 실제로 열릴 때만 |
| Authoring | 자료 확인·candidate·발행·검증의 terminal 단계 |
| Project | inspect·change·test·server·Browser의 실제 milestone |
| External | capability·authority·dispatch·readback·delivery 구분 |

반대시험:

- 15초 동안 같은 상태 문구가 새 일처럼 순환
- 다른 Session의 progress 혼입
- final 뒤 running·멈춤 버튼 잔존
- reconnect 후 과거 transient step이 현재 작업처럼 표시
- 거의 완료 근거 없이 거의 완료 문구
- provider failure 뒤 success progress

완료 문장:

> 사용자는 짧은 답을 기다리지 않고, 긴 작업은 실제 진전과 첫 유용한 결과를 이해하며, 최종 답이 도착하면 과정은
> 방해 없이 정돈되고 필요할 때만 다시 볼 수 있다.

---

#### UX-4 — Unified Result & Artifact Surface

현재 Artifact·Publication·Effect·Delivery·Undo identity를 한 사용자 결과 표면으로 결속한다. 새 결과 Store나
UI-only 성공 상태를 만들지 않는다.

Single result:

```text
┌──────────────────────────────────────────────┐
│ [type/preview]  파일 이름                    │
│                 형식 · 크기 · version        │
│                 검증 상태 · source summary   │
│                                              │
│ [미리보기] [파일 받기] [Finder/Explorer]     │
│ [방금 변경 되돌리기] — exact Undo가 있을 때  │
└──────────────────────────────────────────────┘
```

Multiple results:

- 한 `결과물 N개` group 안에 개별 파일 row
- 각 파일 Preview/Download/Reveal
- 실제 bundle/ZIP가 있을 때만 `전체 받기`
- diagnostic·temporary·sidecar는 사용자 결과에 섞지 않음
- 같은 family의 version history와 current 표시

Metadata priority:

1. 사람이 읽는 파일 이름
2. Preview/Download/Reveal primary actions
3. current version·형식·크기
4. 검증·source·delivery summary
5. 상세 provenance·Effect forensic — 접힘

정확성:

- Preview·Download·Reveal은 같은 attachment/file identity
- title click은 Runtime exact file reference만 사용
- stale/missing은 parent fallback을 성공으로 꾸미지 않음
- Undo는 exact current preimage·same family에서만
- delivery unknown과 local preservation을 구분
- internal URL·absolute path·attachmentId·hash·Run ID 비노출
- achieved Artifact가 있으면 같은 success의 mutation receipt 반복 0
- 파일명·사용자 content는 textContent/sanitized renderer만 사용하고 action label·tooltip의 HTML injection을 막음
- external source link와 local action은 시각·키보드 의미를 구분

Visual quality:

- type icon과 preview thumbnail의 일관된 비율
- 파일명이 길어도 action을 밀어내지 않음
- primary action 하나만 accent
- version·검증 badge를 남발하지 않음
- warning은 실제 unknown·failed일 때만
- 크게 보기 modal은 대화 scroll 위치를 보존

완료 문장:

> 사용자는 T5가 만든 결과를 한 자리에서 즉시 보고 받고 Finder에서 찾고 수정 이력과 검증 범위를 확인하며,
> 가능한 변경은 정확히 되돌린다.

---

#### UX-5 — Composer, Correction & Control

Composer는 입력 상자가 아니라 현재 상호작용 가능성을 알려주는 제어면이다.

상태:

```text
idle
submitting
responding
working
stopping
user_action_required
recovery_pending
```

필수 행동:

- idle: Send primary, attachment·voice·model/connection 확인
- running: Send는 교정·추가 입력, Stop은 별도 명확한 action
- stopping: 중복 Stop·Send로 새 실행을 만들지 않음
- user_action_required: 필요한 행동 하나와 재개 상태 표시
- attachment: upload·ready·failed·cancel을 chip에서 확인
- model/connection은 확인 가능하지만 일반 입력보다 시각적으로 앞서지 않음
- busy input은 어느 Work에 반영되는지 내부 용어 없이 `현재 작업에 반영`으로 안내
- Session을 바꿔도 composer draft와 upload 상태가 잘못 섞이지 않음

Keyboard:

- Enter 전송
- Shift+Enter 줄바꿈
- 한글 IME composition 중 Enter 오전송 0
- Escape는 modal/preview를 닫되 실행을 취소하지 않음
- 명시 shortcut이 있을 때만 Stop/새 대화 실행
- focus 순서는 attachment→input→Send/Stop의 논리적 흐름

완료 문장:

> 사용자는 지금 보낼 수 있는지, 실행 중 교정할 수 있는지, 무엇을 멈추는지, 어떤 행동이 필요한지 입력창만
> 보아도 이해하며 원문·첨부·현재 작업을 잃지 않는다.

---

#### UX-6 — Conversation Pinning, Manual Groups & Search

기존 Session·archive·delete·restore·batch·global search를 재사용한다. 첫 범위는 사용자가 직접 정리하는 기능이며
AI 자동 분류와 persona를 만들지 않는다.

기능:

- 중요한 대화 `고정`·해제
- 고정 대화의 안정된 상단 영역과 수동 순서
- 사용자가 이름을 붙이는 수동 group/folder
- 대화를 한 group으로 이동·미분류로 되돌림
- group 접기·펼치기
- 전체 대화 검색 결과에서 exact conversation·주변 문맥 열기
- active·archived 검색 포함, deleted 제외
- multiple select 후 archive·delete·restore·group move
- running·needs attention·Telegram origin·archived 상태의 절제된 표시

최소 canonical metadata:

```text
sessionId
pinnedAt | null
pinOrder | null
groupId | null

group:
  groupId
  displayName
  order
  collapsed — UI preference
```

제약:

- Conversation content를 새 group DB에 복제하지 않음
- group 이름이 Memory·persona·업무 Router가 되지 않음
- AI가 사용자 동의 없이 자동 grouping하지 않음
- group 이동이 Session·Work·Telegram origin을 바꾸지 않음
- deleted Session을 group 이동으로 부활시키지 않음
- pin·group API 실패 시 UI만 성공 상태로 바꾸지 않음
- 30·300·3,000 Session에서 초기 목록 first paint와 search를 측정

시각 구조 후보:

```text
고정
  중요한 대화 A
  고객 정산 B

회사 운영   3
  8월 매출
  직원 계약
  지원사업

고객 프로젝트   2
  한빛상사
  모두의창업

미분류
```

완료 문장:

> 사용자는 중요한 대화를 고정하고 자신의 일 기준으로 직접 묶고 전체 원문을 검색해 다시 열며, 내부 Session·
> Memory 구조를 배울 필요가 없다.

---

#### UX-7 — Accessibility, Visual QA & Human Qualification

접근성:

- WCAG AA contrast
- 모든 interactive control keyboard reachable
- visible focus ring
- icon-only action의 accessible name·tooltip
- progress의 `aria-live` 밀도 제어, 같은 경과시간 반복 낭독 금지
- modal focus trap·close 후 원래 위치 복귀
- Artifact preview alt/source
- 색만으로 success·warning·failure 구분하지 않음
- 200% zoom과 reduced motion
- macOS·Windows system font의 한글 glyph·line metric
- light/dark 모두 동일한 keyboard·screen reader 의미
- loading·empty·partial·error·offline·reconnect 상태가 빈 화면이나 색 하나로만 표현되지 않음

실제 Console Mission:

1. 인사·한 문단 답: user bubble + T5 flat response, Tool 0
2. 제목·1·2·3 목록·표·코드·인용이 있는 1,500자 답
3. 20초 작업: immediate feedback→actual milestone→stream preview→final→process 접힘
4. Artifact v1→v2: Preview·Download·Reveal·Version·Source·Undo 한 surface
5. 실행 중 교정·추가 첨부·Stop·Session 이동·복귀
6. 대화 pin→manual group 이동→global search→archive/delete/restore→batch action
7. wide·normal·narrow viewport와 keyboard-only 수행
8. Telegram-origin Session과 일반 Session의 목록·결과 무혼입

A/B:

- current exact UI vs candidate
- 같은 fixture·같은 canonical state
- UX-R에서 선택한 T5 prototype과 current source
- task completion time가 아니라 다음 UX 성과를 비교

```text
first feedback 이해
첫 유용한 결과 발견
긴 답 핵심 정보 탐색
결과 Preview/Download/Reveal 발견 click 수
Undo 발견과 성공
현재 작업·중지 가능성 이해
대화 검색·고정·group 이동 성공
신뢰·편안함·다시 사용 의향
```

Human score 1~5:

- 가독성
- 진행 이해
- 속도 체감
- 결과 사용성
- 통제감
- 신뢰
- 정리 편의
- 전체 쾌적함

합격:

- 관련 Mission P0/P1 0
- 각 핵심 항목 평균 4.0 이상
- current UI보다 사용자 과업 성과 무회귀
- 실제 Browser screenshot과 click evidence
- product integration·전체 CI 1회·clean tree

완료 문장:

> T5의 대화창은 짧은 대화·긴 작업·결과물·교정·정리에서 기술을 드러내지 않고도 현재 상황과 다음 행동을
> 이해하게 하며, 사용자는 빠르고 편안하게 읽고 결과를 사용하고 작업을 통제한다.

---

#### S6-UX 명확한 비목표

- Codex의 branch·diff·commit·subagent·environment panel 복제
- 모델 reasoning·chain-of-thought·raw Tool log 노출
- 새 Work·Progress·Artifact canonical Store
- 모든 assistant 메시지와 user 메시지를 같은 flat layout으로 표시
- AI 자동 대화 grouping·업종 분류·persona
- 모든 P2 미관을 출시 blocker로 확대
- 결과 정확성·검증·Undo를 줄여 화면 단순화
- UX 변경마다 전체 6차 HQ 반복
- 현재 기능과 무관한 새로운 Canvas·Dashboard·mobile app 개발

#### S6-UX 실행 순서

```text
UX-0 current baseline
→ UX-R comparative measurement·isolated T5 prototype
→ UX-1 assistant flat layout
→ UX-2 typography/responsive
→ UX-3 progress→final transition
→ UX-4 unified Artifact surface
→ UX-5 composer/control
→ UX-6 pin/manual group/search
→ UX-7 actual human qualification
→ S6-HQ 합류
```

한 slice는 실제 사용자 목적 하나·screenshot A/B·focused regression 뒤 clean commit으로 닫는다. 같은 시각/행동
결함 가족의 두 후보가 실제 사용자 성과를 높이지 못하면 세 번째 장식 patch를 붙이지 않는다.

---

### S6-RP — Owner-Ordered Release & Windows Preparation Sequence

현재 상태: `OWNER_ORDER_LOCKED · TOTAL_HQ_ACTIVE · PACKAGE_AND_WINDOWS_WORK_NOT_OPEN`

오너가 2026-08-30 다음 실행 순서를 확정했다. 뒤 단계가 중요하다는 이유로 앞 단계를 병렬 구현하거나 건너뛰지
않는다.

```text
1. 현재 별도 총괄 인간 HQ를 끝낸다.
2. HQ Evidence에 실제 사용자 ambiguity가 남을 때만 오너 보좌 세션이 Console live를 한 번 더 확인한다.
3. 관련 P0/P1 최소 수리·Mission 1회 재시험·source 재봉인 뒤 macOS 정식 version 6.0 package를 완성한다.
4. 6.0 package가 설치 제품으로 봉인된 뒤 개발 세션이 S6-WP0 Windows Pre-Physical Readiness를 수행한다.
5. WP0 보고 뒤 Windows 설치본 제작·물리 시험의 정확한 범위는 오너가 다시 결정한다.
```

#### RP-1 — 총괄 인간 HQ 종료

[T5 총괄 인간 제품 HQ](/Users/jyp/Developer/t5-total-hq/T5-TOTAL-HUMAN-HQ.md)의 현재 macOS core Mission을
실제 Console에서 실행한다. 시험 Agent는 제품을 수정하지 않고, 재현된 P0/P1만 단일 Repair Owner가 순차 수리한다.

종료 조건:

- 필수 macOS Mission P0/P1 0
- UX T0~T5·first useful·결과 사용성·통제감 Evidence
- 속도 carry와 external boundary 비주장 보존
- 수리한 Mission만 1회 재시험
- 전체 CI 1회·clean product tree·source candidate commit

#### RP-2 — 선택적 Console Live 재확인

총괄 HQ 뒤 다음 중 하나가 남을 때만 오너 보좌 세션이 같은 설치 후보의 실제 Console을 한 번 더 사용한다.

- 화면 Evidence와 Work·Effect·Artifact 원장이 다르게 보임
- 입력·진행·Stop·final 전환의 인간 체감 판정이 모호함
- 수리된 P0/P1이 여러 사용자 표면에 영향을 줌
- package 전 실제 사용자 시작점에서만 확인 가능한 미달

이미 PASS한 전체 Mission을 반복하지 않는다. 기능 탐색·새 개발·비교군 확대를 열지 않고 모호한 사용자 경계만
확인한다.

#### RP-3 — macOS 정식 version 6.0 package

HQ와 선택적 live 확인이 종료된 exact source commit만 사용한다. 사용자 표시 version은 `6.0`, package 내부
semantic version은 `6.0.0`으로 통일하며 과거 `0.3.x·0.4.x·0.5.x` builder 값을 재사용하지 않는다.

필수:

- Apple Silicon·Intel Universal app/runtime/helper
- exact source commit·payload manifest·SHA-256
- Product Cleanroom·휴면/qualification/research source 제외
- 기존 사용자 상태를 보존하는 upgrade
- 신규 clean install
- 실패 시 이전 설치 복원·Runtime drain·singleton
- Developer ID 서명·Apple notarization·staple·Gatekeeper
- 실제 설치→Console 시작→직접 답·파일/Artifact 핵심 smoke→앱 재시작
- 제거 범위와 사용자 state 보존 확인

`티파이브개발 연구/`는 사용자 소유 비정본 미추적 자료이며 source package·payload·Git stage에 포함하지 않는다.
설치본 제작은 기능 개발 Gate가 아니며 package 실패를 Core 변경으로 우회하지 않는다.

완료 문장:

> 6차 exact macOS source가 version 6.0 Universal 설치 패키지로 서명·공증·staple되고, clean install·upgrade·실제
> Console 핵심 여정·재시작·실패 복원이 같은 사용자 상태와 제품 의미로 성립한다.

#### S6-WP0 — Windows Pre-Physical Readiness

현재 상태: `PLANNED · MUST_START_AFTER_MACOS_6_0_PACKAGE · PHYSICAL_PASS_NOT_CLAIMED`

목적:

> 물리 Windows에서 처음 컴파일·경로·dependency·adapter 결함을 찾지 않도록, macOS 6.0 봉인 뒤 현재 source의
> Windows reachability·공통 의미·package 계약을 제품 변경 0 감사부터 최대한 닫고, 실제 OS만이 증명할 blocker만
> 물리 시험으로 가져간다.

WP0는 Windows 설치본 제작이나 물리 PASS가 아니다. 공통 Core를 모델별·업무별로 다시 만들지 않고 macOS에서 선
T5 의미가 Windows adapter에서 어디까지 준비됐는지 확인한다.

##### WP0-1 — Feature/Adapter Reachability Matrix

6차 최종 기능을 다음 상태로 inventory한다.

```text
COMMON_CORE_COMPLETE
WINDOWS_ADAPTER_IMPLEMENTED
CONTRACT_TESTED_ONLY
WINDOWS_RUNNER_REQUIRED
PHYSICAL_WINDOWS_REQUIRED
NOT_IMPLEMENTED
NOT_APPLICABLE
```

필수 행:

- Console·Conversation·Memory·Work·Run·Context·model connection
- File search·content·OCR·visual·exact handle·Reveal
- Document read/render/authoring·QualityReceipt·Artifact·Undo
- Terminal foreground/background·PowerShell/CMD·ConPTY·large output·cancel·restart
- D process ownership·Job Object·wake·crash settlement
- E declared-target confinement·NTFS identity·rollback
- F transaction·atomic publication·Undo
- G same-language program·source universe·output verification·cleanup
- Browser·download/upload/login handoff
- Capability·Skill·CLI·MCP·Experience Growth
- DPAPI·Transmission·backup/restore/delete
- Telegram·Automation·external Delivery
- package·install·upgrade·uninstall·Startup·singleton
- UX·narrow window·keyboard·IME·Preview·Download·Reveal

##### WP0-2 — POSIX Assumption & Common-Core Audit

공유 product path의 다음 가정을 전수 분류한다.

- `/bin/sh·/bin/zsh·/usr/bin`, `find·grep·sed·awk`
- `/Users·/tmp·/private/tmp`, `/` absolute path, `:` PATH delimiter
- `chmod·mode·uid·gid·inode·dev·nlink`
- `SIGTERM·SIGKILL·process group·fork`
- symlink만 보고 junction·reparse를 놓치는 identity
- case-sensitive filename·trailing dot/space·reserved device name
- atomic rename·file lock·fsync·cross-volume 가정
- shell string·quote·environment expansion

각 finding은 `macos_only_valid·windows_adapter_exists·shared_core_defect·runner_required·physical_required` 중 하나로
닫는다. 실제 사용자 Mission 없는 hypothetical portability rewrite를 만들지 않는다.

##### WP0-3 — Windows Filesystem & Path Countertests

물리 Windows 전 가능한 contract 시험:

- drive letter·root·UNC·한글·공백·긴 경로
- x64·ARM64·case-insensitive duplicate
- reserved names `CON·NUL·COM1`
- trailing dot·space
- junction·reparse·hardlink·target replacement
- volume boundary·locked file·stale identity
- OneDrive/local sync path semantics
- Explorer exact file/directory reveal invocation

fixture path 문자열 통과를 실제 NTFS PASS로 표현하지 않는다.

##### WP0-4 — Known Pre-Physical Product Gaps

현재 head에서 이미 확인된 후보를 다시 실제 source와 대조한다.

1. `terminal-platform-adapter`의 non-darwin passthrough와 Windows declared-target confinement 부재
2. G `programExecutionAdapter`의 macOS-only product admission
3. `local-image-ocr`의 Windows `unavailable` 경계
4. Windows package builder의 과거 `0.3.1` version·unsigned ZIP 경계
5. Windows Search·folder picker·file/app activity helper의 source contract와 physical reality 차이
6. Browser host·document render·native dependency의 win32 x64/ARM64 payload
7. DPAPI·Job Object·ConPTY actual이 macOS에서 skip되는 범위

이 목록은 자동 구현 지시가 아니다. Feature/Adapter matrix와 actual 사용자 영향에서 Windows 공개 blocker인 항목만
후보화한다.

##### WP0-5 — Windows Runner Before Physical Device

가능한 실제 Windows runner/VM에서 먼저 확인한다.

- x64·ARM64 package dependency resolution과 native helper compile
- PowerShell·CMD direct argv·Unicode·exit/stdout/stderr
- Job Object child tree·ConPTY input/resize·cancel
- DPAPI fixture account
- Windows package manifest·architecture·digest
- install·upgrade·rollback·uninstall·state preservation
- current unit·product integration·mutation 중 Windows 적용 범위

GitHub runner·VM·emulation은 물리 PASS를 대신하지 않는다. `runner_pass`와 `physical_pass`를 별도 Evidence로 남긴다.

##### WP0-6 — Model-Independent Platform Contract

모델에 공급되는 최소 Windows 현실을 확인한다.

```yaml
platform: win32
architecture: x64 | arm64
commandFamily: powershell | cmd
commandProgram: exact observed executable
availableHands:
qualifiedBoundaries:
unavailableCapabilities:
```

대표 기본 모델과 보조 모델은 같은 사용자 목적에서 Windows 현실을 보고 각기 다른 실행 방법을 선택할 수 있다.
Runtime·Prompt를 모델별로 코딩하지 않는다. 합성 platform fixture는 Tool 선택·거짓 capability 부재/존재를 확인할
뿐 실제 Windows effect PASS를 만들지 않는다.

##### WP0-7 — Repair Discipline & Exit

- WP0 read-only inventory를 먼저 봉인한다.
- Windows-only adapter 미달만 한 가족씩 순차 수리한다.
- 공유 Core 변경은 가장 작은 macOS 관련 회귀를 다시 확인한다.
- 같은 결함 가족 세 번째 patch 금지.
- 전체 CI 반복 금지; focused regression 뒤 WP0 종료 시 한 번.
- 연구실의 Computer Use·Document·Method Runtime·실천지능을 Windows 보강 명분으로 개통하지 않는다.
- Windows 설치본·서명·배포는 오너의 다음 결정 전 시작하지 않는다.

WP0 종료 산출:

```yaml
sourceCommit:
macos60PackageIdentity:
featureAdapterMatrix:
staticFindings:
repairedPrePhysicalGaps:
runnerResults:
physicalBlockers:
windowsInstallerDecision: OWNER_PENDING
```

완료 문장:

> 6차 version 6.0의 공통 의미와 Windows adapter·package source가 물리 시험 전 가능한 범위에서 자격되고,
> 남은 항목은 NTFS·DPAPI·ConPTY·Job Object·Windows Search·UAC·Defender·실제 설치·UX처럼 물리 Windows만이
> 증명할 blocker로 축소됐으며 Windows 설치본 제작은 오너 결정 전 열리지 않는다.

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

현재 판정: `MACOS SOURCE CANDIDATE COMPLETE · RELEASE SPEED CARRY · DESKTOP OBSERVATION CLOSED · WINDOWS DEFERRED_NOT_WAIVED`

최종 macOS wave는 이미 통과한 대형 여정을 반복하지 않고 S6-UX 실제 Console와 현재 head의 속도 carry만
재확인했다. 날씨는 정확성·출처를 유지했지만 12.396초로 오너 7초 목표를 달성하지 못했고, 단일 첨부는
4.190초를 기록했다. 이 속도 미달을 정확성을 줄여 숨기거나 같은 결함 가족의 세 번째 patch로 덮지 않는다.

제품 통합은 205/205, Windows 전용 2개는 skip이었다. 최종 CI 반복에서 변경과 무관한 Linear timing 여정이
2.1초 경계에서 한 번 놓쳤고, 동일 여정 단독 재실행은 1/1 통과했다. 제품 patch는 0이며 mutation 2/2가 통과했다.

이 판정은 macOS source candidate의 봉인이다. 6차 cross-platform 최종 완료나 외부 공개 설치본은 주장하지 않는다.
x64·ARM64 실물 Windows 자격과 별도 설치 후보 제작이 다음 오너 단계다.

근거: `refoundation/evidence/s6-hq-macos-source-closeout-2026-08-30.json`.

모든 기술 Gate가 닫힌 exact clean head에서 한 번만 실행한다. runner는 fixture 준비·원장 회수·oracle에만
사용하고, 사용자의 시작·입력·진행·교정·결과·Preview·Undo·재접속은 실제 Console UI에서 수행한다.

#### S6-HQ 종속 실행 정본

실제 인간 제품 HQ의 Mission·fixture·UX timeline·속도·심각도·blind 비교·Evidence 양식은 별도 실행 프로토콜인
[T5 총괄 인간 제품 HQ](/Users/jyp/Developer/t5-total-hq/T5-TOTAL-HUMAN-HQ.md)를 사용한다.

이 문서가 6차 제품 약속·Gate·완료 범위의 단일 계획 정본이며, 별도 HQ 문서는 이를 반복하거나 변경하는 두 번째
제품 정본이 아니다. 별도 문서는 S6-HQ를 실제 설치 제품에서 실행하기 위한 종속 시험 정본이다. 둘이 충돌하면
이 문서의 현재 오너 결정·Gate·금지선이 우선하며, 별도 HQ의 source commit·제품 version·conditional Mission을
실행 직전 exact candidate에 맞게 갱신한다.

#### S6-HQ Agent Team 실행 규율

Agent Team의 목적은 Mission 수를 늘리거나 여러 Agent가 같은 T5를 동시에 조작하는 것이 아니다. 격리된 실제
사용자 실행, blind ground truth, UX 관측, 기계 Evidence 회수를 독립시켜 더 빠르고 정확하게 판정하는 것이다.

기본 역할:

| 역할 | 권한과 책임 |
|---|---|
| HQ Controller·Final Judge | exact package·commit·Mission 순서·중단선·최종 PASS/PARTIAL/FAIL을 한 곳에서 소유 |
| Fixture Operator | 비식별 fixture·숨은 정답·loopback·시험 계정 준비. Mission Runner에게 위치·marker·oracle 비공개 |
| Mission Runner | 실제 설치 Console에서 일반 사용자처럼 입력·클릭·교정·중지·재접속. Store·내부 API·source 직접 접근 금지 |
| UX Observer | T0~T5·첫 feedback·first useful·최종·click 수·혼란·중지 가능성을 읽기 전용 기록. 정답 판정 금지 |
| Evidence Auditor | Run·Work·Tool·Effect·Artifact·Delivery·비용을 실행 뒤 읽기 전용 회수해 사용자 화면과 대조 |
| Repair Owner | 재현된 P0/P1만 순차 수리하는 유일한 제품 수정자. 시험 Agent와 병렬 수정 금지 |

가장 효율적인 기본 구성은 `Controller 1 + 격리 Mission Runner들 + 공용 UX/Evidence 감사 lane`이다. 한 Mission에
항상 여러 Agent를 붙이지 않는다. 짧은 Direct·단일 첨부 positive control은 Runner 한 명과 자동 timing recorder면
충분하다. 복합 산출물·프로젝트·동시 입력·외부 Delivery처럼 화면과 원장 판정이 갈릴 수 있는 Mission에만 UX
Observer와 Evidence Auditor를 추가한다.

병렬화 허용:

- 서로 다른 격리 HOME·STATE·WORKSPACE·Browser profile·시험 계정을 가진 독립 Mission
- fixture 생성·hidden oracle 준비와 제품 실행 전 환경 검증
- 완료된 Mission의 screenshot·timing·원장·Artifact read-only 감사
- macOS·Windows x64·Windows ARM64의 독립 물리 환경
- 동일 결과의 UX 평가와 기계 Evidence 대조처럼 제품 상태를 바꾸지 않는 판정 lane

순차 실행 필수:

- 같은 Session·Conversation·Memory·Work·Runtime·Telegram chat·Automation job을 공유하는 Mission
- 기억→현재 교정→forget, version→Undo, busy input→cancel→restart처럼 앞 단계 상태가 다음 단계 입력인 여정
- 같은 외부 effect·Delivery·ACK unknown을 건드리는 시험
- 같은 package candidate의 upgrade·rollback·delete·restore
- P0/P1 수리와 그 수리 후 관련 Mission 재시험
- Final Judge의 중복 finding 정규화와 완료 판정

Agent 격리·blindness:

- Mission Runner는 hidden filename·marker·expected row·정답 위치를 받지 않는다.
- Fixture Operator는 사용자 UX 점수와 최종 PASS를 판정하지 않는다.
- UX Observer는 내부 원장을 보고 사용자 화면을 해석하지 않는다.
- Evidence Auditor는 모델 답을 정답으로 사용하지 않고 actual source·effect·Artifact를 대조한다.
- Agent 간 전달은 Mission ID·public user prompt·content-free timing·opaque Evidence handle·판정 초안만 사용한다.
- 실제 사용자 자료·비밀·절대경로·전체 screenshot·provider body를 Agent 메시지에 복제하지 않는다.

효율 규율:

```text
Phase 단위 fixture 준비
→ 저비용 positive control로 package·model·Console 건강 확인
→ 독립 Mission만 가능한 범위에서 병렬 실행
→ 고비용·상태 의존 Mission은 한 번씩 순차 실행
→ UX와 기계 Evidence를 병렬 감사
→ Controller가 같은 결함 가족을 하나로 정규화
→ P0/P1만 Repair Owner가 순차 수리
→ 관련 Mission만 1회 재시험
→ 마지막에 전체 CI 1회
```

- 같은 fixture·같은 모델·같은 결함을 여러 Agent가 중복 실행하지 않는다.
- 한 Agent의 timeout이나 provider failure를 제품 실패로 복제하지 않고 environment/provider/product를 분리한다.
- P0가 재현되면 의존하는 고비용 Mission을 즉시 중단한다.
- 외부 경계가 확인되면 scraper·Connector·Prompt 경쟁을 열지 않고 `PARTIAL_EXTERNAL_BOUNDARY`로 보존한다.
- Agent 수·병렬 Turn·검사 수를 완료 근거로 사용하지 않는다.
- 병렬 Mission이 CPU·disk·provider rate limit·Browser·포트에 간섭하면 병렬화를 줄이고 결과 신뢰성을 우선한다.
- 제품 코드를 수정하는 Agent는 항상 한 명이며, 수정 중 다른 Agent는 같은 candidate를 실행하지 않는다.

Agent Team 완료 문장:

> 격리 가능한 인간 Mission과 읽기 전용 증거 감사만 병렬화되고, 상태 의존 여정·외부 효과·제품 수리는 한 책임자
> 아래 순차 실행된다. Agent Team은 같은 시험을 복제하지 않고 blind 사용자 경험과 actual 기계 현실을 독립적으로
> 대조해 더 적은 실행으로 더 신뢰할 수 있는 최종 제품 판정을 만든다.

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
