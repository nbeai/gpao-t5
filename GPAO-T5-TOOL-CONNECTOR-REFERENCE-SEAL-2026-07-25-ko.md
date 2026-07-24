# GPAO-T5 Tool & Connector Reference Seal

- Status: `Codex 감사 통과 · 봉인 (2026-07-25) · 경로 표기 보정 반영`
- Date: 2026-07-25
- Author: Claude Code (구현자) — OpenClaw·Hermes 도구/커넥터 구조 read-only 분석(심층 리드 2건)
- Auditor: Codex (감사 대기)
- Phase: P6 진입 선행 작업(오너 지시) — 제품 코드 미착수
- 근거: OpenClaw(`/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20`) + Hermes
  (`/Users/jyp/Developer/lab_un/hermes-agent`) 도구/커넥터 계약 직접 분석 / 봉인 Kernel Contract /
  Reference Inventory(Phase 0) / Phase 5.1 Reference Absorption Hardening
- 위상: Kernel Contract 아래. P6(도구·연결·자동화·멀티채널)가 커널에 얹힐 때 흡수할 **도구/커넥터
  계약·상태언어·금지선**을 미리 봉인한다. 제품 코드는 P6에서.

## 0. 목적 + 규율

- **목적**: P6 확장(멀티채널·자동화·원격·기억)이 커널에 들어오기 전에, OpenClaw/Hermes의 검증된
  도구·연결·권한/승인/실행/결과/실패 구조에서 **T5가 흡수할 계약과 상태 언어**를 정리하고, **복제하면
  안 되는 정체성/런타임/config 경계**를 못박는다. Phase 5.1(외부 이벤트·연결 상태·자동화)의 도구/커넥터판.
- **Reference-First(헌법 §3.1)**: 구조·계약·상태언어를 흡수하되 이름·config schema·런타임·IA를 정본으로
  삼거나 복제하지 않는다. 두 소스는 **강한 연속성을 가진 참조 계열**(별개 org)이다.
- **범위**: 계약·상태언어·금지선만. 실제 커넥터/백엔드 구현은 P6.

---

## 1. OpenClaw 도구/커넥터 계약 (직접 분석)

### 1.1 도구 디스크립터 — owner ≠ executor 분리
- `src/tools/types.ts` `ToolDescriptor{name,title,description,inputSchema,outputSchema,owner,executor,
  availability,annotations}`. **소유(정의)와 실행(디스패치)을 분리**: `ToolOwnerRef`/`ToolExecutorRef`가
  각각 `core|plugin|channel|mcp` 4계열. 의도적 seam.
- 가시성 = **신호 트리** `ToolAvailabilityExpression`(`always|auth|config|env|plugin-enabled|context`)를
  `allOf`/`anyOf`로 합성. 불리언 대신 "왜 못 쓰는지"를 표현(Phase 5.1 connectedTools.status와 정합).
- 모델-가시 집합은 `tool-policy.ts`의 allow/deny 정책으로 필터. owner-only 게이팅은
  `security/dangerous-tools.ts`(`GATEWAY_CONTROL_PLANE_TOOLS` 등).

### 1.2 커넥터 — plugin/channel 진입 계약
- `plugin-sdk/plugin-entry.ts` `definePluginEntry({id,configSchema?,register})`, channel은
  `channel-entry-contract.ts` `defineBundledChannelEntry`(lazy loaders + `setChannelRuntime`).
- `ChannelPlugin`(`channels/plugins/types.plugin.ts`)이 `config,setup,pairing,security,auth,
  approvalCapability,secrets,status,outbound` 조합. **auth(로그인)와 approval(행동 승인)을 명시 분리**.
- 준비 상태: `connected` 불리언 + `ChannelStatusAdapter`(credential 스냅샷·probe issue).

### 1.3 권한/승인 — 신뢰 등급 사다리(A0-A3 숫자 없음)
- `infra/exec-authorization-plan.ts` `ExecAuthorizationTrustMode = executable|exact-command|prompt-only`
  + 위험 집합(`PROMPT_ONLY_RISKS`: eval/source/alias/shell-wrapper…). 숫자 A0-A3 대신 이 사다리.
- 지속 허용: `AllowAlwaysPersistenceDecision = patterns|exact-command|one-shot` + 사유 enum.
- "승인 필요" 판정: `agent-tools.before-tool-call.ts`의 `requireApproval`. **타임아웃 시 fail-closed**
  ("approvals fail closed on timeout") — 애매하면 차단.

### 1.4 실행 — host target 분리 + 특권 브리지
- 로컬 node vs gateway: `bash-tools.exec-host-{node,gateway}.ts`. 특권 경계는 `infra/exec-host.ts`의
  로컬 JSONL 소켓(HMAC 보호). argv/셸 래퍼는 승인 전 `exec-approvals-analysis.ts`가 분해.
- `packages/tool-call-repair`: 모델이 뱉은 평문 tool call을 구조화 호출로 복구(1급 패키지).

