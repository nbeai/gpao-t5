# T5 Cognitive Flow 연구 — 모델의 자연스러운 추론을 현실의 문제 해결과 목표 달성으로 연결하기

기록일: 2026-08-30
최초 종합 기준 head: `c96cc1b1`
상태: `SYNTHESIS_COMPLETE · EXTERNAL_RESEARCH_MAPPED · PRODUCT_IMPLEMENTATION_NOT_OPEN`

## 1. 연구 목적

인간의 생활과 사업은 다음 순환을 반복한다.

```text
현재 현실
→ 문제 또는 목표
→ 상황 파악
→ 판단 기준
→ 선택
→ 행동
→ 결과 확인
→ 교정·학습
→ 새로운 현실
```

인간이 정보를 습득하고 공부·연구·고민·모방·창작을 하며, 코칭·조언·컨설팅·고용·동업을 사용하는 이유도 이
순환을 더 잘 수행하기 위해서다.

T5의 최우선 목표는 답변 생성이나 Tool 사용 자체가 아니다.

> 사용자가 삶과 사업의 문제나 목표를 평소 말로 설명하면, T5는 현재 현실과 맥락을 함께 파악하고 좋은 판단과
> 선택을 돕는다. 맡긴 범위에서는 가장 적절한 방법을 사용하거나 만들어 실제로 행동하고, 결과를 확인하며,
> 사용자 교정과 실제 경험에서 다음 현실까지 이어가는 AI 파트너가 된다.

이 연구는 그 목표를 위해 모델의 자연스러운 추론·언어 능력을 기계적 사고 템플릿으로 대체하지 않고 더 잘 발휘되게
하는 Context·Hand·Feedback·Continuity의 흐름을 설계한다.

## 2. 중심 가설

모델의 유효 지능은 Prompt 문장 수나 고정 reasoning 단계로 증가하지 않는다.

```text
좋은 현실
+ 필요한 맥락
+ 선택의 자유
+ 실제 피드백
+ 현재 사용자와의 연속성
= 현실에서 발휘되는 모델 지능
```

T5가 해야 하는 것은 모델보다 더 좋은 사고 알고리즘을 만드는 일이 아니다.

> 모델이 사용자의 현실 안에서 생각하고 행동하고 결과를 보며 다시 판단할 수 있도록, 지능이 막히지 않는 순환을
> 만드는 것.

기술명 후보:

- `T5 Cognitive Flow`
- `Natural Practical Intelligence Loop`
- `Living Context & Action Flow`
- `Mixed-Initiative Work Intelligence`

이 문서에서는 `T5 Cognitive Flow`를 사용한다.

## 3. Flow와 Template의 차이

### Template·Workflow

```text
1. 상황 분석
2. 목표 정의
3. 대안 세 개
4. 장단점 비교
5. 실행 계획
6. 결과 검증
```

입력 종류와 관계없이 같은 단계·질문·출력 구조를 강제한다. 예측 가능하지만 사용자의 다양성과 모델 판단을 제한한다.

### Cognitive Flow

```text
현재 사용자 말과 현실
↔ 모델의 이해와 판단
↔ 필요한 관측·질문·행동
↔ 새 Evidence·Effect
↔ 사용자 교정
↔ 다시 판단 또는 자연스러운 중단
```

현재 상황에 따라 바로 답하거나, 한 번 관측하거나, 사용자 결정을 묻거나, 여러 Hand를 조합하거나, 방법을 만들거나,
충분히 끝났으면 멈춘다. 순서와 깊이는 모델이 현재 Reality로 판단한다.

## 4. T5 Cognitive Flow의 참여자

```text
Human
목적·가치·교정·결정·중단
        ↕
Model
이해·통찰·선택·방법·언어·완료 판단
        ↕
T5 Runtime
Context·Reality·Capability·권한·실행·Effect·Artifact·Recovery
        ↕
Computer & World
파일·문서·정보·앱·프로세스·사람·외부 효과
```

역할 경계:

| 주체 | 소유하는 것 | 소유하지 않는 것 |
|---|---|---|
| 사용자 | 가치·목적·현재 교정·중요한 결정·중지 | Tool 이름·내부 절차·기술 설정 |
| 모델 | 의미·깊이·방법·질문·추천·완료·자연어 | 실제 권한·실행·Effect·source truth |
| Runtime | current facts·identity·scope·execution·receipt·recovery | 업무 의미·본질·최적 방법·사용자 가치 |
| Hand/Capability | 명확한 input/output 행동 계약 | 사용자 목적·최종 완료 판단 |

## 5. 모델이 선택할 수 있는 현재 affordance

이는 고정 상태 기계나 출력 schema가 아니다. 현재 순간에 모델에게 실제로 열려 있는 행동의 의미다.

```text
Speak
현재 재료로 충분히 답함

Observe
판단을 바꿀 현실을 더 봄

Ask
사용자만 결정할 수 있는 중요한 사실을 물음

Act
허용된 범위에서 현실을 바꿈

Compose
여러 기존 Hand를 한 방법으로 조합

Make
현재 능력으로 부족한 작은 방법·프로그램을 제작

Stop
충분히 끝났거나 현재 한계를 정직하게 밝힘
```

