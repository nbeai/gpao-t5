# T5 Fourth Completion — Android Work Intelligence

상태: `FOURTH_COMPLETION_ACTIVE · S4_0_COMPLETE · S4_A_COMPLETE · S4_B_COMPLETE_MODEL_OBSERVATION · S4_D0_FACT_ONLY_CORRECTED · S4_C_CLOSED_WITH_MODEL_PROVIDER_OBSERVATION_NOT_UNIVERSALLY_PROVEN · S4_D_TERMINAL_MANAGED_NON_PTY_COMPLETE · S4_D5C_PRODUCT_ISOLATION_COMPLETE · S4_E_MANAGED_MUTATION_CONFINEMENT_COMPLETE · S4_F_STRUCTURED_AUTHORING_COMPLETE · S4_G_INTERNAL_ENGINE_COMPLETE_PRODUCT_ACTIVATION_CLOSED_WITH_OBSERVATION_FURTHER_DEFERRED · S4_G_ACTUAL_READSET_UNKNOWN_BY_DESIGN_SOURCE_UNIVERSE_COMPLETE_IMMUTABLE_OUTPUT_COVERAGE_INDEPENDENTLY_VERIFIED · S4_H_CLOSED_WITH_EXISTING_CAPABILITY_OBSERVATION_HQ_REQUIRED_PRODUCT_IMPLEMENTATION_ZERO · S4_I_COMPLETE_EXISTING_RECOVERY_CAPABILITY_PRODUCT_IMPLEMENTATION_ZERO · S4_UX_INTERACTION_CONTINUITY_COMPLETE · S4_L_READ_ONLY_BASELINE_NEXT · S4_J_DEFERRED_FUTURE_RESEARCH · S4_K_ACQUISITION_DEFERRED_CAPABILITY_REALITY_CROSSCUTTING`
현재 Gate: `S4-L WINDOWS PHYSICAL QUALIFICATION · READ-ONLY BASELINE`
출발 기준: `t5-0.3.1-clean-baseline · 8aba3700`
개발선: `codex/t5-fourth-android-intelligence · /Users/jyp/Developer/t5-fourth`

이 문서는 T5 4차 개발의 유일한 현재 계획 정본이다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은
`AGENTS.md`가 담당한다. 2차·3차 계획과 Cleanroom 문서는 완료 역사와 증거이며 현재 범위를 열지 않는다.
Terminal·Work Intelligence·Capability·Windows를 설명하는 별도 총괄 계획서를 만들지 않는다. 각 Gate의
작은 기계 증거만 `refoundation/evidence/`에 남긴다.

`Android`는 사용자의 목적을 이해하고 현실에서 스스로 적절한 손을 구성하는 제품 비유다. Android 모바일
운영체제를 뜻하지 않는다. 외부 제품 목표는 `Android Intelligence`, 이번 4차의 내부 기술 목표는
`Work Intelligence + Terminal Execution + Safe Program Composition`이다.

## 1. 제품 약속과 최종 완료 문장

> 사용자는 기능·명령어·프로그램을 선택하지 않고 평소 말로 목적만 설명한다. T5는 사용자의 상황과 기준,
> 컴퓨터와 외부 자원의 현재 현실을 파악하고 가장 경제적인 방법을 선택한다. 기존 손으로 충분하면 즉시
> 사용하고, 부족하면 현재 Work에 필요한 작은 도구를 만들거나 이미 사용할 수 있는 검증된 대안을 찾는다. 큰 자료와 장시간
> 작업도 가볍게 관리하며 맡긴 범위 안에서만 실행하고, 결과·효과·전달을 검증한다. 실패·교정·취소·Runtime
> 사고 뒤에도 고아 실행과 중복 효과 없이 이어가며, 사용자는 내부 프로그램과 기술을 배우지 않고 실제
> 결과와 남은 미확인·필요한 다음 행동만 받는다.

4차는 Capability 수나 Terminal 기능 수를 늘리는 개발이 아니다. 강한 모델의 목적 이해·방법 구성·복구와
T5의 현실 감각·기억·손·실행 장부를 한 몸으로 만들어 처음 보는 업무도 끝내는 단계다.

```text
사람의 평범한 말
→ 목적과 결과 사용처 이해
→ 현재 현실·기억·능력 파악
→ 가장 경제적인 방법 선택
→ 기존 손 조합 또는 작은 프로그램 작성
→ 맡긴 범위 안에서 실행
→ 자료 연결·계산·대사
→ 결과·효과·전달 검증
→ 실패하면 다른 방법으로 복구
→ 실제 결과와 남은 미확인 정산
→ 사용자에게 자연스럽게 전달
```

## 2. 역할 경계

| 구성 | 책임 |
|---|---|
| 모델의 머리 | 목적·사용처·방법·Evidence 선택·실패 의미·대안·완료 의미·사용자 문장 |
| T5의 몸과 손 | Terminal·File·Document·Web·Connection·Capability의 관측과 실행 |
| 신경과 장부 | Conversation·Situation·Memory·Work·Run·Resource·Receipt·진행·취소·복구 |

Runtime은 identity·revision·coverage·freshness·권한·비용·실행·효과·전달·중복 방지·취소·복구를 제공한다.
Runtime은 업무 이름, 사용자 문장, 서비스 이름의 정규식으로 의미를 선택하지 않는다. 최종 답은 모델이
작성하며 고정 템플릿이나 사후 문장 교정기로 대체하지 않는다.

## 3. 현재 Gate의 작업 시작 일곱 줄

1. **제품 약속**: 사용자는 평소 말로 목적만 맡기고 T5가 현실에서 실제로 끝낸다.
2. **현재 Gate**: S4-L Windows physical qualification의 read-only baseline이다.
3. **사용자 완료 문장**: 같은 T5 머리와 사용자 약속이 macOS와 Windows의 실제 OS 손에서 각각 성립한다.
4. **이미 선 실제 증거**: Windows x64·ARM64 package contract, direct argv, ConPTY, Job Object, DPAPI, file/app helper,
   CI runner와 deferred physical manifest가 있다.
5. **현재 가장 큰 미달**: GitHub runner·source contract는 있지만 실제 Windows x64·ARM64 사용자 제품 여정은 아직
   물리 자격되지 않았다.
6. **이번 변경 방식**: 제품 변경 0에서 기존 Windows evidence·runner·deferred manifest를 전부 대조해 실제 장비에서
   실행 가능한 범위와 현재 blocker를 먼저 고정한다.
7. **Non-goals**: macOS 성공·Linux/WSL·emulation을 Windows PASS로 승격, 새 Windows 기능 구현, UI 재설계.

이 일곱 줄이 Git·실행·증거에서 확인되지 않으면 구현하지 않는다.

## 4. 변하지 않는 개발 규율

- 인사·재고·총무·개발·연구 전용 Core나 고정 workflow를 만들지 않는다.
- 최초 실패 하나로 구현을 열되, Gate 완료는 같은 결함 가족이 서로 다른 세 목적 분야에서도 성립해야 한다.
- 기존 시나리오·fixture·실행 증거를 우선 재사용하고 실제 차이가 난 축만 확대한다.
- 기존 모듈은 정본이 아니라 교재다. `현재 실패 → 필요한 계약 → 과거 원리 확인 → 가장 작은 현재 구현`
  순서로만 재사용한다.
- 모델 입력 결함은 실제 prompt dump를 읽기 전에 추론으로 고치지 않는다.
- 새 구조를 만들었다는 사실이 아니라 같은 사용자 목적의 결과로 판정한다.
- 각 Gate 동안 관련 최소 시나리오만 실행한다. 전체 인간 wave는 S4-HQ에서 한 번 수행한다.
- 비교군의 source·동작에서 실패를 막는 원리만 추출하고 제품 화면·용어·아키텍처를 복제하지 않는다.
- 한 결함 가족에 세 번째 patch가 필요하면 추가 구현을 중단하고 구조를 재판정한다.
- 시도가 반복 실패하면 같은 방향의 문구·조건을 더 붙이지 않는다. 사용자 목적·현재 source·wire·실제
  model input·비교 원리를 총괄 재점검하고, 첫 가정과 다른 관점의 해결 후보를 세운 뒤 다시 시작한다.

모든 설계 후보는 구현 전에 네 질문을 통과한다.

```text
사례가 늘면 목록이 자라는가, 하나의 원리가 흡수하는가?
Runtime에 의미 선택을 넣는가, 관측 사실만 주고 모델이 해석하는가?
안전을 등급·반복 승인·절대 금지의 마찰로 사는가, 격리·관측·Receipt·복원으로 만드는가?
범위가 Gate·기능 수인가, 사용자가 말할 수 있는 닫는 문장 하나인가?
```

경쟁군 대비 더 빠른 속도·정확성·경제성을 계속 추구한다. 새 상태나 protocol이 정확성을 높여도 짧은
요청과 이미 잘하던 목적의 model calls·tool calls·provider bytes·첫 유용한 결과를 이유 없이 악화시키면
채택하지 않는다.

## 5. 공통 합격식

모든 Gate는 다음 논리곱을 통과한다.

```text
정확성·완전성·권한·진실성 무회귀
AND Gate가 목표한 사용자 이익 증가
AND 추가 시간·model calls·tool calls·provider bytes·tokens·memory·disk가 실제 측정되고 설명됨
AND 같은 품질의 더 경제적인 미시도 경로 없음
AND 첫 유용한 결과가 이유 없이 늦어지지 않음
AND target 밖 effect·orphan process·blind retry·false completion 0
```

모든 비용 지표의 동시 감소를 강제하지 않는다. 안전과 새 능력 때문에 비용이 늘면 동일 목적 A/B에서 그
증가량과 사용자 이익을 함께 제시하고 오너가 trade-off를 본다. 품질·권한·진실성은 비용과 교환하지 않는다.

측정 단위:

- 목적 정확성·완전성·사용성·재사용성
- 첫 유용한 결과와 전체 wall time
- model calls·tool calls·provider bytes·tokens
- 사용자 교정·질문·승인
- peak memory·disk spool·재관측량
- target 밖 effect·orphan process·blind retry·false completion
- 사용자가 같은 일을 다시 맡길 의향

## 6. 현재 양성 대조군과 실제 차이

다음은 재개발하지 않는다.

- `WorkStore`, Work revision, durable admission·cancel·settlement·result publication
- `ResourceLedger·ResourceController·ResourceSituation`의 calls·tokens·bytes·new/repeated Evidence 관측
- 완료된 foreground 출력의 gzip disk chunk·owner·hash·bounded exact recall
- managed process의 delta poll·completion wake·stop·process group
- File Reality search·OCR·plan·apply·rollback·exact source handle
- `bind_sources`와 output registration 전 source revision·전체 행 reconciliation
- Document 구조·render·reopen과 Artifact·Effect·Delivery 분리
- Memory pointer·Episode reopen·Learning trial·Capability lifecycle의 현재 검증 경계

현재 확인된 차이는 다음뿐이며 각 Gate에서 다시 실제 재현해야 한다.

- 실행 중 managed process 출력은 bounded memory spool이며 append-only disk spool이 아니다.
- managed process handle은 resident registry에 있어 Runtime 재시작을 건너지 못한다.
- source-backed 관계 후보는 있으나 범용 entity truth를 만들 권한은 없다.
- managed workspace mutation은 일부 confinement가 있으나 모든 임의 child write가 자격된 것은 아니다.
- Reflection·Principle·Capability package 연구 소스는 제품 entry와 payload에서 휴면 격리돼 있다.

