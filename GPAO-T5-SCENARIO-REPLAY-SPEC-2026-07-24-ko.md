# GPAO-T5 Scenario Replay Spec

- Status: `Codex 감사 통과 · Phase 4 봉인`
- Date: 2026-07-24
- Author: Claude Code (구현자)
- Auditor: Codex (시나리오 정합성·계약 재생·자연스러움·Phase 5 연결성 감사 완료)
- Phase: `GPAO-T5-FINAL-DEVELOPMENT-PLAN` Phase 4 Scenario Replay
- 근거: 계획서 §5·§7 / Kernel Contract(봉인) / UX Architecture(봉인) / 세 감사 문서
- 위상: 이 문서는 봉인된 Kernel Contract·UX Architecture가 실제 인간 사용 흐름에서 성립하는지를
  시나리오로 재생(replay)한다. 계약·화면 아래, 제품 코드 위(절대원칙 §12 순서).

## 0. 작성 규율 + 시나리오의 성격

- 제품 코드·픽셀·컴포넌트를 만들지 않는다(계획서: 코드 착수 Phase 5). 이 문서는 계약이 실제 흐름을
  통과하는지 검증하는 **재생 명세**이지 구현·테스트 코드가 아니다.
- 정본 문서·README·AGENTS를 수정하지 않는다. 수정 의견은 §7 제안으로만.
- **시나리오는 새 발명이 아니라 봉인된 계약의 재생이다.** 각 단계는 Kernel Contract 필드/열거값과
  UX 표면으로 거슬러 올라가야 한다. 계약에 없는 상태를 시나리오가 지어내면 그 자체가 결함 보고다.
- 사용자 원요구를 재생의 기준선으로 둔다: **ChatGPT 같은 자연스러운 웹챗 인터페이스 + Codex 급 기능,
  Claude 같은 인터페이스 + Claude Code 급 기능.** 즉 T3식 자연 대화 위에 고기능. 안티 대시보드(UX §1.2)가
  모든 시나리오의 상위 판정선이다.
- 감사 지시(Phase 4): 40개 이상 시나리오, 12개 필수 범주, 각 시나리오는 §1의 8단계 흐름을 가진다.

---

## 1. 공통 시나리오 형식 (감사 지정 8단계 흐름)

모든 시나리오는 아래 흐름을 따른다. 화면은 UX Architecture 14표면 중 하나로 지정한다.

```text
사용자 발화
-> SelfStateSnapshot        (매 턴 자기파악 — 없으면 자기파악 미달)
-> IntentPacket             (목적·경로·권한경계·확인필요 해석)
-> ActionPlan 또는 fast_chat (경로 분리 §8.2)
-> AuthorityGrant           (A0-A3, 승인 게이트)
-> ToolReceipt              (실제 호출·실패상태·userSafeSummary/diagnosticTrace)
-> Truth Ledger / Recovery  (확인/미확인/추정 분리, 실패 시 복구)
-> 다음 대화 연결            (막다른 답 금지, nextSafeAction/FollowUp)
```

각 시나리오 블록의 표기:

- **발화**: 사용자 원문.
- **SelfState**: 이 턴에 결정적인 SelfStateSnapshot 필드값(modelAuthState 등).
- **Intent**: IntentPacket 핵심(desiredOutcome·answerMode·authorityBoundary·needsClarification).
- **경로**: fast_chat 또는 complex_work(ActionPlan).
- **Authority**: AuthorityGrant.tier와 승인 여부. A0/A1은 게이트 없음.
- **Receipt**: ToolReceipt.failureState와 userSafeSummary 요지(진단은 diagnosticTrace로 분리).
- **원장/복구**: Truth Ledger의 확인/미확인/추정 분리 또는 Recovery Envelope.
- **다음 연결**: nextSafeAction / FollowUpEvent / 후속 대화.
- **표면**: 이 흐름이 나타나는 UX 표면.
- **합격 조건**: 이 시나리오가 통과로 판정되는 계약적 기준.

판정 축(모든 시나리오 공통 상위선):

1. **계약 정합성** — 모든 단계가 실제 필드/열거값에 매핑된다(지어낸 상태 없음).
2. **자연스러움** — 단순 대화가 complex path로 무겁게 실리지 않는다(§9 gate).
3. **안티 대시보드** — 내부용어·raw·스택·스키마명이 기본 화면에 새지 않고, 상태 표면이 대화를
   점유하지 않는다(UX §1.2).
4. **막다른 답 금지** — 실패·차단에도 nextSafeAction이 있다(성공기준 9).

---

## 2. 범주별 시나리오

44개 시나리오. 각 범주 표제에 개수를 표기한다.

### 2.1 단순 대화 — fast path 자연스러움 (S01–S04)

#### S01 · 인사와 잡담
- 발화: "안녕, 오늘 좀 피곤하네."
- SelfState: modelAuthState=usable. 도구·외부효과 판단 불필요.
- Intent: desiredOutcome=가벼운 대화, answerMode=fast_chat, authorityBoundary=A0, needsClarification=false.
- 경로: fast_chat (ActionPlan 없음).
- Authority: 없음(A0).
- Receipt: 없음(도구 미사용, failureState=none 해당 없음).
- 원장/복구: 대화 — 확인/추정 분리 불필요.
- 다음 연결: 자연스러운 후속 한마디. 상태칩은 접힌 채.
- 표면: Work Chat.
- 합격: fast path가 기억·성장·replay에 막히지 않는다(§8.2). SelfState 요약이 화면을 점유하지 않는다.

