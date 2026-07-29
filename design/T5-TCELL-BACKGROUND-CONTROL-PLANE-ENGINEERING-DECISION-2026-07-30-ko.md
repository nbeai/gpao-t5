# T5 T-cell 백그라운드 제어면 엔지니어링 결정

- 상태: `normative_runtime_decision`
- 날짜: 2026-07-30
- 대상: TG-1~TG-5 생산 경로
- 참고 구현: Hermes Agent `a61183b56fdb45b9d2a0f2f6b8482e665ccf702f`
- T5 대조 기준선: `e1cb07a`
- 제품 구현 소유자: Claude 단일 구현선
- 독립 감사·통합 소유자: Codex

이 문서는 경쟁 제품을 설명하는 조사 보고서가 아니다. Hermes의 실제 호출 경로와 실패 방어를
실행해 보고, T5의 생산 코드가 어디서 같은 문제를 더 잘 풀어야 하는지 고정한 런타임 결정이다.

## 1. 결론

T-cell은 **사용자 턴 앞에서 판단을 단속하는 엔진**이 아니다.

T-cell은 뒤에서 관찰·추출·replay·승격·효과 감사를 수행하는 **성장 제어면(control plane)** 이고,
사용자 턴에는 이미 검증되어 메모리에 게시된 작은 스냅샷만 공급하는 **보조 데이터면(data plane)** 이다.

```text
사용자 턴
  → 현재 요청·POM·명시 지시·도구 현실 조립
  → 메모리의 T-cell 게시 스냅샷 조회(무 I/O, 무 모델, 무 replay)
  → 최대 5개 soft principle을 모델 현실에 추가
  → 기존 ActionPlan / Authority / Grant / ToolRunner
  → 사용자 응답

응답 완료 뒤
  → Observation append
  → 세션별 직렬 성장 큐
  → 모델 추출
  → replay case 생산·검증
  → M1 → M2/M3 전이
  → effect audit / rollback
  → 범위별 불변 게시 스냅샷 교체
```

명시적 사용자 지시는 T-cell이 배울 때까지 기다리지 않는다. 현재 요청/POM 레인에서 즉시 효력이
생긴다. T-cell은 그 경험을 뒤에서 일반화할 뿐이다.

안전도 T-cell이 대화 앞에서 질문을 늘려 확보하지 않는다. 전송·삭제·결제·게시·권한 확대의
실행 순간을 기존 Authority/Grant/Truth Ledger가 지킨다.

### 1.1 경쟁력 불변식

창의적인 새 구조를 만든다는 이유로 이미 생산 환경에서 검증된 기술과 운영 원리를 다시 발명하거나
무시하지 않는다. 경쟁 제품의 설명문이 아니라 실제 코드·호출 경로·실패 방어·검사를 실행해 다음
세 가지로 판정한다.

1. 잘 작동하는 구조는 T5의 사실·권한·원장 계약에 맞게 흡수한다.
2. T5가 더 나은 사용자 경험과 실제 성과를 만들 수 있는 부분은 측정 가능한 우위로 강화한다.
3. 더 새롭다는 이유만으로 질문·승인·검사·대기 시간을 늘리는 설계는 채택하지 않는다.

AI의 기본 책임은 최소 안전 바닥 안에서 사용자가 맡긴 일을 최대한 스스로 끝내는 것이다. 새 승인,
확인 질문, 검열, 사용자 개입을 추가하려면 반드시 어떤 비가역 행동·외부 효과·권한 확대를 막는지
기존 계약으로 설명되어야 한다. 설명할 수 없다면 안전 기능이 아니라 제품 마찰 회귀다.

## 2. 실제로 확인한 Hermes 실행 구조

### 2.1 응답 이후 학습 fork

Hermes는 턴 종료 뒤 memory/skill review를 별도 worker에서 실행한다.

- `agent/turn_finalizer.py:641-654`: 외부 기억 sync/prefetch와 background review를 턴 종료 뒤 시작한다.
- `agent/background_review.py:620-646`: background worker와 위험 명령 자동 거절.
- `agent/background_review.py:675-689`: 외부 memory provider 접근을 끈다.
- `agent/background_review.py:729-756`: 쓰기 출처를 background로 표시하고 사용자 세션 persistence를 끈다.
- `agent/background_review.py:790-807`: 부모 세션 종료와 압축을 금지한다.
- `agent/background_review.py:809-861`: runtime whitelist로 memory/skill 도구만 허용한다.
- `agent/background_review.py:882-928`: 성공한 학습 결과만 요약하고 실패는 사용자 턴과 분리한다.

