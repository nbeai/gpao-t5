# GPAO-T5 AI OS 최종 개발 계획서

- 날짜: 2026-07-24
- 상태: `final_development_plan`
- 작성 범위: T5 본체 개발 기준 / 경쟁 기능 연구 / GPAO-T3·BEAI 노하우 접목 / 첫 개발 착수 기준
- 비범위: 설치·온보딩, 라이브본 변경, 외부 계정 실제 연결, 실제 배포
- 정본 용도: 이 문서는 GPAO-T5 본체 개발의 최초 기준 문서다. 이후 세부 PRD, kernel spec, UI spec, scenario benchmark는 이 문서를 상위 기준으로 삼는다.

## 0. 결론

GPAO-T5는 만들 가치가 있다. 단, `T3 + 기능 추가`나 `OpenClaw/ChatGPT/Codex/Claude Code의 UI 재현`으로 가면 실패한다.

T5의 목표는 다음이어야 한다.

```text
사용자의 말
-> 의도와 상황 파악
-> 필요한 맥락만 입장
-> 모델·도구·로컬 PC·외부 앱 선택
-> 권한 경계 판정
-> 실행 또는 확인 요청
-> 결과·증거·복구·학습
-> 다음 행동으로 자연스럽게 이어지는

독립 AI 운영체제
```

세계 최고 제품들이 이미 모델, 도구, 로컬 실행, 앱 연결, 작업공간, 메모리, 자동화를 빠르게 흡수하고 있다. 그러므로 GPAO-T5의 차별점은 "더 많은 기능"이 아니라, 사용자가 답답함을 느끼지 않도록 말귀·맥락·권한·실행·검증을 하나의 운영 흐름으로 묶는 능력이어야 한다.

### 0.1 Original AI OS 제품 철학

T5의 사용자 경험은 단순해야 한다.

```text
사용자는 채팅만 한다고 느낀다.
하지만 T5는 사용자의 목적을 달성하기 위해
필요한 모델, 도구, 로컬 PC 기능, 브라우저, 파일, 앱, 자동화, 외부 연결을
스스로 파악하고 운용한다.
```

T5의 최상위 목표는 방법을 나열하는 것이 아니다. 사용자의 목적과 의도를 최우선 가치로 두고, 그 목적을 달성할 수 있는 수단과 방법을 찾아내고 운용하는 것이다.

따라서 T5는 사용자에게 "이것은 안 됩니다", "이 도구가 없습니다", "이 순서대로 직접 하세요"를 먼저 내놓는 시스템이 되어서는 안 된다. 먼저 물어야 할 것은 하나다.

```text
이 사용자의 목표를 달성하려면 무엇을 동원해야 하는가?
```

사용자는 채팅창 앞에 앉아 있다고 느끼지만, 실제로는 T5가 뒤에서 필요한 수단을 조합하고, 설치하거나, 연결하거나, 실행하거나, 대안을 찾아서 결과물에 도달하게 해야 한다. 사용자가 원하는 것은 방법 설명이 아니라 목적 달성이다.

이 점에서 T5는 ChatGPT와 Codex의 이상적 결합을 목표로 한다.

```text
ChatGPT급 대화 지능과 사용자 체감
+ Codex급 로컬 PC 실행력과 기능적 모델 운용력
+ BEAI5의 현실 판단 흐름
+ Operational Selfhood 기반 자기파악
= Original AI Operating System
```

ChatGPT는 대화형 AI의 지능, 자연스러움, 사용자 체감의 기준이다. Codex는 로컬 PC, 파일, 도구, 실행, 검증, 모델 운용의 기준이다. T5는 이 둘을 붙이는 것이 아니라, 사용자의 목적을 중심으로 대화와 실행이 하나의 흐름으로 순환하게 만드는 독립 AI 운영체제여야 한다.

사용자가 T5를 신뢰하게 되는 이유는 기능 목록이 많아서가 아니다. 사용자가 말한 목적을 놓치지 않고, 가능한 수단을 찾아내며, 위험 경계에서는 멈추고, 필요한 곳에서는 실행하고, 결과물을 남기기 때문이다.

이 철학은 T5의 모든 영역에 적용된다.

- 최상위 기준은 사용자를 덜 헤매게 하는 것이다. 어떤 기능, 메뉴, 성능, 응답, 대화도 사용자의 혼란을 줄이고 물 흐르듯 목적 달성으로 이어져야 한다.
- 사용자의 목적이 방법보다 우선한다.
- 방법을 모르면 찾고, 도구가 없으면 연결·설치·대안을 검토한다.
- 기계적 한계를 첫 답으로 내세우지 않는다.
- 자기파악은 이 목표를 위한 운영체제적 조건이다. T5가 현재 무엇을 할 수 있고, 무엇이 막혔고, 어떤 권한이 필요하고, 어떤 대안이 있는지 모르면 사용자를 덜 헤매게 할 수 없다.
- 단, 외부 전송, 삭제, 결제, 공개, 권한 상승, 민감정보 처리는 사용자 승인 경계를 지킨다.
- 최종 기준은 사용자가 실제로 원하는 결과에 가까워졌는가다.

### 0.2 목적 달성과 자기파악의 필연 관계

사용자의 목적을 최우선 가치로 삼으려면 T5는 반드시 자기 가용 범위를 알아야 한다.

```text
사용자 목적 달성
-> 목적 달성 수단 탐색
-> 사용할 수 있는 모델·도구·연결·권한·실행 환경 파악
-> 가능한 수단 조합
-> 실행 또는 승인 요청
-> 결과물 산출
```

따라서 자기파악은 철학적 장식이나 상태 패널이 아니다. T5가 목적 달성형 AI OS가 되기 위한 전제 조건이다.

```text
Operational Selfhood는
T5가 자신이 운용할 수 있는 모든 기능과 성능의 가용 범위를 파악하고,
그 범위 안에서 사용자 목적을 달성할 방법을 찾아내는 운영체제적 속성이다.
```

이 속성이 없으면 T5는 목적 달성형 OS가 아니라 방법 나열형 AI가 된다. 어떤 모델을 쓸 수 있는지, 어떤 도구가 실제 실행 가능한지, 어떤 앱이 연결되어 있는지, 어떤 권한이 승인되었는지, 어떤 실행이 위험한지, 실패했을 때 어떤 대안이 있는지 모르면 사용자의 목표를 끝까지 밀고 갈 수 없다.

그러므로 T5의 자기파악 능력은 다음 질문에 매 턴 답해야 한다.

```text
나는 지금 어떤 모델을 쓰는가?
그 모델의 강점과 한계는 무엇인가?
지금 연결된 도구와 앱은 무엇인가?
도구가 목록에 있는 것과 실제 실행 가능한 것은 어떻게 다른가?
사용자가 승인한 권한은 어디까지인가?
로컬 PC, 브라우저, 파일, 메신저, 자동화 중 무엇을 쓸 수 있는가?
지금 확인한 것, 추정한 것, 모르는 것은 무엇인가?
사용자 목적을 달성하기 위한 다음 수단은 무엇인가?
어디서 멈추고 사용자 승인을 받아야 하는가?
```

이 문답은 사용자에게 매번 노출하는 체크리스트가 아니다. T5 내부의 운영체제적 자기파악 구조이며, 답변·도구 실행·복구·성장·UI 상태가 모두 이 구조를 통과해야 한다.

## 1. 연구 질문

이번 설계의 질문은 세 가지다.

1. ChatGPT, Codex, Claude Code, OpenHands, OpenClaw 계열이 사용자에게 이미 제공하는 핵심 기능은 무엇인가?
2. 그 기능들 중 GPAO-T5가 반드시 갖춰야 하는 사용자 기능은 무엇인가?
3. GPAO-T3/BEAI에서 얻은 말귀, Context Mesh, T-cell, ActionPlan, Authority, Truth Ledger, Follow-up Queue 노하우를 어떻게 T5의 독립 OS 기관으로 재구성할 것인가?

