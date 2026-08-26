# T5 3차 완성 — Life Continuity & Memory Stewardship 최종 개발 계획

상태: `OWNER_ACTIVATED_S3M · M0_COMPLETE · M1_NOT_OPEN`

현재 공식 Release Gate:
`SECOND COMPLETION COMPLETE · 0.2.1 UNSIGNED PACKAGE QUALIFIED · SIGNING EXTERNAL BLOCKER`

이 문서는 현재 Release Gate를 변경하지 않는다. 제품 정의는 `T5-PRODUCT.md`, 현재 2차 완료선은
`T5-SECOND-COMPLETION.md`, 3차 활성화·금지선은 `T5-THIRD-ACTIVATION-PREPARATION.md`, 작업 규율은
`AGENTS.md`가 우선한다. 오너는 2026-08-26 Terminal `PASS WITH OBSERVATION` exact close
`9c96d9fbc2db9e950ebc4cb73ff5653fa55d35fb`를 채택하고 Life Continuity 착수를 선언했다. M0는 제품 Memory
변경 0인 사고 헌법·fixture 단계로 활성화하며 이후 Gate는 이 문서의 순서를 따른다.

---

## 0. 제품 한 문장

> 사용자가 여러 해 동안 일상·일·사업·연구를 T5와 이어가도 T5는 실제 기록·현재 사실·과거 사실·결정·
> 추론·경험·방법을 혼동하지 않는다. 사용자는 평소 말로 무엇을 기억하는지 확인하고 고치고 잊을 수 있으며,
> T5는 현재 목적에 필요한 출처 있는 기억만 작게 되살려 더 적은 설명과 교정으로 실제 일을 끝낸다.

최상위 합격식:

```text
원본 기록의 진실성
× 시간·교정의 정확성
× 현재 목적에 맞는 recall·organization
× 검증된 Reflection·Principle·Skill
× 사용자 소유권·망각·이동성
× macOS·Windows 실제 제품 자격
× 목적당 속도·비용·안정성
```

기능 수, 저장량, Memory entry 수, graph node 수, embedding 수, benchmark retrieval 점수 하나는 제품 완료가
아니다.

---

## 1. 구현 시작 전 일곱 줄

1. **제품 약속** — 사용자는 기억 시스템을 배우지 않고 평소 말로 기록·확인·교정·망각·회고한다.
2. **공식 Gate** — 2차 Release Gate는 변경하지 않는다. Life Continuity는 Terminal exact close 뒤 별도
   3차 작업으로만 활성화한다.
3. **사용자 완료 문장** — 위 제품 한 문장 전체다. 특정 Memory tool이나 Wiki 생성은 완료가 아니다.
4. **이미 선 실제 증거** — Conversation·Run·Work·Memory·Authority·Automation append-only truth,
   ContextReceipt, source-linked user/work Memory, Episode pointer, current correction 우선, Learning 제안·시험·
   Pareto·rollback, Terminal exact execution·output recall 기반이 있다.
5. **현재 가장 큰 미달** — 현재 Memory는 `user|work`의 작은 현재값과 Episode pointer 중심이다. 원본 Record의
   공통 provenance, valid time, 지식·Reflection·Principle 층, forgetting cascade, human-readable Living
   Library, macOS·Windows 이동 자격이 없다.
6. **이번 개발이 미달을 줄이는 방식** — 기존 정본을 대체하지 않고 pointer·시간·scope·민감도 shadow부터
   추가하며, 실제 사용자 실패가 증명한 최소 책임만 승격한다.
7. **비목표** — 만능 Memory DB, fixed persona, 모든 화면 자동 기록, vector-only retrieval, graph-first 설계,
   상시 selector/reranker/reflection 모델, cloud canonical, Linux 제품, 기존 Memory·Episode·Learning 재창립.

일곱 줄을 Git·실행·evidence에서 확인하지 못하면 코드를 시작하지 않는다.

---

## 2. 착수 선행 조건

아래가 모두 성립해야 M0 구현을 시작한다.

```text
Terminal exact close commit `9c96d9fbc2db9e950ebc4cb73ff5653fa55d35fb` 존재
AND macOS Terminal human qualification terminal
AND Windows GitHub runner PASS
AND Terminal 남은 effect/output/retention blocker가 명시적으로 닫히거나 오너 제외
AND current product worktree에 다른 제품 변경 0
AND npm run refoundation:ci PASS 또는 오너가 수용한 unrelated known observation은 focused 재실행 PASS·
    product integration PASS·mutation killed로 분리
AND 오너가 S3-M 착수를 명시
```

오너가 Terminal 완료 범위 밖 관측으로 남긴 physical Windows UI Terra·gpt-5.5, Windows sandbox-first,
ARM64 실제 실행, signed installer는 M0 blocker가 아니다. 공통 Windows 제품 개통은 S3-PW가, Life Continuity
Windows Memory 자격은 M7이 각각 소유한다. 이 관측을 Terminal 재개나 Memory 우회 patch의 근거로 사용하지
않는다.

### 2026-08-26 실제 착수 기록

```text
source: 9c96d9fbc2db9e950ebc4cb73ff5653fa55d35fb
Terminal verdict: PASS WITH OBSERVATION
core first full attempt: 961 passed · 1 failed · 1 skipped / 963
unrelated known observation: QH-3 temporary directory ENOTEMPTY
QH-3 focused rerun: 2/2 passed
product integration: 144 passed · 0 failed · 1 skipped / 145
mutation: 2/2 killed
product source changes before M0: 0
```

위 core failure는 오너의 Terminal 완료 보고에 이미 기록된 알려진 임시 디렉터리 cleanup 변동과 같은 가족이다.
M0는 이를 숨기지 않고 evidence에 남기되 Memory 제품 source를 고쳐 초록으로 만들지 않는다.

### 2026-08-26 M0 완료 판정

```text
제품 source 변경: 0
사고 가족: 15/15 fixture 고정
현재 기준선: PASS 4 · GAP 7 · PARTIAL 2 · NOT_OPEN 2
절대 불변식: 8개 구현 전 헌법으로 고정
실데이터·실계정·raw secret 사용: 0
M1 제품 구현: 열지 않음
```

M0의 GAP은 실패를 숨기지 않는 현재 제품 기준선이다. GAP을 통과로 바꾸기 위한 Memory 구현은 M0에 넣지
않았고, 각 결함 가족은 manifest의 `ownerStage`가 가리키는 이후 Gate에서 반대시험으로 소비한다. M1은 오너가
M0 evidence를 확인한 뒤 `RecordRef` 한 책임만 다음 작업으로 열 때까지 시작하지 않는다.

착수 commit에서 다음을 evidence에 기록한다.

```text
source commit
Node·OS·architecture
macOS·Windows Terminal close evidence identity
core·integration·mutation counts
MemoryLedger·WorkStore·ConversationLedger·Learning source digests
dirty path 목록과 제외 이유
현재 Memory 실제 모델 기준선
```

---

## 3. 비교군 연구 봉인

