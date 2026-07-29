# GPAO-T5 UX Architecture

- Status: `historical_ux_architecture_foundation`
- Date: 2026-07-24
- Author: Claude Code (구현자)
- Auditor: Codex (표면 정합성·계약 번역·자연스러움·Phase 4 연결성 감사 완료)
- Phase: `GPAO-T5-FINAL-DEVELOPMENT-PLAN` Phase 3 UX Architecture
- 근거: 계획서 §4(표면)·§7(UX 방향) / Kernel Contract(봉인) / Product Constitution(봉인) / 두 감사 문서
- 위상: 이 문서는 헌법·Kernel Contract 아래에서 계약을 사용자 표면으로 번역한다. UI 구현·컴포넌트
  위, Kernel Contract 아래(절대원칙 §12 순서).
- 현재 적용: 정보 구조의 기반으로 보존한다. 현재 UI와 사용자 흐름은 전달된 제품·인수인계 §0·최신
  인간 시나리오가 우선한다. 내부 후보·원리·검사 상태는 기본 대화를 점유하지 않고, 승인 카드는 실제
  비가역 외부 효과·새 권한·중대한 대상 불확정에만 사용한다.

## 0. 작성 규율 + 번역의 성격

- 제품 코드·픽셀 디자인·컴포넌트는 만들지 않는다(계획서: 코드 착수 Phase 5). 이 문서는 정보 구조와
  상태 언어이지 시각 디자인이 아니다.
- 정본 문서·README·AGENTS를 수정하지 않는다. 수정 의견은 §16 제안으로만.
- **화면은 새 발명이 아니라 Kernel Contract 계약의 번역이다.** 화면이 보여주는 모든 것은 계약 필드로
  거슬러 올라가야 한다. 필드에 없는 상태를 화면이 지어내면 UI-runtime 불일치다(헌법 §2-5).
- 감사 지시(Phase 3): 14개 표면 각각이 아래 6요소를 가진다.

## 1. 공통 표면 계약 (모든 화면이 지키는 프레임)

감사가 요구한 6요소를 Kernel Contract 필드에 매핑한다. 이 매핑이 UX와 커널의 단일 진실이다.

| 6요소 | 정의 | 근거 계약 필드 |
| --- | --- | --- |
| **현재 가능한 일** | 지금 바로 할 수 있는 것 | SelfStateSnapshot.connectedTools(executable=true), grantedAuthorities |
| **막힌 일** | 지금은 못 하는 것과 그 이유 | SelfStateSnapshot.limits, modelAuthState≠usable |
| **다음 안전 행동** | 막다른 답 대신 제시할 한 걸음 | SelfStateSnapshot.nextSafeAction, ToolReceipt.nextSafeAction |
| **필요한 승인** | 실행 전 사용자 확인이 필요한 것 | AuthorityGrant(approvalRequired=true, approvalPreview) |
| **실행/도구/원장 상태** | 무엇을 시도했고 어떻게 됐는지 | ToolReceipt(actualCall, failureState, userSafeSummary) |
| **자기파악 표시** | 대화 흐름을 방해하지 않는 현재 상태 | SelfStateSnapshot 요약(§헌법 5: 기본 화면 점유 금지) |

### 1.1 모든 화면의 표시 원칙 (계획서 §7)

- 기본 화면은 채팅과 현재 작업이 중심이다. 자기파악 표시는 필요할 때 열리되 대화 흐름을 점유하지 않는다.
- 내부 용어·raw path·stack trace·provider 내부 오류를 기본 화면에 노출하지 않는다. 진단은
  ToolReceipt.diagnosticTrace(감사 보강)로 분리하고, 사용자면은 userSafeSummary만 쓴다.
- 상태 표시는 짧은 한국어다.
- **"무엇을 할 수 있음"과 "지금 해도 됨"을 분리**한다(가능 ≠ 승인됨).
- 도구를 못 쓰는 상황에서도 막다른 답으로 끝내지 않고 다음 안전 행동을 제시한다.
- 설정·연결·권한·기억은 대화 흐름을 방해하지 않되 필요할 때 즉시 열린다.

