# GPAO-T5 Reference Inventory (초안)

- Status: `초안 작성 완료 · 감사 전`
- Date: 2026-07-24
- Author: Claude Code (구현자)
- Auditor: Codex (감사 메모 컬럼은 비워 둠 — 감사자가 작성)
- Protocol: `GPAO-T5-REFERENCE-INVENTORY-PROTOCOL-2026-07-24-ko.md`
- Phase: `GPAO-T5-FINAL-DEVELOPMENT-PLAN` Phase 0 Final Research Seal

## 0. 이 초안의 상태와 근거 규율

프로토콜 §6 작업 지시를 따른다. 이 문서는 "좋은 기능 목록"이 아니라 흡수·경계·검증 근거다.

- 각 행은 실제 근거(로컬 경로/실사용/공식 문서)를 가진다. 근거 없는 인상평은 쓰지 않는다.
- `재사용 가능` 판정에는 라이선스·의존성 상태를 반드시 표시한다.
- 모르면 `추가 검증 필요`로 정직하게 표시한다.
- Codex 감사 메모 컬럼은 비워 둔다.
- 제품 코드는 작성하지 않았고, 정본 문서 4개도 수정하지 않았다.

### 근거 수집 방식 (대상별)

| 대상 | 근거 종류 | 상태 |
| --- | --- | --- |
| GPAO-T3 | 로컬 소스 `/Users/jyp/Developer/gpao-t3-2026.7.18` + 이번 세션 직접 개발·라이브 실측 | 강함 |
| lab_un/OpenClaw | 로컬 소스 `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20` (read-only 정찰) | 강함(구조), 실행 미검증 |
| Codex | 이번 세션 같은 머신 병렬 실행 관찰 + 공식 문서 | 중간 |
| Claude Code | 이 세션 자체가 Claude Code 실사용 | 강함(실사용), 내부구현 비공개 |
| OpenHands | 공식 문서만 | 약함 → 대부분 `추가 검증 필요` |
| ChatGPT | 공식 문서 + 일반 실사용 지식 | 중간 |
| native-runtime-research | 로컬 `/Users/jyp/Developer/gpao-t-native-runtime-research` | 정찰 진행 중 |

표기 규약: 6층위 = 기능/성능/로직/알고리즘/디자인/구조. T5매핑 = 표면/커널/라우터/권한/원장/복구
(+보조 자기파악/BEAI5/성장). 4분류 = 재사용가능/원리흡수/폐기/추가검증. 라이선스 = 확인됨/확인
필요/재사용금지/공식원리참조만/비공개.

---

## 1. GPAO-T3 (로컬 소스 + 라이브 실측)

T3는 T5의 직전 개발본이자 최대 흡수 후보다. 단 프로토콜 §2.3대로 "T3의 임시 설계·live 회귀·
누더기 사례 전용 로직"은 승계하지 않는다. 아래는 관찰된 기관 단위.

