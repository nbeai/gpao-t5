# T5 T-cell Governance Engine 구현 명세

- 작성: 2026-07-28
- 상태: `implementation_ready_handoff` (구현 완료 문서가 아니라 구현 착수 명세)
- 독자: T5 구현 담당 AI, 코드 감사 담당 AI, 제품 오너
- 목적: T-cell 이론을 T5의 Memory / Context / POM / Growth / Automation에 실제로 작동하는 공통 구조로 내린다.
- 상위 정본:
  - `GPAO-T5-DEVELOPMENT-ABSOLUTE-PRINCIPLES-2026-07-24-ko.md`
  - `docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md`
  - `GPAO-T5-MODEL-OS-OPERATING-LOOP-2026-07-27-ko.md`
  - `GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md`
- 이론 근거:
  - `beai-command-workspace/beai-harness-for-codex/docs/t-cell-theory/01-canon/T-CELL-CANON-v0.2-ko.md`
  - `beai-command-workspace/beai-harness-for-codex/docs/t-cell-theory/02-theory/T-CELL-FORMAL-THEORY-v0.2.3-ko.md`
- 기존 구현 기준:
  - `design/P6-1-MEMORY-POM-TCELL-2026-07-25-ko.md`
  - `src/kernel/l1-intent/context-mesh.js`
  - `src/kernel/l5-growth/task-trace.js`
  - `src/kernel/l5-growth/skill-learning.js`
  - `src/kernel/l5-growth/automation.js`
- POM 계보 참고(정본이 아니라 의미·경계 확인용):
  - `gpao-t3-2026.7.18/dist/gpao-t3-core/pom-contract.js`
  - `gpao-t3-2026.7.18/dist/gpao-t3-core/pom-engine.js`

> 이 문서는 상위 정본을 대체하지 않는다. 상위 정본의 철학을 개발자가 그대로 구현할 수 있는 계약,
> 모듈, 상태 전이, 저장 구조, 테스트와 완료 증거로 내린다.

---

## 0. 한 문장 정의

> T5 T-cell Governance Engine은 실제 경험에서 작동원리 후보를 추출하고, 근거·범위·반례를 보존한 채
> 경쟁·replay·효과 감사를 거쳐, 검증된 원리에게만 제한된 영향권을 주고 필요하면 약화·분리·병합·
> 되돌리는 성장 거버넌스 기관이다.

T5는 경험을 많이 저장해서 성장하지 않는다. 경험에서 **더 정확하고 재사용 가능한 작동원리**를 만들고,
그 원리가 언제 어디까지 행동에 영향을 줘도 되는지 통제함으로써 성장한다.

핵심 명제:

```text
기억 ≠ 원리
검색됨 ≠ 입장됨
신뢰도 ≠ 권한
replay 통과 ≠ 자동 실행
사용자 승인 ≠ 사실 검증
성공 횟수 ≠ 전역 적용 자격
자가성장 ≠ 라이브 규칙의 숨은 변경
```

---

## 1. 현재 상태와 정확한 간극

### 1.1 이미 구현된 안전 바닥

1. `context-mesh.js`
   - preference와 operating_principle을 구분한다.
   - operating_principle은 `replayPassed && userConfirmed` 전 영향이 0이다.
   - 승격된 항목도 현재 요청과 관련될 때만 입장한다.
2. `task-trace.js`
   - 실제 완료 작업을 넓게 관찰한다.
   - DefaultTarget은 후보 → replay → 승격 → rollback 경계를 가진다.
3. `skill-learning.js`
   - detected → candidate → replay_required → approved → admitted / rejected 상태를 가진다.
   - 활성 스킬도 외부 행동 권한을 우회할 수 없다.
4. `automation.js`
   - 자동화 후보, 승인, 실행, 실패 재시도, 취소, 만료, 실행 원장을 가진다.
5. P-OP / Truth Ledger
   - 실제 실행, 호출 인자, 실패, 승인, 복구, 다음 턴 승계가 티셀의 현실 근거가 될 수 있다.

### 1.2 아직 없는 것

현재 operating_principle은 사실상 `kind + statement + 두 불리언`에 가깝다. 다음이 없다.

- 현실 중심점과 원문 근거
- 어떤 상황에서 유효하고 무효한지
- 적용 범위의 크기와 증거 깊이
- 여러 원리 후보의 경쟁
- T-sphere 형성과 다음 스케일 압축
- 실제 행동 효과를 비교하는 replay
- 예측오차와 사용자 정정의 누적
- 원리의 강화·약화·분리·병합
- 통계적 안정도와 권한의 분리
- 적용 후 효과 감사와 자동 rollback
- 어떤 원리가 이번 모델 입력과 행동에 영향을 줬는지의 trace

따라서 현재 구현은 **티셀이 함부로 영향을 주지 못하게 하는 게이트**이며, 이 문서는 그 위에
**티셀이 실제로 태어나고 경쟁하고 검증되고 성장하는 엔진**을 추가한다.

---

## 2. 범위와 비범위

### 2.1 이번 개발의 범위

- P-OP와 Truth Ledger에서 학습 가능한 관찰 사건 생성
- TCellCore 공통 스키마와 생명주기
- 모델 기반 원리 후보 추출과 OS 검증
- T-sphere 관계·경쟁·압축 후보
- positive / negative / boundary replay
- 통계적 효과 점수와 예측오차
- POM 원리 등록소와 현재 요청 admission
- 제한된 영향 적용과 영향 trace
- mutation 제안, 효과 감사, 안정화·약화·rollback
- 일반 사용자용 기억·성장 표면

### 2.2 이번 개발의 비범위

- 모델 가중치 학습 또는 fine-tuning
- 대형 벡터 DB 도입
- 사용자 모르게 전역 규칙 변경
- 신뢰 점수만으로 A2/A3 행동 자동 승인
- 서비스별 학습 규칙
- 답변 문구를 고정하는 프롬프트 템플릿
- T-cell 색상 이론의 제품 UI 구현
- T-cell 이론 전체를 제품 코드에 그대로 복제
- P-OP A~H의 현재 실전 검증을 중단하고 이 작업으로 우선순위를 바꾸는 일

P-OP가 먼저 현실·실행·원장을 닫는다. T-cell Engine은 그 증거를 먹고 성장한다. P-OP가 불완전한 상태에서
성장 엔진을 먼저 활성화하면 잘못된 현실을 더 잘 기억하는 시스템이 된다.

---

## 3. 전체 운영 구조

