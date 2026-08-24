# T5 2차 완성 — 초장기 Context·Work 내구성 보강

상태: `SECOND_COMPLETION_REFERENCE · NOT IMPLEMENTED`

현재 개발 정본은 `T5-SECOND-COMPLETION.md`, 제품 정의는 `T5-PRODUCT.md`다. 이 문서는 두 정본을
대체하지 않고, 초장기 대화·거대 Context·여러 Work·반복 checkpoint의 완료 조건을 빠뜨리지 않기 위한
기술 보강 자료다.

## 1. 제품 완료 문장

> 사용자는 대화 길이·Context·checkpoint·Memory·모델 전환을 관리하지 않는다. T5는 수백~수천 turn과
> 여러 사용자 목적이 섞여도 현재 Work·교정·결정·Evidence를 정확히 유지하고, 오래된 현실은 원문을
> 잃지 않은 채 작게 투영하며, 필요할 때 정확히 회수해 비교군과 동등 이상의 깊이·정확성·복구력을 낸다.

일반 사용자용이라는 이유로 장기 작업 능력을 줄이지 않는다. 단순한 사용자 표면은 T5가 내부 복잡성을
흡수해 만드는 것이며, 낮은 상한·기능 미노출·과도한 요약으로 사는 것이 아니다.

## 2. 현재 이미 선 기반

- append-only `ConversationLedger·RunLedger·ResourceLedger`
- canonical Conversation과 provider projection 분리
- exact sessionId·messageId recall
- 사용자 메시지·교정 inline 유지
- 동일 읽기 Evidence 최신 원문과 canonical Receipt 보존
- 모델 선택 뒤 Hand family·dependency·recovery focus
- checkpoint·compaction·auxiliary call 자원 회계
- Evidence의 new·repeated·none과 retry·unknown 구분
- ephemeral Resource Situation

이 기반은 폐기하거나 다시 만들 대상이 아니다. 장기 운용층은 이 identity·projection·recall 계약 위에
추가한다.

## 3. 현재 명시적으로 부족한 것

- 사용자 메시지가 수백·수천 turn 누적될 때의 모델 시야 계약
- 여러 Work가 한 Conversation에 섞인 경우의 epoch·revision·우선순위
- 완료·보류·취소 Work를 현재 Work Context에서 내리는 방법
- 반복 checkpoint·projection·compaction 뒤 exact 교정·결정·식별자 보존
- 초반·중간·후반 사용자 교정 충돌과 최신 교정 우선
- 대형 ToolReceipt·이미지·문서 관측의 장기 demotion·recall
- projection·checkpoint 자체의 비용·실패·anti-thrash
- projection 실패 시 raw 전체 Context 재팽창 방지
- restart·모델 전환 뒤 같은 Work 복원
- OpenClaw·Hermes와 동일 초장기 과업 비교와 Release soak

현재 T5는 중형 실제 과업에서 Information Control 이득을 증명했지만, 이 항목들은 아직 자격화하지 않았다.

## 4. 비교군에서 확인한 실제 원리

### OpenClaw

고정 source: `openclaw/openclaw@e085fa1a3ffd32d0ea6917e1e6fb4ecbffbb77d2`

- pluggable `ContextEngine`의 bootstrap·ingest·afterTurn·assemble·compact·maintain 생명주기
- canonical transcript와 assembled model context 분리
- persistent backend의 per-turn·thread-bootstrap projection
- mid-tool-loop precheck와 ContextEngine-owned compaction
- 단일 ToolResult 50%, 전체 90%의 preemptive guard
- session lock·branch-and-reappend transcript rewrite
- prompt cache·subagent Context lifecycle·degraded/fallback mode

T5는 canonical/projection 분리와 실제 usage·Context pressure 구분을 흡수한다. 비교군 운영값인 50%·90%,
ContextEngine 실패 시 raw messages 전체 fallback, 플랫폼별 transcript lock 구현은 Core 원리로 복제하지 않는다.

### Hermes