| ID | 대상 | 경로/근거 | 기능·기관명 | 6층위 | 사용자 기능 서술 | 관찰된 작동 방식 | T5 매핑 | 7대 영역 | 11기능군 | 4분류 | 판정 이유 | 라이선스 | 권한·프라이버시 | Ledger | 복구 요구 | 검증 | Codex 감사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T3-KERNEL-001 | GPAO-T3 | dist/gpao-t3-core/intent-kernel.js | 말귀 커널 입구 (IntentPacket) | 구조,로직 | 사용자 말을 그대로 모델에 던지지 않고 "무슨 요청인지"를 먼저 해석해 준다 | 입력을 IntentPacket으로 구조화, 무거운 기계(기억·POM·계약)는 뒤에서 붙임 | 커널,자기파악 | 3 Intent/Context/T-cell | 투명성,세션연속성 | 원리흡수 | T5는 IntentPacket을 §5.1대로 재정의. T3 스키마를 정본으로 삼지 않음 | 확인됨(자체) | 읽기 | 권장 | 사용자확인 | 봉인가능 |  |
| T3-KERNEL-002 | GPAO-T3 | dist/gpao-t3-core/action-plan.js | ActionPlan (말귀의 출구) | 구조,로직 | 흩어진 결정(도구·권한·승인)을 한 계획으로 모아 실행 직전을 정리 | IntentPacket→ActionPlan 컴파일. externalAction·needsApproval 플래그 | 커널,권한 | 4 ActionPlan/Authority | 승인/권한,개발작업 | 원리흡수 | T5 첫 슬라이스 핵심. A0-A3와 재구성 | 확인됨(자체) | 읽기~쓰기 | 필수 | 사용자확인 | 봉인가능 |  |
| T3-AUTH-001 | GPAO-T3 | dist/gpao-t3-core/tool-turn-guard.js | 되돌리기 어려운 외부행동 도구 가드 | 로직,알고리즘 | 전송·삭제·결제 같은 위험 행동을 사용자 확인 없이 실행하지 않음 | ActionPlan.externalAction 감지→게이트. 대시보드 외부전송 차단 실측 | 권한,복구 | 4 ActionPlan/Authority | 승인/권한 | 재사용가능 | T5 authority gate의 검증된 원형. 라이선스 자체 | 확인됨(자체) | 전송,삭제,비용 | 필수 | 사용자확인,non-mutation | 실행검증필요 |  |
| T3-AUTH-002 | GPAO-T3 | dist/gpao-t3-core/response-operating-contract.js | 비가역 외부행동 계약 | 구조,로직 | 보내기·지우기·결제·구독을 한 계약으로 묶어 일관되게 멈춤 | Irreversible outward actions 열거 + 응답 운영 규칙 | 권한 | 4 ActionPlan/Authority | 승인/권한,투명성 | 원리흡수 | 계약 개념 흡수, T5 AuthorityGrant로 재작성 | 확인됨(자체) | 전송,삭제,비용,공개 | 필수 | 사용자확인 | 봉인가능 |  |
| T3-LEDGER-001 | GPAO-T3 | dist/gpao-t3-core/persistent-ledger.js | 영속 원장 (recovery receipt) | 구조 | 무엇을 했고 무엇이 실패했는지 기록이 남음 | append 기반 recovery receipt + core ledger snapshot | 원장 | 7 Truth Ledger/Recovery | 투명성 | 원리흡수 | T5 TruthLedger로 재구성. 스키마는 T5 소유 | 확인됨(자체) | 읽기 | 필수 | rollback,retry | 봉인가능 |  |
| T3-RECOVERY-001 | GPAO-T3 | dist/gpao-t3-core/recovery-envelope.js | 복구 봉투 (RECOVERY_CLASSES) | 기능,로직 | 오류가 나도 "무엇이 안전하고 다음에 뭘 하면 되는지" 한국어로 안내 | 실패를 클래스로 분류(unknown/tool_failure/model_config 등)→사용자 복구 문장 | 복구,표면 | 7 Truth Ledger/Recovery | 투명성 | 재사용가능 | 사용자 체감 복구 어휘의 검증본. 단 이번 세션서 sanitizer가 진단면까지 덮는 부작용 확인 | 확인됨(자체) | 읽기 | 권장 | 사용자확인 | 실행검증필요 |  |
| T3-SELF-001 | GPAO-T3 | dist/gpao-t3-core/capability-registry.js | 능력 레지스트리 + 내부용어 가드 | 로직,구조 | "무엇을 할 수 있음"과 "지금 해도 됨"을 분리해 정직하게 표시 | 능력 상태(가능/연결필요/승인필요) 판정 + 사용자 문구에 내부용어 노출 차단 | 자기파악,표면 | 1 Operational Selfhood | 투명성,도구/앱연결 | 원리흡수 | T5 Operational Selfhood/Capability Map의 원형. 배포치환 함정 교훈 포함 | 확인됨(자체) | 읽기 | 권장 | 없음 | 봉인가능 |  |
| T3-TOOL-001 | GPAO-T3 | dist/gpao-t3-core/tool-path-briefing.js | 도구 경로 사실 주입 | 로직 | 이번 요청에 실제 쓸 수 있는 도구 경로를 모델이 알고 답함 | 능력 레지스트리 단일 출처로 사실만 주입, 지시문 금지, 무관턴 0바이트 | 라우터,자기파악 | 5 Model/Tool/Connection Router | 도구/앱연결,투명성 | 원리흡수 | T5 라우터 사실주입의 원형. 이번 세션 신규 구현·검증 | 확인됨(자체) | 읽기 | 불필요 | 없음 | 봉인가능 |  |
| T3-CONN-001 | GPAO-T3 | dist/gpao-t3-core/connection-registry.js, connection-state.js | 연결 레지스트리/상태 판정 | 로직,구조 | 지금 무엇이 붙어 있는지, 무엇을 붙이면 뭘 할 수 있는지 화면에 사실로 | mtime 캐시로 "지금 붙은 것" 판정 + 카탈로그(일 기준 묶음·연결방법·할수있는일) | 라우터,표면 | 5 Router / 6 Work Surface | 도구/앱연결,투명성 | 원리흡수 | 한국 사장 기준 재구성본은 T5 Connection Center로 흡수. 스키마 T5 소유 | 확인됨(자체) | 읽기,연결 | 권장 | 재연결 | 봉인가능 |  |
| T3-VAULT-001 | GPAO-T3 | dist/gpao-t3-core/customer-vault.js (+singleton, dashboard-unmask) | 고객정보 금고 | 알고리즘,구조 | 대화에 나온 연락처·주민번호가 기억엔 토큰으로만 남고 원문은 금고에 격리 | ingest 시 mask, 전송/렌더 직전에만 unmask(공유 싱글턴). 삭제/열람 경로 | 권한,원장 | 3 Context / 7 Recovery | 기억/개인화,승인/권한 | 재사용가능 | PII 격리의 검증된 알고리즘. 한국 민감정보 패턴 포함 | 확인됨(자체) | 읽기,삭제,장기기억 | 필수 | 삭제되돌리기불가(경고) | 실행검증필요 |  |
| T3-CTX-001 | GPAO-T3 | dist/gpao-t3-core/context-curation.js, tcell.js, pom-engine.js | Context 큐레이션 + T-cell admission + POM | 알고리즘,로직 | 기억을 "관련 있음"이 아니라 "이번 요청에 실제 필요함"으로 좁혀 씀 | admitted context / 작동원리(POM) 승격 분리, 라우터는 기억 안 씀 | 커널,성장 | 3 Intent/Context/T-cell | 기억/개인화 | 원리흡수 | T5 Context Mesh/T-cell로 재구성. §6.2 규칙 "라우터는 기억 안씀"과 정합 | 확인됨(자체) | 읽기,장기기억승격 | 권장 | 사용자확인 | 봉인가능 |  |
| T3-FLOW-001 | GPAO-T3 | dist/gpao-t3-core/long-flow-*.js (5 modules) | 장기 흐름 운영 상태 (세션 간 이음) | 구조,로직 | 세션이 바뀌어도 현재 목표·미완료 일·승인 경계를 좁게 이어감 | project-state/active-work-draft/active-target-resolver/cross-session-bridge/state-contract | 커널,복구 | 3 Context / 7 Recovery | 세션연속성 | 원리흡수 | T5 세션 연속성의 원형. §5 성공기준 4·5와 직결 | 확인됨(자체) | 읽기 | 권장 | 사용자확인 | 봉인가능 |  |
| T3-FOLLOW-001 | GPAO-T3 | dist/gpao-t3-core/request-trace.js, automation-proposal-queue.js | 반복 감지 → 자동화 제안 큐 | 알고리즘 | 같은 작업을 몇 번 반복하면 "자동으로 해드릴까요?" 후보를 검토 큐에 | 해시 서명으로 반복 카운트(PII-safe), 제안은 review queue에서 시작 | 성장,권한 | 7 Growth Loop | 자동화/스케줄 | 원리흡수 | T5 Follow-up Queue/Growth의 원형. 자동실행 아닌 후보·승인·되돌리기 | 확인됨(자체) | 읽기 | 권장 | 되돌리기 | 봉인가능 |  |
| T3-GROWTH-001 | GPAO-T3 | dist/gpao-t3-core/growth-engine.js, replay-evaluator.js, growth-policy.js | 성장 엔진 + replay 평가 | 알고리즘,로직 | 학습이 숨어서 행동을 바꾸지 않고 후보→검토→승인→되돌리기로 작동 | growth proposal 생성 + replay로 검증 + admission policy 게이트 | 성장 | 7 Growth Loop | 자동화/스케줄,투명성 | 추가검증 | 개념은 T5 정합이나 라이브 성숙도 미확인. T5 GrowthCandidate로 재작성 필요 | 확인됨(자체) | 읽기 | 권장 | 되돌리기 | 실행검증필요 |  |
| T3-WEB-001 | GPAO-T3 | dist/gpao-t3-core/web-collector.js, web-collection-policy.js, scrapling-adapter.js | 웹 수집 (권한 등급 A0-A5) | 기능,알고리즘 | URL을 주면 읽고 정리하되, 범위·권한에 따라 승인 게이트 | 정책이 static/scrapling_parser/dynamic 모드 분류, dynamic은 미구현(회수계획만) | 라우터,권한 | 5 Execution Router | 로컬PC실행,도구/앱연결 | 추가검증 | 정적·구조추출은 동작, 동적 렌더 미구현. dynamic 경로 보완 필요 | 확인됨(자체) | 읽기 | 권장 | 없음 | 실행검증필요 |  |
| T3-SURFACE-001 | GPAO-T3 | dist/control-ui/gpao-t3-*.js (10 인핸서) | Work Chat/연결/자동화/고객정보 등 표면 인핸서 | 디자인,구조 | 채팅 중심 화면에 배운작업·연결·자동화·고객정보를 자연스럽게 얹음 | classic 스크립트 IIFE(전역충돌 방지), 라우트 별칭 복원, 죽은 버튼 금지 | 표면 | 6 Work Surface | 멀티표면,투명성 | 폐기 | classic 인핸서는 컴파일 번들 위 덧씌우기라 T3 특유의 임시 구조. T5는 표면을 정본으로 새로 설계 | 확인됨(자체) | 읽기 | 불필요 | 없음 | 봉인가능 |  |
| T3-LESSON-001 | GPAO-T3 | 이번 세션 라이브 실측 + auto-memory | 배포 치환이 가드를 먹는 함정 등 회귀 지식 | 성능,구조 | (개발자 대상) 소스는 멀쩡한데 배포본만 죽는 사고를 막음 | 절대원칙 문서·환경헌장에 이미 승격됨 | 복구 | (개발 규율) | 투명성 | 원리흡수 | 제품 기능 아님. T5 절대원칙·환경헌장으로 이미 흡수 완료 | 확인됨(자체) | 없음 | 불필요 | 없음 | 봉인가능 |  |