관측 기준: 2026-08-26.

| 비교군 | 관측 source | 채택 | 가져오지 않음 |
|---|---|---|---|
| OpenClaw `f6c15df3` | memory tiers·provenance·Active Memory·Dreaming·Memory Wiki | curated/episodic/review 분리, untrusted quarantine, deterministic recall 우선, 어려운 질문만 deep recall, human review diary | fixed scoring을 의미 진실로 사용, default-on promotion, imperative USER persona, 설정 중심 UX, 검증되지 않은 rewrite race |
| Hermes `86ae906e` | USER/MEMORY/SOUL, MemoryManager, provider lifecycle | unreadable≠empty, write approval, fail-open provider, background sync/prefetch, 한 외부 provider만 허용 | fixed char cap, session frozen stale snapshot, provider별 진실 분산, recalled block 전체 authoritative 취급 |
| Claude Code `005c5dad` | CLAUDE.md·per-repo auto-memory·topic files·`/memory` | plain Markdown, 작은 index+topic file, 사용자 inspect/edit/delete, path scope, on-demand detail | repo identity를 사람 identity로 확대, bootstrap 200줄을 제품 진실로 사용, coding instruction과 개인 Memory 혼합 |
| Codex local `0.148.0-alpha.9` + OpenAI Docs | rollout·thread·resume/fork·opaque compaction | exact session/Run identity, provider compaction을 accelerator로 사용, paginated history | opaque compaction을 inspectable Memory로 승격, provider state를 canonical truth로 사용, coding session을 Life Episode로 일반화 |

각 Gate 시작 전에 해당 책임의 최신 source만 다시 확인한다. 비교군 source 변화만으로 T5 계약을 자동 변경하지
않는다.

---

## 4. 현재 T5에서 보존할 정본과 책임

### 4.1 보존하는 기존 정본

| 정본 | 현재 책임 | Life Continuity에서 추가하지 않는 책임 |
|---|---|---|
| ConversationLedger | 사용자·assistant·tool 원문 사건 | Memory 의미 선택 |
| RunLedger | model·tool·effect·surface 사건 | 사용자 목적의 장기 사실 저장 |
| WorkStore | Work identity·revision·input·completion·result publication | 사용자 persona |
| MemoryLedger | source-linked 현재 user/work 사실·선호·결정 | 원문 archive·Reflection·Skill |
| AuthorityStore | 승인·위임·소비 | 기억 중요도 |
| AutomationStore | schedule·occurrence·delivery | 과거 사건 memory |
| AttachmentStore | file identity·hash·ownership | 지식 주장 |
| ResourceLedger | 시간·token·request·cost·scope accounting | 의미 기반 recall 선택 |
| Learning lifecycle | Episode→candidate→replay→field→promotion→rollback | 사용자 사실·persona |

기존 정본을 복사하는 새 store를 만들지 않는다.

### 4.2 새로 명명하는 층

새 층은 곧 새 DB를 뜻하지 않는다. M0~M1 shadow에서 기존 정본 pointer로 표현 가능한지 먼저 증명한다.

```text
RecordRef:
실제 원본으로 돌아가는 공통 pointer

MemoryClaim:
현재 또는 과거에 유효한 사용자 사실·선호·결정

KnowledgeClaim:
출처 있는 외부·연구·업무 주장과 반대 근거

ReflectionCandidate:
여러 Episode에서 만든 잠정적 해석

PrincipleCandidate:
독립 상황·반대시험·field benefit을 기다리는 일반 원리 후보

LivingLibraryView:
정본에서 생성한 사람이 읽는 파생 view

UserNote:
사용자가 직접 작성·수정한 원본 문서
```

---

## 5. 데이터 계약 후보

아래 schema는 구현 전 계약 test의 기준이다. 저장 engine 선택을 뜻하지 않는다.

### 5.1 RecordRef

```ts
type RecordRef = {
  recordId: string
  sourceKind:
    | "conversation_message" | "run_event" | "work_event"
    | "attachment" | "artifact" | "local_file"
    | "web_source" | "connection_resource" | "channel_message"
    | "calendar_item" | "reminder_item" | "user_note"
  sourceStore: string
  sourceId: string
  sourceRevision: string | number | null
  sha256: string | null
  occurredAt: string | null
  recordedAt: string
  scope: {
    sessionId: string | null
    workId: string | null
    subjectKeys: string[]
    channel: string | null
  }
  trust:
    | "user_asserted" | "runtime_observed" | "verified_external"
    | "external_untrusted" | "model_inferred"
  sensitivity: "normal" | "personal" | "private" | "secret_ref" | "never_store"
  coverage: "full" | "partial" | "metadata_only" | "unknown"
  availability: "available" | "missing" | "changed" | "permission_denied" | "unknown"
}
```

불변식:

- `sourceKind+sourceStore+sourceId+sourceRevision`은 stable identity다.
- `sha256=null`은 hash 0이나 미변경을 뜻하지 않는다.
- `model_inferred` RecordRef는 MemoryClaim의 유일한 source가 될 수 없다.
- secret 원문은 RecordRef에 들어가지 않고 OS secret reference만 가진다.
- RecordRef는 원본 내용을 복제하지 않는다.

### 5.2 MemoryClaim

```ts
type MemoryClaim = {
  memoryId: string
  kind: "fact" | "preference" | "decision"
  subjectKey: string
  value: string
  scope: {
    global: boolean
    workId: string | null
    projectId: string | null
    personId: string | null
    organizationId: string | null
  }
  sources: RecordRef[]
  recordedAt: string
  validFrom: string | null
  validTo: string | null
  subjectRevision: number
  sourceOrder: number
  status: "active" | "superseded" | "retracted" | "disputed"
  supersedes: string[]
  conflictsWith: string[]
  sensitivity: RecordRef["sensitivity"]
  alwaysRelevant: boolean
}
```

#### MemoryClaim 저작 책임과 최소 model payload

Terminal T3의 effect 계약과 같은 원칙을 적용한다. 모델이 runtime이 이미 아는 필드를 다시 작성하지 않는다.

모델이 제안하는 의미 최소값:

```ts
type MemoryMeaningProposal = {
  action: "remember" | "correct" | "retract"
  kind: "fact" | "preference" | "decision"
  value: string
  subjectHandle: string | null
  validTimeMeaning: {
    from: string | null
    to: string | null
    certainty: "explicit" | "inferred" | "unknown"
  }
  scopeMeaning: "global" | "current_work" | "project" | "person" | "organization"
}
```

runtime이 현재 현실에서 파생·검증하는 값:

| 필드 | 소유자·근거 |
|---|---|
| `memoryId` | runtime identity |
| `sources` | 현재 Conversation·Run·Receipt·attachment의 exact handles |
| `recordedAt` | runtime clock |
| `scope.sessionId/workId/channel` | 현재 admission·Work claim·channel envelope |
| `projectId/personId/organizationId` 후보 | existing verified identity handles; 모델은 opaque handle만 선택 |
| `subjectKey` | 선택한 verified subject handle 또는 새 runtime identity; 모델 자유문자열을 canonical key로 사용하지 않음 |
| `subjectRevision/sourceOrder` | MemoryLedger append order |
| `status/supersedes/conflictsWith` | current projection·CAS·source relation 검증 |
| `sensitivity` floor | source 종류·channel·secret boundary·사용자 설정 |
| `alwaysRelevant` | 기존 explicit user control 또는 별도 자격; 모델 단독 true 금지 |

모델은 source ID·revision·timestamp·다섯 nullable scope ID·sensitivity를 추측해 채우지 않는다. runtime이 만든
candidate handles와 current reality를 보고 의미만 선택한다. 필요한 handle이 없으면 새로운 identity를 발명하지
않고 추가 관측 또는 사용자 확인을 제안한다.

#### Sensitivity fail-closed 기본값

```text
secret field·credential·token·Keychain/DPAPI source
→ never_store 또는 secret_ref

private DM·개인 profile·개인 문서·사람 관계 source
→ 최소 personal

runtime이 분류 근거를 확정하지 못함
→ personal

명시적으로 private로 표시된 source·folder·channel
→ private

normal로 하향
→ 사용자 명시 또는 자격화된 source policy만 허용
```

- sensitivity는 model confidence로 낮추지 않는다.
- `personal|private|secret_ref|never_store`는 Spotlight·Windows Search 자동 노출 금지다.
- OS index 기본 허용은 `normal`만이며 personal은 사용자의 별도 opt-in 뒤에도 source별 scope를 유지한다.
- sensitivity classifier 실패·timeout·unknown은 저장을 열린 `normal`로 낮추지 않는다.
- sensitivity 변경은 revision event와 파생 index delete/rebuild receipt를 가진다.

불변식:

- 현재 교정은 저장된 active Memory보다 현재 Turn Context에서 우선한다.
- `validFrom/validTo=null`은 영구 유효를 뜻하지 않고 unknown이다.
- 같은 subject의 latest는 Work revision 숫자가 아니라 subject revision·source order·현재 교정으로 판정한다.
- status history를 지우지 않고 current projection만 active를 선택한다.
- Reflection·model inference를 `fact|preference|decision`으로 자동 승격하지 않는다.

### 5.3 KnowledgeClaim

```ts
type KnowledgeClaim = {
  claimId: string
  statement: string
  appliesTo: string[]
  sources: RecordRef[]
  supports: string[]
  contradicts: string[]
  unresolved: string[]
  validDuring: { from: string | null; to: string | null }
  confidence: "verified" | "supported" | "contested" | "unknown"
  status: "current" | "superseded" | "withdrawn"
}
```

confidence는 model probability가 아니라 source·coverage·contradiction 상태다.

### 5.4 ReflectionCandidate

```ts
type ReflectionCandidate = {
  reflectionId: string
  hypothesis: string
  sourceEpisodeIds: string[]
  sourceRecordIds: string[]
  counterexampleRecordIds: string[]
  affectedScopes: string[]
  state: "proposed" | "reviewed" | "tested" | "rejected" | "archived"
  createdBy: "main_model" | "background_reviewer"
  userConfirmed: boolean
}
```

Reflection은 MemoryClaim·KnowledgeClaim·persona가 아니다. 기본 model Context에 자동 주입하지 않는다.

### 5.5 PrincipleCandidate

```ts
type PrincipleCandidate = {
  principleId: string
  statement: string
  scope: string[]
  sourceReflectionIds: string[]
  independentEpisodeIds: string[]
  counterexampleIds: string[]
  baselineRunIds: string[]
  candidateRunIds: string[]
  fieldRunIds: string[]
  measuredBenefit: {
    correctness: number | null
    completeness: number | null
    userCorrections: number | null
    wallMs: number | null
    providerTokens: number | null
  }
  state: "candidate" | "replay_qualified" | "field_qualified" | "rejected" | "archived"
}
```

Principle은 현재 Learning lifecycle의 qualification보다 약한 기준으로 Skill을 활성화할 수 없다.

### 5.6 ForgetPlan·ForgetReceipt

```ts
type ForgetPlan = {
  requestId: string
  selector: { memoryIds: string[]; subjectKeys: string[]; scopeIds: string[] }
  targets: Array<{
    kind: "record" | "memory" | "knowledge" | "reflection" | "principle"
      | "skill_candidate" | "fts" | "embedding" | "relationship_index"
      | "library_view" | "spotlight" | "windows_search" | "backup" | "external_copy"
    id: string
    action: "retract" | "delete" | "rebuild" | "unknown"
  }>
  backupAvailable: boolean | null
  previewDigest: string
}

type ForgetReceipt = {
  requestId: string
  executedTargets: string[]
  unknownTargets: string[]
  retainedTargets: Array<{ id: string; reason: string }>
  searchHitAfter: number | null
  contextProjectionAfter: number | null
  behaviorProbeAfter: "pass" | "fail" | "unknown"
  reversibleUntil: string | null
}
```

`ForgetReceipt.success=true` 하나로 합치지 않는다.

---

## 6. Event 계약과 호환성

### 6.1 기본 원칙

- 기존 `t5.memory-event.v1` 전체 rewrite나 in-place migration을 먼저 하지 않는다.
- M1~M2 shadow는 기존 event에서 파생하고 별도 제품 writer를 열지 않는다.
- 승격 시 기존 event에 additive `temporal`·`recordRefs` payload를 추가하는 방식을 먼저 검토한다.
- old reader가 unknown optional field를 무시할 수 있는지 mutation으로 증명한다.
- mixed schema가 필요하면 append-only migration event를 사용하고 파일을 재작성하지 않는다.
- migration 실패는 old canonical을 먼저 지우지 않는다.

### 6.2 후보 event

```text
RecordReferenceObserved
RecordReferenceUnavailable
MemoryClaimProposed
MemoryClaimCommitted
MemoryClaimSuperseded
MemoryClaimRetracted
MemoryConflictRecorded
RecallRequested
RecallCandidatesObserved
RecallSourceReopened
RecallContextProjected
ForgetRequested
ForgetPlanPrepared
ForgetTargetSettled
ForgetVerified
ReflectionProposed
ReflectionReviewed
PrincipleCandidateCreated
PrincipleReplayQualified
PrincipleFieldQualified
PrincipleRejected
LivingLibraryViewPublished
UserNoteRevisionAdmitted
DerivedIndexRebuilt
```

각 event는 content-free Resource scope를 가진다. 원문은 기존 Record에 남긴다.

---

## 7. Model과 Runtime 책임

### 모델

- 사용자 문장의 기억·교정·망각 의미
- 현재 목적에 관련된 subject·scope
- 사실·선호·결정·Knowledge·Reflection 구분 제안
- conflict 해석과 추가 source 필요성
- Reflection hypothesis·counterexample·Principle 의미
- 사용자에게 보여줄 자연어·artifact
- 목적 달성 판단
- `MemoryMeaningProposal`의 action·kind·value·valid-time 의미·scope 의미

