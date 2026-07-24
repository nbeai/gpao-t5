# GPAO-T5 Kernel Contract

- Status: `Codex 감사 통과 · Phase 2 봉인` · **Phase 5.1(2026-07-24) · Approval Lifecycle · P6-2 · P6-3 · P6-3b · P6-4 개정(2026-07-25)**
- Date: 2026-07-24
- Author: Claude Code (구현자)
- Auditor: Codex (계약 정합성·경계·Phase 3 연결성 감사 완료 / Phase 5.1 개정 감사)
- Phase: `GPAO-T5-FINAL-DEVELOPMENT-PLAN` Phase 2 Kernel Contract (+ Phase 5.1 Reference Absorption Hardening)
- Phase 5.1 개정 반영(근거: `GPAO-T5-PHASE-5-1-REFERENCE-ABSORPTION-HARDENING`, 감사 보정 4건 포함):
  ① §1.5 InboundEventGate 신규 ② §6 connectedTools `status` 세분화 ③ §7 ToolReceipt `lifecycle`
  (실행/전달 전용, 승인은 AuthorityGrant) ④ §8.1 FollowUpEvent `candidateKind`
- Approval Lifecycle 개정 반영(근거: `GPAO-T5-APPROVAL-LIFECYCLE-CONTRACT`, 깊은 감사 통과):
  §3.2 AuthorityGrant `grantScope{kind:once/session/persist, expiresAt}` 정형화 + 만료→재승인·fail-closed
  규칙. once만 P5 도달, session·persist는 P6.
- P6-2 개정 반영(근거: `GPAO-T5-TOOL-CONNECTOR-REFERENCE-SEAL`·`P6-2-TOOL-DESCRIPTOR`·
  `P6-2-WEB-TOOL-DESCRIPTOR`, 깊은 감사 통과):
  §6.5 ToolDescriptor 신규(소유≠실행·availability·auth≠approval, needsApproval/toolKind→ActionPlan 전달) +
  §6.6 WebToolDescriptor(inputSchema·sourcePolicy·sessionMode, 출처 없는 성공 런타임 강제 금지, fetch 상태 분리) +
  §6.7 ConnectorProfile & 채널 인바운드(auth≠approval, 단일 정규화 이벤트, 게이트 순서·미등록/미연결/gated 미기록) +
  §7 failureState `cancelled`·재시도 분류 + §7 `sources` 출처 근거.
- P6-3 개정 반영(근거: `P6-3-AUTOMATION`, 깊은 감사 통과):
  §8.3 Automation 신규 — ScheduledJob(state·grantScope·external=descriptor needsApproval 파생) +
  AutomationLedger(세션 TruthLedger와 분리된 자동화 실행 원장, §7 ToolReceipt 계약 재사용) +
  tick 경계(몰래 실행 0·후보≠실행·외부 만료 필수).
- P6-3b 개정 반영(근거: `P6-3-AUTOMATION` 후속, 깊은 감사 통과): §8.3 tick 경계 **구현됨** —
  `admitTickTrigger`(trusted_runtime_event 전용) + HTTP tick 런타임 토큰 요구(없으면 403·실행0, UI 버튼 없음) +
  in-process `AutomationScheduler`(setInterval+unref, cron/daemon 아님, intervalMs job 재예약·원장 누적).
- P6-4 개정 반영(근거: `P6-4-AUTOMATION-RELIABILITY`, 깊은 감사 통과): §8.3 신뢰성 가드 —
  ScheduledJob에 failureCount/maxAttempts/backoffBaseMs/backoffCapMs, `resolveAfterRun` 상태 전이(transient
  백오프·maxAttempts 초과 시 failed / permanent 즉시 포기 / 성공 리셋), `runTrustedTick` in-flight 중첩·중복
  방지, 백오프 대기 중에도 만료 우선.
- 근거: 계획서 §5·§6.2 / Product Constitution(봉인) / 두 감사 문서
- 위상: 이 문서는 헌법(Product Constitution) 아래에서 T5 커널이 주고받는 데이터 계약을 정한다.
  세부 구현·kernel spec 위, 헌법 아래(절대원칙 §12 순서).

## 0. 작성 규율 + 계약의 성격

- 제품 코드는 작성하지 않는다(계획서: 착수 Phase 5). 이 문서는 "데이터 계약"이지 구현이 아니다.
- 정본 문서·README·AGENTS를 수정하지 않는다. 수정 의견은 §12 제안으로만.
- 계약은 필드 이름·의미·경계를 정한다. 직렬화 포맷·언어·저장소는 Phase 5에서 정한다.
- 헌법 §3 비타협 7규칙과 §5 자기파악 헌법이 모든 계약의 상위 제약이다.
- 감사 지시대로 BEAI5 Integration Contract는 이 문서 내부 장(§10)으로 둔다. 너무 커지면 독립 분리.

계약 표기 규약: 각 계약은 `필드 | 타입(개념) | 필수 | 의미 | 경계·규칙`으로 정의한다. 타입은
구현 타입이 아니라 개념 타입(문자열/열거/참조/목록/불리언/시각)이다.

---