고정 source: `NousResearch/hermes-agent@91e867631e9d2eb9fbd69edd4459475d38070979`

- threshold 기반 compaction과 proactive ToolResult pruning
- 동일 ToolResult dedupe·최근 full copy 유지·tool argument 축약
- protected head·tail과 structured auxiliary summary
- 실제 사용자 메시지의 bounded verbatim 보존
- state DB 원문과 `session_search` recovery pointer
- exact identifier anchor index·chunked digest
- anti-thrash·cooldown·feasibility skip·summary failure recovery
- skill instruction ghosting과 multimodal payload 손실 방어

T5는 사용자 원문 우선, exact recovery, 중복 Evidence 최신본, anti-thrash를 흡수한다. 50% threshold·20%
target ratio·고정 head/tail 수·대형 auxiliary compressor는 실측 없이 채택하지 않는다.

## 5. T5가 완성할 구조

### 5.1 Work epoch

```text
Conversation
├─ current Work revision
├─ paused Work revisions
├─ completed Work
└─ cancelled Work
```

- 현재 Work의 사용자 발화·교정·결정·미확인·Evidence는 inline projection 우선
- 완료·보류·취소 Work는 canonical 원문과 Episode pointer로 유지
- 사용자의 새 말은 `steer·followup·new_work·cancel` 중 모델이 판단
- runtime은 순서·identity·revision·durable admission만 강제

### 5.2 장기 사용자 원문

- 모든 사용자 원문은 Conversation에 보존
- 현재 Work의 실제 교정과 활성 제약은 inline
- 다른 Work의 사용자 원문은 exact recall 가능 projection
- Working Memory는 원문 대체물이 아니라 source pointer가 있는 결정·제약·미확인 projection
- 최근 교정이 과거 발화·Memory·Episode보다 우선

### 5.3 계층적 checkpoint

checkpoint는 narrative summary 하나가 아니다. 최소 다음을 구조적으로 보존한다.

```text
Work identity·revision
사용자 목표와 현재 교정
확정된 결정과 이유
미확인·unknown effect
Evidence identity·coverage
파일·URL·오류·명령·버전 anchor
완료·보류·다음 재개 지점
exact recall 범위
```

구현 후보는 deterministic projection, anchor index, bounded digest, auxiliary summary를 포함할 수 있으나 실제
동일 과업 A/B에서 정확도·recall·시간·비용 우위를 증명한 최소 조합만 채택한다.

### 5.4 반복 내구성과 anti-thrash

- checkpoint 이후 새 checkpoint가 앞선 교정·결정·anchor를 잃지 않음
- 절감 없는 projection·compaction 반복 0
- checkpoint·summary·maintenance도 ResourceLedger child scope로 회계
- 실패한 checkpoint를 성공으로 승격하지 않음
- maintenance 실패가 사용자 작업을 막지 않음
- 실패 시 raw Conversation 전체를 다음 provider request에 자동 재투입하지 않음
- 원문은 canonical에 남고 다른 projection·exact recall 경로로 복구

### 5.5 Prompt와 Hand

- stable constitution은 작고 cache 가능한 상태 유지
- Work Situation·current correction·Evidence만 동적 suffix
- Context pressure 자체를 stop 명령으로 쓰지 않음
- Hand focus 뒤에도 dependency·authority·recovery·tool_search 유지
- 사용자가 기술을 모른다는 이유로 강한 Hand·다른 route를 제거하지 않음

## 6. 기존 Gate에 대한 귀속

새 거대 Gate를 만들지 않고 현재 계획에 결속한다.

### A1 Resource Control

- checkpoint·compaction·maintenance 자원과 절감 효과 회계
- 반복 무효 compaction·raw reinflation·child call 폭주 후보 관측
- 정상 장기 탐색을 호출 수만으로 병리화하지 않음

### B Work & Conversation Continuity

- Work epoch·revision·durable input
- current·paused·completed·cancelled Work 분리
- 여러 checkpoint 뒤 restart 복원
- user correction·followup·new_work·cancel의 실제 모델 판단

