# T5 NX-2 — Generalized Mastery 개발 정본

상태: `OWNER_CURRENT_NX2_EXECUTION_SOURCE · NX_1_COMPLETE · NX2_0_COMPLETE · NX2_1_CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT · NX2_2_CONTEXT_DIET_CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION · NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT · NX2_SE_COMPLETE · NX2_4_AU0_COMPLETE · NX2_4_AU1_SOURCE_COMPLETE · NX2_4_AU2_COMPLETE · NX2_4_AU3_COMPLETE · NX2_4_AU4_COMPLETE · NX2_4_AUDITORY_COMPLETE_MACOS · NX2_4_WINDOWS_PHYSICAL_DEFERRED_NOT_WAIVED · NX2_5_WC0_TO_WC4_COMPLETE · NX2_5_WC_HQ_CLOSED_WITH_CROSS_HAND_ECONOMY_OBSERVATION · NX2_6_NV0_COMPLETE · NX2_6_NV1_COMPLETE · NX2_6_NV1R_COMPLETE · NX2_6_NV2_COMPLETE · NX2_6_NV3_CURRENT`

제품 기준 HEAD: `129b1db4` — model-selected bounded batch observation 자격

NX-1 완료 HEAD: `ad3e685c`

현재 제품 Gate: `NX2-6 NV-3 — Mail Read`

---

## 0. 이 문서의 권위와 사용법

이 문서는 연구실에 남아 있는 비GUI 연구를 NX-2의 단일 실행선으로 통합한 개발 정본이다.

- `T5-NX.md`가 제품 세대와 현재 Gate의 최상위 정본이다.
- NX-1은 완료됐으며 NX-2가 CURRENT다.
- 이 문서의 Gate를 한 번에 하나만 연다.
- 각 전문 연구 문서는 상세 기술·외부 근거·반대시험의 source library다.
- 전문 연구와 이 문서가 충돌하면 이 문서의 순서·범위가 우선하고, `T5-NX.md`와 충돌하면 `T5-NX.md`가 우선한다.
- 한 Gate의 완료는 코드·검사 수가 아니라 실제 사용자 목적의 속도·정확성·결과 품질·인간 체감으로 판정한다.

NX-1 완료 능력은 NX-2의 귀환선이다. NX-2 후보가 실패해도 NX-1 제품 경계를 바꾸거나 약화해 성공으로 꾸미지 않는다.

---

## 1. 범위 전수 판정

### 1.1 NX-2에서 제외하는 연구

| 연구·기능 | 제외 이유 | 처리 |
|---|---|---|
| 범용 Computer Use·좌표 클릭·데스크톱 앱 조작 | 사용자가 명시적으로 GUI를 제외했고 별도 위험·물리 자격이 필요 | 독립 미래 Gate 유지 |
| Console 시각 재설계·말풍선·대화 목록 디자인 | 6차 UX 제품선에서 이미 다룸 | 회귀만 확인 |
| Document Reality·혼합 문서 Scout | NX-1의 Reality Closure와 Evidence Atom에 흡수 | 재개발 금지 |
| Method Runtime·Integral Method 기본 계약 | NX-1의 Method·orchestration에 흡수 | 같은 계약 재사용 |
| ClaimEvidence·Evidence Atom·Human Closure 기본 구조 | NX-1에서 현재 자격 중 | NX-2는 일반화만 수행 |
| 기본 실시간 streaming·Tool economy·Context receipt 측정 | 5·6차와 PERF-0에서 완료 | 측정 기반으로 재사용 |
| 패키지·공증·Windows 물리 자격 | 기능 일반화와 별도 release/platform 경계 | NX-2 완료 주장과 분리 |

여기서 “GUI 제외”는 기존 T5 Browser Hand까지 제거한다는 뜻이 아니다. 공식 API가 없고 브라우저 화면만이 실제
경로인 네이버 블로그처럼, 이미 자격된 Browser Hand를 사용하는 실무 능력은 NX-2에 포함한다. 새 좌표 기반
Computer Hand나 두 번째 브라우저 현실은 만들지 않는다.

### 1.2 NX-2에 남은 연구

| 연구 source | NX-2에서 맡는 역할 |
|---|---|
| `T5-NX.md`의 Mastery Generalization | NX-1의 한 목적 성공을 서로 다른 업무와 lane으로 일반화 |
| `T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH.md` | 지시·Tool·Skill·Memory·Evidence의 소유권과 progressive disclosure 정리 |
| `T5-COGNITIVE-FLOW-RESEARCH.md` | 표현 격차·비례 깊이·Tool/질문 편향·교정·자연스러운 중단 자격 |
| `T5-PRACTICAL-JUDGMENT-RESEARCH.md` | 실천지능이 사용자 역량을 보완하되 획일화하지 않는 holdout |
| `T5-COGNITIVE-FLOW-HQ-RESEARCH.md` | 상태 의존·정보 부족·교정·복구·다양성·장기 관계의 인간 HQ |
| `T5-SELECTION-SIDE-EXPLORATION-RESEARCH.md` | exact 선택 문맥을 read-only로 탐색하고 명시적 apply만 Work revision으로 승격 |
| `T5-AUDITORY-INTELLIGENCE-WHISPER-RESEARCH.md` | exact source·coverage를 가진 교차 플랫폼 청각기관 |
| Web Intelligence Collector 실제 자격선 | 공개 웹 수집·구조화·coverage·재사용을 기존 Web/Browser 위에 결속 |
| `T5-NAVER-IDENTITY-MAIL-BLOG-CAPABILITY-RESEARCH.md` | 한국 자영업자 핵심 계정·메일·블로그 실무 능력 |
| 기존 Experience·Skill·Principle 기반 | 실제로 이긴 방법만 가역적으로 승격하고 변화 시 폐기 |

---

## 2. NX-2의 한 문장

> T5는 NX-1에서 증명한 현실 결속·방법 실행·이중 완료를 특정 정산 업무의 기능으로 남기지 않고, 사용자가 어떤
> 말로 어떤 현실 업무를 맡기더라도 필요한 Context와 감각과 수단만 열어 더 빠르고 정확하며 더 좋은 결과를 만드는
> 범용 숙련으로 확장한다.

사용자 체감으로 번역하면 다음과 같다.

- 전문가처럼 지시하지 않아도 핵심 목적을 놓치지 않는다.
- 단순 질문은 여전히 즉시 답하고, 무거운 Method를 열지 않는다.
- 자료가 많을 때는 필요한 현실을 묶어 한 번에 처리하고 근거와 중요한 값이 빠지지 않는다.
- 녹음·영상도 파일처럼 정확히 듣고 필요한 문서·자막·후속 업무로 연결한다.
- 공개 웹과 네이버 메일·블로그를 서로 다른 임시 자동화가 아니라 T5의 기존 소유권·권한·취소·복구 안에서 다룬다.
- 실제로 더 나았던 방법만 다음 업무에 재사용하며, 현재 상황과 충돌하면 즉시 비활성화한다.

---

## 3. 제품 성과 함수

NX-2의 후보는 아래 네 축을 동시에 기록한다.

```text
제품 가치 = 목적 성공과 정확성
          × 결과의 인간적·전략적·기술적·미적 사용성
          × 속도·호출·tokens·bytes의 경제성
          × 교정·취소·재시작·복구 뒤의 신뢰성
```

한 축을 0으로 만들고 다른 축으로 상쇄하지 않는다.

### 3.1 Speed

- Enter→첫 acknowledgement
- Enter→첫 유용한 결과
- 최종 완료 wall
- model·Tool round 수
- provider input/output tokens
- request·Tool schema·Receipt bytes
- Tool 종료→다음 model 시작 간격
- 이미 검증한 방법의 warm reuse 이익

### 3.2 Accuracy

- exact source identity·revision·digest
- coverage·freshness·unknown
- 관계·계산·Evidence Atom 검산
- 사용자 현재 교정 우선
- 외부 effect 실제 영수증
- 사실·추론·제안의 분리
- 누락과 정상 항목을 사용 목적에 맞게 표현

### 3.3 Result Quality

- 목적·청중·사용처에 맞는 정보 구조
- 중요한 값·결론·예외의 우선순위
- 편집 가능한 실제 Artifact
- 숫자·표·문서·자막의 완전성
- 다음 행동의 현실성
- 디자인이 필요한 결과의 hierarchy·spacing·typography·contrast·render 품질

### 3.4 Human Experience

- 일반 사용자식 표현과 전문가식 표현의 목적 성공 격차
- 불필요한 질문·승인·재확인 수
- 진행 공백과 과잉 상태 설명
- 교정 수용 시간과 잘못된 과거 방향 잔존 여부
- Stop·restart·Undo
- 설명 없이 실제 결과를 찾고 쓰는 데 걸리는 시간
- 다시 맡길 의향

---

## 4. NX-2 공통 구조

NX-2는 새 거대 Engine을 만들지 않는다. 현재 T5 기관의 결속을 다음 구조로 일반화한다.

```text
사용자 현재 입력
→ Work Admission / Direct 비개입
→ 필요한 Context·Capability만 발견
→ 현재 Reality·source universe 결속
→ NX-1 Integral Method 또는 기존 단일 Hand 선택
→ 독립 Reality Closure
→ 목적·청중·형식에 맞는 Human Closure
→ Artifact·Effect·Delivery
→ 교정·Stop·restart·Undo
→ 실제 비교에서 이긴 방법만 Experience 후보
```

### 4.1 모델이 소유할 것

- 무엇이 본질이고 중요한가
- 어느 현실을 더 봐야 하는가
- 단일 Hand와 Integral Method 중 무엇이 경제적인가
- 어떤 값·근거·예외를 사용자에게 보여줄 것인가
- 어떤 문서·프로그램·후속 행동이 목적에 맞는가
- 충분히 끝났는가

### 4.2 Runtime이 소유할 것

- 현재 Work·revision·authority
- source identity·coverage·freshness
- Tool·process·Browser·protocol의 실제 실행
- Evidence Atom·계산·effect·Artifact 영수증
- Context·Tool surface의 소유권과 bytes
- 중복 방지·취소·재시작 정산·Undo
- Experience 후보의 provenance·자격·비활성화

### 4.3 Runtime이 하지 않을 것

- 업종별 Intent Router
- “매출이면 이 필드” 같은 업무별 중요도 규칙
- 사용자 문장을 정규식으로 의미 분류
- 최종 답 사후 삭제·고정 문구 덧붙이기
- 모델별 별도 제품 workflow
- 현재 증거 없이 과거 성공 방법 강제