## 2. 근거 자료

### 2.1 외부 공식/주요 자료

| 대상 | 확인한 공식/주요 자료 | 설계에 반영할 사실 |
| --- | --- | --- |
| ChatGPT Projects | OpenAI Academy, `Using projects in ChatGPT` | 프로젝트는 관련 대화, 파일, 지시사항을 한 공간에 묶어 지속 작업을 지원한다. |
| ChatGPT Apps / Connectors | OpenAI Help, `Apps in ChatGPT` | 앱은 검색, 동기화, 대화형 앱, 쓰기 동작을 포함하며, 쓰기 동작은 확인을 요구한다. |
| ChatGPT Memory | OpenAI Help, `What is Memory?`, `Memory FAQ` | 저장 기억과 대화 기록 기반 개인화가 있으며, 사용자는 기억을 관리·삭제·끄기 할 수 있다. |
| ChatGPT Tasks | OpenAI Help, `Scheduled tasks in ChatGPT` | 일회성/반복 작업, 모니터링, 알림이 작업 표면으로 제공된다. |
| ChatGPT Canvas | OpenAI Help, `Canvas` | 글쓰기·코딩 작업을 대화 밖 편집 표면에서 직접 수정하고 되돌릴 수 있다. |
| Codex | OpenAI Help, `Codex CLI`, `Getting started with Codex` | 로컬 터미널/코드베이스에서 읽기·수정·실행이 가능하고, 승인 모드와 sandbox가 있다. |
| Claude Code | Anthropic Docs, overview/setup/CLI/MCP/FAQ | 터미널·IDE·데스크톱·웹, MCP, hooks, skills, agents, permission mode, resume/continue가 핵심 운영 문법이다. |
| OpenHands | OpenHands Docs, SDK/CLI/Product | CLI, headless, web GUI, SDK, REST agent server, Bash/file/web/MCP tools, sandbox, model-agnostic 구조를 제공한다. |
| OpenClaw/GPAO local reference | 로컬 OpenClaw/GPAO reference와 T3 교훈 문서 | OpenClaw는 기능·호환성·채널·도구 규모의 기준으로 쓰되, T5 정본 runtime/identity로 삼지 않는다. |

주요 링크:

- OpenAI Codex CLI: https://help.openai.com/en/articles/11096431
- OpenAI Codex 시작: https://help.openai.com/en/articles/11369540-getting-started-with-codex
- ChatGPT Projects: https://openai.com/academy/projects/
- ChatGPT Apps: https://help.openai.com/en/articles/11487775-connectors-in
- ChatGPT Memory: https://help.openai.com/en/articles/8983136-what-is-memory_.pdf
- ChatGPT Tasks: https://help.openai.com/en/articles/10291617-tasks-in-chatgpt
- ChatGPT Canvas: https://help-lb.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it
- Claude Code overview: https://docs.anthropic.com/ko/docs/claude-code/overview
- Claude Code CLI: https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Claude MCP: https://docs.anthropic.com/en/docs/mcp
- OpenHands SDK: https://docs.openhands.dev/sdk/index
- OpenHands CLI: https://docs.openhands.dev/openhands/usage/cli/quick-start
- OpenHands product: https://www.openhands.dev/product/

### 2.2 내부 기준 자료

| 내부 자료 | T5에 반영할 핵심 |
| --- | --- |
| `GPAO-T-FOUNDATION-RUNTIME-MODEL-v0.1-ko.md` | 모델은 교체 가능한 계산 능력이고, GPAO-T가 세션·권한·기억·복구·제품 경험을 소유한다. |
| `GPAO-T3-7-AXIS-AI-OS-ARCHITECTURE-v0.1-ko.md` | Surface, Runtime Kernel, Router/Adapter, Memory/Context/T-cell, Authority/Security, Growth/Recovery, Distribution/Environment의 7축이 OS 체급을 결정한다. |
| `GPAO-T3-GPAO-T-LESSONS-TRANSFER-CONTRACT-v0.1-ko.md` | T3/T5는 정체성 혼선, 채널 종속, 설명뿐인 연결 화면, 무검증 기억, 테스트 중심 완료 주장을 반복하면 안 된다. |
| `GPAO-T-CHAT-WORKSPACE-UX-SPEC-v0.1-ko.md` | 메인 표면은 대시보드가 아니라 사용자가 일과 생각을 이어 가는 작업공간이어야 한다. |
| `GPAO-T-CROSS-PLATFORM-CONNECTION-AND-AUTONOMY-DOCTRINE-v0.1-ko.md` | 연결·인증·자동화는 플랫폼 중립 계약으로 설계하고, 안전 때문에 매끄러움을 죽이면 안 된다. |
| `GPAO-T3-MALGWI-ACTIONPLAN-KERNEL-DESIGN-2026-07-22-ko.md` | 말귀, 상황파악, ActionPlan, authority tier가 실제 모델 운용 능력의 중심이다. |
| `GPAO-T3-CONVERSATION-FLOW-KERNEL-2026-07-24-ko.md` | 현재 요청 우선, 자연스러운 응답, 도구 사실성, 내부 용어 비노출이 대화 품질의 핵심이다. |
| `GPAO-T3-2.0-LIVE-HUMAN-SCENARIO-REMEDIATION-PLAN-2026-07-24-ko.md` | Follow-up Queue와 Tool Execution Truth Ledger 없이는 장시간 도구 작업과 사용자 체감이 흔들린다. |

### 2.3 Reference-First Absorption 원칙

T5는 미련하게 바닥에서 모든 것을 새로 만들지 않는다. 이미 검증된 기능, 성능, 로직, 알고리즘, 디자인, 구조는 적극적으로 해부하고 흡수한다. 다만 T5의 제품 정체성, 데이터 모델, 권한 체계, 사용자 표면, 이름공간은 T5가 소유한다.

핵심 원칙:

```text
바닥부터 재발명하지 않는다.
좋은 것은 해부한다.
쓸 수 있는 것은 흡수한다.
그대로 베끼지 않고 T5의 OS 기관으로 재구성한다.
```

흡수 대상은 다음처럼 나눈다.

| 대상 | 흡수 방식 | 금지선 |
| --- | --- | --- |
| GPAO-T3 개발본 | 코드, 구조, 테스트, 문서, 교훈을 적극 이전 후보로 삼는다. | T3의 임시 설계, 과거 회귀, live 이슈를 그대로 승계하지 않는다. |
| `/Users/jyp/Developer/lab_un` OpenClaw 소스 | 기능군, tool/runtime 구조, UX 동선, adapter 패턴을 해부한다. 라이선스와 의존성 검사를 통과한 부분만 재사용한다. | OpenClaw identity, runtime path, config schema, 사용자 표면을 T5 정본으로 삼지 않는다. |
| Codex | 로컬 PC 지배력, 작업 상태 추적, 승인 모드, 파일/터미널/브라우저 실행, 검증 문법을 제품 원리로 흡수한다. | OpenAI 고유 코드, 브랜드, 비공개 자산, 화면 복제는 하지 않는다. |
| Claude Code | permission mode, MCP, hooks, skills, resume, multi-surface 운영 문법을 흡수한다. | Anthropic 고유 코드, 브랜드, 비공개 자산, 화면 복제는 하지 않는다. |
| OpenHands | SDK, web/CLI/headless, sandbox, model-agnostic agent server 패턴을 흡수한다. | T5를 OpenHands wrapper로 만들지 않는다. |
| 기타 AI OS/agent 제품 | 기능 발견, UX 비교, 실패 방지 패턴, benchmark 기준으로 삼는다. | 출처 불명 코드·자산을 무단 복제하지 않는다. |