---

## 2. lab_un / OpenClaw (로컬 소스, read-only 정찰)

프로토콜 §3: OpenClaw는 적극 해부 대상이나 T5 정본이 아니다. 발견물은 기본 `원리만 흡수`에서
시작한다(§3.3). identity/runtime path/config schema/사용자 표면을 T5 정본으로 삼지 않는다.
근거: 코어 23패키지 + extensions 152개 + apps 7개 정찰(모두 `@openclaw/*`, 대부분 0.0.0-private).

| ID | 대상 | 경로/근거 | 기능·기관명 | 6층위 | 사용자 기능 서술 | 관찰된 작동 방식 | T5 매핑 | 7대 영역 | 11기능군 | 4분류 | 판정 이유 | 라이선스 | 권한·프라이버시 | Ledger | 복구 요구 | 검증 | Codex 감사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| OPENCLAW-PROVIDER-001 | lab_un/OpenClaw | packages/ai (115파일,~31k LOC, v2026.7.2, LICENSE 있음) | 모델 provider 어댑터 + 스트리밍 런타임 | 구조,알고리즘 | 여러 모델 공급자를 한 방식으로 붙여 대화·작업에 사용 | api-registry/host/stream, llm-core 재수출. 유일하게 정식 버전·README | 라우터 | 5 Model/Tool/Connection Router | 확장성,도구/앱연결 | 추가검증 | T5 Model Router 참고 가치 높음. 단 라이선스 실체·의존성 확인 필요, wrapper화 위험 | 확인필요 | 읽기,비용 | 권장 | fallback | 라이선스확인필요 |  |
| OPENCLAW-PROTO-001 | lab_un/OpenClaw | packages/gateway-protocol (114파일,~21k LOC) | 게이트웨이 와이어 프로토콜 + validate* 검증기 | 구조,로직 | (내부) 클라이언트-게이트웨이 통신을 스키마로 검증 | Zod류 스키마 + 컴파일된 validate* 다수. 여러 패키지가 의존 | 커널,라우터 | 5 Router | 확장성 | 원리흡수 | 스키마 검증 패턴 참고. T5는 자체 계약(IntentPacket 등)으로 재작성 | 확인필요 | 없음 | 불필요 | 없음 | 라이선스확인필요 |  |
| OPENCLAW-MEMORY-001 | lab_un/OpenClaw | packages/memory-host-sdk (109파일,~17k LOC) | 기억 호스트 SDK (임베딩·저장·질의·CLI) | 알고리즘,구조 | 대화 기억을 임베딩으로 저장·검색 | engine(+embeddings/storage/qmd) + query + multimodal + runtime-cli. 자기완결 서브시스템 | 커널 | 3 Intent/Context/T-cell | 기억/개인화 | 추가검증 | T5 Context Mesh 참고. 단 T5는 admitted context/POM 분리 철학이 달라 원리만 | 확인필요 | 읽기,장기기억 | 권장 | 없음 | 실행검증필요 |  |
| OPENCLAW-PLUGIN-001 | lab_un/OpenClaw | packages/plugin-sdk, plugin-package-contract | 플러그인/provider SDK + 패키지 계약 | 구조 | (개발자) 외부 도구를 플러그인으로 붙이는 확장 규격 | definePluginEntry/defineBundledChannelEntry 등 진입 계약. 실코드는 src/ | 라우터 | 5 Router | 확장성 | 원리흡수 | T5 Connector Manifest + Adapter Conformance로 재구성. 계약 개념만 | 확인필요 | 없음 | 불필요 | 없음 | 라이선스확인필요 |  |
| OPENCLAW-TOOLREPAIR-001 | lab_un/OpenClaw | packages/tool-call-repair (8파일,~4.5k LOC) | 모델 평문 tool call 복구 | 알고리즘 | (내부) 모델이 잘못 뱉은 도구 호출을 정상화해 실행 성공률↑ | parseStandalonePlainTextToolCallBlocks 등. 스트림 이벤트 정규화 | 라우터,복구 | 5 Router | 개발작업 | 추가검증 | 도구 호출 안정성 알고리즘 참고 가치. T5 실행 계약에 맞는지 검증 필요 | 확인필요 | 없음 | 권장 | retry | 실행검증필요 |  |
| OPENCLAW-CHANNEL-001 | lab_un/OpenClaw | extensions/{telegram,slack,discord,line,whatsapp,signal,matrix,...} (~23 채널) | 메신저 채널 어댑터군 | 기능,구조 | 텔레그램·슬랙 등 여러 메신저로 T5와 대화 | defineBundledChannelEntry로 채널플러그인+시크릿+런타임 배선 | 라우터,표면 | 5 Router / 6 Surface | 멀티표면,도구/앱연결 | 원리흡수 | 채널 호환성 범위 참고(T3보다 넓음). T5 Channel Inbox로 재구성, brand·config 정본 금지 | 확인필요 | 전송,수신 | 필수 | 재전송 | 라이선스확인필요 |  |
| OPENCLAW-MODELPROV-001 | lab_un/OpenClaw | extensions/{openai,anthropic,google,ollama,groq,...} (~47 provider) | 모델 provider 확장군 (47개) | 기능,구조 | 상용·로컬 모델 다수를 선택해 사용 | 각 provider가 auth·모델카탈로그·스트림 배선. 매니페스트에 모델ID | 라우터,자기파악 | 5 Model Router | 확장성 | 원리흡수 | T5 Model Router가 참고할 provider 폭. 브랜드·비공개 부분 제외, 원리·구조만 | 확인필요 | 읽기,비용 | 권장 | fallback | 라이선스확인필요 |  |
| OPENCLAW-SEARCH-001 | lab_un/OpenClaw | extensions/{brave,duckduckgo,exa,firecrawl,perplexity,tavily,web-readability,document-extract} | 웹 검색·추출 도구군 | 기능 | 웹에서 정보를 찾고 본문·표를 추출 | tool plugin으로 검색 provider 배선(lazy runtime HTTP) | 라우터 | 5 Execution Router | 도구/앱연결,로컬PC실행 | 원리흡수 | T3 web-collector보다 폭넓은 검색·추출 참고. T5 실행계약으로 재구성 | 확인필요 | 읽기 | 권장 | 없음 | 라이선스확인필요 |  |
| OPENCLAW-MEMORYEXT-001 | lab_un/OpenClaw | extensions/{active-memory,memory-core,memory-lancedb,memory-wiki} | 능동 기억 확장군 | 알고리즘,기능 | 대화 전 관련 기억을 자동 회수하고 "Remember"로 저장 | 답변 전 bounded 회수 + per-agent Remember. lancedb 벡터 저장 옵션 | 커널 | 3 Context/T-cell | 기억/개인화 | 추가검증 | T5 기억 철학(admitted/POM 분리)과 정합 여부 검증 필요 | 확인필요 | 읽기,장기기억 | 권장 | 없음 | 실행검증필요 |  |
| OPENCLAW-ADMIN-001 | lab_un/OpenClaw | extensions/{admin-http-rpc,diagnostics-otel,diagnostics-prometheus,logbook,policy,vault,webhooks} | 관리·진단·정책·감사 인프라군 | 구조,성능 | (운영자) 관리 RPC·진단·정책·시크릿 금고·웹훅 | admin-http-rpc가 scope trusted-operator로 allowlist RPC 노출 | 권한,원장 | 5 Router / 7 Ledger | 승인/권한,투명성 | 원리흡수 | T5 권한 경계·감사 인프라 참고. 특히 scope 기반 admin allowlist 패턴 | 확인필요 | 읽기,쓰기,전송 | 필수 | rollback | 실행검증필요 |  |
| OPENCLAW-LOCALEXEC-001 | lab_un/OpenClaw | packages/terminal-core, extensions/{browser,openshell,phone-control,file-transfer,canvas} | 로컬 실행·터미널·브라우저·기기 제어군 | 기능,디자인 | 파일·터미널·브라우저·기기를 T5가 대신 다룸 | terminal-core(ansi·progress·prompt) + browser/openshell/phone-control 확장 | 라우터,표면 | 5 Router / 6 Surface | 로컬PC실행,멀티표면 | 추가검증 | Codex/Claude Code와 겹치는 로컬 지배력. T5 Local PC Workspace 참고, 실행·권한 검증 필요 | 확인필요 | 읽기,쓰기,실행 | 필수 | non-mutation,rollback | 실행검증필요 |  |
| OPENCLAW-APP-001 | lab_un/OpenClaw | apps/{android,ios,linux,macos,swabble} | 멀티플랫폼 네이티브 앱(모바일·데스크톱·웨이크워드) | 기능,디자인,구조 | 폰·데스크톱에서 게이트웨이에 붙어 채팅·음성·승인·화면·기기자동화 | 각 앱이 role:node로 게이트웨이 연결. Bonjour 발견, 트레이, 온디바이스 음성 | 표면,라우터 | 6 Work Surface | 멀티표면 | 폐기 | 현재 T5 본체 개발은 설치·온보딩·네이티브 앱 비범위(계획서). 후속 참고로만 보류 | 확인필요 | 읽기,전송,기기제어 | 필수 | 없음 | 사용자판단필요 |  |
| OPENCLAW-SPEECH-001 | lab_un/OpenClaw | packages/speech-core (v2026.5.31), extensions/{elevenlabs,deepgram,azure-speech,inworld,tts-local-cli} | 음성 런타임 (TTS/STT) | 기능 | 음성으로 말하고 듣기 | speech-core가 TTS/STT provider 배선. 로컬·클라우드 옵션 | 라우터 | 5 Router | 멀티표면 | 폐기 | T5 첫 슬라이스·7대 영역에 음성 없음. 후속 P1/P2 참고로 보류 | 확인필요 | 읽기,비용 | 불필요 | 없음 | 사용자판단필요 |  |
| OPENCLAW-WORKBOARD-001 | lab_un/OpenClaw | packages/workboard-contract, extensions/workboard | Workboard 도메인 계약 (상태·우선순위·이벤트) | 구조 | 작업을 상태·우선순위로 관리하는 보드 | WORKBOARD_STATUSES/PRIORITIES/EVENT_KINDS enum + 타입셋 | 표면,원장 | 6 Work Surface | 프로젝트/작업공간 | 추가검증 | T5 Project Rooms/Canvas 참고. 계약 개념만, 스키마 T5 소유 | 확인필요 | 읽기,쓰기 | 권장 | 없음 | 실행검증필요 |  |