```text
사용자 원문 / 실행 / 결과 / 정정 / 승인 / 실패
                    │
                    ▼
           ObservationEvent (L0)
             넓게 기록, 영향 0
                    │
                    ▼
          EvidenceBundle Builder
        같은 현상·대상·목적의 증거 묶음
                    │
                    ▼
          TCellExtractor (모델)
       원리·중심·범위·반례 후보 생성
                    │
                    ▼
        TCell Validator / Registry (L5)
       스키마·trace·권한·중복·범위 검사
                    │
                    ▼
              T-Sphere Engine
        관계화·경쟁·분리·병합·압축 후보
                    │
                    ▼
              Replay Engine
        positive / negative / boundary 비교
                    │
                    ▼
          Maturity + Effect Scoring
         성숙도와 실제 권한을 별도 계산
                    │
                    ▼
       Operating Principle Registry
         승인된 원리와 허용 영향 보관
                    │
                    ▼
       POM (Personal Operating Model)
    목표·상태·협업·작업방식과 원리 관계 투영
                    │
                    ▼
        Context Admission / TaskContext
       이번 요청에 필요한 원리만 좁게 입장
                    │
                    ▼
          모델 판단 → 실행 → Truth Ledger
                    │
                    ▼
              Effect Audit
       예측오차·정정·재발·비용을 다시 관찰
                    │
                    └────→ Mutation / Rollback
```

이 순환은 기존 T5 모델-OS 공동 운영 순환을 대체하지 않는다. 그 순환의 `원장 → 다음 턴` 사이에
장기 성장용 느린 폐회로를 추가한다. 느린 추출·replay·감사는 기본 응답을 막지 않는다.

---

## 4. 세 축은 절대 합치지 않는다

### 4.1 원리 성숙도 `MaturityLevel`

```js
export const MATURITY_LEVELS = Object.freeze([
  'M0_observed',
  'M1_candidate',
  'M2_replayed',
  'M3_limited',
  'M4_stable',
  'M5_compressed',
  'softened',
  'quarantined',
  'rolled_back',
]);
```

- `M0_observed`: 관찰만 존재. 행동 영향 0.
- `M1_candidate`: 구조화된 원리 후보. 행동 영향 0.
- `M2_replayed`: 최소 replay 통과. shadow 또는 사용자 검토 가능.
- `M3_limited`: 특정 project/surface/task 범위에서만 영향 가능.
- `M4_stable`: 반복 실사용 효과가 확인된 안정 원리.
- `M5_compressed`: 안정된 T-sphere가 다음 스케일 원리로 압축됨. 내부 trace 하강 가능.
- `softened`: 오류·노후화로 영향도 축소.
- `quarantined`: 권한 위반, trace 손실, 반복 실패로 격리.
- `rolled_back`: 적용 취소. 과거 이력은 보존하되 영향 0.

### 4.2 이번 턴 영향 역할 `InfluenceRole`

```js
export const INFLUENCE_ROLES = Object.freeze([
  'none',
  'candidate_context',
  'supporting_context',
  'plan_hint',
  'default_value',
  'answer_anchor',
]);
```

- 후보는 `none` 또는 진단면의 `candidate_context`만 가능하다.
- `answer_anchor`는 명시 trace, 현재 요청 비충돌, 범위 적합, authority 허용이 모두 필요하다.
- 사용자 원문과 현재 목적은 어떤 원리보다 우선한다.

### 4.3 실제 행동 권한 `AuthorityTier`

기존 A0~A3를 그대로 사용한다. 티셀은 별도 권한 체계를 만들지 않는다.

```text
MaturityLevel  = 이 원리가 얼마나 검증됐는가
InfluenceRole  = 이번 판단에 어떤 방식으로 쓰이는가
AuthorityTier  = 그 판단이 실제로 어떤 행동을 할 수 있는가
```

불변식:

```text
높은 maturity가 A2/A3를 자동 승인하지 않는다.
사용자 승인이 낮은 maturity를 사실로 만들지 않는다.
높은 activation score가 현재 요청 또는 authority를 덮지 않는다.
```

---

## 5. 데이터 계약

### 5.1 ObservationEvent

파일: `src/kernel/l0-evidence/tcell-observation.js`

```js
/**
 * @typedef {Object} ObservationEvent
 * @property {string} id
 * @property {'user_request'|'user_correction'|'tool_result'|'approval'|'rejection'|
 *   'recovery'|'delivery_result'|'context_outcome'|'automation_result'} type
 * @property {string} sessionId
 * @property {string|null} turnId
 * @property {string|null} taskId
 * @property {number} occurredAt
 * @property {Object} anchor
 * @property {string|null} anchor.workspace
 * @property {string|null} anchor.project
 * @property {string|null} anchor.surface
 * @property {string|null} anchor.subject
 * @property {Object} signal
 * @property {string} signal.summary
 * @property {'success'|'failure'|'correction'|'neutral'} signal.valence
 * @property {string[]} sourceRefs
 * @property {string[]} receiptRefs
 * @property {Object} privacy
 * @property {boolean} privacy.modelReadable
 * @property {boolean} privacy.containsSecret
 * @property {number} schemaVersion
 */
```

규칙:

- `ObservationEvent` 생성 자체는 A0 로컬 기록이다.
- 비밀값, 전체 파일 내용, 전체 모델 사고 원문을 저장하지 않는다.
- 원문이 필요하면 세션/원장 위치를 `sourceRefs`로 참조한다.
- 모델에게 보낼 때는 `modelReadable === true`만 사용한다.
- 관찰은 영향이 아니다. 어떤 ObservationEvent도 직접 TaskContext에 들어가지 않는다.

필수 생성 함수:

```js
makeObservationEvent(input)
observationFromReceipt(receipt, context)
observationFromCorrection(userText, context)
observationFromApproval(decision, context)
validateObservationEvent(event)
```

### 5.2 TCellCore

파일: `src/kernel/l5-growth/tcell-core.js`