이 구조가 해결하는 실제 결함도 코드 주석에 남아 있다. background review가 부모 세션에 harness
문장을 기록해 다음 턴의 agent가 curator처럼 행동했던 결함, 외부 memory namespace를 오염시킨 결함,
부모 세션을 중간에 finalize/compress한 결함이다.

### 2.2 순서가 보장된 background memory 작업

- `agent/memory_manager.py:597-622`: 다음 턴 prefetch를 background executor에 넣는다.
- `agent/memory_manager.py:638-757`: sync와 prefetch를 단일 worker로 순서화하고 호출자를 막지 않는다.
- `agent/memory_manager.py:760-780`: 종료 시 bounded drain.

다만 `agent/memory_manager.py:525-592`의 현재 턴 external recall은 provider별 최대 8초를 기다린다.
이 경로는 T5가 흡수하지 않는다. T5의 기본 턴은 외부 recall을 기다리지 않는다.

### 2.3 prompt와 skill의 progressive disclosure

- `AGENTS.md:19-27`: 대화 중 system prompt/toolset을 바꾸지 않고 core tool schema를 작게 유지한다.
- `agent/system_prompt.py:160-162, 294-324`: session 시작의 skill index를 고정하고 prompt cache를 유지한다.
- `agent/prompt_builder.py:1320-1536`: skill index snapshot과 on-demand `skill_view`.
- `agent/subdirectory_hints.py`: 실제로 접근한 작업 경로에서만 하위 지시 문서를 발견한다.

실제 skill 내용은 필요할 때만 읽는 구조는 흡수한다. 하지만
`agent/prompt_builder.py:1740-1741`의 “부분적으로 관련돼도 반드시 skill을 읽어라”는 강제 문구는
흡수하지 않는다. T5에서는 관련성·비용·현재 요청을 함께 보고 모델이 고르게 한다.

### 2.4 실행한 Hermes 검사

Hermes 저장소의 pinned 환경으로 다음 테스트를 직접 실행했다.

```text
background toolset / session isolation / async memory / write approval
→ 62 passed

background review / cost control / curator / memory tool
→ 175 passed
```

검증한 계약은 persistence isolation, runtime tool whitelist, 비동기 sync 순서, 위험 명령 자동 거절,
write approval, curator 보호 범위, memory atomic write다.

### 2.5 학습 결과의 사용자 통제와 유지 관리

추가로 `agent/learning_graph.py`, `agent/learning_mutations.py`, `agent/curator.py`,
`tools/memory_tool.py`와 관련 검사를 실행했다.

- learning graph와 mutation 전체: `37 passed`
- curator의 learning/mutation/automatic/dry-run/pin/cron 선별: `43 passed`

코드 사실:

- `agent/learning_graph.py:193-321`: memory 조각과 learned skill을 같은 그래프의 노드로 투영한다.
- `agent/learning_mutations.py:12-15, 124-200`: CLI/TUI/GUI가 같은 edit/delete 경계를 쓰고,
  skill 삭제는 복구 가능한 archive다.
- `tools/memory_tool.py:140, 814-815`: `MEMORY.md` 2,200자, `USER.md` 1,375자 active budget.
- `tools/write_approval.py:234-274`: write 결과는 allow/block/stage 세 값이다. 단 기본 설정은
  approval OFF라 자동 allow이고, gate를 켰을 때 stage/inline decision이 활성화된다.
- `agent/curator.py:239-282`: 첫 관찰 시각부터 interval을 재고, 기본 7일 주기와 idle 조건으로 깨어난다.
- `agent/curator.py:290-374`: pinned와 cron 참조는 자동 전이에서 제외하고, `use_count == 0`은
  노후 증거로 쓰지 않는다.
- `agent/curator.py:1499-1584`: dry-run은 같은 판정 경로와 보고서 형식을 사용하지만 실제 mutation과
  시계 전진은 하지 않는다.

