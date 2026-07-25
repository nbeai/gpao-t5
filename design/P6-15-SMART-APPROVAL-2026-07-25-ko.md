# P6-15 · Smart Approval 표면화 (첫 슬라이스)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기(권한 표면·안전 바닥).
근거: Hermes 승인 UX(복제 아님, T5 재구성), 헌법 §3(AuthorityGrant A0-A3), CLAUDE.md.
관련: [[gpao-t5-hermes-absorption-roadmap]], §6.13 Delivery Ledger(외부 전송 A2), Approval Lifecycle.

## 왜

승인 체계가 **정확하지만 사용자가 왜 멈추는지 모른다.** 목표는 승인을 **느슨하게 만드는 게 아니라
사용자가 덜 헤매게** 하는 것 — 위험한 일은 계속 멈추고(안전 바닥), 낮은 위험만 자연 진행하며, 멈출 땐
**왜 멈추는지 사용자 언어로** 설명한다. 첫 슬라이스는 **정책을 바꾸지 않고**(기본 동작 그대로) 현재 A0-A3
판단을 사용자 표면에 자연스럽게 보여주는 것부터.

## 절대 원칙 (안전 바닥)

- **안전 바닥은 어느 모드에서도 자동 승인 금지.** 외부 전송·SaaS 쓰기·자동화 활성화·장기 기억 승격·삭제·
  결제·게시·민감 내보내기·권한 상승/변경·비밀/계정 접근은 **항상 A2+**. Smart라고 이걸 자동 통과시키지 않는다.
- **자동 진행은 명시된 저위험 allowlist만**(감사 blocker 1). 모르는 kind는 자동 진행하지 않는다 —
  `classifyTier` default = **A2**(애매하면 높은 등급), `decideAutoGrant`는 `AUTO_SAFE_KINDS`(read/summarize/
  search/draft = A0, organize/title/archive = A1) 안에 있을 때만 true. 새 도구·플러그인·커넥터가
  `toolKind:'transfer_money'`처럼 매핑에 없어도 A0로 새지 않는다.
- 안전 바닥·allowlist는 tier 분류와 **독립된 불변식**이다 — tier가 낮게 회귀해도 auto가 새지 않는다(방어적 이중화).
- 저위험(A0 읽기/요약, A1 되돌릴 수 있는 로컬 정리)만 자연 진행. 사용자는 덜 멈추고, 위험한 건 계속 멈춘다.

## 계약 (`l2-plan/authority.js`, `contracts.js`)

- `ApprovalMode = 'manual'|'smart'|'strict'`(`APPROVAL_MODES`, 기본 `smart`). 모드는 **저위험을 얼마나
  통과시키느냐만** 조절한다:
  - manual/smart: A0·A1 자연 진행, 그 외 승인. (smart는 판단 이유를 표면화)
  - strict: A1(되돌릴 수 있는 정리)도 확인. A0만 자연 진행.
- `SAFETY_FLOOR_KINDS` + `isSafetyFloor(kind)` — 항상 승인 집합. `AUTO_SAFE_KINDS` — 자동 진행 저위험 allowlist.
- `decideAutoGrant(action, mode)` → 승인 없이 진행할지. **안전 바닥 먼저 차단 → allowlist(always=A0 / reversibleLocal=
  A1, strict 제외)에 있을 때만 true → 그 외(모르는 kind 포함) 승인.** tier에 의존하지 않아 오분류에도 안전.
- `grantFor(action, mode)` — `granted`는 모드가 아니라 위험이 정한다. grant에 `kind`·`safetyFloor`·`reason` 부착.
- `explainAuthority(action, mode)` → `{tier, needsApproval, safetyFloor, why, whatChanges, reversible}`.
  **개발자식 용어(A2/tier/grant…) 금지 — 사용자 언어.** 자동 진행은 "왜 바로 했는지", 승인 필요는
  "왜 필요한지/무엇이 바뀌는지/되돌릴 수 있는지".

## 배선

- `buildActionPlan({intent, selfState, mode})` → grantFor에 mode 전달(기본 smart, 정책 불변).
- 턴: `approvalMode = ctx.approvalMode ?? 'smart'`. 승인 카드 응답에 `approvalMode` + 각 grant의 `reason`·
  `safetyFloor`를 실어 보낸다. send류는 reason.whatChanges를 구체 대상·내용으로 채운다.
- UI(`web/index.html`): 승인 카드에 조용한 모드 표시("승인 모드: 스마트 · 위험한 일만 멈춰서 확인해요") +
  A2/A3 배지 + **꼭 확인** 배지(내부어 `safetyFloor`는 필드로 유지, 화면은 사용자 언어 — 감사 blocker 2) +
  "왜 확인하나요/어디에·무엇을/되돌리기"를 사용자 언어로.

## 테스트 (12, 총 236)

A0 자연 진행 · A1 manual/smart 통과·strict 확인 · A2 전송 승인 유지(모든 모드) · 삭제(A3) 승인 유지 ·
**안전 바닥은 Smart 포함 어느 모드도 자동 승인 불가(반대 테스트 핵심)** · 안전 바닥/allowlist tier 회귀 독립성 ·
**unknown kind 자동 승인 불가(blocker 1): decideAutoGrant false, grantFor approvalRequired, unknown toolKind
descriptor가 autoAllowed로 안 샘, 기존 저위험 유지** · **화면 라벨에 "안전 바닥" 미노출(blocker 2)** ·
explainAuthority 사용자 언어 · 서버: 전송이 승인 카드에 approvalMode+reason 실어 멈춤.

반대 테스트: (a) `decideAutoGrant`에 "smart면 무조건 통과" 주입 시 바닥/전송/삭제 6건 실패 실측. (b) blocker 수정
전 코드(default A0·tier 신뢰·"안전 바닥" 배지)로 되돌리면 blocker 테스트 4건 실패 실측 → 수정이 load-bearing.
라이브: 전송→카드("A2 꼭 확인" + 이유), 저위험 질문→카드 없이 응답.

## 남은 후속

- **모드 전환 UI + 저장**: 이 슬라이스는 판단 표면까지. 실제 모드 토글(수동/스마트/엄격)과 세션·전역 저장은 후속.
- 자동 진행 이유의 조용한 표면화(요청 시 펼치기 — 안티 대시보드 유지).
- §6.13 Delivery Ledger 후속(원 승인 만료 후 재승인)과 연결: 승인 만료·재승인 표면도 이 이유 체계로.
- 위험 tier의 세분(예: 같은 send라도 공개 범위에 따라)과 사용자별 신뢰 학습은 신중히(안전 바닥 불변 유지).
