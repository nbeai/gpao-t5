# T5 Fourth Completion — Android Work Intelligence

상태: `FOURTH_COMPLETION_ACTIVE · S4_0_COMPLETE · S4_A_BASELINE_ACTIVE · PRODUCT_CODE_LOCKED`
현재 Gate: `S4-A SINGLE SOURCE · MINIMUM FAILURE BASELINE`
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
2. **현재 Gate**: S4-A 단일 정본·최소 실패 기준선. 제품 코드는 잠겨 있다.
3. **사용자 완료 문장**: 3차 Cleanroom 제품의 실제 강점·비용·미달이 같은 사용자 목적에서 고정되어 최초
   결함 가족 하나만 근거 있게 S4-B로 열린다.
4. **이미 선 실제 증거**: `t5-0.3.1-clean-baseline`, 전체 제품 CI, 16개 사업 인간 시나리오, Terminal Core,
   File Reality·reconciliation, Resource Situation, Work·Memory·Recovery, 격리 위험 경계가 있다.
5. **현재 가장 큰 미달**: 4차 제안의 항목과 현재 제품의 실제 차이가 아직 한 clean-head 비교 기준으로
   정산되지 않았고, S4-B Purpose & Done 결함도 현재 source에서 재현되지 않았다.
6. **이번 변경 방식**: 기존 증거에서 일곱 최소 축을 고르고 제품 무변경 positive control과 candidate failure를
   분리한 뒤, 현재 source에서 재현된 최초 결함만 반대시험으로 고정한다.
7. **Non-goals**: Prompt 변경, 제품 source 변경, 새 Store, UI 변경, 새 index, Terminal 재작성, Reflection·
   Principle·Capability research import, 실제 개인 자료·계정·외부 효과 시험.

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

### S4-A — 단일 정본·최소 실패 기준선 — ACTIVE

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

### S4-B — Purpose & Done Intelligence

현재 Work와 Conversation·Receipt를 사용해 모델이 목적, 결과 사용처, 원하는 결과 또는 실제 상태, 명시 범위,
주어진 자료, 필요한 완료 증거, 중요한 미확인, 허용된 외부 효과를 작게 보게 한다. 값은 absent·unknown을
허용하며 결과 사용처를 매번 질문하거나 새 고정 업무양식으로 만들지 않는다. 새 Store와 Intent enum은 없다.

반대시험: 산출물만 만들고 사용 목적 미달, 부분 자료를 전체로 오인, 교정 전 목적 지속, 사용자 결정을 임의
확정, 다음 행동 약속 후 미실행, 파일 생성과 목적 완료 합치기.

범용 close: 최초 실패 분야 외 직원 계약·거래처 미입금·개인 파일 등 서로 다른 두 분야에서 같은 목적/완료
원리가 추가 전용 규칙 없이 성립한다.

완료 문장:

> T5는 처음 보는 업무도 기능명으로 분류하지 않고 사용자가 실제로 얻으려는 결과와 완료 증거를 이해한다.

### S4-C — Situation·Hand의 실제 차이 수리

현재 목적에 관련된 Conversation·Memory·Work·file·connection·Capability pointer를 후보화하고 모델이 선택한
Evidence만 exact reopen한다. 기존 Information Control·Resource Situation·tool search를 우선 사용한다.

새 index·OCR cache·relationship map은 현재 목적 A/B에서 실제 반복 읽기나 누락이 재현될 때만 연다. 관계는
source pointer·revision·candidate·conflict로만 보존하고 사람·회사·상품·계약의 영구 truth를 만들지 않는다.

완료 문장:

> T5는 현재 가진 자료·기억·연결·능력과 부족한 사실을 빠르게 파악하고 가장 적합한 손으로 필요한 원문만 본다.

### S4-D — Terminal 실행 중 output·process 미달

기존 Terminal Core 위에 필요한 차이만 연결한다.

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

완료 문장:

> T5는 처음 보는 업무에 필요한 작은 도구를 작성·시험·실행하고 독립 검증해 기존 손의 한계를 넘는다.

### S4-H — 범용 Reconciliation 확장

기존 `bind_sources`·source manifest·document reopen 위에서 실제 실패만 넓힌다. 서로 다른 자료의 대상 후보,
field mapping, 중복·누락·충돌, 날짜·수량·금액, partial coverage, 원본 행·셀·페이지 lineage, 결과 재계산과
사용처 형식을 분리한다.

재고·계약·미수금 실패의 공통 원인이 같은 대상·시간·상태 연결일 때 하나의 source-backed reconciliation
원리를 고친다. 세 전용 기능을 만들지 않고 ambiguous identity를 자동 merge하지 않는다.

완료 문장:

> T5는 업무 분야와 무관하게 여러 자료를 연결·비교·대사하고 사실·누락·상충·불확실성을 분리한 결과를 만든다.

### S4-I — Adaptation·Recovery

방법 실패와 목적 실패를 분리하고 성공한 Evidence·부분 결과·effect를 보존한다. 아직 시도하지 않은 Hand,
대체 비용과 위험, 사용자에게 물을 사실과 T5가 더 관측할 사실, exact resume를 모델에 공급한다. update·crash·
cancel 뒤 blind retry와 orphan process를 막는다.

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

반대시험:

- 같은 현재 상태가 둘 이상의 가시 표면에 중복된다.
- 실제 새 Evidence·output·effect 없이 진행 문구만 바뀐다.
- model 시작·heartbeat·poll을 사용자 업무 진전으로 승격한다.
- 사용자 행동이 필요한데 계속 진행 중으로 보이거나, 교정 접수 뒤 실제 Work가 바뀌지 않는다.
- 짧은 요청에 불필요한 상태가 누적되거나 긴 요청이 일반 문구 하나로 장시간 정지한다.
- 재접속·Console·Telegram이 서로 다른 현재 단계·남은 일·terminal 결과를 보인다.

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

제품 source 변경은 아직 0이다. 다음 한 작업은 S4-A 기존 증거 재사용 감사를 기계적으로 고정하고, clean-head
positive control을 실행한 뒤 `KHB-A01` 계열의 목적/결과 범위 미달을 현재 모델에서 한 번 재현할지 확인하는
것이다. 재현되지 않으면 고치지 않고 다음 candidate로 이동한다. 재현되면 실제 prompt dump와 같은 결함 가족
세 분야 close 조건을 먼저 작성한 뒤 S4-B의 가장 작은 구현만 연다.
