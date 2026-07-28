# GPAO-T5 P-OP Reference Absorption Supplement

Date: 2026-07-28

Status: `mandatory_reference_for_current_and_future_development`
Scope: OpenClaw/Hermes에서 T5가 추가로 흡수할 가치가 있는 운영 원리 정리

이 문서는 OpenClaw와 Hermes를 기능 목록으로 베끼기 위한 문서가 아니다.

T5는 OpenClaw나 Hermes가 되는 것이 아니라, 그들이 검증한 운영 원리를 T5의 정체성 안으로 흡수해야 한다. 기준은 하나다.

> T5는 사용자의 말을 보존하고, 현재 현실을 모델 앞에 정확히 놓고, 안전하게 실행하고, 다음 턴까지 이어가는 Original AI OS다.

따라서 흡수 대상은 채널 수, 대시보드, CLI, 인프라, 브랜드, 경로, 환경변수 구조가 아니다. 흡수 대상은 모델이 현실을 오해하지 않게 만드는 운영 계약이다.

## 0. 확인한 참고 원천

OpenClaw:

- `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20/README.md`
- `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20/VISION.md`
- `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20/docs/agent-runtime-architecture.md`
- `/Users/jyp/Developer/lab_un/openclaw-pure-2026-07-20/docs/openclaw-agent-runtime.md`

Hermes:

- `/Users/jyp/Developer/lab_un/hermes-agent/README.md`
- `/Users/jyp/Developer/lab_un/hermes-agent/docs/session-lifecycle.md`
- `/Users/jyp/Developer/lab_un/hermes-agent/docs/relay-connector-contract.md`
- `/Users/jyp/Developer/lab_un/hermes-agent/docs/chronos-managed-cron-contract.md`
- `/Users/jyp/Developer/lab_un/hermes-agent/hermes-already-has-routines.md`

Existing T5 seals already considered:

- `GPAO-T5-PHASE-5-1-REFERENCE-ABSORPTION-HARDENING-2026-07-24-ko.md`
- `GPAO-T5-TOOL-CONNECTOR-REFERENCE-SEAL-2026-07-25-ko.md`
- `design/P5-B-1B-CONNECTOR-OPERATING-LAYER-2026-07-27-ko.md`

## 1. Non-Negotiable T5 Absorption Rule

OpenClaw에서 배울 것은 넓은 로컬 실행 생태계의 discipline이다.

Hermes에서 배울 것은 세션, 표면, 배송, 예약, 회복이 끊기지 않는 운영 discipline이다.
T5는 그것들을 기능으로 복사하지 않고, 말귀와 실행 신뢰도를 높이는 내부 계약으로 재해석한다.

개발 담당자는 새 기능을 제안하기 전에 반드시 다음 질문을 통과해야 한다.

1. 이 흡수는 T5가 사용자의 말을 더 정확히 이어받게 하는가?
2. 이 흡수는 모델 앞 현실을 더 정확히 만드는가?
3. 이 흡수는 실제 실행 가능 여부, 권한, 위험, 실패, 복구를 더 잘 드러내는가?
4. 이 흡수는 사용자가 기능 목록을 배워야 하는 부담을 줄이는가?
5. 이 흡수는 OpenClaw/Hermes의 형태가 아니라 T5의 OS 정체성으로 번역되었는가?

하나라도 아니면 현재 P-OP에 넣지 않는다.

## 2. Absorb From OpenClaw: OperatorRealitySnapshot

### Source

OpenClaw `agent-runtime-architecture.md`의 runtime generation / published runtime snapshot 개념.

### What To Absorb

모델, 인증, 도구 카탈로그, 핸들러 준비 상태, 연결 상태가 반쯤 갱신된 채 모델에게 노출되지 않도록, 현재 모델이 볼 수 있는 현실을 하나의 세대로 고정하는 원리.

T5 이름:

- `OperatorRealitySnapshot`
- 또는 내부 구현명 `RealityGeneration`

### Why T5 Needs It

T5의 핵심은 모델이 판단하기 전에 정확한 현실을 놓아주는 것이다. 연결 상태, 도구 목록, 승인 상태, 핸들러 준비 여부가 따로 움직이면 모델은 호출할 수 없는 도구를 가능한 것으로 오해한다. 이것은 T5의 말귀, 실행 신뢰도, 다음 턴 승계를 동시에 무너뜨린다.

### How To Work

P-OP-1과 P-OP-3에 우선 반영한다.

필수 작업:

- `selfState`, connector profile, tool descriptor, approval grant, handler readiness를 하나의 읽기 전용 snapshot으로 묶는다.
- snapshot에는 최소한 `generationId`, `createdAt`, `availableTools`, `connectedSurfaces`, `approvalGrants`, `blockedReasons`가 있어야 한다.
- 모델에게 공개되는 도구/연결 현실은 항상 이 snapshot에서만 나온다.
- 인증 중, 연결 중, schema 없음, handler 없음, approval 없음, plugin disabled 상태는 "사용 가능"으로 노출하지 않는다.
- snapshot generation이 바뀌기 전까지 이전 현실과 새 현실을 섞어 모델에게 주지 않는다.

필수 테스트:

- 도구가 snapshot에 보이면 실제 handler/schema/approval 조건이 모두 충족되어야 한다.
- connector 상태 변경 후 generation이 증가해야 한다.
- 반쯤 연결된 connector는 모델-visible tool list에 올라오면 안 된다.
- stale snapshot이 최신 partially-built 상태보다 우선 노출되면 안 된다.

## 3. Absorb From Hermes: ConversationLane

### Source

Hermes `session-lifecycle.md`의 `SessionSource`, `SessionEntry`, `resume_pending`, `suspended`, session key discriminator, thread/user/channel isolation.

### What To Absorb

메시지가 어디서 왔고, 어느 사용자/채널/스레드/작업 흐름에 속하며, 이어받아야 하는지 새로 시작해야 하는지를 판정하는 세션 운영 원리.

T5 이름:

- `ConversationLane`
- 또는 작업 중심 구현명 `ActiveWorkLane`

### Why T5 Needs It

T5 사용자는 "아까 그거", "이어서", "그 사람한테 보내", "방금 파일 기준으로"라고 말한다. 이 말귀는 단순 chat history로 해결되지 않는다. 현재 발화가 어느 작업 흐름에 붙어 있는지, 어떤 표면에서 온 것인지, 어떤 범위까지 참조 가능한지를 알아야 한다.

### How To Work

P-OP-2에 우선 반영한다.

필수 작업:

- 입력마다 `source`, `user`, `surface`, `thread`, `project`, `activeTask`, `privacyScope`를 가진 lane을 계산한다.
- Hermes의 상태명을 그대로 복사하지 말고 T5식으로 단순화한다: `fresh`, `active`, `resume_pending`, `suspended`, `expired`.
- 이어가기 가능한 작업과 새로 시작해야 하는 작업을 분리한다.
- 개인 대화, 그룹 대화, 채널, 외부 표면이 섞일 때 사용자 단위와 thread 단위 격리를 지킨다.
- 모델에게는 기술 필드가 아니라 "현재 이어받는 작업", "참조 가능한 직전 맥락", "주의할 범위"로 압축해 전달한다.

필수 테스트:

- "아까 그거"가 올바른 lane을 찾는다.
- 같은 채널 안의 다른 사용자 맥락이 섞이지 않는다.
- suspended lane은 자동 이어받지 않는다.
- resume_pending lane은 새 세션으로 잘못 리셋되지 않는다.
- expired lane은 사용자에게 자연스럽게 재확인한다.

## 4. Absorb From Hermes: SurfaceCapabilityDescriptor

### Source

Hermes `relay-connector-contract.md`의 `CapabilityDescriptor`.

### What To Absorb

각 외부 표면이나 connector가 무엇을 할 수 있는지 선언하는 계약. 예: 답장, 편집, 스레드, 길이 제한, 마크다운 방언, 컨텍스트 전달, draft streaming.

T5 이름:

- `SurfaceCapabilityDescriptor`

### Why T5 Needs It

T5가 외부 채널, 문서, 이메일, 브라우저, 로컬 앱과 연결될수록 모델은 "이 표면에서 가능한 행동"을 알아야 한다. 불가능한 편집, 너무 긴 메시지, 지원하지 않는 포맷을 시도하면 사용자 경험이 깨지고 ledger도 더러워진다.

### How To Work

P-OP-3과 P-OP-6에 반영한다.

필수 작업:

- 각 connector/surface가 최소 capability를 선언한다.
- 초기 필드는 `canSend`, `canEdit`, `canReply`, `supportsThread`, `maxLength`, `format`, `requiresApproval`, `contextMode`로 제한한다.
- tool admission은 capability와 handler/schema가 동시에 준비되어야 통과한다.
- 모델에게는 "이 채널에서는 짧은 답장만 가능", "이 표면은 편집 불가"처럼 자연어로 압축해 전달한다.
- capability는 UI 장식이 아니라 실행 가능성 계약이어야 한다.

필수 테스트:

- 길이 제한을 넘는 메시지는 실행 전에 축약/분할/확인을 거친다.
- 편집 불가 표면에서는 edit action을 제안하지 않는다.
- thread 미지원 표면에서는 thread reply를 시도하지 않는다.
- capability는 tool descriptor와 snapshot에 함께 반영된다.