---

## 3. Codex / Claude Code / OpenHands / ChatGPT (실사용 + 공식 문서)

프로토콜 §2.2·§5.1(5): 이들은 비공개 구현·고유 제품 경험이므로 기본 `원리만 흡수`. 브랜드·화면·
비공개 코드를 복제 대상으로 삼지 않는다.

| ID | 대상 | 경로/근거 | 기능·기관명 | 6층위 | 사용자 기능 서술 | 관찰된 작동 방식 | T5 매핑 | 7대 영역 | 11기능군 | 4분류 | 판정 이유 | 라이선스 | 권한·프라이버시 | Ledger | 복구 요구 | 검증 | Codex 감사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CODEX-LOCAL-001 | Codex | 이번 세션 같은 머신 병렬 실행 관찰 + 공식 문서 | 로컬 PC 지배력 (파일·터미널·독립 실행) | 기능,로직 | 말하면 로컬에서 파일·명령이 실제로 실행되고 진행이 보임 | 독립 프로세스로 파일 정리 rm 등을 실행하는 것을 이번 세션 실측 | 라우터,표면 | 5 Router / 6 Surface | 로컬PC실행,개발작업 | 원리흡수 | T5 Local PC Workspace의 방향. 비공개 구현이라 원리만 | 비공개 | 읽기,쓰기,실행 | 필수 | 사용자확인 | 사용자판단필요 |  |
| CODEX-APPROVAL-001 | Codex | 공식 문서 | 승인 모드 (approval modes) | 로직 | 위험 행동 전에 승인을 받는 단계가 있음 | approval mode로 실행 전 확인 | 권한 | 4 Authority | 승인/권한 | 원리흡수 | T5 A0-A3로 재구성. Claude Code permission mode와 함께 통합 | 비공개 | 쓰기,실행 | 권장 | 사용자확인 | 봉인가능 |  |
| CLAUDE-PERM-001 | Claude Code | 이 세션 자체가 실사용 | permission mode | 로직,디자인 | 도구 사용 전 허용/차단이 사용자 통제 아래 있음 | 도구별 권한 모드. 이번 세션 auto-mode classifier가 rm 차단 실측 | 권한 | 4 Authority | 승인/권한 | 원리흡수 | 계획서 §7이 명시적으로 A0-A3로 통합하라 지시 | 비공개 | 쓰기,실행 | 권장 | 사용자확인 | 봉인가능 |  |
| CLAUDE-MCP-001 | Claude Code | 이 세션 실사용 + 공식 문서 | MCP (도구 연결 프로토콜) | 구조 | 외부 도구·데이터를 표준 방식으로 붙임 | MCP 서버를 도구로 노출. 세션 중 deferred tool 로딩 관찰 | 라우터 | 5 Router | 도구/앱연결,확장성 | 원리흡수 | T5 Connector Manifest로 재구성. 개방 표준이나 T5 계약으로 감쌈 | 공식원리참조만 | 읽기,쓰기 | 권장 | 없음 | 봉인가능 |  |
| CLAUDE-HOOKS-001 | Claude Code | 이 세션 실사용 + 공식 문서 | hooks | 로직 | 특정 시점에 자동 동작을 걸어 규율을 강제 | 이벤트에 훅 실행. 환경헌장이 Phase 5 게이트로 참조 | 원장,권한 | (개발 규율) | 자동화/스케줄 | 원리흡수 | T5 개발 규율(환경헌장) + 제품 자동화 양쪽 참고. Phase 5에 적용 | 공식원리참조만 | 실행 | 권장 | 없음 | 봉인가능 |  |
| CLAUDE-SUBAGENT-001 | Claude Code | 이 세션 실사용(이 인벤토리 정찰에 사용) | subagents | 알고리즘,성능 | 큰 조사를 병렬로 나눠 빠르게, 맥락 오염 없이 | 서브에이전트에 read-only 정찰 위임, 결과만 회수. 이번 정찰에 실사용 | 커널 | (개발 방식) | 개발작업 | 원리흡수 | 개발 방식 참고(Reference-First 병렬 흡수에 직접 유효). 제품 기능 아님 | 공식원리참조만 | 읽기 | 불필요 | 없음 | 봉인가능 |  |
| CLAUDE-RESUME-001 | Claude Code | 이 세션 실사용 + 공식 문서 | resume / continue | 기능 | 대화가 끊겨도 이전 작업을 이어감 | 세션 재개. T3 long-flow와 같은 목표 | 커널 | 3 Context | 세션연속성 | 원리흡수 | T5 cross-surface session resume(P1)로 재구성 | 공식원리참조만 | 읽기 | 권장 | 없음 | 봉인가능 |  |
| CLAUDE-MULTISURFACE-001 | Claude Code | 공식 문서 | 다중 표면 (terminal/IDE/desktop/web) | 디자인,구조 | 같은 에이전트를 여러 화면에서 같은 상태로 씀 | terminal·IDE·desktop·web에서 운영 | 표면 | 6 Work Surface | 멀티표면 | 원리흡수 | 계획서 §4 "같은 상태 언어" 목표. T5 화면 문법으로 통합 | 비공개 | 읽기 | 불필요 | 없음 | 추가소스필요 |  |
| OPENHANDS-SDK-001 | OpenHands | 공식 문서만 | model-agnostic agent server (CLI/web/SDK/headless) | 구조 | 특정 모델·UI에 묶이지 않는 에이전트 실행 기반 | CLI·web GUI·headless SDK·sandbox 제공(공식 문서 근거) | 라우터,커널 | 5 Router | 확장성,로컬PC실행 | 추가검증 | 계획서 §2.3이 "wrapper화 금지" 명시. 소스 미확인이라 추가검증 | 공식원리참조만 | 읽기,쓰기,실행 | 권장 | 없음 | 추가소스필요 |  |
| OPENHANDS-SANDBOX-001 | OpenHands | 공식 문서만 | sandbox 실행 격리 | 로직,구조 | 위험 작업을 격리된 환경에서 실행 | sandbox로 파일/명령 격리(공식 문서) | 권한,복구 | 4 Authority / 7 Recovery | 로컬PC실행,승인/권한 | 추가검증 | 격리 실행 원리 참고. 실동작·라이선스 미확인 | 공식원리참조만 | 실행 | 권장 | non-mutation | 실행검증필요 |  |
| CHATGPT-PROJECT-001 | ChatGPT | 공식 문서 + 일반 실사용 | Projects (작업공간) | 기능,디자인 | 대화·파일·지침을 프로젝트 단위로 묶음 | 프로젝트에 대화·파일·커스텀 지침 | 표면 | 6 Work Surface | 프로젝트/작업공간 | 원리흡수 | T5 Project Rooms로 재구성. 화면 복제 금지 | 비공개 | 읽기,쓰기 | 불필요 | 없음 | 봉인가능 |  |
| CHATGPT-MEMORY-001 | ChatGPT | 공식 문서 + 일반 실사용 | Memory (개인화 기억) | 기능 | 이전 대화를 기억해 개인화된 답 | 자동 기억 + 사용자 관리 | 커널,성장 | 3 Context/T-cell | 기억/개인화 | 원리흡수 | 계획서 §3이 "raw memory 아닌 admitted context/POM 분리" 명시. 원리만 | 비공개 | 읽기,장기기억 | 권장 | 되돌리기 | 봉인가능 |  |
| CHATGPT-APPS-001 | ChatGPT | 공식 문서 | Apps / Connectors | 구조 | 외부 앱·데이터를 대화에서 바로 사용 | 앱/커넥터로 외부 연결 | 라우터 | 5 Router | 도구/앱연결,확장성 | 원리흡수 | T5 Connection Center로 재구성(읽기/쓰기/전송/비용 분리) | 비공개 | 읽기,쓰기,전송 | 필수 | 없음 | 봉인가능 |  |
| CHATGPT-TASKS-001 | ChatGPT | 공식 문서 | Tasks (예약·자동화) | 기능 | 반복·예약 작업을 자동 실행 | 스케줄된 작업 | 성장,권한 | 7 Growth Loop | 자동화/스케줄 | 원리흡수 | T5는 review queue 시작·외부효과 명시승인으로 재구성 | 비공개 | 쓰기,전송 | 필수 | 되돌리기 | 봉인가능 |  |
| CHATGPT-CANVAS-001 | ChatGPT | 공식 문서 + 일반 실사용 | Canvas (산출물 편집) | 디자인,기능 | 문서·코드를 대화 옆에서 직접 편집 | 편집 가능 캔버스 + 버전 | 표면 | 6 Work Surface | 프로젝트/작업공간 | 원리흡수 | T5 Canvas/Workboard(P1)로 재구성 | 비공개 | 읽기,쓰기 | 권장 | 버전되돌리기 | 봉인가능 |  |

