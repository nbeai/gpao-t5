# T5 S2-B 인간 종단 불합격 복구 작업 지시서

상태: `OWNER_WORK_ORDER · B_REOPEN_REQUIRED`

대상 기준선: `fa528923` (`Complete B work and conversation continuity`)

이 문서는 B를 다시 설계하거나 기능을 확장하는 계획서가 아니다. `fa528923` 고정본의 실제 인간 콘솔
시험에서 확인된 결함만 수정하고, 같은 사용자 여정에서 완전 통과를 증명하기 위한 실행 지시서다.

## 1. 일곱 줄 시작 계약

1. **제품 약속** — 사용자가 작업 중 평소 말로 교정·후속·새 일·중단을 말해도 입력은 사라지지 않고,
   T5가 정확한 목적과 순서로 실제 완료까지 이어간다.
2. **현재 Gate** — `S2-B Work & Conversation Continuity · REOPENED BY HUMAN FAIL`.
3. **사용자 완료 문장** — 실행 중 들어온 본문·첨부·발신·회신 정보가 하나로 접수되고, 주 모델이
   `steer·followup·new_work·cancel`을 정확히 판단하며, 재시작과 경쟁 실행 뒤에도 정확히 한 번 수행되고,
   실제 완료 증거가 있을 때만 완료라고 말한다.
4. **선 실제 증거** — `fa528923` archive 격리 인간 종단 레인 1·2·3. 단위·통합 검사가 초록이어도 실제
   console 경로에서 재현된 아래 B-F01~B-F06이 우선한다.
5. **가장 큰 미달** — Work·Conversation의 중심 구조는 있으나 Attachment·Session origin·Hand focus·Process
   wake까지 이어지는 종단 identity와 settlement 배선이 끊겨 있다.
6. **이번 변경** — 입력 admission 원자성, envelope 단일 projection, source identity, 전환 의미, 단일 실행
   claim, Completion Hand 가시성, blocker 정본만 교정한다.
7. **비목표** — C Memory 구현, D Automation, 새 Queue/Workflow 제품, 문자열 intent router, 고정 상한 변경,
   새 UI 디자인, Browser, Telegram 생산 계정, package 제작.

## 2. 인간 종단에서 확인된 불합격 정본

### B-F01 — 실행 중 첨부 admission이 `500`

- 합성 PNG와 부연설명을 실행 중 `/turn/stream-start`로 보내면 `202`가 아니라 `500`이다.
- busy 경로가 Attachment link에 `runId:null`을 넘기지만 AttachmentStore는 유효한 run identity를 요구한다.
- Conversation에는 첨부 흔적이 먼저 남고 Work input은 생성되지 않아 부분 admission이 발생한다.

### B-F02 — pending 모델 projection에서 첨부 envelope 유실

- pending mapper와 AgentLoop projection이 `inputId+text`만 전달한다.
- `attachmentIds·channel·senderId·replyIdentity`가 다음 모델 경계에 공급되지 않는다.

### B-F03 — 실제 Session의 sender·reply identity 유실

- ConsoleSessionStore가 origin의 일부만 보존해 busy admission 시 `senderId·replyTo`가 `null`이 된다.
- WorkStore 단위 fixture의 임의 source 보존은 실제 console 성공 증거가 아니다.

### B-F04 — 실제 Hand 실행 뒤 `work_completion` 소실

- 첫 model call에는 `work_completion`이 보이지만 Hand focus 뒤 다음 call에서 schema가 제거된다.
- 모델이 정확한 이름으로 호출해도 inactive 처리되어 Completion Proposal이 만들어지지 않는다.
- 실제 write→read-after-write가 성공해도 Work는 `unresolved`에 머문다.

### B-F05 — proposal과 final settlement의 blocker 불일치

- proposal 단계는 일부 `handoff·delivery 미달`을 `achieved`로 검증한다.
- console final settlement는 같은 현실을 다시 `unresolved`로 내린다.
- 같은 Work revision에 서로 다른 완료 진실이 존재한다.

### B-F06 — gpt-5.5의 followup→steer 오분류

- `끝나면 표로도 정리해줘.`가 동일 격리 여정에서 2회 모두 `steer`로 분류됐다.
- 표는 현재 답에 섞였지만, 현재 결과 뒤 exact input ID로 한 번 실행하라는 사용자의 시간 순서를 지키지 못했다.

## 3. 수정 계약

### 3.1 Input Admission은 prepare→commit으로 원자화한다

임시 Run identity를 만들거나 `runId:null`을 허용하지 않는다.

```text
inputId 선발급
→ input_admission_prepared(conversation pointer, attachment IDs, source identity)
→ 모든 attachment ownership 검증·inputId에 결속
→ Conversation message append
→ input_admitted commit
→ 202 Accepted
```

- WorkStore에는 사용자 본문을 복제하지 않고 Conversation pointer와 envelope identity만 둔다.
- `prepared`는 모델에게 보이지 않고 실행 대상도 아니다.
- 중간 crash 시 재시작이 exact inputId로 commit을 완성하거나 `admission_aborted`로 닫는다.
- commit 전에는 사용자 표면에 접수 성공을 표시하지 않는다.
- 실패 뒤 Conversation·Attachment·Work 어디에도 live partial admission이 남지 않는다.

