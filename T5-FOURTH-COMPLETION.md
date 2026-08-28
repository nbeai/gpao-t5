# T5 Fourth Completion — Android Work Intelligence

상태: `FOURTH_COMPLETION_ACTIVE · S4_0_COMPLETE · S4_A_COMPLETE · S4_B_COMPLETE_MODEL_OBSERVATION · S4_D0_FACT_ONLY_CORRECTED · S4_C_CLOSED_WITH_MODEL_PROVIDER_OBSERVATION_NOT_UNIVERSALLY_PROVEN · S4_D1_BASELINE_COMPLETE · S4_D2_COMPLETE · S4_D3_COMPLETE_WITH_RSS_OBSERVATION · S4_D4_BASELINE_COMPLETE · S4_D4A_PARENT_DEATH_CONTAINMENT_COMPLETE · S4_D4B_SUCCESSOR_SETTLEMENT_COMPLETE · S4_D5_RSS_ATTRIBUTION_COMPLETE · S4_D5A_EXPLANATION_LIFETIME_REPAIR_ACTIVE`
현재 Gate: `S4-D5A COMMAND EXPLANATION LIFETIME REPAIR`
출발 기준: `t5-0.3.1-clean-baseline · 8aba3700`
개발선: `codex/t5-fourth-android-intelligence · /Users/jyp/Developer/t5-fourth`

이 문서는 T5 4차 개발의 유일한 현재 계획 정본이다. 제품 정의는 `T5-PRODUCT.md`, 작업 규율은
`AGENTS.md`가 담당한다. 2차·3차 계획과 Cleanroom 문서는 완료 역사와 증거이며 현재 범위를 열지 않는다.
Terminal·Work Intelligence·Capability·Windows를 설명하는 별도 총괄 계획서를 만들지 않는다. 각 Gate의
작은 기계 증거만 `refoundation/evidence/`에 남긴다.

`Android`는 사용자의 목적을 이해하고 현실에서 스스로 적절한 손을 구성하는 제품 비유다. Android 모바일
운영체제를 뜻하지 않는다. 외부 제품 목표는 `Android Intelligence`, 내부 기술 목표는
`Work Intelligence + Terminal Execution + Capability Growth`다.

## 1. 제품 약속과 최종 완료 문장

> 사용자는 기능·명령어·프로그램을 선택하지 않고 평소 말로 목적만 설명한다. T5는 사용자의 상황과 기준,
> 컴퓨터와 외부 자원의 현재 현실을 파악하고 가장 경제적인 방법을 선택한다. 기존 손으로 충분하면 즉시
> 사용하고, 부족하면 현재 Work에 필요한 작은 도구를 만들거나 검증된 능력을 갖춘다. 큰 자료와 장시간
> 작업도 가볍게 관리하며 맡긴 범위 안에서만 실행하고, 결과·효과·전달을 검증한다. 실패·교정·취소·Runtime
> 사고 뒤에도 고아 실행과 중복 효과 없이 이어가며, 실제 협업 경험을 통해 사용자에게 맞는 일머리와
> 전문성을 발전시킨다.

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
→ 실제 교정과 성과에서 성장
→ 부족한 손만 안전하게 획득
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
2. **현재 Gate**: S4-D5A command explanation lifetime 최소 수리다.
3. **사용자 완료 문장**: T5는 대규모 출력과 장시간 작업을 한 번 실행하고 Context 폭증·고아 실행·중복 wake
   없이 끝까지 관찰한다.
4. **이미 선 실제 증거**: D5는 command explanation을 managed process 동안 보존하면 RSS +595.6MB, 같은 parser
   결과를 process 전에 해제하면 +20.9MB, explainer를 우회하면 +11.3MB임을 격리 3회 중앙값으로 분리했다.
5. **현재 가장 큰 미달**: 이미 launch·권한 파생을 끝낸 command explanation이 대출력 실행 동안 불필요하게
   살아 있어 Runtime RSS를 약 600MB까지 올린다.
6. **이번 변경 방식**: explanation의 모든 현재 소비를 끝낸 뒤 registry start 전에 참조만 해제하고, command
   해석·권한·pipeline 사실·broker·출력·process 결과는 그대로 보존한다.