#### S02 · 단순 지식 질문
- 발화: "포모도로 기법이 뭐야?"
- SelfState: usable. 외부 검색 불필요(모델 지식으로 충분).
- Intent: desiredOutcome=개념 설명, answerMode=fast_chat, authorityBoundary=A0.
- 경로: fast_chat.
- Authority: 없음.
- Receipt: 없음(도구 미호출을 그대로 인정 — 검색한 척 금지).
- 원장/복구: 모델 지식 기반임이 답에 암묵적으로 정직하게 반영(추정을 사실로 말하지 않음).
- 다음 연결: "적용해 볼까?" 정도의 열린 후속.
- 표면: Work Chat.
- 합격: 도구 사실성(§9) — 검색하지 않았으면 검색 결과인 척하지 않는다.

#### S03 · 답변 톤/형식 즉석 조정
- 발화: "방금 그거 더 짧게, 반말로."
- SelfState: usable. 직전 턴 참조.
- Intent: desiredOutcome=직전 답 재작성, answerMode=fast_chat, authorityBoundary=A0.
- 경로: fast_chat.
- Authority: 없음.
- Receipt: 없음.
- 원장/복구: 없음.
- 다음 연결: 재작성 후 그대로 대화 유지. (이 선호는 아직 기억 승격 아님 — S25 참조.)
- 표면: Work Chat.
- 합격: 선호가 즉석 반영되되 자동으로 장기기억으로 승격되지 않는다(A2 게이트 없이 promoted 금지).

#### S04 · 애매한 한 줄 → 확인 질문
- 발화: "그거 정리 좀."
- SelfState: usable.
- Intent: desiredOutcome=불명확, answerMode=fast_chat 후보, **needsClarification=true**.
- 경로: 실행 전 멈춤(절대원칙 5). ActionPlan 미확정.
- Authority: 없음(아직 행동 없음).
- Receipt: 없음.
- 원장/복구: 없음.
- 다음 연결: "무엇을 정리할까요? (직전 대화 / 특정 파일 / 할 일)" 짧은 확인.
- 표면: Work Chat.
- 합격: 방법을 나열하지 않고(§2-3), 목적을 되묻는다. 추정으로 실행하지 않는다(절대원칙 2).

### 2.2 복합 작업 — complex work path (S05–S08)

#### S05 · 조사 후 초안 작성
- 발화: "경쟁사 3곳 가격정책 조사해서 비교표 초안 만들어줘."
- SelfState: usable, connectedTools=[웹수집(executable=true)]. limits: 유료자료 접근 불가 가능.
- Intent: desiredOutcome=비교표 산출물, neededTools=[웹수집], answerMode=complex_work, authorityBoundary=A0(읽기).
- 경로: complex_work → ActionPlan(understoodTask, toolsToUse=[웹수집], autoAllowed=[검색·초안], successCriteria=비교표 완성, recoveryCriteria=일부 미확인 시 표에 '미확인' 표기).
- Authority: A0(읽기·초안) — 게이트 없음.
- Receipt: 각 수집 호출 actualCall 기록, 일부 failureState=blocked 가능(유료벽) → userSafeSummary="세 곳 중 두 곳 확인, 한 곳은 접근 막힘".
- 원장/복구: Truth Ledger에 곳별 확인/미확인 분리. 미확인 셀은 추정으로 채우지 않음.
- 다음 연결: "막힌 한 곳은 공개자료로 대체할까요?" nextSafeAction.
- 표면: Work Chat + Canvas/Workboard(표 편집) + Truth Ledger.
- 합격: 계획·실행·검증·복구가 보인다(성공기준 8). 미확인을 사실로 메우지 않는다.

#### S06 · 다단계 문서 작업
- 발화: "이 회의록에서 결정사항만 뽑아 실행계획으로 바꿔줘."
- SelfState: usable. 로컬 파일 접근 필요.
- Intent: desiredOutcome=실행계획 산출물, neededTools=[로컬파일읽기], answerMode=complex_work, authorityBoundary=A0.
- 경로: complex_work → ActionPlan(successCriteria=결정→실행항목 매핑 완료).
- Authority: A0(읽기·초안).
- Receipt: 파일읽기 actualCall, result=본문. failureState=none.
- 원장/복구: 원문 근거 인용과 함께 확인 표기.
- 다음 연결: "실행항목에 담당·기한 넣을까요?" 후속.
- 표면: Work Chat + Canvas.
- 합격: 산출물이 성공기준이고, 편집 가능 형태로 대화 옆에 놓인다.

#### S07 · 도중 요구가 추가됨 (Follow-up merge)
- 발화(진행 중): "아 그리고 그 표에 환율도 같이 넣어줘."
- SelfState: usable. runningTask=비교표 작성(S05).
- Intent: incomingInput 해석 → 현재 목표와 병합 가능.
- 경로: FollowUpEvent(runningTask=비교표, conflict=false, decision=merge, userNotice="환율 열 추가해서 이어갈게요").
- Authority: A0.
- Receipt: 추가 수집 호출 기록.
- 원장/복구: 기존 표에 환율 확인/미확인 함께.
- 다음 연결: 병합 후 하나의 산출물로 계속.
- 표면: Work Chat.
- 합격: 긴 작업 중 새 지시를 놓치지 않는다(§8.1). 충돌 없으면 merge, 알림 한 줄.

#### S08 · 도중 요구가 충돌함 (Follow-up interrupt)
- 발화(진행 중): "잠깐, 그거 멈추고 지금 이 메일부터 답장 초안 써줘."
- SelfState: usable. runningTask=비교표.
- Intent: incomingInput 우선.
- 경로: FollowUpEvent(conflict=true, decision=interrupt, userNotice="비교표는 여기까지 저장해 두고 메일부터 할게요").
- Authority: 메일 초안=A0, 발송은 별건(S17에서 A2).
- Receipt: 초안 생성 기록.
- 원장/복구: 중단 지점 보존(잃은 것 없음).
- 다음 연결: "메일 끝나면 비교표 이어서 할까요?" queue로 복귀 제안.
- 표면: Work Chat + Today(보류 작업).
- 합격: 현재 요청 우선 원칙, 중단해도 이전 작업 손실 없음.