## 7. Gate

### S4-0 — Product Cleanroom — COMPLETE

기준은 `t5-0.3.1-clean-baseline`과 commit `8aba3700`이다. Prompt·제품 의미·UI 디자인·현재 사용자 행동을
바꾸지 않고 죽은 코드와 4차 휴면·qualification payload를 분리했다. 이 Gate를 다시 실행하지 않는다.

완료 문장:

> 3차 제품의 실제 경로와 성능이 고정됐고 4차 전후를 같은 사용자 목적으로 비교할 수 있다.

### S4-A — 단일 정본·최소 실패 기준선 — COMPLETE

제품 변경 없이 사업·개발·연구·개인 파일·능력 부족·장기 실행·위험 경계 일곱 축을 기존 증거에서 고른다.
각 축은 positive control, known observation, 현재 clean-head 재현 여부를 분리한다. 과거 실패가 있었다는
사실만으로 현재 결함이라고 하지 않는다.

S4-B를 여는 조건:

1. 현재 clean head에서 자연어 사용자 목적 실패가 재현된다.
2. 목적·Evidence·Receipt·surface 중 무엇이 실패했는지 분리된다.
3. 모델 입력 문제라면 실제 prompt dump가 있다.
4. 비교군이 같은 실패를 막는 원리가 source 또는 실제 행동으로 확인된다.
5. 제품 반대시험이 실제 행동을 제거하면 실패한다.

완료 문장:

> 4차의 기존 강점·실제 비용·현재 미달이 한 기준선으로 분리됐고 최초 결함 가족 하나만 다음 Gate로 열린다.

### S4-B — Purpose & Done Model Reality — COMPLETE WITH MODEL OBSERVATION

S4-B는 새 목적 기능을 만드는 구현 Gate가 아니다. 모델이 목적·중요도·Evidence 충분성·미확인·완료 의미·
사용자 문장을 판단할 환경이 현재 제품에 이미 정확히 마련됐는지 자격하는 Gate다.

확인할 사실:

- 현재 사용자 원문이 최종 답 model call에도 exact하게 존재한다.
- 가장 최근 교정이 과거 요청·assistant 해석·기억보다 가깝고 우선한다.
- 현재 목적에 필요한 Evidence·실행·효과·전달 Receipt와 미복구 실패·unknown이 정확히 공급된다.
- 큰 ToolReceipt와 과거 assistant 답이 현재 사용자 원문을 묻거나 더 강한 현재 목적처럼 보이지 않는다.
- 오래된 Work·결과·교정이 현재 답에 섞이지 않는다.
- 모델이 작성한 최종 답을 Runtime이 덧붙이거나 교정·삭제하지 않는다.

금지:

- Work brief Tool·목적 schema·성공 기준 schema·Intent enum·목적 전용 Store
- 답 범위 정규식·사후 문장 삭제·업무별 Prompt·모든 요청의 추가 model call
- 모델 최초 해석의 durable truth·Runtime의 의미 선택·모델 품질 실수마다 새 구조 추가

KHB-A01은 제품 변경 0에서 동일 gpt-5.5 반복과 Terra를 비교한다. 원문이 단순히 존재하는지뿐 아니라 final
call에서의 위치, 최신 교정과 거리, 앞선 assistant·ToolReceipt 크기, 현재 Evidence coverage를 측정한다. 환경이
정상인데 모델만 과잉 출력하면 Runtime 결함으로 승격하지 않고 모델 품질 관측·모델 비교·전환 기준 후보로
보존한다.

실제 배치 결함이 재현될 때만 현재 사용자 원문과 최신 교정 pointer를 final call 가까이에 exact 재투영하는
최소 후보를 연다. 새 의미를 작성하거나 원문을 요약하지 않는다. 장기 Work·모델 전환·Context 압축에서 목적
유실이 별도로 반복될 때만 출처 있는 bounded checkpoint를 새 실패 가족로 검토한다.

오너 결정으로 exact source 재투영 후보는 열지 않는다. KHB-A01은 두 모델의 출력 절제 품질 관측으로
보존하며 Work brief·목적 schema·Prompt·Runtime 후처리 없이 S4-B를 닫는다.

완료 문장:

> T5는 모델에게 현재 사용자 원문·교정·Evidence·실행 현실을 작고 정확하게 공급하며, 목적·완료 의미와
> 사용자 답은 모델이 판단한다.

### S4-C — Situation·Hand의 실제 차이 수리 — CLOSED WITH MODEL/PROVIDER OBSERVATION

현재 목적에 관련된 Conversation·Memory·Work·file·connection·Capability pointer를 후보화하고 모델이 선택한
Evidence만 exact reopen한다. 기존 Information Control·Resource Situation·tool search를 우선 사용한다.

새 index·OCR cache·relationship map은 현재 목적 A/B에서 실제 반복 읽기나 누락이 재현될 때만 연다. 관계는
source pointer·revision·candidate·conflict로만 보존하고 사람·회사·상품·계약의 영구 truth를 만들지 않는다.

한 Work 안에서 서로 다른 실행 수단을 조합할 때는 업무 이름으로 provider를 고르지 않는다. 모델이 현재 목적과
사용자 정책을 보고 선택할 수 있도록 각 local engine·model·Capability의 실제 사용 가능 여부, 입력 한계,
품질 자격, 비용, 실측 시간, 로컬/외부 처리, 개인정보 범위, 결과 형식, 실패 대안을 사실로 공급한다. 현재
모델 전환·Resource Situation·Capability Reality와의 실제 차이가 재현되기 전에는 새 router를 만들지 않는다.

첫 기준선은 KHB-S01이다. 과거의 불필요한 connection probe와 106,652-token 표본을 현재 결함으로 자동
승격하지 않는다. 제품 변경 0의 current-head replay에서 같은 사용자 목적·로컬 예약 Evidence·빈 연결 현실을
사용하고, 실제 Tool route와 final Context를 읽은 뒤 최초 결함 가족 하나만 연다.

current gpt-5.5 replay에서 connection list가 로컬 Evidence보다 먼저 호출됐고 최종 답에는 사용되지 않았다.
첫 shell 검색은 macOS가 지원하지 않는 `find -printf`를 사용해 stderr를 냈지만 pipeline의 마지막 명령이 0으로
끝나 Tool success로 기록됐으며, 다음 Turn의 Python 검색이 같은 목적을 다시 수행했다. 최종 결과는 정확했고
과거 표본보다 비용은 줄었으므로 사용자 목적 성공과 Hand 경제성 미달을 분리한다. Terra 비교 전에는 이것을
공통 Runtime 결함으로 확정하지 않는다.

Terra도 첫 Tool로 connection list를 호출했고, depth 2까지만 본 뒤 depth 3의 실제 파일 5개를 없다고 보고해
목적에 실패했다. File Reality 기본 노출·Connection deferred 후보는 gpt-5.5가 계속 shallow exec와 connection을
선택해 목적 실패로 폐기했다. top-level workspace metadata 후보는 재검색을 유도했지만 두 번째 검색의
`find -printf 2>/dev/null | head` 내부 실패가 exit 0으로 숨겨져 다시 목적에 실패해 폐기했다. 두 후보 모두
기본 제품에는 남지 않는다.

S4-D0은 마지막 foreground POSIX pipeline의 단계 exit를 사실로 보존하고 비-141 앞 단계 실패를 실패
Receipt로 바꿨다. gpt-5.5 실모델은 정확히 복구했지만 125,769 tokens·74.9초로 기준선보다 느리고 비쌌다.

D0과 content-free top-level workspace fact를 결합한 자격시험에서는 gpt-5.5와 Terra가 모두 정확한 일요일
15:00 80%를 찾았다. gpt-5.5는 connection 호출이 0이었고 고객 식별자를 가렸으며, Terra는 connection을 한 번
호출하고 합성 고객 코드를 그대로 노출했다. 이 fact는 모델 call당 지시문 163 bytes·직렬화 request 180 bytes를
추가한다. 하지만 합성 시험 전송 승인은 실제 workspace metadata의 제품 기본 투영 승인이 아니므로 구현은
제품 source에서 제거했고 증거만 남겼다.

따라서 pipeline hidden failure는 닫혔지만, 성공한 shallow 검색을 전체 부재로 넓히는 문제와 Terra의 불필요한
connection 비용은 S4-C에 남는다. 같은 방향의 세 번째 Prompt·Tool 후보를 얹지 않고 구조와 모델 경계를 다시
판정한다.

current-head의 gpt-5.5 반대확인에서 KHB-M05 미수금은 정확히 성공했지만 KHB-A03 계약 비교는 `attachment list`
하나만 실행하고 workspace의 계약서 두 개를 보지 않은 채 업로드를 요구했다. 두 번째 호출에도 `exec`는 실제로
열려 있었다. 짧은 원리형 qualification instruction도 같은 실패를 반복해 product source에서 제거했다. 이
cross-domain variance는 미해결로 보존하며 당시 오너 지시에 따라 S4-C 작업을 멈췄다.

오너 재개로 다음 bounded 후보 하나만 qualification에서 연다.

```yaml
workspacePresence:
  scope: current_managed_workspace
  state: nonempty | empty | unavailable | unknown
  descendantsObserved: false
  relevanceKnown: false
  computerScopeObserved: false
  contentIncluded: false
```

관측은 현재 managed workspace의 top level만 열고 첫 qualifying entry에서 즉시 멈춘다. recursion·이름·경로·
크기·시간·개수 보존은 0이고 symlink 내부에 들어가지 않는다. 읽기 실패는 `empty`가 아니라 `unavailable`,
관측하지 않은 상태는 `unknown`이다. 이 사실은 현재 Run의 Situation에만 존재하고 Store·Memory·Conversation·
사용자 결과·작업 기록에는 남지 않는다. 관련성·어떤 손을 쓸지·부재 의미는 모델이 선택한다.

boolean도 provider에 전달되는 새 정보이므로 Transmission Receipt는 `workspace_presence`를 별도 범주로 기록하고
원문·이름·경로·내용·개수·식별자가 포함되지 않았음을 반대시험으로 고정한다. Windows는 같은 managed workspace
top-level presence 의미를 사용하되 physical adapter 자격은 S4-L에 남긴다.

qualification-only A/B는 A03·S01·M05·HP-01과 empty workspace·관련 없는 인사·질문·계산을 사용한다. A03의
계약서 두 개 비교, S01 거짓 부재 0, M05·HP-01 무회귀, empty를 computer absence로 확대 0, 짧은 요청의 추가
model/tool call 0, 불필요한 connection·attachment 감소, 전송 원문 0과 bytes·wall·tokens가 모두 확인돼야 한다.

boolean만으로 A03·S01이 회복되지 않거나 무조건 workspace 검색·empty 확대·짧은 요청 비용 증가·모델별 Prompt가
생기면 후보를 폐기한다. 파일 수·이름·확장자를 조금씩 추가하지 않고 모델·provider 선택 품질 관측으로 분리한다.