### Runtime

- source identity·digest·coverage·availability
- recorded/valid time 형식과 revision
- append order·CAS·ownership
- sensitivity·channel·scope access
- source reopen
- index insert/delete/rebuild
- forget cascade·backup·external copy receipt
- OS secure storage·file ACL·Spotlight·Windows Search
- crash recovery·idempotency·resource accounting
- Memory source·recordedAt·current scope·revision·sensitivity floor 파생

### 금지

- keyword·정규식으로 사용자의 기억 의미 결정
- similarity score로 durable 사실 자동 승격
- recall frequency로 사용자 중요도 확정
- Reflection 문장을 persona로 변환
- runtime이 user answer를 재작성

---

## 8. 사용자 표면 계약

기본 사용자는 Memory tool·tag·folder·vault·embedding을 모른다.

### 8.1 자연어 행동

```text
나에 대해 뭘 기억하고 있어?
이건 어디서 나온 거야?
그건 지금은 틀렸어.
작년에는 어떻게 알고 있었어?
이 프로젝트 기억만 보여줘.
이 고객 관련 기록을 모두 잊어줘.
삭제하면 어디까지 없어져?
내 기록을 표준 형식으로 내보내줘.
최근에 반복된 문제와 근거를 보여줘.
이 원리가 실제로 검증됐는지 알려줘.
```

### 8.2 T5 내 기록

현재 콘솔 디자인을 재사용하며 새 관리 제품으로 재디자인하지 않는다.

```text
내 기록
├─ 최근과 Timeline
├─ 진행 중인 일
├─ 결정과 변경 이유
├─ 사람과 조직
├─ 연구 주장·근거·반대 근거
├─ 생각과 깨달음 후보
├─ 원리와 방법
├─ 기억 확인·교정·망각
└─ 보관·내보내기
```

같은 사실을 대화와 `내 기록`이 서로 다른 state에서 보여주지 않는다.

### 8.3 Living Library

```text
T5 Library/
├─ 시작.html
├─ Views/                # 다시 만들 수 있는 generated view
│  ├─ Timeline/
│  ├─ Projects/
│  ├─ Decisions/
│  ├─ People/
│  └─ Research/
├─ Notes/                # 사용자 원본 Markdown
├─ Attachments/          # managed pointer 또는 export copy
├─ Exports/
└─ .t5/manifest.json     # 비밀 없는 identity·digest·revision
```

- HTML은 Markdown 앱이 없는 기본 사용자 표면이다.
- Markdown은 표준·Obsidian 선택형 표면이다.
- Generated View를 외부에서 수정하면 덮어쓰지 않는다. diff를 UserNote/교정 admission 후보로 만든다.
- UserNote는 T5가 임의 rewrite하지 않는다.
- Obsidian 없음에 따른 기능 손실은 0이다.
- `.obsidian/`은 T5 정본이 아니며 import·backup 기본 범위에서 제외한다.

---

## 9. Recall pipeline

초기 기본 순서:

```text
1. current Work exact projection
2. exact Memory/Record identity lookup
3. current active subject revision
4. lexical FTS
5. temporal·relationship query
6. semantic candidate retrieval
7. exact Record reopen
8. main model relevance·sufficiency
9. bounded Context projection
```

원칙:

- 단계 1~4가 충분하면 embedding·recall model 호출 0.
- temporal/multi-session 질문에서만 deep recall 후보를 연다.
- deep recall은 별도 answer model이 아니라 source 후보를 돌려준다.
- query model·selector·reranker를 상시 실행하지 않는다.
- provider unavailable을 no-memory로 승격하지 않는다.
- FTS·embedding·graph는 derived index이며 source truth가 아니다.
- exact source reopen 없이 factual completion을 만들지 않는다.
- recall 결과는 untrusted data framing을 유지한다.

ContextReceipt에 다음 content-free 항목을 추가할 후보를 측정한다.

```text
memoryCandidates
memoryCandidateBytes
recordRefsReopened
recordBytesObserved
knowledgeClaimsProjected
reflectionCandidatesProjected
recallModelCalls
recallWallMs
indexState
```

---

## 10. 민감도·보안·privacy 계약

### 민감도

| 등급 | 저장 | 자동 recall | OS index | export |
|---|---|---|---|---|
| normal | 허용 | 목적 관련 시 | 사용자 설정에 따라 | 허용 |
| personal | 허용 | private session만 | 기본 off | 명시 범위 |
| private | 암호화·T5 UI | explicit/exact만 | 금지 | 재인증·명시 범위 |
| secret_ref | OS secret reference만 | 본문 없음 | 금지 | secret 제외 |
| never_store | 원문 Memory 저장 금지 | 없음 | 없음 | 없음 |

### memory poisoning

- Web·attachment·tool output은 instruction authority 0.
- provenance는 text parsing이 아니라 runtime field다.
- external_untrusted 단독 source는 curated Memory·Principle로 승격 불가.
- taint는 summary·Reflection·Knowledge 파생에도 전파한다.
- 사용자가 explicit confirm해도 source origin은 바뀌지 않고 confirmation을 별도 기록한다.
- poison text를 trace·Memory·Library에 raw 복제하지 않는다.

### channel·person scope

- private personal Conversation의 Memory를 group/channel에 자동 recall하지 않는다.
- sender·account·workspace identity가 다른 기록을 같은 person으로 자동 merge하지 않는다.
- person merge는 main model proposal+사용자 또는 exact external identity evidence가 필요하다.
- 다른 agent/profile의 memory를 공유 정본으로 자동 승격하지 않는다.

---

## 11. 플랫폼 계약

제품 목표:

```text
macOS + Windows
```

비목표:

```text
Linux 제품
WSL2 제품 구조
```

WSL2는 Windows path·user·credential·lifecycle 반대시험 자료로만 사용한다.

### macOS

- Keychain에는 encryption key·secret reference만 저장한다.
- Memory 본문을 Keychain blob으로 저장하지 않는다.
- Library root ACL·symlink·hardlink·Unicode normalization을 자격한다.
- Spotlight는 normal 또는 사용자가 허용한 personal derived item만 index한다.
- 원본 delete/retract 뒤 Spotlight item delete를 확인한다.
- Calendar·Reminders는 EventKit permission·exact item identity·read-after-write를 사용한다.
- Finder·Quick Look·HTML·Markdown 실제 인간 여정을 통과한다.

### Windows GitHub runner

- path separator·drive·UNC·Unicode·timezone
- PowerShell `-NoProfile`
- append·atomic replace·lock·crash
- FTS/index rebuild
- forgetting cascade fixture
- standard HTML·Markdown export
- x64·arm64 가능한 범위
- macOS 전용 API·path·mode가 Core identity로 새는지 검사

### 격리 Windows VM