```js
/**
 * @typedef {Object} TCellCore
 * @property {string} id
 * @property {number} schemaVersion
 * @property {string} state MaturityLevel
 * @property {Object} principle
 * @property {string} principle.statement
 * @property {'context_selection'|'planning'|'execution'|'recovery'|
 *   'workflow'|'automation'|'authority'|'communication'} principle.type
 * @property {number} principle.hypothesisConfidence 0..1, 권한 아님
 * @property {Object} center
 * @property {string} center.point 세로축 끝의 수렴 중심
 * @property {string} center.axis 그 중심으로 향하는 판단 경로
 * @property {string[]} center.horizontalSignals 확장·반례·관계 신호
 * @property {Object} anchor
 * @property {string|null} anchor.workspace
 * @property {string|null} anchor.project
 * @property {string|null} anchor.surface
 * @property {string|null} anchor.subject
 * @property {number} anchor.createdAt
 * @property {number} anchor.lastObservedAt
 * @property {Object} boundary
 * @property {string[]} boundary.validWhen
 * @property {string[]} boundary.invalidWhen
 * @property {string[]} boundary.needsReviewWhen
 * @property {string[]} boundary.mustNotOverride
 * @property {Object} geometry
 * @property {'turn'|'task'|'project'|'profile'|'global'} geometry.radius
 * @property {number} geometry.depth
 * @property {number} geometry.sphereStability
 * @property {Object} authority
 * @property {InfluenceRole[]} authority.allowedInfluence
 * @property {boolean} authority.requiresUserConfirmation
 * @property {boolean} authority.mustNotOverrideCurrentRequest
 * @property {string[]} authority.prohibitedActionKinds
 * @property {Object} trace
 * @property {string[]} trace.observationRefs
 * @property {string[]} trace.rawSourceRefs
 * @property {string[]} trace.derivedFrom
 * @property {Object[]} trace.corrections
 * @property {Object} replay
 * @property {'untested'|'passed_basic'|'passed_transfer'|'failed'} replay.status
 * @property {string[]} replay.caseRefs
 * @property {number|null} replay.lastRunAt
 * @property {Object} effect
 * @property {number} effect.eligibleCount
 * @property {number} effect.successCount
 * @property {number} effect.failureCount
 * @property {number} effect.userCorrectionCount
 * @property {number} effect.wilsonLowerBound
 * @property {number} effect.sameFailureRecurrenceCount
 * @property {number} effect.authorityViolationCount
 * @property {Object} growth
 * @property {string[]} growth.mutationRefs
 * @property {boolean} growth.rollbackAvailable
 * @property {string|null} growth.previousVersionId
 * @property {number|null} growth.lastAuditAt
 */
```

필수 검증:

```js
validateTCell(cell)
assertTraceDescendable(cell, evidenceStore)
assertBoundaryComplete(cell)
assertAuthorityInvariant(cell)
assertCompressionSafe(cell, sourceCells)
```

검증 실패는 예외로 라이브 턴을 죽이지 않는다. 후보를 `quarantined`로 저장하고 영향 0으로 둔다.

### 5.3 ReplayCase / ReplayResult

파일: `src/kernel/l5-growth/tcell-replay.js`

```js
/**
 * @typedef {Object} ReplayCase
 * @property {string} id
 * @property {'positive'|'negative'|'boundary'} kind
 * @property {string[]} sourceRefs
 * @property {Object} inputFacts
 * @property {Object} expected
 * @property {string[]} expected.mustHold
 * @property {string[]} expected.mustNotHappen
 * @property {string|null} expected.expectedInfluenceRole
 * @property {string|null} expected.expectedActionKind
 */

/**
 * @typedef {Object} ReplayResult
 * @property {string} id
 * @property {string} tcellId
 * @property {string} candidateVersionId
 * @property {Object[]} caseResults
 * @property {boolean} positivePassed
 * @property {boolean} negativePassed
 * @property {boolean} boundaryPassed
 * @property {boolean} authorityPassed
 * @property {boolean} tracePassed
 * @property {boolean} overallPassed
 * @property {number} createdAt
 */
```

`overallPassed` 계산:

```js
overallPassed =
  positivePassed &&
  negativePassed &&
  boundaryPassed &&
  authorityPassed &&
  tracePassed;
```

### 5.4 T-Sphere

파일: `src/kernel/l5-growth/t-sphere.js`

```js
/**
 * @typedef {Object} TSphere
 * @property {string} id
 * @property {string} centerPoint
 * @property {string[]} memberIds
 * @property {Object[]} relations
 * @property {number} stability
 * @property {'soft'|'forming'|'stable'|'split_required'|'merge_candidate'} state
 * @property {string|null} compressedCellId
 * @property {string[]} traceRefs
 */
```

관계 종류:

```js
export const TCELL_RELATIONS = Object.freeze([
  'supports',
  'contradicts',
  'refines',
  'narrows',
  'expands',
  'precedes',
  'depends_on',
  'same_center',
]);
```

---

## 6. 저장 구조

현재 T5의 파일 기반·무런타임의존성 원칙을 유지한다. 저장 루트는 기존 store와 동일하게
`process.env.GPAO_T5_DATA_DIR`를 우선하고, 없으면 현재 `SessionStore`의 기본 디렉터리를 사용한다.
서버 조립에서는 `new TCellStore(store.dir)`처럼 기존 `SessionStore.dir`를 주입해 테스트 격리도 유지한다.

```text
<T5_DATA_DIR>/
  growth/
    observations.jsonl
    tcells.json
    spheres.json
    replay-cases.json
    replay-results.jsonl
    mutations.jsonl
    effect-audits.jsonl
```

신규 파일:

```text
src/surface/tcell-store.js
src/surface/replay-store.js
src/surface/growth-audit-store.js
```

저장 규칙:

- 이벤트 로그는 append-only JSONL이다.
- 현재 상태 문서는 임시 파일 작성 후 rename으로 원자 교체한다.
- `schemaVersion`은 모든 레코드에 필수다.
- 알 수 없는 미래 필드는 보존하고 무시한다.
- 손상된 한 줄은 격리하고 전체 저장소를 읽지 못하게 하지 않는다.
- rollback은 삭제가 아니라 새 버전과 상태 전이로 남긴다.
- 전체 원문을 중복 저장하지 않고 `sourceRefs`로 하강한다.
- profile/project/workspace 경계를 넘는 조회는 기본 차단한다.

---

## 7. 모델과 OS의 역할 계약

### 7.1 모델이 담당하는 것

- 여러 관찰에서 원리 가설 제안
- 현실 중심점과 중심축 후보 제안
- 유효 조건·무효 조건·반례 제안
- 같은 중심의 후보 비교
- split / merge / narrow / refine mutation 후보 제안
- 현재 요청에 맞는 자연스러운 사용

### 7.2 T5 OS가 담당하는 것

- 원문·receipt·정정·승인·결과의 사실 공급
- 모델이 낸 구조의 schema 검증
- sourceRefs 존재와 privacy 검증
- 현재 요청 우선, scope, authority 강제
- replay 실행과 결과 계산
- 통계·상태 전이·저장·rollback
- 이번 턴에 실제 영향을 준 원리 trace

### 7.3 모델에게 주는 추출 입력

파일: `src/runtime/tcell-extractor.js`

모델 입력은 전체 대화가 아니라 제한된 `EvidenceBundle`이다.

```js
/**
 * @typedef {Object} EvidenceBundle
 * @property {string} id
 * @property {string} activeTarget
 * @property {ObservationEvent[]} observations
 * @property {Object[]} existingCandidates
 * @property {Object} authorityFacts
 * @property {string[]} requiredOutputFields
 * @property {number} tokenBudget
 */
```

모델 출력:

```json
{
  "decision": "candidate|insufficient_evidence|duplicate|contradiction",
  "principle": {
    "statement": "",
    "type": ""
  },
  "center": {
    "point": "",
    "axis": "",
    "horizontalSignals": []
  },
  "boundary": {
    "validWhen": [],
    "invalidWhen": [],
    "needsReviewWhen": [],
    "mustNotOverride": ["current_user_request"]
  },
  "trace": {
    "observationRefs": []
  },
  "counterexamples": [],
  "suggestedRadius": "turn|task|project|profile|global"
}
```

금지:

- 모델이 직접 `M3_limited` 이상으로 승격
- 모델이 직접 authority tier 변경
- 모델이 sourceRefs에 없는 사실 추가
- 모델 confidence를 승인으로 사용
- 서비스별 고정 프롬프트

---

## 8. 후보 추출과 중복 수렴

파일: `src/kernel/l5-growth/tcell-extraction.js`

필수 함수:

```js
buildEvidenceBundles(observations, opts)
validateExtractionOutput(output, bundle)
shapeTCellCandidate(output, bundle, opts)
findDuplicateOrRelation(candidate, existingCells)
```

초기 묶음 기준:

- 같은 `project + subject + signal family`를 우선 묶는다.
- 사용자 명시 정정은 단독으로 후보를 만들 수 있으나 radius는 `task`를 넘지 못한다.
- 명시적 사용자 선호는 기존 preference 후보가 될 수 있지만 TCellCore로 자동 변환하지 않는다.
- preference는 ObservationEvent 근거가 될 수 있고, 반복 경험에서 별도의 operating principle이 발견될 수 있다.
- 일반 operating principle은 서로 다른 2개 이상의 turn 근거가 없으면 `M1_candidate`까지만 가능하다.
- 한 사례의 교정으로 project/profile/global radius를 얻을 수 없다.
- 중복 판단은 문자열 동일성만 쓰지 않는다. 모델의 relation 제안과 결정적 anchor/boundary 비교를 함께 사용한다.

현재 `detectCandidate()` 정규식은 제거하지 않는다. 다음 역할로 축소한다.

```text
현재: 후보의 의미를 사실상 결정
변경: EvidenceBundle을 깨우는 얇은 신호
```

정규식이 만든 종류는 모델 추출과 OS 검증 전 행동에 영향을 주지 않는다.

---

## 9. Replay Engine

### 9.1 replay 종류

1. `structural replay`
   - 필수 필드, trace, boundary, authority 계약 검사
2. `historical replay`
   - 과거 실제 turn/receipt에 후보를 적용했을 때 기대 행동과 맞는지
3. `counterfactual replay`
   - 후보 미적용 baseline과 적용 candidate를 비교
4. `transfer replay`
   - 다른 표현·다른 turn·같은 project에서 원리가 전이되는지
5. `boundary replay`
   - 오래된 맥락, 다른 프로젝트, 애매한 대상, 권한 충돌에서 멈추는지

### 9.2 최소 replay suite

모든 operating principle은 다음을 하나 이상 가져야 한다.

```text
positive case  1개 이상
negative case  1개 이상
boundary case  1개 이상
authority case 1개 이상(행동과 연결되는 원리만)
```

### 9.3 baseline 비교

같은 입력에 대해 다음을 비교한다.

```text
baseline: 현재 승격된 원리만 사용
candidate: 현재 승격 원리 + 검증 대상 후보를 shadow로 사용
```

비교 항목:

- active target 정확도
- 잘못된 과거 맥락 개입
- 불필요한 질문
- 필요한 승인 누락
- 잘못된 도구/대상 선택
- 사용자 정정 필요성
- 성공까지 걸린 turn과 도구 호출 수

실제 외부 전송·삭제·결제는 replay에서 실행하지 않는다. 계획과 authority 결정까지만 비교한다.

---

## 10. 통계와 상태 전이

### 10.1 통계의 의미

통계는 “이 원리가 관찰된 범위에서 얼마나 잘 예측했는가”를 나타낸다. 진리 점수나 권한 점수가 아니다.

첫 구현은 외부 통계 라이브러리 없이 Wilson lower bound를 사용한다.

```js
export function wilsonLowerBound(successes, total, z = 1.96) {
  if (total <= 0) return 0;
  const p = successes / total;
  const z2 = z * z;
  return (
    p + z2 / (2 * total) -
    z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  ) / (1 + z2 / total);
}
```

성공 판정은 단순 tool exit 0이 아니다. 해당 원리가 예측한 개선이 실제로 일어났고, 사용자 정정·권한 위반·
wrong-anchor가 없을 때만 성공이다.

### 10.2 초기 상태 전이 기준

아래 수치는 v1의 보수적 초기값이며 상수로 한 곳에 둔다. 변경은 replay와 감사 근거를 요구한다.

```js
export const TCELL_THRESHOLDS = Object.freeze({
  candidateDistinctTurns: 2,
  limitedMinEligibleOutcomes: 5,
  limitedMinWilsonLowerBound: 0.50,
  stableMinEligibleOutcomes: 12,
  stableMinWilsonLowerBound: 0.70,
  stableMaxCorrectionRate: 0.10,
  compressionMinStableMembers: 3,
});
```

전이:

```text
M0 → M1
  구조화 후보 + trace + boundary 존재

M1 → M2
  positive/negative/boundary replay 통과
  사용자 확인이 필요한 종류는 확인까지 완료

M2 → M3
  지정 범위에서 eligible outcome >= 5
  Wilson lower bound >= 0.50
  authority violation = 0

M3 → M4
  eligible outcome >= 12
  Wilson lower bound >= 0.70
  correction rate <= 0.10
  transfer replay 통과
  authority violation = 0

M4 sphere → M5
  같은 centerPoint의 stable member >= 3
  압축 전후 replay 동등성 통과
  모든 source cell로 trace 하강 가능
```

자동 강등:

```text
authority violation 1회       → quarantined
trace 하강 실패               → quarantined
현재 요청 hard conflict       → 이번 턴 영향 none
연속 실사용 실패 2회          → softened
사용자 명시 rollback          → rolled_back
boundary 밖 오적용 확인       → radius 축소 mutation 후보
```

임계값을 통과해도 자동으로 global radius를 얻지 않는다. radius 확장은 별도 transfer replay와 필요한 사용자
확인을 거친다.

---

## 11. Operating Principle Registry와 POM 통합

POM은 기존 GPAO-T3 계열에서 사용한 **Personal Operating Model**의 의미를 유지한다. 이 문서가 다른
약어로 재정의하지 않는다.

POM은 사용자에 관한 모든 기억도 아니고, operating principle 저장소와 같은 것도 아니다. POM은 확인된
근거를 바탕으로 사용자의 목표·현재 상태·협업 맥락·작업방식·의사결정 패턴을 제한된 범위에서 투영하는
개인 운영 모델이다. T-cell은 그 가운데 검증된 작동원리 단위이며, 별도의
`OperatingPrincipleRegistry`가 생명주기와 효과를 소유한다.