실제 A03 첫 자격에서 boolean의 privacy·scope·Transmission Receipt 계약은 통과했지만 사용자 목적은 실패했다.
presence는 즉시 업로드 요구 대신 두 번의 workspace 검색을 유도했다. 첫 검색은 depth 2, 두 번째는 재귀였으나
둘 다 macOS가 지원하지 않는 `find -printf`를 사용했고 stage exit `[1,0,0]`·overall `0`이었다. 모델은 이 사실을
받고도 관련 파일이 없다고 답했다. 실제 `.md` 계약서 두 개는 depth 3에 존재했다.

기준선 8.8초·2 model calls·1 tool call·18,356 tokens·98,325 request bytes에서 후보는 20.8초·5 model calls·
4 tool calls·52,656 tokens·270,298 request bytes로 악화됐다. `workspace_presence` 범주는 call당 161 payload bytes,
첫 wire +197 bytes였고 이름·경로·내용·개수는 전송하지 않았다. 프라이버시 성공이 목적 실패와 비용 회귀를
상쇄하지 않으므로 S01·M05·HP-01·negative matrix로 확대하지 않고 후보 코드와 전송 범주를 모두 제거했다.

이 결과는 workspace metadata 부족을 더 키울 근거가 아니라 같은 Runtime 현실에서의 model·provider 방법 선택
품질 관측이다. 다음 metadata 후보나 모델별 Prompt를 열지 않는다.

S4-C는 제품 성공으로 완료한 것이 아니다. `USER_COMPLETION_NOT_UNIVERSALLY_PROVEN`이며 S4-C 제품 구현 채택은
0이다. A03·S01의 거짓 부재, portable command 선택, shallow observation 해석, 불필요한 Connection과 모델별
정확성·비용 차이는 S4-G·S4-I의 현재 손·대안 현실과 S4-HQ의 실제 인간 목적에서 다시 확인한다. HQ에서 핵심
목적이 실패하면 4차 전체 완료를 주장하지 않는다.

완료 문장:

> T5는 현재 가진 자료·기억·연결·능력과 부족한 사실을 빠르게 파악하고 가장 적합한 손으로 필요한 원문만 본다.

### S4-D — Terminal 실행 중 output·process 미달 — MANAGED NON-PTY COMPLETE

S4-D0은 disk spool 전에 KHB-S01에서 발견된 pipeline 실행 사실을 닫았다. zsh `pipestatus`와 bash
`PIPESTATUS`로 마지막 unconditional foreground pipeline의 전체 exit와 단계 exit를 분리한다. Runtime은 이
숫자를 사실로만 공급하고 `grep`의 no-match 1, `diff`의 differences 1, `find`의 1처럼 명령별 의미를 선택하지
않는다. shell overall exit·state·stdout·stderr도 바꾸지 않는다. 조건 분기, pipeline 뒤 다른 명령, managed
process, non-POSIX runtime은 관측한 척하지 않고 기존 동작을 보존한다. Windows 제품 동작은 바뀌지 않았으며
물리 자격은 S4-L에 남는다. 전역 pipefail과 exit-code 예외 목록은 적용하지 않았다.

기존 Terminal Core 위에 필요한 차이만 연결한다.

S4-D1은 구현이 아니라 현재 현실 측정이다.

- 1MiB를 넘는 managed stdout·stderr의 실행 중 보존 범위·exact range recall·peak memory·유실을 측정한다.
- Runtime 종료·재시작 뒤 OS process 생존, handle 소실, orphan, Work 상태, 자동 재실행 여부를 분리한다.
- completion wake exact once, 반복 poll·같은 cursor·증가 output·stop/completion race를 재현한다.
- 짧은 foreground, 기존 PTY, 정상 background, 종료 후 exact output recall, process tree stop을 양성 대조한다.

구현은 `현재 사용자 목적 미달 AND 기존 output store·process registry로 해결 불가 AND 실제 memory·output·
restart 증거 AND 비교군 원리 AND 가장 작은 반대시험`이 함께 설 때만 연다. 코드 구조가 memory spool이라는
사실만으로 disk spool을 구현하지 않는다.

S4-D1 actual 결과:

- managed stdout 1,300,012자·stderr 1,200,012자에서 각 1,048,576자 tail만 남고 총 402,872자가 exact recall
  전에 유실됐다. terminal 상태는 completed였지만 `exactOutputRecallUnavailable=true`, output handle은 없었다.
- 동일 실행 두 번의 process RSS는 약 55MB에서 656MB·637MB까지 올라갔다. 이는 process RSS 관측이며
  `OutputSpool` 단일 원인으로 확정하지 않는다.
- 같은 cursor는 같은 delta를 재관측하고, cursor를 전진한 기존 양성 대조는 중복 없이 통과했다.
- ordinary completion wake는 exact once였지만 이미 completed인 process를 `stop`으로 관측하면 terminal 결과를
  반환한 뒤 같은 completion wake가 다시 claim됐다.
- graceful Runtime shutdown은 process tree를 멈추고 late effect 0, Work를 interrupted-resumable로 남겼다.
  abrupt parent exit에서는 child가 살아 marker를 썼고 successor registry는 process 0·old handle 404였다.
- unfinished Run은 restart read에서 interrupted였고 automatic tool 재실행은 없었다. physical abrupt crash 뒤
  exact WorkStore 상태와 Windows 물리 동작은 아직 측정하지 않았다.
- 짧은 foreground·PTY·delta poll·일반 wake exact once·저장된 output range·process tree stop·graceful drain·
  incomplete-call non-retry 양성 대조 24개는 실패 0이었다.

현재 재사용할 비교 원리는 Codex의 serialized process interaction·omission facts, OpenClaw의 scoped registry·
unread delta, OpenHands의 paged shell output이다. 이것만으로 disk spool이나 crash rebind 구현을 자동 승인하지 않는다.

구현 순서는 오너 결정으로 다음처럼 고정한다.

1. `S4-D2 Stop/Completion Settlement`
2. `S4-D3 Live Output Spine`
3. `S4-D4 Crash Process Ownership` — read-only identity design first

S4-D2 완료 문장:

> 같은 process terminal 결과는 stop·poll·completion wake 중 어떤 경로로 먼저 관측돼도 사용자 Work에 정확히
> 한 번만 반영된다.

S4-D2는 terminal 결과를 반환하는 경로와 wake 소비를 기존 `terminalObserved`·`wakeClaimed` settlement에
결속한다. stop이 이미 terminal을 관측하면 `terminalObserved`를 원자적으로 남기고, wake가 먼저 claim된
순서에서는 이후 stop이 background wake를 다시 만들지 않는다. 새 Store와 고정 sleep은 없다.

S4-D2 actual은 stop-first RED가 같은 completion wake를 재claim하는 것을 재현한 뒤 terminal stop early-return에
`terminalObserved`를 기록하는 최소 변경으로 닫았다. wake-first 반대 순서와 기존 managed process·Terminal·
Work surface 관련 검사 34개는 실패 0이다.

S4-D3 완료 문장:

> T5는 대형 process 출력을 실행 중부터 유실 없이 보존하고 모델에는 필요한 범위만 공급하며, 완료 후에도
> 같은 handle로 정확히 회수한다.

S4-D3는 기존 `TerminalOutputStore`를 재사용한다. process 시작부터 stdout·stderr append, 작은 memory
head·tail·cursor, 실행 중 exact range, 완료 후 같은 handle finalize, restart 뒤 저장 범위 reopen을 검토한다.
출력 유실 수리와 RSS 원인·개선은 별도 사실로 판정한다.

S4-D3 actual은 `TerminalOutputStore v3` live raw chunk와 atomic manifest를 사용한다. process cursor와 disk
persisted cursor를 분리하고, running·restarted Store·completed·stopped·PTY에서 같은 handle을 유지한다. 1.1M
stdout·stderr 전체 hash, Unicode 경계, foreign owner, disk failure degraded, command 재실행 0을 통과했다. 짧은
managed command AB·BA는 no-store 4.17ms/회, live-store 4.06ms/회였다. 종료 후 RSS는 약 634MB로 기존
637·656MB 범위와 비슷해 개선을 주장하지 않으며 D3 정확성 완료와 별도 관측으로 남긴다.

S4-D4 완료 문장:

> Runtime 사고 뒤 T5가 모르는 process가 계속 효과를 만들지 않으며, 살아 있는 process를 정확히 증명할 수
> 있을 때만 관측·중단한다.

S4-D4는 구현 전에 abrupt crash 뒤 exact WorkStore·owner event·partial output manifest, process group, PID start
identity, generation, Windows Job Object 사고를 read-only로 측정한다. identity를 증명하지 못하면 재부착하지
않고 effect unknown·Work interrupted·blind retry 0을 유지한다.

S4-D4 actual은 Runtime SIGKILL 뒤 managed child가 PPID 1로 살아 late effect를 만든 것을 관측했다. durable Run
receipt에는 opaque processId와 output handle이 있었고 live manifest는 `BEFORE-RUNTIME-CRASH` 20자를 보존했다.
그러나 OS pid·PGID·executable·start identity·generation은 durable하지 않았다. successor는 Run을 interrupted로
읽고 blind reexecution은 하지 않았지만 registry process 0·old handle 404였으며 Work와 execution claim은 active로
남았다. physical Windows는 실행하지 않았고 Job Object kill-on-close 계약만 양성 대조로 남는다.

안전한 구현 방향은 PID 재부착이 아니다. launch 전 durable owner identity와 macOS parent-death process-group
wrapper, Windows Job Object kill-on-close를 비교한다. exact identity가 증명되면 관측·stop·bounded reconcile,
증명되지 않으면 재부착 0·effect unknown·Work interrupted·blind retry 0이다. 이 설계는 아직 채택하지 않았다.

S4-D4A는 macOS managed non-PTY process에 한정한다. Runtime이 살아 있거나 UI만 닫힌 동안 control FD는 유지돼
command가 계속 실행된다. Runtime crash·SIGKILL로 FD가 EOF가 되면 process-group host가 자신이 시작한 exact
group을 SIGTERM 후 bounded SIGKILL로 끝낸다. 정상 command completion·stdin·stdout·stderr·exit code와 기존
process group stop은 보존한다. helper 부재는 보호 없는 실행으로 낮추지 않고 fail closed한다.

S4-D4A 완료 문장:

> macOS Runtime이 비정상 종료돼도 T5가 시작한 managed non-PTY process group은 late effect를 만들기 전에
> 종료되며, UI detach와 정상 Runtime에서는 기존 작업이 계속된다.

S4-D4A actual은 fd3 parent-liveness channel과 macOS process-group host로 Runtime SIGKILL late effect를 0으로
닫았다. 정상 stdout·stderr·exit·effect와 기존 stop·stdin을 보존하고 helper 부재는 실행 전 fail closed한다.
managed background startup 비용은 no-host 4.74ms/회에서 contained 27.58ms/회로 +22.84ms였다. foreground exec와
PTY는 이 host를 사용하지 않는다.

S4-D4B 완료 문장:

> successor Runtime은 사고로 끝난 managed Work를 자동 재실행하지 않고 interrupted-resumable·effect unknown으로
> 정산하며, execution claim을 해제하고 보존된 partial output을 같은 handle로 다시 연다.

S4-D4B actual은 interrupted Run의 runtime-generated Terminal receipt에서 아직 terminal이 관측되지 않은 process를
재구성한다. 모든 active process가 `macos_parent_death_process_group` 또는 `windows_job_object`의 qualified
parent-death boundary를 가진 non-PTY일 때만 기존 WorkStore cancellation admission·settlement를 사용한다. 이때
effect는 unknown으로 보존하고 claim을 해제하며 Work를 R+1의 active resumable 상태로 돌린다. live output manifest는
같은 handle의 `interrupted` read-only 상태로 hash 봉인한다.