- DPAPI·Credential Locker·Windows Hello/사용자 session 경계
- NTFS ACL·symlink/junction·hardlink
- Windows Search add/update/delete/rebuild
- Explorer·HTML·Markdown
- actual T5 UI
- Terra·gpt-5.5
- restart·power-loss simulation
- macOS→Windows export/import 및 source digest
- backup·forget·recovery 인간 여정

GitHub runner만으로 Windows PASS를 주장하지 않는다.

---

## 12. 성능·경제성 계약

목적당 다음을 분리한다.

```text
state read/replay
record source reopen
index query
context compilation
recall model
main model
tool execution
verification
surface publication
background interference
```

절대 고정 수치를 baseline 전에 runtime cap으로 만들지 않는다.

Pareto 합격:

```text
목적 정확성·완전성·복구 무회귀
AND 사용자 설명·교정 감소
AND wall·tokens·request bytes·model calls·user turns 중 하나 이상 우위
AND 다른 measured lane의 큰 열세 없음
AND false memory·false completion 0
```

Background:

- Reflection·index·Library generation은 foreground 도착 시 양보한다.
- quiet boundary를 actual foreground absence로 관측한다.
- 동일 source window 중복 review 0.
- background writer가 foreground canonical revision을 stale overwrite하지 않는다.
- background off/on paired delta를 측정한다.

---

## 13. Gate 실행 계획

### S3-M0 — Memory Incident & Constitution

상태: `FIRST AFTER TERMINAL CLOSE · PRODUCT CHANGE 0`

추가 파일 후보:

```text
refoundation/config/s3-memory-incidents.json
refoundation/test/s3m-memory-constitution.test.js
refoundation/test/s3m-memory-incident-replay.test.js
refoundation/evidence/s3-m0-memory-incident-constitution-<date>.json
```

필수 incident:

1. 사용자가 말하지 않은 추론을 사실로 저장
2. 현재 교정 뒤 stale preference 주입
3. Work A 결정이 Work B에 주입
4. 사람 A와 동명이인 B merge
5. Memory 부재를 과거 사건 부재로 답변
6. source file 변경 뒤 stale digest 사용
7. checkpoint summary가 exact identifier 제거
8. embedding provider 실패를 memory 없음으로 답변
9. external prompt injection이 durable memory로 승격
10. Reflection이 persona로 승격
11. 삭제 뒤 FTS·embedding·Library hit 잔류
12. faster-but-wrong 방법 승격
13. background reviewer가 foreground를 지연
14. macOS export를 Windows에서 다른 identity로 읽음
15. private Memory가 group/channel surface에 노출

완료:

- fixture마다 source·expected truth·실제 실패·owner Gate가 있다.
- content·비밀·개인정보를 저장소에 복제하지 않는다.
- 기존 T5가 통과하는 항목과 미달 항목을 숨기지 않는다.
- 비교군 동일 실패를 source commit에 결속한다.
- 제품 source 변경 0.

### S3-M1 — RecordRef & Provenance Shadow

첫 세 commit 후보:

```text
Commit 1: Add pure RecordRef validation and fixtures
Commit 2: Project existing canonical stores into RecordRef shadow
Commit 3: Reopen exact source and emit content-free accounting
```

파일 후보:

```text
refoundation/src/record-reference.js
refoundation/src/record-projection.js
refoundation/src/record-source-reader.js
refoundation/test/record-reference.test.js
refoundation/test/record-projection.test.js
refoundation/test/record-source-reader.test.js
```

초기 source adapter:

- Conversation message
- Run event
- Work event
- Attachment/artifact
- local managed file
- Web source
- channel message
- connection resource

shadow는 model Context·Memory write·사용자 surface를 바꾸지 않는다.

반대시험:

- missing source
- changed digest
- foreign Session
- partial coverage
- symlink/hardlink
- untrusted source
- provider unavailable
- crash during observation

승격 조건:

- 현재 store pointer만으로 모든 incident를 표현할 수 있으면 새 RecordLedger를 만들지 않는다.
- pointer ownership이 없는 실제 source가 반복 실패할 때만 오너에게 새 canonical 후보를 제안한다.
- same user purpose에서 observer 비용·제품 비개입을 증명한다.

### S3-M2 — Temporal Memory & Conflict

단계:

```text
M2-0 temporal shadow
→ M2-1 main model proposal contract
→ M2-2 additive Memory event promotion
→ M2-3 current Context projection
```

파일 후보:

```text
refoundation/src/temporal-memory.js
refoundation/src/memory-conflict.js
refoundation/test/temporal-memory.test.js
refoundation/test/memory-conflict.test.js
refoundation/test/memory-current-state.integration.js 확장
```

반대시험:

- recordedAt latest지만 valid time은 과거
- retroactive correction
- validTo unknown
- current user correction vs stored active
- same subject·different scope
- same Work revision number·different subject revision
- contested source
- timezone·DST
- model switch·restart

Terra·gpt-5.5 실제 여정:

```text
현재 사실 질문
과거 시점 질문
최신 교정
충돌 source
모를 때 abstention
```

완료:

- current·historical answer 모두 source reopen.
- stale fact injection 0.
- runtime string classifier 0.
- old Memory event 재작성 0.
- request bytes·tokens·wall 무회귀.

### S3-M3 — User Control & Forgetting

Reflection·broad ingestion 전에 연다.

파일 후보:

```text
refoundation/src/forgetting-coordinator.js
refoundation/src/forgetting-receipt.js
refoundation/src/memory-export.js
refoundation/test/forgetting-coordinator.test.js
refoundation/test/forgetting-fault-matrix.test.js
refoundation/test/memory-user-control.integration.js
```

흐름:

```text
사용자 자연어 요청
→ main model exact selector
→ runtime preview
→ destructive/backup 경계
→ recoverable retract/trash
→ derived index delete/rebuild
→ exact recall/context/behavior probe
→ ForgetReceipt
```

fault matrix:

- preview 뒤 source revision 변경
- index delete 실패
- Library delete 실패
- backup unknown
- external copy unknown
- crash mid-cascade
- restart resume
- target보다 넓은 selector
- same-name foreign person
- deleted memory reintroduced by background reviewer

완료:

- 삭제 뒤 exact·FTS·semantic·Library·OS index hit 0.
- 삭제 뒤 model 행동 영향 0 또는 정직한 unknown.
- unrelated record loss 0.
- restore가 가능한 동안 exact inverse 제공.
- permanent purge는 사용자 명시 범위와 backup 현실을 따른다.

### S3-M4 — Recall & Context Supply

단계:

```text
exact/structured
→ FTS shadow
→ temporal/relationship
→ semantic candidate
→ deep recall escalation
```

파일 후보:

```text
refoundation/src/memory-recall.js
refoundation/src/memory-index-adapter.js
refoundation/src/memory-context-projection.js
refoundation/test/memory-recall.test.js
refoundation/test/memory-context-projection.test.js
refoundation/scripts/run-memory-recall-comparison.mjs
```

Decision boundary:

- current exact lookup이 아래 `M4-0 Recall Deficit Auditor`에서 미달하지 않으면 FTS 다음의 graph/vector를
  열지 않는다.