```text
raw memory / observations
        │
        ├─→ preference store
        │     명시적 선호, 사용자 확인, 원리와 분리
        │
        ├─→ POM projections
        │     GoalModel / StateModel / CollaborationContextModel /
        │     WorkflowModel / DecisionPattern
        │
        └─→ TCellCore
              검증 가능한 operating principle
                    │
                    └─→ POM이 근거 있는 작업방식·판단모델로 참조
```

POM의 추정 모델은 그 자체로 행동 권한을 얻지 않는다. `hypothesis`는 proposal/supporting 후보일 뿐이며,
현재 요청에 영향을 주려면 Context Admission을 통과해야 한다. POM 속 OperatingPrinciple도
`OperatingPrincipleRegistry`의 TCellCore와 연결돼야 한다.

파일:

```text
src/kernel/l5-growth/operating-principle-registry.js
src/kernel/l5-growth/pom-projection.js
src/kernel/l1-intent/tcell-admission.js
```

POM 최소 계약:

```js
/**
 * @typedef {Object} POMProjection
 * @property {string} id
 * @property {'GoalModel'|'StateModel'|'CollaborationContextModel'|'WorkflowModel'|
 *   'DecisionPattern'|'OperatingPrinciple'} objectType
 * @property {'explicit'|'inferred'} origin
 * @property {'observation_only'|'hypothesis'|'confirmed_model'|'operating_principle'} lifecycle
 * @property {'project'|'profile'|'global'} scope
 * @property {'observation_only'|'proposal_only'|'supporting_context'|'answer_anchor'} allowedUse
 * @property {string} statement
 * @property {string[]} evidenceRefs
 * @property {string[]} tcellRefs
 * @property {boolean} userConfirmed
 * @property {number|null} reviewAt
 */
```

POM 규칙:

- inferred projection은 서로 다른 근거가 2개 미만이면 `hypothesis` 생성 불가.
- hypothesis와 observation_only는 answer_anchor 불가.
- 민감한 성향·건강·정치·종교·신용·도덕성 추론은 기본 생성 금지.
- current state는 `reviewAt`을 가져야 하며 만료 후 stale 처리한다.
- OperatingPrinciple은 연결된 TCellCore가 M2 이상이고 필요한 사용자 확인을 거쳐야 한다.
- POM은 current request, active target, authority를 덮지 않는다.

필수 함수:

```js
registerPrinciple(cell, replayResult, approval)
demotePrinciple(id, reason)
rollbackPrinciple(id, reason)
eligiblePrinciples(registry, requestFacts)
admitPrinciples(candidates, requestFacts, authorityFacts)
explainAdmission(decision)
projectPersonalModel(observations, opts)
confirmPersonalModel(projection, approval)
attachPomSlice(taskContext, admittedProjections)
```

`admitPrinciples()` 반환:

```js
/**
 * @typedef {Object} PrincipleAdmission
 * @property {string} tcellId
 * @property {InfluenceRole} role
 * @property {string} reason
 * @property {string[]} sourceRefs
 * @property {string[]} boundaryChecks
 * @property {boolean} currentRequestConflict
 * @property {boolean} authorityAllowed
 */
```

입장 우선순위:

```text
1. 현재 사용자 원문
2. 현재 active target와 실제 작업 상태
3. 현재 turn의 ToolReceipt / awaiting / authority
4. 명시된 현재 project/profile
5. admitted T-cell
6. retrieved raw memory
```

5번은 1~4번을 수정하거나 덮을 수 없다.

### 11.1 모델 입력

`TaskContextPacket`에 다음을 추가한다.

```js
/**
 * @property {Array<{
 *   id:string,
 *   statement:string,
 *   role:InfluenceRole,
 *   validWhen:string[],
 *   mustNotOverride:string[],
 *   reason:string
 * }>} admittedPrinciples
 */
```

모델에게 내부 점수 전체를 주지 않는다. 현재 판단에 필요한 원리, 범위, 금지 경계, 입장 이유만 준다.

### 11.2 영향 trace

매 turn 결과에 내부용으로 남긴다.

```js
principleTrace: {
  retrievedIds: [],
  admitted: [{ id, role, reason }],
  rejected: [{ id, reason }],
  influencedPlan: [],
  influencedAnswer: [],
}
```

사용자 원장에는 쉬운 말로 다음만 표시한다.

```text
이번에는 "지난번 정산 표 형식"을 참고했어요.
이 원칙은 이 프로젝트 안에서만 적용돼요.
되돌릴 수 있어요.
```

---

## 12. Self-Development Loop

파일:

```text
src/kernel/l5-growth/tcell-delta.js
src/kernel/l5-growth/tcell-mutation.js
src/kernel/l5-growth/tcell-effect-audit.js
```

운영 순환:

```text
Observe
→ DetectDelta
→ Diagnose
→ ProposeMutation
→ Simulate
→ Replay
→ AdmitUpgrade
→ ApplyMutation
→ AuditEffect
→ StabilizeOrRollback
```

### 12.1 Delta 종류

```js
export const DELTA_KINDS = Object.freeze([
  'user_correction',
  'same_failure_recurrence',
  'wrong_anchor',
  'stale_context_override',
  'missing_active_target',
  'authority_violation',
  'successful_transfer',
  'unexpected_improvement',
  'scope_mismatch',
  'trace_gap',
]);
```

### 12.2 Mutation 종류

```js
export const MUTATION_TYPES = Object.freeze([
  'update_principle',
  'adjust_radius',
  'adjust_depth',
  'change_state',
  'add_relation',
  'remove_relation',
  'split_sphere',
  'merge_sphere',
  'promote_cell',
  'demote_cell',
  'create_replay_case',
  'update_admission_rule',
  'update_trace_requirement',
  'update_extraction_signal',
]);
```

### 12.3 자동으로 가능한 것

- confidence 하향
- stale 표시
- 임시 activation 하향
- replay case 추가
- trace 요구 강화
- review-needed 후보 생성
- 로컬 성장 원장 기록
- future outcome 감사 예약
- rollback 권고

### 12.4 사용자 확인이 필요한 것

- durable operating principle 승격
- workflow-level 기본 행동 변경
- 사용자 preference 또는 POM confirmed model 변경
- project/profile/global radius 확장
- identity-critical sphere 병합
- authority policy 변경
- live automation 활성화

mutation 후보가 자기 권한을 스스로 높일 수 없다.

---

## 13. 기존 구현과 마이그레이션

### 13.1 원칙

- 기존 `memory.json`, skill store, task trace store, automation store를 한 번에 바꾸지 않는다.
- 첫 단계는 읽기 adapter와 shadow dual-write다.
- 기존 API를 깨지 않고 내부적으로 새 registry에 연결한다.
- 기존 승격 상태를 과장하지 않는다.