Tool schema는 해당 행동이 실제로 필요할 때만 progressive disclosure로 열린다.

## 6. 외부 연구 지도

### 6.1 추론과 행동의 폐루프 — ReAct

[ReAct](https://arxiv.org/abs/2210.03629)는 추론과 외부 행동을 교대로 수행하면 계획 수정·예외 처리·환각 감소에
도움이 된다는 것을 보였다.

흡수:

- 판단과 행동을 분리된 one-shot 단계로 보지 않음
- 행동 결과가 다음 판단을 수정
- 예외와 새 정보에 따라 계획 변경

복제하지 않음:

- `Thought→Action→Observation` 텍스트 템플릿
- chain-of-thought 저장·노출
- 단순 Direct까지 agent loop로 변환

### 6.2 목적 적합성과 현실 실행 가능성 — SayCan

[SayCan](https://arxiv.org/abs/2204.01691)은 언어모델의 목적 적합성과 현재 환경에서 skill 실행 가능성을 결합했다.

흡수:

```text
모델: 이 행동이 목적에 도움이 되는가
Runtime: 현재 이 행동이 실제 가능한가
```

복제하지 않음:

- 고정된 skill bank만으로 T5의 전체 방법 공간 제한
- Runtime value score가 모델의 의미 판단을 대체

### 6.3 환경·사람 피드백 — Inner Monologue

[Inner Monologue](https://arxiv.org/abs/2207.05608)는 행동 성공·장면 변화·사람 교정 등 환경의 자연어 피드백이
closed-loop 계획 성능을 높인다는 것을 보였다.

흡수:

- actual Effect·scene·result·user correction을 다음 모델 판단에 공급
- 방법은 환경 변화에 따라 수정

복제하지 않음:

- 내부 reasoning 원문 저장
- 모델 자기 독백을 source truth로 사용

### 6.4 모델 작성 프로그램 — Code as Policies

[Code as Policies](https://arxiv.org/abs/2209.07753)는 LLM이 perception·control API를 조합하는 프로그램을 작성해
반복·조건·계산·새 함수로 처음 보는 행동 정책을 구성할 수 있음을 보였다.

흡수:

- 자연어 목적을 executable method로 변환
- 기존 API와 library를 새 조합으로 사용
- perception feedback을 method 안에서 처리

복제하지 않음:

- 사용자 현실에서 unsandboxed code 실행
- 프로그램 exit 0·자체 검증을 목적 완료로 사용
- 모든 과업을 code generation으로 전환

### 6.5 생산 제품의 bounded programmatic flow — OpenAI

공식 [OpenAI Model Guidance](https://developers.openai.com/api/docs/guides/latest-model)는 Programmatic Tool Calling을
filtering·joining·ranking·deduplication·aggregation·validation처럼 여러 결과를 예측 가능하게 처리하는 bounded
단계에 권장한다.

직접 호출을 유지할 조건:

- 한 Tool call이면 충분
- 각 결과가 다음 의미 판단을 바꿈
- 사용자 승인 필요
- citation·native Artifact 보존 필요
- program 작성 전 output shape를 알 수 없음

흡수:

- model/tool 왕복 병목이 실제로 있는 bounded stage에만 programmatic flow 사용
- semantic judgment·approval·final validation은 모델 직접 경로
- direct vs programmatic 동일 목적 A/B
- calls 감소보다 최종 정확성·완전성·Evidence 우선

복제하지 않음:

- Programmatic Tool availability만으로 자동 route
- 모든 dependent call을 한 프로그램으로 합침
- provider-specific feature를 T5 Core 의미로 고정

### 6.6 단순·조합 가능한 Agent — Anthropic

[Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)는 predefined code path인
workflow와 모델이 과정을 동적으로 지휘하는 agent를 구분하고, 가능한 가장 단순한 해법부터 시작할 것을 권고한다.

흡수:

```text
single model call로 충분 → Direct
예측 가능한 반복 절차 → bounded workflow/Skill
유연한 판단 필요 → agent loop
```

복제하지 않음:

- agent framework 자체를 제품 가치로 사용
- 복잡성 증가를 지능 향상으로 간주
- 모든 복합 요청을 autonomous agent로 전환

### 6.7 Prompt보다 Context — Anthropic Context Engineering

[Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)은 Context를
유한한 attention budget으로 보고, 매 inference에서 가장 작은 고신호 token 집합을 공급해야 한다고 설명한다.

흡수:

- minimal but sufficient Context
- just-in-time retrieval
- 현재 관련 Tool·Memory·Evidence만
- 장기 작업 milestone compaction
- brittle if-else Prompt와 지나치게 추상적인 철학 Prompt 양쪽 회피

복제하지 않음:

- 모든 History·Tool result·Memory의 전량 주입
- Context 부족을 전역 Instruction 증식으로 해결

### 6.8 Tool이 모델의 사고 환경 — Anthropic Tool Design

[Writing Effective Tools for Agents](https://www.anthropic.com/engineering/writing-tools-for-agents)는 Tool을 deterministic
system과 non-deterministic agent 사이의 인터페이스로 본다.

흡수:

- Tool 이름·입력·출력·오류를 모델이 이해하기 쉽게 설계
- 목적 중심 search·bounded result·pagination·filter
- 자주 연결되는 deterministic 작업을 한 bounded Tool로 축약 가능
- 현실적인 evaluation과 여러 유효 전략 허용
- Tool overlap·Context 비용 최소화

복제하지 않음:

- 기대 Tool sequence를 정답으로 고정
- Tool 호출 수를 목적 성공으로 사용

### 6.9 Context·Memory·Reflection

- [MemGPT](https://arxiv.org/abs/2310.08560): memory tier와 interrupt를 사용한 virtual context management
- [Generative Agents](https://arxiv.org/abs/2304.03442): observation·memory retrieval·reflection·planning
- [Reflexion](https://arxiv.org/abs/2303.11366): 실패 피드백을 언어 Reflection으로 다음 시도에 제공
- [Voyager](https://arxiv.org/abs/2305.16291): 환경 오류·self-verification·executable skill library
- [Agent Workflow Memory](https://proceedings.mlr.press/v267/wang25bx.html): 반복 trajectory에서 workflow를 유도하고
  관련 과업에 선택적으로 제공

흡수:

- History 전량이 아닌 관련 pointer와 exact reopen
- 사용자 새 입력의 interrupt 우선
- 실제 실패·교정·다른 방법 성공에서 재사용 후보
- 반복 workflow의 selective retrieval

복제하지 않음:

- 모델 자기 Reflection을 실제 성공으로 간주
- 모든 경험을 자연어 Memory로 저장
- 한 번 성공한 workflow·program의 자동 Skill 승격
- 과거 Reflection이 current correction보다 우선

### 6.10 사용자 역량 격차 완화

[Noy·Zhang](https://doi.org/10.1126/science.adh2586)의 전문 글쓰기 실험에서는 ChatGPT 사용으로 평균 작업 시간이
감소하고 품질이 올라갔으며 상대적으로 낮은 숙련도의 참가자가 더 큰 혜택을 받았다.

[Brynjolfsson·Li·Raymond](https://doi.org/10.1093/qje/qjae044)의 고객지원 현장 연구에서도 AI 지원의 생산성 효과가
초보·저숙련 직원에게 더 컸다.

흡수:

- 전문가 Prompt를 모르는 사용자도 암묵지·좋은 방법에 접근 가능
- 같은 목적의 표현 수준에 따른 결과 격차를 제품 지표화

주의:

- 과업·조직·모델 frontier 밖에서는 효과가 반대일 수 있음
- 사용자의 전문성과 가치 판단을 AI가 대체하지 않음

### 6.11 획일화와 창의성 손실

[Science Advances 연구](https://doi.org/10.1126/sciadv.adn5290)는 AI 지원이 개인 창작 품질을 높이면서 집단 결과의
다양성을 낮출 수 있음을 보였다. [LLM 글쓰기 동질화 연구](https://doi.org/10.1016/j.chbah.2025.100207)도 집단 수준
아이디어 다양성 감소를 보고했다.

흡수:

- User Capability Equalization과 Rigidity Holdout을 동시에 평가
- 평균 품질 개선과 답변·관점·방법 다양성을 별도 측정

금지:

- 모든 사용자에게 같은 조언·질문·구조·결론
- 오너 방법론을 기본 답변 persona로 강제

### 6.12 인간의 주체성과 적절한 의존

[Microsoft Human-AI Interaction Guidelines](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/)
는 시스템의 능력·한계 표시, 효율적 교정·해제, 사용자 통제, 신중한 학습을 강조한다.

[To Trust or to Think](https://www.eecs.harvard.edu/~kgajos/papers/2021/bucinca2021trust.shtml)는 설명 제공만으로 AI
과신이 줄지 않으며, cognitive forcing은 과신을 낮출 수 있지만 UX 만족도와 사용자 성향에 따른 trade-off가 있음을
보였다.

흡수:

```text
저위험·가역·명확 → 자연스럽게 도움·실행
중요한 판단 → 사실·추천·불확실성·사용자 결정 분리
고위험 가치 결정 → 사용자의 독립 판단과 전문 경계 보존
```

복제하지 않음:

- 모든 사용자에게 먼저 독립 답을 쓰게 하는 cognitive forcing
- 설명을 많이 주면 적절한 신뢰가 생긴다는 가정

### 6.13 Mixed-Initiative Interaction

Mixed-initiative의 핵심은 인간과 AI가 상황에 따라 시작·제안·교정·중단·통제권 이양을 할 수 있는 관계다.

T5 적용:

- 사용자는 언제든 현재 목적을 교정·중단
- 모델은 중요한 누락·대안·위험을 제안
- Runtime은 사용자 범위와 actual effect를 보존
- T5는 필요할 때 주도하되 사용자 가치·결정을 빼앗지 않음

## 7. 외부 평가에서 배울 것

### GAIA

[GAIA](https://arxiv.org/abs/2311.12983)는 사람에게 개념적으로 단순하지만 AI에는 reasoning·multimodality·web·Tool
사용이 필요한 현실 질문을 평가한다.

### τ-bench

[τ-bench](https://arxiv.org/abs/2406.12045)는 사용자와 Agent의 동적 대화·Tool·policy·상태 변화를 평가한다.

### WorkArena

[WorkArena](https://arxiv.org/abs/2403.07718)는 지식근로자의 실제 업무 시스템 과업을 평가한다.

### TheAgentCompany

[TheAgentCompany](https://arxiv.org/abs/2412.14161)는 Web·코드·프로그램·동료 소통을 포함한 회사 업무를 평가한다.

T5 적용:

- 전문 지식 퀴즈보다 사람이 자연스럽게 끝낼 실제 목적
- 단일 Prompt보다 사용자 교정과 상태 변화
- Tool success보다 actual effect·result usability
- 다양한 유효 방법을 허용하되 사용자 목적은 검증 가능
- 반복 실행의 신뢰성과 비용

## 8. 외부 연구가 보여준 네 긴장

### 모델 자유 vs 제품 신뢰성

자유가 크면 유연하지만 예측이 어렵다. 고정하면 일관되지만 획일화된다. 의미 판단은 모델에 두고 Runtime은 현실·
권한·실행·검증을 맡는다.

### 관련 Context vs attention 오염

정보가 부족하면 판단 실패, 너무 많으면 context rot·반복·주의 분산이 생긴다. 현재 목적의 작은 high-signal delta를
공급한다.

### 방법 재사용 vs 현재 적응

검증된 방법은 속도와 숙련을 높이지만 과거 workflow가 current correction과 새로운 상황을 가리면 안 된다.

### AI 주도성 vs 인간 주체성

AI가 소극적이면 사용자가 모든 문제를 구조화해야 한다. 과도하게 주도하면 사용자의 가치와 판단을 대체한다.
상황·위험·가역성에 따라 initiative를 조절한다.

## 9. 현재 T5에서 이미 선 기반

이 연구는 다음을 새로 만들지 않는다.

### Direct·Natural Agency

- 직접 답할 요청은 Work·Tool 없이 답함
- 실제 Hand가 필요할 때만 Work 결속
- 모든 입력을 Agent 작업으로 만들지 않음

### Context & Judgment

- instruction family·directory-first Tool discovery
- relevant Memory pointer·exact reopen
- Evidence Context와 provider continuity
- 현재 사용자 교정 우선
- 충분히 끝났으면 추가 계획을 붙이지 않는 Natural Agency

### Reality·Hand

- File·Document·Web·Browser·Terminal·Connection·Capability Reality
- source identity·revision·coverage·freshness
- 필요한 Tool만 progressive disclosure

### 실행 신경계

- Work·Run·Resource·Effect·Receipt
- D process·large output·wake·crash settlement
- E confinement·unexpected effect observation
- F transaction·atomic publication·Undo
- G same-language program·immutable source universe·independent verification·Artifact

### 결과·연속성

- Artifact·Preview·Download·Reveal·Version·Delivery
- busy input·current correction·cancel·restart·model fallback
- whole-state backup·restore

### Experience Growth

- actual Work·correction·method failure→alternative success source
- proposal-only review
- AB/BA·near-miss·independent field·fresh purpose
- managed Skill promotion·regression rollback

현재 T5는 단순 Tool 상자가 아니다. 사용자 목적→현실→행동→검증→결과→교정의 많은 기관이 이미 제품에 있다.

## 10. 현재 T5에서 남은 Cognitive Flow 연구 질문

이는 현재 제품 실패 확정이 아니라 product change 0 baseline으로 확인할 질문이다.

### A. 표현 수준에 따른 목적 결과 격차

전문가의 상세 지시와 일반 사용자의 짧고 모호한 지시가 같은 실제 목적에서 얼마나 다른 결과·질문·비용을 만드는가.

### B. 현재 상황 projection의 충분성

모델이 필요한 current correction·새 Evidence·완료 사실·unknown·관련 Capability를 놓치거나, 반대로 너무 많은 과거
Context 때문에 집중을 잃는가.

### C. Tool-first·질문-first 편향

직접 답할 수 있는데 Tool을 찾거나, 현실에서 확인할 수 있는데 사용자에게 묻거나, 한 Hand로 충분한데 여러 Hand를
여는가.

### D. Evidence 반복과 과잉 검증

같은 source를 반복 reopen하거나, 이미 목적을 증명한 뒤 보조 검사를 추가하고, 그 실패를 전체 실패로 확대하는가.

### E. 단계별 모델 현장 감독 비용

정확한 복합 작업에서 model→Tool→model 왕복이 품질에 필요한지, 아니면 bounded filtering·join·aggregation을 Method/
Tool 안에서 처리해도 되는지.

### F. 자연스러운 중단

충분히 끝났을 때 멈추는가. 중요한 미확인을 남긴 채 조기 종료하거나 완벽을 위해 완성을 지연하는가.

### G. Experience 적용의 유연성

검증된 Skill·방법이 실제로 다음 일을 개선하는가. 사용되지 않는 장식품, 과거 방법 강제, 후보 잡동사니가 되는가.

### H. 사용자 주체성

추천이 사용자의 결정을 돕는가, 아니면 과도한 확신과 고정 프레임으로 사용자의 판단을 대체하는가.

## 11. 설계 원칙

### 사고 구조가 아니라 사고 환경

고정 Situation schema·Intent enum·ActionPlan을 만들지 않는다. 사용자 원문·현재 Reality·새 Evidence·현재 가능한 Hand·
중요한 unknown을 필요한 순간에 공급한다.

### 모델은 의미를 소유

본질·중요도·원인·최적 방법·완료·사용자 문장은 모델이 판단한다. Runtime 정규식이 대신하지 않는다.

### Event-driven reorientation

다음 actual 사건에서만 새 판단을 연다.

```text
사용자 새 입력·교정
새 Evidence
Tool failure
actual Effect
Artifact result
unknown
cancel·restart
```

새 사건이 없으면 상태 문구를 바꾸기 위해 모델을 다시 호출하지 않는다.

### Minimal current pulse

모델에게 매번 모든 History를 주지 않는다.

```text
현재 사용자의 말과 교정
방금 새로 확인된 사실
이미 실제로 끝난 것
아직 확인하지 못한 중요한 것
현재 관련된 행동 가능성
사용자 결정이 필요한 것
```

없는 항목은 생략한다. 이 pulse는 분석 결론이나 새 canonical store가 아니라 existing truth의 bounded projection이다.

### Affordance, not tool catalog

모델이 `파일을 찾을 수 있음·현재 문서를 읽을 수 있음·결과를 수정할 수 있음·외부 행동은 결정 필요` 같은 현재
행동 가능성을 이해하고, exact Tool schema는 실제 선택 시 연다.

### Actual feedback

모델 자기평가 대신 actual file·Effect·Artifact·Delivery·사용자 교정을 다음 판단에 돌려준다.

### Proportional depth

```text
단순 요청 → 즉시 답
중요한 현실 부족 → 필요한 관측
사용자 가치 결정 → 추천과 선택 분리
복합 반복 처리 → bounded composition 후보
충분한 결과 → 자연스럽게 중단
```

### Current user always wins

Memory·Skill·과거 Method·오너 관점은 current user correction보다 우선하지 않는다.

## 12. 개발 계획

모든 단계는 앞 단계의 실제 실패가 있을 때만 열린다. `CF-0` 외 전체를 한 번에 개발하지 않는다.

### CF-0 — Current Cognitive Flow Baseline

상태 목표: `PRODUCT_CHANGE_0`

같은 실제 목적을 다음 표현으로 실행한다.

```text
전문가의 상세 지시
일반적인 평범한 지시
짧고 모호한 지시
감정과 맥락이 섞인 지시
진행 중 교정된 지시
```

대표 목적:

- 직접 설명·의견
- 현재 공개 정보
- 모호한 파일 발견
- 여러 자료 비교·대사
- 결과 문서 생성·수정
- 기존 프로젝트 또는 프로그램 작업
- 실패 후 다른 방법
- 장기 실행·busy input·cancel
- 충분히 끝난 작업

각 model call에서 content-free flow trace를 기록한다.

```yaml
currentUserRevision:
projectedContextCategories:
newEvidenceCount:
availableHandCategories:
modelChoice: speak | observe | ask | act | compose | make | stop
toolCalls:
reopenedEvidence:
actualEffects:
userQuestions:
completionDisposition:
firstUsefulMs:
finalMs:
tokens:
```

reasoning·사용자 원문·비밀·실경로를 evidence에 저장하지 않는다.

CF-0 종료:

- 이미 충분함 → `CLOSED_WITH_CURRENT_CAPABILITY · PRODUCT_CHANGE_0`
- 최초 실패 경계 하나 → 관련 CF slice 하나만 개통

### CF-1 — Current Situation Pulse

개통 조건: 모델이 current correction·새 Evidence·완료·중요 unknown을 놓치는 실패가 세 목적에서 반복.

새 Store 없이 Conversation·Work·Memory pointer·Evidence·Effect·Artifact·Capability에서 현재 판단에 필요한 작은
projection만 파생한다.

금지:

- Runtime의 목적·원인·우선순위 결론
- 모든 항목 강제
- 사용자 원문 대체
- persistent Situation DB

A/B:

- 목적 성공·질문·Tool·중단 개선
- Direct Context 증가 0
- 답변 다양성 무회귀

### CF-2 — Evidence Delta & Context Refinement

개통 조건: 같은 source·ToolReceipt·Browser snapshot·Artifact 검증 반복이 실제 병목.

```text
이미 본 사실 → pointer
이번 사건의 새 fact → exact delta
다시 필요 → source reopen
milestone 이후 → loss-aware compaction
```

완료 사실·active assumption·사용자 교정·unresolved blocker·next concrete goal만 보존한다. 과거 Tool 원문과 중복
Evidence를 반복 투영하지 않는다.

### CF-3 — Affordance & Tool Economy

개통 조건: direct/one-Hand 요청에서 Tool-first, wrong Hand, capability discovery 지연이 반복.

기존 directory-first·tool_search·Capability Reality를 재사용하고 현재 관련 affordance와 Tool contract의 최소 차이만
수리한다.

평가:

- direct Tool 0 무회귀
- one Hand request의 discovery Turn 최소
- 잘못된 capability 준비 0
- Tool overlap·schema bytes·error recovery

### CF-4 — On-demand Practical Judgment Lens

개통 조건: 일반 사용자식 표현에서 목적·깊이·중요 미확인 판단이 실패하지만 현재 Reality는 충분.

[T5 실천지능 연구](./T5-PRACTICAL-JUDGMENT-RESEARCH.md)의 원리 후보만 사용한다.

```yaml
principle:
helpsWhen:
mustNotActivateWhen:
requiredReality:
counterexample:
rollback:
```

첫 후보는 전역 Prompt 변경이 아니라 격리 A/B의 on-demand Lens다. 무관한 요청에서 Context·Tool·calls·final format
증가 0이어야 한다.

### CF-5 — Proportional Action & Natural Stop

개통 조건: 충분한 결과 뒤 과잉 검증, 중요한 미확인 조기 종료, 사용자에게 묻지 않아도 될 반복 질문이 재현.

Runtime은 다음 content-free 사실만 공급한다.

- coverage·new/repeated Evidence
- achieved result·Artifact·Effect
- 남은 unknown
- 다음 행동의 authority·effect kind·관측 비용
- 사용자 요청 범위

모델이 `더 관측·질문·행동·중단`을 판단한다. fixed call/token/time cap·Runtime completion 판정·문장 사후 교정은
금지한다.

### CF-6 — Correction as Reorientation

개통 조건: 진행 중 교정 뒤 stale method·Tool effect·final answer가 계속되거나, 반대로 유용한 완료 결과를 모두 버림.

```text
current correction
→ stale semantic direction 중단
→ 이미 발생한 effect·Artifact 보존
→ 재사용 가능한 Evidence만 유지
→ 모델이 현재 목적에서 다시 판단
```

현재 Work revision·input admission·cancel·settlement를 재사용한다. 새 correction engine을 만들지 않는다.

### CF-7 — Bounded Method Composition

개통 조건: 정확한 복합 목적에서 단계별 model/tool 왕복이 주 병목이며 각 중간 결과가 fresh model judgment를 요구하지
않는 bounded stage가 확인됨.

[T5 Method Runtime 연구](./T5-METHOD-RUNTIME-RESEARCH.md)의 `MR-0`을 먼저 수행한다.

비교:

```text
현재 direct Tool loop
기존 bounded Hand 결과 개선
procedural Skill
provider-native programmatic tool calling
Terminal Method Capsule
```

semantic judgment·approval·native Artifact·final validation은 direct model 경로를 유지한다. 새 Runtime이 최선이라는
결론을 미리 두지 않는다.

### CF-8 — Experience Flow Qualification

개통 조건: 현재 Experience Growth 후보가 다음 유사 목적에서 선택되지 않거나, 과거 방법이 current user를 가림.

현재 S6-D/E를 재개발하지 않는다. 다음만 자격한다.

- 실제 사용자 설명·교정 감소
- same-quality wall·calls·tokens 개선
- method 적용/비적용의 자연스러움
- current correction 우선
- 후보 중복·잡동사니 0
- 회귀 시 active 제거·이전 경로 복원

## 13. User Capability Equalization 평가

목표는 전문가 Prompt를 일반 사용자의 의무로 만드는 것이 아니라 같은 실제 목적의 결과 격차를 줄이는 것이다.

```text
전문가식 상세 Prompt
vs 평범한 자연어
vs 짧고 모호한 자연어
vs 감정과 맥락이 섞인 자연어
```

측정:

- 목적 정확성·완전성
- 중요한 사실·누락·unknown
- 사용자 질문·교정·승인 수
- first useful·final wall
- model/tool calls·tokens·bytes
- Artifact·Effect·Undo·Delivery
- 사용자 통제감·신뢰·결과 사용성

합격:

```text
일반 사용자와 전문가 표현의 목적 결과 격차 감소
AND 질문·Tool·비용의 이유 없는 증가 없음
AND 중요한 사용자 결정 보존
AND 현재 사용자 교정 우선
AND 답변·방법 다양성 무회귀
```

## 14. Rigidity & Diversity Holdout

### 단순 요청 비개입

- 인사
- 맞춤법·번역
- 한 줄 설명
- 간단 계산
- 짧은 창작

고정 분석·목적 질문·Work·Tool·계획이 추가되면 실패다.

### 열린 문제 다양성

- 브레인스토밍
- 전략 대안
- 사람 관계
- 개인 고민
- 창작

답변의 단어 일치가 정답이 아니다. 복수의 합리적 관점·형식·방법이 허용돼야 한다.

### 사용자 차이

- 빠른 답 선호
- 자세한 근거 선호
- 전문가·비전문가
- 직접 결정·추천 선호

같은 문체·길이·질문 수를 강제하지 않는다.

다양성 측정은 style token이나 표현 차이만 세지 않는다. 목적 정확성을 유지한 상태에서 관점·근거·방법·출력 구조가
현재 사용자와 상황에 맞게 달라지는지 인간 평가로 확인한다.

## 15. Appropriate Reliance Holdout

### 과신 방지

- AI 추천과 observed fact 구분
- 공식 기준·권한이 없으면 승인·적격 단정 금지
- 중요한 unknown과 결과 영향 설명
- 사용자가 다른 선택을 할 수 있는 표면

### 과도한 마찰 방지

- 저위험·가역·명확 행동에 반복 승인 금지
- 모든 사용자에게 독립 답안·장문 분석 강제 금지
- 단순 요청에 불확실성 목록 남발 금지

### 사용자 주체성

T5는 사용자의 판단 능력을 대체하거나 약화시키는 것이 아니라 정보·대안·근거·실행 능력을 확장해야 한다.

## 16. Provider·Model 자격

모델마다 Runtime·Prompt를 따로 만들지 않는다.

공통 계약:

- current user·Reality·Capability·Effect 의미
- Tool input/output·retry safety
- Work·Artifact·Delivery·cancel
- Cognitive Flow 평가식

대표 기본 모델은 전체 CF-HQ를 수행하고, 보조 모델은 다음 holdout을 수행한다.

- Direct·단일 Hand
- 모호한 사용자 표현
- current correction
- bounded method 선택/비선택
- natural stop

차이가 모델 품질이면 Runtime 조건으로 숨기지 않고 qualified model observation으로 남긴다.

## 17. CF-HQ — 실제 인간 Flow 자격

상세 Mission·변형·oracle·점수·반복 신뢰성·중단선은 별도 연구 실행안인
[T5 Cognitive Flow HQ](./T5-COGNITIVE-FLOW-HQ-RESEARCH.md)를 사용한다. 이는 현재 release 총괄 HQ가 아니라,
CF-0에서 실제 실패가 재현되고 채택 가능한 Cognitive Flow 후보가 생긴 뒤에만 실행하는 미래 자격이다.

기능 smoke가 아니라 하나의 실제 사용자 목적을 관통한다.

```text
입력
→ 첫 feedback
→ 상황 파악
→ Direct/Observe/Ask/Act/Compose/Make 선택
→ 실제 Evidence·Effect
→ 진행 중 교정
→ 결과·Artifact
→ natural stop
→ 후속 수정·재사용
```

평가 역할:

- blind Human/Mission Runner
- UX Observer
- Evidence Auditor
- 단일 Final Judge
- 단일 Repair Owner

외부 benchmark 점수를 T5 완료로 사용하지 않고 우리 총괄 인간 HQ의 표현 변형·dynamic user·actual effect·결과 사용성
lane에 원리만 흡수한다.

완료 문장:

> 사용자가 문제와 목표를 자신의 평소 말로 설명하면 T5는 필요한 현실과 맥락을 파악하고, 현재 가능한 행동과
> 실제 피드백으로 판단을 계속 교정하며, 필요한 만큼만 질문·관측·행동한다. 결과를 실제로 확인하고 사용자가
> 교정·중단·결정할 수 있게 하며, 충분히 끝났으면 자연스럽게 멈춘다. 이 흐름은 단순 요청을 무겁게 만들거나
> 서로 다른 사용자의 생각과 표현을 한 템플릿으로 획일화하지 않는다.

## 18. 명확한 비목표

- 새 Cognitive Flow Engine·Store·database
- Intent enum·업무 Router·ActionPlan·고정 DAG
- `상황→목표→대안→계획` 고정 reasoning template
- chain-of-thought 저장·노출·평가
- 전역 Prompt에 오너 원리·외부 framework 전량 추가
- 모든 요청의 목적·사용처·기한 질문
- Tool·Skill·Agent 수 증가
- 사용자 능력·성격·직업 persona 고정
- AI의 사용자 가치·목표·최종 결정 대체
- 모든 복합 작업의 Programmatic Tool Calling
- 모든 경험의 Memory·Skill 승격
- 외부 benchmark 최적화
- 실천지능 연구를 핑계로 현재 제품 기능 재개발

## 19. 중단·폐기 규율

- CF-0에서 현재 T5가 충분하면 제품 변경 0으로 닫는다.
- 같은 결함 가족의 두 후보가 actual 사용자 성과를 높이지 못하면 세 번째 patch 금지.
- 정확성·완전성·current correction·Effect·Artifact·Undo·Delivery가 나빠지면 폐기.
- Direct·단일 Hand Context·calls·wall이 늘면 폐기.
- 답변 구조·질문·방법이 획일화되면 폐기.
- 모델 자기 Reflection이나 자연어 완료 주장을 evidence로 요구하면 폐기.
- 새 Store·Router·관리 UI가 먼저 필요하면 구조 재판정.
- 사용자에게 Prompt 작성법·Flow mode·Lens 선택을 요구하면 폐기.

## 20. 다른 연구와의 관계

### T5 실천지능

Cognitive Flow의 판단 Lens 후보. `helpsWhen·mustNotActivateWhen·counterexample`이 있는 원리만 CF-4에서 격리
A/B한다. 오너 말투·결론·persona는 기본 제품에 넣지 않는다.

### T5 Method Runtime

Cognitive Flow의 bounded 실행 조합 후보. CF-7의 실제 왕복 병목에서만 MR-0을 연다. Flow 전체를 Method schema로
강제하지 않는다.

### Document Reality

복합 source·관계·근거를 갖는 첫 고가치 실전 영역. Document 실패는 perception·selection·relation·reconciliation·
evidence UX·method cost로 먼저 분리하며 자동으로 Cognitive Flow나 Method 개발을 열지 않는다.

### Computer Use

안정된 Hand로 해결되지 않는 desktop app 현실의 마지막 감각·행동 연구. Flow나 Method가 Computer Hand 권한을
만들지 않는다.

## 21. 현재 권고 실행 순서

현재 release·배포·해당 플랫폼 자격을 먼저 완료한다. 이후 연구는 다음처럼 연다.

```text
총괄 HQ와 실제 사용자 Evidence 분석
→ CF-0 product change 0 baseline
→ 최초 실패 경계 하나
→ CF-1~8 중 관련 slice 하나
→ deterministic countertest
→ 같은 사용자 목적 A/B
→ User Capability Equalization
→ Rigidity·Appropriate Reliance holdout
→ 실제 인간 CF-HQ
→ 채택·완전 폐기·변경 0
```

여러 CF slice와 다른 연구 Gate를 동시에 열지 않는다.

## 22. 미래 세션의 시작 일곱 줄

오너가 이 연구를 다시 열면 구현부터 시작하지 않는다.

1. **제품 약속**: 사용자는 평소 말로 문제·목표를 설명하고 T5는 실제 결과까지 함께한다.
2. **현재 Gate**: 당시 오너가 명시적으로 연 Cognitive Flow 연구·개발 범위.
3. **사용자 완료 문장**: 필요한 깊이·행동·중단이 자연스럽고 사용자 표현 격차가 결과 격차로 확대되지 않는다.
4. **이미 선 증거**: 당시 Direct·Context·Memory·Tool discovery·Work·Effect·Artifact·Learning actual.
5. **가장 큰 미달**: CF-0의 서로 다른 세 목적에서 반복된 최초 Flow failure 하나.
6. **첫 변경 방식**: 새 Store·Router 없이 기존 projection·Tool contract·event edge 하나만 후보화.
7. **Non-goals**: reasoning template·persona·전역 Prompt 증식·Method/Computer/Document 자동 개통.

그 뒤 `CF-0`의 현재 제품 기준선부터 다시 확인한다. 이 문서의 존재와 외부 연구 결과는 제품 구현 승인·현재 실패·
성능 우위가 아니다.

## 23. 최종 연구 판정

외부 연구와 현재 T5를 종합하면 오너의 가설은 충분히 연구할 가치가 있다.

> 자연스러운 Agent 지능은 거대한 Prompt나 고정 Workflow에서 나오기보다, 모델이 현재 Reality와 affordance를 보고
> 행동하며 실제 환경과 사람의 피드백으로 다시 판단할 수 있는 폐루프에서 나타난다.

동시에 다음 위험도 실재한다.

> 좋은 방법·조언·Skill을 반복 제공하면 평균 성과와 초보자의 생산성은 높아질 수 있지만, 과신·의존·답변과 관점의
> 동질화·current user 억압을 만들 수 있다.

따라서 T5 Cognitive Flow의 성공은 모델을 더 많이 통제하는 것이 아니다.

> 모델이 잘 생각할 수 있는 최소 Reality·Context·Hand·Feedback·Continuity를 제공하고, 사용자가 언제든 교정·중단·
> 결정할 수 있는 관계를 유지하며, 단순한 일은 단순하게 복잡한 일은 필요한 만큼 깊게 끝내는 것.

현재 결정:

```text
연구는 보존한다.
현재 제품에는 넣지 않는다.
release 이후 CF-0부터 시작한다.
현재 T5가 충분하면 변경 0으로 닫는다.
유연성·사용자 주체성·다양성을 증명하지 못하면 폐기한다.
```