### 1.2 안티 대시보드 원칙

T5는 복잡한 개발자 대시보드가 아니다. 내부 계약이 많아질수록 사용자 첫 화면은 더 단순해야 한다.

- 기본 화면은 Work Chat 이다.
- 상태 패널은 기본 노출이 아니라 필요할 때 열리는 보조 표면이다.
- 내부 로그, raw path, stack trace, provider error, schema 이름은 사용자 기본 화면에 나오지 않는다.
- Today / Project / Connection / Ledger 는 사용자를 관리자로 만드는 화면이 아니라, 대화 흐름에서 필요한
  상태와 다음 행동을 조용히 보여 주는 작업 표면이다.
- 사용자가 "시스템을 조작한다"고 느끼기보다 "말하면 일이 이어진다"고 느껴야 한다.

### 1.3 상태 언어(모든 화면 공통 어휘)

계약의 열거값을 사용자 문장으로 번역한다. 화면마다 다시 정의하지 않는다.

| 계약 상태 | 사용자 표시(짧은 한국어) |
| --- | --- |
| executable=true | 바로 사용 가능 |
| connected, 승인필요 | 연결됨 · 승인 필요 |
| needs_connection | 연결하면 가능 |
| modelAuthState=billing_blocked | 결제 확인 필요 (재시도 아님) |
| modelAuthState=rate_limited | 잠시 후 다시 |
| failureState=blocked | 사이트/권한이 막음 |
| AuthorityGrant.tier=A3 | 강한 승인 필요 |

---

## 2. 표면 카탈로그 (14개 화면)

각 화면은 동일 형식으로 정의한다: **역할 / 근거 계약 / 6요소 표시 / 대화 흐름과의 관계 / 비범위.**
첫 빌드 슬라이스(헌법 §7)에 드는 화면은 별도 표시한다.

### 2.1 Work Chat  *(첫 슬라이스 · 심장)*

- **역할**: 모든 작업의 시작점. 사용자의 말이 IntentPacket으로 해석되고, fast/complex 경로로 갈린다.
- **근거 계약**: IntentPacket, ActionPlan, ToolReceipt, FollowUpEvent, Task Context Packet.
- **6요소**: 가능=연결 도구 배지 / 막힘=modelAuthState≠usable 배너(결제 vs 한도 구분) / 다음 안전
  행동=답 끝에 한 줄 / 필요 승인=인라인 approvalPreview 카드 / 실행상태=진행 중 도구 표시 +
  완료 후 userSafeSummary / 자기파악=상단에 현재 모델 칩(클릭 시 SelfState 열림, 평소 접힘).
- **대화 흐름**: fast_chat은 계약을 가볍게 통과해 즉답. complex_work는 계획·진행·결과를 대화 옆에.
- **비범위**: 없음(첫 슬라이스 핵심).

### 2.2 Today / Home OS

- **역할**: 오늘 해야 할 일, 이어갈 일, 막힌 일. 로그인 후 첫 화면.
- **근거 계약**: FollowUpEvent(대기), AuthorityGrant(보류 승인), SelfStateSnapshot(연결), ToolReceipt(최근 결과).
- **6요소**: 가능=오늘 할 수 있는 것 / 막힘=막힌 일과 이유 / 다음 안전 행동=제안 카드 / 필요 승인=
  대기 중 승인 목록 / 실행상태=최근 결과 요약 / 자기파악=현재 연결·다음 안전 행동을 한눈에.
- **대화 흐름**: 진입점일 뿐 대화를 대체하지 않는다. 한 항목 클릭 시 Work Chat으로 이어짐.
- **비범위**: P1(계획서 택소노미). 첫 슬라이스 아님.

### 2.3 Project Rooms

- **역할**: 장기 프로젝트 단위. 목표·파일·대화·결정·실행 기록·기억 후보·자동화 후보를 묶음.
- **근거 계약**: ActionPlan(목표·성공기준), ContextAdmissionPacket(기억 후보), ToolReceipt(실행 기록).
- **6요소**: 가능=이 방에서 할 수 있는 것 / 막힘=연결 필요 도구 / 다음 안전 행동=미완 작업 / 필요
  승인=이 방의 대기 승인 / 실행상태=결정·실행 로그 / 자기파악=이 프로젝트에 붙은 자원.