---

## 5. Gate 지도

```text
NX2-0  NX-1 귀환선·연구 inventory 봉인 — COMPLETE
  ↓
NX2-1  Integral Mastery 업무·lane 일반화 — CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT
  ↓
NX2-2  Context Diet & Interface Intelligence — CURRENT
  ↓
NX2-3  Cognitive Flow·Practical Judgment 자격
  ↓
NX2-SE Selection-Scoped Side Exploration — COMPLETE
  ↓
NX2-4  Auditory Intelligence
  ↓
NX2-5  Web Intelligence Collector
  ↓
NX2-6  Naver Identity·Mail·Blog
  ↓
NX2-7  Experience Promotion
  ↓
NX2-HQ Competitive Whole Human Qualification
  ↓
NX2-PS T5 Presentation Studio — LAST PLANNED PRODUCT GATE
```

각 Gate는 이전 Gate가 닫힌 exact HEAD에서만 시작한다. 독립 연구라는 이유로 병렬 제품 개발하지 않는다. read-only
조사와 fixture 준비만 병렬화할 수 있다.

### 5.1 현재 `T5-NX.md` 세부 Gate와의 결속

현재 최상위 정본의 NX-2A~D는 이 문서의 `NX2-1 Integral Mastery Generalization` 내부 단계다. 별도 개발선이 아니다.

| 현재 `T5-NX.md` 단계 | 이 문서의 위치 | 상태 |
|---|---|---|
| NX-2A Evidence Reuse & Exact-Head Baseline | NX2-0 종료 증거·NX2-1 baseline | COMPLETE |
| NX-2B metadata-only Reality Scout 두 후보 | NX2-1 source selection 부정 증거 | CLOSED_REJECTED |
| NX-2B2 model-selected bounded batch | NX2-1 qualification 관측·부정 증거 | PRODUCT_CANDIDATE_REJECTED |
| NX-2C Existing Path Common Observer Delta | NX2-1 기존 경로의 실제 공통 미달 | CLOSED_NO_COMMON_DELTA |
| NX-2C0 First-Turn Reality Affordance Audit | NX2-1 model/provider 선택 한계 | CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT |
| NX-2D Five-Lane Proportionality | NX2-1 일반화·무회귀 자격 | NOT_OPEN |

NX2-1 역사·종료 순서:

```text
NX2-1C 기존 file_reality → bind_sources → integral_method actual trace
→ 서로 다른 두 목적의 동일 observer gap만 기존 경계에서 최소 보강
→ 매출·미수금·재고·계약 공통 자격
→ NX2-1D Direct·Single·Multi-source·Artifact·Program five-lane
→ NX2-1 closeout
```

현재 이후 고정 순서:

```text
NX2-2 Context Diet & Interface Intelligence — CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION
→ NX2-3 Cognitive Flow & Practical Judgment
→ NX2-SE Selection-Scoped Side Exploration
→ NX2-4 Auditory Intelligence
→ NX2-5 Web Intelligence Collector
→ NX2-6 Naver Identity·Mail·Blog
→ NX2-7 Experience Promotion
→ NX2-HQ Competitive Whole Human Qualification
→ NX2-PS T5 Presentation Studio
```

NX2-1은 모델/provider 선택 한계로 정직하게 봉인했고 미달을 NX2-3·NX2-HQ·향후 model qualification에 이월했다.
NX2-2 이후 기능으로 그 실패를 성공처럼 덮지 않는다. 현재 계획에 없는 새 Gate를 임의로 끼워 넣지 않는다.

별도 selection Tool·selection model call·selection→Reality→Human 3-model pipeline은 NX2-1의 제품 구조가 아니다.
`129b1db4`의 model-selected batch는 qualification 관측으로만 보존하며, 현재 자연 경로의 실제 공통 observer gap이
증명되기 전에는 CSV Evidence Atom·새 parser·새 Tool을 열지 않는다.

---

## 6. NX2-0 — NX-1 Closeout & Generalization Inventory — COMPLETE

### 사용자 완료 문장

> NX-1에서 실제로 좋아진 능력과 아직 해결하지 못한 한계가 분리돼 있어, 다음 개발이 성공을 다시 만들거나 실패를
> 다른 기능으로 덮지 않는다.

### 개발 작업

1. NX-1 최종 제품 후보 commit·source·Prompt·Store·Tool contract를 봉인한다.
2. 현재 제품·NX-1 candidate·폐기 후보의 실제 차이를 기계 manifest로 만든다.
3. Reality Closure·Human Closure·Evidence Atom·Method invocation의 단일 public contract를 확정한다.
4. NX-2가 재사용할 수 있는 경계와 qualification-only helper를 분리한다.
5. 구매·계약·비용의 blind 인간 평가와 AB/BA 결과를 고정한다.
6. Direct·Single Hand 비개입 baseline을 다시 기록하되 기존 현재 증거를 우선 재사용한다.

### RED 반대시험

- NX-1 contract를 우회한 새 Method가 성공으로 기록됨
- qualification helper가 설치 payload로 들어감
- Evidence source가 바뀌었는데 과거 Closure가 재사용됨
- NX-1 미완료 상태에서 NX2-1 제품 source가 변경됨

### 완료 조건

- NX-1 제품 승격 또는 폐기 판정이 확정
- 재사용 contract의 단일 source of truth
- 제품·연구·자격 코드 경계 명시
- NX-2 product delta 0

### 실제 종료

- NX-1은 `ad3e685c`에서 제품·Console·CI까지 완료됐다.
- NX-2A는 같은 fixture를 current head에서 다시 실행해 과거 증거의 무비판적 이전을 막았다.
- NX-2B의 metadata-only 후보 두 개는 목적·경제성 실패로 제품 delta 0 폐기됐다.
- NX-2B2는 model-selected exact handles의 batch reopen mechanics를 관측했지만 제품 후보에서는 폐기했다.
- 현재 제품 변경 후보는 기존 `file_reality → bind_sources → integral_method`의 동일 observer gap이 두 목적에서
  재현될 때 NX2-1C 안에서만 열 수 있다.

### NX2-1C actual trace 종료 — 2026-09-01

- exact 일반 표현의 매출·미수금·재고는 모두 source 진입 전에 Tool 0으로 종료됐다.
- 전문가 표현에서는 같은 File Reality가 세 CSV source를 정확히 관측했고 미수금·재고는 strict PASS했다.
- 계약 일반 표현은 source 진입 뒤 두 revision의 핵심 변경을 찾았지만 전체 required source bind와 strict Closure가 없었다.
- 서로 다른 두 목적의 동일 post-entry observer fact 누락은 없었다. 따라서 기존 observer/Tool contract 제품 후보는 열지 않는다.
- 네 목적 strict 공통 자격은 0/4이며 NX2-1은 현재 head에서 완료되지 않았다. NX2-1D와 NX2-2 이후 Gate는 열지 않는다.

근거: `refoundation/evidence/nx2-existing-path-common-observer-trace-2026-09-01.json`.

### NX2-1C0 — First-Turn Reality Affordance Audit — CURRENT

제품 변경 0으로 일반·전문 표현의 첫 provider call을 비교한다.

1. `file_reality` schema 제공 여부·Tool contract bytes·순서·digest
2. Work admission 상태
3. runtimeContext의 workspace·attachment·현재 목적 사실
4. capability discovery visibility
5. 사용자 원문을 제외한 normalized wire 차이
6. 같은 affordance를 보았지만 모델 선택만 달라졌는지

배선 차이가 있으면 Work Admission·Context ownership·Tool visibility·capability projection 중 최초 한 경계만 후보화한다.
사용자 원문 외 wire가 같으면 별도 selection Tool·model·Router를 만들지 않고 기존 `file_reality` Tool contract의 목적 중심
affordance만 candidate A/B 한 번 허용한다. 업무 키워드·metadata score·global Prompt 증가는 0이어야 한다.

2026-09-01 paired audit에서 매출·미수금·재고의 일반/전문 첫 provider call은 Tool contract·instructions·runtime facts·
Work admission·사용자 원문 치환 normalized wire가 모두 같았다. 배선 결함은 없고 모델의 첫 선택 차이다. 첫 호출에는
`file_reality`가 deferred라 `tool_search`만 보이므로, 기존 `tool_search` description을 현재 컴퓨터 현실의 목적 중심
affordance로 교체하는 candidate A/B 한 번만 허용한다.

근거: `refoundation/evidence/nx2-first-turn-reality-affordance-audit-2026-09-01.json`.

단일 purpose-centered `tool_search` contract 후보는 미수금 source 진입만 회복했고 매출·재고는 실패했다. 미수금도
strict scope가 실패했다. 첫 세 목적 Gate가 실패했으므로 추가 문구·전문가/Direct 확대·두 번째 모델 실행 없이 폐기했다.
제품 source·Prompt·Tool surface delta는 0이며 NX2-1D와 후속 Gate를 열지 않는다.

근거: `refoundation/evidence/nx2-reality-affordance-contract-candidate-2026-09-01.json`.

오너는 gpt-5.5 일반 표현 source admission 한계를 현재 제품 현실로 수용했다. 추가 selection model·Router·업무 규칙·
Prompt patch 없이 NX2-1을 봉인하고, 미달은 NX2-3·NX2-HQ·향후 model qualification에 이월한다. 다음 현재 Gate는
NX2-2이며 `CX-0 Prompt Surface Inventory`부터 제품 변경 0으로 시작한다.

근거: `refoundation/evidence/nx2-1-owner-acceptance-and-context-diet-open-2026-09-01.json`.

---

## 7. NX2-1 — Integral Mastery Generalization — CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT

### 사용자 완료 문장

> T5는 특정 구매 대사만 잘하는 기능이 아니라, 매출·미수금·재고·계약과 서로 다른 일에서도 같은 원리로 핵심
> 차이와 중요한 값을 더 빠르고 정확하게 찾아 실제 결과로 만든다.

### 7.1 일반화 목적

| 목적 | 일반 사용자 표현 | 전문가 표현 | 핵심 Oracle |
|---|---|---|---|
| 매출 변동·기여도 | “이번 달 매출이 왜 줄었는지 봐줘.” | “전월 대비 변동과 거래처·상품 기여도를 분석해줘.” | 전체 변화·주요 기여·coverage |
| 미수금·입금 대사 | “아직 돈 안 들어온 곳 정리해줘.” | “청구·입금 대사와 연체 건을 정리해줘.” | invoice identity·금액·기한·부분입금 |
| 재고·입출고 차이 | “재고가 안 맞는데 원인 찾아줘.” | “장부·입출고·실사 차이를 대사해줘.” | 수량·단위·시점·movement relation |
| 계약 revision | “바뀐 계약 내용만 알려줘.” | “두 revision의 material change를 비교해줘.” | 조항·금액·기간·책임·누락 |