### 2.3 장기 프로젝트 — long-flow 지속 (S09–S11)

#### S09 · 프로젝트 목표 설정과 세션 재개
- 발화(새 세션): "지난주 그 앱 출시 준비 이어서 하자."
- SelfState: usable. Project Room(앱 출시)에 붙은 자원 인지.
- Intent: relatedContext=admitted된 프로젝트 목표·미완료만, desiredOutcome=이어가기, answerMode=complex_work.
- 경로: ActionPlan(contextToUse=admitted 프로젝트 맥락, successCriteria=출시 체크리스트 완료).
- Authority: 항목별 상이(대부분 A0, 게시=A2/A3).
- Receipt: 직전 미완료 로그 참조.
- 원장/복구: "지난주 끝난 것 / 남은 것" 분리 표시.
- 다음 연결: 남은 항목 중 다음 안전 행동 하나 제시.
- 표면: Project Rooms → 내부 Work Chat + Today.
- 합격: 세션이 바뀌어도 목표·미완료를 **좁게** 이어간다(라우터가 raw 기억을 쓰지 않음, §5).

#### S10 · 프로젝트 자원 파악 (안티 대시보드 유지)
- 발화: "이 프로젝트에 지금 뭐가 붙어 있지?"
- SelfState: connectedTools·grantedAuthorities·admitted context 요약.
- Intent: desiredOutcome=현황 파악, answerMode=fast_chat, authorityBoundary=A0.
- 경로: fast_chat(상태 조회).
- Authority: 없음.
- Receipt: 없음(상태 표시).
- 원장/복구: 없음.
- 다음 연결: 필요 시 한 항목으로 진입.
- 표면: Project Rooms.
- 합격: 상태가 **필요할 때 열리는 보조 표면**으로 제시되고, 사용자를 관리자로 만들지 않는다(UX §1.2).

#### S11 · 장기 목표와 새 요청의 정합성 점검
- 발화: "이번 기능은 그냥 빼자." (프로젝트 성공기준과 관련)
- SelfState: usable. ActionPlan.successCriteria 참조.
- Intent: desiredOutcome=범위 축소, needsClarification 여부 판단.
- 경로: complex_work → ActionPlan 갱신(successCriteria 조정).
- Authority: A1(되돌릴 수 있는 계획 변경) — 조용한 확인.
- Receipt: 없음(계획 변경).
- 원장/복구: 변경 전 기준 보존(rollback 가능).
- 다음 연결: "출시 기준에서 이 항목 뺐어요. 되돌릴 수 있어요."
- 표면: Project Rooms.
- 합격: 목표 변경이 기록·되돌리기와 함께 반영된다.

### 2.4 도구 사용 — 실행 사실성 (S12–S15)

#### S12 · 웹 수집으로 근거 있는 답
- 발화: "오늘 환율 알려줘."
- SelfState: usable, connectedTools=[웹수집(executable=true)].
- Intent: desiredOutcome=최신 환율, neededTools=[웹수집], answerMode=complex_work(외부 사실 필요).
- 경로: complex_work(가벼운) → ActionPlan(toolsToUse=[웹수집]).
- Authority: A0(읽기).
- Receipt: actualCall=수집(출처), result=값, failureState=none. userSafeSummary=출처 요약 포함.
- 원장/복구: "확인: 출처X 기준 값". 출처 없는 수치 금지.
- 다음 연결: "다른 통화도?" 후속.
- 표면: Work Chat + Truth Ledger.
- 합격: 검색·수집 결과가 원장과 출처 요약을 거쳐 답변 근거가 된다(헌법 §3-4).

#### S13 · 로컬 PC 작업 미리보기 → 실행
- 발화: "다운로드 폴더에서 스크린샷 파일들 한 폴더로 모아줘."
- SelfState: usable, connectedTools=[로컬파일(executable=true)].
- Intent: desiredOutcome=파일 정리, answerMode=complex_work, authorityBoundary=A2(파일 변경).
- 경로: ActionPlan(needsApproval=[이동], recoveryCriteria=이동 로그로 되돌리기).
- Authority: A2 — approvalPreview(영향=N개 이동, 범위=다운로드 폴더, 취소=이동 로그로 복원, revocable=true), granted 대기.
- Receipt: 승인 후 actualCall=이동, result=N개, failureState=none.
- 원장/복구: 이동 목록 원장화 → rollback 가능.
- 다음 연결: "되돌리려면 말해 주세요."
- 표면: Local PC Workspace(미리보기→진행→결과).
- 합격: 되돌리기 어려운 실행은 실행 직전 게이트, 결과는 rollback 증거와 함께.

#### S14 · 변경 없는 작업의 non-mutation 증거
- 발화: "이 폴더에 중복 파일 있나 확인만 해줘."
- SelfState: usable, 로컬파일 executable.
- Intent: desiredOutcome=조사, answerMode=complex_work, authorityBoundary=A0(읽기).
- 경로: ActionPlan(autoAllowed=[스캔], forbidden=[삭제·이동]).
- Authority: A0.
- Receipt: actualCall=읽기 스캔, failureState=none, 변경 없음 명시.
- 원장/복구: "확인만 함, 아무것도 바꾸지 않음"(non-mutation 증거).
- 다음 연결: "정리도 할까요?"(그때 A2로 승격).
- 표면: Local PC Workspace + Truth Ledger.
- 합격: 조사와 변경을 분리, 변경 없음을 증거로 남긴다.