흡수 단위는 코드 파일이 아니라 아래 여섯 층위다.

1. 기능: 사용자가 실제로 할 수 있는 일
2. 성능: 지연, 안정성, 복구율, 반복 작업 효율
3. 로직: 상태 전이, 권한 판단, 라우팅, 오류 처리
4. 알고리즘: context admission, planning, replay, recovery, scheduling
5. 디자인: 화면 정보 구조, 진행 표시, 승인/복구 표현, 밀도와 리듬
6. 구조: package boundary, adapter contract, ledger schema, event/runtime architecture

모든 흡수 후보는 다음 절차를 통과한다.

```text
Reference inventory
-> License / ownership / dependency check
-> Feature and behavior extraction
-> T5 7대 영역 매핑
-> T5 identity rewrite
-> authority / privacy / recovery gate
-> scenario replay
-> implementation or rejection
```

이 원칙의 목적은 안전한 속도다. T5는 독창성을 핑계로 이미 해결된 문제를 다시 풀지 않는다. 동시에 레퍼런스를 핑계로 T5의 고유 OS 속성, 자기파악, BEAI5 모델 운용, 사용자 목적 달성 철학을 잃지 않는다.

## 3. 경쟁 제품에서 흡수해야 할 사용자 기능

| 기능군 | 경쟁 제품에서 확인되는 방향 | T5가 가져야 할 형태 |
| --- | --- | --- |
| 프로젝트/작업공간 | ChatGPT Projects, Codex threads, Claude project context | 대화, 파일, 목표, 승인 경계, 기억 후보, 실행 기록을 묶는 `작업 공간` |
| 기억/개인화 | ChatGPT Memory, Claude memory, project instruction | raw memory가 아니라 `admitted context`와 `승격된 작동 원리` 분리 |
| 도구/앱 연결 | ChatGPT Apps, Claude MCP, OpenHands tools | 읽기, 쓰기, 전송, 삭제, 비용, 외부 공개를 분리한 Connection Center |
| 로컬 PC 실행 | Codex CLI, Claude Code, OpenHands | 파일, 브라우저, 터미널, 앱 제어를 권한·receipt와 함께 실행 |
| 멀티 표면 | ChatGPT web/mobile/desktop, Claude terminal/IDE/desktop/web, OpenHands CLI/web/SDK | Chat, Today, Project, Canvas, Task, Connector, Ledger가 같은 상태 언어 사용 |
| 자동화/스케줄 | ChatGPT Tasks, Claude scheduled/background work, hooks | 자동화는 기본적으로 review queue에서 시작하고, 외부 효과는 명시 승인 |
| 승인/권한 | Codex approval modes, Claude permission modes, ChatGPT write confirmations | T5식 A0-A3 authority tier로 통합 |
| 세션 연속성 | Claude continue/resume, Codex threads, ChatGPT projects | 세션이 바뀌어도 현재 목표, 미완료 일, 승인 경계, 증거만 좁게 회수 |
| 개발 작업 | Codex/Claude/OpenHands | 코딩 전용이 아니라 문서, 사업, 고객응대, 조사, 로컬 업무까지 같은 ActionPlan으로 처리 |
| 확장성 | MCP, SDK, plugins, apps | T5 Connector Manifest + Adapter Conformance + Truth Ledger |
| 투명성 | Codex review, Claude tool/permission surfaces, OpenHands sandbox | 사용자가 "무엇을 했고, 무엇을 못 했고, 다음에 뭘 하면 되는지" 즉시 이해 |

## 4. GPAO-T5 필수 사용자 표면

T5의 첫 제품 설계는 아래 표면을 기준으로 잡아야 한다.

| 표면 | 역할 | 반드시 보여야 하는 것 |
| --- | --- | --- |
| Today / Home OS | 오늘 해야 할 일, 이어갈 일, 막힌 일 | 현재 연결, 다음 안전 행동, 대기 중 확인, 최근 결과 |
| Work Chat | 모든 작업의 시작점 | 사용자의 말, 이해한 일, 필요한 경우의 진행·도구·승인 상태 |
| Project Rooms | 장기 프로젝트 단위 | 목표, 파일, 대화, 결정, 실행 기록, 기억 후보, 자동화 후보 |
| Memory / Context Center | 기억과 맥락의 관리 | raw 기록, 후보, 승인된 기억, 작동 원리, 영향 범위, 되돌리기 |
| Tool / Connection Center | 모델·앱·로컬 도구 연결 | 연결 상태, 읽기/쓰기 권한, 복구 행동, 비용·외부 전송 경계 |
| Task / Automation Center | 반복·예약·모니터링 | 비활성 후보, 승인된 작업, 다음 실행, 중지, 실패 복구 |
| Canvas / Workboard | 산출물 편집 | 문서, 코드, 표, 조사 결과, 메시지 초안의 직접 편집과 버전 |
| Local PC Workspace | 로컬 파일·브라우저·앱 작업 | 실행 전 미리보기, 실행 중 상태, 결과, rollback 또는 non-mutation 증거 |
| Channel Inbox | Telegram/Slack/메일 등 외부 소통 | 채널별 대화 분리, 외부 전송 전 확인, 발신/수신 원장 |
| Approval Center | 권한 경계 집중 관리 | 보류 중 승인, 영향, 범위, 기간, 취소·되돌리기 |
| Evidence / Truth Ledger | 신뢰 표면 | 도구 사용, 검색, 실행, 실패, 불확실 결과, 재시도 여부 |
| Recovery Center | 문제 해결 | 현재 안전 여부, 잃지 않은 것, 한 가지 다음 복구 행동 |
| Growth Center | 개선 제안 | 학습 후보, replay 결과, 적용 전 미리보기, 거절·되돌리기 |
| Model Router | 모델 선택과 성능 상태 | 현재 모델, 연결 상태, 지연/비용/권한, fallback 가능 여부 |

## 5. T5의 고유 차별화 기관

### 5.1 말귀 / Input Kernel

T5의 첫 경쟁력은 말투가 아니라 사용자 지시를 정확히 알아듣는 것이다.

입력 하나는 곧바로 모델에 던지는 문자열이 아니라 다음 구조로 해석되어야 한다.

```text
현재 요청
관계 있는 과거 맥락
사용자가 원하는 결과
사용자가 원하지 않는 위험
필요한 도구
권한 경계
답변 방식
확인 질문 필요 여부
```

단순 대화는 빠르게 답하고, 복잡한 작업은 ActionPlan으로 전환한다. 이때 내부 용어가 사용자 답변에 새어 나오면 실패다.

### 5.2 ActionPlan / Authority Kernel

T5는 사용자 요청을 다음처럼 정리해야 한다.

```text
이해한 일
사용할 맥락
사용할 도구
자동으로 해도 되는 일
확인받아야 하는 일
절대 하면 안 되는 일
성공 기준
복구 기준
```

권한 등급은 T3의 원칙을 T5의 공통 OS 계약으로 올린다.

| 등급 | 의미 | 예시 |
| --- | --- | --- |
| A0 | 즉시 자동 | 읽기, 요약, 검색, 로컬 진단, 초안 생성 |
| A1 | 조용한 확인 또는 되돌릴 수 있는 자동 | 제목 정리, 보관 제안, 로컬 초안 정리 |
| A2 | 짧은 승인 필요 | 외부 전송, SaaS 쓰기, 자동화 활성화, 장기 기억 승격 |
| A3 | 강한 승인 또는 차단 | 삭제, 결제, 공개 게시, 권한 상승, 민감정보 내보내기 |

### 5.3 Context Mesh / T-cell Kernel