## 5. Absorb From Hermes: Delivery Ledger Recovery Discipline

### Source

Hermes `relay-connector-contract.md`의 delivery state, retry, dead-target handling, recovered marker.

### What To Absorb

외부 전달이나 실행이 `pending -> attempting -> delivered/failed -> abandoned`로 이동하고, 실패 후 복구되었는지까지 남기는 배송/실행 원장 discipline.

T5 이름:

- 기존 `ToolReceipt`와 `TruthLedger`를 유지한다.
- 외부 전달 계층에는 `DeliveryLedger` 또는 `DeliveryReceipt`를 둔다.

### Why T5 Needs It

T5는 "했다"가 아니라 "어디까지 됐고, 무엇이 실패했고, 복구됐는지"를 알아야 한다. 특히 외부 발송, 파일 쓰기, 예약 실행, API 호출은 실패와 회복이 정상 흐름이다.

### How To Work

P-OP-4에 반영한다.

필수 작업:

- ToolReceipt와 DeliveryLedger를 연결하되 같은 것으로 뭉개지 않는다.
- 실패 원인을 `temporary`, `permanent`, `needs_user`, `cancelled`로 분류한다.
- 같은 대상이 반복 실패하면 자동 재시도를 멈추고 사용자에게 쉬운 말로 보고한다.
- 복구된 항목에는 `recoveredFrom` 또는 `recoveredAt`을 남긴다.
- 모델에게는 "전송 실패 후 재시도 성공", "대상이 죽어서 멈춤", "사용자 재연결 필요"처럼 판단 가능한 현실로 제공한다.

필수 테스트:

- temporary failure는 정책 안에서 재시도한다.
- permanent failure는 반복 시도를 멈춘다.
- recovered marker가 다음 턴에 보존된다.
- cancelled는 실패와 구분된다.

## 6. Absorb From Hermes: Automation Wake Contract

### Source

Hermes `chronos-managed-cron-contract.md`의 one-shot cron, claim, re-arm, reconcile, at-most-once semantics.

### What To Absorb

예약 작업을 "항상 켜진 크론"으로만 보지 않고, 다음 실행 하나를 명확히 걸고, 실행 시점에 claim하고, 완료 후 다시 arm하며, 재시작 후 reconcile하는 원리.

T5 이름:

- `AutomationWakeContract`

### Why T5 Needs It

T5가 리마인더, 정기 보고, 후속 확인, 외부 메시지 발송을 하려면 중복 실행과 유실을 막아야 한다. "한 번만 실행되어야 하는 일"과 "반복되어야 하는 일"을 명확히 다뤄야 한다.

### How To Work

P-OP-4 이후 또는 automation 확장 시점에 반영한다. 현재 core live proof보다 앞서 대규모 자동화 인프라를 만들지 않는다.

필수 작업:

- job에 `nextFireAt`, `claimedAt`, `completedAt`, `rearmPolicy`를 둔다.
- 실행 전 claim을 먼저 하고 claim 실패 시 중복 실행을 막는다.
- 앱 재시작 후 reconcile 단계에서 missed, duplicate, stale wake를 점검한다.
- 외부 인프라나 NAS 구조는 복사하지 않는다.

필수 테스트:

- 동시에 두 실행자가 같은 job을 실행하지 못한다.
- 재시작 후 지나간 job을 정책대로 처리한다.
- recurring job은 완료 후 다음 wake를 다시 만든다.
- one-shot job은 완료 후 재무장되지 않는다.

## 7. Absorb From OpenClaw: Doctor / Repair Narrative

### Source

OpenClaw `openclaw-agent-runtime.md`의 doctor, state reset, auth/config/runtime inspection.

### What To Absorb

설정, 인증, 상태, 런타임 문제를 진단하고 복구하는 흐름. 단, T5는 터미널 중심 doctor가 아니라 사용자 언어의 복구 narrative로 번역해야 한다.

T5 이름:

- `RepairFinding`
- `RepairNarrative`

### Why T5 Needs It

T5 사용자는 연결이 깨졌을 때 로그를 읽고 싶어 하지 않는다. "왜 안 되는지", "내가 눌러야 하는지", "T5가 스스로 고칠 수 있는지"를 알고 싶어 한다. 내부 진단과 사용자 설명을 분리해야 한다.

### How To Work

P-OP-3 discovery와 P-OP-4 recovery에 반영한다.

필수 작업:

- connector/tool failure에서 internal diagnostic과 user-facing repair summary를 분리한다.
- 자동 복구 가능, 사용자 승인 필요, 외부 서비스 문제, 설정 누락을 구분한다.
- 사용자에게는 짧고 자연스러운 복구 문장을 제공한다.
- 내부에는 원인, 시도한 복구, 다음 재시도 조건을 남긴다.

