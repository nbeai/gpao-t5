# GPAO-T5 Approval Lifecycle Contract

- Status: `초안 작성 완료 · 감사 전 (깊은 감사 대상 — 권한/외부실행 경계)`
- Date: 2026-07-25
- Author: Claude Code (구현자)
- Auditor: Codex (감사 대기)
- Phase: P6 진입 선행 계약(오너 지시) — living 슬라이스·Tool&Connector Seal이 가리킨 동일 지점
- 근거: 봉인 Kernel Contract §3 AuthorityGrant / living 슬라이스 조건부 메모 / Tool&Connector Seal
  (승인 fail-closed, delivery lifecycle) / Hermes 승인 어휘(once/session/always/deny)·write_approval staging
- 위상: Kernel Contract 아래. 승인의 **지속/만료/재승인 경계**를 계약으로 못박아 P6 권한/원장 진입 전
  구조를 안정시킨다.

## 0. 목적 + 문제

living Work Chat에서 승인 대기(pending)가 서버 메모리에만 있어 재시작 후 이어실행이 불가할 수 있었다.
Tool&Connector Seal도 P6 전 이 경계의 계약화를 요구했다. 이 계약은 **승인이 언제까지 유효하고, 만료되면
어떻게 되며, 재접속/재시작 후 어떻게 이어지는지**를 고정한다. 원칙: **무단 지연 실행 금지 + 죽은 버튼 금지.**

## 1. 계약 — AuthorityGrant.grantScope 정형화

`AuthorityGrant.grantScope = { kind: 'once' | 'session' | 'persist', expiresAt?: 시각 }`

| kind | 의미 | 도달 |
| --- | --- | --- |
| once | 이번 한 번만 유효 | **P5 도달** |
| session | 이 세션 동안 유효 | P6 |
| persist | 명시 취소까지 지속 | P6 |

- `expiresAt`: 승인 대기 생성 시각 + `APPROVAL_TTL_MS`(30분). 이후는 만료.
- P5는 `once` + 만료만 구현한다(도달값만; session/persist는 P6에서 grant registry·revocation과 함께).

## 2. 승인 수명 상태·규칙

```text
발화 → 승인 게이트 → [pending(active, expiresAt)] ──approve(유효)──→ 실행(계획 이어받음)
                                          ├──approve(만료)──→ 재승인 요청(실행 안 함)
                                          └──reject──────────→ 안전 정지(초안 보존)
```

- **지속**: pending은 세션과 함께 파일에 지속한다. 재시작 후에도 남는다.
- **만료(무단 지연 실행 금지)**: 만료된 승인을 approve하면 **이어실행하지 않고** "만료됐어요, 다시
  확인할게요"로 재승인을 요청한다. 시간이 지나 맥락이 바뀐 승인을 조용히 실행하지 않는다.
- **재접속 재행동(죽은 버튼 금지)**: 재접속 시 아직 유효한 승인(activePendingIds)은 카드를 다시 눌러
  이어실행할 수 있다. 만료·해소된 것은 "지난 승인 요청"으로만 표시하고 버튼을 살리지 않는다.
- **재해석 금지**: 승인은 보관된 봉인 계획을 이어받는다(발화 재해석 아님, 기존 감사 원칙 유지).
- **fail-closed**: 애매하면(찾지 못함·만료) 실행하지 않는다(Tool&Connector Seal 흡수).

## 3. P5 구현 (이 브랜치)

- Kernel(`turn.js`): 게이트에서 `grantScope{kind:'once', expiresAt: now+TTL}` 보관. approve 시 만료 검사
  → 만료면 재승인 요청. 시간은 `ctx.now`(테스트 주입, 실서버 Date.now). id는 `ctx.newId`(서버 UUID
  주입 — 지속 pending 간 충돌 방지; 미주입 시 카운터 폴백).
- 지속(`server.js`·`session-store.js`): pending을 `session.pendingApprovals`에 저장. `/sessions/:id`가
  `activePendingIds` 반환. 재시작(새 서버, 같은 저장소) 후 이어실행.
- UI(`web`): 재접속 시 activePendingIds로 유효 승인만 재행동 가능하게.

검증: 68개 테스트 통과(+만료 전/후 커널 2, 재시작 지속 HTTP 1). 반대 테스트 — 만료 체크 무력화 시
지연 실행이 뚫려 테스트 실패(확증). 라이브 — 실제 서버 재시작 후 승인 이어실행 실증.

## 4. P6로 넘길 것

- `session`/`persist` grant kind + **grant registry**(부여된 권한 목록)·**revocation**(취소).
- 프로젝트/프로필 격리 하에서 승인 범위(Tool&Connector Seal ConnectorProfile·auth≠approval).
- 승인 원장(누가·언제·무엇을 승인/거부/만료)과 P6 Truth Ledger 통합.

## 5. 제안하는 Kernel Contract 개정 (감사 후 반영)

봉인 §3.2 AuthorityGrant의 `grantScope` 행을 `{kind:'once'|'session'|'persist', expiresAt?}`로 정형화하고,
승인 만료→재승인·fail-closed 규칙을 §3 규칙에 추가한다. **감사 통과 후** 봉인 Kernel Contract에 반영한다
(지금 봉인 파일 미수정).

## 6. 감사 기준 (Codex, 깊은 감사)

1. 만료된 승인이 무단 지연 실행되지 않는가(반대 테스트로 확증).
2. 재시작 후 유효 승인이 이어실행되고, 만료/해소된 승인은 죽은 버튼이 아닌가.
3. 승인이 재해석이 아니라 보관 계획을 이어받는가(기존 원칙 유지).
4. pending id 충돌이 없는가(지속 하에서 UUID).
5. `npm test` + `npm start` + 실제 재시작으로 직접 확인.

---

*이 문서는 초안이다. Codex 깊은 감사 후 봉인하고 §5 개정을 Kernel Contract에 반영한다.*