### 13.2 기존 memory

`memory.promoted` 처리:

```text
preference + userConfirmed
  → 기존 preference store에 유지
  → TCellCore로 변환하지 않음
  → ObservationEvent의 explicit preference 근거로만 참조 가능

operating_principle + reviewLevel: basic
  → M2_replayed
  → replay.status: passed_basic
  → M4_stable로 가져오지 않음
```

원본 entry id와 저장 위치를 `trace.derivedFrom`에 남긴다.

### 13.3 DefaultTarget

- 기존 domain object는 유지한다.
- 대응 T-cell은 “이 도구의 기본 대상은 X”라는 context-selection principle이다.
- `default_target`이 실제 계획에 영향을 줄 때 `principleRef`를 원장에 남긴다.
- 기존 A2 전송 승인은 그대로 유지한다.

### 13.4 SkillCandidate

- 기존 상태기계는 유지한다.
- 스킬의 “작업 방식” 근거를 설명하는 T-cell/T-sphere를 `principleRefs`로 연결한다.
- 스킬 replay와 티셀 replay를 합치지 않는다.
  - skill replay: 절차가 실행 가능한가
  - T-cell replay: 왜 이 절차가 이 상황에서 좋은가

### 13.5 Automation

- ScheduledJob은 그대로 실행 기관이다.
- T-cell은 반복 주기·대상·복구 방식의 근거가 된다.
- 자동화 활성화 A2는 maturity와 무관하게 유지한다.
- 실행 결과는 다시 ObservationEvent가 되어 원리 효과 감사로 돌아온다.

### 13.6 마이그레이션 순서

```text
1. adapter read
2. shadow observation write
3. shadow T-cell candidate 생성
4. 기존 결과와 대조
5. POM read-only 표면
6. 기존 preference와 신규 admission의 공존 검증
7. operating principle / default target 제한 영향
8. skill/workflow 제한 영향
9. 기존 memory operating_principle 소비 제거
10. legacy 파일 read-only 보존 후 migration 완료 표시
```

---

## 14. API와 사용자 표면

### 14.1 API

```text
GET    /growth/tcells
GET    /growth/tcells/:id
GET    /growth/spheres
GET    /growth/replays/:tcellId
POST   /growth/tcells/:id/request-replay
POST   /growth/tcells/:id/confirm
POST   /growth/tcells/:id/reject
POST   /growth/tcells/:id/rollback
POST   /growth/tcells/:id/request-radius-change
GET    /growth/effect-audits/:tcellId
```

규칙:

- GET은 A0.
- replay 요청은 로컬 dry-run이면 A0.
- durable 승격·radius 확장·preference/POM confirmed model 변경은 A2.
- rollback은 영향 제거이므로 기본 A1, 단 외부 자동화/권한 상태를 함께 바꾸면 기존 authority 판정을 따른다.
- API는 raw evidence 전체를 기본 응답하지 않는다.

### 14.2 UI

Work Chat 중심을 유지한다. 대형 성장 대시보드를 첫 화면에 만들지 않는다.

필요한 표면:

1. 조용한 후보 카드
   - “이 방식을 다음에도 참고할까요?”
   - 근거가 된 작업 수
   - 적용 범위
   - 확인 / 이번만 / 사용하지 않기
2. 영향 설명
   - “지난번 승인한 정산 방식이 이 프로젝트와 맞아 참고했어요.”
3. 기억·성장 상세
   - 원리 문장
   - 어디에서만 적용되는지
   - 무엇을 근거로 배웠는지
   - 최근 효과
   - 수정 / 범위 축소 / 되돌리기
4. rollback 결과
   - “앞으로 영향이 없어요.”
   - 과거 기록은 감사용으로 남되 사용자 행동에는 영향 0.

사용자에게 노출하지 않을 기본 용어:

```text
T-cell, T-sphere, Wilson lower bound, M3, activation score, mutation
```

진단/개발자 면에서만 원문 용어를 볼 수 있다.

---

## 15. 구현 파일 지도

### 15.1 신규

```text
src/kernel/l0-evidence/tcell-observation.js
src/kernel/l1-intent/tcell-admission.js
src/kernel/l5-growth/tcell-core.js
src/kernel/l5-growth/tcell-extraction.js
src/kernel/l5-growth/tcell-scoring.js
src/kernel/l5-growth/t-sphere.js
src/kernel/l5-growth/tcell-replay.js
src/kernel/l5-growth/operating-principle-registry.js
src/kernel/l5-growth/pom-projection.js
src/kernel/l5-growth/tcell-delta.js
src/kernel/l5-growth/tcell-mutation.js
src/kernel/l5-growth/tcell-effect-audit.js
src/runtime/tcell-extractor.js
src/surface/tcell-store.js
src/surface/replay-store.js
src/surface/growth-audit-store.js
```

### 15.2 수정

```text
src/kernel/contracts.js
src/kernel/l0-evidence/ledger.js
src/kernel/l1-intent/context-mesh.js
src/kernel/l1-intent/task-context.js
src/kernel/turn.js
src/surface/server.js
src/surface/memory-store.js
src/surface/web/index.html
src/kernel/l5-growth/task-trace.js
src/kernel/l5-growth/skill-learning.js
src/kernel/l5-growth/automation.js
```

### 15.3 소유 경계

```text
L0: 관찰 사실과 source refs만. 원리 판단 금지.
L1: 현재 요청 admission만. 승격·통계 계산 금지.
L2: 기존 Authority A0~A3 판정. 티셀 maturity 소비 금지.
L3: 모델 추출 호출과 replay용 실행 격리.
L4: 후보·영향·승인·rollback 표면.
L5: 원리 생명주기·sphere·replay·통계·mutation·감사.
```

---

## 16. 단계별 작업 명세

### TG-0. 계약 봉인

작업:

- `contracts.js`에 ObservationEvent, TCellCore, ReplayCase, ReplayResult, TSphere JSDoc 추가
- maturity / influence / authority 분리 불변식 작성
- schemaVersion과 검증 함수 작성

검사:

- 필수 trace 없는 후보는 quarantined
- confidence 1.0이어도 authority를 바꾸지 못함
- 한 correction으로 radius project/global 생성 불가

완료 증거:

- 계약 단위 검사
- 반대 검사
- 기존 1065+ 전체 회귀(실행 시점 실제 숫자로 보고)

### TG-1. 관찰층 shadow mode

작업:

- ToolReceipt, 사용자 정정, 승인/거절, recovery, automation 결과를 ObservationEvent로 투영
- JSONL append와 privacy 마스킹
- turn hot path를 막지 않는 비동기/후처리 경로

검사:

- 관찰 생성 실패가 사용자 답변을 실패시키지 않음
- secret 원문 0건
- 같은 receipt 중복 이벤트 방지
- 영향 0