T5는 이 표면을 그대로 복사하지 않는다. 대신 학습된 원리를 기본 화면을 방해하지 않는 설정의
“배운 방식”에서 보고, 수정·고정·일시정지·범위 축소·되돌리기·복원할 수 있게 한다.

## 3. T5 현재 생산 경로의 코드 사실

`npm run audit:tcell-plane`은 다음을 현재 코드에서 직접 검출한다.

```text
GAP  foreground_no_durable_io
     snapshot=true storeReads=true

GAP  background_per_session_lane
     detached=true perSession=false globalLock=true rawUserText=false

GAP  m1_replay_m2_production_lifecycle
     transitionConsumers=0 replayCaseConsumers=0 legacyImportConsumers=0
```

근거:

- `src/kernel/turn.js:278-305, 530-534`
  - 모델 호출 전에 `buildAdmissionSnapshot()`을 기다린다.
- `src/kernel/l1-intent/tcell-admission.js:420-482`
  - 그 호출은 registry, evidence, confirmation, grant 저장소를 읽는다.
- `src/surface/server.js:127-190`
  - 추출은 사용자 응답과 분리돼 있으나 서버 전체 전역 `추출중` 하나를 쓴다.
  - 한 대화의 추출 중 다른 대화가 깨우면 `in_flight`로 버려진다.
- `src/kernel/l5-growth/tcell-replay-engine.js:492`
  - `transitionCell()`은 정의와 검사에만 있고 `src/` 생산 소비자는 없다.
- `src/kernel/l5-growth/tcell-replay.js:30`
  - `makeReplayCase()`도 생산 소비자가 없다.
- `src/surface/tcell-store.js:388`
  - `importLegacyMemory()`도 생산 소비자가 없다.

따라서 현재 실제 수명주기는 `관찰 → M1 후보 저장 → 다음 턴 조회 → 성숙도 부족 거절`에서 끝난다.
TG-5B를 열어도 성장한 원리가 들어오는 제품 경로가 없으므로, 입장 규칙만 더 복잡해지고 사용자
성능은 좋아지지 않는다.

2026-07-30 Claude dirty worktree도 같은 감사기로 별도 읽었다. 세션별 `Map`을 도입해 전역 추출
잠금은 제거 중이지만, 대신 `input.text` 원문이 extraction bundle로 직접 들어가는 미검증 변경이
있다. foreground durable I/O와 M1→M2 생산 소비자 0은 그대로다. 이 dirty 관찰은 구현 완료 증거가
아니며, 제출 때 비밀·일반 원문 비유입 반대시험으로 판정해야 한다.

## 4. 흡수할 것

### A. 응답과 성장 작업의 생명주기 격리

성장 worker는 사용자 session transcript를 쓰거나 finalize/compress하지 않는다. 실패·timeout·재시작은
사용자 답을 실패시키지 않는다.

### B. 세션별 직렬 큐

같은 세션의 관찰 순서를 보존하고 다른 세션은 병렬 처리한다. 전역 잠금은 금지한다. wake를 합칠 때도
관찰 참조를 잃지 않는다.

### C. 능력 whitelist

추출·replay worker는 terminal, send, file write, browser, connector를 호출할 수 없다. 읽기 전용
evidence/registry와 전용 모델 호출만 가진다. replay는 실제 외부 행동을 실행하지 않는다.

### D. prompt-cache 안정성과 progressive disclosure

성장 결과 때문에 진행 중 대화의 system prompt와 tool schema를 다시 만들지 않는다. 게시 스냅샷은
다음 턴의 작은 volatile context로 들어가고, skill 본문은 실제 선택 뒤에만 읽는다.

### E. read-before-write, provenance, recoverable retirement

원리를 바꾸거나 합칠 때 기존 원리와 근거를 먼저 읽는다. 사용자 pin과 원문 provenance를 보존한다.
삭제 대신 rollback/archive를 기본으로 한다.

### F. 별도 저비용 모델 선택

성장 모델은 main model과 같을 수도, 별도 모델일 수도 있다. 어떤 경우든 실제 provider/model 신분을
원장에 기록한다. 다른 모델이면 전체 대화 대신 비밀 제거 EvidenceBundle만 보낸다.

### G. 학습 결과의 사용자 소유권