### 7.2 공통 contract

- 입력은 exact source handles와 manifest 전체다.
- 관계는 모델이 선언하고 Runtime은 source·값·계산을 검산한다.
- `evidenceValues`는 정확성용 전체 사실이다.
- presentation 선택은 Human Closure가 현재 목적·청중·사용처로 수행한다.
- Runtime은 업무별 필수값 목록을 갖지 않는다.
- 정상 항목·제외 근거는 Receipt에 남되 사용자 범위에 필요할 때만 답에 포함한다.
- 같은 목적을 다시 수행하면 stale source를 재검사한다.

### 7.3 다섯 lane 자격

| lane | 목적 | 합격 핵심 |
|---|---|---|
| Direct | 의견·설명·아이디어 | Work·Method·Tool 0, TTFT 무회귀 |
| Single Reality | 날씨·한 파일·한 URL | 한 Hand, 불필요한 Method 0 |
| Multi-source Work | 대사·비교·원인 | Reality/Human Closure 모두 PASS |
| Crafted Artifact | 대표용 보고·표·문서 | 내용·숫자·render·편집성 PASS |
| Program/Project | 업무 도구·웹앱 | 실제 사용·test·Browser QA·Undo PASS |

### 7.4 구현 순서

1. 네 목적의 비식별 fixture·hidden oracle을 준비한다.
2. 현재 제품 baseline을 필요한 차이만 재측정한다.
3. NX-1 contract를 변경하지 않고 qualification adapter만 연결한다.
4. 목적별 deterministic Reality Closure를 통과시킨다.
5. 동일 모델 AB/BA와 모델 순서 반전을 실행한다.
6. 표현쌍·source 순서·불필요 파일·stale revision perturbation을 실행한다.
7. 한 목적의 우위를 다른 목적의 성공으로 간주하지 않는다.
8. 네 목적에서 공통으로 필요한 최소 product integration만 채택한다.

### 7.5 합격식

```text
네 목적 모두 purpose PASS
AND source·coverage·calculation truth 무회귀
AND 일반/전문 표현 success gap이 허용선 이내
AND Direct·Single Reality 개입 0
AND candidate 중앙 wall·round·tokens 중 둘 이상 개선
AND 악화 지표가 측정되고 사용자 이익으로 설명됨
AND 업무별 schema·Router·Prompt fork 0
```

### 중단선

- 세 번째 업무별 field·operator를 추가하려 함
- Human Closure 실패를 regex로 고치려 함
- 한 모델만 통과시키기 위한 별도 Prompt가 필요함
- 여러 업무에서 현재 제품보다 느리거나 불완전함

---

## 8. NX2-2 — Context Diet & Interface Intelligence — CURRENT

상세 정본: `T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH.md`

### 사용자 완료 문장

> T5는 단순한 요청에는 작고 빠르게 반응하고, 복잡한 일에는 필요한 지시·도구·기억·근거만 정확히 열어 같은
> 모델로도 더 적은 왕복과 Context에서 더 좋은 결과를 낸다.

### 8.1 왜 NX2-1 뒤에 하는가

NX-1과 NX2-1에서 실제로 사용하는 contract가 안정되기 전에 Prompt와 Tool schema를 줄이면 필요한 정보까지 삭제할 수
있다. 먼저 성공 방법을 확정하고, 그 다음 중복·소유권 drift·불필요 상시 Context를 제거한다.

### 8.2 개발 Gate

#### CX-0 — Prompt Surface Inventory

- global instruction·runtimeContext·Tool description·Skill·Memory·Evidence·Receipt를 byte 단위로 inventory한다.
- 각 문장을 incident·owner·countertest와 결속한다.
- 이미 있는 PERF-0·CJ0·NX 원장을 재사용하고 달라진 축만 측정한다.

#### CX-1 — Instruction Family Provenance

각 지시를 다음으로 분류한다.

- Product invariant
- Runtime-enforced duplicate
- Tool-local guidance
- dated model workaround
- actual incident guard
- interaction taste

근거 없는 삭제도 금지하고, Runtime이 이미 보장하는 불변식을 Prompt가 반복하는 것도 금지한다.

#### CX-2 — Tool Contract SSOT Pilot

- validator와 Tool schema를 같은 상수·정의에서 생성한다.
- NX-1 pilot에서 드러난 enum·nested schema drift를 구조적으로 제거한다.
- Tool 이름·설명·argument·result contract의 digest를 검사한다.
- 첫 pilot은 한 Tool family에서만 수행한다.

#### CX-3 — Instruction Ownership Migration

- Tool 사용법은 Tool-local로 이동한다.
- 현재 Work·authority·evidence는 runtimeContext로 이동한다.
- 제품 철학·답 저작권·안전 불변식만 최소 global kernel에 남긴다.
- 문장 이동마다 기존 incident countertest를 통과시킨다.

#### CX-4 — Progressive Disclosure Refinement

```text
L0 최소 공통 Context
→ L1 capability 발견
→ L2 exact source·contract reopen
→ L3 bounded execution
→ L4 Human Closure canonical epoch
```

- Direct는 L0에서 끝난다.
- capability directory는 가능성만 보여주고 전체 schema를 상시 주입하지 않는다.
- Human Closure에는 verified core와 필요한 presentation facts만 공급한다.
- 같은 provider session의 reasoning continuity와 cache를 provider별 AB로 보존한다.

#### CX-5 — Multi-model Qualification

- 같은 contract를 최소 두 모델에 제공한다.
- 모델별 Prompt·Tool fork는 만들지 않는다.
- 차이는 성능·선택 품질 관측으로 기록한다.

#### CX-6 / CX-HQ — Product & Human Qualification

- Direct·Single·Multi-source·Browser·Crafted Artifact를 실제 Console에서 자격한다.
- TTFT·first useful·final wall·calls·tokens·request bytes를 비교한다.
- Context 감소가 결과 정확성·자연스러운 언어·교정 수용을 떨어뜨리면 폐기한다.

### 완료 조건

- instruction family 전부 owner·incident·probe 결속
- Tool schema/validator drift 0
- Direct TTFT와 Single Hand final wall 개선
- NX2-1 정확성·품질 무회귀
- 장기 대화·기억·교정 무회귀
- Prompt 줄 수 자체를 성과로 보고하지 않음

---

## 9. NX2-3 — Cognitive Flow & Practical Judgment Qualification

상세 정본:

- `T5-COGNITIVE-FLOW-RESEARCH.md`
- `T5-PRACTICAL-JUDGMENT-RESEARCH.md`
- `T5-COGNITIVE-FLOW-HQ-RESEARCH.md`

### 사용자 완료 문장

> 사용자가 전문가처럼 말하지 않아도 T5가 상황과 목적에 맞는 깊이·방법·질문·중단을 선택하고, 사용자의 현재
> 교정과 결정권을 지키면서 자연스럽게 일을 끝낸다.

### 9.1 이것은 새 판단 Engine이 아니다

새 `Practical Lens`, Intent enum, 고정 상담 단계, 오너 말투, 질문 checklist를 제품에 넣지 않는다. NX2-1·2가 만든
사고 환경이 실제 사용자 표현에서 잘 작동하는지를 자격하고, 실패가 특정된 기존 경계만 수리한다.

### 9.2 필수 Mission family

| ID | 인간 상황 | 확인할 것 |
|---|---|---|
| CFH-00 | 인사·의견·글 정리 | Direct 비개입·빠른 streaming |
| CFH-01 | 꼭 필요한 정보 하나가 빠짐 | 최소 질문 1회 또는 안전한 진행 |
| CFH-02 | 현재 자료로 불가능 | 정직한 unknown·가짜 완료 0 |
| CFH-03 | 선행 상태가 필요한 일 | 상태 관측 후 적절한 행동 |
| CFH-04 | 일반 표현 vs 전문가 표현 | 목적·핵심 결과 격차 축소 |
| CFH-05 | 여러 유효 방법 | 가장 경제적인 충분한 방법 |
| CFH-06 | 사용자가 중간 교정 | R+1 방향 전환·과거 방향 잔존 0 |
| CFH-07 | 사용자가 직접 파일·상태 변경 | dual-control 재관측 |
| CFH-08 | Tool 실패·ACK unknown | blind retry 0·안전 복구 |
| CFH-09 | 충분/불충분 결과 | 자연스러운 중단·필요한 지속 |
| CFH-10 | 검증된 과거 방법·현재 변화 | 재사용 또는 즉시 폐기 |
| CFH-11 | 중요 결정 | 적절한 의존·사용자 결정권 |
| CFH-12 | 열린 문제 | 관점 다양성·획일화 방지 |
| CFH-13 | 장기 관계·현재 교정 | current user 우선 |

### 9.3 표현 변형

각 목적은 최소 다음 표현으로 시험한다.

- 짧고 모호한 일반 표현
- 구어체·오타·생략
- 전문가식 구조화 표현
- 결과 형식만 강조한 표현
- 중간 교정과 취소

문장 일치로 정답을 만들지 않는다. 목적 invariant와 실제 end-state를 동일하게 둔다.

### 9.4 합격식

```text
end-state 정확성 무회귀
AND 일반/전문 표현 purpose gap 축소
AND 질문·Tool·검증이 목적 깊이에 비례
AND 현재 교정 우선
AND collateral effect 0
AND Direct·열린 문제의 다양성 무회귀
AND 사용자 결정권 보존
```

### 중단선

- 같은 문구를 전역 Prompt에 세 번째 추가
- 모델 의미 판단을 Runtime 규칙으로 옮김
- 모든 업무에 상시 컨설팅 태도 발생
- 단순 요청이 느려지거나 답이 딱딱해짐
- 여러 유효 답이 하나의 오너식 결론으로 수렴

---

## 9.5 NX2-SE — Selection-Scoped Side Exploration

상세 정본: `T5-SELECTION-SIDE-EXPLORATION-RESEARCH.md`

### 사용자 완료 문장

> 사용자는 T5의 긴 답에서 궁금한 부분만 선택해 원 대화와 현재 작업을 바꾸지 않고 같은 T5와 옆에서 더 깊게
> 탐색한다. 탐색 결과 중 실제로 적용할 내용만 명시적으로 선택해 현재 Work 교정 또는 출처가 보존된 새 Work로
> 연결하고, 적용하지 않은 가지는 이후의 기억·판단·실행에 섞이지 않는다.