사업 보고·개발 분석·개인 파일 세 목적의 사고 fixture에서 model call·Tool 재실행 0, cancellation·surface exact
once, 두 번째 successor의 WorkStore event 증가 0, partial stdout exact reopen을 통과했다. D4A가 보장하지 않은
PTY는 children terminal로 꾸미지 않고 active claim과 live output을 그대로 남겼다. 새 Store·목적 schema·Prompt는
없다. Windows는 기존 Job Object 의미만 배선했고 물리 자격은 S4-L에 남는다.

S4-D5는 제품 변경 없는 RSS 원인 분리다. 같은 출력량에서 base child, standalone TerminalOutputStore,
ManagedProcessRegistry, 실제 Terminal Hand를 순서대로 측정하고 Buffer·string 복제, snapshot·delta 생성, 압축,
GC 전후 retained RSS를 분리한다. 한 표본의 RSS만으로 memory leak이나 D3 store 원인을 확정하지 않는다.

S4-D5 완료 문장:

> T5는 대출력 Terminal Hand의 높은 RSS가 생기는 실제 계층과 보존량을 재현 가능한 측정으로 분리하고, 사용자
> 정확성을 해치지 않는 가장 작은 수리 후보 또는 제품 변경 0 판정을 고정한다.

S4-D5 actual은 1,100,020자 stdout·stderr를 3회씩 독립 process에서 측정했다. Store-only RSS 중앙 증가는
9.0MB, raw pipe 2.5MB, bounded string 5.0MB, direct registry poll 10.8MB였다. command explainer 결과를 해제한 뒤
direct registry를 실행하면 20.9MB였지만 같은 결과 객체를 실행 동안 보존하면 595.6MB, 실제 process start는
595.7MB, 전체 live Store Terminal Hand는 598.0MB였다. bounded hash read는 598.3MB, 전체 문자열 합치기는
608.5MB로 주원인이 아니었다. heap retained 증가는 약 1MB라 memory leak으로 단정하지 않고 parse-derived
explanation lifetime과 process output이 결합한 RSS high-water로 한정한다.

S4-D5A 완료 문장:

> T5는 command 해석에서 얻은 안전·실행 사실은 보존하되 사용이 끝난 parse-derived 객체를 process 실행 동안
> 붙들지 않아 대출력 정확성을 유지하면서 Runtime RSS를 불필요하게 키우지 않는다.

S4-D5A actual은 in-process 최소 후보를 폐기했다. parser `reset`·`delete`, reference null, structured clone,
JSON·Buffer 재물질화, digest·temporary file pointer 모두 대출력 128MB RED를 통과하지 못했다. 명령 해석을
우회하면 RSS는 내려갔지만 권한·pipeline·Capability·학습 사실을 제거하므로 제품 후보가 아니다. 같은 방향의
세 번째 patch를 붙이지 않고 parser 실행 위치를 재설계한다.

S4-D5B one-shot 격리 positive control은 command를 argv가 아닌 stdin으로 보내고 bounded JSON만 되돌렸다. 주
Runtime peak RSS delta는 3회 중 약 11.4MB였지만 median wall은 418.6ms로 current in-process 251.1ms보다
167.5ms 느렸다. 따라서 one-shot helper 제품 채택은 0이다.

S4-D5B 완료 문장:

> T5는 command 해석 정확성과 안전 사실을 보존하면서 parser memory를 실행 Runtime과 격리하고, 첫 호출 뒤
> 반복 명령에는 사용자가 체감할 불필요한 지연을 더하지 않으며 helper 사고를 보호 없는 실행으로 낮추지 않는다.

S4-D5B actual은 lazy persistent JSONL helper에서 cold 39.6ms, warm 20회 median 0.19ms, helper RSS median
74.3MB를 관측했다. 동시 8건은 request identity가 모두 정확했고 helper SIGKILL 중 pending은
`explainer_process_exited`로 닫혔으며 자동 command 실행은 0, successor explain은 정확했다. 실제 2.2M자 live
output에서는 주 Runtime peak delta median 18.6MB, helper 약 63.6MB, wall median 341.8ms였다. current in-process
bounded-hash 표본 302.5ms보다 +39.4ms지만 약 598MB의 주 Runtime RSS를 제거하고 stdout·stderr exact hash와
finalized handle을 보존했다. qualification product adoption은 아직 0이다.

S4-D5C 완료 문장:

> 제품 Runtime은 command parser를 실행 손과 분리해 exact explanation·권한·pipeline·Capability 사실을 유지하고,
> helper가 죽거나 응답이 깨지면 보호 없는 Terminal 실행 전에 멈추며 정상 종료·재시작에서 고아 helper를 남기지 않는다.

S4-D5C actual은 lazy `IsolatedCommandExplainer`를 제품 Console의 기존 `makeTerminalHand` explanation 입구에
연결했다. command는 argv가 아니라 child stdin JSONL로 전달되고 response·identity·timeout을 bounded 검증한다.
helper infrastructure failure는 process start 전에 fail closed하며 기존 custom parser 실패 호환은 유지한다.
Runtime shutdown과 server close는 helper를 종료한다.

실제 2.2M자 제품 client A/B에서 주 Runtime peak delta median 18.5MB, helper 약 63.6MB, 전체 약 82.1MB였고
기존 약 598MB 대비 약 86% 감소했다. wall median은 339.2ms였고 stdout·stderr exact hash, finalized handle,
pipeline·foreground·managed·cancel·Runtime stop 양성 대조를 보존했다. 전체 CI는 unit failure 0, integration
192/192, mutation 2/2였다. PTY parent-death containment와 물리 Windows helper lifecycle은 이 완료에 포함하지
않고 각각 기존 non-claim과 S4-L에 남긴다.

- 실행 중 stdout·stderr append-only disk spool
- 작은 memory head·tail·cursor와 bounded range read
- Session·Run·process generation·interpreter·cwd owner
- restart reconcile과 completion wake exact once
- disk full·partial write·PID reuse·parent death의 정직한 상태
- retention·backup·delete는 실제 제품 보존 정책 안에서만 확정

완료된 output store·exec·terminal session·process stop을 대체하지 않는다. Runtime crash 뒤 live process 재결속은
OS에서 실제 identity를 확인할 수 있는 범위까지만 주장한다.

완료 문장:

> T5는 대규모 출력과 장시간 작업을 한 번 실행하고 Context 폭증·고아 실행·중복 wake 없이 끝까지 관찰한다.

### S4-E — Managed Mutation Confinement

첫 범위는 T5 managed workspace, 사용자가 지목한 exact target, T5가 시작한 Capsule process, 선언 scratch와
output이다. canonical path와 symlink·hardlink·junction, 실행 중 target 교체, child late write, protected secret,
부분 변경을 반대시험으로 둔다.

일반 shell 전체의 모든 효과를 완전 통제한다고 주장하지 않는다. 관측하지 못한 effect는 `unmeasured` 또는
`unknown`이며 성공으로 승격하지 않는다.

완료 문장:

> T5가 관리하는 생성·변경 작업은 맡긴 대상과 scratch 밖으로 쓰지 않고 실행 전후 현실과 남은 unknown을 보존한다.

S4-E read-only actual은 제품 변경 0에서 세 결함을 재현했다. File Reality plan 뒤 destination directory를 같은
filesystem의 symlink로 교체하면 apply가 성공하고 link target 밖에 파일을 이동했다. workspace source가 외부
파일의 hardlink여도 plan/apply가 성공했다. Terminal local_change는 선언 target과 sibling을 함께 썼지만
EffectObservation은 선언 target 하나만 관측했다. 기존 source dev·ino·size·mtime 변화, destination collision,
cross-volume unsupported, apply 실패 rollback은 양성 대조다.

S4-E1은 OpenClaw의 mount-root·relative-parent·basename pinning, `openat`/directory handle·nofollow, hardlink 별도
거부, sibling temp+file/directory sync+atomic replace, EXDEV source identity 재검사와 Hermes의 ordered path lock,
stale overwrite 금지, post-write hash, exact-target checkpoint 원리를 교재로 사용한다. T5는 Docker·전체 shadow
Git·warning-only overwrite·업무별 규칙을 가져오지 않는다.

S4-E1 actual은 여섯 계약, POSIX directory FD/openat/nofollow/renameat/fsync와 Windows directory handle/reparse
point/file identity/ReplaceFile/FlushFileBuffers 의미, 열 개 반대시험과 non-goal을 기계 fixture로 고정했다. 첫
구현은 destination parent identity 재검사 하나이며 남은 최종 TOCTOU를 닫았다고 주장하지 않는다.

S4-E2 actual은 plan에 canonical destination parent dev·ino를 결속하고 apply 직전에 directory·non-symlink·same
identity를 재검사한다. 원래 symlink-parent escape는 외부 이동 0으로 닫혔고 source stale·collision·cross-volume·
rollback 양성 대조를 보존했다. 검사와 rename 사이 openat 수준 TOCTOU는 아직 non-claim이다.

S4-E3 actual은 source handle identity에 `nlink`를 보존하고 plan admission에서 regular file `nlink !== 1`을
거부한다. workspace hardlink 반례는 source·outside·destination 변경 0으로 닫혔다. Windows NTFS hardlink의
물리 자격은 S4-L에 남는다.

S4-E4 contract actual은 managed workspace·declared scratch/output만 관측하고 content·secret·unchanged path를
투영하지 않는다. maximum 4,096 entries, changed relative paths 64개, symlink follow 0이며 entry limit·root 교체·
walk 경합·unreadable·late child는 unknown이다. 첫 제품 범위는 completed foreground local_change뿐이다.

S4-E4A actual은 Console foreground local_change에 bounded observer를 연결했다. declared target과 unexpected
workspace write를 별도 상대경로로 관측하고 content·unchanged path는 투영하지 않는다. symlink follow 0,
4,096-entry 초과와 coverage 불완전은 unknown이며 managed background·late child는 unmeasured로 남긴다.

S4-E5 actual은 same-directory exclusive temp, written digest, file sync, preimage revalidation, atomic replace,
directory sync, readback digest와 temp cleanup을 내부 범용 primitive로 구현했다. replace 전 실패는 target 변경
0이고 replace 뒤 durability/readback 실패는 `published_durability_unknown`이다. 공개 patch tool과 multi-file
transaction은 열지 않았다.

S4-E6 actual은 target 하나의 preimage bytes·identity·digest·mode만 managed backup에 보존한다. restore는 current
postimage와 backup hash가 exact할 때 기존 file을 atomic publication으로 복원하고 원래 없던 target은 directory
sync와 absence readback 뒤 제거한다. target·backup 변조는 overwrite 0이며 retention 정책은 열지 않았다.

S4-E7 actual은 macOS foreground local_change를 managed workspace 안 declared target에만 write 가능한 Seatbelt
profile로 실행한다. undeclared sibling write는 물리 거부되고 target write는 보존되며 E4A observer가 outside
write 0을 확인한다. 다른 platform은 qualified로 꾸미지 않고 Windows 물리 자격은 S4-L에 남긴다.

### S4-F — Structured Authoring