- FTS가 exact identifier·Korean·date·person query를 충분히 해결하면 embedding 범위를 줄인다.
- semantic retrieval이 실제 task outcome을 높이지 않으면 채택하지 않는다.
- deep recall이 deterministic lane 대비 이익이 없으면 폐기한다.

#### M4-0 Recall Deficit Auditor

새 retrieval 기술을 열 수 있는 판정자는 개발자의 직관이 아니라 다음 두 source뿐이다.

```text
A. M0에서 봉인한 incident replay
B. 오너가 목적·source·oracle을 실행 전에 고정한 실제 사용자 질문 표본
```

미달 판정:

- deterministic incident는 같은 source·query에서 1회 재현되면 미달이다.
- 모델 의미·관련성 실패는 같은 oracle의 격리 3회 중 2회 이상 실패하거나 Terra·gpt-5.5가 각각 1회 이상
  같은 실패 가족을 보일 때 미달이다.
- source가 없거나 oracle이 애매한 질문은 retrieval 미달 표본이 아니다.
- provider 장애·index cold start·evaluator 오류는 retrieval quality와 별도 reliability 표본이다.
- 한 번의 우연한 miss, 개발자가 만든 synthetic query만의 miss, benchmark judge 단독 miss는 새 engine을
  여는 근거가 아니다.

기술별 추가 개통 조건:

| 후보 | 반드시 먼저 실패해야 하는 lane | 요구되는 직접 이익 |
|---|---|---|
| FTS | exact structured lookup | exact/Korean/date/identifier recall 또는 wall 개선 |
| embedding | exact+FTS | 표현 차이 때문에 놓친 실제 목적의 recall·answer 개선 |
| temporal relation | exact+FTS | point-in-time·supersession·event ordering 개선 |
| graph | exact+FTS+현재 relational projection | multi-hop source chain·contradiction 목적 개선 |
| deep recall model | deterministic lanes 전체 | temporal/multi-session answer 개선이 추가 model 비용보다 큼 |

Auditor 결과는 `passed|failed|insufficient_sample|invalid`를 분리하고 실패 건수·source identity·oracle·모델·
request bytes·tokens·wall을 기록한다. `insufficient_sample`을 `failed`로 승격해 원하는 기술을 열지 않는다.

완료:

- current purpose recall 유지.
- irrelevant injection 0.
- source reopen 100%.
- abstention 유지.
- normal turn recall model 0.
- provider unavailable reply loss 0.
- ContextReceipt accounting 완전.

### S3-M5 — Living Library & Native Surfaces

단계:

```text
M5-0 isolated generated HTML/Markdown
→ M5-1 Generated View/User Note conflict
→ M5-2 T5 내 기록 UI
→ M5-3 macOS Spotlight/EventKit
→ M5-4 Windows Search/Explorer
→ M5-5 Obsidian no-plugin compatibility
```

파일 후보:

```text
refoundation/src/living-library.js
refoundation/src/living-library-manifest.js
refoundation/src/memory-platform-adapter.js
refoundation/src/macos-memory-platform-adapter.js
refoundation/src/windows-memory-platform-adapter.js
refoundation/test/living-library.test.js
refoundation/test/living-library-conflict.test.js
refoundation/test/memory-platform-adapter.test.js
```

사용자 화면 완료:

- 대화에서 Memory source 열기.
- Timeline·Project·Decision·Research view.
- 기억 수정·망각 상태가 같은 서버 state에서 갱신.
- 내부 ID·graph·embedding 용어 노출 0.
- Library를 열지 않아도 기능 손실 0.
- Obsidian 미설치 기능 손실 0.

Living Library 반대시험:

- external edit during generation
- generated file deletion
- user note rename
- invalid frontmatter
- `.obsidian` metadata 변화
- symlink outside Library
- private note OS index leak
- stale view after correction
- forgetting 뒤 cached HTML 잔류

### S3-M6 — Reflection·Principle·Skill

현재 Learning lifecycle을 확장하며 새 자동 학습 engine을 만들지 않는다.

단계:

```text
Reflection shadow
→ human-review surface
→ counterexample retrieval
→ isolated replay
→ independent field Work
→ Principle qualification
→ optional Skill revision
```

파일 후보:

```text
refoundation/src/reflection-candidate.js
refoundation/src/principle-qualification.js
refoundation/test/reflection-candidate.test.js
refoundation/test/principle-qualification.test.js
refoundation/test/principle-field-product.integration.js
```

승격 최소 계약:

- 서로 다른 achieved Episode.
- exact source method/effect evidence.
- current correction 보존.
- counterexample/near-miss.
- 같은 평가자의 baseline/candidate.
- correctness·completeness 무회귀.
- user correction·wall·tokens 중 하나 이상 우위.
- 독립 field Work.
- rollback.

Reflection은 기본 사용자 Memory에 자동 주입하지 않는다. 사용자가 요청하거나 해당 Work의 검증된 Principle이
관련된 경우에만 bounded view를 공급한다.

### S3-PW — Windows Product Enablement 의존선

S3-PW는 Life Continuity Gate가 아니다. Windows 제품 전체가 공통으로 소비하는 별도 플랫폼 개발선이다.

S3-PW 책임:

```text
Windows installer·signing
설치·upgrade·rollback
T5 app shell·startup·state root
native DPAPI/Windows Hello/Credential host
ConPTY·Job Object·process tree
Windows platform permission·notification 기반
제품 공통 crash/restart
```

S3-PW가 내는 정본은 내용이 없는 `WindowsPlatformQualificationReceipt`다.

```ts
type WindowsPlatformQualificationReceipt = {
  sourceCommit: string
  installerDigest: string
  architecture: "x64" | "arm64"
  installPassed: boolean
  upgradePassed: boolean
  rollbackPassed: boolean
  credentialHostPassed: boolean
  conptyPassed: boolean
  processTreePassed: boolean
  uiStartupPassed: boolean
  vmIdentity: string
}
```

Life Continuity M0~M6는 platform-neutral Core·Windows runner fixture를 진행할 수 있지만 Windows 제품 완료를
주장하지 않는다. M7은 S3-PW receipt를 소비해 Memory 고유 책임만 자격한다. M7이 installer·signing·공통 app
shell을 새로 만들거나 수리하지 않는다. S3-PW가 미달이면 해당 실패를 Memory patch로 우회하지 않고 플랫폼
개발선으로 돌려보낸다.

### S3-M7 — Memory macOS·Windows Qualification

각 앞 Gate에도 platform test를 두지만, M7에서는 이미 자격화된 플랫폼 위에서 Memory 저장·검색·망각·
Living Library·이동만 함께 닫는다.

macOS journeys:

- Finder·HTML·Markdown.
- Spotlight add/update/delete.
- EventKit exact reminder/calendar.
- Keychain key reference.
- T5 UI Terra·gpt-5.5.
- crash·restart·forget·restore.

Windows runner journeys:

- core semantics·path·Unicode·timezone.
- index adapter structural.
- fault injection·crash·restart.
- export/import digest.