### 왜 NX2-3 뒤인가

이 기능은 텍스트 선택 UI보다 Context isolation·현재 교정·Work revision·사용자 주체성이 핵심이다. NX2-3에서
Cognitive Flow와 Practical Judgment 경계를 먼저 자격한 뒤 그 흐름을 사용자 주도 side branch로 연다. 반대로 Auditory·
Web·Naver보다 먼저 Conversation·Work의 분기·반영 계약을 닫아 이후 감각·외부 작업도 같은 explicit apply 의미를
재사용할 수 있게 한다.

### 공통 구조

```text
canonical Conversation message
→ immutable exact SelectionAnchor
→ same-T5 read-only side projection
→ side turn·progress·Stop·reconnect
→ explicit Apply
→ active R+1 / paused resume / completed derived Work
→ 기존 execution·Artifact·Effect·Undo·Delivery
```

### 개발 Gate

#### SE-0 — Current-head Product Delta 0 Baseline

- current NX Conversation·Work·Context·Progress·Artifact·Undo 재감사
- side 사용 0의 Direct·긴 답·busy Work bytes·wall 기준선
- 참조 스크린샷은 interaction oracle로만 사용하고 CSS를 복제하지 않음

#### SE-1 — Canonical Anchor & Read Model

- exact messageId·sessionId·content digest·revision·start/end offset
- Unicode grapheme·Markdown·code·table·streaming finalization
- stale·cross-session·두 message selection 거부
- ConversationLedger typed side events와 main-history 비혼입

#### SE-2 — Same-T5 Read-only Exploration

- same modelFactory·Interaction Core·runAgent
- 선택 원문과 side 질문만 bounded high-signal Context
- 첫 범위 Tool 0 explanation, 다음 범위 qualified read-only Hand만
- Work·Effect·Artifact·Delivery·Memory write 0
- side Stop과 main Work Stop 분리

#### SE-3 — Explicit Apply & Work Provenance

- apply 대상 Work/revision의 current identity 재검사
- active/busy·active/idle은 exact R+1 correction
- paused는 기존 resume
- completed는 기본 derived Work와 source Work/revision/anchor provenance
- same Work reopen은 별도 A/B 없이는 금지
- apply two-phase exact-once·중복 클릭·ACK unknown·restart

#### SE-4 — Read-only Source/Evidence Extension

- 첫 제품 범위는 main Conversation text selection
- 이후 exact document/page/cell/source anchor가 이미 존재하는 형식만 확장
- selection 자체를 source 수정 권한으로 해석하지 않음

#### SE-5 — Human HQ & Clean Second Pass

- 긴 답의 한 문장 선택→side 질문 3회→main 무변경 확인
- busy Work 중 side 탐색→main Stop 독립 확인
- apply→R+1 또는 derived Work→실제 결과·Undo
- reload·reconnect·backup/restore 후 dangling anchor 0
- 좁은 창·keyboard·screen reader·한글·Markdown·dark theme
- 첫 pass 수리 뒤 clean second whole-flow

종료 상태: `COMPLETE`. 오너 actual Console의 selection→흰색 floating side surface→side answer,
실제 gpt-5.5의 explicit apply→current Work R+1→achieved delivery, reload 복원·exact-once 반대시험과
현재 head 전체 회귀를 결속했다. 자동 브라우저의 native text drag가 선택을 만들지 못한 것은 제품 실패로
승격하거나 조건 패치하지 않았고, 오너의 실제 화면 시험을 인간 표면 정본으로 사용했다.

근거: `refoundation/evidence/nx2-se5-selection-side-exploration-close-2026-09-01.json`.

### 비목표·중단선

- 새 Agent·persona·Memory·Method engine·Work/Artifact Store
- side branch 자동 main Context·checkpoint·Experience 혼입
- apply 전 실행·외부 effect·파일 변경
- completed Work settlement를 덮어쓰는 same Work reopen
- exact anchor와 provenance RED 전에 UI/CSS부터 구현
- side 미사용 Direct에 bytes·model call·Tool call 추가

### 합격식

```text
exact selection identity·stale rejection PASS
AND side branch main Conversation/Work/Memory/Effect delta 0 before apply
AND explicit apply exact target·revision·provenance·exact-once PASS
AND existing execution·Artifact·Undo 경계 재사용
AND side 미사용 Direct·Work 속도·Context 무회귀
AND actual Console human flow·accessibility·clean second pass PASS
```

---

## 10. NX2-4 — Auditory Intelligence

상세 정본: `T5-AUDITORY-INTELLIGENCE-WHISPER-RESEARCH.md`

### 사용자 완료 문장

> 사용자는 음성 메모·회의 녹음·영상 파일을 맡기면 T5가 정확히 어느 자료의 어느 구간을 들었는지 보존하면서
> 전사·자막·요약·할 일·후속 문서를 실제 파일로 받는다.

### 10.1 첫 엔진 후보

- `whisper.cpp + large-v3-turbo`
- platform-native media decode
- process 격리와 resource limit
- 제품 의존성으로 pin하고 Runtime 중 자동 설치하지 않음

엔진은 교체 가능 provider다. T5의 제품 계약은 engine 이름이 아니라 source·coverage·cancel·Artifact다.

### 10.2 Gate

#### AU-0 — Current Baseline

- macOS·Windows 후보 엔진의 실제 accuracy·RTF·RSS·model size 비교
- 짧은 음성·긴 회의·영상·저품질·한국어 고유명사 corpus
- 제품 변경 0

종료 상태: `COMPLETE`. current T5는 audio/video identity만 알고 STT executable·model generation은 없었다.
공식 `whisper.cpp` b4938을 M4 Metal에서 제품 밖 자격했고 `large-v3-turbo` full과 Q5를 같은 13.44초
한국어 source에 실행했다. Q5 warm은 2.28초·peak footprint 약 857MB, full은 3.24초·약 1.99GB였고,
무힌트 CER은 둘 다 1/71, 현재 source에서 얻은 고유명사 hint를 사용한 Q5는 0/71이었다. Q5를 기본으로
확정한 것은 아니며 실제 인간 corpus 전까지 qualification candidate다.

첫 P1은 양 모델 공통으로 5초 완전 무음에 거짓 transcript를 만들고 29.98초 timestamp를 주장한 것이다.
이는 quantization 문제가 아니라 engine output과 audio coverage를 독립 검증해야 하는 제품 계약 결함이다.
따라서 첫 제품 구현은 Whisper 실행 배선이 아니라 AU-1 Audio Reality와 duration/track/decode truth다.

근거: `refoundation/evidence/nx2-au0-auditory-baseline-2026-09-01.json`.

#### AU-1 — Audio Reality & Native Decode

- exact file handle·revision·digest
- container·codec·duration·track·sample rate
- decode range와 실패 지점
- audio 없는 영상과 손상 media 분리

종료 상태: `SOURCE_COMPLETE_WINDOWS_PHYSICAL_DEFERRED`. macOS native helper는 WAV·MP3·M4A의 container·duration·codec·
sample rate·channel과 MP4·MOV의 video/audio track을 실제 관측했다. Node adapter는 exact source digest를 실행 전후
재검사하고 MP3·M4A를 16kHz mono WAV scratch로 streaming 변환한 뒤 duration·format을 다시 확인하고 정리한다.
Attachment inspect는 이 Reality를 모델에 주되 transcript나 content understanding으로 승격하지 않는다.

Windows는 같은 closed JSON 계약의 Media Foundation read-only inspect와 16kHz mono PCM decode source, package manifest
digest, Node adapter까지 준비했다. Windows physical compile·track 관측·codec 성능은 아직 PASS가 아니며 AU-7의
`DEFERRED_NOT_WAIVED`로 유지한다. 이 비주장 아래 AU-1 source 개발은 닫고 AU-2로 이동한다.

근거: `refoundation/evidence/nx2-au1a-audio-reality-2026-09-01.json`.

#### AU-2 — Helper & Model Acquisition

- pinned asset manifest·hash·license·size
- 최초 사용 전 명시적 다운로드와 progress
- partial/corrupt asset fail-closed
- 제거·재설치·platform path

현재 slice: `AU2A_MODEL_GENERATION_COMPLETE_AU2_REMAINS_OPEN`. 기존 Managed CLI/Capability package 경계는
64MB 상한과 whole-buffer download라 574MB~1.62GB model에 재사용하지 않았다. Whisper model에만 한정된 store가
immutable catalog, disk preflight, streaming·Range resume, exact bytes·SHA-256, inactive generation,
fixture qualification, active generation reopen을 제공한다. full이 유일한 제품 기본이고 Q5는 실제 인간 corpus 전까지
qualification candidate다. 범용 Model Marketplace·Prompt·Tool·사용자 UI는 추가하지 않았다.

근거: `refoundation/evidence/nx2-au2a-model-generation-2026-09-01.json`.

종료 상태: `COMPLETE`. 공식 b4938 exact source archive에서 macOS arm64+x86_64 static host가 실제 빌드됐고,
Windows x64·ARM64 package도 같은 archive를 static build하도록 source 계약을 공유한다. 실제 universal host와 Q5 exact
model의 silence fixture load·JSON schema qualification이 통과했다. 준비 service는 concurrent caller를 한 generation으로
합치고 crash 뒤 inactive/qualified generation을 이어서 active readback한다. full은 유일한 제품 기본이지만 AU-2 자격을
위해 같은 1.62GB를 다시 받지는 않았으며 Q5의 기본 승격도 하지 않았다.

근거: `refoundation/evidence/nx2-au2b-whisper-host-acquisition-2026-09-01.json`.

#### AU-3 — Managed Transcription Spine

- D의 managed process·output handle·Stop·parent-death 재사용
- chunk·VAD·deadline·resource bound
- restart 뒤 completed chunk 재사용, 중복 전사 0

종료 상태: `COMPLETE_FIRST_WHOLE_PCM_JOB`. 기존 D ManagedProcessRegistry 아래에서 prepare→decode→host 실행을
한 operation으로 묶고 running handle·delta poll·exact owner·Stop·process-tree·terminal JSON·cleanup을 재사용한다.
actual M4에서 6.24초 한국어 source가 2.39초 process wall로 종료됐고, 결과는 AU-4 전까지
`transcribed_unverified`·`publishable=false`다. 190초 M4A 즉시 Stop은 late transcript 0·scratch 0이었다.
process crash나 Runtime 사고 뒤 자동 재전사는 아직 하지 않으며 interrupted truth를 기존 D/Work에 남긴다.