학습된 원리는 숨은 내부 상태로만 남지 않는다. 사용자는 사람말 문장과 적용 범위로 원리를 보고,
수정·고정·일시정지·되돌리기·복원할 수 있다. 일반 대화에는 카드를 남발하지 않고 설정의 한 표면이
memory, learned principle, skill의 관계를 함께 보여준다.

### H. bounded active set

무한히 커지는 active registry를 허용하지 않는다. 모델 입력은 기존 계약대로 최대 5개이며, active
원리 저장소도 명시적인 byte/count budget과 사용량을 가져야 한다. 근거 원장은 별도 보존하되 active
budget을 넘는 항목은 자동 삭제가 아니라 archive/compaction 후보가 된다.

### I. 증거에 근거한 curator

사용되지 않음은 노후 증거가 아니다. first-seen grace, 사용자 pin, 자동화/cron 참조, 최근 효과,
rollback 이력을 함께 본다. curator는 idle에서만 돌고, 실제 mutation 전 같은 판정 파이프라인의
dry-run 보고서를 만들 수 있다.

## 5. 흡수하지 않을 것

1. 현재 턴에서 external memory provider를 최대 8초 기다리는 경로.
2. 부분적으로 관련되기만 해도 skill을 반드시 읽으라는 prompt 강제.
3. write approval 기본 OFF를 아무 구분 없이 복사해 비밀·민감·권한·전역화까지 즉시 영향 주는 정책.
4. “대부분의 세션은 skill을 고쳐야 한다”는 생산량 목표.
5. T-cell 후보·trace·승격을 매번 카드로 노출하는 UI.
6. `use_count == 0`이나 오래 보이지 않았다는 이유만으로 학습을 자동 삭제하는 정책.

Hermes의 기본 OFF가 주는 매끄러움은 흡수한다. 비밀이 아닌 명시 기억과 저위험·범위 제한 학습은
사전 승인 없이 반영하고 archive/rollback/user control로 보호한다. 민감 정보·정체성·권한·전역화만
자동 영향을 닫는다.

T5의 우위는 더 많이 멈추는 데 있지 않다. 명시 지시는 즉시 따르고, 저위험 추정 학습은 뒤에서
검증·제한 반영하며, 실제 외부 행동과 새 권한만 authority가 지키는 데 있다.

## 6. 런타임 불변식

### 사용자 턴 데이터면

1. 모델·네트워크·파일 파싱·replay·registry mutation 0.
2. 서버 수명 안에서 게시된 immutable scope snapshot만 읽는다.
3. snapshot miss/손상/만료는 T-cell 도움 0으로 끝나며 대화를 막지 않는다.
4. 최대 5개, 사용자 현재 지시보다 낮은 `supporting_context/default_value/plan_hint`만 제공한다.
5. T-cell은 승인 요구를 새로 만들지 않는다.
6. A2/A3 실행은 기존 ActionPlan/Authority/Grant가 재검증한다.

### 백그라운드 성장 제어면

1. Observation append 성공 뒤에만 checkpoint를 전진한다.
2. 세션별 FIFO, 세션 간 병렬.
3. 중복 wake는 합칠 수 있지만 evidence ref는 합집합으로 보존한다.
4. worker 재시작 뒤 미처리 checkpoint부터 재개한다.
5. secret은 어떤 성장 모델에도 보내지 않는다. 일반 사용자 문장은 **신뢰 경계별로** 다룬다.
   - 현재 대화와 같은 provider/model/credential 경계: secret 제거 뒤 필요한 턴 범위의 원문을
     일시적으로 사용할 수 있다. 저장되는 T-cell에는 원문 대신 refs·요약·digest만 남긴다.
   - 다른 provider의 auxiliary model: 구조화 EvidenceBundle 또는 digest만 보낸다. 원문 전송은
     별도 사용자 선택 없이는 금지한다.
   - local model: 같은 로컬 데이터 경계 안에서 bounded 원문 사용 가능.
6. M1 → replay case → verified packet → `transitionCell()` → M2/M3가 하나의 생산 계보로 이어진다.
7. 승격 뒤 scope별 게시 스냅샷을 원자 교체한다.
8. effect audit가 정확도와 마찰을 함께 보고 softened/rollback을 수행한다.
9. active budget 초과는 삭제가 아니라 archive/compaction 제안으로 처리한다.
10. `use_count == 0`, 첫 관찰 직후, pin, automation 참조 항목은 staleness 단독 근거로 내리지 않는다.