Windows VM journeys:

- Explorer·Windows Search.
- DPAPI/Credential Locker.
- ACL·junction·hardlink.
- T5 UI Terra·gpt-5.5.
- macOS export→Windows resume.
- forget cascade.
- exact `WindowsPlatformQualificationReceipt` 소비.
- platform upgrade·rollback 뒤 Memory canonical·Library·index 복원 확인.

macOS Memory 자격과 Windows runner+VM Memory 자격이 모두 통과해야 M7 PASS다. installer·signing·공통
Windows 제품 개통의 PASS/FAIL은 S3-PW가 소유한다.

### S3-M8A — Time-compressed Human & Comparison Release

M8A가 출하 전 Release blocker다. 실제 수개월을 기다리지 않고 virtual clock·고정 다중 session·restart·OS
이동 fixture로 시간 순서·교정·망각·이월을 압축 재현한다. 압축은 event 수와 시점을 줄이는 것이 아니라 실제
달력 대기만 제거한다. source order·recordedAt·valid time·background schedule·model switch·crash 순서는
fixture manifest에 고정한다.

최소 시간압축 여정:

1. **Life** — 12개 월별 epoch에서 취향·약속·장소가 여러 번 교정된다.
2. **Work** — current·paused·completed·cancelled 프로젝트가 시간 순서대로 섞인다.
3. **Business** — 고객·계약·결정·미확인·삭제 범위를 다른 유효기간으로 다룬다.
4. **Research** — 주장·근거·반대 근거·생각 변화·Principle을 여러 revision에서 다룬다.
5. **Learning** — 반복 과업의 방법이 시간차 field에서 승격·폐기·rollback된다.
6. **Forgetting** — 한 사람·프로젝트의 파생 결과를 선택 삭제하고 이후 epoch 행동을 검사한다.
7. **Poisoning** — Web·attachment의 지시가 장기 반복 뒤에도 durable memory로 승격되지 않는다.
8. **Platform** — macOS epoch에서 시작해 Windows epoch에서 같은 상태를 재개한다.
9. **Failure** — index·provider·background reviewer가 중간 epoch에서 실패·복구한다.
10. **Model** — Terra↔gpt-5.5 전환 뒤 같은 source·current truth를 유지한다.

시간압축 fixture 계약:

```text
실제 wall sleep 0
virtual clock identity 고정
recordedAt와 valid time 독립
session·Work·model·platform transition manifest 고정
각 epoch expected current/historical truth 고정
과거 시점 질문과 현재 질문 모두 포함
forget 전후 behavior oracle 포함
raw 개인정보·실계정 0
```

비교군 동일 목적:

- OpenClaw: curated/episodic/dreaming/deep recall.
- Claude Code: project auto-memory·topic recall·user edit.
- Hermes: USER/MEMORY·provider prefetch·write approval.
- Codex: session resume·fork·compaction.

Benchmark는 LoCoMo·LongMemEval을 쓰되 T5 실제 사용자 목적을 대신하지 않는다.

M8A 완료 시 주장할 수 있는 문장:

> 시간압축 장기 여정에서 source·교정·망각·platform·model 연속성이 성립해 출하 자격을 얻었다.

M8A 완료만으로 “실제 수개월 동안 검증됐다”고 말하지 않는다.

### S3-M8B — Post-release Longitudinal Observation Window

M8B는 출하 전 Gate가 아니며 3.x 개선의 입력이다. 오너·동의한 테스터가 실제 T5를 사용하는 동안 발견된
교정·망각·재개·오염·비용 사례를 content-free receipt와 사용자가 허용한 작은 evidence로 보존한다.

원칙:

- raw 대화·개인 파일·화면을 telemetry로 수집하지 않는다.
- opt-in 없는 background upload 0.
- 사용자가 선택해 제출한 source만 비식별 evidence로 재료화한다.
- local content-free counters는 export 전 사용자가 검토할 수 있다.
- 30일·90일 관측 checkpoint는 보고 시점이지 Release deadline이 아니다.
- 불리한 실제 결과를 M8A synthetic pass로 덮지 않는다.
- 실제 관측이 새 결함 가족을 만들면 3.x M0 incident로 환류한다.

관측 항목:

```text
사용자 재설명·교정 횟수
stale memory·wrong-person·wrong-work incidents
source reopen 성공·실패
forget request와 잔류 행동
index/provider degraded 빈도
background interference
Mac↔Windows 이동·upgrade·restore
Reflection·Principle 채택·폐기와 실제 이익
목적당 tokens·wall·user turns
```

M8B 상태는 `OBSERVING|SUFFICIENT_FOR_3X_INPUT|NEW_INCIDENT_OPEN`으로만 기록한다. 제품 Release를 소급해
성공/실패 한 값으로 덮어쓰지 않는다.

---

## 14. Test ladder

각 Gate는 다음 순서를 지킨다.

```text
Contract
→ Property
→ Fault injection
→ Incident replay
→ Mutation
→ Evidence source/digest audit
→ Deterministic product integration
→ Terra·gpt-5.5
→ macOS·Windows
→ Human end-to-end
→ Same-goal comparison
```

시험 규율:

- 실제 행동을 제거하면 빨개져야 한다.
- 자연어 문자열 일치로 품질을 판정하지 않는다.
- 기존 test를 지워 초록을 만들지 않는다.
- Memory가 빨라졌지만 목적 결과가 틀리면 실패다.
- 삭제 log만 있고 behavior가 유지되면 실패다.
- benchmark judge 하나를 제품 성공으로 사용하지 않는다.
- raw 개인정보·실제 개인 account로 자동 test하지 않는다.
- 외부 effect는 loopback만 사용한다.

절대 반대시험:

```text
false durable memory = 0
unsourced inference promotion = 0
stale correction injection = 0
cross-person/work/channel leak = 0
secret raw memory = 0
deleted memory reuse = 0
persona fixation = 0
memory-based false completion = 0
```

---

## 15. Rollout·migration·rollback

### Shadow

- test/qualification wiring으로만 시작한다.
- model tool·Context·surface를 바꾸지 않는다.
- source digest와 observer cost를 기록한다.
- shadow failure가 사용자 turn을 막지 않는다.

### Promotion

- Gate evidence와 source commit이 선 뒤 제품 wiring을 연다.
- feature flag를 미리 심어 dead code를 만들지 않는다.
- product default 변경은 실제 human qualification 뒤 한 commit으로 한다.
- 새 writer를 열기 전에 old reader·restart·rollback을 통과한다.

### Migration

- 기존 Memory event를 rewrite하지 않는다.
- migration preview·source count·digest를 만든다.
- candidate write 검증 뒤 generation commit.
- commit 전 old canonical 삭제 0.
- partial migration은 active state로 보이지 않는다.

### Rollback

- 이전 source는 새 optional field를 무시하거나 degraded로 읽는다.
- derived index는 삭제·재생성한다.
- new Memory event를 잃지 않고 old current projection으로 낮춘다.
- Living Library generated view는 재생성하며 UserNote는 보존한다.
- Reflection·Principle active publication 실패 시 inactive로 되돌린다.