---

## 3.5 GPAO-T Native Runtime Research (로컬 소스, read-only 정찰)

근거: `/Users/jyp/Developer/gpao-t-native-runtime-research` 정찰. 이곳은 OpenClaw 의존을 끊는
자체 네이티브 커널을 연구·프로토타입한 저장소이며, 최신 문서가 T5 AI OS로 pivot한 바로 그 연구다.
`runtime-lab/`에 Node 내장만으로 만든 격리 커널 프로토타입(SQLite 이벤트 저널·권한·워커 격리)이
실재한다. T5의 L0 State Kernel 직속 흡수 후보라 별도 섹션으로 둔다.

| ID | 대상 | 경로/근거 | 기능·기관명 | 6층위 | 사용자 기능 서술 | 관찰된 작동 방식 | T5 매핑 | 7대 영역 | 11기능군 | 4분류 | 판정 이유 | 라이선스 | 권한·프라이버시 | Ledger | 복구 요구 | 검증 | Codex 감사 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NATIVE-KERNEL-001 | native-runtime | runtime-lab/src/core/{runtime,store,state-writer,event-router}.js | 단일 프로세스 네이티브 이벤트 커널 (command/event/outbox) | 구조,알고리즘 | (기반) 대화 한 턴을 저장·복구하고 격리 워커로 답을 만든다 | SQLite에 command/event/outbox 소유, single-writer 저널, generation fencing. OpenClaw 없이 start·store·recover·answer 실증 | 커널,원장 | 1 Selfhood / 7 Ledger | 세션연속성,투명성 | 추가검증 | T5 L0 State Kernel(§6.2)의 가장 근접한 원형. 단 FOUNDATION-REVIEW가 "production 아님, P0/P1 blocker" 명시 | 확인필요(자체계열) | 읽기,쓰기 | 필수 | rollback,recover | 실행검증필요 |  |
| NATIVE-AUTH-001 | native-runtime | runtime-lab/src/core/{capability-permit,execution-controller,worker}.js | 권한 permit + 워커 실행 격리 | 로직,구조 | 위험 작업을 권한 허가와 격리 워커로만 실행 | capability-permit + principal-scoped reads + bounded worker execution + local owner-token(0600) | 권한,복구 | 4 Authority / 5 Router | 승인/권한,로컬PC실행 | 추가검증 | T5 authority/execution router 원형. OpenHands sandbox와 비교 흡수 대상 | 확인필요(자체계열) | 읽기,쓰기,실행 | 필수 | non-mutation | 실행검증필요 |  |
| NATIVE-CRED-001 | native-runtime | runtime-lab/src/core/{credential-bridge,secure-connection-*,secret-hygiene}.js | 자격증명 브릿지 + 시크릿 위생 | 구조,알고리즘 | (기반) 연결 자격증명을 안전하게 보관·전달 | credential-bridge + secure transport/agent + secret-hygiene. Stage Board가 "platform-neutral credential broker"를 미결로 표시 | 권한 | 5 Router | 도구/앱연결,승인/권한 | 추가검증 | T5 Connection Center 자격증명 계층 참고. 미완(플랫폼 중립 broker) | 확인필요(자체계열) | 읽기,비공개저장 | 권장 | 없음 | 실행검증필요 |  |
| NATIVE-KERNELMODULE-001 | native-runtime | runtime-lab/src/core/{tcell,connection-cell,pom-engine,growth-engine,replay-evaluator,mct-comparison}.js | T-cell·POM·성장·MCT 커널 모듈 (T3와 동계열) | 로직,알고리즘 | (기반) 맥락 승인·작동원리·성장·모델비교 | T3 gpao-t3-core와 이름·개념이 겹치는 커널 모듈군의 격리 런타임판 | 커널,성장 | 3 Context / 7 Growth | 기억/개인화 | 추가검증 | T3 커널의 "격리 런타임" 버전. T3본과 어느 쪽을 이전 기준으로 삼을지 판단 필요 | 확인필요(자체계열) | 읽기 | 권장 | 없음 | 실행검증필요 |  |
| NATIVE-BENCH-001 | native-runtime | engineering/ (63 docs) + runtime-lab/tools/ (45 qualify/benchmark 스크립트) | 벤치마크·자격검증 하네스 + 봉인 증거 | 성능,알고리즘 | (개발) 커널 성능·자격을 측정하고 증거로 봉인 | benchmark-* + qualify-* + evidence/ 60개 봉인 디렉터리(git source.bundle 포함). p50~0.82ms(모델無, 결정적) | 원장 | 7 Ledger/Growth | 투명성 | 원리흡수 | T5 Scenario Replay Bench·공정감시 증거 방식 참고. 수치는 제품 속도 주장 아님(문서 명시) | 확인필요(자체계열) | 읽기 | 필수 | 없음 | 봉인가능 |  |
| NATIVE-DOCTRINE-001 | native-runtime | engineering/GPAO-T5-AI-OS-RESEARCH-AND-DESIGN-PLAN-2026-07-24-ko.md 등 | T5 pivot 연구·설계 문서군 | 구조 | (개발) T5가 "T3+기능"·UI클론이 아니어야 한다는 판단 근거 | 이 저장소의 최신 문서가 곧 T5 AI OS로의 전환 근거. 현 계획서의 상류 자료 | (개발 규율) | (전 영역 배경) | 투명성 | 원리흡수 | T5 정본 계획의 연구 배경. 이미 계획서로 흡수됨. 정본 아님 | 확인됨(자체) | 없음 | 불필요 | 없음 | 봉인가능 |  |