T5의 기억은 "많이 기억함"이 아니라 "이번 행동에 영향을 줘도 되는 것만 좁게 입장시킴"이어야 한다.

```text
raw record
-> candidate
-> admission
-> replay
-> approval
-> promoted operating principle
-> future influence with rollback
```

T-cell은 기억 조각이 아니라 반복되는 운영 원리다. 예를 들어 "윤은 짧게 답하라고 하면 정말 짧게 답해야 한다"는 단순 선호가 될 수 있지만, "외부 전송은 실제 발신 전 반드시 한 번 멈춘다"는 OS 운영 원리다. 둘은 같은 저장소에 섞이면 안 된다.

### 5.4 Tool Execution Truth Ledger

T5는 도구를 썼다고 착각하거나, 못 썼는데 쓴 것처럼 말하면 안 된다.

모든 도구·검색·브라우저·로컬 실행은 다음을 남긴다.

```text
하려던 일
실제로 호출한 것
받은 결과
실패/차단/타임아웃 여부
사용자에게 말해도 되는 요약
다음 안전 행동
```

사용자 답변은 이 원장을 기준으로 "확인한 것 / 확인하지 못한 것 / 추정"을 분리한다.

### 5.5 Follow-up Queue

사용자는 AI가 긴 작업을 하는 동안 새 지시를 한다. T5는 이걸 놓치면 OS가 아니다.

필수 상태:

```text
현재 실행 중인 일
새로 들어온 말
충돌 여부
중단/병합/대기/우선순위 변경
사용자에게 알려야 하는 한 줄
```

장시간 도구 작업, 브라우저 작업, 자동화 실행, 파일 처리 중에도 새 지시가 "현재 요청 우선" 원칙에 따라 처리되어야 한다.

### 5.6 BEAI5 이중 구현 원칙

BEAI5는 지금까지 주로 프롬프트나 프로그래밍 규칙으로 적용되었지만, T5에서는 이 둘을 정확히 분리해야 한다. 목표는 BEAI5를 기계적으로 통제하는 것이 아니라, AI 운영체제의 속성과 모델의 살아 있는 판단이 서로를 살리게 만드는 것이다.

T5의 원칙은 다음이다.

```text
OS는 모델이 길을 잃지 않도록 존재 조건을 정렬한다.
모델은 그 조건 안에서 최대 추론력, 언어감각, 판단력, 자연스러움을 발휘한다.
```

따라서 BEAI5는 두 영역으로 나뉜다.

#### 5.6.1 OS 속성과 구조로 구현할 영역

아래 항목은 매 턴 긴 프롬프트로만 맡기면 안 된다. T5의 런타임 속성, 상태 구조, admission, router, ledger, authority, recovery로 구현해야 한다.

| BEAI5 원리 | T5 구조화 방식 | 실패하면 생기는 문제 |
| --- | --- | --- |
| 현재 입력 보존 | `CurrentRequestCell`, 원문 보존, 현재 요청 우선순위 | 과거 맥락이나 익숙한 프레임으로 이탈 |
| 요청 형식 보존 | `ResponseContract`, 산출물/판단/요약/실행 구분 | 사용자가 원한 형식을 재해석으로 훼손 |
| 확정/추정/미확인 분리 | `EvidenceCell`, `UnknownCell`, `InferenceCell` | 보지 않은 것을 본 것처럼 말함 |
| 도구 사실성 | `ToolReceipt`, `TruthLedger` | 검색/도구를 쓰지 않았는데 쓴 것처럼 말함 |
| 권한 경계 | `AuthorityGrant`, A0-A3, external-effect gate | 외부 전송, 삭제, 기억 승격을 무단 실행 |
| 장기 맥락 admission | Context Mesh / T-cell admission | 관계없는 과거 맥락이 현재 요청을 덮음 |
| 현재 모델·도구·연결 상태 | `SelfStateSnapshot`, `ModelRouteCell`, `ConnectionCell` | 실제 가능 능력과 답변이 어긋남 |
| follow-up 처리 | `FollowUpEvent`, 충돌/병합/중단 상태 | 긴 작업 중 새 지시를 놓침 |
| 실패와 복구 | `RecoveryCell`, non-mutation/rollback receipt | 실패 후 사용자가 무엇이 안전한지 모름 |
| 성장/학습 후보 | `GrowthCandidate`, replay, approval | 검증 없이 행동 규칙이 오염됨 |

이 영역은 T5의 "자기파악 속성"이 된다. 즉 대시보드에 표시되는 상태가 아니라, 모든 판단과 실행이 통과하는 운영체제적 성질이다.

#### 5.6.2 모델의 판단 헌장으로 남겨야 할 영역

아래 항목은 외부 코드가 완전히 대신하면 비아이5의 가치를 죽일 수 있다. 이 영역은 짧고 강한 시스템 헌장, task packet, model-ready context로 모델에 제공하고, 최종 판단과 표현은 모델의 지능에 맡겨야 한다.

| BEAI5 원리 | 모델에 남겨야 하는 이유 | OS가 제공할 최소 조건 |
| --- | --- | --- |
| 사용자의 현실을 어떤 순서로 놓을지 | 문맥, 심리적 부담, 판단 순서는 규칙표보다 언어 지능이 더 잘 다룬다. | 현재 요청, 확정 사실, 미정 변수, 사용자 상태 신호 |
| 판단 강도 조절 | 강한 신호와 약한 신호의 체감은 기계 분류만으로 부족하다. | evidence strength, missing evidence, risk boundary |
| 질문/보류/종결 선택 | 좋은 질문은 단순 분기문이 아니라 현재 흐름을 읽는 일이다. | clarification cost, stop-and-ask boundary |
| 산출물의 문장 호흡 | 실제로 읽히는 문장은 템플릿이 아니라 목적과 독자에 맞는 생성이다. | audience, use place, forbidden expressions, output contract |
| 장기 맥락의 조용한 반영 | 이전 구조를 반복하지 않고 현재 발화에만 반응하는 감각은 모델이 살려야 한다. | admitted context only, stale override warning |
| 첫 문장과 마지막 문장 | 사용자 현실로 들어가고 하나로 닫는 흐름은 생성 품질의 핵심이다. | response role, depth policy, closure target |
| 자연스러운 말귀 | 사용자의 말투를 흉내 내지 않고 의도와 상황을 붙잡는 일은 과제 전체의 생명력이다. | Nunchi/Intent packet, current-request-wins policy |

이 영역을 코드로 과잉 통제하면 모델은 체크리스트 실행기가 된다. T5는 모델을 억압하는 컨트롤러가 아니라, 모델의 최고 능력이 안전하게 발현될 수 있는 운영 조건을 제공해야 한다.

#### 5.6.3 경계 원칙

T5는 다음 경계를 지킨다.

```text
프로그래밍할 것:
  사실, 상태, 권한, 연결, 도구, 기억 admission, 원장, 복구, 충돌 처리

모델에 맡길 것:
  판단의 흐름, 언어의 순서, 사용자 현실의 배치, 산출물의 생명력

둘 사이의 접점:
  LLM-ready Task Context Packet
```

핵심은 "최소 제어, 최대 발현"이다.

```text
모델의 능력을 막지 않고,
흐트러짐만 막는다.
```

## 6. T5 본체 7대 개발 영역

T3는 7축으로 설계했기 때문에 각 영역을 고밀도로 닫을 수 있었다. T5도 같은 원칙을 따른다. 단, 이번 계획에서는 설치·온보딩을 제외하고 AI OS 본체만 다룬다.

T5의 본체 7대 영역은 기능 목록이 아니라 AI 운영체제의 기관이다.