---

## 16. 저장 engine 선택 규칙

다음 질문에 실제 답이 선 뒤에만 선택한다.

| 후보 | 여는 직접 증거 | 폐기 조건 |
|---|---|---|
| 현재 JSONL·resident projection | current scale에서 충분 | lock/replay/I/O가 actual critical path |
| SQLite | cross-process writer·transaction·FTS가 반복 병목 | provider/context가 주요 비용이거나 migration 위험이 우위보다 큼 |
| FTS5 | exact/Korean/date recall이 current scan보다 유의하게 우위 | source reopen·품질 이익 없음 |
| embedding | lexical이 놓치는 실제 semantic 목적 | 비용·privacy·오탐이 이익보다 큼 |
| relationship graph | temporal/multi-hop incident에서 relational projection 미달 | graph maintenance·deletion 비용이 우위보다 큼 |
| external memory provider | local Core가 해결 못 하는 반복 수요 | canonical truth 분산·secret·lock-in |

한 Gate에서 SQLite·FTS·vector·graph를 묶어 만들지 않는다.

---

## 17. 중단선

다음 중 하나가 발생하면 코드를 더 얹지 않고 구조를 재판정한다.

- 같은 memory 오염 가족에 세 번째 patch.
- runtime string rule이 의미 선택을 대신함.
- 사용자 flow 없이 graph·index·관리 UI부터 만듦.
- source 없이 Reflection·Principle을 저장함.
- 삭제 시험은 통과하지만 실제 모델 행동이 기억을 유지함.
- macOS path·Keychain·Spotlight identity가 Core schema로 들어감.
- Windows runner 초록을 VM PASS로 승격함.
- Memory 전체를 prompt에 넣어 recall 문제를 숨김.
- background reviewer가 foreground를 반복 지연함.
- 새 정본이 기존 Conversation·Work·Memory·Episode를 복제함.
- benchmark는 좋아졌지만 실제 사용자 목적이 나빠짐.

---

## 18. 첫 착수 작업 — coding checklist

Terminal exact close 뒤 새 개발 session은 다음 순서만 수행한다.

### Turn 1 — Preflight

```text
T5-PRODUCT.md 읽기
T5-SECOND-COMPLETION.md Gate 확인
T5-THIRD-ACTIVATION-PREPARATION.md 금지선 확인
이 문서 상태 확인
Terminal close commit/evidence 확인
git status 확인
npm run refoundation:ci
Memory source digests 기록
```

### Turn 2 — M0 fixture only

```text
refoundation/config/s3-memory-incidents.json 추가
incident contract test 추가
현재 T5 baseline 실행
제품 source 변경 0 확인
M0 evidence 작성
commit
```

### Turn 3 — RecordRef pure contract

```text
record-reference.js pure validation
RecordRef property·privacy·scope test
no product wiring
focused test
full refoundation:check
commit
```

### Turn 4 — Existing source projection shadow

```text
Conversation·Run·Work·Attachment pointer adapter
exact source reopen
content-free observer
O0/O2 product digest countertest
same user purpose A/B
adopt/discard
```

이후에는 각 Gate의 다음 한 작업만 연다.

---

## 19. Evidence 규약

각 Gate evidence는 최소 다음을 가진다.

```text
schema
status
sourceCommit
productGoal
failureOriginal
comparisonSource revisions
adopted/rejected principles
fixtures and digests
exact model identities
quality outcome
resource outcome
faults and mutations
macOS status
Windows runner status
Windows VM status
notExecuted
notClaimed
source/test digests
nextOneTask
```

Evidence 이름:

```text
refoundation/evidence/s3-m0-memory-constitution-<date>.json
refoundation/evidence/s3-m1-record-provenance-<date>.json
refoundation/evidence/s3-m2-temporal-memory-<date>.json
refoundation/evidence/s3-m3-forgetting-<date>.json
refoundation/evidence/s3-m4-recall-<date>.json
refoundation/evidence/s3-m5-living-library-<date>.json
refoundation/evidence/s3-m6-principle-learning-<date>.json
refoundation/evidence/s3-m7-platform-<date>.json
refoundation/evidence/s3-m8a-time-compressed-release-<date>.json
refoundation/evidence/s3-m8b-longitudinal-observation-<date>.json
```

같은 사실을 별도 봉인문·인계서로 반복하지 않는다.

---

## 20. 최종 완료 판정

다음이 전부 성립해야 Life Continuity 완료다.

```text
사용자 source·현재 사실·과거 사실·결정·Reflection·Principle 분리
AND source reopen·digest·coverage 유지
AND current correction 우선
AND cross-person/work/channel leak 0
AND natural-language inspect·correct·forget·export
AND forgetting cascade와 behavior probe
AND normal turn full-memory injection 0
AND background foreground interference 자격
AND Living Library·T5 UI single state
AND Obsidian 미설치 기능 손실 0
AND macOS actual human PASS
AND Windows runner+VM actual human PASS
AND exact WindowsPlatformQualificationReceipt 소비
AND Terra·gpt-5.5
AND LoCoMo·LongMemEval 및 T5 실제 사용자 목적
AND S3-M8A time-compressed longitudinal PASS
AND 비교군 대비 정확성·완전성·사용자 부담 무회귀
AND 목적당 시간·token·교정 중 명확한 우위
```

M8B 실제 종단 관측은 출하 전 완료식에 넣지 않는다. M8B evidence가 `OBSERVING`인 동안 최종 보고는
`실제 수개월 장기 사용 unmeasured`를 명시한다. M8B가 `NEW_INCIDENT_OPEN`이면 3.x M0 incident를 열며,
이미 출하한 Release의 과거 evidence를 지우거나 거짓 성공으로 유지하지 않는다.

최종 사용자 문장:

> T5와 쌓은 기록은 내 컴퓨터와 내 통제 아래 남아 있다. T5는 무엇이 실제 기록이고 무엇이 현재 사실이며
> 무엇이 생각이나 배운 방법인지 구분한다. 나는 평소 말로 확인하고 고치고 잊을 수 있다. 오랜 시간이 지나
> Mac에서 Windows로 옮겨도 T5는 필요한 기억을 출처와 함께 이어서 내 일을 더 잘 끝낸다.

---

## 21. 작업 종료 보고 형식

각 단위는 다음만 보고한다.

- 사용자가 새로 할 수 있게 된 자연어 행동
- 변경한 정본·projection·platform 경계
- 같은 사용자 목적 baseline/candidate A/B
- 정확성·시간·출처·망각·보안 결과
- model/tool calls·tokens·request bytes·wall·background delta
- macOS·Windows 상태
- 불리한 결과·폐기한 후보
- 실행하지 않은 것·주장하지 않는 것
- 현재 Gate 영향
- 다음 한 작업

테스트 수·코드 줄·Memory 수·graph 수를 성과로 보고하지 않는다.