### 1.5 결과/실패 — 실패 종류 enum + 진단 분리
- 결과: `tools/tool-results.ts` `AgentToolResult{content,details}`.
- **실패 종류**: `tool-result-error.ts` `ToolResultFailureKind = blocked|cancelled|failed|timed_out`.
  입력/인증 오류는 타입 클래스 `ToolInputError`(400)/`ToolAuthorizationError`(403).
- 진단 vs 사용자면 분리(`diagnostic-error-metadata.ts`), 결과 미들웨어 seam.

---

## 2. Hermes 도구/커넥터 계약 (직접 분석)

### 2.1 도구 등록 + toolset
- `tools/registry.py` `registry.register(name,toolset,schema,handler,check_fn,requires_env,is_async,
  override,…)` + AST 자동 발견. `check_fn`은 **TTL 캐시 + 일시실패 유예**(flaky 도구 제거 방지).
- **toolset 시스템**(`toolsets.py`): `includes`로 합성, `_HERMES_CORE_TOOLS` "narrow-waist" 공유 목록,
  **주입 방어용 제한 집합** `_HERMES_WEBHOOK_SAFE_TOOLS`(신뢰 못 할 웹훅엔 web_search·extract만).

### 2.2 커넥터 — provider vs platform 선언형
- 모델 provider: `providers/base.py` `ProviderProfile{name,api_mode,env_vars,auth_type,fallback_models}`.
  **auth_type = api_key|oauth_device_code|oauth_external|copilot|aws_sdk**(연결 자격 상태 언어). 선언형 —
  클라이언트 구성·자격 회전은 소유하지 않음.
- 채널: `gateway/platform_registry.py` `PlatformEntry{adapter_factory,check_fn,is_connected,
  validate_config,required_env,setup_fn}`. adapter는 `BasePlatformAdapter(ABC)`.

### 2.3 권한/승인 — 결과 어휘 + 주입 방어
- `tools/approval.py`(단일 진실): `DANGEROUS_PATTERNS` 매칭, 승인 결과 `once|session|always|deny`(+사유),
  보조 LLM `_smart_approve`. **주입 방어**: `_YOLO_MODE_FROZEN`(import 시 동결로 env 뒤집기 차단),
  `HERMES_INTERACTIVE`를 env 아닌 contextvar로(동시세션 우회 CVE 대응).
- DM 페어링(`gateway/pairing.py`): 8자 코드·1h TTL·rate-limit·5회 실패 lockout·chmod 0600.
- 쓰기 승인(`tools/write_approval.py`): 기억/스킬 쓰기를 `pending/`에 stage 후 승인.

### 2.4 실행 — 백엔드 + RPC + 위임
- 터미널 백엔드 `TERMINAL_ENV = local|docker|singularity|modal|daytona|ssh`
  (`tools/terminal_tool.py` `_CONTAINER_BACKENDS`). Modal은 직접자격/관리형 게이트웨이.
- 스크립트 RPC(`tools/code_execution_tool.py`): 자식이 `hermes_tools.py` 스텁으로 부모 도구를 소켓 RPC
  호출(토큰 인증). 위임(`tools/delegate_tool.py`): 격리 자식 에이전트, `DELEGATE_BLOCKED_TOOLS` 차단.

### 2.5 결과/실패 — 분류 + at-least-once
- 결과: `tools/tool_result_storage.py`가 초과 결과를 디스크로 spill(도구별 `max_result_size_chars`).
- **MCP 실패 분류**: `tools/mcp_tool.py` `_classify_mcp_failure` → `permanent`(401/403 auth, ENOENT —
  즉시 parking) vs `transient`(네트워크/타임아웃 — backoff 재시도).
- 전달 원장(`gateway/delivery_ledger.py`): `pending→attempting→delivered|failed→abandoned`
  (MAX_ATTEMPTS=3), 재전달에 가시적 `RECOVERED_MARKER`(정직한 at-least-once). API 오류는
  `run_agent.py` `classify_api_error`로 진단/사용자면 분리.

---

## 3. T5에 흡수할 계약 + 상태 언어

두 소스가 **독립적으로 같은 원리**를 가르친 것을 T5 계약으로 내린다(복제 아님):