## 1. native-runtime baseline seal 확인 (Phase 2 첫 작업)

감사 §3-2가 Phase 2 첫 작업으로 지시한 확인. 헌법 §8-1의 "L0 State Kernel 이전 기준"이 이 결과에
달려 있다. read-only 조사로 수행했다(절대원칙 5: 조사는 먼저 진행).

근거: `gpao-t-native-runtime-research/engineering/`의 Stage Board(정본 상태판, 2026-07-15),
Takeover State Seal, T5 AI OS 연구계획서.

### 1.1 확인 결과: production baseline seal = 미달성 (로컬 자격은 봉인)

정직한 판정이다. 단일한 "production baseline seal = 달성"은 **없다.**

**봉인/닫힘(로컬 계약 기준):**
- WP0 Truth Seal, WP1 Identity & State Kernel, WP2~WP8 로컬 계약 전부 `closed`
- R2~R7 / F2~F7 로컬 런타임-lab 흐름 `closed` (모델연결·이벤트·도구·기억·UX·복구 각 단계)
- Takeover State Seal = `takeover_state_sealed` (단, 인수인계 범위 한정)

**열림/블록:**
- R1 secret boundary = `partial_core_contract`, macOS 백엔드 `blocked_missing_xcode`
- 최고 라벨 = `qualified_local_macos_real_telegram_public_distribution_open`
  → **로컬 자격만, public distribution은 열림.** Apple notarization / Gatekeeper / Windows 미완
- 릴리스 아티팩트 버전 = `0.2.2-foundation-...` (**foundation 라벨** = 기반이지 production 아님)

**문서 스스로의 규정:**
- Stage Board: `closed`는 "역사적 로컬 계약 통과"이지 release-candidate 통합 검증이 아니다.
- Takeover Seal: "제품 완성·모델 준비·UI·설치·라이브 사용자 경로 준비를 증명하지 않는다."
- T5 연구계획서: native-runtime은 **reference absorption 후보**이지 T5 정본 runtime이 아니다.

### 1.2 이 결과의 헌법적 함의 (§8-1 확정)

헌법 §8-1이 예방적으로 건 조건이 조사로 확증됐다. 따라서 Phase 2 결정은:

- native-runtime은 **정본으로 삼지 않는다.** production seal이 없고 문서 스스로 foundation·미완을
  선언했다. 정본화하면 봉인 안 된 연구물을 T5 커널 기준으로 승격하는 것이라 절대원칙 위반이다.
- 그러나 **구조·원리는 강한 참고 대상이다.** WP1 Identity & State Kernel, 단일 writer 이벤트 저널,
  워커 격리, capability permit는 T5 L0 State Kernel 설계의 유효한 원형이다(인벤토리 NATIVE-* 행).
- **이전 기준 = 아래 계약(§2~§11)은 T5가 소유하고 새로 정의한다.** native-runtime과 T3의 검증된
  흐름은 이 계약을 채우는 참고 근거일 뿐, 어느 쪽도 스키마 정본이 아니다.

즉 헌법 §8-1의 "native 구조 우선 참고 + T3 흐름 병합"은 유효하되, **둘 다 정본이 아니라 참고**라는
경계가 이 조사로 확정됐다.

---

## 1.5 InboundEventGate (Relevance Gate) — Phase 5.1 개정

근거: Hermes mention-gating 흡수(P5.1 §2.4·§9.1). 이 게이트는 **IntentPacket(§2) 앞**에 위치해,
외부·비요청 이벤트가 턴을 열 가치가 있는지 **모델 호출 없이 값싼 결정적 판정**으로 거른다. 모든 입력을
모델에 태우지 않는다. 자연스러움 gate(§9)·안티 대시보드와 정합.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| source | 열거 | 필수 | user_chat / external_channel / automation_trigger / trusted_runtime_event | **게이트 대상은 external_channel·automation_trigger 뿐.** user_chat·trusted_runtime_event은 우회 |
| triggerSignal | 열거목록 | 선택 | mention / allowlisted / direct_message / dedup_new | 결정적 신호만. 모델 판단 아님 |
| disposition | 열거 | 필수 | respond / context_only / ignore / defer | 비respond는 턴을 열지 않는다 |
| admittedAsContext | 불리언 | 필수 | 비respond 시 맥락 backfill 여부 | context_only는 channel_context로 |
| userSafeReason | 문자열 | 선택 | 사용자에게 보여도 되는 판정 요약 | **respond일 때만 채운다.** ignore/context_only는 비운다 |
| diagnosticReason | 객체 | 선택 | 내부 판정 근거·신호값 | 사용자면 노출 금지. 감사·디버그용 |

규칙:
- **게이트 대상은 외부·비요청 이벤트(external_channel·automation_trigger) 뿐이다.** `user_chat`은 항상
  admit(우회, 자연스러움 보존, 절대원칙 4). fast_chat 경로엔 절대 걸지 않는다.
- **`trusted_runtime_event`(시스템 복구·보안·권한)는 relevance 게이트에 걸리지 않는다.** 게이트로 묻히면
  위험하므로 우회해 Recovery·Authority(§3·§4) 규칙으로 직행한다.
