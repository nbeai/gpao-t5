# GPAO-T5 Phase 5.1 — Reference Absorption Hardening

- Status: `초안 작성 완료 · 감사 전`
- Date: 2026-07-24
- Author: Claude Code (구현자) — 두 원본소스 직접 분석 + 심층 리드 2건
- Auditor: Codex (감사 대기)
- Phase: **Phase 5.1 (Phase 5와 Phase 6 사이 삽입)** — 오너 지시
- 근거: OpenClaw 원본(`/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20`) + Hermes 원본
  (`/Users/jyp/Developer/lab_un/hermes-agent`) 직접 분석 / 봉인된 Kernel Contract·UX Architecture·
  UI/UX Reference Seal / Reference Inventory(Phase 0) / First Build Slice 구현
- 위상: Kernel Contract 아래에서, P5 심장을 P6 확장 전에 보강한다. **기능 추가가 아니라 골격 보강.**

## 0. 목적 + 작성 규율

- **목적**: OpenClaw/Hermes 원본소스 정밀 분석 결과를 T5 첫 심장(P5 Work Chat 수직)에 반영해, P6
  (7대 영역 확장)가 엉키지 않도록 **구조적 빈자리를 미리 연다.** P5가 흔들린 채 P6로 가면 기능만
  많아지고 T5 정체성이 흐려진다.
- **범위 규율**: P5.1은 **상태 언어와 계약 빈자리**를 연다. 전이 기계·커넥터·원격 실행은 P6. 이 문서는
  제품 코드를 대량 작성하지 않는다(최소 반영은 §5, 감사 통과 후).
- **Reference-First(헌법 §3.1)**: 구조·원리를 흡수하되 identity/runtime/config/UI/브랜드를 정본으로
  삼거나 복제하지 않는다. T5는 이미 봉인된 자기 계약의 빈자리를 채울 뿐, 그들의 언어를 수입하지 않는다.
- **계보 경계(핵심)**: OpenClaw와 Hermes는 별개 참조가 아니라 **한 제품 라인의 두 세대**다
  (Warelay→Clawdbot→Moltbot→OpenClaw→Hermes[Nous]. `hermes claw migrate`가 `~/.openclaw`를 읽는다).
  **T5는 이 사슬의 다음 껍질이 되지 않는다.** P5.1의 절반은 흡수, 절반은 오염 차단이다.

Phase 0 인벤토리와의 관계: 인벤토리는 OpenClaw(openclaw-pure)·native-runtime을 다뤘고 **Hermes는
없었다.** P5.1은 Phase 0 재탕이 아니라, 새로 확보된 — 그리고 P6가 필요로 하는 바로 그 DNA를 가진 —
Hermes를 흡수하고, OpenClaw는 P5 심장 관점으로 재해석한다.

---

## 1. OpenClaw 원본소스 분석 결과 (직접 분석, file:path 근거)

TypeScript 모노레포. 런타임 정체성은 **gateway 서버 + 얇은 Control UI 클라이언트**.

### 1.1 표면/UX — 정정: 조용한 UI 기준이 아니다
- Lit 3 웹컴포넌트 SPA(`ui/src/app/app-host.ts` `<openclaw-app-shell>` = 사이드바+topbar+
  dockable terminal/browser panel). **그러나 동시에 대시보드**다: `ui/src/pages/`에 ~40개 라우트
  (`connection·plugins·approvals·activity·logs·usage·nodes·custodian`) + 임베디드 터미널·브라우저 패널.
  **고기능이 숨겨진 게 아니라 노출된 개발자 콘솔이다.**
- **흡수할 조용한 DNA는 딱 하나**: 접힌 분류형 도구 카드. `ui/src/lib/chat/tool-call-view.ts`의
  `ToolCallKind = command|read|edit|write|search|fetch|generic` + 인라인 diff, 사용자 선호 게이트
  (`chatShowToolCalls`, `types.openclaw.ts`). → T5가 이미 구현한 "작업 기록" 접힘과 동일.