내부 `workspace_patch` 후보는 `inspect → preview → write_new/apply_patch → verify → rollback`을 제공한다.
exact preimage digest, stale patch 거부, root escape 차단, atomic rename, bounded diff, post-write hash, rollback
pointer, 다중 파일 all-or-nothing을 요구한다. 사용자 흐름 없는 새 editor나 범용 IDE를 만들지 않는다.

완료 문장:

> T5는 shell quoting과 문자열 조립에 의존하지 않고 관리 범위의 프로그램·설정·문서를 정확히 변경하고 복원한다.

S4-F contract는 Inspect→Preview→Prepare→Lock/Revalidate→Publish→Verify→Settle 일곱 phase와
`published_verified`·`not_published`·`rolled_back_verified`·`partial_effect_unknown`·
`published_durability_unknown`을 고정한다. filesystem-wide simultaneous rename은 주장하지 않고 모든 candidate와
rollback pointer를 먼저 준비한 뒤 target별 atomic publication과 실패 시 exact restore로 Work transaction을 만든다.

S4-F read-only actual은 세 파일 순차 authoring의 세 번째 실패 뒤 앞선 두 파일이 남는 partial commit, read 뒤
외부 변경된 preimage를 shell write가 덮는 stale overwrite, literal `$HOME`이 환경값으로 바뀌는 quoting 변형을
제품 변경 0에서 재현했다. 기존 문서·Excel 생성 성공은 재개발하지 않는다.

S4-F1 actual은 create·modify·delete·move의 모든 source/destination, exact preimage와 candidate digest·bytes를
첫 write 전에 closed plan으로 만들고 content 없는 preview를 반환한다. root escape·duplicate target·hardlink
source를 admission에서 거부하며 preview 중 target write는 0이다.

S4-F1 correction actual은 최초 완료 뒤 nested symlink parent가 workspace 밖 existing file을 inspect하는 P1을
재현했다. lexical parent를 `realpath`로 canonicalize해 workspace containment를 다시 확인하고 canonical parent
dev·ino를 plan에 결속했다. 외부 target은 preimage read 전에 거부되며 F2 scratch prepare를 함께 재자격했다.

S4-F2 actual은 create·modify candidate를 managed scratch에 exact bytes로 atomic publication하고 digest를
재개방한다. JSON·YAML은 문법 검증하며 TOML validator 부재는 실패로 닫는다. 한 candidate라도 실패하면 scratch
전체를 정리하고 target write 0이다. opaque 형식은 hash만 검증하며 구조 검증 완료로 꾸미지 않는다.

S4-F3 actual은 모든 canonical source/destination을 정렬해 `DurableProcessOwnership` path-digest lock을 획득한다.
preimage·parent dev/ino·destination collision·scratch candidate hash를 모두 재검사하고 하나라도 실패하면 확보한
lock을 역순 해제해 publication admission 0이다. 같은 target의 다른 Work는 contention으로 닫힌다.

S4-F4 actual은 모든 target의 E6 rollback pointer를 먼저 durable하게 만든 뒤 create·modify·delete·move를 E5
target별 publication으로 적용한다. 후순위 failure는 적용된 target을 역순 exact restore하고 모두 재검증되면
`rolled_back_verified`, 하나라도 복원이 불명확하면 `partial_effect_unknown`이다. failure 뒤 lock은 모두 해제된다.

S4-F5 actual은 plan/scratch 영수증이 아니라 actual target 전체를 reopen해 create·modify hash·형식, delete
absence, move source/destination과 독립 relation verifier를 확인한다. relation failure는 전체 rollback하며 제3자
target 변조로 exact restore가 불가능하면 `partial_effect_unknown`이다.

S4-F6 actual은 verified transaction lock을 exact release하고 scratch candidate를 물리 정리한다. rollback pointer는
경로를 노출하지 않는 내부 Undo 범위로 보존하고 `published_verified` receipt에는 verified/Undo target 수만 남긴다.
lock release·scratch cleanup 미확인은 `partial_effect_unknown`이다.

S4-F actual은 on-demand `workspace_patch`의 preview/apply/rollback 세 action을 Console tool search에 연결했다.
같은 Run의 fresh preview handle만 한 번 apply할 수 있고 candidate 원문·internal path·backup pointer는
preview/result에 없다. 사업·개발·개인 파일 세 목적과 실제 Console 종단, invalid candidate target write 0이
통과했다. 최종 검사는 unit 1,720/1,720, integration 193/193, mutation 2/2다. 성공 settlement는 Session-scoped
0600 manifest로 보존되고
opaque Undo handle은 다음 사용자 턴의 새 tool instance에서 current postimage 전체를 사전 확인한 뒤 역순 exact
restore한다. handle은 atomic claim으로 한 번만 사용되며 stale target은 Undo write 0이다.

### S4-G — Ephemeral Program Capsule

기존 손으로 같은 품질을 경제적으로 달성하기 어려울 때만 현재 Work의 작은 프로그램을 만든다.

```text
source·digest
→ interpreter identity·version·cwd
→ input RecordRef·revision·hash
→ 작은 fixture
→ 실제 입력 실행
→ output Artifact·effect
→ 프로그램과 독립된 T5 observer 검증
→ 보존 또는 cleanup
```

자동 package 설치, credential 원문, Core 수정, 자동 영구 Skill 승격, 외부 effect 재실행은 없다. 프로그램의
exit 0·자체 JSON·자체 fixture는 사용자 목적 성공 증거가 아니다.

Capsule은 실행 전에 publishable output, internal intermediate, diagnostic, temporary, cleanup 범위를 구분하고,
실행 뒤 별도 observer가 실제 파일·container 목록, MIME·형식·크기·hash를 expected output과 대조한다. 요청한
파일 외 내부 JSON·log·debug·manifest·개인정보 중복 사본은 Artifact와 ZIP에 들어가지 않는다. 프로그램이
작성한 output manifest는 관측 후보일 뿐 독립 검증이 아니다.

첫 제품 후보는 실제 로컬 입력에서 결과 파일을 만드는 `Artifact-Building Capsule`이다. 프로그램 안에서 여러
T5 Tool을 호출하는 Programmatic Tool Orchestration은 model 왕복이 실제 병목으로 재현되기 전에는 열지 않는다.
nested Tool RPC·Agent Team·DAG planner·자동 Skill 승격·package 자동 설치는 G의 첫 제품 범위가 아니다.

개발 순서는 다음처럼 닫는다.

1. `G0 Read-only Baseline`: 제품 변경 0에서 기존 Terminal·workspace_patch로 자연어 사용자 목적을 실행하고
   성공·비용·source/actual/output/cleanup 현실을 측정한다.
2. `G1 Capsule Contract`: source·interpreter·cwd·input revision/hash·fixture·expected output·scratch·resource
   limit의 최소 사실만 고정한다.
3. `G2 Source Preparation`: 프로그램·fixture·oracle·output declaration을 사용자 target 밖 managed scratch에
   준비하고 준비 실패 시 actual 실행 0을 보장한다.
4. `G3 Fixture Qualification`: exact source와 interpreter를 작은 결정적 fixture에서 시험하고 프로그램이 함께
   작성한 자기 oracle만으로 통과시키지 않는다.
5. `G4 Actual Execution`: fixture를 통과한 source만 frozen input에 실행하며 input/source 변경·사고 뒤 blind
   retry를 막는다.
6. `G5 Independent Observer`: 프로그램 manifest가 아니라 T5 observer가 실제 output·형식·hash·입력 관계·예상
   밖 파일·residual process를 다시 관측한다.
7. `G6 Publication and Cleanup`: 검증된 publishable 결과만 F transaction으로 발행하고 internal·diagnostic·
   temporary·개인정보 중복 사본을 정리한다.
8. `G7 Product Activation and A/B`: 자연어 요청에서 유리할 때만 자발 선택하고 단순 작업의 불필요한 Capsule과
   동일 목적 품질·경제성 회귀를 막는다.

G0 actual은 제품 변경 0의 gpt-5.5가 자연어 요청만으로 CSV 12개·527행을 프로그램 경로로 처리해 거래처별
4행 집계와 오류 47행을 정확히 만들고 원본 변경·잔여 파일·managed process를 0으로 끝냈다. output은
CRLF·UTF-8 BOM이었고 최초 raw header verifier가 BOM을 field로 센 qualification 결함은 독립 oracle hash exact
match로 교정했다. 실제 경로는 output을 다시 열었지만 13 model calls·12 tool calls·323,691 provider tokens·
1,424,937 request bytes·107.8초를 사용했고 source/interpreter/fixture Capsule 자격은 없었다. 정확성 성공만으로
이 비용과 자격 공백을 숨기지 않고 G1을 연다.

G1 actual은 source·interpreter·input·fixture·output·scratch·resource limit의 최소 사실, 11개 분리 상태,
자기 oracle 금지와 D·E·F·RecordRef 재사용 경계를 contract fixture와 반대시험으로 고정했다. 새 Runtime·Tool·
Store·interpreter 선택과 제품 source 변경은 0이다.

G2 actual은 program source·fixture input·independent oracle·output declaration·runtime manifest를 사용자 target
밖 managed scratch에 함께 준비하고 exact digest로 다시 연다. 실제 input은 RecordRef·revision·hash만 결속하며
원문은 복제하지 않는다. one-candidate failure·symlink root·generation escape는 generation 전체 cleanup과
fixture·actual execution 0으로 닫힌다. 제품 wiring·network·package·credential·user target write는 0이다.

현재는 `G3` fixture qualification만 열려 있다. interpreter 후보의 identity·version·digest와 scratch-only write,
network·secret·child process 차단, timeout·memory·output boundary를 실제 반례로 먼저 자격한다. exact source와
interpreter가 작은 fixture·independent oracle을 통과하기 전 actual input은 실행하지 않는다.

G3 current actual에서 macOS Seatbelt에 exact bundled Node만 허용한 후보는 guest가 같은 Node child를 실행해
폐기했다. Node permission을 결합하면 filesystem·network·secret env·child·worker·timeout·output은 닫혔지만
32MB heap 설정에서도 128MB external Buffer와 약 180MB RSS가 가능했다. 96MiB sampled RSS monitor는 약 73MiB
overshoot 뒤에야 process를 끝내 hard cap으로 채택하지 않았다. 같은 Node 방향의 patch를 더 붙이지 않는다.

대안 QuickJS release-sync WASM은 guest host API를 0으로 두고 runtime memory·stack·deadline을 직접 제한한다.
exact variant `0.32.0`과 WASM digest를 관측하고 strict UTF-8 fixture의 pure `transform(input)` 결과를 JSON bytes로
받아 independent oracle과 host에서 exact 비교했다. 정상 fixture, host API 부재, memory·timeout·output·oracle
mismatch, stale source·forged interpreter가 5/5를 통과했다. Console wiring·actual input execution은 0이다.
G3 final은 QuickJS evaluation을 D-managed one-shot helper로 분리했다. bounded stdin/result와 exact request identity를
사용하며 helper crash·corrupt response·timeout·cancel은 `fixture_failed`로 닫히고 actual execution은 0이다. macOS
receipt는 `macos_parent_death_process_group`을 보존하며 helper·guest 모두 사용자 target·network·credential에
접근하지 않는다. physical Windows helper lifecycle은 S4-L에 남긴다.