### C Memory Portfolio

- Working Memory에 source·scope·revision·conflict 보존
- Episode는 Conversation·Run·Receipt pointer
- 현재 교정 우선과 다른 Work Memory 오염 0
- 모델 전환 뒤 같은 Work의 결정·제약·미확인 복원

### Release

- 아래 초장기 내구 matrix와 비교군 동일 과업 대조를 필수로 수행
- 이 자격을 통과하지 않으면 “장기 Context 완료”를 주장하지 않음

## 7. 초장기 성능·내구 시나리오

다음 수치는 제품 상한이 아니라 최소 시험 규모다.

### LC-01 · 1,000-turn multi-Work

- 최소 1,000 turn과 여러 Work
- current·paused·completed·cancelled 상태 혼합
- 새 Work가 과거 Work의 대상·결정에 오염되지 않음

### LC-02 · 반복 checkpoint

- 최소 세 번의 projection·checkpoint cycle
- 각 cycle 뒤 현재 목표·결정·미확인·anchor 보존
- 절감 없는 반복 maintenance 0

### LC-03 · 교정 우선순위

- 초반·중간·후반에 같은 사실을 사용자가 교정
- 최종 교정이 과거 원문·summary·Memory·Episode보다 우선
- 과거 시점의 사실을 물으면 당시 revision도 정확히 recall

### LC-04 · 대형 ToolReceipt와 문서

- terminal output·Web·PDF·XLSX·DOCX·이미지 관측 혼합
- current Evidence는 충분히 유지
- 오래된 대형 payload는 bounded projection과 exact recall
- effect·authority·coverage 손실 0

### LC-05 · restart·모델 전환

- 여러 Work가 진행된 상태에서 T5 restart
- Terra↔gpt-5.5 모델 전환
- current Work·결정·미확인·다음 행동 복원
- provider별 format 차이가 canonical truth를 바꾸지 않음

### LC-06 · Context maintenance 장애

- projection·checkpoint·summary storage·auxiliary model 실패 주입
- 사용자 작업 유지, `degraded·unknown` 정직한 기록
- raw 전체 Context 자동 재팽창 0
- 동일 maintenance 무한 반복 0

### LC-07 · 비교군 동일 과업

OpenClaw·Hermes·Codex·Claude Code와 같은 장기 목적을 수행하고 다음을 비교한다.

```text
목적 달성
교정 보존
exact recall
현재 Work 유지
provider request bytes·tokens
model·tool·maintenance calls
wall time
사용자 개입
거짓 완료·미확인 효과
restart·모델 전환 복구
```

## 8. 통과 조건

```text
현재 Work 목적·교정·결정 손실 0
AND 완료·보류·취소 Work 혼선 0
AND exact anchor·Evidence·effect recall 유지
AND 반복 checkpoint 뒤 성능·정확성 붕괴 없음
AND Context maintenance가 사용자 작업을 막지 않음
AND raw 전체 재팽창·무효 compaction loop 0
AND 비교군과 기능 범위·깊이 동등 이상
AND 시간·비용·사용자 마찰 중 실제 우위
```

호출 수·Context 크기·세션 길이만으로 정상적인 깊은 작업을 중단하거나, 일반 사용자에게 충분하다는 이유로
기능을 줄여 통과시키지 않는다.

## 9. 비목표

- 현재 Gate를 건너뛴 즉시 구현
- 새 만능 Context 저장소
- OpenClaw ContextEngine 또는 Hermes compressor의 대량 포팅
- 고정 threshold·head·tail·summary ratio 복제
- user identity를 persona로 고정
- 장기 Context를 이유로 Multi-agent부터 구현
- 원문 삭제·거짓 요약·고정 작업 상한

Multi-agent·branch research는 단일 Work·Context 구조가 선 뒤 동일 사용자 목적에서 시간·품질 우위가
실측될 때만 별도 자격화한다.