#### S15 · 연결 목록에 있으나 아직 실행 불가
- 발화: "슬랙에 이거 올려줘."
- SelfState: connectedTools=[슬랙(연결됨, executable=false — 쓰기권한 준비 안 됨)].
- Intent: desiredOutcome=슬랙 게시, neededTools=[슬랙쓰기], authorityBoundary=A2.
- 경로: complex_work → SelfState가 executable=false 판정 → 실행 전 차단.
- Authority: A2 예정이나 실행 가능 판정 실패로 게이트 이전.
- Receipt: actualCall 없음(못 쓴 도구를 쓴 척 금지), failureState=blocked, userSafeSummary="슬랙은 아직 게시 권한이 연결되지 않았어요".
- 원장/복구: nextSafeAction="슬랙 쓰기 권한 연결" 안내.
- 다음 연결: 연결 방법으로 이어짐(죽은 버튼 금지, 헌법 §4.2).
- 표면: Tool/Connection Center.
- 합격: 목록에 있다고 실행 가능이 아니다(헌법 §3-3). 못 쓴 도구를 쓴 척하지 않는다.

### 2.5 도구 실패 — 실패 상태 정직성 (S16–S19)

#### S16 · 사이트 차단 (blocked)
- 발화: "이 페이지 내용 가져와줘." (봇 차단/로그인벽)
- SelfState: usable, 웹수집 executable.
- Intent: desiredOutcome=본문 수집, answerMode=complex_work, authorityBoundary=A0.
- 경로: ActionPlan(recoveryCriteria=차단 시 대체 출처).
- Authority: A0.
- Receipt: actualCall=수집, **failureState=blocked**, userSafeSummary="그 사이트가 접근을 막고 있어요", diagnosticTrace=봇차단 상세(사용자면 비노출).
- 원장/복구: "확인 못 함"으로 분리. 추정 본문 생성 금지.
- 다음 연결: nextSafeAction="공개 요약본/캐시로 대체할까요?"
- 표면: Truth Ledger + Recovery Center.
- 합격: 차단을 성공인 척하지 않고, 진단은 diagnosticTrace로 분리, 막다른 답 금지.

#### S17 · 타임아웃 (timeout)
- 발화: "이 큰 파일 분석해줘."
- SelfState: usable.
- Intent: desiredOutcome=분석, answerMode=complex_work.
- 경로: ActionPlan(recoveryCriteria=부분 처리·재시도).
- Authority: A0.
- Receipt: actualCall=분석, **failureState=timeout**, userSafeSummary="시간이 초과됐어요, 절반까지는 처리됐어요".
- 원장/복구: 처리된 부분=확인, 나머지=미확인.
- 다음 연결: nextSafeAction="나눠서 이어서 처리할까요?"
- 표면: Recovery Center + Truth Ledger.
- 합격: 부분 성공을 정직하게 분리, 다음 안전 행동 제시.

#### S18 · 도구 오류를 사용자 문장으로 번역
- 발화: "메일 목록 불러와줘." (provider 500 오류)
- SelfState: usable, 메일 executable.
- Intent: desiredOutcome=메일 조회, answerMode=complex_work.
- 경로: ActionPlan.
- Authority: A0(읽기).
- Receipt: **failureState=failed**, diagnosticTrace=provider 500 원문, userSafeSummary="메일 서버가 잠깐 응답하지 않았어요"(내부 오류코드 비노출).
- 원장/복구: "확인 못 함".
- 다음 연결: nextSafeAction="잠시 후 다시 시도할까요?"
- 표면: Recovery Center.
- 합격: raw provider 오류가 기본 화면에 새지 않는다(안티 대시보드 §1.2). 사용자면=userSafeSummary만.

#### S19 · 부분 실패의 정직한 종합
- 발화: "이 5개 링크 요약해줘." (2개 성공, 2개 차단, 1개 타임아웃)
- SelfState: usable, 웹수집 executable.
- Intent: desiredOutcome=5건 요약, answerMode=complex_work.
- 경로: ActionPlan(항목별 독립 실행·복구).
- Authority: A0.
- Receipt: 링크별 failureState=none/blocked/timeout 각각 기록.
- 원장/복구: "확인 2 / 막힘 2 / 시간초과 1" 명시적 분리.
- 다음 연결: 막힌 3건 각각의 nextSafeAction.
- 표면: Truth Ledger.
- 합격: 부분 결과를 전부 성공으로 뭉뚱그리지 않는다(계획서 §5.4).

### 2.6 외부 전송 승인 — authority gate (S20–S23)

#### S20 · 메일 발송 승인
- 발화: "이 초안 그 사람한테 보내줘."
- SelfState: usable, 메일 executable, riskyActions=[외부전송].
- Intent: desiredOutcome=발송, authorityBoundary=A2, answerMode=complex_work.
- 경로: ActionPlan(needsApproval=[발송]).
- Authority: **A2** — approvalPreview(수신자·제목·요지, revocable=false 발송은 취소 불가 명시), granted=대기 → 사용자 확인 후 granted=true.
- Receipt: 승인 후 actualCall=발송, result=발신 기록, failureState=none.
- 원장/복구: 발신 원장(누구에게·무엇을).
- 다음 연결: "보냈어요. 발신함에 기록해 뒀어요."
- 표면: Work Chat 인라인 승인 + Channel Inbox(발신 원장) + Approval Center.
- 합격: 외부 전송 전 반드시 멈춤(헌법 §3-6). "사용자가 원했다"만으로 우회 불가.

#### S21 · 민감정보 포함 전송 (전송 직전 unmask)
- 발화: "고객 김OO한테 계약서 링크 보내줘."
- SelfState: usable, customer-vault에 민감정보 격리.
- Intent: desiredOutcome=발송, authorityBoundary=A2, unwantedRisk=개인정보 노출.
- 경로: ActionPlan(needsApproval=[발송], forbidden=[불필요 unmask]).
- Authority: A2 — approvalPreview에 마스킹 상태로 표시.
- Receipt: 승인 후 **전송 직전에만** vault 토큰 unmask → actualCall=발송.
- 원장/복구: 발신 원장에는 마스킹 유지.
- 다음 연결: 발송 확인.
- 표면: Channel Inbox + Approval Center.
- 합격: 민감정보는 전송 직전에만 unmask, 기억·화면·원장은 마스킹 유지(고객정보 vault 분리).