| 영역 | 이름 | 역할 | 닫아야 할 핵심 |
| --- | --- | --- | --- |
| 1 | Operational Selfhood / 자기파악 속성 | T5가 자기 모델, 도구, 권한, 연결, 상태, 한계, 가용 범위를 파악한다. | SelfStateSnapshot, Capability Map, 현재 실행 가능/불가능/승인 필요 구분 |
| 2 | BEAI5 Model Operation / 모델 운용 헌장 | 모델을 기계적으로 제어하지 않고, 최소 제어선으로 최대 지능을 발현시킨다. | OS 구조화 영역과 모델 판단 영역 분리, 자연스러움 회귀 방지 |
| 3 | Intent / Context / T-cell Kernel | 사용자의 말귀, 현재 요청, 생략된 전제, 장기 맥락, admitted context를 다룬다. | CurrentRequestCell, Nunchi/Intent packet, T-cell admission, active target recovery |
| 4 | ActionPlan / Authority / Safety | 무엇을 자동 실행하고, 무엇을 확인받고, 무엇을 하지 않을지 결정한다. | ActionPlan, A0-A3, 외부 효과 gate, 위험·권한 경계 |
| 5 | Model / Tool / Connection / Execution Router | 모델, 브라우저, 로컬 PC, 앱, MCP, 메신저, 자동화, 파일 작업을 실제 상태 기준으로 운용한다. | ModelRouteCell, ToolRouteCell, ConnectionCell, InvocationGrant, execution receipt |
| 6 | Work Surface / Project OS UX | 사용자는 채팅만 한다고 느끼지만, 프로젝트·캔버스·작업공간·도구 진행이 하나로 이어진다. | Work Chat, Project Rooms, Today, Canvas, Channel Inbox, Connection/Approval surfaces |
| 7 | Truth Ledger / Recovery / Growth Loop | 실제로 한 일, 못 한 일, 실패, 복구, replay, 성장 후보를 남기고 오염 없이 개선한다. | TruthLedger, RecoveryCell, replay, GrowthCandidate, rollback/non-mutation evidence |

### 6.1 영역별 개발 기준

#### 6.1.1 Operational Selfhood / 자기파악 속성

T5의 첫 기관은 자기파악이다. 자기파악은 모델명 표시나 설정 화면이 아니다. 사용자 목적을 달성하기 위해 지금 동원 가능한 모든 수단과 한계를 파악하는 OS 속성이다.

필수 구성:

- `SelfStateSnapshot`: 현재 모델, provider, 로컬 실행 환경, 연결된 도구, 승인된 권한, 제한, 지연, 오류 상태
- `Capability Map`: 할 수 있는 일, 지금 가능한 일, 연결하면 가능한 일, 승인 없이는 불가능한 일, 해서는 안 되는 일
- `Availability Probe`: 도구·앱·브라우저·로컬 기능의 가용성 확인
- `Boundary Awareness`: 외부 전송, 삭제, 결제, 공개, 민감정보, 권한 상승 경계
- `Self-Report Translation`: 필요할 때만 사용자 언어로 "지금 가능한 것 / 막힌 것 / 다음 행동"을 설명

수용 기준:

- T5는 매 턴 자신이 쓰는 모델과 실행 가능한 도구를 구분한다.
- 목록에 있는 도구와 실제 호출 가능한 도구를 혼동하지 않는다.
- 못 하는 것을 바로 포기하지 않고 연결, 설치, 대안, 승인, 우회 가능성을 검토한다.
- 위험 경계에서는 사용자 승인을 요구한다.

#### 6.1.2 BEAI5 Model Operation / 모델 운용 헌장

T5는 모델을 규칙으로 눌러 죽이면 안 된다. 모델의 추론력, 언어감각, 판단력, 산출물 품질이 살아 있어야 한다.

필수 구성:

- `BEAI5 OS Property`: 현재 입력 보존, 요청 형식 보존, 확정/추정 분리, 도구 사실성, 권한 경계
- `Model Charter`: 사용자 현실을 정확한 순서로 놓고, 필요한 만큼 판단하며, 하나의 쓸 수 있는 결과로 닫는 짧은 헌장
- `LLM-ready Task Context Packet`: 모델에게 필요한 조건만 압축해 전달
- `Naturalness Regression Gate`: 체크리스트화, 과잉 분류, 딱딱한 답변, 반복 구조를 검출

수용 기준:

- 단순 대화는 단순하고 자연스럽다.
- 복합 판단은 깊지만 사용자가 다시 정리하지 않아도 된다.
- 산출물 요청은 결과물이 먼저 나온다.
- 코드가 모델의 판단 흐름과 문장 생명력을 과잉 제어하지 않는다.

#### 6.1.3 Intent / Context / T-cell Kernel

T5는 사용자의 현재 말을 먼저 보존하고, 필요한 맥락만 좁게 입장시켜야 한다.

필수 구성:

- `CurrentRequestCell`
- `NunchiPacket` / `IntentPacket`
- `ContextAdmissionPacket`
- `T-cell candidate -> admission -> replay -> approval`
- `ActiveTargetRecovery`
- wrong-anchor restraint

수용 기준:

- 현재 요청이 과거 맥락보다 우선한다.
- 사용자가 말하지 않은 목적을 먼저 확정하지 않는다.
- 장기 맥락은 현재 요청을 돕는 범위에서만 사용한다.
- 기억은 행동 권한이 아니며, 승인된 작동원리만 미래 행동에 영향을 준다.

#### 6.1.4 ActionPlan / Authority / Safety

T5는 목적 달성을 위해 움직이되, 사용자 권한과 위험 경계를 흐리면 안 된다.

필수 구성:

- `ActionPlan`: 이해한 일, 사용할 맥락, 사용할 도구, 자동/승인/차단 행동, 성공 기준, 복구 기준
- A0-A3 authority
- external-effect gate
- approval preview
- no-silent-send/delete/payment/public-post rule

수용 기준:

- 읽기·요약·진단·초안은 빠르게 진행한다.
- 외부 쓰기·전송·삭제·자동화 활성화·장기 기억 승격은 승인 경계를 지난다.
- 승인 요청은 길고 무서운 경고가 아니라 영향과 선택이 분명한 한 번의 확인이어야 한다.

#### 6.1.5 Model / Tool / Connection / Execution Router

T5는 사용자의 목표에 맞는 수단을 찾아 실제로 운용해야 한다.

필수 구성:

- `ModelRouteCell`
- `ToolRouteCell`
- `ConnectionCell`
- `InvocationGrant`
- browser/file/local app/terminal/SaaS/messenger/automation adapter
- install/connect/alternative proposal path

수용 기준:

- 모델 선택은 이름이 아니라 작업 적합성, 연결 상태, 지연, 비용, 권한을 함께 본다.
- 도구가 없으면 끝내지 않고 설치·연결·대체 경로를 검토한다.
- 실행 결과는 receipt로 남긴다.
- 불확실한 외부 결과는 자동 재시도하지 않는다.

#### 6.1.6 Work Surface / Project OS UX

사용자는 채팅한다고 느끼지만, T5는 작업공간을 운영해야 한다.

필수 구성:

- Work Chat
- Project Rooms
- Today / Home OS
- Canvas / Workboard
- Connection Center
- Approval Center
- Channel Inbox
- Evidence/Recovery/Growth inspector

수용 기준:

- 기본 화면은 채팅과 현재 작업이 중심이다.
- 내부 용어, raw path, stack trace, provider 세부 오류가 기본 화면을 점유하지 않는다.
- 사용자는 현재 가능한 일, 막힌 일, 다음 안전 행동을 설명 없이 이해한다.
- 프로젝트는 대화, 파일, 목표, 결정, 실행 기록, 기억 후보, 자동화 후보를 묶는다.

#### 6.1.7 Truth Ledger / Recovery / Growth Loop