- **반면교사**: 40-라우트 콘솔 셸은 T5가 되지 말아야 할 대시보드. 조용한 웹챗 기준은 OpenClaw UI가
  아니라 T3 화면·ChatGPT·Claude에서 온다(UI/UX Reference Seal과 일치).

### 1.2 로컬 제어
- 코어 도구(`src/agents/agent-tools.ts` `createOpenClawCodingTools`): `bash·exec·process·read·write·
  edit·apply_patch·grep·browser·web_search·web_fetch·task`. 셸은 host target 분리
  (`bash-tools.exec-host-node.ts` 로컬 vs `exec-host-gateway.ts` 원격). 브라우저 1급 + sandbox bridge.
- **정직한 한계**: 코어에 네이티브 앱 자동화(AppleScript/osascript) 없음 — 앱 제어는 plugin/MCP 위임.
  즉 "로컬 OS 제어"의 실체는 셸·파일·브라우저이지 네이티브 앱 지배가 아니다.

### 1.3 연결/도구 모델 — 다상태(계층), 불리언 아님
- **가용성**(`src/tools/types.ts`): `ToolAvailabilitySignal = always|auth(providerId)|config(path,check)|
  env|plugin-enabled|context`, `allOf`/`anyOf` 합성. *존재 / 인증됨 / 플러그인-활성*을 분리.
- **실행 신뢰**(`src/infra/exec-authorization-plan.ts`): `ExecAuthorizationTrustMode =
  executable|exact-command|prompt-only`. 실행가능-vs-조건부-vs-차단의 3단.
- **전송 상태**(`ui/src/app/gateway-store.ts`): `{connected, reconnecting, lastError, lastErrorCode}` 별도.
- descriptor 3분리: `ToolDescriptor{owner: core|plugin|channel|mcp, executor, availability}`. 모델-가시
  집합은 정적이 아니라 `resolveEffectiveToolInventory`가 profile·provider·policy로 필터.

### 1.4 내부/사용자면 분리 — 명시적으로 있음
- `DiagnosticsConfig·LoggingConfig·AuditConfig` 별도 도메인. `ConfigValidationIssue{path, message,
  allowedValues}` — 경로-주소 구조화 진단(raw throw 아님). 브랜드된 config 단계
  `Source→ResolvedSource→Runtime`(런타임 기본값이 파일로 새지 않게).

### 1.5 복제 금지(identity/runtime/config)
`openclaw`/`openclaw.mjs`/npm `openclaw`, bundle `ai.openclaw.app`, `~/.openclaw`·`openclaw.json`·
`$OPENCLAW_HOME`·`OPENCLAW_*` env, 식별자 `OpenClawConfig`·`types.openclaw.ts`·`<openclaw-*>`·
`createOpenClawCodingTools`, `@openclaw/gateway-protocol`, ~40-도메인 config 트리(그 넓이 자체가 표면).

---

## 2. Hermes 원본소스 분석 결과 (직접 분석, file:path 근거)

Python. **OpenClaw의 후속.** 단일 gateway 프로세스로 멀티채널 + 원격 생존성 + 자동화 + 학습 루프.

### 2.1 멀티채널 — 단일 정규화 파이프라인
- 모든 채널 = `BasePlatformAdapter(ABC)`(`gateway/platforms/base.py`) `connect/disconnect/send`. 인바운드를
  단일 `MessageEvent` dataclass로 정규화("all adapters produce"). `platform_registry.create_adapter(...)`
  자기등록("if/elif 없이"). ~30 채널. 코어 턴 루프가 모든 채널을 같은 흐름으로 구동.

### 2.2 연결 상태 — 계층 분리 (정정: 단일 enum 아님)
- adapter: `connected` / `disconnected` / `fatal(retryable 플래그)`(`_set_fatal_error`).
- gateway 프로세스: `starting/running/draining/stopping/stopped/startup_failed` + `degraded/ok` readiness.
- **명시적 authenticating/blocked/waiting-approval *연결* enum은 없음** — blocked는 delivery 층
  (dead_targets), approval은 cron/suggestions에 있음. 즉 관심사별 계층 분리가 실제 설계.