근거: `refoundation/evidence/nx2-au3-managed-transcription-2026-09-01.json`.

#### AU-4 — Transcript Coverage & Truth

- chunk별 source time range·coverage
- 누락·겹침·decode 실패·low confidence
- 모델이 듣지 않은 구간을 추론해 채우지 않음

종료 상태: `COMPLETE`. decoded PCM을 streaming 관측해 duration·digital silence를 계산하고 segment timestamp의
source 범위·monotonicity·overlap을 검증한다. actual 한국어 음성은 `verified_transcript`로 승격됐고 5초 무음의
거짓 문장·29.98초 timestamp는 `coverage_rejected`로 차단됐다. Runtime text 후처리·문장 삭제는 0이다.

근거: `refoundation/evidence/nx2-au4-transcript-coverage-2026-09-01.json`.

#### AU-5 — Transcript Artifact & Work Result

- TXT·SRT·VTT·회의록·할 일 Artifact
- source lineage·version·Undo
- exact quote와 요약 분리
- 사용자가 요구한 형식만 발행

종료 상태: `COMPLETE`. verified transcript만 요청된 단일 TXT·SRT·VTT 형식으로
기존 Attachment family에 등록한다. coverage rejected/unverified는 Artifact 0이며 사용자 교정본은 raw v1을 덮지
않고 같은 family v2다. actual 한국어 전사·SRT와 20분 격리 회의의 전체 TXT·결정·담당자·기한 결과가 등록·exact
reopen됐고, 고유명사 교정은 같은 family v2로 보존됐다. 원본 transcript보다 교정본을 과거 진실로 덮어쓰지 않는다.

근거: `refoundation/evidence/nx2-au5a-transcript-artifact-2026-09-01.json`.

#### AU-6 — Natural Activation & Channels

- local attachment·Telegram media·기존 파일의 같은 계약
- audio/video일 때만 on-demand 발견
- 모든 파일·대화에 Whisper schema 상시 노출 0

종료 상태: `COMPLETE`. exact audio/video 첨부에서는 첫 모델 응답에 기존 Auditory Hand가 열리고, File Reality가
찾아 inspect한 local media는 opaque exact handle로 같은 Hand에 전달된다. 일반 Terminal path 재등록·새 Router·새
Store는 0이다. Telegram voice/audio/video는 기존 canonical Attachment ingress를 재사용하며 외부 실제 계정 시험은
반복하지 않았다.

#### AU-7 / AU-HQ

- platform·성능·경제성
- 빠른 음성 메모, 긴 회의, 영상 자막의 실제 Console 전 여정
- Enter/첨부→progress→첫 transcript→최종 Artifact→교정→Download/Reveal/Undo

종료 상태: `COMPLETE_MACOS · WINDOWS_PHYSICAL_DEFERRED_NOT_WAIVED`. 실제 Console에서 1분 음성은 Auditory 1회와
model polling 0으로 22.4초에 verified TXT를 냈고, 20분 격리 음성은 약 4분 51초에 전체 transcript와 회의 결과를
냈다. 실제 video audio track은 SRT로 발행됐고, local Downloads 음성은 File Reality→Auditory로 Terminal fallback 0에
끝났다. 전사 중 실제 진행 문구, Stop 뒤 late Artifact·고아 process 0, 완료 wake exact-once, Runtime restart 뒤
기존 Artifact reopen을 확인했다. lossy video 고유명사 한 글자 오인식은 숨기지 않고 사용자 교정 v2로 보존했으며
완벽한 고유명사 인식은 주장하지 않는다. Windows Media Foundation·static helper·package entry source 계약은 닫혔고
물리 실행은 `DEFERRED_NOT_WAIVED`다.

근거: `refoundation/evidence/nx2-au5-7-console-hq-2026-09-01.json`.

### 명확한 비목표

- 상시 microphone
- TTS·voice cloning·음악 생성
- 전체 audio 자동 index
- hosted STT 강제
- transcript를 원본보다 우위의 진실로 취급

---

## 11. NX2-5 — Web Intelligence Collector

### 사용자 완료 문장

> 사용자는 공개 사이트의 자료를 원하는 기준으로 수집·정리·비교·반복 확인해 달라고 말할 수 있고, T5는 사이트
> 구조와 coverage를 정직하게 파악해 재사용 가능한 수집 방법과 실제 결과물을 만든다.

### 11.1 현재 실제 기반

- T5 Web Hand와 Browser Hand
- 공개 URL fetch·read·research
- G의 임시 프로그램·격리·독립 검증
- F의 publication·Artifact·Undo
- Automation·Scheduler·Delivery
- managed `web-crawler` Skill 후보

별도 crawler Agent OS를 만들지 않는다. crawler는 T5가 필요할 때 쓰는 전문 방법이다.

### 11.2 수집 전략 순서

```text
공식 API·export
→ 정적 HTML·공개 JSON
→ 사이트 구조·pagination·detail URL 발견
→ 기존 Browser Hand의 rendered public page
→ 필요한 경우 bounded generated collector
```

raw `agent-browser`·Selenium을 exec로 실행해 두 번째 browser reality를 만들지 않는다. 로그인된 수집은 NX2-6의
Identity와 scoped broker가 서기 전에는 열지 않는다.

### 11.3 Gate

#### WC-0 — Current Crawler Qualification

- 기존 `web-crawler` source·license·dependency·payload 경계
- Core test·environment preflight·public site fixture
- 현재 T5 Skill search/view와 자연 활성

종료 상태: `COMPLETE`. 현재 T5는 이미 Search·exact URL read·bounded multi-source research·managed Browser·visual/video
Hand·G/F·Artifact·Automation을 가진다. 실제 Console에서 공개 연습 사이트 3페이지 60건을 정확한 XLSX로 만들었지만,
모델 10회·Tool 11회·약 36만 input token을 사용했고 이미 Web Hand로 읽은 세 페이지를 Python이 다시 네트워크에서
수집했다. 사용자 결과는 정확했으나 두 번째 네트워크는 Web host·request·coverage Receipt 밖이었다.

pinned upstream `web-crawler@c64cfbf`는 MIT source와 structure·pagination·soft-block·coverage 검증 원리는 유용하지만,
별도 Python venv·Scrapling·Patchright·Playwright Chromium·agent-browser·cookie/profile 상태와 anti-bot ladder를 요구한다.
따라서 전체 repository나 기본 Skill을 제품에 넣지 않고 교재로만 보존한다. 다음 WC-1은 모델이 작성한 작은 수집 계약을
기존 Web Reality가 실행하는 qualification-only 후보로 연다.

근거: `refoundation/evidence/nx2-wc0-web-collector-baseline-2026-09-01.json`.

#### WC-1 — Collection Specification

모델이 다음을 선언한다.

- starting URLs
- desired entities·fields
- coverage boundary
- freshness
- pagination/stop condition
- output form

Runtime은 이 의미를 만들지 않고 exact contract·권한·실행만 보존한다.

종료 상태: `COMPLETE_QUALIFICATION_ONLY`. 모델이 exact URL·반복 item·field·필수값·unique key·예상 건수 범위를
작성하고 Runtime이 same-origin·12 page·20 field·2,000 record·4MB/page 안에서 coverage·누락·중복·cancel을 검증하는
작은 계약을 세웠다. 공개 연습 사이트 3페이지는 1.28초·정확히 3 request로 60건·누락 0·중복 0을 통과했다.
제품 entry·Tool schema·Prompt 변화는 0이며, WC-2에서 selector와 pagination을 현재 page reality에서 얻기 전에는
제품에 연결하지 않는다.

근거: `refoundation/evidence/nx2-wc1-bounded-collection-2026-09-01.json`.

#### WC-2 — Structure Reconnaissance

- list/detail/pagination/duplicate/canonical URL
- robots·rate limit·terms 관측
- 공개 범위와 로그인 범위 분리
- hidden oracle fixture에서 coverage 검증

종료 상태: `COMPLETE_QUALIFICATION_ONLY`. exact page HTML에서 script 실행 없이 반복 container·상대 field selector·attribute/text
source·population coverage·canonical URL·pagination 후보를 bounded facts로 만든다. 실제 공개 연습 페이지에서
`article.product_pod` 20개와 `h3 a[title]`·가격·재고·다음 페이지를 모두 관측했다. 페이지 문구는 untrusted Evidence이며
instruction authority가 아니다. 새 Browser·network inspector·site parser·selector Store는 0이다.

근거: `refoundation/evidence/nx2-wc2-structure-reconnaissance-2026-09-01.json`.

#### WC-3 — Generated Collector Capsule

- 사이트별 코드를 영구 Core에 넣지 않음
- fixture에서 먼저 실행
- actual public input에서 bounded 1회 실행
- host observer가 record count·schema·duplicates·coverage 재검증
- network host allowlist·rate·deadline

종료 상태: `COMPLETE_FIRST_STATIC_PRODUCT_SCOPE`. 기존 `web_read`가 실제 반복 구조 handle을 한 Run에 결속하고,
`web_collection`은 모델이 선택한 observed selector·same-origin URL·필수값·unique key·예상 건수만 실행한다. verified
records는 기존 XLSX writer와 AttachmentStore로 즉시 2-sheet Artifact가 되어 전체 records를 다시 모델이나 Terminal에
넘기지 않는다. 동일 목적 실제 Console은 60건·누락 0·중복 0을 유지하면서 133.1초→31.0초, 모델 10→5,
Tool 11→6, input token 363,326→68,208로 줄었다. Terminal network·새 Browser·page script·runtime install은 0이다.

모델이 첫 턴에 세 대표 page를 모두 읽은 비용은 관측으로 남기고 같은 activation 가족의 세 번째 patch는 붙이지 않는다.
dynamic page는 기존 Browser Hand를 열되 rendered collection 완료는 아직 주장하지 않는다.

근거: `refoundation/evidence/nx2-wc3-web-collector-product-2026-09-01.json`.

#### WC-4 — Artifact·Automation

- CSV/XLSX/JSON/보고서 Artifact
- source URL·observed time·coverage·unknown
- 변경 감시와 diff는 Automation에 결속
- 사이트 구조 변경 시 stale method로 중단, 무한 재시도 0

상태: `COMPLETE — 2026-09-02`