T5는 시간이 갈수록 정교해져야 하지만, 검증 없이 스스로 오염되면 안 된다.

필수 구성:

- `TruthLedger`
- `ToolReceipt`
- `RecoveryCell`
- `ReplayResult`
- `GrowthCandidate`
- rollback / non-mutation evidence
- human scenario QA

수용 기준:

- 확인한 것, 확인하지 못한 것, 추정한 것이 분리된다.
- 실패해도 사용자는 입력과 작업 위치를 잃지 않는다.
- 복구는 한 가지 다음 행동으로 내려온다.
- 성장 후보는 replay와 승인 전에는 실제 행동을 바꾸지 않는다.

### 6.2 통합 아키텍처 제안

```text
L0 Evidence / State Kernel
  세션, 실행, 도구, 권한, 로그, receipt, rollback state, SelfStateSnapshot

L1 Intent / Context / T-cell Kernel
  말귀, 현재 요청, admitted context, active target recovery, T-cell admission, BEAI5 OS Property

L2 ActionPlan / Authority / Router
  작업 계획, A0-A3 권한, 모델 라우팅, 도구 라우팅, 연결 상태

L3 Execution Runtimes
  local PC, browser, file, terminal, SaaS connector, messenger, automation, model provider

L4 User Surfaces
  Work Chat, Today, Projects, Memory, Connections, Tasks, Canvas, Ledger, Settings

L5 Growth / Replay / Benchmark Loop
  실패 기록, 사용자 피드백, replay, 성장 후보, 검증, 적용, rollback
```

이 구조 위에는 별도의 장식 기능이 아니라 전역 속성으로 `Operational Selfhood`가 놓인다.

```text
Operational Selfhood =
  T5가 자신이 어떤 모델, 도구, 권한, 맥락, 연결, 상태, 한계 안에서
  작동하고 있는지 매 턴 파악하고,
  그 자기파악을 모든 답변과 실행의 조건으로 삼는 속성
```

핵심 규칙:

1. UI는 권한을 직접 부여하지 않는다. UI는 권한 결정을 보여 주고 사용자의 승인을 받는다.
2. 라우터는 기억을 쓰지 않는다. 기억 승격은 별도 admission/replay/approval 흐름이다.
3. 도구 목록에 있다고 실행 가능한 것이 아니다. 연결 상태와 authority grant가 있어야 한다.
4. 검색 결과는 곧 답변 근거가 아니다. Truth Ledger와 출처 요약을 거쳐야 한다.
5. 느린 기억·성장·replay는 기본 답변을 막지 않는다. 백그라운드 후보로 빠진다.
6. external send/delete/payment/public post는 "사용자가 원했다"만으로 실행하지 않는다.
7. 사용자 목적 달성은 최상위 목표지만, 목적 달성은 자기파악·권한·증거·복구 경계를 통과할 때만 OS 능력이 된다.

## 7. UX 방향

T5의 UI/UX는 다음 톤을 참고하되 복제하지 않는다.

| 참고 대상 | 배울 점 | T5식 번역 |
| --- | --- | --- |
| ChatGPT | 편안한 대화, 프로젝트, 메모리, 앱, 작업 | 일반 사용자가 바로 이해하는 말과 흐름 |
| Codex | 말이 곧 작업이 되는 느낌, 진행과 결과의 리뷰 가능성 | 작업 대화 중심, 산출물과 증거를 가까이 배치 |
| Claude Code | 권한, 도구, MCP, hooks, resume, 다중 표면 운영 문법 | OS 권한·도구·세션 상태를 한 계약으로 통합 |
| OpenHands | CLI/web/SDK/headless/sandbox/model-agnostic | T5를 특정 UI나 모델에 묶지 않는 실행 기반 |
| OpenClaw | 기능 규모, 채널/도구 호환성, 일반 대시보드 조작 | 참고 기준으로만 사용하고 T5 identity와 runtime은 독립 |

사용자 표면 원칙:

- 기본 화면은 채팅과 현재 작업이 중심이다.
- 내부 용어, raw path, stack trace, provider 내부 오류는 기본 화면에 노출하지 않는다.
- 상태 표시는 짧은 한국어여야 한다.
- "무엇을 할 수 있음"과 "지금 해도 됨"을 분리한다.
- 도구를 못 쓰는 상황에서도 막다른 답변으로 끝내지 않고, 다음 안전 행동을 제시한다.
- 설정·연결·권한·기억은 대화 흐름을 방해하지 않되, 필요할 때 즉시 열려야 한다.

## 8. 1차 기능 택소노미

### P0: OS 정체성 기능

1. Work Chat
2. Project Rooms
3. Current Request / Active Target Kernel
4. ActionPlan Kernel
5. Authority A0-A3
6. Tool Execution Truth Ledger
7. Follow-up Queue
8. Model Router
9. Connection Center
10. Memory/Context/T-cell Center
11. Recovery Center
12. Operational Selfhood / SelfStateSnapshot
13. BEAI5 OS Property + Model Charter Split

### P1: 사용자 체감 확장

1. Today / Home OS
2. Canvas / Workboard
3. Task / Automation Center
4. Channel Inbox
5. Local PC Workspace
6. Evidence Inspector
7. Growth Review Queue
8. Scenario Replay Bench
9. Cross-surface session resume
10. Toolbox / Connection Store
    - 앱스토어형 도구함·연결 센터
    - 설치됨/추천/개인용/공개 구분
    - 아이콘 기반 도구 카드, 검색, 카테고리, 상태 점
    - 채팅 중 필요한 도구 연결 흐름
    - P6에서 닫은 ToolDescriptor/WebToolDescriptor/ConnectorProfile/Authority/TruthLedger를 사용자 표면으로 번역
    - HTML-native Output Canvas: HTML/CSS/JS 기반 미디어·랜딩·리포트·홍보 산출물 표면. 얇은 metadata, 브라우저 preview/render receipt, 출처·권리·외부 게시 승인 경계를 유지한다.
    - 참고 문서: `design/T5-2.0-TOOLBOX-CONNECTION-CENTER-UX-REFERENCE-2026-07-25-ko.md`

### P2: 고급 생태계

1. Public connector SDK
2. Team workspace
3. Organization policy/admin
4. Mobile companion
5. Marketplace/plugin system
6. Cross-device secure sync
7. Advanced observability

## 9. 개발 착수 전후 필수 산출물

T5는 바로 기능부터 쌓으면 안 된다. 본 최종 계획서를 기준으로 아래 산출물을 먼저 닫거나, 첫 개발 slice와 동시에 작성·검증해야 한다. 이 산출물들은 개발을 지연시키기 위한 문서가 아니라, 각 영역이 흔들리지 않게 하는 공학 기준이다.

1. `GPAO-T5 Product Constitution`
   - T5가 무엇이고 무엇이 아닌지
   - 모델·도구·기억·권한·성장에 대한 비타협 원칙

2. `GPAO-T5 Feature Taxonomy`
   - 사용자 기능 전체 목록
   - P0/P1/P2
   - 각 기능의 권한 등급, 데이터 범위, 실패 복구 기준

3. `GPAO-T5 Scenario Benchmark`
   - 최소 40개 인간 사용자 시나리오
   - 사업, 개발, 문서, 고객응대, 조사, 로컬 PC, 메신저, 자동화, 기억, 복구
   - 경쟁 제품 대비 비교 항목

4. `GPAO-T5 UX Information Architecture`
   - Today, Chat, Project, Memory, Connection, Task, Canvas, Ledger, Settings의 화면 구조
   - 데스크톱/모바일/CLI 표면 간 상태 언어 통일