## 7. TG-5 진입 순서

TG-0~4를 폐기하지 않는다. 지금 만든 계약을 아래 생산 계보로 연결한다.

1. 전역 `추출중`을 세션별 성장 큐와 지속 checkpoint로 교체.
2. background worker의 session/tool/persistence 격리.
3. replay case 생산자와 `transitionCell()` 소비자를 실제 계보에 연결.
4. `importLegacyMemory()`를 1회성 migration 경계에 연결.
5. M2/M3만 포함하는 scope별 immutable 게시 스냅샷 생산.
6. 사용자 턴의 `buildAdmissionSnapshot()` durable I/O를 제거하고 게시 스냅샷 참조로 교체.
7. TG-5A shadow에서 실제 `admittedPrinciples`를 모델 volatile context에 주입.
8. “배운 방식” 사용자 표면에서 원리 보기·수정·고정·일시정지·범위 축소·되돌리기·복원.
9. 안전한 읽기·정리·도구 선택·초안에서 질문/클릭/완료 턴이 줄었는지 인간 시나리오로 검증.

## 8. 종료 검사

### 구조

- foreground에서 model/network/fs/replay/mutation 호출 0.
- 세션 A 성장 중 세션 B wake가 유실되지 않음.
- worker가 terminal/send/file-write/browser tool을 호출하려 하면 runtime 거부.
- background harness 문장이 user transcript와 external memory namespace에 0건.
- 같은 provider 성장 호출은 secret 제거 원문을 사용할 수 있으나 저장 상태에는 원문 0건.
- 다른 provider 성장 호출의 request body에는 원문 0건.

### 수명주기

- 자연어 경험 → Observation → M1 → replay → M2 → 게시 snapshot → 다음 턴 admission.
- negative/boundary case 실패 → 승격 0.
- 재시작 중단 → 미처리 checkpoint부터 정확히 한 번.
- rollback → 게시 snapshot에서 즉시 제거, 다음 턴 영향 0.
- active budget 초과 → archive/compaction 후보, 근거 삭제 0.
- pin/automation 참조/never-used grace → 자동 archive 0.

### 사용자 통제

- 원리 목록에서 사람이 읽는 문장·범위·최근 효과를 확인.
- 수정 뒤 새 버전과 이전 버전의 rollback trace 보존.
- pause/rollback 뒤 다음 턴 snapshot에서 즉시 제외.
- archive 뒤 restore 가능.
- 일반 대화에서 후보 카드가 작업 흐름을 점유하지 않음.

### 인간 성능

- T-cell OFF/ON으로 같은 10개 업무를 비교한다.
- 안전 바닥 안 업무의 median turns, unnecessary confirmations, user intervention이 증가하면 실패.
- 외부 행동 authority violation 0.
- 긴 성장 작업 중 사용자 대화 첫 진행 표시와 최종 응답 지연이 기준선보다 악화되면 실패.

## 9. 파일 소유권

Claude 단일 구현선:

- `src/kernel/l0-evidence/tcell-*`
- `src/kernel/l1-intent/tcell-*`
- `src/kernel/l5-growth/tcell-*`
- `src/runtime/tcell-*`
- `src/surface/tcell-*`
- 관련 생산 배선과 제품 검사

Codex 독립 감사선:

- `scripts/audit-tcell-runtime-plane.mjs`
- `test/tcell-runtime-plane-audit.test.js`
- 이 결정과 정본 명세·인수인계의 사실 갱신
- 구현 제출 뒤 실제 실행·성능·인간 시나리오 판정

TG-5B는 이 문서 §8의 구조·수명주기 종료 조건이 닫히기 전에는 실제 영향 단계로 올리지 않는다.

## 10. 게시 스냅샷 생산·소비 계약

이 절은 §6의 “게시된 immutable scope snapshot”을 실제 코드로 연결하는 정본이다.

### 10.1 데이터

```js
PublishedPrincipleSnapshot = {
  schemaVersion,
  revision,
  scope: { kind, id },
  publishedAt,
  sourceRegistryRevision,
  principles: [{
    cellId,
    cellVersion,
    role,             // supporting_context | default_value | plan_hint
    principle,        // 비밀 제거된 사람말
    binding,          // 검증된 FACT_ATOM id
    validWhen,
    invalidWhen,
    sourceRefs,       // 저장 근거 참조, 원문 아님
  }],
}
```