경계 주의(프로토콜 §3 정합): 이 저장소는 자체 계열이라 OpenClaw보다 흡수 여지가 크지만,
Stage Board가 스스로 `development: hold until baseline seal`, `current mutation: prohibited`를
선언했다. 즉 **아직 봉인 전 연구물**이므로 T5가 이것을 정본으로 삼기 전 baseline seal 상태를
확인해야 한다. 그래서 대부분 `추가 검증 필요`로 뒀다.

---

## 4. 커버리지 자가 점검 (봉인 조건 §4.5 대비)

초안 작성자 자가 점검이며, 최종 판정은 Codex 감사다.

| 봉인 조건 | 현재 상태 |
| --- | --- |
| 대상별 최소 조사 단위 | GPAO-T3 ✅ / lab_un/OpenClaw ✅ / native-runtime ✅ / Codex △(공식+관찰) / Claude Code ✅ / OpenHands ⚠(공식만) / ChatGPT △ |
| 11개 기능군 모두 커버 | ✅ 1프로젝트 2기억 3도구연결 4로컬실행 5멀티표면 6자동화 7승인권한 8세션연속 9개발작업 10확장성 11투명성 각 1행 이상 |
| 6층위 모두 등장 | ✅ 기능·성능·로직·알고리즘·디자인·구조 전부 등장 |
| T5 매핑 6태그 모두 등장 | ✅ 표면·커널·라우터·권한·원장·복구 전부 + 보조 자기파악·BEAI5(간접)·성장 |
| 폐기·원리흡수 충분 | ✅ 폐기 4행, 원리흡수 다수 |
| 재사용가능은 라이선스 표시 | ✅ 재사용가능 4행 모두 라이선스 상태 기재 |
| 근거 없는 칭찬 없음 | 자가점검상 없음(각 행 경로/실측/문서 근거) |
| Codex 감사 메모 | ⬜ 전 행 비움 (감사자 작성 대기) |