기존 Automation이 내부 실행 Session에서 만든 verified Web Collection XLSX를 원래 대화와 Telegram 목적 Session에
전달할 때, 수집이나 모델을 다시 실행하지 않고 exact bytes·digest를 기존 AttachmentStore로 materialize한다.
AutomationStore는 source Run·source Artifact·destination Artifact를 한 surface/delivery receipt로 결속하며,
surface crash 뒤에는 같은 destination identity를 재사용해 결과 생성·수집을 반복하지 않는다. Console에서는 같은
identity의 Preview·Download와 generated-output 인간 영수증이 성립한다. 각 record는 exact source URL과 Web Hand의
observed time을 보존하고 summary에는 coverage·missing·duplicate·unknown을 남긴다.

첫 반대시험은 수집·XLSX 생성이 모두 성공했지만 원래 대화에는 text만 남고 Artifact가 사라지는 P1이었다. 수리 뒤
4 records·3 bounded requests·missing 0·duplicate 0, Preview PASS, Download digest PASS, crash materialization exact-once,
관련 Automation·Telegram·Artifact·Web Collection 회귀 53/53을 확인했다. 새 Store·Router·Browser·Terminal network는 0이다.

근거: `refoundation/evidence/nx2-wc4-artifact-automation-2026-09-02.json`.

#### WC-HQ

현재 첫 제품 수리: `WEB_HAND_PROGRESSIVE_DISCLOSURE_COMPLETE`.

기존 Hand를 합치거나 새 Router를 만들지 않고, 현재 요청에 syntactically valid HTTP(S) URL이 있는 물리적 사실만으로
첫 관측 표면을 분리한다. URL이 없고 실제 Search provider가 있으면 `web_search`, exact URL이 있거나 Search가
없으면 `web_read`가 보인다. `web_research`의 bounded current-information fast path는 유지한다. 검색 후보가 실제로
생긴 뒤에는 같은 Run에 `web_read`가 자동 개통된다. exact URL을 성공적으로 읽은 뒤에도 Search provider가 있으면
`web_search`가 후속 개통되므로, “이 링크를 읽고 관련 사례도 찾아줘”는 중간 Tool Search 없이 이어진다. 이후 반복 구조·동적 interaction은 기존
`web_collection`·`browser` activation을 그대로 사용한다. visual·video·connection도 기존 deferred 경계를 유지한다.

실제 모델은 “최근 공개된 지원사업 자료”처럼 여러 현재 source가 유리한 목적에서 `web_search`보다 기존
`web_research`를 선택했다. 이 판단은 보존한다. bounded research가 실제 source를 반환하면 `web_read`도 후속 개통해,
모델이 그중 exact PDF·페이지를 더 읽을 때 Tool Search를 다시 거치지 않는다.

따라서 후보 검색은 `tool_search→web_search` 한 왕복을 제거하고 exact URL·날씨 경로에는 추가 호출이 없다.
업무 Router·새 Tool·Store·전역 Prompt 변화는 0이며 관련 Console·Browser·Collection 회귀 41/41을 통과했다.
실제 provider wall 개선과 WC-HQ 전체 완료는 아직 주장하지 않는다.

gpt-5.5 실제 격리 Console 최소 자격에서 Direct는 1 model·Tool 0, exact URL은 `web_read` 1회,
날씨는 `web_research` 1회, 일반 공개 지원사업 탐색은 `web_research` 1회로 끝났고 네 경로 모두 Tool Search 0이었다.
URL+관련 공식 사례는 `web_read→web_research`로 정확한 결과를 냈지만 내부 source read를 포함해 model 4·Tool 11,
약 50.5초가 들어 경제성 관측으로 남긴다. 모델이 여러 현재 source 목적에서 `web_research`를 선택한 것을
`web_search` 미사용 실패로 보지 않으며, Runtime은 두 경로 중 하나를 강제하지 않는다.

근거: `refoundation/evidence/nx2-wc-hq-web-hand-surface-2026-09-02.json`.

종료 상태: `CLOSED_WITH_CROSS_HAND_ECONOMY_OBSERVATION`. 정적 반복 목록 수집·Artifact·Automation 전달과 Web Hand
progressive disclosure는 제품에 채택했다. list→detail은 실제 사용자 목적과 결과 정확성은 통과했으나 경제성이
보편적으로 자격되지 않았고, URL+관련 공식 자료도 정확하지만 약 50.5초·model 4·내부 source read 포함 Tool 11이었다.
같은 activation 가족에 추가 Prompt·Router·세 번째 조건 패치를 붙이지 않는다. 이 관측은 NX2-HQ에서 다시 확인하며
NX2-5 완료를 보편적인 dynamic/authenticated collection 성공으로 확대하지 않는다.

- 단일 목록 수집
- list→detail 다단계 수집
- 날짜/조건 필터와 중복 제거
- 사이트 구조 변경·rate limit·부분 실패
- 반복 감시·새 항목 전달

### 합격 조건

- 공개 웹 세 목적 purpose PASS
- coverage와 unknown 정직
- raw second browser 0
- 원본 외부 write 0
- current natural Web path보다 같은 품질에서 rounds·wall 개선
- generated code가 자기 성공을 주장하지 않음

---

## 12. NX2-6 — Naver Identity·Mail·Blog Native Work

상세 정본: `T5-NAVER-IDENTITY-MAIL-BLOG-CAPABILITY-RESEARCH.md`

### 사용자 완료 문장

> 대한민국 자영업자는 T5에게 네이버 메일을 찾고 정리하고 답장을 준비하거나 보내고, 블로그 글을 자료에서 만들어
> 실제 초안·예약·발행까지 맡길 수 있으며 로그인·비밀·전송 범위는 한 번의 신뢰 가능한 T5 신분 안에서 관리된다.

### 12.1 하나의 Naver identity, 두 실행 경로

```text
T5 Naver Identity Broker
├─ Mail: 공식 IMAP/SMTP protocol
└─ Blog: 기존 Browser Hand의 현재 공식 UI
```

- 일반 비밀번호는 모델·Prompt·로그로 보내지 않는다.
- 메일은 2FA/app password 등 공식 정책을 따른다.
- 블로그 쓰기는 종료된 API를 가장하지 않는다.
- Browser provider는 교체 가능하지만 identity·authority·receipt는 하나다.

### 12.2 Gate

#### NV-0 — Current Reality Baseline

- 과거 Naver 로그인 실패·성공 증거
- 현재 browser profile·mail protocol·blog UI reality
- 제품 변경 0

종료 상태: `COMPLETE — 2026-09-02`. 현재 제품은 하나의 managed persistent Browser profile, user-controlled
login handoff, stale tab/dead Browser recovery, 범용 rich editor 관측·입력을 이미 갖고 있다. 과거 실제 Naver에서
메일함 읽기와 블로그 제목·본문 8,053자 exact 입력도 성공했다. 그러나 clean restart 뒤 session-only login은
`login_required`였고, Naver identity broker·IMAP/SMTP Hand·app-password binding·메일 발송·블로그 발행은 없다.
제품 변경과 실제 계정 쓰기는 0이다.

근거: `refoundation/evidence/nx2-nv0-current-reality-2026-09-02.json`.

#### NV-1 — Login Persistence Opposing Test

- “로그인 상태 유지” 미선택/선택
- clean restart 뒤 Mail·Blog read-only actual
- cookie export·복사 없이 same managed profile

현재 상태: `CONTRACT_COMPLETE · ACTUAL_OWNER_CONTROLLED_CONSOLE_PENDING`. 동일 managed profile에서 로그인 상태 유지
미선택/선택 두 회차, clean Browser shutdown, Runtime restart, Mail·Blog read-only 재관측을 하나의 qualification
contract로 고정했다. profile이 다르거나 cookie·secret을 관측하거나 shutdown/restart receipt가 없으면 자격하지 않는다.
실제 Naver 계정은 자동 시험하지 않았고 제품 변경은 0이다.

근거: `refoundation/evidence/nx2-nv1-login-persistence-contract-2026-09-02.json`.

실제 결과: `PASS`. 로그인 상태 유지 미선택 A는 clean restart 뒤 Mail·Blog 모두
`login_required`, 선택 B는 같은 profile·restart 뒤 둘 다 `ready`였다. cookie·secret 관측과 외부 write는 0이다.
다만 B restart 직후 첫 read-only 요청이 stale queued Work identity와 orphan provider function-call output으로 한 번
중단됐다. 실행·효과 0 확인 뒤 같은 read-only probe를 재개해 성공했다. NV-1R에서 canonical ledger 순서는 보존하되
Responses provider wire가 function output을 exact call 바로 뒤에 배치하도록 수리했다. ChatGPT OAuth·OpenAI Responses
반대시험 30/30과 같은 실제 state의 재시작 첫 요청을 통과했다.

근거: `refoundation/evidence/nx2-nv1-login-persistence-actual-2026-09-02.json`.
수리 근거: `refoundation/evidence/nx2-nv1r-restart-provider-continuity-2026-09-02.json`.

#### NV-2 — Naver Identity Broker

- signed-in/expired/2FA-required/locked/unknown
- profile identity와 app-password secret ref 분리
- 재로그인·forget·backup/restore 경계

종료 상태: `COMPLETE — 2026-09-02`. 기존 Browser observation이 실제 Mail·Blog ready를 확인하면 기존
`connection` 표면에 하나의 Naver identity로 결속한다. broker는 새 Store·Tool 없이 process-local projection만 가지며,
재시작 직후에는 unknown이고 다시 실제 관측된 뒤 ready가 된다. 첫 실제 반례에서 고정 `default` handle이 Browser의
공개 profile ID와 달라 foreign으로 거부됐고, first-observed exact public profile ID를 결속한 뒤 다른 ID만 거부하도록
수리했다. 실제 Console에서 Mail·Blog·connection ready, 로그인 창·메일 열람·쓰기·저장·발행 0을 확인했다.

근거: `refoundation/evidence/nx2-nv2-naver-identity-broker-2026-09-02.json`.

#### NV-3 — Mail Read

- folder/list/search/open/attachment
- sender·recipient·date·message identity
- pagination·coverage·unread state의 실제 효과 분리

#### NV-4 — Mail Draft & Send

- draft와 send 분리
- 새 상대 첫 전송 승인
- reply thread identity·attachment·recipient 재검사
- SMTP accepted와 recipient delivery를 합치지 않음

#### NV-5 — Blog Draft Core

- 사용자 자료·목적·독자에 맞는 title/body/category/tag draft
- source truth와 홍보 표현 분리
- 아직 외부 effect 0

#### NV-6 — Blog Craft

- existing Browser Hand로 editor 실제 상태 관측
- heading·paragraph·image·caption·spacing·preview
- 좌표가 아니라 role/DOM 우선

#### NV-7 — Save·Schedule·Publish

