# P6-2 Slice-1 Tool Descriptor & Availability

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/kernel/l2-plan/tool-descriptor.js`(신규) · `contracts.js` · `self-state.js` · `demo-context.js`
- 근거 정본: 봉인 `GPAO-T5-TOOL-CONNECTOR-REFERENCE-SEAL` §1.1·§3 / Kernel Contract §6·§7
- 위상: P6-2 첫 슬라이스. 도구를 계약(ToolDescriptor)으로 세우고 기존 SelfState/ToolReceipt에 연결.

## 0. 스코프 (작게, 비파괴적)

**ToolDescriptor(소유≠실행 + availability 신호) + auth≠approval 분리 + 실패 cancelled/재시도 분류.**
아직 안 함: 멀티채널 커넥터·adapter, MCP, tool-call-repair, 터미널/원격 백엔드, ConnectorProfile 전체
(auth 흐름) — 이후 P6 슬라이스.

## 1. 흡수한 계약 (Seal §3 → 구현)

- **소유 ≠ 실행**: `ToolDescriptor{owner: core|plugin|channel|mcp, executor}` — 정의 주체와 실행 주체 분리.
- **availability 신호(allOf)**: `[{kind:auth|config|env|connected}]` — "왜 실행 가능/불가한지"를 담는다.
  `evaluateStatus(descriptor, facts)` → `usable|needs_auth|needs_config|needs_connection|blocked`
  (SelfState.connectedTools.status와 정합, Phase 5.1).
- **auth ≠ approval(핵심)**: availability(로그인·설정·연결 = 실행 가능성)와 `needsApproval`(행동 승인)은
  **다른 축**이다. "실행할 수 있음"과 "실행해도 됨"을 섞지 않는다(헌법 §3-3). 예: slack.post는 usable
  이지만 send라 승인 필요.
- **실패 분류**: `FailureState`에 `cancelled` 추가(Seal §3). `classifyRetry(failureState)` →
  `permanent`(blocked/cancelled) / `transient`(failed/timeout) — 복구 계층 힌트(Hermes permanent/transient).

## 2. 연결 (비파괴적)

- `toConnection(descriptor, facts)` → SelfState가 소비하는 connection 형태에 `status`를 직접 실는다.
- `self-state.js`는 `t.status ?? deriveToolStatus(t)` — descriptor가 준 status를 존중하되, 옛 형식은
  파생으로 하위호환. 기존 80개 테스트 불변.
- `demo-context.js`가 도구를 ToolDescriptor로 정의하고 환경 사실(연결·인증)로 connection 산출.
  mail.send는 `availability:[connected, auth]` + 인증 미준비 → needs_auth(연결됐으나 실행 준비 전).

## 3. 검증

- **84개 테스트 통과**(+tool-descriptor 4: 기본값·availability·auth≠approval·재시도 분류).
- **라이브**: demo self-state가 descriptor로 판정 — mail.send=needs_auth("아직 실행 준비 안 됨"),
  slack.post=usable+승인([A2]). auth≠approval 실작동.
- 회귀: 내부 id 비노출·SelfState/ToolReceipt 계약 정합 유지.

## 4. 제안하는 Kernel Contract 개정 (감사 후)

- §7 `ToolReceipt.failureState`에 `cancelled` 추가.
- §신규 ToolDescriptor 계약을 Kernel Contract에 정식 편입(현재 Tool&Connector Seal §3 + 이 구현).
- `classifyRetry`는 파생 헬퍼(계약 필드 아님) — 개정 불요.
- **감사 통과 후** 봉인 Kernel Contract에 반영(지금 봉인 파일 미수정).

## 5. P6 다음

ConnectorProfile(auth 흐름·DM 페어링), 멀티채널 adapter(단일 MessageEvent·레지스트리), MCP 연결,
tool-call-repair, 실행 백엔드. 이 descriptor가 그 위의 실체화 기반.