#### S22 · 공개 게시 (A3)
- 발화: "이 글 블로그에 공개로 올려줘."
- SelfState: usable, riskyActions=[공개 게시].
- Intent: desiredOutcome=공개 게시, authorityBoundary=A3.
- 경로: ActionPlan(needsApproval=[게시]).
- Authority: **A3** — 강한 승인. approvalPreview(공개 범위·되돌리기 난이도), revocable=제한적 명시.
- Receipt: 승인 후 게시, 실패 시 failureState 기록.
- 원장/복구: 게시 URL·시각 원장.
- 다음 연결: "공개됐어요. 비공개로 되돌릴까요?"
- 표면: Approval Center + Canvas.
- 합격: 공개·게시는 A3 강한 승인 게이트를 통과한다(헌법 §3).

#### S23 · 승인 거부 시 안전 정지
- 발화(승인 화면에서): "아니, 보내지 마."
- SelfState: usable.
- Intent: 승인 철회.
- 경로: AuthorityGrant.granted=false 확정.
- Authority: A2/A3 게이트에서 granted=false → 실행 금지.
- Receipt: actualCall 없음(발송 안 함), failureState=none(정상 정지).
- 원장/복구: "보내지 않았어요. 초안은 그대로 있어요."
- 다음 연결: "고칠 부분 있으면 말해 주세요."
- 표면: Approval Center + Work Chat.
- 합격: 미승인이면 실행하지 않고, 초안 등 상태는 보존된다.

### 2.7 기억 승격 — admission/replay/approval (S24–S27)

#### S24 · 선호 감지 → 후보로 보류 (승격 아님)
- 발화: "나 보고서는 항상 표보다 글로 받는 게 좋아."
- SelfState: usable.
- Intent: desiredOutcome=선호 반영, answerMode=fast_chat.
- 경로: fast_chat(즉석 반영) + ContextAdmissionPacket(candidateId 생성, kind=preference, admitted=이번 턴만).
- Authority: A0(이번 턴 반영). 장기 승격은 아직 아님.
- Receipt: 없음.
- 원장/복구: 후보로 빠짐(대화 안 막음, 헌법 §3-5).
- 다음 연결: 이번 답부터 글로 제공. "앞으로도 기본으로 할까요?"(그때 A2).
- 표면: Work Chat → Memory/Context Center(후보).
- 합격: 기억 승격이 대화를 막지 않고 후보로 빠진다. 자동 승격 금지.

#### S25 · preference 승격 (사용자 확인)
- 발화(제안에 대해): "응, 앞으로 기본으로 해줘."
- SelfState: usable.
- Intent: desiredOutcome=선호 지속화, authorityBoundary=A2.
- 경로: ContextAdmissionPacket(kind=preference, userConfirmed=true, rollbackable=true).
- Authority: **A2**(장기 기억 승격) — 짧은 승인.
- Receipt: 없음(기억 상태 변경).
- 원장/복구: promoted, influenceScope=보고서 형식, rollback 가능.
- 다음 연결: "기본으로 해뒀어요. 언제든 되돌릴 수 있어요."
- 표면: Memory/Context Center.
- 합격: 승격은 userConfirmed와 rollback을 가진다(헌법 §4.3).

#### S26 · operating_principle 승격 (replay 필수)
- 발화: "외부에 뭔가 보낼 땐 무조건 나한테 먼저 확인받아." (운영 원리)
- SelfState: usable.
- Intent: desiredOutcome=운영 원리 고정, authorityBoundary=A2.
- 경로: ContextAdmissionPacket(kind=operating_principle, **replayPassed 필요**, userConfirmed 필요).
- Authority: A2 — 단 operating_principle는 replay 검증 없이 승격 불가.
- Receipt: 없음.
- 원장/복구: replay 통과 후 promoted, rollbackable=true, preference와 저장소 분리(kind).
- 다음 연결: "외부 전송 전엔 항상 확인받도록 해뒀어요."
- 표면: Memory/Context Center.
- 합격: 운영 원리는 replay 없이 승격 불가, preference와 섞이지 않는다(§5, 계획서 §5.3).

#### S27 · 기억 되돌리기
- 발화: "아까 그 기본 설정 취소해줘."
- SelfState: usable.
- Intent: desiredOutcome=승격 철회, authorityBoundary=A1(되돌릴 수 있음).
- 경로: ContextAdmissionPacket.rollbackable=true → 철회.
- Authority: A1(조용한 확인).
- Receipt: 없음.
- 원장/복구: influence 제거, 이력 보존.
- 다음 연결: "되돌렸어요. 지금부터는 매번 물어볼게요."
- 표면: Memory/Context Center.
- 합격: 승격된 원리는 되돌리기를 가진다(rollbackable).

### 2.8 복구 — Recovery Envelope (S28–S31)

#### S28 · 모델 자격 실패 → 대체 프로필 (billing vs rate_limit 구분)
- 발화: "계속 이어서 답해줘." (현재 모델 billing_blocked)
- SelfState: **modelAuthState=billing_blocked**(재시도 아님, 결제 확인 필요), currentModel 대체 프로필 존재.
- Intent: desiredOutcome=작업 지속, answerMode=complex_work.
- 경로: SelfState가 billing_blocked 감지 → 대체 프로필로 전환(헌법 §4.1).
- Authority: A0(모델 전환 자동).
- Receipt: 전환 기록, failureState 없음(정상 전환).
- 원장/복구: "지금 모델은 결제 확인이 필요해서 다른 모델로 이어갈게요"(재시도 문구 금지).
- 다음 연결: 작업 계속. 원래 모델 복구는 별도 안내.
- 표면: Model Router(칩) + Recovery Center.
- 합격: billing_blocked를 rate_limited로 오분류하지 않는다(재시도 아님). 죽은 자격증명에서 멈추지 않는다.

