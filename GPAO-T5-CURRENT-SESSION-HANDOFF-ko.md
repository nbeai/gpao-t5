# GPAO-T5 현재 세션 인수인계

- 갱신: 2026-07-30 (Asia/Seoul)
- 상태: `current_truth_handoff`
- 소유: Codex 통합 책임자가 §0을 Git·런타임·독립 증거와 대조해 갱신
- 상위: `GPAO-T5-DOCUMENT-AUTHORITY-MAP-2026-07-30-ko.md`

이 문서는 현재 사실과 바로 다음 통합 지점만 가진다. 과거 P-OP 과정은 실행 보드와 evidence에 보존한다.

## 0. 현재 진실 패킷

### 0.1 Git과 파일 소유권

- 본진: `/Users/jyp/Developer/t5-p-op`
- 브랜치: `claude/p-op-1-a-system-view`
- 제품 코드 기준선: `3b102b4`
- 원격 차이: `origin/claude/p-op-1-a-system-view`와 0/0
- 상태: 추적 파일 깨끗 · `.beai-harness/`, `workspace-notes/` 기존 미추적
- 구현 제출: `3b102b4`
- 독립 감사: **RETEST · TG-5 봉인 보류**

### 0.2 제품 단계

- P-OP A~H·P-OP-7: 최종 PASS·오너 승인 완료
- 현재 정본 구현: T-cell background growth control plane
- TG-5B 실제 영향: 아직 열지 않음
- 병렬 대상: Skill·Trigger·AgentRun·Automation, T-cell 파일과 비중첩 worktree
- 설치 패키지: 오너 결정으로 아직 착수하지 않음
- C·D·E-1 지정 외부계정 라이브: `OUT_OF_SCOPE_BY_OWNER`, 현재 차단으로 되살리지 않음

### 0.3 T-cell의 실제 코드 간극

현재 구현은 전경 durable I/O를 제거하고, 불변 게시본과 세션별 성장 lane,
replay·transition 생산 호출을 연결했다. `CX-04` 역할 선택과 `CX-05` 사용자 표면·되돌리기는
독립 재감사에서 통과했다. 그러나 아래 차단이 남아 있다.

- 명시 선호는 모델이 같은 `memory.propose`를 내야만 자동 반영되고, 그렇지 않으면 카드·클릭이
  되살아난다. 반대로 모델이 질문 전체를 제안하면 질문이 자동 장기 기억됨
- 다중 묶음에서 checkpoint 전진을 멈췄지만, 재시작마다 같은 최고점 묶음만 다시 처리해 다른 묶음은
  영구 기아 상태가 된다. checkpoint 손상·쓰기 실패도 빈 상태로 위장됨
- 구조 감사는 호출 횟수로 M1→M2를 PASS하지만 실제 생산 M2 전이는 아직 증명되지 않음
- 게시 성숙도 범위의 근거 없는 `오너 확정` 표현은 철회했지만 M2~M5 구현과 M2/M3 정본 표현이
  여전히 함께 있고, 명시적 범위 결정은 아직 없음
- `importLegacyMemory()` 생산 소비자 0
- T-cell 사용자 제어 표면과 active budget/curator 생산 경로 미완료

따라서 닫아야 할 생산 계보:

```text
응답 완료
→ 세션별 background observation/extraction + 지속 checkpoint/재시작 복구
→ M1 후보
→ replay case와 verified transition
→ M2/M3
→ scope별 immutable snapshot 게시
→ foreground는 무 I/O snapshot만 사용
→ effect/friction audit
→ 사용자 제어 + rollback/archive/restore
```

### 0.4 전 영역 최상위 제품 판정

절대 원칙 §0-A-1·§0-A-2를 T-cell, 기억, 맥락, POM, 스킬, 에이전트, 자동화, 도구, UI, 복구에
동일 적용한다.

- 현재 사용자 말은 과거 기억·원리·자동화보다 우선
- 읽기·조사·정리·추론·도구 선택·초안·가역 작업은 자동 진행이 기본
- 명시적 지시는 그 범위의 확인이며 같은 내용을 카드로 다시 묻지 않음
- 승인·카드는 비가역 외부 효과·새 권한·중대한 대상 불확정에만 사용
- bounded grant 안의 반복 실행은 재확인하지 않음
- 내부 학습·replay·감사·저장 I/O는 사용자 턴을 기다리게 하지 않음
- 사전 통제보다 undo·rollback·archive·restore로 자동성을 지지
- 질문·카드·클릭·턴·전경 대기가 늘면 테스트 통과와 무관하게 제품 회귀