- 통과분만 §2 말귀로 넘어간다. **모델을 부르지 않는다.**
- **조용히 무시(ignore)하는 이벤트는 사용자 설명문을 만들지 않는다**(userSafeReason 비움). 알림 많은
  운영 콘솔로 변질되지 않게(안티 대시보드).

---

## 2. IntentPacket (말귀 / Input Kernel 계약)

근거: 계획서 §5.1. 입력 하나는 곧바로 모델에 던지는 문자열이 아니라 아래 구조로 해석된다.
헌법 §1(목적 우선)·§2-3(방법 나열형 금지)의 커널 계약.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| currentRequest | 문자열 | 필수 | 이번 요청의 사용자 원문(보존) | 원문을 왜곡·요약하지 않는다. 민감정보는 §4 금고 토큰으로 |
| relatedContext | 참조목록 | 선택 | 관계 있는 과거 맥락 | raw 기억이 아니라 §5 ContextAdmissionPacket을 거친 것만 |
| desiredOutcome | 문자열 | 필수 | 사용자가 원하는 결과 | 방법이 아니라 목적. 불명확하면 needsClarification=true |
| unwantedRisk | 문자열 | 선택 | 사용자가 원하지 않는 위험 | 외부전송·삭제·비용·공개 등 사용자가 경계한 것 |
| neededTools | 열거목록 | 선택 | 필요한 도구(후보) | 실행 가능 판정은 §6 SelfStateSnapshot이 함. 여기선 후보만 |
| authorityBoundary | 열거 | 필수 | 예상 권한 경계 | A0-A3(§3). 판정은 §4 ActionPlan이 확정 |
| answerMode | 열거 | 필수 | 답변 방식 | fast_chat / complex_work (§8 경로 분리로 이어짐) |
| needsClarification | 불리언 | 필수 | 확인 질문 필요 여부 | true면 실행 전 멈추고 묻는다(절대원칙 5) |

규칙: 내부 용어(모델명·raw path·stack trace·provider 오류)가 사용자 답변에 새면 실패(헌법 §2-5).
단순 대화는 IntentPacket을 가볍게 통과시켜 §8 fast path로, 복잡 작업은 §4 ActionPlan으로 전환한다.

---

## 3. AuthorityGrant (권한 계약)

근거: 계획서 §5.2 A0-A3. 헌법 §3(7규칙)·§4.4의 커널 계약. UI는 권한을 부여하지 않고 결정을
보여 주고 승인을 받는다(헌법 §3-1).

### 3.1 등급 정의 (계획서 §5.2 그대로)

| 등급 | 의미 | 예시 |
| --- | --- | --- |
| A0 | 즉시 자동 | 읽기, 요약, 검색, 로컬 진단, 초안 생성 |
| A1 | 조용한 확인 또는 되돌릴 수 있는 자동 | 제목 정리, 보관 제안, 로컬 초안 정리 |
| A2 | 짧은 승인 필요 | 외부 전송, SaaS 쓰기, 자동화 활성화, 장기 기억 승격 |
| A3 | 강한 승인 또는 차단 | 삭제, 결제, 공개 게시, 권한 상승, 민감정보 내보내기 |

### 3.2 AuthorityGrant 계약

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| tier | 열거 | 필수 | A0/A1/A2/A3 | 판정은 행동의 비가역성·외부성으로. 애매하면 높은 등급으로 |
| action | 참조 | 필수 | 대상 행동 | ActionPlan의 한 항목을 가리킴 |
| approvalRequired | 불리언 | 필수 | 승인 필요 여부 | A2·A3는 true. "사용자가 원했다"만으로 우회 불가(헌법 §3-6) |
| approvalPreview | 객체 | A2·A3 필수 | 영향·범위·기간·취소 | 승인 전 사용자에게 보여줄 요약 |
| granted | 불리언 | 필수 | 승인 여부 | 실행 직전 게이트. 미승인이면 실행 금지 |
| grantScope | 객체 | 선택 | 승인의 범위·수명(Approval Lifecycle 개정) | `{kind: once\|session\|persist, expiresAt?}`. once=이번 한 번(P5 도달) / session·persist=P6. expiresAt 이후는 만료 |
| revocable | 불리언 | 필수 | 되돌리기 가능 여부 | 되돌리기 불가면 approvalPreview에 명시 |

규칙: 외부 전송·삭제·결제·공개·권한 상승·장기기억 승격은 authority gate를 반드시 통과(헌법 §3-6).

승인 수명 규칙(Approval Lifecycle Contract, 2026-07-25): 승인 대기는 `grantScope.expiresAt`까지만 유효하다.
**만료된 승인은 이어실행하지 않고 재승인을 요청한다**(무단 지연 실행 금지). 만료·해소된 승인은 화면에서
되살아나지 않는다(죽은 버튼 금지). 승인은 보관된 봉인 계획을 이어받는다(발화 재해석 아님). 애매하면
실행하지 않는다(fail-closed). session·persist 범위와 grant registry·revocation은 P6.

---

## 4. ActionPlan (ActionPlan / Authority Kernel 계약)