- **대화 흐름**: 방 안에서 Work Chat이 열린다. 세션이 바뀌어도 목표·미완료를 좁게 이어감(long-flow).
- **비범위**: P1.

### 2.4 Memory / Context Center

- **역할**: 기억과 맥락 관리. raw 기록·후보·승인된 기억·작동 원리·영향 범위·되돌리기.
- **근거 계약**: ContextAdmissionPacket(전체 승격 흐름), customer-vault(민감정보 격리).
- **6요소**: 가능=지금 영향 주는 기억 / 막힘=승격 대기 후보 / 다음 안전 행동=검토 요청 / 필요 승인=
  operating_principle 승격 승인 / 실행상태=admitted 여부 / 자기파악=preference와 operating_principle 분리 표시.
- **대화 흐름**: 기억 승격은 대화를 막지 않고 후보로 빠진다(헌법 §3-5). 되돌리기 가능(rollbackable).
- **비범위**: 민감정보 삭제 UI는 헌법 §7대로 Phase 1 비범위 → 여기서도 권한계약만, 삭제기능 후속.

### 2.5 Tool / Connection Center

- **역할**: 모델·앱·로컬 도구 연결. 읽기/쓰기 권한, 복구 행동, 비용·외부 전송 경계.
- **근거 계약**: SelfStateSnapshot.connectedTools, AuthorityGrant, ToolReceipt.
- **6요소**: 가능=바로 쓰는 연결 / 막힘=연결 필요·준비 중 / 다음 안전 행동=연결 방법 안내 / 필요
  승인=쓰기/전송 권한 / 실행상태=연결 상태 배지 / 자기파악=각 도구의 executable 여부.
- **대화 흐름**: 목록에 올린 것은 T5가 끝까지 붙여준다(헌법 §4.2, 죽은 버튼 금지). "할 수 있음"과
  "해도 됨" 분리(§1.1).
- **비범위**: 없음(연결 상태는 첫 슬라이스 Connection status에 포함).

### 2.6 Task / Automation Center

- **역할**: 반복·예약·모니터링. 비활성 후보·승인된 작업·다음 실행·중지·실패 복구.
- **근거 계약**: GrowthCandidate 흐름, AuthorityGrant(A2 활성화), FollowUpEvent.
- **6요소**: 가능=지금 켤 수 있는 자동화 / 막힘=승인 필요 / 다음 안전 행동=검토 큐 항목 / 필요 승인=
  활성화(A2) / 실행상태=다음 실행·최근 실패 / 자기파악=활성 vs 후보 구분.
- **대화 흐름**: 자동화는 review queue에서 시작, 외부효과는 명시 승인(헌법 §4.5). 숨어서 행동 안 바꿈.
- **비범위**: P1.

### 2.7 Canvas / Workboard

- **역할**: 산출물 편집. 문서·코드·표·조사 결과·메시지 초안의 직접 편집과 버전.
- **근거 계약**: ActionPlan(산출물이 성공기준), ToolReceipt(생성 기록).
- **6요소**: 가능=편집 가능 산출물 / 막힘=생성에 필요한 도구 / 다음 안전 행동=다음 편집 제안 / 필요
  승인=외부 게시(A2·A3) / 실행상태=버전 이력 / 자기파악=이 산출물을 만든 근거.
- **대화 흐름**: 대화 옆에서 편집. 버전 되돌리기. 외부 게시는 authority gate.
- **비범위**: P1.

### 2.8 Local PC Workspace

- **역할**: 로컬 파일·브라우저·앱 작업. 실행 전 미리보기, 실행 중 상태, 결과, rollback 또는 non-mutation 증거.
- **근거 계약**: ToolReceipt(actualCall·failureState), AuthorityGrant, SelfStateSnapshot.
- **6요소**: 가능=실행 가능 로컬 작업 / 막힘=권한·환경 부족 / 다음 안전 행동=대안 / 필요 승인=파일
  변경·실행(A2·A3) / 실행상태=실행 전 미리보기 → 진행 → 결과 / 자기파악=rollback 가능 여부.