필수 테스트:

- 인증 만료는 기술 로그가 아니라 재연결 요청으로 설명된다.
- handler 없음은 "연결됨"으로 표시되지 않는다.
- 자동 복구 성공 시 recovered marker가 남는다.
- 사용자 조치가 필요한 문제는 A2/A3 경계를 통과한다.

## 8. Absorb From Hermes: Scope Isolation

### Source

Hermes README의 profiles, workspaces, skills/memories migration, remote execution boundary.

### What To Absorb

사용자, 프로젝트, 작업 환경, 기억, 연결, 예약, receipt를 섞지 않는 scope isolation 원리.

T5 이름:

- `ScopeRef`

### Why T5 Needs It

개인 AI OS에서 기억, 연결, 세션, 예약, 작업 흔적이 섞이면 위험하다. 특히 외부 발송과 자동화가 들어오면 "누구의 기억인지", "어느 프로젝트의 연결인지", "어느 권한인지"가 명확해야 한다.

### How To Work

P-OP-5와 channel/automation 확장 전에 기준을 확정한다.

필수 작업:

- workspace/project/profile scope를 명시한다.
- memory, connector, job, receipt, lane이 scope를 갖게 한다.
- 다른 scope의 정보는 기본적으로 모델 컨텍스트에 올라오지 않게 한다.
- cross-scope 참조는 사용자 승인 또는 명시적 전환을 요구한다.

필수 테스트:

- 다른 프로젝트 memory가 현재 task context에 섞이지 않는다.
- 다른 profile connector가 현재 user action에 사용되지 않는다.
- scope 전환은 ledger에 남는다.

## 9. Do Not Absorb

아래 항목은 현재 T5 개발에 직접 흡수하지 않는다.

- OpenClaw의 40-route control UI/dashboard 구조
- OpenClaw의 전체 채널 목록을 목표로 삼는 개발 방식
- OpenClaw/Hermes의 branding, paths, env/config schema
- Hermes의 전체 TUI/CLI 운영 방식
- Hermes의 NAS/Relay 인프라 전체
- 서비스별 connector 구현을 T5 core에 직접 붙이는 방식
- 자동 memory creation / 자동 skill creation을 기본값으로 두는 방식
- 개발자용 로그와 사용자 설명을 섞는 방식
- "기능이 있으니 T5도 있어야 한다"는 feature parity식 판단

T5는 기능 수 경쟁을 하지 않는다. T5는 사용자가 자연스럽게 말했을 때 정확한 현실, 가능한 손발, 안전한 실행, 다음 턴 승계를 제공하는 OS다.

## 10. Current Development Mapping

P-OP-1:

- `OperatorRealitySnapshot`
- reality generation
- tool/connector/model visibility must be atomic

P-OP-2:

- `ConversationLane`
- active work continuity
- resume/suspend/expired handling

P-OP-3:

- `SurfaceCapabilityDescriptor`
- generic discovery evidence
- connector readiness and repair finding

P-OP-4:

- Delivery recovery discipline
- claim/retry/recovered/cancelled state
- later: `AutomationWakeContract`

P-OP-5:

- Scope-aware memory/growth
- no automatic durable memory without admission

P-OP-6:

- Surface capability as hidden operating reality
- no dashboard-first drift

P-OP-7:

- provider/runtime reality generation
- provider-specific details isolated behind model profile

## 11. Recommended Immediate Work Order

Do these three first, and do not expand the absorption list until they have scenario evidence.

1. Add `OperatorRealitySnapshot`.
2. Add `ConversationLane`.
3. Add `SurfaceCapabilityDescriptor`.

Each must include:

- a contract/type,
- a builder or resolver,
- at least one failure-first scenario test,
- an update path into the model context packet,
- and a user-language summary path.

Completion claim is not valid if the code only stores the data but the model-facing reality, action planning, ledger, and next-turn continuity do not use it.

## 12. Final Decision

OpenClaw에서 흡수할 것은 "반쪽 현실을 모델에게 공개하지 않는 runtime discipline"이다.

Hermes에서 흡수할 것은 "세션, 표면, 배송, 예약, 회복이 끊기지 않는 operating discipline"이다.

T5에서 구현할 것은 그 둘의 복제물이 아니라 다음 세 계약이다.

1. `OperatorRealitySnapshot`
2. `ConversationLane`
3. `SurfaceCapabilityDescriptor`

이 세 계약은 현재 개발과 이후 개발 모두에서 스쳐 지나가면 안 되는 핵심 참고 기준이다.