5. `GPAO-T5 Kernel Interface Spec`
   - IntentPacket
   - ActionPlan
   - AuthorityGrant
   - ContextAdmissionPacket
   - ToolReceipt
   - FollowUpEvent
   - GrowthCandidate
   - SelfStateSnapshot
   - LLM-ready Task Context Packet

6. `GPAO-T5 BEAI5 Integration Contract`
   - OS 속성/구조로 구현할 BEAI5 원리
   - 모델 판단 헌장으로 남길 BEAI5 원리
   - 프롬프트 과잉통제 금지선
   - 자연스러움 회귀 테스트
   - 최소 제어 / 최대 발현 원칙

7. `GPAO-T5 Rejection Criteria`
   - rigid prompt template로 자연스러움 훼손
   - 도구 실행 허위 주장
   - 기억 무단 승격
   - 외부 전송 무단 실행
   - UI 상태와 실제 runtime 상태 불일치
   - 느린 백그라운드 작업이 일반 대화 흐름을 막음
   - BEAI5를 체크리스트/분류기로 축소
   - 모델의 판단력과 문장 흐름을 과잉 제어

8. `GPAO-T5 Engineering Environment Charter`
   - 절대 원칙이 "왜"라면, 이 문서는 개발 환경에서 "어떻게 지킬지"를 정한다.
   - 빌드 산출물은 소스 트리 밖 고정 경로에만, 소스와 산출물 물리 분리, 결정적 빌드,
     에이전트 worktree 격리를 정의한다.
   - 방침: 마찰 0인 것(gitignore·폴더 구조 원칙·협업 기본 원칙·결정적 빌드 원칙)은 지금 적용하고,
     느린 게이트(hook·CI·테스트 게이트)는 Phase 5에서 실제 코드·빌드 파이프라인이 생긴 뒤 붙인다.
   - 정본: `GPAO-T5-ENGINEERING-ENVIRONMENT-CHARTER-2026-07-24-ko.md`.

9. `GPAO-T5 Operating Blueprint and Recovery Map`
   - 개발 종료 시점의 유지보수·복구·인수인계용 설계도다.
   - 새 세션, 새 에이전트, 새 개발자가 들어와도 T5의 구조, 책임 위치, 불변식, 고장 대응 경로를
     빠르게 파악하고 이어서 수정·보강할 수 있어야 한다.
   - 7대 영역 구조도, 전체 요청 흐름 지도, 기능별 책임 파일/계약 매핑, 고장 증상별 대응표,
     핵심 불변식 목록, 테스트/검증 지도, 외부 연결·권한·원장 경계, 새 세션 handoff 템플릿,
     현재 구현 범위와 아직 열지 않은 범위, 마무리 검증 절차를 포함한다.
   - 이 문서는 설명서가 아니라, 실전 장애 대응과 지속 보강을 위한 운영 설계도다.

## 10. 1차 개발 로드맵

### Phase 0. Final Research Seal

- 공식 자료와 로컬 실사용 근거를 분리한 evidence matrix 봉인
- OpenClaw, ChatGPT, Codex, Claude Code, OpenHands의 사용자 기능을 같은 택소노미로 재분류
- 각 기능이 T5에서 `표면`, `커널`, `라우터`, `권한`, `원장`, `복구` 중 어디에 속하는지 매핑
- T3, `/Users/jyp/Developer/lab_un` OpenClaw 소스, Codex, Claude Code, OpenHands, 기타 AI OS의 기능·로직·알고리즘·디자인·구조를 reference inventory로 정리
- 재사용 가능, 원리만 흡수, 폐기, 추가 검증 필요로 분류

### Phase 1. Product Constitution

- T5의 정체성, 비범위, 차별화 원칙 고정
- "독립 OS"와 "기능 많은 챗앱"의 판정 기준 작성
- T3에서 가져올 것과 폐기할 것을 분리
- BEAI5를 T5의 OS 속성과 모델 판단 헌장으로 분리하는 원칙 고정
- Operational Selfhood를 T5의 부가 기능이 아니라 존재 조건으로 선언
- Reference-first absorption을 T5의 기본 개발 방식으로 고정

### Phase 2. Kernel Contract

- IntentPacket, ActionPlan, AuthorityGrant, ToolReceipt, ContextAdmissionPacket 정의
- SelfStateSnapshot과 LLM-ready Task Context Packet 정의
- simple chat fast path와 complex work path 분리
- 자연스러움 훼손 방지 gate 설계
- OS가 정렬할 것과 모델이 생성할 것을 분리하는 `BEAI5 Integration Contract` 작성
- T3/OpenClaw/Codex/Claude/OpenHands에서 흡수할 상태 전이, permission, receipt, routing, recovery 패턴을 T5 contract로 재작성

### Phase 3. UX Architecture

- Work Chat, Today, Project, Memory, Connection, Task, Canvas, Ledger 설계
- OpenClaw/ChatGPT/Codex/Claude Code 톤앤매너를 참고하되 T5 고유 화면 언어로 재구성
- 화면별 "현재 가능한 일 / 막힌 일 / 다음 안전 행동" 고정
- 자기파악 상태는 필요할 때 보이되, 기본 대화 흐름을 점유하지 않도록 설계
- Codex의 작업감, ChatGPT의 대화감, Claude Code의 권한/실행감, OpenClaw의 대시보드 조작성을 T5의 한 화면 문법으로 통합

### Phase 4. Scenario Replay

- 40개 이상 인간 사용자 시나리오 작성
- 대화, 장기 작업, 도구, 외부 전송, 기억, 복구, 자동화, 멀티 프로젝트 포함
- 경쟁 제품 대비 강점·약점·필수 보완점을 측정
- BEAI5 자연스러움 회귀 시나리오 포함: 단순 대화, 복합 판단, 산출물, 후속 수정, 도구 실패, 장기 맥락

### Phase 5. First Build Slice

- 코드 착수는 여기부터 한다.
- 첫 구현은 모든 기능을 얇게 깔기보다, `Work Chat + SelfStateSnapshot + BEAI5 Task Context Packet + ActionPlan + Authority + Truth Ledger + Connection status + Follow-up Queue`의 한 흐름을 완성해야 한다.
- 이 한 흐름이 자연스럽지 않으면 T5는 OS가 아니라 또 다른 챗앱이 된다.

### Phase 6. Seven-Domain Expansion

첫 slice가 자연스럽게 작동하면 7대 영역을 각각 고밀도로 확장한다.

| 순서 | 개발 영역 | 첫 번째로 닫을 기능 |
| --- | --- | --- |
| 1 | Operational Selfhood | `SelfStateSnapshot`과 `Capability Map` |
| 2 | BEAI5 Model Operation | `LLM-ready Task Context Packet`과 자연스러움 회귀 테스트 |
| 3 | Intent / Context / T-cell Kernel | `CurrentRequestCell`, `IntentPacket`, `ContextAdmissionPacket` |
| 4 | ActionPlan / Authority / Safety | `ActionPlan`, A0-A3, approval preview |
| 5 | Model / Tool / Connection / Execution Router | model/tool/connection router와 execution receipt |
| 6 | Work Surface / Project OS UX | Work Chat, Project Rooms, Connection/Approval surfaces |
| 7 | Truth Ledger / Recovery / Growth Loop | TruthLedger, RecoveryCell, GrowthCandidate replay |

### Phase 7. Human Scenario Qualification

T5는 단위 테스트나 화면 로딩으로 완료를 주장하지 않는다. 최소 40개 인간 사용자 시나리오에서 아래 흐름을 검증한다.

```text
사용자 발화
-> 자기파악
-> 말귀/맥락
-> ActionPlan
-> 도구/모델/연결 운용
-> 권한 경계
-> 실행/산출
-> Truth Ledger
-> 복구 또는 성장 후보
-> 다음 대화로 자연스럽게 연결
```