- **대화 흐름**: 되돌리기 어려운 실행은 실행 직전 게이트. 변경 없는 작업은 non-mutation 증거.
- **비범위**: P1.

### 2.9 Channel Inbox

- **역할**: Telegram/Slack/메일 등 외부 소통. 채널별 대화 분리, 외부 전송 전 확인, 발신/수신 원장.
- **근거 계약**: AuthorityGrant(A2 전송), ToolReceipt(발신 원장), customer-vault(전송 시 unmask).
- **6요소**: 가능=연결된 채널 / 막힘=연결 필요 채널 / 다음 안전 행동=연결 안내 / 필요 승인=외부
  발신(A2) / 실행상태=발신/수신 원장 / 자기파악=채널별 연결 상태.
- **대화 흐름**: 외부 전송 전 반드시 멈춤(헌법 §3-6). 민감정보는 전송 직전에만 unmask(§4.3).
- **비범위**: P1.

### 2.10 Approval Center

- **역할**: 권한 경계 집중 관리. 보류 중 승인·영향·범위·기간·취소·되돌리기.
- **근거 계약**: AuthorityGrant 전체(approvalPreview, grantScope, revocable).
- **6요소**: 가능=승인하면 되는 것 / 막힘=차단(A3) / 다음 안전 행동=검토 / 필요 승인=목록 그 자체 /
  실행상태=승인/거부 이력 / 자기파악=현재 부여된 권한 범위.
- **대화 흐름**: 인라인 승인(Work Chat)과 중앙 관리(여기)를 같은 AuthorityGrant로 단일화.
- **비범위**: 중앙 화면은 P1. 단 인라인 승인은 첫 슬라이스(Authority A0-A3)에 포함.

### 2.11 Evidence / Truth Ledger  *(첫 슬라이스)*

- **역할**: 신뢰 표면. 도구 사용·검색·실행·실패·불확실 결과·재시도 여부.
- **근거 계약**: ToolReceipt 전체(userSafeSummary + diagnosticTrace 분리).
- **6요소**: 가능=확인된 것 / 막힘=확인 못 한 것 / 다음 안전 행동=재시도/대안 / 필요 승인=재실행 /
  실행상태=원장 그 자체 / 자기파악="확인/미확인/추정" 분리.
- **대화 흐름**: 사용자 답변은 이 원장 기준으로 확인/미확인/추정을 나눈다(계획서 §5.4). 사용자면은
  userSafeSummary, 진단면은 diagnosticTrace로 분리(감사 보강).
- **비범위**: 없음(Truth Ledger는 첫 슬라이스).

### 2.12 Recovery Center

- **역할**: 문제 해결. 현재 안전 여부, 잃지 않은 것, 한 가지 다음 복구 행동.
- **근거 계약**: ToolReceipt(failureState·nextSafeAction), ActionPlan(recoveryCriteria).
- **6요소**: 가능=지금 안전한 것 / 막힘=실패한 것 / 다음 안전 행동=한 가지 복구 행동 / 필요 승인=
  복구 실행 / 실행상태=무엇이 잃지 않았는지 / 자기파악=현재 안전 여부.
- **대화 흐름**: 오류가 나도 막다른 답이 아니라 "무엇이 안전하고 다음에 뭘"을 준다(성공기준 9).
  사용자면/진단면 분리(감사 §3-2·3).
- **비범위**: P1(단 복구 문장은 Recovery Envelope로 첫 슬라이스에서도 작동).

### 2.13 Growth Center

- **역할**: 개선 제안. 학습 후보·replay 결과·적용 전 미리보기·거절·되돌리기.
- **근거 계약**: GrowthCandidate 흐름, ContextAdmissionPacket(replay·approval).
- **6요소**: 가능=적용 가능한 개선 / 막힘=검증 미달 후보 / 다음 안전 행동=검토 / 필요 승인=적용
  승인 / 실행상태=replay 결과 / 자기파악=후보 vs 적용됨.