- draft save·schedule·publish 각각 effect 분리
- 공개 URL actual reopen
- ACK unknown에서 중복 publish 0
- correction·unpublish 가능 범위

#### NV-8 — Authenticated Collection Broker

- NX2-5 public collector가 정말 로그인 자료를 필요로 할 때만 개통
- 같은 identity의 bounded request/browser-session broker
- cookie·token을 guest code에 직접 전달하지 않음

#### NV-HQ

- 사업 메일 찾기→첨부 확인→답장 초안→교정→전송
- 받은 자료→블로그 초안→Preview→예약→실제 공개 확인
- login expiry·2FA·ACK unknown·재시작·중복 방지

### Windows provider 경계

Managed Playwright가 공통 기본 후보다. Selenium·webdriver-manager는 Windows 실제 자격에서 명확한 호환성·운영 이익이
있을 때만 같은 Browser Hand 아래 provider 후보로 비교한다. 사용자가 `pip install`한 임의 Selenium을 T5의 제품 경계로
간주하지 않는다.

---

## 13. NX2-7 — Experience Promotion

### 사용자 완료 문장

> T5는 실제로 더 잘했던 방법을 다음 비슷한 일에 활용하지만, 과거 습관을 현재 사용자에게 강요하지 않고 상황이
> 달라지면 즉시 원래의 유연한 판단으로 돌아간다.

### 13.1 승격 대상

승격하는 것은 답 문장이나 업종 workflow가 아니다.

- 어떤 reality를 어떤 순서로 확인했는가
- 어떤 Tool/Method 조합이 rounds를 줄였는가
- 어떤 verifier가 실제 오류를 막았는가
- 어떤 Artifact form이 목적·청중에서 더 잘 쓰였는가
- 어떤 실패에서 어떤 대안이 회복했는가

### 13.2 최소 provenance

```yaml
sourceWorks: [exact achieved work revisions]
purposeFamily: model-authored bounded description
methodContractDigest: exact contract
requiredReality: source and capability preconditions
qualityEvidence: accuracy, human, wall, calls, tokens
negativeEvidence: failures and holdouts
platforms: actually qualified only
status: candidate | active | archived
```

### 13.3 승격 순서

1. 서로 다른 achieved Work에서 같은 방법 후보가 반복된다.
2. 현재 자연 경로와 candidate를 AB/BA한다.
3. 독립된 fresh purpose에서 재현한다.
4. 설명·교정·wall·calls·tokens의 사용자 이익을 확인한다.
5. managed reversible Skill/Method로 제한 활성화한다.
6. current difference·회귀·사용자 교정에서 자동 archive한다.

### 13.4 금지

- 한 번 성공 후 자동 저장
- 모델 자기평가만으로 승격
- 사용자 persona·업종을 Core 진리로 병합
- 비활성 후보를 항상 Context에 주입
- 과거 방법을 현재 교정보다 우선
- Experience가 직접 외부 effect 수행

### 13.5 합격 조건

- fresh purpose 우위
- 비적용 holdout에서 개입 0
- 현재 변화에서 archive·fallback
- active 후보의 Context cost가 설명됨
- 사용자에게 검증 중·배운 방법·폐기 이유를 볼 수 있는 기존 관리 표면

---

## 14. NX2-HQ — Competitive Whole Human Qualification

### 14.1 실행 원칙

- exact completed candidate에서 수행한다.
- 한 실제 Console은 한 runner가 순차 조작한다.
- read-only oracle·로그·비교 분석은 병렬화할 수 있다.
- 수리는 한 owner가 순차 수행한다.
- 기존 증거는 oracle로 재사용하되 현재 후보 UX PASS로 전이하지 않는다.
- 전체 wave 후 발견된 P0/P1을 수리하고, clean second whole-flow pass를 한 번 더 수행한다.

### 14.2 비교군

- 현재 T5 귀환선
- NX-2 candidate
- 같은 모델의 직접 Chat/Work/Coding 비교선 중 목적에 맞는 것
- 관련 공개 에이전트는 기능 수가 아니라 같은 사용자 목적 결과로 비교

### 14.3 통합 인간 여정

#### H01 — Direct·일상·아이디어

- 인사, 고민, 기획, 긴 글 정리
- Tool 0·빠른 TTFT·언어 품질

#### H02 — Single Reality

- 날씨, 최신 뉴스 하나, URL 하나, 파일 하나
- 한 Hand·불필요한 조사 0

#### H03 — 일반 표현 사업 판단

- 매출·미수금·재고·계약
- 전문가 표현과 목적 성공 격차

#### H04 — 복합 자료와 Crafted Artifact

- 여러 문서·표·이미지에서 대표용 결과 작성
- 숫자·근거·정보 구조·render·편집성

#### H05 — Program/Project

- 반복 업무용 작은 도구 또는 웹앱
- 실제 사용·test·Browser QA·Undo

#### H06 — Audio/Video

- 음성 메모·긴 회의·영상 자막
- 부분 결과·coverage·Artifact·교정

#### H07 — Public Web Collection

- 목록·detail 수집·필터·반복 감시
- coverage·rate·structure change

#### H08 — Naver Mail

- 검색·첨부·초안·교정·전송·중복 방지

#### H09 — Naver Blog

- 자료→초안→craft→Preview→예약/발행→공개 URL 확인

#### H10 — Correction·Dual Control

- 실행 중 사용자 교정과 직접 파일 변경
- R+1·재관측·과거 결과 혼합 0

#### H11 — Failure·Recovery

- network·Tool·model·process 실패
- ACK unknown·restart·no blind retry

#### H12 — Long Relationship·Experience

- 과거 성공 방법 재사용
- 현재 조건 변경에서 archive
- current user 우선

#### H13 — Stop·Undo·Ownership

- 진행 중 Stop·late effect 0
- Artifact Undo·reconnect
- backup/restore는 별도 release HQ 경계로 기록

### 14.4 T0→T6 UX 시간선

```text
T0 Enter
T1 입력 수신이 보임
T2 실제 사건 기반 진행
T3 첫 유용한 결과
T4 최종 답
T5 Preview·Download·Reveal·실제 사용
T6 교정·Stop·Undo·재접속
```

각 시점의 공백·중복·거짓 상태·내부 용어·버튼 작동을 기록한다. 최종 답이 맞아도 T0~T6가 막히면 인간 HQ PASS가 아니다.

### 14.5 심각도

- P0: 데이터 손상·권한 위반·잘못된 외부 effect·멈춤 불능·가짜 완료
- P1: 목적 실패·핵심값 누락·엉뚱한 경로·무한 대기·결과 사용 불가
- P2: 불필요한 왕복·과잉 검증·진행 문구·가독성·경미한 비용

### 14.6 최종 합격식

```text
모든 P0 = 0
AND 핵심 H01~H13 P1 = 0
AND clean second pass PASS
AND Direct·Single speed 무회귀
AND Multi-source·Artifact 정확성/품질 우위
AND 일반/전문 표현 gap 허용선 이내
AND Stop·restart·Undo exact
AND 실제 외부 effect truth
AND 모델별 결과 차이는 관측되지만 제품 contract fork 0
AND package·platform 미자격을 제품 기능 PASS로 꾸미지 않음
```

---

## 15. 파일 책임 계획

실제 파일명은 Gate 시작 시 current HEAD에서 재검증한다. 아래는 책임 경계이며 미리 전부 생성하지 않는다.

### NX2-1

- NX-1 contract·orchestration source: 재사용
- `refoundation/test/helpers/nx2-generalized-mastery-qualification.js`: 자격 fixture·oracle 후보
- `refoundation/scripts/run-nx2-generalized-mastery.mjs`: AB/BA runner 후보
- `refoundation/evidence/nx2-*.json`: 작은 기계 증거

### NX2-2

- `refoundation/src/console-model-factory.js`: global kernel 후보
- Tool definition·validator source: SSOT pilot
- Context compiler·capability directory·Skill projection: ownership migration
- 별도 Prompt CMS·Instruction DB: 만들지 않음

### NX2-3

- 제품 source는 실패가 특정된 기존 경계만 변경
- `refoundation/scripts/run-nx2-cognitive-flow-qualification.mjs`: 표현·perturbation runner 후보
- 새 Judgment Engine·Router·Store: 만들지 않음

### NX2-4

- audio reality·decode adapter·managed transcription provider 후보
- model asset manifest·helper lifecycle
- transcript Artifact adapter
- existing Process·File·Artifact·Channel source 재사용

### NX2-5

- 현재 `web-crawler` Skill source를 Gate 시작 시 exact commit으로 import 후보화
- existing Web/Browser/G/F/Automation source 재사용
- raw second Browser·새 crawler store: 만들지 않음

### NX2-6

- Naver identity broker·mail protocol adapter·blog Browser adapter 후보
- existing Secret·Connection·Browser·Attachment·Delivery 재사용
- cookie export store·hidden Blog API: 만들지 않음

### NX2-7

- existing Principle/Skill/Experience ledger의 현재 제품 경계 재감사
- 실제 gap 없으면 새 Store 0
- promotion evaluator·archive policy는 동일 provenance source에서 파생

---

## 16. 커밋 규율

각 Gate는 다음 단위로만 커밋한다.

1. current reality·RED·evidence
2. contract·SSOT
3. qualification-only candidate
4. deterministic opposing tests
5. live AB/BA
6. minimal product integration 또는 candidate 폐기
7. actual Console HQ·closeout

제품 후보가 실패하면 qualification source와 부정 증거를 보존할 수 있지만, Console·Prompt·Tool surface 제품 배선은 0으로
되돌린다. 같은 결함 가족의 세 번째 문구·조건 패치 전에 구조를 재판정한다.

---

## 17. Gate별 시작 일곱 줄

모든 Gate 시작 시 문서와 Git에 아래를 기록한다.

1. T5의 제품 약속
2. 현재 NX-2 Gate
3. Gate의 사용자 완료 문장
4. 이미 선 실제 증거
5. 현재 가장 큰 미달
6. 이번 변경이 그 미달을 줄이는 방식
7. 이번 변경의 non-goals

일곱 줄을 current HEAD·actual 실행에서 확인할 수 없으면 구현하지 않는다.

---

## 18. NX-2 Core 완료 문장

> T5는 특정 업무용 기능 묶음이 아니라, 사용자의 표현 수준과 자료 형식과 실행 수단이 달라져도 현재 현실을 정확히
> 파악하고 적절한 깊이와 방법을 선택해 더 빠르고 정확하며 더 좋은 결과를 만든다. 필요한 경우 파일·문서·프로그램뿐
> 아니라 음성·공개 웹·네이버 실무까지 같은 권한·증거·취소·복구 구조에서 다루고, 실제로 우월했던 방법만 현재 상황에
> 맞게 재사용한다. 단순한 대화는 여전히 가볍고 자연스럽다.