### 2.3 버퍼/재시도/전달
- 내구 전달 원장(`gateway/delivery_ledger.py`): `pending→attempting→delivered/failed→abandoned` SQLite
  상태기계. 시작 시 `sweep_recoverable()`이 죽은-소유자 행 재전달 + **가시적 "recovered-reply 마커"**
  (정직한 at-least-once). dead-target 레지스트리(`forbidden/not_found` 단락, 성공 시 자가치유).
  진행 중 세션엔 follow-up busy queue.

### 2.4 Relevance Gate — 존재하나 config 기반(모델 아님)
- mention-gating: `require_mention`·`free_response_channels`·`allow_bots`(`gateway/config.py`,
  `gateway/run.py`). 비트리거 메시지는 턴이 아니라 `channel_context`로 backfill(`base.py`).
  **학습 분류기 없음.** → 값싼 결정적 필터가 모델 호출 전에 건다.

### 2.5 격리 — profile당 home
- `get_hermes_home()` → `<root>/profiles/<name>`(모델·도구·기억·DB·cron·dead-targets 전부 분리).
  `profile_routing.py`가 인바운드를 specificity 랭킹으로 profile에 라우팅. cron 원장 "per-profile by design".

### 2.6 자동화 — 후보→승인→예약→실행→원장→복구 (완전 확인)
- `cron/suggestions.py`(dedup_key 후보, "one tap") → accept가 **단일 job 엔진** `cron.jobs.create_job`
  호출("두 번째 엔진 없음"). `blueprint_catalog.py` 타입 슬롯("raw cron 안 침").
- `cron/scheduler.py tick()` 60s 파일락. `jobs.py` state `scheduled/paused`.
- `cron/executions.py` 불변 실행 원장 `completed/failed/unknown`("소유 프로세스 사망 증명 후에만 unknown").
- `cron/lifecycle_guard.py` self-restart 명령(`gateway restart`/`launchctl`) 거부.

### 2.7 절전/깨우기/재연결
- `scale_to_zero.py` `go_dormant()`(소켓 닫되 supervisor 보존) + `wakeUrl`. `wake.py`가 실세션 id로
  재개(`X-Hermes-Session-Id`). unclean 종료 시 **suspend-not-resume** + `.clean_shutdown` 마커.
  `drain_control.py` `draining`으로 새 턴 차단.

### 2.8 복제 금지(infra/identity/config)
`Hermes`/Nous 브랜드·installer art·`hermes://`, relay/connector 와이어 계약·NAS token self-provision·
Fly suspend 가정, `~/.hermes`·`profiles/<name>`·service id `ai.hermes.gateway`·DB 파일명, **85KB
cli-config + 24KB env**(scope 폭발이지 템플릿 아님).

---

## 3. T5에 흡수할 구조 (T5 기관으로 재구성)

| 원천 | DNA | T5 기관(봉인 계약)으로 |
| --- | --- | --- |
| OpenClaw | 접힌 분류형 도구 카드 | 이미 있음 → 계약화(작업 기록) |
| OpenClaw | `owner/executor/availability` 3분리 | T5 도구 디스크립터 |
| OpenClaw | 합성 availability 신호 | `SelfStateSnapshot.connectedTools` 세분화(§5) |
| OpenClaw | 3단 실행 신뢰 | AuthorityGrant tier와 접합 |
| OpenClaw | 경로-주소 구조화 진단 | ToolReceipt.diagnosticTrace 강화(사용자면/진단면) |
| Hermes | 단일 MessageEvent + adapter ABC + 레지스트리 | P6 Channel Inbox 원형(§6, 지금은 자리만) |
| Hermes | 내구 전달 원장(pending→…→abandoned) | ToolReceipt lifecycle 필드(§5) |
| Hermes | dead-target 자가치유 | Connection status 상태 언어 |
| Hermes | config 기반 relevance 필터 | **Relevance Gate 커널 계약(§9 개정)** |
| Hermes | 단일 job 엔진 자동화 체인 | FollowUpEvent→GrowthCandidate(§5·§6) |
| Hermes | profile당 home 격리 | P6 Project/Profile 격리(§6, 상태 언어만) |
| Hermes | suspend-not-resume + clean marker | 복구 상태 언어(§6) |