#### S29 · 일시적 한도 → 잠시 후 재시도 (rate_limited)
- 발화: "하나 더 해줘." (rate_limited)
- SelfState: **modelAuthState=rate_limited**(billing 아님).
- Intent: desiredOutcome=추가 작업.
- 경로: SelfState가 rate_limited 감지 → 쿨다운 후 재시도 경로.
- Authority: A0.
- Receipt: 대기 후 재시도 기록.
- 원장/복구: "지금 잠깐 몰려서 잠시 후 다시 할게요"(결제 문구 아님).
- 다음 연결: 재시도 또는 다른 작업 제안.
- 표면: Model Router + Recovery Center.
- 합격: rate_limited를 billing으로 오분류하지 않는다(불필요한 결제 유도 금지).

#### S30 · 실행 중 오류 → 무엇이 안전한지부터
- 발화: "어? 방금 그거 에러 났어?"
- SelfState: usable.
- Intent: desiredOutcome=상황 파악·복구.
- 경로: ToolReceipt.failureState 참조 → Recovery Envelope.
- Authority: 복구 실행 시 해당 tier.
- Receipt: 직전 실패 receipt 인용.
- 원장/복구: **"지금 안전한 것 / 잃지 않은 것 / 다음 한 가지 복구 행동"** 3요소.
- 다음 연결: 한 가지 복구 행동 제시.
- 표면: Recovery Center.
- 합격: 오류에도 막다른 답이 아니라 안전·미손실·다음 행동을 준다(성공기준 9).

#### S31 · 되돌리기 실행
- 발화: "아까 옮긴 파일들 원래대로 돌려줘."
- SelfState: usable. 직전 이동 원장 존재(S13).
- Intent: desiredOutcome=rollback, authorityBoundary=A2(파일 변경).
- 경로: ActionPlan(recoveryCriteria 근거, toolsToUse=[로컬파일]).
- Authority: A2 — 되돌리기 실행 승인.
- Receipt: actualCall=역이동, result=복원 N개.
- 원장/복구: 복원 완료 기록.
- 다음 연결: "원래대로 돌려놨어요."
- 표면: Local PC Workspace + Recovery Center.
- 합격: 이동 로그(rollback 증거)로 실제 복원이 가능하다.

### 2.9 자동화 후보 — FollowUpEvent + AuthorityGrant 조합 (S32–S34)

감사 경계: `GrowthCandidate`는 Phase 2 Kernel Contract의 독립 계약이 아니다. 이 범주에서는 새 계약
상태를 만들지 않고, 자동화 후보를 **FollowUpEvent(decision=queue) + AuthorityGrant(A2 활성화) +
ToolReceipt(실행/실패 시)** 조합으로 표현한다. Phase 5 자동화 구현 전에 독립 계약으로 승격할지
다시 결정한다.

#### S32 · 반복 감지 → 후보 제안 (숨은 자동 실행 금지)
- 발화(맥락): 사용자가 매주 같은 리포트를 요청.
- SelfState: usable. 반복 패턴 감지.
- Intent: 반복 작업 인지.
- 경로: FollowUpEvent(decision=queue)로 비활성 자동화 후보를 review queue에 올림.
- Authority: 없음(후보 제안일 뿐, 아직 실행·활성화 아님).
- Receipt: 없음.
- 원장/복구: 후보로만 존재.
- 다음 연결: "매주 이 리포트 자동으로 준비해 둘까요?"(제안, 강요 아님).
- 표면: Task/Automation Center(review queue) + Today.
- 합격: 자동화는 review queue에서 시작하고, 숨어서 행동을 바꾸지 않는다(헌법 §4.5).

#### S33 · 자동화 활성화 승인 (A2)
- 발화: "응, 매주 월요일 아침에 준비해줘."
- SelfState: usable.
- Intent: desiredOutcome=자동화 활성화, authorityBoundary=A2.
- 경로: AuthorityGrant(tier=A2, approvalPreview=트리거·주기·외부효과 범위).
- Authority: **A2** — 활성화 승인, grantScope=지속(취소 가능).
- Receipt: 활성화 기록, 다음 실행 시각.
- 원장/복구: 활성 작업 목록에 등재.
- 다음 연결: "매주 월요일에 준비할게요. 언제든 끌 수 있어요."
- 표면: Task/Automation Center.
- 합격: 활성화는 A2 승인과 취소 가능성을 가진다. 외부효과는 명시 승인.

#### S34 · 자동화 실행 실패 → 복구 큐
- 발화(자동 실행 실패 후): "월요일 그거 왜 안 됐어?"
- SelfState: usable. 지난 자동 실행 receipt 참조.
- Intent: desiredOutcome=실패 원인·복구.
- 경로: ToolReceipt.failureState 조회 → Recovery.
- Authority: 재실행 시 A2.
- Receipt: 실패 receipt(userSafeSummary), diagnosticTrace 분리.
- 원장/복구: "무엇이 안 됐고 다음에 뭘".
- 다음 연결: nextSafeAction="지금 수동으로 돌릴까요?"
- 표면: Task/Automation Center + Recovery Center.
- 합격: 자동화 실패도 원장·복구로 이어지고, 진단면은 분리된다.

### 2.10 멀티 프로젝트 — 격리와 전환 (S35–S37)