7. **Non-goals**: parser 교체·새 process protocol·고정 memory 상한·출력 손실·Store 변경·process reattach·
   PTY containment·Windows 재구현·S4-E·실제 HOME·계정·외부 효과.

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
정확성·비용 차이는 S4-K의 model·Capability 선택 현실과 S4-HQ의 실제 인간 목적에서 다시 확인한다. HQ에서
핵심 목적이 실패하면 4차 전체 완료를 주장하지 않는다.

완료 문장:

> T5는 현재 가진 자료·기억·연결·능력과 부족한 사실을 빠르게 파악하고 가장 적합한 손으로 필요한 원문만 본다.

### S4-D — Terminal 실행 중 output·process 미달 — D2·D3·D4A·D4B·D5 COMPLETE, D5A ACTIVE

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

### S4-F — Structured Authoring

내부 `workspace_patch` 후보는 `inspect → preview → write_new/apply_patch → verify → rollback`을 제공한다.
exact preimage digest, stale patch 거부, root escape 차단, atomic rename, bounded diff, post-write hash, rollback
pointer, 다중 파일 all-or-nothing을 요구한다. 사용자 흐름 없는 새 editor나 범용 IDE를 만들지 않는다.

완료 문장:

> T5는 shell quoting과 문자열 조립에 의존하지 않고 관리 범위의 프로그램·설정·문서를 정확히 변경하고 복원한다.

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

완료 문장:

> T5는 처음 보는 업무에 필요한 작은 도구를 작성·시험·실행하고 독립 검증해 기존 손의 한계를 넘는다.

### S4-H — 범용 Reconciliation 확장

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

재고·계약·미수금 실패의 공통 원인이 같은 대상·시간·상태 연결일 때 하나의 source-backed reconciliation
원리를 고친다. 세 전용 기능을 만들지 않고 ambiguous identity를 자동 merge하지 않는다.

완료 문장:

> T5는 업무 분야와 무관하게 여러 자료를 연결·비교·대사하고 사실·누락·상충·불확실성을 분리한 결과를 만든다.

### S4-I — Adaptation·Recovery

방법 실패와 목적 실패를 분리하고 성공한 Evidence·부분 결과·effect를 보존한다. 아직 시도하지 않은 Hand,
대체 비용과 위험, 사용자에게 물을 사실과 T5가 더 관측할 사실, exact resume를 모델에 공급한다. update·crash·
cancel 뒤 blind retry와 orphan process를 막는다.

provider·surface 실패 전 사용자가 이미 본 부분 답과 확인된 계산은 exact fragment로 보존한다. model partial
생성, 사용자 가시화, final 생성, surface persistence, delivery terminal을 한 success로 합치지 않는다. 실패
surface가 이미 공개된 유용한 결과를 지우거나 후속 입력이 같은 계산·Tool·외부 effect를 다시 실행해서는 안
되며 Console·Telegram의 공개 상태가 달라서도 안 된다.

사용자 답은 결과 중심으로 모델이 작성한다. `결과 → 근거 → 미확인 → 다음 행동`은 가능한 정보 순서이지
고정 답변 템플릿이 아니다.

완료 문장:

> T5는 실패와 불확실성을 해석해 적절한 방법으로 전환하고 사용자가 바로 활용할 결과를 일머리 있게 전달한다.

### S4-J — Experience-Based Growth

실제 settled Work와 사용자 교정에서만 재사용 후보를 만든다. 반례·near miss·작은 trial·동일 목적 A/B·사용자
확인·승격·회귀 rollback을 거친다. 회사 용어·결과 형식·자료 위치·중요 기준·허용 자율성·예외·효과가 좋았던
방법을 source와 함께 다룬다.

기존 Reflection·Principle·Learning 연구 코드는 교재다. product entry로 import하지 않고 현재 실패에서 필요한
계약만 가장 작게 다시 연결한다. 사용자 persona, 출처 없는 추론, 자동 Core 수정은 없다.

완료 문장:

> T5는 실제 협업 증거를 바탕으로 더 적은 설명과 교정으로 일하고 성과가 떨어진 방법은 되돌린다.

### S4-K — Capability Reality & Acquisition

Experience Growth와 분리해 마지막에 연다.

```text
정확한 능력 gap
→ 현재 대안 확인
→ 후보 발견
→ 출처·version·digest·권한·비용 관측
→ 격리 inactive 준비
→ 작은 positive control
→ 원래 Work 재개
→ 실제 효과 검증
→ 재사용·update·rollback·remove
```

Skill·Plugin·CLI·MCP는 출발점이 아니라 결과물이다. 기존 CA research 모듈을 통째로 복원하지 않는다. branch·
tag·credential URL·임의 lifecycle hook·검증되지 않은 package는 제품 능력이 아니다. 네 사용자 경계는
비밀값 입력, 백업 없는 파괴, 새 상대 첫 외부 전송, 돈이 나가는 일로 유지한다.

실행 Capability는 필요할 때 engine·model 후보별 identity, version, 입력 형식·크기·길이, 언어, 품질 증거,
비용, 처리시간, local/external, privacy scope, runtime requirement, result format, fallback을 관측한다. 사용자는
로컬 우선·비용 우선·품질 우선·특정 공급자·민감자료 외부 전송 금지 정책을 자연어로 정할 수 있다. STT는
이 계약의 positive control일 수 있지만 `회의록이면 특정 API` 같은 업무 Router나 성공한 전사 재실행은 없다.

S4-C carry-forward로 동일 도구면의 모델별 Hand 선택, portable command, shallow observation 해석, 목적 정확성,
wall·calls·tokens를 Capability Reality 후보 사실에 포함한다. 이 사실은 업무 Router나 모델 강제 선택이 아니다.

완료 문장:

> T5는 현재 손이 부족한 이유를 정확히 알고 기존 대안이 없을 때만 검증된 능력을 안전하게 갖춰 원래 목적을 재개한다.

### S4-UX — Interaction Continuity & Human Reassurance

S4-B~K가 만든 머리·손·복구 현실을 새 원장이나 모델의 진행 서술 없이 현재 Work·Run·Tool·Effect·Delivery
사건에서 사용자 언어로 투영한다. 이미 선 canonical Work reality, milestone, 경과시간, 교정·중지, 재접속 복원,
Telegram 진행, Artifact·Effect·Delivery 영수증을 재사용한다.

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

Windows는 마지막에 처음 고려하지 않는다. S4-B~K의 공통 계약마다 Windows adapter 의미와 반대시험을 함께
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
- 현재 연결되지 않은 자원의 gap과 최소 대안을 확인하고 필요한 능력만 갖추기
- target 밖 write·secret·외부 전송·결제·late child effect를 차단하기
- 여러 턴의 월·권역 기록과 교정, 신청자 원본과 제출 양식을 결합해 권역별 Excel 6개를 만든 뒤 ZIP의
  18행·source-key join·필수값 coverage·시트·금액·내부 파일 0을 독립 검증하기
- 장시간 한국어 오디오를 적합한 STT engine으로 전사하고 요약·실행 과제·전체 원문 Artifact를 분리해
  Notion에 반영·재개방하며 비용·시간·privacy·첨부 미지원 범위를 보존하기

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
- Prompt 전면 재작성, UI 전면 재설계
- 모든 변경 자동 rollback, 모든 shell effect의 과장된 완전 confinement
- Runtime 규칙으로 모델의 목적·관계·완료 의미 선택
- 실제 사용자 HOME·계정·자격증명·외부 상대를 이용한 자동 시험

## 10. 현재 다음 한 작업

S4-C 미달은 S4-K와 S4-HQ에 이월했다. S4-D2·D3·D4A·D4B·D5는 닫혔다. 현재 다음 한 작업은 parser나 Store를
교체하지 않고 이미 소비가 끝난 command explanation 참조만 registry start 전에 해제하는 S4-D5A다. 같은
대출력 AB/BA에서 exact hash·pipeline·권한·짧은 명령을 보존하고 RSS를 다시 측정하기 전 S4-D와 S4-E를 닫지 않는다.