### TG-2. TCell Registry와 legacy adapter

작업:

- tcell-store와 POM read model
- 기존 memory promoted 항목 읽기 adapter
- DefaultTarget / Skill / Automation에 optional principleRefs

검사:

- 기존 파일 무변경으로 읽힘
- imported legacy가 M4로 과장되지 않음
- rollback이 과거 trace를 삭제하지 않음

### TG-3. 모델 기반 추출

작업:

- EvidenceBundle builder
- tcell extractor model call
- structured output validation
- duplicate/relation 판정
- 정규식 감지를 wake signal로 축소

검사:

- sourceRefs 밖 사실을 낸 후보 격리
- insufficient evidence가 정상 결과
- 한 사례 전역화 차단
- 모델 실패/timeout이 기본 대화를 막지 않음

### TG-4. Replay와 통계

작업:

- structural/historical/counterfactual/transfer/boundary replay
- baseline/candidate 비교
- Wilson lower bound와 effect counters
- 상태 전이 함수

검사:

- positive만 통과하면 승격 실패
- negative 정상 흐름을 망치면 실패
- authority case 실패면 격리
- 점수가 높아도 A2 자동 승인 0

### TG-5. POM admission과 실제 영향

작업:

- 현재 요청/active target/project/authority 기준 admission
- TaskContext `admittedPrinciples`
- principleTrace
- operating principle과 DefaultTarget부터 실제 제한 영향

검사:

- retrieved지만 미입장된 원리 영향 0
- 오래된 project 원리가 현재 project를 덮지 않음
- 현재 사용자 정정 즉시 우선
- 영향 후에도 외부 행동 authority 유지

### TG-6. T-sphere

작업:

- relation 저장
- same center 후보 경쟁
- split/merge/compression proposal
- compression trace descent

검사:

- 모순 후보를 한 sphere의 단일 원리로 조용히 합치지 않음
- 압축 후 원 근거로 하강 가능
- 압축 전후 replay 동등성
- 안정되지 않은 sphere 압축 금지

### TG-7. Self-Development

작업:

- delta 진단
- 제한된 mutation proposal
- simulate/replay/admit/apply/audit/rollback
- 자동 허용 mutation과 승인 필요 mutation 분리

검사:

- self-promotion 불가
- authority policy 자동 변경 불가
- 같은 실패 재발 시 soften/rollback
- 효과가 없으면 안정화하지 않음

### TG-8. 사용자 표면과 라이브 실증

작업:

- 후보 카드
- 영향 설명
- 기억·성장 상세
- 범위 축소와 rollback

검사:

- 모바일 340px 포함 잘림/겹침 없음
- 내부 용어 기본 노출 없음
- 승인 전 영향 0이 화면·원장·실제 행동에서 일치
- 재시작 후 상태 지속

---

## 17. 정본 시나리오

### S-TG-1. 명시적 선호

```text
사용자: "앞으로 이 프로젝트 정산은 표로 먼저 보여줘."
기대:
  기존 preference 후보(TCellCore 아님)
  project radius
  사용자 확인
  다음 관련 요청에서 supporting_context 또는 plan_hint
  다른 프로젝트에는 영향 0
```

### S-TG-2. 한 번의 정정

```text
사용자: "아니, 그 폴더 말고 이번 달 폴더."
기대:
  user_correction 관찰
  현재 task 즉시 수정
  전역 원리 자동 생성/승격 0
  반복 증거가 쌓일 때만 context-selection 후보
```

### S-TG-3. 여러 후보 중 조용한 오선택

```text
과거:
  "지난달 정산" 후보 5곳 중 하나를 조용히 선택해 우연히 성공
반복:
  다른 날 잘못된 폴더 선택, 사용자 정정
기대 원리 후보:
  "대상 후보가 여러 개이고 선택 근거가 약하면 선택 사실과 근거를 드러낸다."
검사:
  후보가 하나일 때 불필요한 질문을 늘리지 않음
  쓰기 전 대상 확인 강화
```

### S-TG-4. 승인 이유의 사실 보존

```text
관찰:
  프로세스 종료인데 파일 덮어쓰기 이유가 표시됨
원리 후보:
  "위층은 승인 등급만 올릴 수 있고 아래층의 실제 행동 종류와 이유를 바꾸지 않는다."
검사:
  파일 쓰기, 프로세스 종료, MCP 조회에 전이
  외부 전송 A2 자체는 약화하지 않음
```

### S-TG-5. 반복 정산 업무

```text
관찰:
  locate → list → read → calculate → preview → write가 여러 번 성공
기대:
  workflow T-sphere
  skill candidate와 principleRefs 연결
  다음 요청에서 계획 질문 감소
  파일 쓰기 승인은 그대로
```

### S-TG-6. 오래된 맥락 배제

```text
현재 프로젝트: GPAO-T5
과거 기억: BEAI 배포파일
사용자: "배포파일 확인해줘."
기대:
  current active target 우선
  오래된 기억은 answer_anchor 불가
  사용자가 "예전 BEAI 것"이라고 명시하면 다시 입장 가능
```

### S-TG-7. 자동화와 권한

```text
원리:
  "매주 월요일 정산 초안을 준비한다."
기대:
  초안 준비는 검증 후 제한 자동화 가능
  이메일 발송은 별도 A2 승인/지속 grant 필요
  maturity가 높아도 발송 권한 자동 획득 0
```

### S-TG-8. 실패 후 자가 수정

```text
M3 원리가 같은 실패를 두 번 재발
기대:
  softened
  원인 진단
  adjust_radius 또는 split_sphere mutation
  replay 후 제한 재적용
  효과 없으면 rollback
```

### S-TG-9. 압축 안전

```text
안정 T-cell 3개가 하나의 상위 원리로 압축
기대:
  압축 문장만 보아도 적용 조건 복원 가능
  원 T-cell과 raw sourceRefs로 하강 가능
  invalidWhen과 authority가 사라지면 압축 실패
```

---

## 18. 필수 테스트 파일

```text
test/tcell-core.test.js
test/tcell-observation.test.js
test/tcell-store.test.js
test/tcell-extraction.test.js
test/tcell-replay.test.js
test/tcell-scoring.test.js
test/tcell-admission.test.js
test/t-sphere.test.js
test/operating-principle-registry.test.js
test/pom-projection.test.js
test/tcell-mutation.test.js
test/tcell-effect-audit.test.js
test/tcell-legacy-migration.test.js
test/tcell-turn-integration.test.js
test/tcell-authority-invariants.test.js
test/tcell-compression-safety.test.js
test/tcell-live-scenario.test.js
```

모든 단계는 다음 증거 묶음을 남긴다.