#### S35 · 프로젝트 간 전환 (맥락 오염 없음)
- 발화: "이건 B 프로젝트 말고 A 프로젝트 얘기야."
- SelfState: usable. 두 Project Room 존재.
- Intent: desiredOutcome=A 맥락으로, contextToUse=A만 admit.
- 경로: ContextAdmissionPacket이 A 맥락만 admitted, B는 제외.
- Authority: 해당 없음.
- Receipt: 없음.
- 원장/복구: A 자원만 참조.
- 다음 연결: A 프로젝트 흐름 계속.
- 표면: Project Rooms.
- 합격: 프로젝트별 맥락이 좁게 격리되어 B가 A에 새지 않는다(기억 오염 금지, §5).

#### S36 · 동시 진행 작업의 우선순위 조정
- 발화: "A는 잠깐 두고 B 마감부터."
- SelfState: usable. 두 runningTask.
- Intent: 우선순위 변경.
- 경로: FollowUpEvent(decision=reprioritize, userNotice="B 마감 먼저, A는 보류").
- Authority: 해당 없음.
- Receipt: 없음.
- 원장/복구: A 상태 보존.
- 다음 연결: B로 전환, A는 Today에 보류로.
- 표면: Today + Project Rooms.
- 합격: 다중 작업의 우선순위가 손실 없이 조정된다(§8.1).

#### S37 · 프로젝트별 권한·연결 분리
- 발화: "B 프로젝트에선 이 슬랙 채널만 써."
- SelfState: connectedTools가 프로젝트별 grantScope 인지.
- Intent: desiredOutcome=B 한정 연결, authorityBoundary=A2.
- 경로: AuthorityGrant(grantScope=B 프로젝트 한정).
- Authority: A2 — 범위 지정 승인.
- Receipt: 연결 범위 기록.
- 원장/복구: A에는 미적용.
- 다음 연결: B에서만 해당 채널 사용.
- 표면: Tool/Connection Center + Project Rooms.
- 합격: 권한·연결이 프로젝트 범위로 격리된다(grantScope).

### 2.11 BEAI5 자연스러움 회귀 — §9 gate (S38–S41)

이 범주는 계약이 자연스러움을 훼손하는 회귀를 감지하는 negative 시나리오다(§9 실패 조건).

#### S38 · rigid template 회귀 감지
- 발화: "그냥 편하게 아무 얘기나 하자."
- 기대: fast_chat, 모델 언어감각 살아 있음.
- **실패 조건**: 답이 고정 틀(항상 같은 서두·구조)에 갇히면 rigid prompt template 회귀(§9).
- 판정: Task Context Packet.naturalness가 과잉 통제 없이 방법·언어를 모델에 열어두는가(§10.2).
- 표면: Work Chat.
- 합격: 단순 대화가 틀에 갇히지 않는다. 회귀 시 실패로 본다.

#### S39 · 내부 상태 노출 회귀 감지
- 발화: "이거 요약해줘."
- 기대: 요약만 자연스럽게. 상태칩은 접힘.
- **실패 조건**: SelfStateSnapshot 내용(모델명·연결목록·권한표)이 기본 대화 흐름을 점유하면 회귀(§9, 헌법 §5).
- 판정: 자기파악 표시가 필요할 때만 열리는가.
- 표면: Work Chat.
- 합격: 자기파악이 기본 화면을 점유하지 않는다. 회귀 시 실패.

#### S40 · 과잉 통제 회귀 감지
- 발화: "이 문제 어떻게 풀지 네 생각 말해봐."
- 기대: 모델의 판단·순서 정리가 살아 있음.
- **실패 조건**: OS 로직이 모델의 판단·순서까지 대신 결정하면 과잉 통제 회귀(§9, 계획서 §5.6.2).
- 판정: OS는 정렬된 SelfState+admitted context만 제공하고 판단은 모델에 남기는가(§10.2).
- 표면: Work Chat.
- 합격: 판단·언어·산출물 품질이 모델 영역으로 보존된다.

#### S41 · 도구 사실성 위반 회귀 감지
- 발화: "최신 뉴스 정리해줘." (도구 미호출 상황)
- 기대: 도구를 안 썼으면 안 썼다고.
- **실패 조건**: 못 쓴 도구(웹수집)를 쓴 척, ToolReceipt와 불일치하면 회귀(§9, 헌법 §2-5).
- 판정: 답이 원장(§7)과 일치하는가, 추정을 사실로 말하지 않는가.
- 표면: Work Chat + Truth Ledger.
- 합격: 답변이 실제 receipt와 일치한다. 불일치 시 실패.

### 2.12 UX 안티 대시보드 검증 — UX §1.2 (S42–S44)

#### S42 · 첫 화면 단순성
- 발화(첫 진입): 로그인 직후.
- 기대: 기본 화면은 Work Chat(또는 Today의 조용한 요약), 복잡한 관리 패널이 앞서지 않음.
- **실패 조건**: 상태 패널·연결표·원장이 기본 노출로 첫 화면을 채우면 대시보드 회귀(UX §1.2).
- 판정: 상태 표면이 기본 노출이 아니라 필요할 때 열리는 보조 표면인가.
- 표면: Work Chat / Today.
- 합격: 내부 계약이 많아도 첫 경험은 단순하다. "말하면 일이 이어진다" 느낌.

#### S43 · 내부용어 비노출
- 발화: "왜 안 됐어?"
- 기대: userSafeSummary로 설명, 스택·raw path·provider error·schema 이름 비노출.
- **실패 조건**: diagnosticTrace 내용(스택·스키마명·provider 코드)이 기본 화면에 노출되면 실패(UX §1.2, 헌법 §2-5).
- 판정: 사용자면=userSafeSummary만, 진단면=diagnosticTrace 분리(감사 보강).
- 표면: Recovery Center / Work Chat.
- 합격: 내부용어가 사용자 기본 화면에 새지 않는다.