근거: 계획서 §5.2. IntentPacket의 출구. 헌법 §1(목적달성)·§3의 커널 계약.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| understoodTask | 문자열 | 필수 | 이해한 일 | IntentPacket.desiredOutcome 기준. 오해 시 needsClarification |
| contextToUse | 참조목록 | 선택 | 사용할 맥락 | §5 admitted context만. 라우터는 기억을 쓰지 않는다(헌법 §3-2) |
| toolsToUse | 참조목록 | 선택 | 사용할 도구 | §6 SelfStateSnapshot이 실행 가능 판정한 것만 |
| autoAllowed | 참조목록 | 필수 | 자동으로 해도 되는 일 | A0·A1 |
| needsApproval | 참조목록 | 필수 | 확인받아야 하는 일 | A2·A3. 각각 AuthorityGrant를 가짐 |
| forbidden | 참조목록 | 필수 | 절대 하면 안 되는 일 | 사용자 금지·법적·윤리 경계 |
| successCriteria | 문자열 | 필수 | 성공 기준 | 목적 달성 판정 기준. 완료 언어의 근거 |
| recoveryCriteria | 문자열 | 필수 | 복구 기준 | 실패 시 무엇이 안전하고 다음 안전 행동은 무엇인가 |

규칙: ActionPlan은 실행 계획이지 실행이 아니다. 실행 결과는 §7 ToolReceipt가 기록한다.

---

## 5. ContextAdmissionPacket (Context Mesh / T-cell 계약)

근거: 계획서 §5.3. 헌법 §4.3의 커널 계약. "많이 기억함"이 아니라 "이번 행동에 영향을 줘도 되는
것만 좁게 입장".

승격 흐름(계획서 §5.3): raw record → candidate → admission → replay → approval →
promoted operating principle → future influence with rollback.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| candidateId | 참조 | 필수 | 후보 식별 | raw record가 아니라 후보 단계 |
| kind | 열거 | 필수 | preference / operating_principle | 단순 선호와 OS 운영 원리는 같은 저장소에 섞이지 않는다 |
| statement | 문자열 | 필수 | 입장시킬 맥락 내용 | 민감정보 원문 금지(§금고 토큰) |
| admitted | 불리언 | 필수 | 이번 턴 입장 여부 | "관련 있음"이 아니라 "이번 행동에 필요함" |
| replayPassed | 불리언 | operating_principle 필수 | replay 검증 통과 여부 | 운영 원리는 replay 없이 승격 불가 |
| userConfirmed | 불리언 | operating_principle 필수 | 사용자 승인 여부 | 기억 승격은 사용자 확인을 가짐(헌법 §4.3) |
| influenceScope | 객체 | 선택 | 영향 범위 | 어디까지 영향을 주는가 |
| rollbackable | 불리언 | 필수 | 되돌리기 가능 여부 | 승격된 원리는 되돌리기를 가짐 |

규칙: 라우터는 이 패킷을 소비하지 않는다. 기억 승격은 별도 admission/replay/approval 흐름(헌법 §3-2).
T-cell(operating_principle)과 preference를 kind로 분리해 섞이지 않게 한다(계획서 §5.3 명시).

---

## 6. SelfStateSnapshot (Operational Selfhood 계약)

근거: 계획서 §5·§6.2 / 헌법 §5. T5가 매 턴 자기 가용 범위를 아는 존재 조건의 구조화.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| currentModel | 객체 | 필수 | 지금 쓰는 모델 | id·강점·한계. 죽은 자격증명이면 대체 프로필로 전환(헌법 §4.1) |
| modelAuthState | 열거 | 필수 | 자격증명 상태 | usable / billing_blocked / rate_limited / auth_failed. billing과 rate_limit 구분 |
| connectedTools | 목록 | 필수 | 연결된 도구·앱 | 각 항목이 `status` 를 가짐(Phase 5.1 개정): usable / needs_auth / needs_config / needs_connection / blocked. `executable`은 `status===usable`의 파생(하위호환). 목록에 있다고 실행 가능 아님(헌법 §3-3). P5는 도달값만 구현 |
| grantedAuthorities | 목록 | 필수 | 승인된 권한 | 무엇이 승인, 무엇이 승인 필요 |
| riskyActions | 목록 | 선택 | 위험 실행 후보 | 외부전송·삭제·결제·공개 |
| limits | 목록 | 필수 | 현재 한계 | 못 하는 것과 그 이유 |
| nextSafeAction | 문자열 | 선택 | 다음 안전 행동 | 막다른 답 대신 제시할 것 |

규칙: SelfStateSnapshot은 사용자 기본 화면을 점유하지 않는다(헌법 §5). 추정하지 않고 실제 receipt·
연결 상태로 채운다(절대원칙 2). 이 스냅샷 없이 실행하는 턴은 자기파악 미달이다.

---

## 6.5 ToolDescriptor (도구 계약 — P6-2 개정)