- **대화 흐름**: 성장은 숨어서 행동 안 바꿈. 후보→검토→승인→되돌리기(헌법 §4.5).
- **비범위**: P1.

### 2.14 Model Router

- **역할**: 모델 선택과 성능 상태. 현재 모델·연결 상태·지연/비용/권한·fallback 가능 여부.
- **근거 계약**: SelfStateSnapshot(currentModel, modelAuthState).
- **6요소**: 가능=쓸 수 있는 모델 / 막힘=결제/한도/인증 실패(구분) / 다음 안전 행동=전환/결제 안내 /
  필요 승인=없음(선택은 A0) / 실행상태=현재 모델·fallback / 자기파악=modelAuthState.
- **대화 흐름**: 죽은 자격증명이 사용을 막지 않는다. billing과 rate_limit 구분(헌법 §4.1, T3 사고 헌법화).
  등록된 자격증명 전체에서 교차 선택(입력창·설정 양쪽).
- **비범위**: 전체 화면은 P1. 단 현재 모델 표시는 첫 슬라이스 SelfStateSnapshot에 포함.

---

## 3. 첫 빌드 슬라이스의 화면 경계 (헌법 §7)

첫 슬라이스는 14개 전부가 아니다. 아래 흐름이 한 화면 언어로 도는지만 본다.

```text
Work Chat(§2.1) — 심장
  + SelfStateSnapshot 표시(현재 모델 칩, Model Router §2.14의 최소형)
  + Connection status(Tool/Connection Center §2.5의 최소형)
  + Authority A0-A3 인라인 승인(Approval Center §2.10의 인라인형)
  + Truth Ledger(Evidence §2.11)
  + Follow-up Queue(Work Chat 내 새 지시 처리)
```

나머지 화면(Today·Project·Memory·Canvas·Local PC·Channel·Automation·Growth 전체 화면)은 P1이며,
이 문서는 그 정보 구조를 미리 정의해 두되 첫 슬라이스 구현 대상이 아니다.

---

## 4. 표면 간 단일 상태 언어 (계획서 §4 "같은 상태 언어")

14개 화면이 같은 계약을 보므로, 상태는 화면마다 다르게 표현되지 않는다.

- 같은 도구의 "연결됨·승인 필요"는 Work Chat·Connection Center·Channel Inbox에서 동일 문구.
- 같은 승인 대기는 Work Chat 인라인과 Approval Center에서 같은 AuthorityGrant를 가리킴.
- 같은 실행 실패는 Truth Ledger·Recovery Center에서 같은 ToolReceipt를 가리킴.
- 데스크톱·모바일·CLI 표면 간에도 이 상태 언어는 통일된다(계획서 §4, Phase 후속에서 표면 확장).

이것이 "같은 상태 언어"의 뜻이다: 화면은 여럿이나 진실(계약)은 하나다.

---

## 5. Phase 4 연결성 + 정본 수정 제안

이 UX Architecture는 Phase 4 Scenario Replay가 검증할 사용자 경로의 화면 정의다. Phase 4는 40개
이상 인간 시나리오에서 이 화면들이 계약대로 도는지, 자연스러움이 훼손되지 않는지 본다.

- 자연스러움 회귀 시나리오는 §1.1 표시 원칙(내부용어 비노출·대화흐름 비점유)을 화면에서 검증한다.
- 각 화면의 6요소가 계약 필드로 실제로 채워지는지, 화면이 지어낸 상태가 없는지 검증한다.

정본 수정 제안(계획서·절대원칙 수정 아님, 감사·다음 Phase 판단용):

1. 픽셀·컴포넌트·레이아웃은 Phase 5 착수 시 정한다. 이 문서는 정보 구조와 상태 언어만.
2. 다중 표면(데스크톱/모바일/CLI) 확장은 계획서 P1~P2 대상. 이 문서는 상태 언어 통일 원칙만 고정하고
   표면별 구현은 후속 Phase로 미룬다.

---

*Codex 감사 결과 이 UX Architecture 는 Phase 3 산출물로 봉인한다. 다음 단계는 Phase 4 Scenario Replay 다.*