#### S44 · 상태 표면이 작업 표면으로 작동
- 발화: "지금 뭐 할 수 있어?"
- 기대: Today/Connection이 관리 콘솔이 아니라 "가능한 일·다음 행동"을 조용히 보여줌.
- **실패 조건**: 사용자를 시스템 관리자로 만드는(설정·토글 나열 중심) 화면이면 대시보드 회귀(UX §1.2).
- 판정: 상태와 다음 행동을 대화 흐름에서 조용히 제시하는가.
- 표면: Today / Tool·Connection Center.
- 합격: 상태 표면이 관리자화가 아니라 작업 연결로 작동한다.

---

## 3. BEAI5 자연스러움 회귀 판정 기준 (S38–S41 상세)

§9 gate의 5개 실패 대상을 시나리오 판정 기준으로 고정한다. Phase 5에서 이 표가 자연스러움 회귀
테스트의 근거가 된다(코드는 Phase 5).

| 감지 대상 | 실패 신호 | 판정 근거 계약 |
| --- | --- | --- |
| rigid prompt template | 고정 서두·구조 반복, 언어감각 상실 | Task Context Packet.naturalness(§11) |
| BEAI5 축소 | 체크리스트·분류기가 판단을 대체 | §10.2 모델 판단 영역 |
| 과잉 통제 | OS가 판단·순서까지 결정 | §10.2 / 계획서 §5.6.2 |
| 내부 상태 노출 | 자기파악이 기본 대화 점유 | 헌법 §5 / UX §1.1 |
| 도구 사실성 위반 | 답이 ToolReceipt와 불일치 | §7 / 헌법 §2-5 |

BEAI5 최종 기준(§10.3): 응답 뒤 사용자의 현실이 더 선명해지고, 판단 부담이 줄며, 실제로 쓸 수 있는
무언가가 남았는가. 이 기준을 통과하지 못하면 나머지 계약을 지켜도 실패로 본다.

## 4. 안티 대시보드 검증 기준 (S42–S44 상세)

사용자 원요구(자연 웹챗 + 고기능)와 UX §1.2를 시나리오 판정선으로 고정한다.

| 검증 항목 | 통과 | 실패(대시보드 회귀) |
| --- | --- | --- |
| 첫 화면 | Work Chat 중심, 상태는 접힘 | 관리 패널·표가 기본 노출 |
| 내부용어 | userSafeSummary만 | 스택·raw·provider·schema 노출 |
| 상태 표면 | 필요할 때 열리는 보조 표면 | 항상 펼쳐진 콘솔 |
| 사용자 인식 | "말하면 일이 이어진다" | "시스템을 조작한다" |
| 계약 증가 효과 | 계약 늘수록 첫 화면 더 단순 | 계약 늘수록 화면 복잡 |

## 5. 판정 매트릭스 (44개 시나리오 × 4축)

각 시나리오는 §1의 4개 상위 판정축을 모두 통과해야 합격이다.

| 축 | 통과 기준 | 관련 시나리오(대표) |
| --- | --- | --- |
| 계약 정합성 | 모든 단계가 실제 필드/열거값에 매핑 | 전체 |
| 자연스러움 | 단순 대화가 무겁게 실리지 않음 | S01–S04, S38–S41 |
| 안티 대시보드 | 내부용어·상태가 대화를 점유하지 않음 | S10, S18, S42–S44 |
| 막다른 답 금지 | 실패·차단에도 nextSafeAction | S15–S19, S28–S31, S34 |

범주 커버리지(감사 12범주 전부):

| 범주 | 시나리오 | 개수 |
| --- | --- | --- |
| 단순 대화 | S01–S04 | 4 |
| 복합 작업 | S05–S08 | 4 |
| 장기 프로젝트 | S09–S11 | 3 |
| 도구 사용 | S12–S15 | 4 |
| 도구 실패 | S16–S19 | 4 |
| 외부 전송 승인 | S20–S23 | 4 |
| 기억 승격 | S24–S27 | 4 |
| 복구 | S28–S31 | 4 |
| 자동화 후보 | S32–S34 | 3 |
| 멀티 프로젝트 | S35–S37 | 3 |
| BEAI5 자연스러움 회귀 | S38–S41 | 4 |
| UX 안티 대시보드 검증 | S42–S44 | 3 |
| **합계** | **S01–S44** | **44** |

## 6. Phase 5 연결

- 이 44개 시나리오는 Phase 5에서 **인수(acceptance) 재생 하니스**의 근거가 된다. 각 시나리오의
  합격 조건이 실행 가능한 검증으로 번역된다(코드는 Phase 5, 절대원칙 §12 순서).
- 자연스러움 회귀(S38–S41)와 안티 대시보드(S42–S44)는 negative 검증으로, "무엇을 실패로 보는지"를
  코드 이전에 고정한다(§9 gate가 Phase 4 회귀 테스트로 고정된다는 계약 규칙 이행).
- 첫 빌드 슬라이스(UX §헌법 §7)에 드는 시나리오: S01·S04(fast/확인), S05(complex), S12(도구 사실성),
  S16(실패 복구), S20·S23(승인/거부), S30(복구 봉투). 나머지는 P1 표면과 함께.

## 7. 정본 수정 제안 (감사·다음 Phase 판단용, 정본 수정 아님)

1. 시나리오 합격 조건의 실행 가능한 검증 형태(입력·기대·판정)는 Phase 5 착수 시 확정한다. 이 문서는
   계약 재생 명세까지만 정한다.
2. 자동화 후보는 Phase 4에서는 FollowUpEvent + AuthorityGrant 조합으로 봉인한다. Phase 5 자동화 구현 전,
   별도 계약으로 승격할지 기존 계약 조합으로 유지할지 다시 결정한다.

---

*Codex 감사 결과 이 문서는 Phase 4 Scenario Replay Spec 으로 봉인한다. 다음 단계는 Phase 5 First Build Slice 다.*