### Phase 8. Operating Blueprint / Recovery Map

Human Scenario Qualification을 통과한 뒤, T5를 장기적으로 수정·보강할 수 있도록 운영 설계도를 닫는다.
이 단계는 문서 정리가 아니라, 고장 대응과 다음 개발 세션의 연속성을 보장하는 마무리 공정이다.

반드시 포함한다.

1. **7대 영역 구조도**
   - Operational Selfhood, BEAI5 Model Operation, Intent/Context/T-cell, ActionPlan/Authority,
     Router/Execution, Work Surface, Truth Ledger/Recovery/Growth가 어떤 책임을 갖는지 정리한다.
2. **전체 요청 흐름 지도**
   - 사용자 발화 → SelfState → Intent → Context/POM/T-cell → ActionPlan → Authority →
     ToolRunner/Connector/Web/Automation → ToolReceipt → TruthLedger → Reply/Recovery/Growth.
3. **기능별 책임 파일/계약 매핑**
   - 웹 출처 문제, 채널 게이트, 기억 오염, 승인 우회, 원장 누락, UI 상태 불일치가 발생했을 때
     어느 계약·파일·테스트를 봐야 하는지 바로 찾을 수 있어야 한다.
4. **고장 증상별 대응표**
   - "웹에서 확인했다고 하는데 출처가 없음", "미등록 채널이 응답함", "기억이 무관한 답변에 영향",
     "승인 없이 전송", "원장에는 없는데 UI가 완료 표시" 같은 실사용 증상 기준으로 작성한다.
5. **핵심 불변식 목록**
   - 승인 전 실행 0, 출처 없는 웹 확인 금지, replay 전 T-cell 영향 0, unknown/disconnected channel 응답 금지,
     gated/blocked 이벤트 미기록, 도구 실행 가능성과 실행 허가 분리, 모델 자연스러움 훼손 금지.
6. **테스트/검증 지도**
   - 각 불변식을 어느 테스트와 어떤 실제 사용자 경로가 지키는지 연결한다.
7. **새 세션 handoff 템플릿**
   - 현재 phase, 최신 main, 열린 브랜치, 미추적 파일, 다음 작업, 금지선, 감사 기준, 검증 상태를
     다음 에이전트가 즉시 이어받을 수 있게 한다.

이 산출물이 없으면 T5는 "구현됐다"고 말할 수 있어도 "운영 가능한 OS"라고 말할 수 없다.

## 11. 성공 기준

T5의 초기 성공 기준은 다음이다.

1. 사용자가 "이 AI가 내 말을 알아들었다"고 느낀다.
2. 필요한 도구가 있을 때 도구 사용 가능/불가/연결 필요/승인 필요가 정확히 드러난다.
3. 도구를 쓰지 못했는데 쓴 척하지 않는다.
4. 사용자가 길게 설명하지 않아도 프로젝트 맥락, 미완료 작업, 승인 경계를 좁게 이어 간다.
5. 대화 중 새 지시가 들어와도 현재 목표가 흐트러지지 않는다.
6. 외부 전송, 삭제, 결제, 공개, 장기 기억 승격은 확실히 멈춘다.
7. 단순 대화는 빠르고 자연스럽다.
8. 복잡한 작업은 계획·실행·검증·복구가 보인다.
9. 오류가 나도 사용자는 "무엇이 안전하고 다음에 무엇을 하면 되는지"를 안다.
10. 성장/학습은 숨어서 행동을 바꾸지 않고, 후보·검토·승인·되돌리기로 작동한다.
11. BEAI5의 핵심 원리가 프롬프트 장문 주입이 아니라 OS의 속성과 구조로 반영된다.
12. 그럼에도 모델의 자연스러운 판단, 언어 흐름, 산출물 품질은 훼손되지 않는다.
13. 시스템은 매 턴 자신이 쓰는 모델, 도구, 권한, 맥락, 한계를 파악하고 그 범위 안에서 답한다.
14. 사용자는 채팅만 한다고 느끼지만, 실제로는 T5가 필요한 수단을 찾아 운용해 결과물에 도달한다.
15. 방법 설명이 아니라 목적 달성이 제품의 중심으로 체감된다.

## 12. 공정감시 기준

T5 개발은 각 단계마다 공정감시를 통과해야 한다. 공정감시는 개발을 느리게 만드는 의식이 아니라, T5가 다시 기능 많은 챗앱이나 기계적 프롬프트 컨트롤러로 퇴행하지 않게 하는 안전장치다.

각 개발 단위는 다음을 남긴다.

1. 닫는 7대 영역
2. 사용자 목적 달성 흐름에서의 위치
3. 자기파악에 필요한 상태 정보
4. 모델에 넘길 Task Context Packet
5. OS가 직접 통제할 상태·권한·도구·원장
6. 모델에게 남길 판단·언어·산출물 영역
7. 권한 경계와 승인 필요 여부
8. 실제 사용자 시나리오 검증
9. 실패·복구·non-mutation 증거
10. 자연스러움 훼손 여부
11. 참조한 레퍼런스와 흡수 방식
12. 그대로 복제하지 않고 T5식으로 재구성한 증거

완료 언어는 다음 조건을 통과해야만 허용한다.

```text
fresh user path
+ real response or artifact
+ capability/self-state alignment
+ authority boundary pass
+ tool/result truth ledger
+ recovery or non-mutation evidence
+ natural conversation replay
+ reference absorption record
```

## 13. 최종 판단

GPAO-T5는 이제 개발에 들어갈 가치와 기준이 충분하다.

이유는 다음이다.

1. 대형 AI 서비스는 강력하지만, 대부분은 자기 생태계 안의 뛰어난 도구다. 사용자의 로컬 PC, 메신저, 장기 프로젝트, 개인 운영 원리, 권한 경계, 반복 업무를 하나의 독립 OS 계약으로 소유하는 영역은 아직 열려 있다.
2. T3 개발 과정에서 이미 말귀, 권한, 연결, Truth Ledger, Follow-up Queue, Context Mesh, T-cell, human scenario QA의 실전 교훈이 쌓였다.
3. T5는 이 노하우를 "보조 기능"이 아니라 처음부터 OS kernel로 놓을 수 있다.
4. 차별화의 핵심은 UI 겉모습이 아니라, 사용자의 말과 상황을 정확히 받아 실제 행동으로 이어 주는 모델 운용 능력이다.
5. BEAI5는 T5에서 처음으로 프롬프트나 프로그래밍 보조 규칙이 아니라, OS 속성과 모델 판단 헌장이 결합된 원형 AI 운영체제 원리로 살아날 수 있다.
6. 사용자 목적 달성을 최상위 목표로 삼으려면 Operational Selfhood가 필수이며, 이는 T5만의 OS 고유성이 될 수 있다.
7. T5는 독창성을 핑계로 재발명하지 않고, T3와 선도 AI 제품들의 기능·성능·로직·알고리즘·디자인·구조를 흡수해 더 높은 출발점에서 개발한다.

따라서 다음 한 걸음은 아래 다섯 기준 산출물을 개발 과정의 기준으로 삼고, 첫 구현 slice에 들어가는 것이다.

```text
GPAO-T5 Product Constitution
+ Feature Taxonomy
+ 40-scenario Benchmark
+ Kernel Interface Spec
+ BEAI5 Integration Contract
```

첫 구현 slice:

```text
Work Chat
+ SelfStateSnapshot
+ BEAI5 Task Context Packet
+ ActionPlan
+ Authority A0-A3
+ Truth Ledger
+ Connection status
+ Follow-up Queue
```

이 slice가 T5의 첫 심장이다. 여기서 자연스럽게 목적 달성 흐름이 살아나면, 그 다음 7대 영역을 고밀도로 확장한다.