불변식:

- `principles`는 M2/M3 중 현재 scope에 입장 가능한 항목 최대 5개다.
- A2/A3 권한·새 외부 대상·비밀 원문·사용자 원문·모델 자격은 싣지 않는다.
- 객체와 내부 배열은 게시 전에 동결하고, 게시 뒤 제자리 수정하지 않는다.
- 같은 scope의 새 revision은 **완성된 한 벌을 원자 교체**한다. 부분 갱신은 없다.

### 10.2 생산자와 교체 시점

소유자는 **응답 뒤 세션별 background growth worker 하나**다.

```text
Observation append 성공
→ extraction/M1 저장
→ replay/transition 완료
→ rollback·pause·archive·restore 반영
→ registry를 scope별로 투영
→ publish(scopeKey, frozenSnapshot)
```

다음 사건에서만 새 revision을 게시한다.

- M2/M3 진입 또는 내용·범위·role 변경
- pause·rollback·archive·restore
- 사용자 수정·고정·범위 축소
- 시작 시 background bootstrap이 durable registry를 복원한 뒤

bootstrap 완료 전 첫 턴을 기다리게 하지 않는다. 그동안 snapshot miss로 동작한다.

### 10.3 전경 소비자

`runTurn`은 실제 project/subject anchor로 `scopeKey`를 만든 뒤 서버 메모리의
`principleSnapshotStore.read(scopeKey)`를 **동기 조회**한다.

```text
runTurn
→ in-memory read(scopeKey)
→ current request/POM/explicit instruction과 충돌 제거
→ 최대 5개 soft principle을 volatile model context에 추가
→ 기존 ActionPlan/Authority/ToolRunner
```

전경에서 금지:

- `TCellRegistry.load()`
- observation/confirmation/grant 파일 읽기
- replay·transition·snapshot mutation
- 성장 모델 호출
- snapshot 준비를 기다리는 `await`

miss·stale·schema 불량·scope 불일치는 `principles: []`로 끝나며 `principleTrace.reason`에 코드만
남긴다. 대화 실패·사용자 카드·복구 질문을 만들지 않는다.

### 10.4 구현 관통 검사

- 세포가 있어도 `runTurn`의 fs/model/replay 호출 증가 0
- 서버 시작 직후 snapshot miss에서도 답 정상
- M2 게시 뒤 다음 턴에만 원리 입장
- rollback/pause 뒤 다음 턴 입장 0
- project A snapshot이 project B에 입장 0
- ON/OFF에서 원리와 무관한 요청의 메시지·도구·답 동일

## 11. ReplayCase 생산과 M1→M2/M3 계약

`makeReplayCase()`와 `transitionCell()`은 검사 전용 함수가 아니다. background growth worker가 아래
생산 경로에서 실제로 소비한다.

```text
새 ObservationEvent refs
→ M1 후보
→ ReplayCaseProducer
→ positive / negative / boundary 사례
→ VerifiedReplayPacket
→ transitionCell()
→ registry 원자 저장
→ §10 snapshot 재게시
```

### 11.1 사례의 근거

- 모든 case는 observation/effect/confirmation/authority 원장의 **실재 ref**를 가진다.
- 호출자가 준 `passed`, `confirmed`, `executed` 불리언을 증거로 쓰지 않는다.
- positive: 원리가 성립해야 하는 같은 scope의 저장 관찰.
- negative: 원리가 적용되지 않아야 하는 다른 대상·조건 또는 사용자 정정·rollback 근거.
- boundary: 비밀·민감·권한·외부 효과·scope 경계를 넘지 않아야 하는 저장 근거와 결정적 fixture.
- 최소 사례가 없으면 `insufficient_evidence`이고 M1에 남는다. 사용자에게 보강 카드를 띄우지 않는다.

### 11.2 FACT_ATOMS의 역할

`FACT_ATOMS`는 한국어 키워드 분류기가 아니다.