원칙: **둘 다 "한 enum에 몰지 말고 관심사별 계층 분리"를 독립적으로 가르친다.** T5도 연결 생존성
(SelfState) / 전달 수명주기(ToolReceipt·Ledger) / 승인(AuthorityGrant) / 절전(P6)으로 나눈다.

---

## 4. T5에서 금지할 복제/오염 경계

1. **이름·바이너리·bundle**: `openclaw`/`hermes`/Nous, `ai.openclaw.app`/`ai.hermes.gateway`, `hermes://`.
2. **경로·env·service**: `~/.openclaw`/`~/.hermes`/`profiles/<name>`, `OPENCLAW_*`, service id, DB 파일명.
3. **식별자·스키마**: `OpenClawConfig`·`types.openclaw.ts`·`<openclaw-*>`·`createOpenClawCodingTools`,
   40-도메인 config 트리, 85KB cli-config + 24KB env(scope 폭발).
4. **인프라**: gateway-protocol 와이어 계약, relay/connector, NAS token self-provision, Fly suspend 가정.
5. **UI**: OpenClaw 40-라우트 개발자 콘솔 셸(대시보드화 금지).
6. **한 줄**: **T5는 Warelay→…→OpenClaw→Hermes 사슬의 다음 껍질이 되지 않는다.** 흡수는 구조 DNA뿐.

---

## 5. P5 코드에 지금 반영할 최소 항목 (감사 통과 후)

상태 언어와 계약 빈자리만. 전이 기계는 P6. 죽은 상태를 작동하는 척 두지 않는다(도달하는 상태만 구현).

1. **SelfStateSnapshot 연결 세분화**: `connectedTools[].executable`(불리언) → 합성 availability를 담는
   `status`(예: `usable | needs_auth | needs_config | needs_connection | blocked`). **P5가 실제 도달하는
   값만 구현**(usable/needs_connection/blocked), 나머지는 정의-하되-미도달로 예약.
2. **Connection 생존성 분리**: 전송 상태(connected/reconnecting/fatal-retryable)를 도구 가용성과 분리.
   P5는 언어만.
3. **ToolReceipt lifecycle 직교 필드**: `approved/held/attempting/delivered/failed/abandoned`를 받되,
   **진실 투영(확인/미확인/추정)은 손대지 않는다.** 원장이 이벤트 소방호스가 되지 않게.
4. **FollowUpEvent 타입 후보**: `automation | retry | long_task` 후보로 확장 가능하게(계약 필드만).
5. **Relevance Gate(§9 계약)**: 외부·비요청 이벤트 admission을 IntentPacket 앞에 둔다. **직접 사용자
   채팅과 fast_chat엔 절대 걸지 않는다.** 값싼 결정적 필터(mention/allowlist/dedup), 비admit은
   channel_context backfill.
6. **Work Chat UI는 자연 웹챗 유지**(대시보드화 금지). 도구 카드 접힘 = OpenClaw 흡수 확인점.

---

## 6. P6로 넘길 항목

멀티채널 Connector(adapter ABC + 레지스트리), 원격 실행/절전/깨우기(scale-to-zero/wake), Project/
Profile/Instance 격리(profile home), 자동화 센터(scheduler/blueprint), 성장·학습 루프(스킬 자동생성·
사용자 모델링), 고급 Connection Center, cross-device/session sync. **P5.1은 이들의 상태 언어만 준비.**