### 3.2 한 입력은 모델에게 한 번만 공급한다

- pending projection은 `inputId·messageId·text·attachmentIds·channel·senderId·replyIdentity` 전체를 제공한다.
- 실제 이미지·문서 attachment model input도 같은 message에 결속한다.
- 현재 Run 분류 시 1회, queued Run의 current request 시 1회 중 하나만 선택한다. history와 current request에
  같은 메시지를 동시에 넣지 않는다.
- 분류·실행 claim·consumed 상태를 exact inputId로 구분한다.

### 3.3 Source identity를 Session 입구부터 보존한다

- channel·chat/thread·sender·source message·reply target을 손실 없이 canonical Session/Conversation에 저장한다.
- 오래된 Session record의 필드 부재는 `unknown`이며 빈 문자열이나 현재 사용자로 추정하지 않는다.
- 실제 connector가 제공하지 않은 identity를 만들어내지 않는다.

### 3.4 전환 의미는 주 모델이 판단하되 현재 시간 관계를 충분히 공급한다

런타임 키워드·정규식 분류를 만들지 않는다. 얇은 tool 계약에 다음 의미 경계와 현재 Work 상태를 제공한다.

```text
steer     현재 결과가 나오기 전에 범위·방법·목표를 바꿈
followup  현재 결과가 나온 뒤 추가로 수행함
new_work  현재 목적과 독립된 별도 목적
cancel    현재 Work를 중단함
```

- `끝나면·그 다음에` 같은 표현을 런타임 규칙으로 사용하지 않는다.
- 모델이 사용자 문장, 현재 Work 목적, 이미 시작한 효과, 현재 결과 생성 여부를 함께 보고 판단한다.
- Terra·gpt-5.5에서 봉인 문장과 의미가 같은 변형 문장을 반복 자격화한다.

### 3.5 기존 실행 claim·restart 불변식을 종단에서 다시 증명한다

- 저수준 시험에서 통과한 exact-once를 실제 console·process wake·restart 결합에서도 회귀 자격화한다.
- queued input scheduler와 process terminal wake는 서로 다른 Run을 같은 Work revision에 claim하지 못해야 한다.
- process wake는 “현재 active Work”가 아니라 자신이 시작된 원래 `workId·revision·runId`에만 귀속한다.
- compare-and-set claim 하나가 성공한 뒤 다른 wake는 delivery/observation 사건으로만 합류하거나 폐기된다.
- paused Work는 다른 Work의 process terminal 사건으로 completed될 수 없다.
- cancel 뒤 새 도구·process 효과는 0이어야 한다.

### 3.6 Completion Proposal Hand는 정산 전까지 사라지지 않는다

- `work_completion`은 model이 proposal을 낼 수 있는 모든 call과 Hand focus 뒤에도 활성 상태를 유지한다.
- `work_transition`은 pending admission이 있을 때만 보이는 기존 경계를 유지한다.
- tool focus가 `informationAlwaysVisible` 또는 required completion/recovery Hand 속성을 덮어쓰지 못한다.
- 단순 model response 종료는 proposal이 아니다.

### 3.7 proposal과 settlement는 하나의 blocker 정본을 사용한다

공통 evaluator가 현재 revision의 Receipt에서 다음을 판정하고 proposal과 final settlement가 같은 digest를 쓴다.

- `failed`
- `effect unknown`
- 승인 대기
- 사용자 handoff 대기
- delivery 미달
- 요청된 외부 효과·coverage·재개방 증거 미달
- stale revision 또는 execution claim 불일치

`achieved`는 명시적 모델 proposal, 최신 revision, 실행 claim 일치, blocker 0이 모두 성립할 때만 가능하다.
그 외는 `unresolved` 또는 `cancelled`다.

## 4. 구현 순서와 단계별 닫는 지점

### B-R1 — Admission 원자성

- B-F01·F02·F03 수정.
- text-only, PNG, PDF, 복수 첨부, caption 포함, attachment 검증 실패, prepare 뒤 crash를 시험한다.
- 종료점: 성공은 `202+committed envelope`, 실패는 live partial state 0.

### B-R2 — Projection·전환 의미

- B-F02·F06 수정.
- pending·queued·restart 경로에서 input phrase와 attachment가 모델 request에 정확히 한 번만 나타난다.
- 종료점: 두 모델에서 steer/followup 봉인 matrix 전부 정확, runtime semantic rule 0.

### B-R3 — Claim·Wake 직렬성

- 확인되지 않은 새 경쟁 결함을 가정해 코드를 바꾸지 않고, 기존 claim 경계의 cancel/restart 종단 회귀를 먼저 수행한다.
- queued scheduler, process terminal, cancel, restart를 같은 clock에서 교차시킨다.
- 종료점: revision당 실행 소유 Run 1, input exact-once, paused Work 오정산 0.

### B-R4 — Completion 진실 통일

