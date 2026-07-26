# GPAO-T5 Kernel Contract

- Status: `Codex 감사 통과 · Phase 2 봉인` · **Phase 5.1(2026-07-24) · Approval Lifecycle · P6-2 · P6-3 · P6-3b · P6-4 · P6-5 · P6-6 · 2.0-A · 2.0-B · P6-7 · 2.0-C-0 · P6-11 · P6-12 · P6-13 · P6-14 · P6-15 · P6-16 · P6-17(Slice-1·2·3) · P6-18(Slice-1~5) · P6-19(Slice-1) · P-STAB-1 개정(2026-07-25~26)**
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
- P6-5 개정 반영(근거: `P6-5-REAL-WEB`, 깊은 감사 통과+보정): §6.6 런타임 어댑터 **구현됨** —
  `makeWebCollector`(실제 HTTP GET, fetchImpl 주입, 라이브만 실어댑터·기본 offline 스텁), `httpToFetchState`
  (코드+본문으로 벽/차단 분리), 봤다→출처 필수·못봤다→내용·출처 없음, timeoutMs+AbortController(끝나지 않는
  페이지가 Work Chat을 멈추지 못하게).
- P6-6 개정 반영(근거: `P6-6-REAL-CHANNEL`, 깊은 감사 통과): §6.7 ChannelSender 런타임 어댑터 **구현됨** —
  `makeChannelSender`(Slack/Telegram 실제 전송, fetchImpl 주입), A2 우회 없음(전송은 승인 뒤 실행자),
  토큰=사용자 소유(env)·없으면 needs_auth(가짜 성공 없음), 실패 분리(auth_failed→permanent /
  rate_limited·timeout→transient), ToolRunner `{failed:true}`→FAILED(transient) 매핑.
- 2.0-A 개정 반영(근거: `T5-2.0-A-TOOLBOX-STATE`, 깊은 감사 통과+보정): §6.8 도구함 표면 —
  `projectToolbox`(순수)·`GET /toolbox`, UI 상태=실제 runtime 상태. 보정: 도구 상태는 SelfState(env)
  단일 진실을 따르고, 라이브 자격을 `liveDeps(processEnv)`가 env·tools에 함께 반영(slack.post는 토큰 유무로
  connected 결정) — 도구함과 실행 게이트가 어긋나지 않는다.
- 2.0-B 개정 반영(근거: `T5-2.0-B-CONNECT-DURING-WORK`, 깊은 감사 통과+보정): §6.8 작업 중 연결 안내 —
  blockedTools(연결/설정 계열)→`connectionNeeded` 표면화, 채팅→도구함 focus. 보정: 연결 안내는 작업 복귀
  경로라 **historical에서도 유지**(pending context), 연결 버튼은 도구함 focus만(실제 연결 후속), `connectHint`는
  연결/설정 계열에만.
- P6-7 개정 반영(근거: `P6-7-NL-SEND-PRECISION`, 깊은 감사 통과): §6.7 send 정밀화 — `parseSend`로 대상·내용을
  지시 문장과 분리(문장 전체 미전송), 애매하면 clarify(대상/내용), 승인 preview 어디에/무엇을/되돌리기,
  executePlan은 {target,text}로 실행, A2 경계 유지. toConnection이 toolKind를 SelfState까지 전달.
- 2.0-C-0 개정 반영(근거: `T5-2.0-C-0-CAPABILITY-RESOLUTION`, 깊은 감사 통과+보정): §6.9 CapabilityResolution —
  부족 능력(tool/skill/connector/profile/target/permission)을 하나의 패킷·통합 카드로(비파괴), resumeContext
  복귀 경로. 개인 도구 준비 게이트(등록≠실행가능, "설정 확인" 통과 전 executable=false, 실패시 이유+다음행동) +
  SkillDescriptor 다섯 축 초안. 후속: P6-11 Learning-to-Workflow Promotion.
- P6-11 개정 반영(근거: `P6-11-LEARNING-TO-WORKFLOW`, 깊은 감사 통과+보정): §6.10 Learning-to-Workflow —
  TaskTrace(넓게 기록)→PatternCandidate→ReplayCase(기본 형식 확인)→승인 후 DefaultTarget 승격(질문 축소).
  broad memory narrow influence(승격분만 영향), A2 우회 없음, scope:'global' 명시(숨은 전역 금지)·UI 정직 표시,
  되돌리기. 남은 승격 타입(Skill/Blueprint/ProfileRule)은 후속.
- P6-12 개정 반영(근거: `P6-12-STREAMING-WORKTRACE`, 깊은 감사 통과+blocker 2건 보정): §6.11 Streaming &
  Work Trace — TurnEvent 계약+EventLog(durable truth 투영, lastEventId 재접속, 항상 complete·무한대기 금지),
  사용자 언어 작업흐름(사고 원문 금지), 프라이버시(원문 URL 금지·POST stream-start→streamId), heartbeat.
  Hermes 운영 신뢰성 흡수(복제 아님). 후속(P6-12-2): 토큰 스트리밍·backpressure·lane 회귀.
- P6-13 개정 반영(근거: `P6-13-COMPLETION-CONTRACT`, 깊은 감사 통과+보정): §6.12 Completion Contract —
  완료=검증됨(생성 아님). parseCompletionCriteria(count/no_dup/no_missing/sections/stop, 중단↔count 분리) +
  verifyCompletion→VerificationReceipt(실패 지목·중단 시 멈추고 물음), POST /verify. CLAUDE.md "완료=실제 동작"을
  런타임 계약으로. 턴 자동 게이트·TruthLedger 연결은 후속.
- P6-14 개정 반영(근거: `P6-14-DELIVERY-LEDGER`, 깊은 감사 통과+세션 경계 blocker 보정): §6.13 Delivery Ledger —
  생성≠전달, DeliveryRecord(sessionId 소유권), GET/retry 세션 검증(없음 400/타 세션 403, tool call 0),
  delivered 중복 방지, failed delivery는 DefaultTarget 학습 제외. 외부 전송 A2를 계약으로 명시. **후속(필수)**:
  원 승인 만료 후 재승인 · retry approvalId·grantScope 원장 연결.
- P6-15 개정 반영(근거: `P6-15-SMART-APPROVAL`, 깊은 감사 통과+blocker 3건 보정): §6.14 Smart Approval —
  판단을 사용자 언어로(정책 불변), 안전 바닥(SAFETY_FLOOR)·자동 진행 allowlist(AUTO_SAFE_KINDS) 어느 모드도
  우회 불가, unknown/누락 kind·toolKind는 최소 A2(UNKNOWN_KIND, autoAllowed 미유입), 화면 내부어 금지
  (안전 바닥→"꼭 확인"). 후속: 모드 전환 UI·저장.
- P6-16 개정 반영(근거: `P6-16-CHANNEL-REGISTRY`, 깊은 감사 통과+라이브 자격 blocker 보정): §6.15 ChannelRegistry —
  채널/커넥터를 한 레지스트리로 정리(connector-profile·inbound-gate 재사용), 사용자 언어 status+doctor,
  connected≠approved 유지. **라이브 표면은 실제 자격에서 파생**(liveDeps.channels, 토큰 없이 초록 오표시 금지 —
  "보이는 것=실제 가능한 것"). demoChannels는 fixture 전용. 후속: inbound 정책 게이트 소비·P6-18 UI 표면화.
- P6-17 개정 반영(근거: `P6-17-SESSION-SEARCH`, 깊은 감사 통과): §6.16 Session Search(학습 루프 3분할 첫 조각) —
  검색 결과는 raw로 라우터·answer에 안 섞이고 candidate(recalled_context, admitted:false)로만, admission
  (context-mesh userConfirmed) 통과해야 영향. POST /search는 turn 미실행. **검색 표면(Slice-3): 결과는 "찾은 기억·
  반영 안 됨", 반영은 명시 admit(POST /search/admit)만 — 찾음≠반영. 되돌리기(Slice-4): 반영하기와 동일 수준의
  rollback(POST /memory/rollback), rollback 후 promoted/admitted 영향 제거, admit은 중복도 candidateId 반환.**