근거: Tool&Connector Reference Seal §1.1·§3 흡수. 도구를 계약으로 세운다. connectedTools(§6)는 각
도구 descriptor의 availability를 환경 사실에 대입해 채운다.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| id | 문자열 | 필수 | 내부 식별자 | 사용자면 비노출(라벨만) |
| label | 문자열 | 필수 | 사용자 표시명 | |
| owner | 열거 | 필수 | 정의 주체 | core/plugin/channel/mcp. **소유≠실행** |
| executor | 참조 | 필수 | 실행 주체 | owner와 분리(디스패치) |
| availability | 목록 | 필수 | 실행 가능 신호(allOf) | auth/config/env/connected. → status(§6) 판정 |
| toolKind | 문자열 | 필수 | 권한 종류 | read/send/organize… ActionPlan 권한 판정 입력 |
| needsApproval | 불리언 | 필수 | 행동 승인 필요 | **auth≠approval**: 실행 가능해도 승인 필요일 수 있음 |

규칙: **"실행 가능"(availability→status)과 "실행해도 됨"(needsApproval)은 다른 축이다**(헌법 §3-3).
descriptor의 toolKind·needsApproval은 SelfState.connectedTools에 보존되어 §4 ActionPlan 권한 판정까지
전달된다 — 하드코딩 목록에 없는 새 도구도 needsApproval이면 승인 게이트를 우회하지 못한다(감사 보정).

### 6.6 WebToolDescriptor (ToolDescriptor 확장 — P6-2 Slice-2)

근거: Tool&Connector Seal §3. 웹/브라우징/스크래핑 도구의 계약. ToolDescriptor + 아래 필드.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| inputSchema | 객체 | 필수 | 입력 계약 | url/searchQuery(하나 필수)·depth·allowedDomains·maxPages. maxPages 상한(대량수집 금지), allowedDomains는 hostname 기준(우회 차단) |
| sourcePolicy | 객체 | 필수 | 스크래핑 정책 | readOnly·noMassCollect·noExternalSend·**sourceLedgerRequired** |
| sessionMode | 열거 | 필수 | 브라우저 세션 | anonymous(A0) / authenticated(auth availability, 자격 축) / user_approved(**needsApproval:true**, 승인 축) |

규칙(핵심 불변식): **웹 도구는 출처(SourceEvidence) 없이 "검색했다/봤다"고 말하지 못한다.**
`sourceLedgerRequired` 도구의 성공은 **ToolRunner가 런타임에서 강제**한다(handler 관례 아님) — 출처 없는
성공, 실패·차단(fetchState≠ok)에 내용·출처가 섞이면 계약 위반으로 failed 처리. fetch 상태
(login_wall/blocked/robots_disallow/bot_wall/timeout)는 성공과 분리한다. auth≠approval: user_approved
세션은 공개 읽기 A0와 달리 승인 경계를 가진다.

### 6.7 ConnectorProfile & 채널 인바운드 (멀티채널 — P6-2 Slice-3)

근거: Tool&Connector Seal §2·§3. 채널/provider를 선언형 프로필로. 채널이 달라도 같은 OS 흐름을 탄다.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| id | 문자열 | 필수 | 커넥터 식별자 | |
| label | 문자열 | 필수 | 사용자 표시명 | |
| kind | 열거 | 필수 | channel / provider | |
| authState | 열거 | 필수 | 자격(로그인) 축 | none(**인증 불요=공개**) / api_key / oauth / session. "미설정"과 구분은 후속 requiresAuth |
| connected | 불리언 | 필수 | 연결 여부 | |

- `connectorReadiness(profile)` = 연결 생존성 축: **disconnected / needs_auth / ok**(authState와 별개 축).
- `sendNeedsApproval()` = **항상 true**: 연결·인증돼도 외부 전송은 A2 승인(**auth≠approval**, 헌법 §3-6).
- `normalizeInboundEvent(msg)`: 채널 메시지 → 단일 InboundEvent(source=external_channel, triggerSignals
  는 mention/allowlisted/direct_message 결정적 신호). 채널별 로직을 커널에 두지 않는다(Hermes 흡수).

**채널 인바운드 게이트 순서(정본)**: ① sessionId ② channel 필드 ③ **registry 확인**(미등록→blocked)
④ **connectorReadiness===ok**(아니면 blocked) ⑤ normalizeInboundEvent ⑥ InboundEventGate(§1.5,
mention/allowlist/DM) ⑦ **respond일 때만 turn** ⑧ **gated/blocked는 transcript 미기록**(reply/approval/
clarify만 기록). 등록·연결된 채널만 커널로 태우고, 트리거 없는 외부 메시지는 자동 응답하지 않는다.

---

## 7. ToolReceipt (Tool Execution Truth Ledger 계약)