- B-F04·F05 수정.
- read-only 답, 로컬 write→read-after-write, unknown, failed, approval, handoff, delivery 실패를 각각 시험한다.
- 종료점: proposal과 settlement digest·outcome 불일치 0, false achieved 0.

### B-R5 — 실제 인간 콘솔 재자격

- 아래 5절을 `fa528923 + B-R1~R4`의 깨끗한 고정 commit에서 수행한다.
- 종료점: 모든 레인 PASS. `PASS WITH OBSERVATION`으로 핵심 완료 문장 실패를 남기지 않는다.

## 5. 필수 인간 종단 matrix

실제 사용자 파일·생산 계정·가시 Browser를 사용하지 않는다. 격리 state/workspace와 synthetic fixture,
loopback effect만 사용한다. 실제 모델 자격은 자격증명을 복사하는 자동 runner가 아니라 정상 제품 연결을
통한 오너 승인 qualification 경로에서 실행한다.

| 레인 | 실제 사용자 입력 | 필수 결과 |
|---|---|---|
| steer | `그건 PDF만 봐.` | 202, 현재 Run이 PDF 범위로 전환, 비PDF 후속 효과 0 |
| followup | `끝나면 표로도 정리해줘.` | 현재 결과 뒤 별도 exact input 실행 1회 |
| cancel | `그건 멈추고 폴더 이름만 알려줘.` | child 종료, cancelled≠success, 폴더명 요청 즉시 완료 |
| new work | `그 작업은 두고, 오늘 일정부터 확인해줘.` | 기존 Work paused, 새 identity, 이중 claim 0 |
| attachment | 작업 중 PNG/PDF+부연설명 | 202, envelope 전부 보존·모델 1회 공급 |
| restart | prepare/admitted/classified/executing 각 시점 재시작 | 유실·중복 실행·stale settlement 0 |
| achieved | loopback write→exact read-after-write→proposal | 최신 revision achieved 1회 |
| unresolved | unknown/failed/approval/handoff/delivery 미달 | achieved 0, 사용자에게 남은 일 설명 |

Terra와 gpt-5.5 모두 steer·followup·cancel을 최소 2개 표현×2회 반복한다. 모델 차이를 런타임 문자열
규칙으로 덮지 않는다.

## 6. 최종 합격 기준

- busy input HTTP `202` 100%, 입력·첨부·source identity 유실 0
- 실패 admission의 live partial Conversation·Attachment·Work 0
- 모델 current projection input당 정확히 1회
- steer·followup·new_work·cancel 봉인 matrix 두 모델 정확도 100%
- input execution claim·실제 실행·외부 효과 exact-once
- revision당 실행 소유 Run 1, stale proposal·settlement 0
- process wake가 다른 Work를 완료 처리한 사례 0
- explicit Completion Proposal 없는 achieved 0
- proposal·settlement blocker digest와 outcome 불일치 0
- cancel 뒤 후속 효과 0, restart 유실·중복 0
- 정상 단순 turn의 `work_transition` schema bytes 0
- 사용자 답의 Work·Run·revision·Receipt 내부 용어 0
- Browser·승인 남발·새 고정 상한·기능 축소 0
- A의 Terminal·Document·Web·Resource/Information Control positive control 무회귀
- `npm run refoundation:check`, 기본 제품 통합, legacy import 0 통과

속도·tokens·request bytes·model/tool calls는 모든 여정에서 기록하되 정확성을 줄이는 임의 합격 숫자를
새로 만들지 않는다. 기존 동일 여정보다 불필요한 왕복이나 Context가 늘면 원인을 설명하고 B를 닫지 않는다.

## 7. 중단선

- `runId:null` 허용, fake Run 생성, attachment 본문 복제로 F01을 덮지 않는다.
- followup 오분류를 키워드·정규식·한국어 전용 분기로 고치지 않는다.
- completion을 다시 model response 종료나 runtime 고정 문구로 대체하지 않는다.
- process wake 경쟁을 delay·sleep·재시도 횟수로 숨기지 않는다.
- 실제 console 실패를 직접 tool fixture 초록으로 대체하지 않는다.
- 같은 결함 가족에 세 번째 국소 패치가 필요하면 코드를 더 얹지 않고 ownership 경계를 재판정한다.
- B 복구 중 C·D·Telegram·UI 확장·package 작업을 섞지 않는다.

## 8. 종료 보고와 정본 반영

종료 보고는 다음만 포함한다.

1. 가능해진 사용자 행동
2. B-F01~F06 각각의 수정 경계와 파일
3. 반대시험·실제 모델·실제 인간 콘솔 결과
4. tokens·bytes·wall·model/tool calls와 A positive control
5. 실패·미측정·남은 관측
6. B Gate 최종 판정과 다음 한 작업

현재 `T5-SECOND-COMPLETION.md`와 기존
`refoundation/evidence/s2-b-work-conversation-continuity-2026-08-24.json`의 B COMPLETE 주장은 인간 종단
FAIL로 재개됐음을 먼저 반영한다. 복구 뒤 새 정본 문서를 만들지 않고 같은 계획과 B evidence를 최종
commit·고정 source digest·실제 인간 결과로 갱신한다.