이 문장은 NX2-HQ의 clean second pass 전에는 사용할 수 없다. 연구실 전체의 마지막 계획까지 완료했다는 문장은 아래
NX2-PS의 `PS-HQ`까지 통과한 뒤에만 사용할 수 있다.

---

## 19. NX2-PS — T5 Presentation Studio — LAST PLANNED PRODUCT GATE

상태: `RESEARCH_AUDITED · SOURCE_PINNED · PRODUCT_IMPLEMENTATION_NOT_OPEN · PLANNED_AFTER_NX2_HQ`

외부 source:

- 저장소: [byungjunjang/slide-master](https://github.com/byungjunjang/slide-master)
- 감사 commit: `166472bd2a22de9aa9fb6c8cdf8b0cdfc6b698ef`
- license: MIT, upstream `hugohe3/ppt-master` 고지 유지

### 19.1 사용자 완료 문장

> 사용자는 보고서·표·문서·웹 자료나 주제만 평소 말로 맡기고, T5와 발표 목적·청중·디자인 방향을 확인한 뒤,
> 실제 PowerPoint에서 요소별로 편집 가능한 고품질 PPTX와 전체 Preview를 받는다. 회사 template과 검증된 디자인
> profile을 재사용할 수 있고, 부분 교정·Version·Undo·Telegram·정기 보고까지 같은 T5 Work에서 이어진다.

### 19.2 왜 맨 마지막인가

Presentation Studio는 단순 PPTX writer가 아니다. 다음 선행 능력을 한꺼번에 사용한다.

- NX-1 Reality/Human Closure
- NX2-2 Context·Tool ownership
- NX2-3 목적·청중·판단·자연스러운 중단
- NX2-SE 부분 탐색·명시적 적용·Work revision
- NX2-5 Web source와 coverage
- NX2-7 검증된 template·Design Profile 승격
- File·Document·Terminal·Browser·Artifact·Version·Undo·Receipt

이 기관을 먼저 열면 독립 Agent workflow가 T5 Core를 덮을 위험이 있다. NX2-HQ로 공통 신체와 판단 흐름을 먼저 닫은
뒤 마지막 Crafted Artifact 전문 능력으로 개통한다.

### 19.3 실제 source 감사

2026-09-01 pinned source 실물:

| 항목 | actual |
|---|---:|
| 전체 checkout | 약 84MB |
| `ppt-master` 본체 | 약 65MB |
| template asset | 약 49MB |
| 본체 파일 | 약 12,234개 |
| 핵심 `SKILL.md` | 약 112KB |

주요 기능:

- PDF·DOCX·URL·Markdown·XLSX/CSV·주제→deck
- 전략·디자인 확인
- page별 SVG source
- SVG→native DrawingML editable PPTX
- template fill·beautify·template creation
- live preview·click annotation
- geometry·overflow·wrap·package·render 검증
- notes·transition·선택 narration·native chart/table

주요 의존성:

- Python 3.10+
- python-pptx·XlsxWriter·PyMuPDF·mammoth·markdownify·ebooklib·nbconvert·openpyxl
- Pillow·numpy·requests·beautifulsoup4·curl_cffi·google-genai·flask·edge-tts
- 선택 Playwright/Chromium·OfficeCLI·Pandoc·Codex CLI·외부 이미지/TTS API

따라서 repository 전체 clone·사용자 `pip install`·nested `codex exec`을 T5 기본 제품 경계로 채택하지 않는다.

### 19.4 제품 구조 — 하나의 T5, 격리된 전문 작업실

```text
사용자 Conversation
→ T5가 목적·청중·자료·사용처 결속
→ deferred `presentation_craft` capability
→ 격리된 Presentation Studio Worker
→ deck strategy·design system·SVG·PPTX candidate·validation
→ T5 independent Observer
→ F publication·Artifact Preview·Version·Undo·Delivery
→ T5가 최종 답
```

사용자-facing 별도 Agent·persona·대화방을 만들지 않는다. Worker는 Work-scoped managed capability이며 T5의 Memory·
authority·최종 답을 소유하지 않는다.

### 19.5 두 제작 경로 보존

| 경로 | 적합한 목적 | 성능 원칙 |
|---|---|---|
| 기존 `document-data` | 짧고 정확한 기본 PPTX·표·출처 중심 | 빠르고 저렴 |
| Presentation Studio | 임원 보고·제안서·IR·강의·브랜드·template deck | 더 무겁지만 비교 우위 품질 |

현재 `document-data`를 제거하거나 모든 PPT 요청을 Presentation Studio로 보내지 않는다. 모델은 audience·usePurpose·
deliveryMedium·visual goals·template reality로 두 capability 중 적절한 것을 선택하고, Runtime 업무 Router는 만들지 않는다.

### 19.6 T5가 대신 소유할 외부 경계

| 원본 방식 | T5 적용 |
|---|---|
| Codex CLI image backend | T5 Image capability와 exact Artifact handle |
| API key·`.env` 직접 읽기 | T5 Secret Store·Connection |
| 자체 web fetch·image search | T5 Web·Browser·source provenance |
| 자체 confirmation server | T5 Conversation card·NX2-SE |
| 자체 project/output | managed workspace·F publication |
| 자기 validation PASS | T5 independent Observer·Receipt |
| 고정 Pretendard | user-approved font·brand profile |
| runtime pip/npm install | pinned managed runtime·asset acquisition |
| 모든 template 기본 포함 | minimum pack + managed on-demand asset |

### 19.7 Design Profile

사용자의 회사 template·logo·design guide·`design.md`를 Core Prompt에 넣지 않는다. source-bound versioned profile 후보로
관리한다.

```yaml
profile:
  sourceHandles: exact current references
  audienceDefaults: optional
  typography: user approved
  colorTokens: source derived and confirmed
  layoutFamilies: bounded
  chartPreferences: bounded
  prohibitedPatterns: explicit
  evidence: sample deck and human review
  status: candidate | active | archived
```

sample deck와 fresh purpose A/B에서 이긴 profile만 활성화하고 template·현재 사용자 교정과 충돌하면 archive한다.

### 19.8 개발 Gate

#### PS-0 — Source·License·Dependency Qualification

- exact commit·file inventory·license·asset 고지
- subprocess·network·secret·runtime install 감사
- macOS·Windows runtime reality
- 제품 변경 0

#### PS-1 — Deterministic Core Isolation

- source conversion·SVG→DrawingML·template fill·geometry·PPTX verification 최소 core
- network·API·Codex·TTS 0
- declared scratch/output·resource bound·Stop·cleanup
- 원본 저장소와 exact fixture parity

#### PS-2 — Presentation Studio Worker

- exact Work/revision·source manifest·purpose contract
- persistent but bounded worker context
- progress·checkpoint·Stop·parent-death·restart settlement
- candidate output만 scratch에 생성, 사용자 target write 0

#### PS-3 — T5 Capability Bridge

- T5 Web·Image·Browser·Secret·Artifact·Receipt 연결
- 외부 material은 exact source·license·citation
- strategy/design 선택은 canonical chat card
- NX2-SE의 부분 질문·교정은 explicit Apply 뒤 R+1

#### PS-4 — Template·Design Profile

- raw PPTX template fill
- brand/design source 관측
- profile candidate·sample deck·activation·archive
- 같은 브랜드 한 스타일 강제와 layout 다양성 holdout

#### PS-5 — Actual Design AB/BA

동일 source·목적·모델·시간/비용 기록으로 비교한다.

- 현재 T5 `document-data`
- T5 Presentation Studio
- pinned Slide Master 원본
- 가능한 경우 인간 제작 기준

평가:

- source·숫자·범위 정확성
- 첫 Preview·final wall·model/Tool rounds·tokens
- hierarchy·typography·spacing·color·contrast·slide rhythm
- chart/table·editable object·notes·overflow·render
- 사용자가 핵심을 찾는 시간·수정 횟수·실제 발표 사용 의향

#### PS-6 — Minimal Product Integration

- deferred on-demand capability
- 일반 Direct·파일·기본 PPT 요청의 bytes·Tool·wall 증가 0
- minimum core만 기본 package, 대형 asset은 managed acquisition
- 실패 시 기존 `document-data` 귀환선

#### PS-HQ — Actual Console·PowerPoint Human Qualification

```text
자료 첨부
→ 전략·디자인 확인
→ slide별 실제 progress와 first Preview
→ 전체 live Preview
→ NX2-SE 부분 탐색·교정
→ editable PPTX Download·Reveal
→ 실제 PowerPoint 요소별 편집
→ Version·Undo
→ Telegram 요청·정기 Automation 한 목적
→ clean second whole-flow
```

### 19.9 절대 비목표

- 별도 사용자-facing Agent·Memory·Work·Artifact Store
- 모든 PPT 요청의 강제 진입
- 원본 저장소 전체의 무검증 copy
- Runtime의 audience·story·디자인 의미 선택
- API key·cookie·Codex OAuth를 Worker에 전달
- 자기 validation·exit 0을 제품 성공으로 사용
- template·AI image·narration의 자동 외부 effect
- package·Windows PASS를 source 자격으로 주장

### 19.10 최종 합격식

```text
현재 source truth·Artifact·Undo 무회귀
AND simple PPT는 document-data 속도·품질 유지
AND Crafted deck blind 인간 품질 우위
AND native editable PPTX·전체 render·overflow 0
AND T5 독립 Observer와 Receipt PASS
AND side correction·Version·Undo·Telegram·Automation 실제 여정 PASS
AND 일반 요청의 Context/model/Tool cost 증가 0
AND macOS·Windows 물리 자격은 각각 실제 실행으로만 주장
AND PS-HQ clean second whole-flow PASS
```

### 19.11 전체 계획 최종 완료 문장

> T5는 사람과 목적을 이해하고 현실을 정확히 다루는 것에 더해, 임원 보고·제안·교육·브랜드 발표처럼 전략과 미학이
> 중요한 결과를 전문 작업실 수준으로 제작한다. 사용자는 계속 하나의 T5와 대화하며, 결과는 실제 PowerPoint에서
> 편집되고 근거·Preview·부분 교정·Version·Undo·전달까지 같은 영수증 구조에서 완성된다.

이 문장은 PS-HQ의 clean second whole-flow 전에는 사용할 수 없다.