근거: 계획서 §5.4 / 헌법 §3-4. 도구를 썼다고 착각하거나 못 썼는데 쓴 척하지 않는다.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| intended | 문자열 | 필수 | 하려던 일 | ActionPlan 항목 기준 |
| actualCall | 객체 | 필수 | 실제로 호출한 것 | 도구·인자. 호출 안 했으면 그렇게 기록 |
| result | 객체 | 선택 | 받은 결과 | 성공 시 |
| failureState | 열거 | 필수 | 실패/차단/타임아웃/취소 여부 | none / failed / blocked / timeout / cancelled(P6-2). blocked·cancelled=permanent, failed·timeout=transient(재시도 분류) |
| lifecycle | 열거 | 선택 | 실행·전달 수명주기(Phase 5.1 개정) | none / attempting / delivered / failed / abandoned. **실행·전달만.** 승인 상태(held/approved)는 AuthorityGrant(approvalRequired+granted)에 있고 원장에 섞지 않는다 |
| sources | 목록 | 선택 | 출처 근거(P6-2 Slice-2) | `{sourceUrl,fetchedAt,title,excerptHash,confidence}`. 웹 등 sourceLedgerRequired 도구는 출처 없이 "확인"을 주장하지 못한다(런타임 강제). Truth Ledger 근거로 연결 |
| userSafeSummary | 문자열 | 필수 | 사용자에게 말해도 되는 요약 | 내부 용어 제외. 사용자면/진단면 분리(감사 §3-3) |
| diagnosticTrace | 객체 | 선택 | 내부 진단·오류·스택·provider 상태 | 사용자 답변에 그대로 노출 금지. 디버그·감사용 |
| nextSafeAction | 문자열 | 선택 | 다음 안전 행동 | 실패 시 |

규칙: 사용자 답변은 이 원장 기준으로 "확인한 것 / 확인 못한 것 / 추정"을 분리한다(계획서 §5.4).
검색·수집 결과는 이 원장과 출처 요약을 거쳐야 답변 근거가 된다(헌법 §3-4). userSafeSummary와
diagnosticTrace를 분리한다 — T3에서 정화가 진단면까지 덮은 사고를 반복하지 않는다(감사 §3-2·3-3).

---

## 8. FollowUpEvent + 경로 분리 (Follow-up Queue + fast/complex path)

근거: 계획서 §5.5. 긴 작업 중 들어온 새 지시를 놓치면 OS가 아니다.

### 8.1 FollowUpEvent 계약

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| runningTask | 참조 | 필수 | 현재 실행 중인 일 | |
| incomingInput | 문자열 | 필수 | 새로 들어온 말 | "현재 요청 우선" 원칙으로 처리 |
| conflict | 불리언 | 필수 | 충돌 여부 | 현재 목표와 새 지시의 충돌 |
| decision | 열거 | 필수 | 중단/병합/대기/우선순위 변경 | interrupt / merge / queue / reprioritize |
| candidateKind | 열거 | 선택 | 후보 유형(Phase 5.1 개정) | none / automation / retry / long_task. 자동화·재시도·장기작업 후보의 계약 자리 |
| userNotice | 문자열 | 필수 | 사용자에게 알릴 한 줄 | |

### 8.2 simple chat fast path / complex work path 분리

| 경로 | 조건 | 통과 계약 | 규칙 |
| --- | --- | --- | --- |
| fast chat | IntentPacket.answerMode = fast_chat, 도구·외부효과 없음 | IntentPacket → (가벼운 SelfState) → 답변 | 느린 기억·성장·replay가 막지 않는다(헌법 §3-5). 빠르고 자연스럽게 |
| complex work | 도구·권한·다단계 필요 | IntentPacket → ActionPlan → AuthorityGrant → 실행 → ToolReceipt → Follow-up | 계획·실행·검증·복구가 보인다(성공기준 8) |

규칙: 단순 대화를 complex path로 무겁게 태우면 자연스러움이 죽는다. 경로 판정은 IntentPacket에서
시작하되, 도중에 도구·외부효과가 필요해지면 complex로 승격한다.

### 8.3 Automation (ScheduledJob / AutomationLedger / tick 경계) — P6-3 개정

근거: 계획서 §5·§6.2, `P6-3-AUTOMATION`(깊은 감사 통과). §8.1 `candidateKind:'automation'`가 후보의
계약 자리였고, 여기서 실행 계약으로 잇는다. 핵심 불변식: **자동화는 몰래 실행하지 않는다. 후보는
실행이 아니다(승인 전 영향 0).** 흐름: `GrowthCandidate → 승인 → ScheduledJob → tick → ToolReceipt(AutomationLedger) → 취소/만료`.

**ScheduledJob 계약**

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| id | 문자열 | 필수 | job 식별자 | |
| action | `{tool, args?}` | 필수 | 실행할 도구·인자 | 계획의 첫 도구를 재사용. 실행 가능(SelfState) 게이트를 그대로 탄다 |
| state | 열거 | 필수 | scheduled/paused/cancelled/completed/expired/failed | scheduled+미만료+도달만 실행. 그 외 실행 0 |
| createdAt / nextRunAt | 수 | 필수 | 생성·다음 실행 시각 | `ctx.now` 주입(결정적) |
| intervalMs | 수 | 선택 | 있으면 반복, 없으면 1회 | 반복도 in-process tick — cron/daemon 아님 |
| grantScope | `{kind, expiresAt?}` | 필수 | 승인 범위·만료(§3.2 재사용) | 만료 후 실행 금지 → 재승인(Approval Lifecycle) |
| external | 불리언 | 필수 | 외부 전송 자동화 | **도구 descriptor `needsApproval`에서 파생**(사용자 입력 불신). true면 **만료 없는 승인 거부** → A2 경계 유지 |
| executions | `ToolReceipt[]` | 필수 | AutomationLedger | 아래 |
| failureCount | 수 | 필수 | 연속 실패 횟수(P6-4) | 성공 시 0으로 리셋 |
| maxAttempts | 수 | 필수 | transient 실패 재시도 상한(기본 5) | 초과 시 정직하게 `failed`(무한 재시도 금지) |
| backoffBaseMs / backoffCapMs | 수 | 필수 | 지수 백오프 기준·상한(기본 1s / 1h) | 재시도가 무한정 벌어지지 않게 |