### 0.5 Authority 지정 정합화

현재 `src/kernel/l2-plan/authority.js`는 모든 `write`·`promote_memory`와 unknown kind를 A2 안전
바닥으로 넓게 묶는다. 특히 되돌릴 수 있는 기억 반영까지 외부 전송과 같은 승인 경계에 넣는다. 이는
P-OP 당시의 안전 기준이지만 최신 효과 기반 최소 경계보다 넓다.

전체 회귀에도 이 옛 경계를 정상으로 고정한 검사가 남아 있다.

- 읽기·목록을 제외한 모든 파일 작업에 승인을 요구하는 검사
- unknown kind를 곧바로 승인 대상으로 보는 검사
- 명시 요청과 추정 학습을 구분하지 않고 스킬 반영 전 사용자 확인을 요구하는 검사

이 검사는 현재 코드의 회귀 방지 자산이지 최신 제품 철학의 영구 정답이 아니다. 정합화 작업에서는
검사를 무조건 보존하거나 삭제하지 않고, **실제 외부성·가역성·사용자 명시 지시·권한 확대 여부**로
각 시나리오를 다시 분류한다. 명시된 저위험 파일 생성·정리와 가역 스킬 반영은 자동+원장+되돌리기,
외부 전송·삭제·결제·게시·새 권한과 중대한 대상 불확정은 행동 경계 확인이 기본이다.

기억·학습 정본:

- 사용자가 “기억해”, “앞으로 이렇게 해”라고 밝힌 비밀 아닌 내용은 같은 범위에 자동 반영
- 추정한 저위험 선호·작업 방식은 replay와 범위 검증 뒤 제한 영향 가능
- 둘 다 카드 대신 설정의 통합 표면에서 확인·수정·고정·일시정지·되돌리기
- 민감 정보·정체성·권한·외부 대상·전역화 추정만 자동 영향 금지
- 보류 항목도 학습 시점에 카드를 띄우지 않고 실제 필요 경계에서만 최소 확인

오너 순서 결정(2026-07-30): 공통 Authority와 기존 화면의 과잉 승인·카드·대기 정합화는 T-cell,
Skill·Trigger·AgentRun·Automation 핵심 기능을 모두 연결한 뒤 **최종 전 제품 매끄러움 마감 패스**에서
한 번에 진행한다. 그전에는 이 작업으로 기능 개발을 멈추거나 완료된 P-OP 전체를 재개봉하지 않는다.
단, 실제 권한 우회·무단 외부 효과·데이터 손실처럼 현재 사용자를 해치는 결함은 즉시 고친다.

### 0.6 연결·모델 사실

- T5 연결 저장소에 OpenAI API와 Anthropic API 연결이 실제로 존재한다.
- 셸 환경변수 부재를 자격 부재로 쓰지 않는다.
- provider·model 신분은 역할 이름이 아니라 실제 요청 대상과 provider 응답으로 증명한다.
- 비밀값은 인수인계·로그·시험 파일에 기록하지 않는다.
- 같은 provider/model/credential 성장 호출은 secret 제거 bounded 원문을 휘발성으로 쓸 수 있다.
- 다른 provider auxiliary model에는 구조화 EvidenceBundle/digest만 보낸다.
- 저장되는 T-cell에는 사용자 원문을 남기지 않는다.

### 0.7 검증 기준선

- 본진 독립 회귀: 테스트 1,348건 통과 · 실패 0
- 현재 공식 gate 재측정: BLOCKED · CPU 45.4s/40s · 벽시계 21.8s/20s
- 문서 감사: 18 documents PASS
- T-cell 구조 감사: 4/4 PASS이나 실제 M1→M2·checkpoint·명시성 결함을 검출하지 못하므로 봉인 근거로 단독 사용 금지
- 문서·Hermes 감사선: `codex/hermes-tcell-engineering-audit`
- 구조 감사: `npm run audit:tcell-plane`
- 문서 감사: `npm run audit:docs`
- 독립 감사 증거:
  `docs/03-verification/evidence/tcell/tg-5/TG-5-CODEX-REAUDIT-3B102B4-2026-07-30-ko.md`

## 1. 바로 다음 작업

### Claude 구현선

1. Codex 재감사에서 열린 `TG5-CX-01`·`TG5-CX-02`·`TG5-CX-03`·`TG5-CX-06`의 종료 조건을
   한 번에 재현한다.