- OS가 실제 턴 사실을 만들 때 안정된 atom id를 생산한다.
- extraction 모델은 자연어 `validWhen/invalidWhen`을 허용된 atom id에 결합한다.
- OS는 모델이 새 atom을 만들지 않았는지와 ref 계보만 검증한다.
- atom 추가는 `turn-facts` 생산자·추출 어휘·replay fixture·admission 소비자를 한 변경으로 잇는다.
- 문장 완전 일치나 정규식으로 의미 결합을 대신하지 않는다.

사용자 문장은 `server.js`에서 extraction bundle로 직접 복사하지 않는다.
`buildGrowthInput({text, sourceModelIdentity, growthModelIdentity})` 한 경계가 다음을 판정한다.

- 같은 provider/model/credential: secret 제거 bounded `ephemeralText` 허용
- 다른 provider: `EvidenceBundle`/digest만, 원문 0
- 저장 상태: 두 경우 모두 사용자 원문 0

모델 신분은 역할 이름이 아니라 실제 요청 대상과 provider 응답으로 확인한다.

### 11.3 실행 격리

replay는 실제 terminal/send/file-write/browser/connector를 실행하지 않는다. 저장된 사실과 결정적
counterfactual만 평가한다. 실제 효과 평가는 이후 정상 사용자 실행의 Truth Ledger가 Observation으로
돌아와 갱신한다.

### 11.4 구현 관통 검사

- 자연어 경험 하나가 실제 M1을 만들고, 근거 부족이면 그대로 유지
- 충분한 positive/negative/boundary refs가 생기면 `transitionCell()` 생산 호출 1회
- 위조 ref·다른 세포 계보·실행 증거 부재면 승격 0
- M2/M3 전이 뒤 registry revision과 snapshot revision이 함께 전진
- 재시작 뒤 checkpoint에서 정확히 한 번 재개
- 외부 도구 실행 0

## 12. 가역 학습 자동 반영 계약

다음 네 조건을 **모두** 만족하면 기억·원리·스킬 변경은 사전 승인 없이 자동 반영한다.

1. **가역성**: 이전 버전·원장·rollback 또는 archive/restore 경로가 실제로 존재한다.
2. **영향 한계**: A0/A1의 읽기·정리·초안·도구 선택·표현 선호 안이며 외부 전송·삭제·결제·게시·
   새 권한을 만들지 않는다.
3. **범위 확정**: 사용자가 밝힌 scope이거나 replay로 검증된 좁은 task/project scope다.
4. **사용자 소유권**: 설정의 통합 “배운 방식” 표면에서 사람말로 보고 수정·고정·일시정지·범위 축소·
   되돌리기·복원할 수 있다.

자동 영향을 금지하는 것은 다음뿐이다.

- 비밀 원문·민감 개인정보를 일반 기억에 저장
- 정체성·권한·외부 대상·project/profile/global 범위를 근거 없이 추정
- A2/A3 행동 권한을 학습 상태가 새로 만듦
- 현재 명시 지시와 충돌

금지된 항목은 학습 순간 승인 카드로 올리지 않는다. 영향 0 관찰/M1로 남기거나 폐기하고, 실제
행동·권한 경계가 나타날 때만 기존 Authority가 최소 확인한다.

### 12.1 명시 기억의 첫 제품 슬라이스

```text
"이건 기억해둬 / 앞으로 보고서는 목록으로 줘"
→ 비밀·민감 경계 확인
→ 밝힌 scope에 durable 반영
→ 원장 기록
→ 다음 관련 요청에 적용
→ 설정 › 배운 방식에서 수정·pause·rollback
```

같은 내용을 후보 카드로 다시 묻지 않는다. 완료 증거는 “승인 0”만이 아니라 실제 다음 요청 반영,
현재 지시 우선, rollback 뒤 영향 0까지다.

### 12.2 옛 검사 재분류 행렬

기존 승인 검사는 삭제부터 하지 않는다. 각 시나리오를 아래 네 축으로 기록한다.

| 축 | 값 |
|---|---|
| 외부성 | local / external |
| 가역성 | reversible / destructive / unknown |
| 지시 | explicit / inferred |
| 권한 | unchanged / expanded |

`local + reversible + explicit + unchanged`는 A1 자동으로 재분류한다. `external`, `destructive`,
`expanded` 중 하나가 있으면 실제 행동 경계를 유지한다. `unknown`은 사용자 카드가 아니라 사실
수집으로 해소한다.