**AutomationLedger** — 자동화 실행 진실 원장. 세션 `TruthLedger`/`ledgerEntries`와 **분리된** 별도 원장이다
(자동화는 세션 밖 백그라운드 실행이라 섞으면 세션 원장 의미가 흐려진다). 기록 계약은 §7 `ToolReceipt`를
그대로 쓴다 — 성공·실패·차단·만료·취소를 정직하게. 추가는 `appendAutomationLedger(job, receipt)`로만 한다.
`GET /automation`의 `jobs[].ledger`가 이 원장의 투영이고 `runs`/`lastResult`는 그 요약이다.

**tick 경계(구현됨, P6-3b)** — `tick`은 사용자 행동이 아니라 **런타임 이벤트**다. 일반 사용자가 누르는
버튼처럼 tick을 돌릴 수 없다.
- `admitTickTrigger(trigger)`: §1.5 InboundEventGate와 동일 계약으로 `trusted_runtime_event`만 admit한다
  (`automation_trigger`는 게이트 대상 외부 이벤트라 tick 트리거가 아니다 — 불허). `runTrustedTick`이 tick
  실행의 단일 경로이고, 이 게이트를 통과한 트리거만 실행한다.
- HTTP `POST /automation/tick`은 **런타임 트러스트 토큰**(`x-runtime-token`)을 요구한다. 토큰은 어떤 GET에도
  노출하지 않으므로 브라우저·사용자는 tick을 칠 수 없다 — 없으면 `403 not_trusted`, 실행 0. 이 라우트는
  런타임/운영·테스트 전용이고 UI에는 tick 버튼이 없다(승인 카드만).
- 반복 구동은 **in-process `AutomationScheduler`**(`setInterval`+`unref`, cron/daemon 아님 — 프로세스가 죽으면
  함께 죽는다)가 담당한다. 항상 `trusted_runtime_event`로 발화해 `runtimeTick`을 직접 호출(HTTP 우회, 구성상
  trusted). `intervalMs` job은 실행 후 `nextRunAt += intervalMs`, `scheduled` 유지 → 다음 발화에 재실행하고
  매 실행을 AutomationLedger에 누적한다.

**신뢰성 가드(구현됨, P6-4)** — 반복·실패·동시성 아래서 안전하게. 막는 사고: 두 번 실행 · 무한 재전송 ·
만료 잔존. 상태 전이는 순수 함수 `resolveAfterRun(job, failureState, now)`에 모은다.
- **실패 백오프**: transient 실패(`failed`/`timeout`, `classifyRetry`)는 `nextBackoffMs`(지수·`backoffCapMs` 포화)로
  재예약해 재시도하되, `failureCount >= maxAttempts`면 정직하게 `failed`로 접는다(무한 재시도 금지).
- **permanent 즉시 포기**: 차단·취소(`blocked`/`cancelled`)는 재시도로 안 풀린다 → 재예약 없이 즉시 `failed`
  (실패한 외부 전송의 무한 반복 차단).
- **성공 리셋**: 성공하면 `failureCount=0`. 반복 job은 `nextRunAt += intervalMs`, 1회 job은 `completed`.
- **tick 중첩/중복 방지**: `runTrustedTick`은 서버 인스턴스별 in-flight 플래그로 직렬화된다 — 이전 tick이
  도는 중이면 새 tick은 `skipped:'in_flight'`로 즉시 반환(load→run→save 경합·중복 실행 차단). 플래그는
  지속하지 않는다(크래시 후 stuck-running 회피). 단일 tick 내부는 순차 실행이라 중복 픽업이 없다.
- **만료 우선**: `tick` 진입에서 `state==='scheduled' && jobExpired` → `expired`(continue). 백오프 대기 중이라도
  만료가 재시도보다 앞선다 — 만료된 승인으로 재시도하지 않는다.

남은 후속(다음 slice): 백오프 지터(thundering herd 완화) · 반복 job 원장 크기 상한. 진짜 cron/daemon은 배포 계약 이후.

---

## 9. 자연스러움 훼손 방지 gate

근거: 계획서 §5.6.2 Rejection Criteria / 헌법 §2-4·§6. OS가 정렬해도 모델의 판단·언어·산출물이
훼손되지 않게 하는 게이트. 아래를 감지하면 실패로 본다.