G4 actual은 exact RecordRef 여러 개를 실행 직전과 helper 종료 뒤 다시 열어 revision·digest가 같을 때만
fixture-qualified source·interpreter·limits로 한 번 실행한다. guest에는 selected UTF-8 input envelope만 공급하고
결과는 managed scratch의 `actual_output_unverified` JSON candidate로만 atomic publication한다. stale-before는 helper
0, stale-after는 candidate publication 0, cancel·helper failure는 no-effect, 같은 qualification 재실행은 0이다.

G5 actual은 guest candidate를 closed `outputs` 배열로 파싱하고 G2 declaration의 exact path set과 대조한다.
host가 UTF-8/base64 bytes를 재물질화해 JSON·CSV·text 구조와 hash를 다시 관측하고, 독립 relation verifier가
actual input/output digest 전체를 exact 반환할 때만 `output_verified`로 올린다. missing·unexpected·duplicate·
invalid format·relation mismatch·residual process는 unverified이며 user target write는 0이다.

G6 actual은 G5 verified outputs 중 publishable만 Buffer candidate로 F의 Preview→Prepare→Lock→Publish→Verify→
Settle에 전달한다. internal·diagnostic·temporary는 사용자 target에 만들지 않으며 F rollback·Undo pointer를
보존한다. F settlement 뒤 Capsule scratch 전체를 삭제하고 absence를 다시 확인한다. cleanup 실패는 이미 검증된
publication을 지우지 않고 `published_verified_cleanup_unknown`으로 분리한다.

현재는 `G7` product activation and A/B만 열려 있다. 자연어 대량 변환의 자발 선택, 단순 요청의 비선택,
명시적 프로그램 Artifact 분리, G0 대비 품질·calls·tokens·wall·잔여물 0을 실제 모델에서 확인한다.

G7 first actual에서 gpt-5.5는 Capsule을 선택하지 않고 기존 exec 경로로 같은 12-file·527-row 목적을 정확히
완료했다. model calls는 13→11, provider tokens는 323,691→254,539로 줄었지만 wall은 107.8초→125.0초로
악화됐고 Capsule 사용자 이익은 0이었다. 단순 계산의 추가 call 0과 hidden-tool 기계 경계는 통과했지만 positive
self-selection이 실패했으므로 product wiring 후보를 모두 제거했다. Prompt·전역 schema 노출·업무 Router를
추가하지 않으며 G7 완료를 주장하지 않는다.

제품 변경 0의 prompt dump 재실행에서 모델은 turn 1·2에 exec로 파일과 기준을 보고, turn 3의 tool_search에는
`file reality bind_sources local files reconciliation CSV source manifest register_output`을 exact query로 사용했다.
turn 6에는 Python heredoc으로 순수 변환을 작성해 declared output 두 개만 변경했고, turn 7에는 별도 Python
재계산으로 결과를 다시 검증한 뒤 12 source bind와 두 Artifact 등록을 끝냈다. 즉 프로그램 필요성을 몰랐던 것이
아니라 기존 exec가 모델에게 자연스러운 프로그램 interface였다. Python source를 QuickJS로 자동 redirect하면
언어·표준 library·filesystem 의미가 달라지고, 전역 exec schema 확장은 단순 요청 비용을 늘리므로 둘 다 채택하지
않는다. G7은 Capsule이 별도 backend여야 하는지, 이미 선 exec의 안전·검증 원리로 흡수돼야 하는지 재판정한다.

오너 결정으로 G7 완료 기준을 `모델이 Capsule Tool을 선택함`에서 `모델이 자연스럽게 프로그램을 사용하고 T5가
그 실행을 G의 입력·격리·검증·발행·정리 계약으로 끝냄`으로 교정한다. 별도 Capsule Tool은 폐기 상태를 유지한다.
기존 Python·exec 선택은 보존하고 model-authored temporary program 실행에만 source·RecordRef·expected output을
명시적으로 결속한다. Runtime은 업무나 command 문자열로 의미를 추측하지 않고 실행 계약의 filesystem·network·
child-process 요구가 pure transform일 때만 QuickJS를 내부 backend 후보로 사용한다. 요구가 맞지 않으면 자동
언어 변환 없이 같은 Python과 Terminal 경계를 유지한다.

G7 exec 흡수의 첫 제품 조각은 기존 Tree-sitter command explanation에서 heredoc body의 exact span·bytes·digest와
그 source를 받은 command identity만 구조적으로 관측한다. pipeline이 heredoc command 뒤에 붙어도 source owner를
redirected statement의 body command에 결속한다. body가 없는 일반 exec explanation에는 새 field를 만들지 않으며,
이 사실만으로 temporary program·입력·요구 조건·backend·성공 의미를 Runtime이 선택하지 않는다. 실행·격리·
발행 동작도 아직 바꾸지 않았다. 다음 조각은 이 구조적 source fact가 있을 때만 실행 전에 모델이 current Work의
RecordRef·declared output·resource requirements를 명시할 수 있는 transient continuation이며, 전역 exec schema나
durable Store를 만들지 않는다.

같은 source-language Terminal backend의 macOS qualification은 exact `/usr/bin/python3` 3.9.6과 원문 Python
source를 사용한다. input RecordRef마다 scratch 상대경로를 결속해 실행 전후 원본 digest와 staged copy를 다시
확인하고, declared output도 scratch에서만 관측한다. Seatbelt는 network·process fork·scratch 밖 write를 물리
차단하고 Python audit boundary는 scratch와 interpreter runtime 밖 read·directory observation을 닫는다. source
번역·package·user target write는 0이다. 정상 CSV 변환, child fork, network, protected read, outside write,
undeclared scratch output, staged input mutation, non-macOS non-claim 7개가 통과했다. 이 자격은 backend 가능성만
증명하며 Console·exec product wiring과 independent relation verification·F publication은 아직 0이다.

첫 transient continuation 후보는 같은 Run에서 이미 `bind_sources`로 결속된 manifest가 하나이고, exact literal
Python heredoc·declared local target·현재 Work revision·Run/cancel owner가 모두 있을 때만 원래 exec를 실행하지
않고 보호 backend→host format observation→F transaction을 잇도록 구성했다. 일반 heredoc과 manifest 없는
Python exec의 첫 model schema·실행은 바꾸지 않았고, 보호 경로 입장 뒤 requirement·revision·program 실패는
일반 exec fallback 0으로 닫혔다.

하지만 실제 12파일·527행 gpt-5.5 자연어 A/B에서 사용자 목적은 정확히 달성했어도 continuation request·execution은
각 0이었다. 결과는 93.989초·10 model calls·10 tool calls·208,713 provider tokens·957,833 request bytes였고,
기존 제품 변경 0 진단 101.754초·11 calls·251,526 tokens보다 가벼웠지만 이 이익은 continuation에 귀속되지 않는다.
모델은 기존 exec 프로그램 경로를 사용했고 선결속 전제 후보는 사용자 이익 0이므로 제품 entry·exec preflight·
completion recovery 배선을 모두 제거했다. 두 번째 content-free 순서 진단은 provider `fetch failed`로 끝나
새 제품 근거로 승격하지 않는다.

따라서 같은 선결속 방향에 조건을 더 붙이지 않는다. 다음 후보는 제품 변경 0 qualification에서 모델이 실제
프로그램 실행 중 읽은 managed workspace source identity를 의미 선택 없이 관측·전후 digest로 결속할 수 있는지
확인한다. 전체 workspace 복제·파일명 목록 provider 전송·Python open 정규식·사용자 target 직접 write는 금지한다.
이 실제-read 결속이 source 우회·비용·privacy 반례를 통과하기 전 제품 entry를 다시 열지 않는다.

제품 변경 0의 macOS actual-read observer prerequisite 측정에서는 `fs_usage`가 root를 요구했고,
`opensnoop`·DTrace는 SIP 환경에서 추가 권한 없이는 시작되지 않았다. Seatbelt의 `(with report)`와 `trace` 지시는
허용된 file read를 현재 Run이 소비할 수 있는 exact receipt로 만들지 않았고, host에는 FUSE filesystem도 없다.
Python audit hook은 workspace 밖 접근의 물리 차단을 대신하지 않으며 C extension·native read까지 완전한 OS read
set이라고 주장하지 않는다. 따라서 현재 권한과 설치 의존성 0 조건에서 exact actual-read observer 후보는 없다.

다음 positive control은 APFS copy-on-write read-only workspace snapshot이다. 이는 actual read file만 식별하지는
못하지만 실행 전후 동일한 bounded source universe를 고정하고 원본 direct write 0을 만들 수 있다. clone 생성·
전체 manifest 비용, source snapshot 중 원본 경합, symlink·hardlink·대형 tree, declared output 분리, cleanup을 먼저
qualification하고 실제 read set으로 과장하지 않는다. brokered filesystem은 제품 기본에 새 system extension·
관리자 설치를 요구하지 않는 경로가 실제로 설 때만 다시 비교한다.

snapshot generation qualification actual은 Node `COPYFILE_FICLONE_FORCE`의 `ENOSYS`를 일반 copy로 낮추지 않고
macOS `/bin/cp -c` direct argv만 사용했다. 13파일·204 logical bytes fixture는 24.477ms에 generation을 만들었고
file stat blocks 합계는 53,248 bytes였다. 이 blocks 값은 clone의 고유 physical allocation 측정이 아니다.
모든 file hash와 원본 dev·ino·size·mtime을 clone 전후 재검사하고 clone file을 read-only로 바꿨다. symlink·
hardlink·generation 중 source 변경은 candidate와 partial generation 0으로 닫혔다.

같은 Python source는 snapshot의 workspace-relative RecordRef 전체를 받아 source 번역·network·child·원본 write·
user target write 0으로 정확한 합계를 만들었다. 하지만 program이 실제 읽은 파일과 snapshot에 함께 결속됐지만
읽지 않은 파일을 OS 사실로 분리하지 못하므로 snapshot은 `exactActualReadSet=false`다. 제품 entry·exec schema·
model calls·provider bytes 변화는 0이며, output은 아직 unverified scratch candidate라 G7 완료나 제품 채택이 아니다.

G7 final deterministic qualification은 사업·개발·개인 파일 세 목적에서 snapshot source universe→same-language
Python exact 1회→host output observer→F multi-file publication→exact reopen→durable Undo→cleanup을 통과했다.
missing·unexpected·duplicate·invalid output, outside read/write, network, child, cleanup unknown, settlement-cleanup
crash, 일반 exec·일반 heredoc 비개입을 함께 닫았다. `actualReadSet`은 `unknown`으로 유지하고 전체 immutable
source universe와 output coverage만 완료 사실로 사용한다.

하지만 첫 실제 gpt-5.5 12파일·527행 제품 자격은 결과 4행·오류 47행, source unchanged, snapshot execution 1,
source digest, cleanup, residual 0을 모두 통과했어도 161.854초·16 model calls·16 tool calls·419,448 tokens·
1,888,088 request bytes를 사용했다. 제품 변경 0 진단의 101.754초·11·11·251,526 tokens와 마지막 activation 0
표본의 93.989초·10·10·208,713 tokens보다 크게 나빴다. verified publication 뒤 attachment registration 실패가
연쇄돼 불필요한 왕복도 증가했다. 따라서 실제 두 목적을 더 실행하지 않고 final product wiring을 제거했다.