2. 문제 목록 밖의 구현 해법은 감사 문서에서 선제 지정하지 않는다.
3. 독립 PASS가 난 `TG5-CX-04`·`TG5-CX-05`는 재개봉하지 않는다.
4. 구현 커밋·집중 검사·전체 회귀·공식 gate·실제 브라우저 사용자 시나리오를 제출한다.
5. 이 문서 §0을 직접 PASS로 바꾸지 않는다.

### Codex 감사·통합선

1. Claude dirty 파일을 공동 편집하지 않는다.
2. Hermes 생산 코드·실행 검사에서 확인한 background/user-control 계약을 유지한다.
3. 제출 뒤 전체 관련 문제를 한 번에 판정한다.
4. 감사에는 문제·재현·영향·위반 계약·등급·종료 조건만 싣고 구현 해법을 선제 지정하지 않는다.
5. Git·런타임·실제 모델·인간 마찰을 독립 확인한 뒤 §0을 갱신한다.

### 병렬 자동화선

- 별도 worktree와 비중첩 파일 소유권
- Skill/Trigger/AgentRun/Automation 공통 구조
- 명시적 저위험 예약은 재승인 없이 생성하고 pause/undo 제공
- 외부 전송·삭제·결제·새 권한만 실제 행동 경계에서 확인
- 정본 브랜치 직접 병합 금지, Codex 통합 감사로 편입

## 2. T-cell 영향 단계 진입 조건

TG-5B 또는 실제 원리 영향은 아래가 독립 실행으로 닫힌 뒤에만 연다.

1. 세션별 background 성장 큐와 사용자 턴 격리
2. `M1 → replay → M2/M3 → scope snapshot` 생산 수명주기
3. foreground T-cell model/network/fs/replay/registry mutation 0
4. 현재 지시가 과거 원리보다 우선
5. 저위험 원리가 질문·카드 없이 도움
6. 인간 시나리오에서 질문·클릭·완료 턴·전경 대기 비증가

## 2.1 문서 정립 뒤 TG 재개 순서

문서 통합 뒤 TG는 계약을 다시 토론하지 않고 제품 수명주기를 잇는다.

1. Claude dirty 변경을 새 정본으로 재분류하고 불필요한 계약 행사 코드는 제외
2. 전경 `await buildAdmissionSnapshot()`과 durable I/O 제거
3. 응답 뒤 세션별 background observation/extraction
4. `M1 → replay → M2/M3 → immutable scope snapshot` 생산 배선
5. foreground는 게시 snapshot만 읽고 현재 요청·말귀를 우선
6. 기억·원리·스킬의 통합 사후 교정 표면
7. 인간 시나리오에서 카드·클릭·완료 턴·전경 대기 감소 확인

효과 기반 Authority 정합화는 TG의 선행 작업이나 병렬 차단선으로 열지 않는다. 모든 핵심 기능 연결 뒤
최종 마감 패스에서 기억·파일·스킬·자동화·UI를 같은 네 축으로 한 번에 정리하고 인간 시나리오로 관통한다.

### 본진 반영 순서

1. Claude는 현재 dirty 변경을 잃지 않게 자기 브랜치의 WIP 커밋으로 먼저 보존한다.
2. 감사선 문서 커밋을 순서대로 반영한다. 충돌 시 현재 코드가 아니라 이 문서 §0과 결정문 §10~§12를
   의미 기준으로 보존한다.
3. `npm run audit:docs`와 `npm run audit:tcell-plane`으로 시작 상태를 확인한다.
4. 구조 감사의 GAP는 착수 차단이 아니라 이번 구현의 종료 목록이다.

## 3. 역사·증거 위치

- P-OP 완료 이력과 회귀 시나리오:
  `docs/03-verification/T5-OPERATOR-HARNESS-EXECUTION-BOARD-2026-07-28-ko.md`
- P-OP-7 최종 판정:
  `docs/03-verification/evidence/final-dual-model/FINAL-VERDICT-2026-07-29-ko.md`
- T-cell TG별 증거:
  `docs/03-verification/evidence/tcell/`
- Hermes/T-cell 구조 결정:
  `design/T5-TCELL-BACKGROUND-CONTROL-PLANE-ENGINEERING-DECISION-2026-07-30-ko.md`

역사 문서의 “현재”, “다음”, “BLOCKED”는 작성 당시 사실이다. 현재 판단은 이 문서 §0만 따른다.