- P6-17 Slice-2 반영(근거: `P6-17-SKILL-LIFECYCLE`, 깊은 감사 통과): §6.17 SkillCandidate Lifecycle — §6.10을
  명시적 상태 기계(detected→candidate→replay_required→approved→admitted|rejected)로 일반화. 스킬 자동 실행 권한
  없음(canAutoExecute 항상 false), replay+확인 전 영향 0, replay 실패→rejected. GET/detect/approve/reject(최소 표면).
- P6-17 Slice-3 반영(근거: `P6-17-USER-MODEL`, 깊은 감사 통과): §6.18 User Model Separation — 추정된 성향
  (inferred_trait, observed 레인, 영향 0, gate 이중 차단)과 승인된 운영 선호(operating_preference, userConfirmed 후
  promoted→admittedContext)를 kind/lane/API 분리. 추정→승인 자동 승격 금지. GET /user-model + traits/preferences/
  confirm. 후속: P6-18에서 "추정됨"↔"반영 중" 구분(추정을 "T5가 나를 반영한다"처럼 보이게 금지).
- P6-18 Slice-1·2 반영(근거: `P6-18-STATUS-OVERVIEW`·`P6-18-OVERVIEW-ACTIONS`, 깊은 감사 통과): §6.19 Status
  Overview — 조용한 읽기 전용 단일 진입점(칩 열 때만, 안티 대시보드) + 조치. 누적된 구분을 구조/문구로:
  연결≠가능·추천≠활성·추정≠반영·실패≠완료. Slice-2 액션(재전달·승인·확인)은 기존 게이트 엔드포인트 그대로,
  항목을 "아직 아님"→"완료"로 이동. 추정은 액션 없이 읽기 전용. 후속: 검색 표면(찾은≠반영)·모바일.
  (모바일 375px 크럼 회귀 해소 포함.)
- P6-19 Slice-1 반영(근거: `P6-19-NATURAL-GOVERNANCE`, 라이브 검증): §6.20 Natural Governance Recovery Surface —
  회복 가능한 실패(recoverable_error)를 침묵 대신 같은 턴의 사용자 언어 회복 안내(text+다음 안전 행동)로 렌더.
  내부 원문·스택 미노출, 성공처럼 안 보임. P-STAB-1 타임아웃의 사용자 표면.
- P-STAB-1 반영(근거: `P-STAB-1-MODEL-TIMEOUT`, 코드 재감사 통과): §6.21 Stability Guard / Model Response Timeout —
  느린/멈춘 모델이 턴을 무한 매달지 않게 withModelTimeout으로 바운드(초과 시 recoverable_error+complete, 큐 풀림).
  ②장시간 안정성 첫 조각. §6.20과 별도 절(백엔드 안정성 vs 사용자 회복 표면).
- P-RT-4 반영(근거: `P-RT-4-MODEL-CONNECT-UX`, 조건부 반려 blocker 2건 해소 후 병합 + 전 여정 라이브 실측):
  §6.24 Model Connect UX — 화면에서 키 연결. 검증 통과(usable)만 저장(0600, 덮어쓰기 포함 chmod 보장 —
  감사 B1)·활성화(핫스왑), 실패 키는 기존 연결 불가침. 우선순위 저장>env>stub. 저장 연결 복원은 **listen
  전**(감사 B2 — 재시작 직후 첫 요청부터 저장 모델, startLiveServer 로 추출·테스트). 원본 키·authSignal
  은 어떤 응답에도 미노출(마스킹만). baseUrl 은 http/https·자격증명 금지 검증. 후속: P-RT-3 OAuth·keychain.
- P-RT-2 반영(근거: `P-RT-2-PROVIDER-DOCTOR`, 조건부 반려 blocker 2건 해소 후 병합 + 라이브 3종 실측): §6.23
  Provider Doctor — "구성됨→검증됨" 승격. 과금 0 모델 목록 GET 으로 키 유효성·도달성·설정 모델 존재를 실검증.
  두 축 반영: 자격은 authSignal(classifyModelAuth), readiness 는 별도 env.model.healthState →
  buildSelfState/selfStateSummary.modelHealthState → 칩 "모델 확인 필요"(model_missing 인데 준비됨 금지, B1).
  공개 /model/health 는 authSignal(원문 진단) 미노출(B2). GET /model/health + 부팅 비차단 점검, 미배선은
  stub/unverified 정직 표시. 후속: P-RT-3 OAuth(이월)·키 입력 UX·주기 재검증 TTL.
- P-RT-1 반영(근거: `P-RT-1-MODEL-PROVIDER-ADAPTER`, 조건부 통과 감사 + gemini·beai 라이브 검증): §6.22 Model
  Provider Adapter — 오너 지시(OpenAI OAuth·3사 API 키·오픈소스 호환) 착지. 선언형 어댑터 6종
  (anthropic/openai/openai_oauth/gemini/beai/openai_compatible), 자격 분류는 classifyModelAuth 단일 소스,
  타임아웃 시 fetch 실제 abort, 미구성→stub 폴백(env.model 단일 진실). **구성됨≠검증됨**(authSignal:'ok'는
  자격 존재 표시 — 상시 검증은 후속 provider doctor). 부수: withSessionQueue tail unhandledRejection
  프로세스 사망 잠복 버그 수정(반대 테스트 동반). 후속: P-RT-2 OAuth 플로우·키 입력 UX·스트리밍.
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

**런타임 어댑터(구현됨, P6-5)** — 위 계약을 실제로 실행하는 `makeWebCollector({fetchImpl, robotsCheck,
timeoutMs})`(L3). 실제 HTTP GET(기본 `global fetch`, **주입 가능** — 테스트·기본 경로는 실네트워크를 치지
않고 offline 스텁 유지, 라이브 서버만 실제 어댑터).
- `httpToFetchState(status, {body})`: 코드+본문 신호로 상태 분류. 401→login_wall, 429→bot_wall,
  403→(봇신호)bot_wall|blocked, 2xx→(본문신호)ok|login_wall|bot_wall|robots_disallow(200이어도 로그인/캡차
  페이지는 벽으로), 그 외→blocked. **봤다→title·excerpt·SourceEvidence, 못봤다→내용·출처 없이 상태만.**
- **시간 제한(필수)**: `global fetch`엔 기본 제한이 없어 끝나지 않는 페이지가 Work Chat을 멈출 수 있다.
  `timeoutMs`(기본 15s, 라이브 `GPAO_T5_WEB_TIMEOUT_MS`) + `AbortController`로 fetch+본문읽기 전체를 timeout
  race로 감싼다(signal 무시 응답도 멈춤). 초과 → `{blocked, fetchState:'timeout', result/sources 없음}`.
- 스크래핑 정책 실행: 읽기전용(GET)·`validateWebInput` maxPages cap·robots 판정(주입, 실제 robots.txt fetch는
  후속). freeform `{request}`에서 URL 추출(turn은 generic — 웹 로직은 어댑터). 검색어 단독(SERP)은 후속.

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

**ChannelSender 런타임 어댑터(구현됨, P6-6)** — §6.7 계약을 실행하는 **아웃바운드 전송** 어댑터.
`makeChannelSender({channel, token, defaultTarget, fetchImpl, timeoutMs})`(L3). Slack(`chat.postMessage`,
Bearer)·Telegram(`sendMessage`, URL token). 안전 경계:
- **A2 우회 없음**: 전송은 `sendNeedsApproval()=true` 그대로, ActionPlan 승인 뒤 executePlan이 부르는
  실행자일 뿐이다. 어댑터가 게이트를 우회하지 않는다(라이브 실측: 슬랙 전송 요청→approval, 승인 전 전송 0).