오너 종료 규칙에 따라 S4-G는 `internal_engine: COMPLETE`,
`product_activation: CLOSED_WITH_OBSERVATION`, `further_development: DEFERRED`로 종료한다.
`actualReadSet: UNKNOWN_BY_DESIGN`, `sourceUniverse: COMPLETE_IMMUTABLE`,
`outputCoverage: INDEPENDENTLY_VERIFIED`다. G 관련 source는 qualification-only payload 제외선으로 옮기고 별도
Tool·Prompt·Router·filesystem observer·snapshot activation을 더 개발하지 않는다.

완료 문장:

> T5는 기존 손으로 같은 품질을 경제적으로 달성하기 어려운 현재 Work에서만 작은 프로그램을 만들고, 고정된
> 입력과 범위에서 시험·실행하며, 프로그램과 독립적으로 검증한 사용자 결과만 발행하고 나머지는 정리한다.

### S4-H — 범용 Reconciliation 확장 — CLOSED WITH EXISTING CAPABILITY OBSERVATION · HQ REQUIRED

기존 `bind_sources`·source manifest·document reopen 위에서 실제 실패만 넓힌다. 서로 다른 자료의 대상 후보,
field mapping, 중복·누락·충돌, 날짜·수량·금액, partial coverage, 원본 행·셀·페이지 lineage, 결과 재계산과
사용처 형식을 분리한다.

0.3.1 실제 사용자의 자연어 기록→교정→원본 신청자료→양식→권역별 Excel·ZIP 여정은 목적을 달성했지만,
독립 감사에서 두 행의 고유값 교환, 필수값 한 건 미확인, 요청하지 않은 개인정보 JSON 포함이 관측됐다. 이름·
월·권역 예외를 만들지 않고 다음 범용 계약으로 흡수한다.

- 행 순서나 비슷한 이름이 아니라 source key·source row·revision으로 join한다.
- one-to-one·one-to-many·many-to-one·ambiguous·unmatched·conflicting cardinality를 사실로 남긴다.
- 동일 source identity의 기간별 값 같음·다름·누락을 관측하고 Runtime이 올바른 값을 선택하지 않는다.
- 필수 field마다 전체·확인·허용 빈칸·원본 없음·join 실패·상충·미확인 coverage를 계산한다.
- output file·sheet·row·field에서 source file·sheet·row·revision·mapping·verification으로 이어지는 lineage를
  Receipt에 보존하되 기술 field를 사용자 Excel에 강제로 추가하지 않는다.
- 최종 Excel·ZIP을 독립 재개방해 실제 파일 수·시트·행·열·필수값·중복·누락·formula error·내부 파일·
  개인정보 범위를 검사한다.
- 최종 답의 파일 수·행 수·권역별 수·검증 완료·미확인·포함 파일 목록은 observer 결과와 일치해야 한다.

같은 이메일이라는 이유만으로 다른 기간의 고유값을 복사하거나 출처 없는 identity를 merge하지 않는다. 필수값
하나가 미확인이면 전체 검증 완료로 말하지 않고 확인된 행과 남은 한 행을 분리한다.

S4-H read-only current-head actual은 비슷한 이름의 신청원본 순서를 뒤집고, 한 행의 필수 연락처를 비우고,
요청하지 않은 개인정보 JSON canary를 둔 작은 source-key fixture를 두 번 실행했다. 두 실행 모두
`REQ-001→UNIQUE-001`, `REQ-002→UNIQUE-002`, `REQ-003→UNIQUE-003`을 정확히 보존했고 완성 2행·미확인 1행,
결과 CSV 두 개만 만들며 private canary와 원본 변경은 0이었다.

최초 oracle은 미확인 결과를 `record_key·name·unique_code·missing_field` 네 열로 과도하게 축소해 정상 결과를
`required_field_coverage` 실패로 오판했다. 실제 결과는 `amount·빈 contact·missing_fields=contact`까지 보존해
더 완전했다. oracle을 source-preserving 여섯 열로 교정한 뒤 current-head는 세 결함 가족 모두 positive control이다.
제품 구현은 0이다. 불리한 비용은 첫 실행 122.014초·12 model/tool calls·233,034 tokens, 두 번째 155.969초·
17 model calls·18 tool calls·392,273 tokens로 보존한다.

cross-domain 기존 증거 감사에서 KHB-M05 미수금은 invoice·payment evidence를 대사해 목적·정확성·무전송을
통과했고, 개인 파일의 structured person record를 포함한 다섯 current 목적은 exact file 결과를 달성했다.
KHB-A03 계약 비교는 exact revisions의 reconciliation에 들어가기 전 workspace 자료를 찾지 못한 S4-C Hand 실패다.
따라서 H core 결함으로 새 join engine을 만들지 않으며 A03 자료 발견과 개인 파일 cross-source join은 S4-HQ에서
재확인한다. H는 `CLOSED_WITH_EXISTING_CAPABILITY_OBSERVATION`, `PRODUCT_IMPLEMENTATION: 0`, `HQ_REQUIRED: true`다.

재고·계약·미수금 실패의 공통 원인이 같은 대상·시간·상태 연결일 때 하나의 source-backed reconciliation
원리를 고친다. 세 전용 기능을 만들지 않고 ambiguous identity를 자동 merge하지 않는다.

완료 문장:

> T5는 업무 분야와 무관하게 여러 자료를 연결·비교·대사하고 사실·누락·상충·불확실성을 분리한 결과를 만든다.

### S4-I — Adaptation·Recovery — COMPLETE WITH EXISTING CAPABILITY

방법 실패와 목적 실패를 분리하고 성공한 Evidence·부분 결과·effect를 보존한다. 아직 시도하지 않은 Hand,
대체 비용과 위험, 사용자에게 물을 사실과 T5가 더 관측할 사실, exact resume를 모델에 공급한다. update·crash·
cancel 뒤 blind retry와 orphan process를 막는다.

provider·surface 실패 전 사용자가 이미 본 부분 답과 확인된 계산은 exact fragment로 보존한다. model partial
생성, 사용자 가시화, final 생성, surface persistence, delivery terminal을 한 success로 합치지 않는다. 실패
surface가 이미 공개된 유용한 결과를 지우거나 후속 입력이 같은 계산·Tool·외부 effect를 다시 실행해서는 안
되며 Console·Telegram의 공개 상태가 달라서도 안 된다.

사용자 답은 결과 중심으로 모델이 작성한다. `결과 → 근거 → 미확인 → 다음 행동`은 가능한 정보 순서이지
고정 답변 템플릿이 아니다.

S4-I current-head actual은 기존 다섯 recovery fixture를 그대로 재실행했다. 방법 unavailable 뒤 다른 command,
partial observation 뒤 전체 재계산, 시작 전 transient 실패의 exact 동일-call 1회 retry, pipe 실패 뒤 PTY 전환,
존재하지 않는 기록의 무효과 bounded stop이 모두 목적을 달성했다. 첫 실행의 HTTP 500 5건은 오래된 runner가
현재 Keychain-backed model connection을 열지 못한 qualification 결함이어서 runner만 현재 secret-store 경계로
교정했다.

불가능 정지의 최초 실패도 제품 결함이 아니었다. 기존 판정기가 `effect_declaration_required`와
`work_completion` protocol call까지 탐색 횟수로 세었다. actual evidence-producing exec 5개만 세도록 교정하면
무효과·부재 보고·bounded stop이 모두 통과한다. 다섯 실제 Run은 149.210초·33 model calls·28 tool receipts였고
제품 구현은 0이다. S4-I는 기존 recovery capability로 COMPLETE다.

완료 문장:

> T5는 실패와 불확실성을 해석해 적절한 방법으로 전환하고 사용자가 바로 활용할 결과를 일머리 있게 전달한다.

### S4-J — Experience-Based Growth — DEFERRED TO FUTURE RESEARCH

오너 결정으로 4차 필수 Gate에서 제외했다. 실제 settled Work·사용자 교정·반례·작은 trial·동일 목적 A/B를
거쳐 방법을 승격·교체·rollback하는 장기 연구는 현재 제품 entry 0으로 보존한다. 기존 Memory·Episode·Skill과
사용자 규칙은 그대로 유지하며, 자동 Skill 승격·사용자 persona·출처 없는 추론·Core 수정은 4차에 넣지 않는다.

이 절은 미래 연구 경계를 기록할 뿐 4차 완료 조건이나 현재 개발 순서를 열지 않는다.

### S4-K — Capability Reality CROSS-CUTTING · Acquisition DEFERRED TO FUTURE RESEARCH

Capability Reality는 별도 획득 엔진이나 Gate가 아니다. S4-G·S4-I·S4-HQ가 기존 Connection·Capability·Resource
Receipt를 이용해 현재 사용할 수 있는 손, 부족한 이유, 이미 가능한 대안, 입력 한계, 비용·시간, local/external,
privacy scope와 실패 대안을 정직하게 확인하는 공통 불변식으로 유지한다. 관련성·수단 선택은 모델이 판단하며
업무 Router나 모델 강제 선택을 만들지 않는다.

외부 후보 발견, Skill·Plugin·CLI·MCP 설치, 격리 inactive 준비, positive control, update·rollback·remove를
통합하는 Capability Acquisition은 오너 결정으로 미래 연구에 이관했다. 기존 CA research 모듈과 휴면 source의
제품 import는 0이며, 4차에서는 package 자동 설치·자동 영구 승격·새 획득 lifecycle을 열지 않는다.

S4-C carry-forward의 모델별 Hand 선택, portable command, shallow observation 해석, 목적 정확성,
wall·calls·tokens는 S4-G·S4-I·S4-HQ에서 현재 사실과 실제 사용자 결과로 다시 확인한다.

### S4-UX — Interaction Continuity & Human Reassurance — COMPLETE

S4-B~I가 만든 머리·손·복구 현실을 새 원장이나 모델의 진행 서술 없이 현재 Work·Run·Tool·Effect·Delivery
사건에서 사용자 언어로 투영한다. 이미 선 canonical Work reality, milestone, 경과시간, 교정·중지, 재접속 복원,
Telegram 진행, Artifact·Effect·Delivery 영수증을 재사용한다.

S4-UX current-head 첫 반대시험은 모델이 도구 없이 답을 내놓았다는 사실만으로 Runtime이 Console SSE와 Telegram에
`이제 거의 다 됐어요`를 발행하는 것을 재현했다. 이는 검증·publication·delivery 사실이 아니고 짧은 요청에도
불필요했다. `model_accepted`를 완료 의미로 승격하던 발행과 해당 문구의 안전 allowlist만 제거했다. 실제 grounded
milestone·경과시간·중지·재접속·Telegram 동일 상태는 유지됐고 집중 검사는 28/28을 통과했다. 새 원장·Prompt·
업무 분류·추가 model/tool call은 0이다. S4-UX 전체는 아직 진행 중이다.

두 번째 반대시험은 결과 파일 생성 뒤 model/registration 단계 실패를 current product에서 재현했다. 결과 bytes와
canonical output handle은 Store에 안전하게 보존되고 다음 턴이 프로그램·파일을 다시 만들지 않고 exact 결과를
등록했지만, 사용자 surface의 `pendingOutputs`에도 내부 output handle과 SHA-256이 함께 지속됐다. 복구에 필요한
identity는 Store에만 남기고 공개 pending-result는 파일명·크기만 투영하도록 줄였다. 결과 보존·등록·재전달·
Console/Telegram 집중 검사는 46/46을 통과했고 새 recovery Store나 재실행은 0이다. 실제 provider 재실행은 이
slice에서 하지 않았으므로 S4-UX 전체 완료 근거로 사용하지 않는다.