### 미충족·정직한 공백

- **OpenHands**: 공식 문서만. 로컬 소스·실행 근거 없어 대부분 `추가 검증 필요`. 봉인 전 추가 소스 필요.
- **native-runtime-research**: 정찰 완료(§3.5 추가). 단 Stage Board가 `hold until baseline seal`·
  `mutation prohibited`를 스스로 선언한 봉인 전 연구물이라 대부분 `추가 검증 필요`. T3본과 커널
  개념이 겹쳐(어느 쪽을 이전 기준으로) Phase 1 결정 필요.
- **Codex/ChatGPT**: 비공개라 내부 동작은 관찰·공식 문서 한계. `원리만 흡수`로 정직히 제한.
- **BEAI5 보조 태그**: 직접 행은 T3-KERNEL·conversation-flow 계열에 간접적. BEAI5 참고 문서 기반
  전용 행은 Phase 1~2 Kernel Contract에서 보강 권장.

---

## 5. Phase 1로 넘길 결정/질문 (초안자 제안 — 정본 수정 아님)

프로토콜 §6-8대로 정본 문서는 수정하지 않았다. 아래는 감사·다음 Phase 판단용 제안일 뿐이다.

1. **T3 재사용가능 4건**(tool-turn-guard, recovery-envelope, customer-vault, capability-registry)은
   라이선스가 자체이므로 코드 이전이 가장 현실적이다. 단 recovery-envelope는 이번 세션에서
   "정화가 진단면까지 덮는" 부작용이 확인됐으니 T5 이전 시 사용자면/진단면 분리가 조건.