- **자격은 사용자 소유**: 토큰은 config/env(`SLACK_BOT_TOKEN` 등). 어댑터가 소유·회전하지 않는다. 없으면
  정직하게 `needs_auth`(몰래 안 보냄, 가짜 성공 없음).
- **실패 분류**: `auth_failed`(재시도로 안 풀림→blocked→permanent) vs `rate_limited`/`timeout`(→failed→
  transient=P6-4 백오프). 보냈으면 sent, 못 보냈으면 보낸 척 안 한다. 시간 제한은 공유 `withTimeout`.
- **ToolRunner 매핑(general)**: 핸들러의 `{failed:true}`→FAILED(transient) receipt(기존 `{blocked}`=permanent와
  분리). 일시 실패를 정직한 메시지와 함께 남기고 자동화 백오프로 잇는다.
- 안전 규율: `fetchImpl` 주입 — 테스트·기본 demoTools는 실 API를 치지 않는다. 라이브 서버만 실어댑터.

**send 정밀화(P6-7)** — send류 요청은 **보낼 내용(message)·대상(target)을 지시 문장과 분리**한다. 사용자
문장 전체를 도구에 그대로 던지지 않는다(T3의 위험 지점). `parseSend(text, toolId)`(순수, `l1-intent`)가
대상(email/#채널/이름+에게)과 내용(따옴표 > 플랫폼·대상 접두·말미 동사·인용 어미 제거)을 분리한다.
- **애매하면 실행하지 않고 확인**한다(kind:'clarify'): 대상 없으면 "어디로", 내용 없으면 "무엇을". 기본
  대상(ConnectorProfile default target)이 생기기 전까지는 대상 없는 전송을 clarify로 막는 게 맞다(후속에서
  default가 생기면 clarify를 줄인다).
- 명확하면 `sendArgs{[tool]:{target,text}}`를 승인 pending에 보존하고, 승인 카드 preview를 사용자 언어
  **어디에/무엇을/되돌리기**로 채운다. `executePlan`은 send를 `{target, text}`로 실행한다(문장 전체 아님).
- **A2 경계는 그대로**: 명확해도 전송은 승인 뒤 실행자로만(sendNeedsApproval). 정밀해진 건 전송 인자뿐이다.
- 부수: `toConnection`이 `toolKind`를 SelfState까지 전달해 send 판정·ActionPlan이 descriptor를 먼저 믿는다.

### 6.8 도구함 표면 (Toolbox surface — 2.0-A)

근거: `T5-2.0-TOOLBOX-CONNECTION-CENTER-UX-REFERENCE`(오너 정본) §7 Slice 2.0-A. 사용자가 "실제로 뭘 할 수
있는지" 아는 읽기 전용 상태 표면. 제1원칙: **도구함 UI 상태 = 실제 runtime 상태**(어긋나면 T3의 "보이는 것≠
되는 것" 재발). `projectToolbox(selfState, descriptors)`(순수)가 `GET /toolbox`로 사용자 언어 카드를 준다 —
상태 점(초록 사용가능/노랑 연결필요/빨강 차단/회색 비활성)·능력 배지·연결/실행/승인 세 축 분리.

**단일 진실 규칙(감사 보정)**: 도구 상태는 `SelfStateSnapshot`(= `buildSelfState(env)`)에서만 온다. 실제 자격은
env에 반영해 **도구함과 실행 게이트(`isToolExecutable`)가 같은 env를 읽게** 한다. 라이브 배선은
`liveDeps(processEnv)`가 env·tools를 함께 만든다 — 예: `slack.post.connected = Boolean(SLACK_BOT_TOKEN)`.
토큰 없으면 도구함은 노랑 "연결이 필요해요"·`executable:false`(승인만 받고 뒤늦게 실패하는 불일치 금지),
있으면 초록 사용 가능. 없는 도구를 있는 것처럼 보이지 않고(카드=descriptor), 기술 용어(status enum·MCP·
token·schema)를 표면에 노출하지 않는다.

**작업 중 연결 안내(2.0-B)**: 작업에 필요한 도구가 연결/설정 계열(needs_auth/needs_connection/needs_config)로
막히면, `executePlan`이 `plan.blockedTools` 중 첫 도구를 `connectionNeeded{toolId,label,requestText}`로
표면화한다(완전 차단=빨강은 연결로 안 풀리므로 제외). 원칙:
- **연결 안내는 제안이 아니라 작업 복귀 경로다** → 메모리·자동화 제안과 달리 **historical transcript에서도
  유지**된다(재접속·새로고침 후에도 연결이 필요했던 작업으로 돌아갈 길이 사라지지 않는다). 원래 요청
  (`requestText`)을 보존해 pending context로 쓴다.
- **연결 버튼은 실제 연결 실행이 아니라 도구함 focus만** 수행한다(죽은 '연결하기' 버튼 금지). 실제
  OAuth/토큰 저장은 후속(2.0-C).
- `connectHint`(도구함 상세의 준비 안내)는 **연결/설정 계열 상태에만** 붙인다. `blocked`·비활성엔 "연결되면
  이어서"가 부정확하므로 붙이지 않는다.

**개인용 도구·스킬 추가(2.0-C 이후)**: 사용자가 새 능력을 추가하는 흐름은 두 갈래로 분리한다.
- `ToolDescriptor`는 실행 수단이다(로컬 스크립트, 개인 MCP, 웹/브라우저, 메신저 전송 등). 등록 후에도 연결·권한·실행 테스트가 통과하기 전까지 사용 가능으로 보이지 않는다.
- `SkillDescriptor`는 작업 방식이다(리뷰 분석, 고객 응대, 주간 보고, 매장 점검 등). 스킬은 도구를 포함할 수 있지만 도구와 같지 않으며, 말귀·절차·맥락·결과물 형식·replay 테스트를 가진다.
- T5는 필요한 도구/스킬을 능동적으로 감지하고 추천할 수 있지만, 추천은 설치·연결·권한 부여·기억 승격이 아니다. 사용자의 확인과 테스트 게이트가 지나기 전에는 행동에 영향을 주지 않는다.

개인용 도구·추천·Output Canvas는 2.0-C 이후.

### 6.9 CapabilityResolution (막힘 해결 경로 — 2.0-C-0, 구현됨)

근거: 헌법 최상위 원칙(사용자를 덜 헤매게), Codex 전략 브리핑(오너 승인). "이거 해줘" 했는데 능력이 없을 때,
흩어진 신호(커넥터·도구·대상·권한)를 **하나의 정식 패킷**으로 묶어 막힘을 목적 달성 경로로 바꾼다.

`CapabilityResolution {requestText, desiredOutcome, missingCapability, capabilityType, currentStatus, reason,
nextAction, requiresApproval, testPlan, resumeContext, alternatives, ref}`
- `capabilityType`: tool | skill | connector | profile | target | permission
- `nextAction`: connect | install | register | test | clarify | approve | alternative
- `resolveCapability(signals)`: 부족 신호를 첫 하나로 분류(우선순위 permission > connector > tool > target).
  **비파괴**: 기존 §6.7 connectionNeeded(2.0-B)·toolCandidate(2.0-C)·send-clarify(P6-7)·approval을 근거로 재사용.
  UI는 연결/도구를 **하나의 통합 카드**로(2.0-B+2.0-C 카드 통합). `resumeContext`는 원래 작업 복귀 경로(비우지 않음).

**개인 도구 준비 게이트(2.0-C-1, 구현됨)**: `definePersonalTool`(등록=`testState:'untested'`, executable=false) →
`runProbe`(이 슬라이스: **필수 설정 완비 확인** — 실제 외부 실행/OAuth는 후속이라 UI는 "설정 확인", "실행 테스트"
아님) → `applyProbe`(passed→executable / failed→이유·다음 안전 행동). **등록됨 ≠ 실행 가능**: 확인 통과 전에는
사용 가능처럼 보이지 않는다. 도구함은 "개인용/설정 확인 전/실행 불가"로 정직하게. 죽은 버튼 없음.

**SkillDescriptor 초안(2.0-C-2, 계약만)**: 도구 ≠ 스킬. 스킬은 작업 "방식"으로 다섯 축(말귀·절차·맥락·결과물
형식·replay)을 가진다. 추천은 설치·승격 아님 — 확인·replay 통과 전 영향 0. store·UI·실행은 후속.

후속: 기본 대상·프로필 라우팅·페어링·ambient·connector doctor·blueprint·task flow·채널별 출력.

### 6.10 Learning-to-Workflow Promotion (P6-11, 구현됨 — DefaultTarget)

근거: Hermes "한 번 어렵게 한 일을 다음부터 빠르게" 흡수 + auto-memory 절대 경계. 한 번 수행한 작업을
`TaskTrace`로 넓게 기록하고, 반복 가능성이 있으면 `PatternCandidate`로 제안한 뒤, **사용자 승인 + ReplayCase**를
거쳐 승격한다. 첫 타입은 `DefaultTarget`(P6-7 "어디로?" clarify를 두 번째부터 축소).

**절대 경계**: **broad memory, narrow influence** — 넓게 관찰·기록하되 행동 영향은 승인·replay 통과한 좁은
것만. "배워간다" 느끼되 "멋대로 한다"는 안 된다. **권한 승인(A2)은 우회하지 않는다**(기본 대상이 있어도 자동
전송 안 하고 승인). 잘못 배운 건 되돌린다.
- `TaskTrace`(넓게 관찰, 영향 0) → `proposeDefaultTarget`(대상 명시 전송→후보) → `replayDefaultTarget`(승격 전
  **기본 형식 확인** — 실제 채널 존재 검증은 후속) → `promoteDefaultTarget`. `defaultTargetFor`는 승격분만 소비.
- **scope 명시(숨은 전역 영향 금지)**: 승격에 `scope:'global'` 저장. UI는 "모든 대화에서 이 도구의 기본 대상으로
  기억"으로 범위를 사용자 언어로 정직하게 표시 — 사용자가 이해한 기본값이지 숨은 전역이 아니다. project/profile
  scope는 후속.
- 서버: `sentVia`(승인된 send 실행)→TaskTrace 기록+후보, `ctx.defaults=promoted`만 주입(narrow),
  `GET/POST /patterns`(confirm=replay→승격 / rollback=영향 제거).

남은 승격 타입(후속): SkillDescriptor(작업 방식)·AutomationBlueprint(반복 주기)·ProfileRule(가게/고객방 격리).

### 6.11 Streaming & Work Trace (P6-12, 구현됨 — 안전 척추)

근거: Hermes 운영 신뢰성 흡수(복제 아님, T5 원칙 재구성) + 헌법(사용자를 덜 헤매게). **스트림은 durable
truth(EventLog/ToolReceipt/TruthLedger) 위의 투영이지 진실의 출처가 아니다** — T3의 "스트림 멈추면 대화 죽음"을 막는다.

- `TurnEvent{turnId, eventId(단조), type, payload, durable, createdAt}`(§L0). type: trace_status/tool_progress/
  evidence_added/approval_required/capability_needed/blocked/recoverable_error/partial_result/answer_delta/
  complete/heartbeat. **모델 숨은 사고 원문 노출 금지 — payload는 사용자 언어 상태뿐**(Hermes는 리즈닝 원문을
  노출하지만 T5는 작업흐름: 요청 이해→도구 확인→실행→검증→정리).
- `EventLog`(세션별): durable 이벤트만 남긴다(answer_delta/heartbeat 비지속). `since(lastEventId)`로 재접속
  복구, `lastIsTerminal`로 미종료 turn 복구 표시. **항상 complete로 닫힌다(무한 대기 금지).**
- **프라이버시(감사 blocker)**: 사용자 원문은 URL에 싣지 않는다. `POST /turn/stream-start`(본문 text)→streamId,
  `GET /turn/stream?sessionId&streamId`로 구독(일회성·만료). URL엔 sessionId/streamId/lastEventId만.
- `heartbeat`(비지속)로 연결 생존. `/turn`과 `/turn/stream`이 `runAndPersistTurn`을 공유(동작 갈라짐 방지).
- 후속(P6-12-2): 진짜 LLM 토큰 스트리밍(answer_delta)·backpressure·느린 클라/모델·백그라운드 tick 동시 회귀.

### 6.12 Completion Contract (P6-13, 구현됨 — 완료 = 검증됨)

근거: Hermes "/goal + 검증"(복제 아님, T5 원칙 재구성), 헌법·CLAUDE.md **"완료 = 테스트 통과가 아니라 실제
동작"**. 사용자가 "언제 끝난 걸로 볼지"를 자연어로 말하면 T5가 그걸 **검증 기준**으로 잡는다. **완료는
"생성했다"가 아니라 검증 통과다.**

- `parseCompletionCriteria(text)` → `{checks, constraints, stop}`. 체크: count·no_duplicate·no_missing·
  sections_exist(절 경계 존중)·constraint(안내)·stop(애매 N건 넘으면 멈춤). **중단 조건과 count 분리(감사
  보정)**: stop을 먼저 파싱·제거한 뒤 count를 뽑는다 — "애매 3건 넘으면"의 숫자를 산출물 개수로 오인하지 않는다.
- `verifyCompletion(contract, artifact)` → **VerificationReceipt**{checks[{name,ok,detail}], allPassed,
  stopTriggered, complete, userSafeSummary, nextSafeAction}. `complete = allPassed && !stopTriggered && checks>0`.
  실패면 어느 체크가 안 맞는지 지목+다음 안전 행동, 중단이면 멈추고 확인 질문. VerificationReceipt는
  TruthLedger와 같은 정직-원장 계약.
- `POST /verify {criteria, artifact}` → `{contract, receipt}`.
- **후속**: 턴 자동 게이트(도구가 구조화 산출물을 낼 때 완료를 자동 검증해 "완료"를 게이트 + VerificationReceipt를
  TruthLedger에 durable) + 채팅 검증 카드 + P6-12 스트리밍 `trace_status:검증 중` 연결. 이 슬라이스는 `/verify`
  첫 조각까지.

### 6.13 Delivery Ledger (P6-14, 구현됨 — 생성 ≠ 전달)

근거: Hermes "Delivery Application Ledger"(복제 아님, T5 재구성), P6-12 EventLog(durable truth), P6-13
VerificationReceipt, §7 ToolReceipt.lifecycle, P6-6 ChannelSender. T3의 큰 사고 **"했다는데 사용자가 못 받음"**을
막는다. **결과 생성(artifact)과 결과 전달(delivery)을 분리**하고, 실패해도 처음부터 다시가 아니라 **기존
산출물을 이어서 재전달**한다.

- **완료 = 실제 전달 확인(delivered) 이후에만.** "생성했다"·"보내려 했다"는 완료가 아니다(§6.12와 같은 정직 원장).
- `DeliveryRecord {id, sessionId, tool, channel, target, artifact, state('attempting'|'delivered'|'failed'),
  attempts, lastError, retriable, needsFix, createdAt}`. `sessionId`는 이 전달을 승인·생성한 **소유 세션**.
  - `makeDelivery` — 산출물·소유 세션과 함께 attempting으로 시작.
  - `applyDeliveryResult(d, failureState, summary)` — none→delivered / failed·timeout→failed(retriable) /
    blocked·cancelled→failed(needsFix, 원인 해소 후 재전달). **산출물은 항상 보존(재생성 없음).**
- **세션 소유권 경계**: 전달 원장은 전역이 아니라 세션 소유. `GET /deliveries?sessionId=`는 **sessionId 필수
  (없으면 400) + 세션별 필터** — 다른 대화의 전달은 보이지 않는다.
- **retry 세션 검증**: `POST /deliveries/:id/retry {sessionId}`는 세션 검증을 **`tools.run` 전에** 통과시킨다 —
  sessionId 없음→400, 다른 세션→403, **둘 다 tool call 0**(외부 전송 미발생). 통과 시에만 저장된 artifact/target을
  그대로 재전달. **외부 전송은 A2 유지**(주석이 아니라 계약): 재전달 허용은 **정확히**
  `same session + same approved artifact + same target + explicit user retry action`일 때만이다 —
  이 경계를 우회한 임의 대상·임의 내용 전송은 A2를 건너뛴 새 외부 행동이므로 금지.
- **delivered 중복 방지**: 이미 delivered인 건 재전달해도 다시 보내지 않는다(`alreadyDelivered`).
- **실패 전달은 학습에서 배제**: DefaultTarget(§6.10) 학습 후보는 **실제 전달된(delivered) 경우에만** 제안한다 —
  실패한 전송을 기본 대상으로 잘못 학습하지 않는다.
- **후속(필수)**: **원 승인 만료 후 재승인**(재전달 시 원 승인 범위가 시간 경과로 만료됐으면 이어실행하지 않고
  재승인 — Approval Lifecycle 계약과 연결) · **retry의 approvalId·grantScope를 DeliveryRecord/원장에 연결**
  (재전달이 참조하는 승인 범위를 durable하게 추적). 그 외: 채널 외 전달 확장(파일·다운로드 링크·웹 게시의 전달
  확인) · needsFix(연결/권한) 자동 안내→연결 흐름 · §6.12 완료 게이트에 "전달 확인" 포함.

### 6.14 Smart Approval (P6-15, 구현됨 — 판단을 사용자 언어로, 안전 바닥 불변)

근거: Hermes 승인 UX(복제 아님, T5 재구성), 헌법 §3(AuthorityGrant A0-A3). 목표는 승인을 **느슨하게 만드는
게 아니라 사용자가 덜 헤매게** 하는 것 — 위험한 일은 계속 멈추고(안전 바닥), 낮은 위험만 자연 진행하며, 멈출 땐
**왜 멈추는지 사용자 언어로** 설명한다. 첫 슬라이스는 **정책을 바꾸지 않고** 현재 A0-A3 판단을 표면화한다.

- `ApprovalMode = 'manual'|'smart'|'strict'`(`APPROVAL_MODES`, 기본 `smart`). 모드는 **저위험을 얼마나
  통과시키느냐만** 조절한다: manual/smart는 A0·A1 자연 진행(smart는 이유 표면화), strict는 A1(되돌릴 수 있는
  로컬 정리)도 확인. **안전 바닥은 어느 모드에서도 우회 불가.**
- **안전 바닥(`SAFETY_FLOOR_KINDS`, `isSafetyFloor`)** — 외부 전송·SaaS 쓰기·자동화 활성화·장기 기억 승격·삭제·
  결제·게시·민감 내보내기·권한 상승/변경·비밀/계정 접근은 **항상 A2+**. tier 분류와 **독립된 불변식**이다.
- **자동 진행은 명시된 저위험 allowlist(`AUTO_SAFE_KINDS`)만**: A0=read/summarize/search/draft,
  A1=organize/title/archive. `decideAutoGrant`는 tier가 아니라 이 allowlist로 판정 → 오분류·회귀에도 안전.
- **모르는 것·비어 있는 것은 안전하지 않은 것**: `classifyTier` default=**A2**(애매하면 높은 등급). `kind`
  누락은 `read`가 아니라 **`UNKNOWN_KIND`**(authority 세 진입점 + action-plan fallback 통일, known `TOOL_KIND`
  맵은 유지). unknown/누락 `toolKind` 도구는 `autoAllowed`로 새지 않고 승인 게이트로 올라간다.
- **판단을 사용자 언어로**: `explainAuthority(action, mode)` → `{tier, needsApproval, safetyFloor, why,
  whatChanges, reversible}`. 개발자식 용어(A2/tier/grant…) 금지. 승인 카드 응답에 `approvalMode` + grant별
  `reason`·`safetyFloor` 표면화. **화면 라벨은 내부어 금지** — `안전 바닥`은 화면에 `꼭 확인`으로(필드명 `safetyFloor`는 유지).
- **후속**: 모드 전환 UI + 저장(이 슬라이스는 판단 표면까지) · strict 모드별 문구 · A2/A3 배지의 일반 사용자용
  라벨 병행 · 자동 진행 이유의 조용한 표면화(요청 시 펼치기).

### 6.15 ChannelRegistry (P6-16 Slice-1, 구현됨 — 채널을 한 곳으로, 보이는 것 = 실제 가능한 것)

근거: OpenClaw gateway/channel 운영 구조 흡수(복제 아님, T5 재구성), §6.7 ConnectorProfile(auth≠approval),
§1.5 InboundEventGate. **새 기능이 아니라 정리** — 웹·채널·자동화·승인·전달·도구함이 붙은 지금, 채널/커넥터를
기능마다 따로 다루면 엉킨다(누더기). 연결 상태·자격·승인·진단·안내를 한 레지스트리로 묶는다. 이 슬라이스는
정리·표면화까지 — **실제 외부 전송·설정 변경은 하지 않는다.**

- **재사용(신규 발명 아님)**: `connector-profile`(자격·`connectorReadiness`·`sendNeedsApproval`) 단일 진실,
  `inbound-gate`(mention/allowlist/DM 결정적 게이팅 — 정책은 레지스트리가 선언, 게이팅은 게이트가 수행).
- `defineChannel({id, label, connector, inboundPolicy, outboundTool})` — 커넥터(자격)+inbound 정책+outbound 도구
  **바인딩**+라벨을 한 서술자로. `channelStatus`→`{status, ready, userSafe, inboundPolicy, outboundTool,
  sendNeedsApproval, diagnosis}`. `projectChannels`로 사용자 안전 뷰. 순수·선언(무 I/O)이라 l2-plan에 둔다.
- **보이는 것 = 실제 가능한 것**(핵심 신뢰선): `ready`(초록)는 `readiness==ok`일 때만 — 미연결·미자격은 초록
  아님. **라이브 표면은 실제 자격에서 파생**: `liveDeps`가 `channels`도 반환하고 `liveChannels`가
  `TELEGRAM_BOT_TOKEN`/`SLACK_BOT_TOKEN` 유무로 `connected`를 정한다. 토큰 없이 "받을 준비됨"으로 속이지 않는다
  (2.0-A slack 초록 오표시와 같은 계열 차단). `demoChannels`는 **test fixture 전용**(라이브 표면 금지).
- **connected ≠ approved**: 준비됐어도 전송은 항상 A2(`sendNeedsApproval=true`). **사용자 언어**: `userSafe`·
  doctor `diagnosis`(nextAction: connect/authenticate/retry)에 내부 readiness 코드 미노출.
- `GET /channels`(사용자 안전 뷰+doctor). 기존 `/connectors`(원시 두 축)는 내부/디버그 뷰로 유지.
- **후속**: inboundPolicy를 게이트가 실제 소비(채널별 차등) · `/channel/inbound` 조회를 레지스트리 단일 소스로
  승격 · P6-18에서 연결 페이지에 status·doctor 표면화(조용히·필요할 때만, 안티 대시보드) · 실 provider 연동·
  토큰 유효성 실측(지금은 토큰 존재 유무까지).

### 6.16 Session Search (P6-17 Slice-1, 구현됨 — 검색은 후보로만, admission 없이는 영향 0)

근거: Hermes closed learning loop 흡수(복제 아님, T5 권한·admission 구조로 재구성), 헌법 §3-2·§5(라우터가 raw
기억 안 씀), §5 Context Mesh. P6-17(학습 루프)의 첫 조각 — 가장 격리하기 쉬운 검색부터 admission 경계를 세운다.
후속: Slice-2 SkillCandidate lifecycle, Slice-3 user model("추정"↔"승인된 운영 선호") 분리.

- **핵심 안전 불변식**: 검색 결과는 **raw 상태로 라우터·answer에 섞이지 않는다.** 검색은 turn을 돌리지 않고
  모델에 먹이지 않는다. 결과는 **candidate로만**(admitted:false, userConfirmed:false → 영향 0). 이후 대화에
  영향을 주려면 T5 admission(§5 context-mesh, `isInfluenceEligible`)을 통과해야 하고, 승격돼도 "이번 요청에
  관련"될 때만 좁게 입장(broad memory, narrow influence).
- `searchTranscripts(sessions, query)` → `[{sessionId,title,role,snippet}]`. 결정적 키워드 매치(모델 아님),
  `isRelevant` 재사용. user 발화·assistant reply 대상. **자기 과거 대화 회수라 세션 경계를 넘어 찾는다 —
  가시성 경계가 아니라 영향 경계(admission)로 안전을 건다**(§6.13 delivery 세션 소유권과 다른 축).
- `makeSearchCandidate(hit, id)` → ContextAdmissionPacket 호환(`kind:'recalled_context'`, admitted:false,
  `source:{sessionId,title,role}`). context-mesh `isInfluenceEligible`/`promote`가 그대로 게이트(신규 admission 없음).
- `session-store.loadAll()`(검색용 전체 로드). `POST /search {query}` → `{results, admittedIntoContext:false}` —
  turn 미실행·모델 미투입, 후보만. 빈 검색어 400.
- **검색 표면(P6-18 Slice-3, 구현됨)**: 결과는 화면에서 **"찾은 기억 · 반영 안 됨"**으로 명시. **검색만으로는
  memory.promoted가 생기지 않는다(찾음 ≠ 반영).** 반영은 명시 admit만 — `POST /search/admit {statement, source}`이
  `promote(userConfirmed:true)`(admission)를 태워 promoted로. 반영 후에만 관련 대화의 admittedContext에 좁게 입장.
  중복 반영 방지(already). UI: `🔍 기억 찾기` 패널, `반영하기`→`반영됨`(호박→초록) 전환.
- **반영 되돌리기(P6-18 Slice-4, 구현됨)**: **"반영하기"가 있는 검색/기억 표면은 동일 수준의 되돌리기를
  제공한다.** `POST /memory/rollback {candidateId}`가 promoted에서 제거 → **rollback 후 promoted/admittedContext
  영향이 반드시 제거된다**(다음 턴부터 안 쓰임). rollbackable=false(고정 원칙)는 거부, 실제 제거 여부는
  `rolledBack`으로 반환. **화면=실제 일치 보장**: `/search/admit`은 신규·중복(already) 모두 되돌리기용
  `candidateId`를 반환하고, UI는 candidateId가 있을 때만 "반영됨"으로 전환한다(반영↔되돌리기 대칭 — 감사 blocker
  수정). 검색 카드는 반영됨↔되돌리기 토글, overview "반영 중"에도 되돌리기(추정은 여전히 읽기 전용).
- **후속**: 반영된 recalled_context를 §6.19 overview "반영 중"에 함께 표면화(현재 선호만) · 의미 검색(임베딩)·랭킹.

### 6.17 SkillCandidate Lifecycle (P6-17 Slice-2, 구현됨 — 추천 ≠ 실행/승격)

근거: Hermes skill loop 흡수(복제 아님, T5 권한·replay·admission 구조로 재구성), 헌법 §3-2·§3-6(권한 우회 금지),
§6.10 DefaultTarget. P6-17 학습 루프 두 번째 조각 — §6.10의 암묵적 trace→propose→replay→promote를 **명시적
상태 기계**로 일반화. 표면(P6-18) 전에 상태 계약을 세운다.

- 상태: `detected → candidate → replay_required → approved → admitted | rejected`(`SKILL_STATES`).
- **절대 경계(코드가 강제)**:
  - **스킬은 자동 실행 권한이 없다.** `canAutoExecute()`=**언제나 false**. admitted 스킬이라도 외부 행동은
    그대로 AuthorityGrant(A2, §6.14). 스킬은 계획·추천에 영향을 줄 뿐 스스로 외부로 나가지 않는다.
  - **replay 통과 + 사용자 확인 전 영향 0.** `canInfluence`=`state==='admitted' && userConfirmed && replayPassed`.
  - **"추천" ≠ "설치/승격".** detected/candidate는 관찰, admitted만 영향 자격. replay 실패는 **rejected**(영향 0 영구).
- `detectSkillCandidate(traces)`(같은 도구 2회↑ 반복→detected, 결정적) · 전이 `surfaceCandidate`/
  `markReplayRequired`/`approveSkill`(확인+replay 둘 다 필요, 실패→rejected)/`admitSkill`/`rejectSkill` ·
  `replaySkill`(승격 전 기본 구조 확인, 통과가 곧 실행 권한 아님).
- 배선(UI 최소): `skill-store.js`{skills}. `GET /skills`·`POST /skills/detect`(반복 신호→candidate, 중복 미제안)·
  `/skills/:id/approve`(→admitted, replay 실패→rejected)·`/skills/:id/reject`. turn 핫패스 불변.
- **후속**: 스킬 실행 시 각 외부 단계가 AuthorityGrant를 타는지 통합 검증 ·
  **P6-18에서 "추천된 스킬"↔"활성화된 스킬" 반드시 구분**(추천 카드를 "이미 설치/작동"으로 오해 금지 — T3식 메뉴 문제 방지).

### 6.18 User Model Separation (P6-17 Slice-3, 구현됨 — 추정 ≠ 승인)

근거: Hermes user model 흡수(복제 아님, T5 admission 구조로 재구성), 헌법 §3-2·§5(라우터가 raw 기억 안 씀),
§5 Context Mesh. P6-17 학습 루프 마지막 조각. 학습에서 가장 위험한 "추정한 것을 승인한 것처럼 다루기"를 막는다.

- **inferred_trait(추정된 성향)은 관찰만 — 영향 0.** admittedContext/TaskContextPacket에 **절대** 안 들어간다.
  **두 겹 방어**: (1) `observed` 레인에만 산다(admittedContext는 `promoted`만 읽는다), (2) `isInfluenceEligible`이
  `inferred_trait`를 **kind로 항상 거부**(tier·userConfirmed와 독립된 불변식 — 레인이 뚫려 promoted에 잘못
  들어가고 userConfirmed까지 켜져도 영향 0).
- **operating_preference(승인된 운영 선호)만** userConfirmed + admission 이후 좁게 입장(관련될 때만). context-mesh
  preference 게이트 재사용(candidates→promoted). **추정을 승인으로 자동 승격하지 않는다** — 사용자가 명시 확인해야.
- `makeInferredTrait`/`makeOperatingPreference`/`confirmOperatingPreference`(promote 재사용)/`projectUserModel`
  (**"추정됨(influence:none)"↔"반영 중(admitted)" 분리 뷰**). `memory-store`에 `observed` 레인 추가.
- 배선(UI 최소): `GET /user-model` · `POST /user-model/traits`(observed) · `/preferences`(candidate) ·
  `/preferences/:id/confirm`(promoted).
- **후속**: 추정 자동 감지·추정→선호 전환 제안(자동 승격 아님) · 프로필/세션별 격리.

### 6.19 Status Overview (P6-18 Slice-1·2, 구현됨 — 조용한 단일 진입점 + 조치, 구분을 구조로)

근거: 헌법 §5.5(안티 대시보드 — 채팅 점유 금지), P6-14~17 감사 후속(누적된 "반드시 구분"). 내부 상태 계약을
먼저 세운 뒤(§6.13~6.18), 사용자가 "지금 무엇이 실제로 반영·가능한지"를 **열 때만 보는 조용한 읽기 전용
요약**으로 통합한다.

- **안티 대시보드**: 상시 패널·폴링 없음. 칩 열 때만 `/overview` 1회 fetch, 닫으면 사라진다. 액션 후 그 자리서 1회 재조회.
- **누적된 "반드시 구분"을 구조에 박는다**(각 항목 두 범주 별도 필드, 안 섞임):
  - 연결: `ready`(실제 받을 수 있음) ↔ `notReady`(연결/로그인 필요) — §6.15 연결≠가능.
  - 스킬: `active`(admitted) ↔ `recommended`(candidate/replay_required) — §6.17 추천≠활성.
  - 선호: `reflected`(admitted 운영 선호) ↔ `inferred`(추정, 영향 0) — §6.18 추정≠반영.
  - 전달: `deliveredCount` ↔ `failed`(다시 보낼 수 있음) — §6.13 실패≠완료.
- `buildOverview(...)`는 **이미 만든 projection 조합만**(신규 상태 invent 없음). `GET /overview?sessionId=` —
  전달은 **세션 스코프(§6.13)**, sessionId 없으면 전달 미노출(유출 방지). UI는 칩 열 때 렌더(on=반영/활성/가능,
  off=추정/추천/필요/실패를 색으로 분리).
- **Slice-2 조치(구현됨)**: 요약에서 바로 조치 — 재전달(`/deliveries/:id/retry`)·스킬 승인(`/skills/:id/approve`)·
  대기 선호 확인(`/user-model/preferences/:id/confirm`). **액션은 기존 게이트 엔드포인트를 그대로 부른다(우회 없음)**
  이고, 항목을 "아직 아님"→"완료"로 옮길 뿐. actionable(추천·대기·실패)만 id를 싣고, **추정(inferred)은 액션 없이
  읽기 전용**(추정→승인 경계 §6.18 유지). preferences는 추정↔대기(pending)↔반영 3분.
- **Slice-5 반영 중 기억 일원화(구현됨)**: 반영된 검색 기억(recalled_context)도 overview "기억 · 반영 중"에
  선호와 함께 표면화하고, **반영 중 기억도 overview에서 같은 수준의 되돌리기를 제공한다**(§6.16 `/memory/rollback`
  재사용, rollback 후 promoted/admitted 영향 제거). overview는 신규 상태를 만들지 않고 promoted의 recalled_context를
  투영만 한다. **반영 중(선호·기억)은 되돌리기 액션이 있어 읽기 전용이 아니다 — 추정만 읽기 전용.**
- **모바일 375px 크럼 회귀 해소(구현됨)**: 크럼(브레드크럼+기억 찾기+준비됨)이 단어 중간에서 꺾이던 회귀를
  nowrap·말줄임 + 모바일 압축(Work Chat+🔍만)으로 수정. overview·검색 패널은 이미 정상. 데스크톱 라벨 불변.
- **후속**: 반영 중 기억 출처(session/title) 표시 · 액션 실패 사용자 언어 표면.

### 6.20 Natural Governance Recovery Surface (P6-19 Slice-1, 구현됨 — 회복 가능한 실패는 같은 턴의 다음 행동으로)

근거: 윤 지시 "부자연스러운 거버넌스가 아니라 사용자 입장에서 아주 자연스러운 거버넌스", P-STAB-1 Model
Timeout, §6.11 Streaming. 내부 안전장치가 사용자에게 아무 말 없이 사라지면 통제는 있어도 경험은 깨진다.

- **계약**: `recoverable_error`는 개발자 오류 표시가 아니라 사용자 회복 안내다. trace는 진행 상태이고,
  회복 안내는 같은 턴 박스에 남는 사용자 언어 메시지다.
- **구현**: Work Chat `streamTurn()`이 `recoverable_error` payload를 보관하고, `complete` 시 `submit()`이
  `renderRecovery()`로 `text`와 `nextSafeAction`을 보여 준다. 정상 complete는 기존처럼 지속된 assistant 결과를 렌더한다.
- **경계**: 회복 안내는 성공·완료처럼 보이면 안 된다. 내부 오류 원문·스택·provider 진단을 화면에 노출하지 않는다.
- **후속**: POST `/turn` 모델 타임아웃도 500 대신 사용자 언어 recovery JSON으로 표면화 · recovery를 overview 최근 막힘으로
  요약할지 검토 · 실 provider AbortSignal 연결.

### 6.21 Stability Guard / Model Response Timeout (P-STAB-1, 구현됨 — 어떤 턴도 무한히 매달리지 않는다)

근거: ②장시간 안정성/스트리밍 내구성(윤 지정), T3 "잘 되다가 갑자기 멈춤" 재발 방지. §6.11 Streaming,
§6.20 Natural Governance(회복 안내가 이 타임아웃의 사용자 표면). **백엔드 안정성 계약** — §6.20(사용자 회복
표면)과 성격이 다른 별도 절.

- **핵심**: `runTurn → model.respond()`가 느리거나 멈추면 턴이 안 닫히고, `withSessionQueue`가 직렬화하므로
  **그 세션의 후속 턴까지 전부 막힌다**(T3 재발 지점). `withModelTimeout(model, ms)`가 respond를 타임아웃과 race해
  **초과 시 `ModelTimeoutError`로 reject** → 기존 오류 경로(stream `recoverable_error+complete`, POST 500)가 턴을
  바운드해 닫고 **큐를 풀어 다음 턴을 살린다.**
- 어떤 ModelClient(스텁·실 provider)든 같은 계약으로 감싼다. `ms<=0`이면 무제한. 타이머 unref+finally clear(누수 없음).
  오류 시 assistant 결과 미기록·미저장이라 half-state 없음(원자적). 스트림 catch는 `isModelTimeout`이면 "응답이
  늦어 잠시 멈췄어요"로.
- 설정: `modelTimeoutMs = deps.modelTimeoutMs ?? GPAO_T5_MODEL_TIMEOUT_MS ?? 30_000`. 모든 `ctx.model` 공통.
- **후속**: 진짜 취소(실 provider AbortSignal을 모델까지 전달해 background orphan promise도 중단) · 재접속 중
  미종료 스트림 re-attach · EventLog 장시간 성장(append O(n)) 상한 · 느린 클라 backpressure · POST 경로 타임아웃 표면.

### 6.22 Model Provider Adapter (P-RT-1, 구현됨 — 실 두뇌 착지, 와이어는 어댑터·정책은 커널)

근거: 오너 지시(2026-07-26, OpenAI OAuth·OpenAI/Claude/Gemini API 키·오픈소스 호환 기본 지원),
`P-RT-1-MODEL-PROVIDER-ADAPTER`. §6.21 위에서 도는 첫 실 런타임. gemini(gemini-flash-latest)·
beai(beai-8.6) 라이브 실측 — evidenceFacts 가 실모델 답변에 반영됨(§11 실증).

- **핵심**: `model-provider.js` 선언형 어댑터가 `ModelClient.respond(tc)` seam 에 실 provider 를 꽂는다.
  6종: anthropic(/v1/messages) · openai·openai_oauth·openai_compatible(/chat/completions) ·
  gemini(:generateContent) · beai(자사 V1, OpenAI-호환). provider별 one-off 금지 — 와이어 스펙만 선언.
- **분류 단일 소스**: 어댑터는 provider 원문 오류를 `authSignal` 로 나를 뿐, 분류는 `classifyModelAuth` 가
  한다(billing≠rate_limit 분리 유지). 분류기가 못 읽는 벤더 고유 표기만 정규 토큰 보강(gemini API_KEY_INVALID).
- **serverside 제약 일반화**: system role 미지원 서버(beai V1 실측)는 `noSystemRole` 플래그로 system 사실을
  user 턴에 합쳐 보낸다(사실 전달 유지, 셰이프만 적응). 호환 서버는 `GPAO_T5_MODEL_NO_SYSTEM_ROLE=1`.
- **타임아웃 진짜 취소(HTTP 구간)**: 어댑터 기본 25s < 서버 30s — 초과 시 AbortController 로 fetch 를
  실제 abort 하고 `ModelTimeoutError` 로 기존 사용자 언어 경로를 탄다(§6.21 후속의 부분 착지).
- **단일 진실 폴백**: 자격 미구성 → StubModelClient + `env.model.id='beai5-stub'`. 구성 → 실 provider +
  실제 모델 id. 화면 표시와 실행 모델이 항상 일치한다.
- **경계 — 구성됨≠검증됨**: `authSignal:'ok'` 는 자격이 구성됐다는 뜻이지 실시간 유효성 검증이 아니다.
  만료·오류 키는 첫 호출에서 잡혀 classifyModelAuth 로 갈린다. 문서·화면은 "선택된 모델=실행 모델"까지만
  주장한다. 자격은 어댑터가 소유하지 않고(env 주입) 승인·안전 바닥 계약 불변, 테스트는 실 API 미호출(fetchImpl).
- **안정성 부수 수정**: `withSessionQueue` 꼬리(tail)가 task 거부를 들고 있어 모델 오류 1건에
  unhandledRejection 으로 프로세스가 죽던 잠복 버그(stub 시절 미노출)를 반대 테스트 동반으로 수정.
- **후속**: P-RT-2 OpenAI OAuth 플로우(로그인/PKCE/refresh/저장) · provider doctor/health-check(구성됨→
  검증됨 상시 승격) · 키 입력·보관 UX · 스트리밍 respond · openai/anthropic 실 키 실측.
  (→ doctor 는 §6.23 으로 착지. OAuth 는 P-RT-3 으로 번호 이월.)

### 6.23 Provider Doctor (P-RT-2, 구현됨 — 구성됨을 검증됨으로, 두 축의 정직한 표시)

근거: §6.22 경계("authSignal:'ok'=구성됨일 뿐"), 윤 판정(doctor 우선), `P-RT-2-PROVIDER-DOCTOR`.
감사 조건부 반려 blocker 2건(B1 준비됨 오표시·B2 원문 유출) 해소 후 병합.

- **핵심**: `model-doctor.js` `checkModelHealth` — provider 의 **과금 없는 모델 목록 GET 하나**로
  ①키 유효성 ②도달성 ③설정 모델의 실제 사용 가능 여부를 실검증. 스펙 선언(modelsEndpoint/listModels)만
  추가(어댑터 일반형 유지), 분류는 classifyModelAuth 단일 소스.
- **상태 언어**: stub / usable / model_missing(+사용 가능 대안 제시, 막다른 답 금지) / auth_failed /
  billing_blocked / rate_limited / unreachable / unverified — 전부 사용자 언어 + 다음 안전 행동.
- **두 축 반영(B1)**: 자격 실패는 `env.model.authSignal`, **readiness 는 별도 `env.model.healthState`**
  (auth 오염 없음) → `buildSelfState.modelHealthState` → `selfStateSummary` → 칩. model_missing/
  unreachable 이면 칩은 "준비됨"이 아니라 **"모델 확인 필요"** + limits "모델 확인 필요: …".
  재검증으로 회복되면 표시도 회복. 라이브 실증: 낡은 모델 구성에서 clarify 턴이
  modelHealthState=model_missing 을 실어 나옴.
- **공개면 위생(B2)**: `authSignal`(provider 원문 진단)은 env 갱신 내부 전용 — `/model/health` 공개
  응답에서 제거(키 조각·내부 문구 유출 방지). 테스트: 원문에 키 문자열을 심어 응답 미포함 확인.
- **표면**: `GET /model/health`(요청 시 재검증) + 부팅 1회 비차단 점검(실패해도 부팅 계속 — 게이트가
  아니라 정직한 표시). doctor 미배선 구성은 stub/unverified — 검증 안 됨을 검증됨처럼 말하지 않는다.
- **후속**: P-RT-3 OpenAI OAuth 플로우 · 키 입력·보관 UX(→ §6.24 로 착지) · overview(§6.19) 모델 상태
  통합 검토 · 주기 재검증(TTL) · 자격 실패 턴의 POST 500 사용자 언어화(§6.20 후속과 합류).

### 6.24 Model Connect UX (P-RT-4, 구현됨 — 화면에서 키 연결, 검증 통과만 저장·활성화)

근거: 오너 지시 잔여분(연결 UX)·연결 전략(개발자-떠넘김 금지)·`P-RT-4-MODEL-CONNECT-UX`.
감사 조건부 반려 blocker 2건(B1 권한·B2 부팅 순서) 해소 후 병합.

- **핵심**: `model-connection.js` 관리자 — 활성 우선순위 **저장된 사용자 연결 > env(개발자) > stub**,
  respond 는 현재 client 위임(핫스왑 — 재시작 없이 교체). `POST /model/connect` 는 저장 전에
  doctor(§6.23, 과금 0)로 실검증하고 **usable 만 저장·활성화** — 실패 키는 기존 연결을 깨지 않는다.
- **키 위생**: 저장 파일은 소유자 전용 0600 — **기존 파일 덮어쓰기에서도** 임시 파일→chmod→rename 으로
  보장(B1: writeFile mode 는 생성 시에만 적용, 0644 실측 후 수정). 원본 키는 저장 파일·요청 본문에만
  존재하고 status/connect/health 어떤 응답에도 없다(마스킹 `beai…2790`). authSignal 미노출(§6.23 B2) 유지.
- **부팅 순서(B2)**: 저장 연결 복원(`init`)은 **listen 전에** 끝난다 — 재시작 직후 첫 요청이 stub/env 로
  새는 창 제거. `startLiveServer` 로 부팅을 추출해 순서를 테스트로 고정. 복원 실패는 부팅을 막지 않는다.
- **입력 검증**: provider allowlist + `baseUrl` 은 http/https 만·URL 자격증명 금지(서버가 직접 fetch 하는
  사용자 입력 — 감사 권고).
- **표면**: 칩 패널 "모델 연결" 블록(현재 상태 마스킹·출처, 입력, 연결/해제, 사용자 언어 결과) +
  `GET /model/connection`(마스킹 status)·`POST /model/disconnect`. 안티 대시보드(열 때만).
- **라이브 실증**: env 없이 부팅→연결→즉시 실모델 턴→재시작 첫 응답부터 saved→가짜 키 거부·기존
  유지→해제→stub. 브라우저: 패널 렌더·마스킹 표시·해제 버튼 실클릭.
- **후속**: P-RT-3 OpenAI OAuth(이 표면 위에) · keychain 등 OS 보안 저장소 · 다중 연결 보관·전환 ·
  해제 직후 하단 상태줄 즉시 갱신(현재는 다음 턴에 갱신).

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
