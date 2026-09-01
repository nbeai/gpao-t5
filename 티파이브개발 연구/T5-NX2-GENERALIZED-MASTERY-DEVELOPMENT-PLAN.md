# T5 NX-2 — Generalized Mastery 개발 정본

상태: `OWNER_CURRENT_NX2_EXECUTION_SOURCE · NX_1_COMPLETE · NX2_0_COMPLETE · NX2_1_CURRENT_NOT_ACHIEVED · NX2_1C_CLOSED_NO_COMMON_OBSERVER_DELTA`

제품 기준 HEAD: `129b1db4` — model-selected bounded batch observation 자격

NX-1 완료 HEAD: `ad3e685c`

현재 제품 Gate: `NX2-1 — Integral Mastery Generalization · CURRENT PATH QUALIFICATION NOT ACHIEVED`

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
| Selection Side Exploration 패널·선택 UI | GUI 제품선이며 NX-2의 성능·숙련 일반화와 별도 | 연구 보존, 구현 0 |
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
NX2-1  Integral Mastery 업무·lane 일반화 — CURRENT
  ↓
NX2-2  Context Diet & Interface Intelligence
  ↓
NX2-3  Cognitive Flow·Practical Judgment 자격
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
| NX-2C Existing Path Common Observer Delta | NX2-1 기존 경로의 실제 공통 미달 | CURRENT |
| NX-2D Five-Lane Proportionality | NX2-1 일반화·무회귀 자격 | PENDING |

현재 고정 순서:

```text
NX2-1C 기존 file_reality → bind_sources → integral_method actual trace
→ 서로 다른 두 목적의 동일 observer gap만 기존 경계에서 최소 보강
→ 매출·미수금·재고·계약 공통 자격
→ NX2-1D Direct·Single·Multi-source·Artifact·Program five-lane
→ NX2-1 closeout
→ NX2-2 Context Diet & Interface Intelligence
→ NX2-3 Cognitive Flow & Practical Judgment
→ NX2-4 Auditory Intelligence
→ NX2-5 Web Intelligence Collector
→ NX2-6 Naver Identity·Mail·Blog
→ NX2-7 Experience Promotion
→ NX2-HQ Competitive Whole Human Qualification
```

NX2-1C가 실패하면 같은 문구·업무별 규칙을 더하지 않고 NX-1 귀환선을 유지한다. 실패한 NX2-1을 건너뛰어 NX2-2
이후 기능으로 목적 실패를 덮지 않는다. 반대로 NX2-1이 닫힌 뒤에는 현재 계획에 없는 새 Gate를 임의로 끼워 넣지 않는다.

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

---

## 7. NX2-1 — Integral Mastery Generalization — CURRENT

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

## 8. NX2-2 — Context Diet & Interface Intelligence

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

#### AU-1 — Audio Reality & Native Decode

- exact file handle·revision·digest
- container·codec·duration·track·sample rate
- decode range와 실패 지점
- audio 없는 영상과 손상 media 분리

#### AU-2 — Helper & Model Acquisition

- pinned asset manifest·hash·license·size
- 최초 사용 전 명시적 다운로드와 progress
- partial/corrupt asset fail-closed
- 제거·재설치·platform path

#### AU-3 — Managed Transcription Spine

- D의 managed process·output handle·Stop·parent-death 재사용
- chunk·VAD·deadline·resource bound
- restart 뒤 completed chunk 재사용, 중복 전사 0

#### AU-4 — Transcript Coverage & Truth

- chunk별 source time range·coverage
- 누락·겹침·decode 실패·low confidence
- 모델이 듣지 않은 구간을 추론해 채우지 않음

#### AU-5 — Transcript Artifact & Work Result

- TXT·SRT·VTT·회의록·할 일 Artifact
- source lineage·version·Undo
- exact quote와 요약 분리
- 사용자가 요구한 형식만 발행

#### AU-6 — Natural Activation & Channels

- local attachment·Telegram media·기존 파일의 같은 계약
- audio/video일 때만 on-demand 발견
- 모든 파일·대화에 Whisper schema 상시 노출 0

#### AU-7 / AU-HQ

- platform·성능·경제성
- 빠른 음성 메모, 긴 회의, 영상 자막의 실제 Console 전 여정
- Enter/첨부→progress→첫 transcript→최종 Artifact→교정→Download/Reveal/Undo

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

#### WC-1 — Collection Specification

모델이 다음을 선언한다.

- starting URLs
- desired entities·fields
- coverage boundary
- freshness
- pagination/stop condition
- output form

Runtime은 이 의미를 만들지 않고 exact contract·권한·실행만 보존한다.

#### WC-2 — Structure Reconnaissance

- list/detail/pagination/duplicate/canonical URL
- robots·rate limit·terms 관측
- 공개 범위와 로그인 범위 분리
- hidden oracle fixture에서 coverage 검증

#### WC-3 — Generated Collector Capsule

- 사이트별 코드를 영구 Core에 넣지 않음
- fixture에서 먼저 실행
- actual public input에서 bounded 1회 실행
- host observer가 record count·schema·duplicates·coverage 재검증
- network host allowlist·rate·deadline

#### WC-4 — Artifact·Automation

- CSV/XLSX/JSON/보고서 Artifact
- source URL·observed time·coverage·unknown
- 변경 감시와 diff는 Automation에 결속
- 사이트 구조 변경 시 stale method로 중단, 무한 재시도 0

#### WC-HQ

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

#### NV-1 — Login Persistence Opposing Test

- “로그인 상태 유지” 미선택/선택
- clean restart 뒤 Mail·Blog read-only actual
- cookie export·복사 없이 same managed profile

#### NV-2 — Naver Identity Broker

- signed-in/expired/2FA-required/locked/unknown
- profile identity와 app-password secret ref 분리
- 재로그인·forget·backup/restore 경계

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

## 18. NX-2 완료 문장

> T5는 특정 업무용 기능 묶음이 아니라, 사용자의 표현 수준과 자료 형식과 실행 수단이 달라져도 현재 현실을 정확히
> 파악하고 적절한 깊이와 방법을 선택해 더 빠르고 정확하며 더 좋은 결과를 만든다. 필요한 경우 파일·문서·프로그램뿐
> 아니라 음성·공개 웹·네이버 실무까지 같은 권한·증거·취소·복구 구조에서 다루고, 실제로 우월했던 방법만 현재 상황에
> 맞게 재사용한다. 단순한 대화는 여전히 가볍고 자연스럽다.

이 문장은 NX2-HQ의 clean second pass 전에는 사용할 수 없다.