| 감지 대상 | 실패 조건 | 근거 |
| --- | --- | --- |
| rigid prompt template | 모델 답을 틀에 가둬 자연스러움 훼손 | 헌법 §2-4 |
| BEAI5 축소 | 체크리스트·분류기로 BEAI5를 대체 | 헌법 §6 |
| 과잉 통제 | OS가 모델의 판단·언어 영역까지 대신함 | 계획서 §5.6.2 |
| 내부 상태 노출 | 자기파악 상태가 기본 대화 흐름을 점유 | 헌법 §5 |
| 도구 사실성 위반 | 못 쓴 도구를 쓴 척(§7 원장과 불일치) | 헌법 §2-5 |

규칙: 이 gate는 Phase 4 자연스러움 회귀 테스트로 고정한다. 계약 단계에서는 "무엇을 실패로 보는지"를
정의만 한다.

---

## 10. BEAI5 Integration Contract (내부 장, 감사 §3-1)

근거: 계획서 §5.6 + 필수 산출물 6번 + 헌법 §6. 감사 지시대로 이 문서 내부 장으로 둔다. 너무
커지면 독립 문서로 분리한다.

핵심 경계(계획서 §5.6.1/§5.6.2): **OS가 정렬할 것 vs 모델이 생성할 것.**

### 10.1 OS 속성·구조로 구현할 영역

| BEAI5 원리 | T5 구조화 | 실패하면 |
| --- | --- | --- |
| 현재 모델·도구·연결·권한 상태 파악 | SelfStateSnapshot / ModelRouteCell / Connection(§6) | 자기파악 미달, 도구 사실성 붕괴 |
| 확정/미정 분리의 근거 상태 | ToolReceipt "확인/미확인/추정"(§7) | 추정을 사실로 말함 |
| 외부행동 멈춤 | AuthorityGrant gate(§3) | 무단 외부 전송·삭제 |
| 맥락 좁게 입장 | ContextAdmissionPacket(§5) | 기억 오염, 과잉 개입 |

### 10.2 모델의 판단 헌장으로 남길 영역

| BEAI5 원리 | 모델에 남기는 이유 | OS가 제공할 최소 조건 |
| --- | --- | --- |
| 현실 판단·순서 정리 | 외부 코드가 대신하면 BEAI5 가치가 죽음 | 정렬된 SelfState + admitted context |
| 언어감각·자연스러움 | 기계적 통제가 훼손함 | 과잉 주입 없는 Task Context Packet(§11) |
| 산출물 품질·판단력 | 모델의 살아 있는 능력 | 목적·경계만 주고 방법은 열어둠 |

### 10.3 BEAI5 최종 기준

응답 뒤 사용자의 현실이 더 선명해지고, 판단 부담이 줄며, 실제로 쓸 수 있는 무언가가 남았는가.

---

## 11. LLM-ready Task Context Packet (모델 입력 계약)

근거: 계획서 §5·필수 산출물 5번 / 헌법 §6. 위 계약들이 모델에게 전달되는 최종 형태. §10.2의
"과잉 주입 없는" 원칙이 여기 적용된다.

| 필드 | 타입 | 필수 | 의미 | 경계·규칙 |
| --- | --- | --- | --- | --- |
| currentRequest | 문자열 | 필수 | 사용자 원문(보존) | IntentPacket에서. 왜곡 금지 |
| selfStateFacts | 객체 | 필수 | 자기파악 사실 | SelfStateSnapshot 요약. 사실만, 지시문 금지(T3 tool-path-briefing 원리) |
| admittedContext | 목록 | 선택 | 입장된 맥락만 | ContextAdmissionPacket 통과분 |
| authorityFacts | 객체 | 필수 | 권한 경계 사실 | 무엇이 자동/승인필요/금지 |
| answerMode | 열거 | 필수 | fast_chat / complex_work | |
| naturalness | 규칙 | 필수 | 과잉 통제 금지 | 방법·언어는 모델에 열어둠(§10.2) |

규칙: 이 패킷은 "사실·경계"를 주고 "판단·문장"은 모델에 남긴다(헌법 §6, T3 tool-path-briefing 실증
원리). 지시문 장문 주입이 아니다. 무관한 사실을 나열하지 않는다(요청 관련만).

---

## 12. Phase 3 연결성 + 정본 수정 제안

이 계약은 Phase 3 UX Architecture가 화면으로 표현할 상태 언어의 상위 정의다. Phase 3은 이 계약의
필드를 사용자 표면(Work Chat·Today·Connection·Approval·Ledger)에서 어떻게 보여줄지 설계한다.

정본 수정 제안(계획서·절대원칙 수정 아님, 감사·다음 Phase 판단용):

1. 계약 필드의 직렬화 포맷·타입 시스템은 Phase 5 착수 시 확정한다. 이 문서는 개념 계약만 정한다.
2. 감사 §3-3 "T3 재사용 3건은 사용자면/진단면 분리·권한 계약·실패 테스트 요구"는 Phase 5 코드
   이전 시점의 게이트다. 계약 단계에서는 §7 userSafeSummary 분리로 반영했다.

---

*Codex 감사 결과 이 계약은 Phase 2 Kernel Contract 로 봉인한다. 다음 단계는 Phase 3 UX Architecture 다.*