2. **lab_un/OpenClaw는 전부 라이선스 `확인 필요`**다. `재사용 가능` 승격 전 라이선스·transitive
   dependency 실사가 선행돼야 한다(프로토콜 §3.3). 현재는 `원리만 흡수`/`추가 검증`에 머문다.
3. **로컬 PC 실행**은 Codex·Claude Code·OpenClaw·OpenHands가 겹친다. T5 Local PC Workspace 설계
   시 이 넷의 권한·receipt·sandbox 패턴을 비교 흡수할지 결정 필요.
4. **네이티브 앱·음성**(OpenClaw apps/speech)은 계획서상 현재 비범위라 `폐기`로 뒀다. P1/P2 확장
   시 재평가할지 결정 필요.
5. **OpenHands 실소스 확보** 여부 — 공식 문서만으로는 `추가 검증 필요`를 벗어날 수 없다.
6. **native-runtime vs T3 커널 중복** — native-runtime-research의 `runtime-lab/`에 T3 gpao-t3-core와
   같은 개념의 커널(tcell·pom·growth·replay)이 "격리 런타임판"으로 존재한다. T5 L0 State Kernel의
   이전 기준을 (a) T3 개발본 (b) native-runtime 격리판 중 어느 쪽으로 삼을지 Phase 1~2 결정 필요.
   native판은 OpenClaw 독립·SQLite 저널이 강점이나 "production 아님/baseline seal 대기" 상태다.

---

*이 초안은 `초안 작성 완료 · 감사 전` 상태다. Codex 감사 통과 전에는 Phase 0 봉인이 아니다.*