1. 계약·단위 검사
2. 기존 전체 회귀
3. 일부러 깨 본 반대 검증
4. 실제 저장소 재시작 검증
5. 실제 모델 추출/판단 trace
6. 일반 사용자 문장 성공·빈 상태·실패/복구
7. 승인 거절·잘못된 과거 기억·다른 프로젝트 변수
8. 실제 웹 표면

증거 경로:

```text
docs/03-verification/evidence/tcell-governance/TG-<단계>/
```

---

## 19. 성능 예산

T-cell 느린 루프가 기본 대화를 막지 않는다.

초기 예산:

```text
turn hot path 추가 동기 CPU: p95 5ms 이하
turn hot path 추가 저장: ObservationEvent 1회 이하
기본 모델 입력 admitted principle: 최대 5개
원리별 사용자면 문장: 최대 1개
EvidenceBundle: 최대 12 observations
추출 모델 호출: 사용자 응답 완료 후 또는 idle queue
deep replay: 명시 검증 요청이 아니면 background
```

초과 시 원리 수를 무작정 늘리지 않는다. relevance와 influence role로 줄이고, 탈락 이유를 trace에 남긴다.

---

## 20. 지표

### 제품 지표

```text
active_target_accuracy
stale_context_override_rate
same_failure_recurrence_rate
user_correction_rate
unnecessary_clarification_rate
authority_violation_rate
rollback_success_rate
approved_principle_effect_rate
```

### 비용 지표

```text
prompt_tokens_added
extraction_tokens
replay_latency
storage_growth
cost_per_correct_action
task_packet_efficiency
```

### 절대 바닥

```text
authority_violation_rate = 0
unapproved_durable_promotion = 0
current_request_override = 0
secret_in_growth_store = 0
trace_descent_failure for admitted principle = 0
```

---

## 21. 금지 구현

- `confidence > 0.8`이면 자동 실행 같은 단일 점수 권한 부여
- 사용자 한 번의 정정을 global 원리로 저장
- retrieved memory를 그대로 model answer-anchor로 주입
- replay를 JSON 필드 존재 검사로만 끝내기
- 서비스 이름별 원리 if 사다리
- 모델 출력 문장을 그대로 durable store에 저장
- 기존 memory/skill/automation store를 한 PR에서 전면 교체
- raw 대화와 비밀값을 growth store에 복제
- 효과 감사 없이 M4 stable 유지
- rollback 시 trace까지 삭제
- 원리 설명을 모델 시스템 프롬프트의 영구 금지문으로 변환
- 실제 모델·실제 UI 없이 완료 선언

---

## 22. 구현자가 내려야 할 결정과 내려서는 안 되는 결정

### 이미 이 문서가 결정한 것

- 데이터 계약과 상태 축
- maturity / influence / authority 분리
- 저장 방식의 기본 형태
- 모듈 소유 경계
- replay 최소 구성
- 통계 함수와 초기 임계값
- migration 순서
- API 기본 경로
- 사용자 표면의 역할
- 단계 의존성과 완료 증거

### 구현 중 증거에 따라 조정 가능한 것

- 함수 내부 알고리즘
- EvidenceBundle 묶음의 세부 휴리스틱
- 모델 추출 프롬프트의 짧은 표현
- UI의 정확한 배치와 문구
- 성능 예산 안의 batch 크기

### 오너 또는 별도 승인 없이 바꾸면 안 되는 것

- 상위 T5 철학
- 현재 요청 우선
- broad memory, narrow influence
- A0~A3 권한 경계
- durable 승격의 사용자 확인
- trace/replay/rollback 의무
- P-OP 우선순위
- 모델 판단과 OS 사실 공급의 역할 분리

---

## 23. Definition of Done

아래가 모두 확인돼야 완료다.

```text
[ ] P-OP 원장이 ObservationEvent로 손실 없이 투영된다.
[ ] 미승격 후보는 실제 모델 판단과 행동에 영향 0이다.
[ ] 후보는 principle/center/boundary/trace/replay를 가진다.
[ ] 같은 중심의 후보가 관계·경쟁하며 조용히 덮어쓰지 않는다.
[ ] positive/negative/boundary/authority replay가 실제로 실행된다.
[ ] maturity, influence, authority가 코드·저장·UI에서 분리된다.
[ ] POM projection과 TCellCore가 분리되고, 이번 요청에 맞는 확인된 항목만 입장한다.
[ ] 어떤 원리가 왜 영향을 줬는지 trace로 설명 가능하다.
[ ] 실사용 결과가 원리의 통계와 상태를 갱신한다.
[ ] 반복 실패는 soften/mutation/rollback으로 이어진다.
[ ] 압축된 원리에서 원 근거로 내려갈 수 있다.
[ ] 기존 memory/skill/default target/automation 흐름이 회귀하지 않는다.
[ ] 실제 모델·실제 UI·재시작·rollback 시나리오를 통과한다.
[ ] authority violation, 숨은 durable promotion, current request override가 0이다.
```

완료 보고는 반드시 나눈다.

```text
계약 구현
단위/회귀 게이트
실제 저장·재시작
실제 모델 추출
실제 POM 영향
실제 사용자 UI
실제 자동화/외부 행동
미검증·잔여
```

---

## 24. 착수 순서

현재 최우선 P-OP A~H를 계속 닫는다. 동시에 가능한 것은 TG-0 계약 봉인과 TG-1의 영향 0 관찰 설계까지다.
실제 원리 영향 활성화는 다음 순서로 진행한다.

```text
P-OP 핵심 시나리오와 원장 신뢰성 확보
→ TG-0 계약
→ TG-1 shadow observation
→ TG-2 registry/legacy adapter
→ TG-3 model extraction
→ TG-4 replay/statistics
→ TG-5 operating-principle/default-target limited influence
→ TG-6 sphere/compression
→ TG-7 self-development
→ TG-8 user surface/live proof
```

첫 코드 작업은 `TG-0`이다. 첫 사용자 체감 작업은 `TG-5`다. 첫 자가성장 주장은 `TG-7`을 실제 결과 감사까지
통과한 뒤에만 할 수 있다.

---

## 25. 구현 인계 문장

> 이 명세를 구현할 때 새 학습 기능을 덧붙인다고 생각하지 않는다. P-OP와 Truth Ledger가 제공하는 현실,
> Context Mesh의 좁은 입장, POM의 검증된 원리, Automation의 실행과 복구를 하나의 성장 폐회로로 연결한다.
> 모델은 원리를 해석하고 제안한다. T5 OS는 근거·범위·replay·통계·권한·적용·rollback을 책임진다.
> 통계는 원리의 정밀도를 높이지만 권한을 대신하지 않는다. 목표는 사용자가 규칙을 관리하게 만드는 것이
> 아니라, T5가 실제 경험에서 더 정확해지면서도 현재 사용자와 현재 목적을 놓치지 않게 만드는 것이다.