| 흡수 | 근거(양쪽) | T5 계약(봉인/제안) |
| --- | --- | --- |
| **도구 디스크립터: 소유≠실행 + 가용성 신호** | OC ToolDescriptor owner/executor/availability, Hermes registry.register+check_fn | **T5 ToolDescriptor 신규 제안**: `{id,label,owner(core/plugin/channel/mcp),executor,availability(신호 합성),needsApproval}`. connectedTools.status(§6)와 접합 |
| **커넥터 선언형 프로필 + auth 상태 언어** | OC ChannelPlugin(auth≠approval), Hermes ProviderProfile.auth_type | **ConnectorProfile 제안**: `{id,label,authState: api_key\|oauth\|none, connected, readiness}`. **auth(로그인)와 approval(행동)을 분리** |
| **신뢰 등급 + fail-closed 승인** | OC trust-mode ladder + fail-closed, Hermes once/session/always/deny | AuthorityGrant(A0-A3, 봉인)에 **grantScope 어휘**(once/session/persist) + **타임아웃 fail-closed** 규칙 흡수 |
| **주입 방어 도구 경계** | Hermes webhook-safe set + frozen-YOLO, OC owner-only tools | **외부 출처(InboundEventGate §1.5) 이벤트엔 제한 도구집합만** 노출(주입 방어) |
| **실패 종류 enum + 진단 분리** | OC blocked/cancelled/failed/timed_out, Hermes permanent/transient | ToolReceipt.failureState(none/failed/blocked/timeout, 봉인)에 **cancelled 추가 + permanent/transient 재시도 분류** 제안. userSafe/diagnostic 분리는 이미 봉인 |
| **at-least-once + 실행 수명주기** | Hermes delivery_ledger + RECOVERED_MARKER | ToolReceipt.lifecycle(attempting/delivered/failed/abandoned, 봉인)과 정확히 일치 — **재전달 시 가시적 marker** 규칙 흡수 |
| **결과 spill + 크기 한도** | Hermes tool_result_storage, OC AgentToolResult | ToolReceipt 결과에 **크기 한도 + 초과 시 diagnosticTrace로 분리** |
| **tool-call-repair** | OC tool-call-repair 패키지 | 모델 평문 tool call 복구를 T5 실행 계약의 안정성 옵션으로(P6) |

**상태 언어 종합**: 연결 생존성(§6) · 도구 가용성(availability 신호) · auth 상태(api_key/oauth/none) ·
승인 범위(once/session/persist) · 실패 종류(blocked/cancelled/failed/timed_out) · 재시도 분류
(permanent/transient) · 전달 수명주기(attempting/delivered/failed/abandoned). **한 enum에 몰지 않고
관심사별 계층**(Phase 5.1 원칙 유지).

---

## 4. 금지할 복제/오염 경계

1. **이름·네임스페이스**: `OpenClaw*`/`@openclaw/*`/`__openclaw_default_plugin_tools__`/`OPENCLAW_*`,
   `Hermes`/`HERMES_*`/`~/.hermes`/`hermes_constants`.
2. **런타임 기계**: OC HMAC 로컬-JSONL exec-host 소켓, bundled-loader 경계, gateway RPC scope
   (`operator.admin`); Hermes RPC 소켓 토큰 프로토콜, terminal 백엔드 관리형("Nous")배선.
3. **config/IA**: 두 소스의 구체 도구 로스터·이름, toolset 목록, `GATEWAY_CONTROL_PLANE_TOOLS`,
   provider/platform 인벤토리(`x_search`/`feishu`/`yuanbao`/Modal-Daytona) — 제품 IA이지 재사용 계약 아님.
4. **인프라**: NAS/relay/connector 와이어, Docker/Nix/systemd, OAuth 자격 관리자.
5. **한 줄**: T5는 이 참조 계열의 도구/커넥터 **정체성에 녹아들지 않는다.** 계약·상태언어만 흡수.

## 5. P6로 넘길 것 / 지금은 계약만

- P6: 실제 Connector/Channel adapter, 터미널/원격 백엔드, RPC·위임, tool-call-repair, MCP 연결,
  자동화 실행. **P5.1·이 Seal은 상태 언어와 계약 자리만** 연다.
- 지금 제품 코드 미착수. §3의 신규 계약(ToolDescriptor·ConnectorProfile)과 봉인 계약 개정
  (failureState +cancelled, grantScope 어휘)은 **P6 진입 시 Codex 감사와 함께** 반영.

## 6. 감사 기준 (Codex)

1. OpenClaw/Hermes를 복제하지 않고 계약·상태언어로 재구성했는가(§4 경계 준수).
2. 흡수 계약이 봉인 Kernel Contract(Phase 5.1 포함)와 정합하는가(계층 분리 유지).
3. 주입 방어(외부 출처 제한 도구집합)·fail-closed 승인이 T5 안전 원칙과 맞는가.
4. P6 확장 경로가 열렸고, 기능 폭발 없이 계약 자리만 열었는가.
5. 근거가 실제 소스 file:path로 확인되는가(발명 없음).

---

*Codex 감사 통과. Tool & Connector Reference Seal 로 봉인. §3 신규 계약·봉인 개정은 P6 진입 시 Codex
감사와 함께 반영한다.*

**P6 진입 전 선행 계약(오너 지시)**: 승인의 **지속/만료/재승인 경계**를 별도 계약으로 정리한다. 현재
Work Chat의 승인 대기는 서버 메모리(livePending)에만 있어 재시작 후 이어실행이 불가할 수 있다(living
슬라이스 조건부 메모와 동일 지점). AuthorityGrant에 승인 수명(grantScope 기간·만료·재승인 요구)을
계약화한 뒤 P6 권한/원장에 들어간다.