세 번째 반대시험은 canonical Conversation에 있던 사용자·T5 `recordedAt`과 Attachment의 `createdAt`을 session/UI가
버리는 것을 재현했다. 새 시계를 만들지 않고 exact canonical 시간을 대화와 결과 버전 카드에 결속해 사용자 timezone으로
표시한다. 기존 artifact family의 단조 version과 재접속 projection은 유지됐다. S3-UX actual 두 모델 4/4, current-head
grounded progress·partial result preservation·cancel·reconnect·Console/Telegram·Artifact 회귀, 세 current 반대시험을
합쳐 S4-UX는 COMPLETE다. current-head 외부 provider 전체 여정은 새로 실행하지 않았으며 S4-HQ actual에서 재확인한다.

개발 범위:

- 실제 확인·생성·검증·대기·막힘·사용자 행동 필요 사건을 의미 있는 업무 단계로 묶는다.
- 짧은 작업은 별도 진행 소음 없이 결과를 내고, 긴 작업은 실제 단계가 바뀔 때만 상태를 갱신한다.
- 대화 상단·메시지 아래·작업 기록의 중복 현재 상태를 하나의 canonical status projection으로 통합한다.
- 현재까지 보존된 결과, 실제로 남은 단계, 지금 필요한 사용자 행동, 중지 가능성을 사실이 있을 때만 보여준다.
- 실행 중 교정·중지의 접수 문구가 아니라 실제 Work 범위와 settlement 반영을 표시한다.
- Session 이동·재접속·Console·Telegram에서 같은 canonical 상태와 terminal 결과를 유지한다.
- 내부 Run·Tool·command·path·hash·검색어·비밀·모델 사고 원문을 사용자 상태에 투영하지 않는다.
- 과거 표본과 현재 단계 근거 없는 ETA·percentage·`거의 완료`를 만들지 않는다.
- Conversation recordedAt, Work 시작, surface persistence, delivery terminal, Resource wall의 canonical 시간을
  사용자 timezone으로 투영해 사용자 메시지·T5 답변·실제 작업시간을 확인할 수 있게 한다.
- 같은 결과의 수정본은 같은 Artifact lineage에서 version이 단조 증가하고, 새 목적의 결과만 새 lineage를
  시작한다. Console·Telegram이 같은 최신 버전을 보여주며 이전 파일을 덮어쓰지 않는다.
- 내부 `sandbox:` URL·attachment id·hash·임시 경로·source manifest id 대신 native 파일 카드·파일명·
  다운로드·버전만 보여준다.
- `N개 대상의 변화를 확인` 같은 원장 문구를 반복하지 않고 오디오 변환·검산·외부 반영 확인처럼 실제 업무
  단계가 바뀔 때 하나의 사용자 상태로 합친다.

반대시험:

- 같은 현재 상태가 둘 이상의 가시 표면에 중복된다.
- 실제 새 Evidence·output·effect 없이 진행 문구만 바뀐다.
- model 시작·heartbeat·poll을 사용자 업무 진전으로 승격한다.
- 사용자 행동이 필요한데 계속 진행 중으로 보이거나, 교정 접수 뒤 실제 Work가 바뀌지 않는다.
- 짧은 요청에 불필요한 상태가 누적되거나 긴 요청이 일반 문구 하나로 장시간 정지한다.
- 재접속·Console·Telegram이 서로 다른 현재 단계·남은 일·terminal 결과를 보인다.
- 같은 Artifact가 version 3 뒤 version 1로 보이거나 메시지·답·Work 종료 시간이 실제 원장과 다르다.
- 내부 sandbox URL 또는 프로그램의 diagnostic file이 사용자 결과로 보인다.
- provider 실패 surface가 사용자가 이미 본 올바른 부분 답을 지운다.

비목표: UI 전면 재설계, 새 WorkStore·진행 원장, 모델 사고 공개, Tool 로그, 업무별 진행 대본, 가짜 ETA·
percentage, 애니메이션으로 시간 채우기, Runtime 문구로 모델의 최종 답 교체.

완료 문장:

> T5는 내부 복잡성을 드러내지 않으면서 사용자가 현재 작업의 실제 진전·남은 일·필요한 행동·중지 가능성을
> 자연스럽게 이해하도록 하고, 대화와 채널을 이동해도 같은 작업 흐름을 유지한다.

### S4-L — Windows 물리 자격

Windows는 마지막에 처음 고려하지 않는다. S4-B~I의 공통 계약마다 Windows adapter 의미와 반대시험을 함께
고정하고, S4-UX의 단일 상태·진행 밀도·교정·중지·재접속 계약까지 포함해 이 Gate에서 실제 Windows x64·ARM64
제품 여정을 최종 자격한다. PowerShell direct argv, ConPTY, Job Object, DPAPI, NTFS ACL·junction·hardlink,
Windows Search·OCR·문서 render와 실제 UI 흐름을 확인한다.

macOS 성공, Linux/WSL, emulation, GitHub runner는 물리 Windows 사용자 성공을 대신하지 않는다.

완료 문장:

> 같은 T5 머리와 사용자 약속이 macOS와 Windows의 실제 OS 손에서 각각 성립한다.

### S4-HQ — 전체 인간 시나리오·비교군 A/B

모든 기술 Gate가 닫힌 뒤 한 번만 실행한다. 사업 업무에 무게를 두되 개발·연구·개인 파일·능력 부족·장기
실행·위험 경계를 포함한다. Terra와 gpt-5.5의 exact 모델 pair는 실행 시점에 고정하고 같은 목적·fixture·도구면·
권한면으로 현재 Cleanroom T5와 비교군을 비교한다. 모델별 Prompt patch로 실패를 덮지 않는다.

기능 결과와 별도로 사용자가 기다리는 동안 실제 진전·남은 일·사용자 행동 필요·교정·중지·재접속을 이해하고
안심하며 통제할 수 있었는지 평가한다. 진행 문구의 수나 갱신 빈도는 성공 지표가 아니며 실제 runtime 사건과
사용자 체감의 일치가 기준이다.

대표 목적:

- 흩어진 자료에서 빠진 증빙과 맞지 않는 금액만 만들기
- 형식이 다른 대량 자료를 작은 프로그램으로 통합·검산하기
- 프로젝트의 실패 원인을 찾아 수정·재시험하고 장기 process를 복구하기
- 현재 연결되지 않은 자원의 gap과 이미 가능한 최소 대안을 확인하고 연결·획득을 거짓 주장하지 않기
- target 밖 write·secret·외부 전송·결제·late child effect를 차단하기
- 여러 턴의 월·권역 기록과 교정, 신청자 원본과 제출 양식을 결합해 권역별 Excel 6개를 만든 뒤 ZIP의
  18행·source-key join·필수값 coverage·시트·금액·내부 파일 0을 독립 검증하기
- 장시간 한국어 오디오에서 현재 사용 가능한 STT engine의 현실을 확인하고, 사용할 수 있을 때만 전사·요약·
  실행 과제·전체 원문 Artifact를 분리해 Notion에 반영·재개방하며 비용·시간·privacy·첨부 미지원 범위를
  보존하기. 사용할 수 없으면 최소 대안과 미실행 사실을 보존한다.

S4-C carry-forward로 실제 자료가 있는데 없다고 말하는지, shallow 검색을 전체 부재로 확대하는지, 불필요한
Connection을 먼저 여는지, 같은 목적을 더 적합한 모델이 해결하는지를 다시 확인한다.

완료 문장은 이 문서 1절의 최종 완료 문장 전체다.

## 8. S4-A 최소 기준선

| 축 | 우선 재사용 시나리오·증거 | 현재 역할 |
|---|---|---|
| 사업 | `KHB-E01`, `KHB-A01`, `KHB-P01` | reconciliation·요청 범위·과거/현재 구분 |
| 개발 | `A-H06`/`HP-03` | 프로그램 identity·분석·비개발자 결과물·재개방 |
| 연구 | `A-H04` | 현재 출처·fact/해석·bounded research |
| 개인 파일 | `HP-01`, file-intelligence live baseline | 모호한 단서·OCR·target 유지·성능 |
| 능력 부족 | `KHB-E02` | 현재 connection/capability gap·로컬 대안·최소 질문 |
| 장기 실행 | Terminal H04, `A-H07` | 한 번 실행·exact output·cancel·wake·restart 경계 |
| 위험 경계 | `HP-07`, Terminal sandbox-first | secret 비노출·managed confinement·effect 진실 |

S4-A는 위 전체를 다시 돌리는 wave가 아니다. 각 축의 기존 통과와 불리한 관측을 먼저 재사용하고, 최초
candidate failure를 현재 source에서 한 번 재현한다. S4-B 완료 시에는 같은 결함 가족을 세 분야에서 확인한다.

현재 candidate observation은 다음이며 아직 현재 결함으로 확정하지 않는다.

- `KHB-A01`: 사용자는 gap만 요청했으나 과거 실행에서 일부 matched evidence도 답에 포함됐다.
- `KHB-S01`: 작은 예약 자료에 불필요한 connection probe와 큰 비용이 관측됐다.
- 개인 파일 visual/OCR: 목적은 달성했지만 110.1초·14 model calls·16 tool calls 표본이 있다.
- Terminal: 실행 중 disk spool과 Runtime 재시작 후 process handle은 아직 자격되지 않았다.

## 9. 금지 범위

4차에 다음을 넣지 않는다.

- 총무·인사·재고 전용 Pack, ERP, 업무별 Intent Router, 업종별 workflow
- 화면 전체 Recall, 무제한 상시 파일 본문 수집, 사용자 persona
- SSH·Docker·cloud backend 일반 확대, root/admin 일반 shell
- 모든 외부 서비스 Connector, Skill 개수 늘리기
- Experience-Based Growth 제품 구현, Capability Acquisition, package 자동 설치·자동 Skill 승격
- Prompt 전면 재작성, UI 전면 재설계
- 모든 변경 자동 rollback, 모든 shell effect의 과장된 완전 confinement
- Runtime 규칙으로 모델의 목적·관계·완료 의미 선택
- 실제 사용자 HOME·계정·자격증명·외부 상대를 이용한 자동 시험

## 10. 현재 다음 한 작업

S4-C 미달은 S4-I·S4-HQ에 계속 이월한다. S4-D managed non-PTY와 D5C, S4-E1~E7, S4-F는 닫혔다. S4-G는 internal
engine COMPLETE·product activation CLOSED_WITH_OBSERVATION·further development DEFERRED로 종료했고 제품 entry는
0이다. S4-H는 existing-capability observation으로 닫고 계약 발견·개인 cross-source join을 HQ에 남겼다. S4-I는
current-head recovery 5/5와 qualification ruler 교정 뒤 제품 구현 0으로 완료했다. J는 미래 연구, K는 cross-cutting
사실로 유지한다. S4-UX는 grounded progress·recoverable result 공개 경계·canonical 대화/Artifact 시간을 수리하고
기존 실제 모델·current product 회귀로 완료했다. 현재 다음 한 작업은 S4-L read-only baseline이다. 기존 Windows
evidence·runner·deferred physical manifest를 대조해 실제 x64·ARM64 자격에서 미실행인 항목과 blocker만 고정한다.