## 7. UI/UX 반영 기준

- 흡수: 접힌 분류형 도구 카드(OpenClaw `ToolCallKind`) — 이미 구현, 계약화.
- 반면교사: OpenClaw 40-라우트 콘솔 = 대시보드화 금지(UI/UX Reference Seal §5 강화).
- 연결 상태 세분화는 **상태칩/근거 토글 안에서 조용히** 표현. 40개 상태 패널로 펼치지 않는다.
- Relevance Gate가 외부 이벤트를 거를 때도 사용자에겐 조용히(대화 점유 금지).

## 8. 감사 통과 기준 (Codex)

1. OpenClaw/Hermes를 복제하지 않고 T5 기관으로 재구성했는가(§4 경계 준수).
2. P5가 기능 폭발 없이 더 단단해졌는가(§5는 상태 언어·계약 빈자리뿐, 전이 기계 없음).
3. P6 확장 경로가 열렸는가(§6 상태 언어 준비).
4. UI가 개발자 대시보드로 퇴행하지 않았는가.
5. 사용자 입장에서 여전히 "채팅만 하는데 일이 되는" 경험인가(fast_chat 불건드림 확인).
6. Relevance Gate가 **외부 이벤트 전용·모델 호출 아님**을 계약이 강제하는가.

---

## 9. 제안하는 Kernel Contract 개정 (오너 승인: 커널 개정 · Codex 감사 전)

봉인된 Phase 2 Kernel Contract에 아래를 추가·수정 제안한다. **이 문서는 제안이며, Codex 감사 통과
전까지 봉인 Kernel Contract 파일을 수정하지 않는다.**

### 9.1 신규 계약 — Relevance Gate (InboundEventGate)

근거: Hermes mention-gating(§2.4). **외부·비요청 이벤트에만** 적용. 직접 사용자 채팅·fast_chat 면제.
모델 호출이 아니라 값싼 결정적 판정.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| source | 열거 | 필수 | user_chat / external_channel / automation_trigger / system | user_chat은 항상 admit(게이트 우회) |
| triggerSignal | 열거목록 | 선택 | mention / allowlisted / direct_message / dedup_new | 결정적 신호만. 모델 판단 아님 |
| disposition | 열거 | 필수 | respond / context_only / ignore / defer | 비respond는 턴을 열지 않는다 |
| admittedAsContext | 불리언 | 필수 | 비respond 시 맥락 backfill 여부 | context_only는 channel_context로 |
| reason | 문자열 | 필수 | 판정 근거(사용자면 요약) | 내부용어 금지 |

규칙: `source=user_chat`은 게이트를 우회한다(자연스러움 보존, 절대원칙 4). 게이트는 IntentPacket
**앞**에 위치하며, 통과분만 §2 말귀로 넘어간다. 모델을 부르지 않는다(§9 자연스러움 gate와 정합).

### 9.2 SelfStateSnapshot.connectedTools 세분화 (수정)

`executable: 불리언` → `status: 열거(usable|needs_auth|needs_config|needs_connection|blocked)` +
`executable`은 `status===usable`의 파생으로 유지(하위호환). P5는 도달값만 구현(§5-1).

### 9.3 ToolReceipt lifecycle 필드 (추가)

`lifecycle: 열거(none|approved|held|attempting|delivered|failed|abandoned)` 직교 추가. 진실 투영
(확인/미확인/추정)의 상위 규칙은 불변(§7 원장 규칙 유지).

### 9.4 FollowUpEvent.candidateKind (추가)

`candidateKind: 열거(none|automation|retry|long_task)` 추가. 자동화·재시도·장기작업 후보의 계약 자리.

---

*이 문서는 초안이다. Codex 감사 후 Phase 5.1 Reference Absorption Hardening 으로 봉인하고, §9 개정을
봉인 Kernel Contract에 반영한다. 그 전까지 개발·코드 감사는 멈춤 유지.*
