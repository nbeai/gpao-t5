# P6-2 Slice-3 ConnectorProfile & 멀티채널

- Date: 2026-07-25
- Author: Claude Code (구현자)
- 대상: `src/kernel/l2-plan/connector-profile.js`(신규) · `inbound-gate.js`(normalizeInboundEvent) ·
  `server.js`(/connectors·/channel/inbound) · `demo-context.js`
- 근거 정본: 봉인 Kernel Contract §1.5 InboundEventGate·§6.5 ToolDescriptor / Tool&Connector Seal §2·§3
- 참고(비반영): `EXTERNAL-SOURCE-WATCHLIST`(Composio·MCP 등, 감사 참고 자료)

## 0. 두 핵심 불변식 (깊은 감사)

1. **채널이 달라도 같은 OS 흐름을 탄다.** 채널 메시지는 단일 `normalizeInboundEvent`로 정규화되어
   **같은 InboundEventGate → turn**을 탄다. 채널별 로직을 커널에 두지 않는다(Hermes MessageEvent 흡수).
2. **외부 채널 메시지는 자동 신뢰가 아니다.** mention/allowlist/DM 트리거가 없으면 `gated`로 응답하지
   않는다(§1.5). 아무 채널 잡담에 반응하지 않는다 — 알림 콘솔화·주입 방어.

## 1. 계약

- **ConnectorProfile**(선언형): `{id, label, kind(channel/provider), authState(none/api_key/oauth/session), connected}`.
  클라이언트 구성·자격 회전은 소유하지 않는다(참고 계열 복제 금지).
- **두 축 분리(auth ≠ approval)**:
  - `connectorReadiness` = 연결 생존성(disconnected/needs_auth/ok). 자격(authState) 축.
  - `sendNeedsApproval` = **항상 true**. 연결·인증돼도 외부 전송은 A2 승인(헌법 §3-6). 승인 축.
- **connectorToConnection**: 채널을 SelfState connection 형태로(status·needsApproval 두 축 보존).
- **normalizeInboundEvent**: 채널 메시지 → `{source:'external_channel', text, triggerSignals, channelMeta}`.
  mention/allowlisted/direct_message 신호만 결정적으로(모델 판단 아님).

## 2. 채널 메시지 게이트 순서 (감사 보정 — 정본)

`POST /channel/inbound`는 아래 순서를 반드시 지킨다. 하나라도 실패하면 커널로 넘기지 않고 gated/blocked로
끝내며 **transcript에 남기지 않는다.**

1. **sessionId 존재** 확인(없으면 400/404).
2. **channel 필드 존재** 확인(없으면 blocked:no_channel).
3. **ConnectorProfile registry에서 channel 확인**(미등록이면 blocked:unknown_channel).
4. **connectorReadiness === 'ok'** 확인(disconnected/needs_auth면 blocked:channel_not_ready).
5. **normalizeInboundEvent**(단일 정규화).
6. **InboundEventGate**(mention/allowlist/DM 판정). 트리거 없으면 gated.
7. **respond일 때만 runTurn**(같은 커널).
8. **gated/blocked는 transcript 미기록.** respond(reply/approval/clarify)만 기록·지속.

이유: unknown·disconnected 채널이 mention만으로 응답·기록되면 자동 신뢰·오염이 된다(감사 지적).
`GET /connectors`는 자격(readiness)과 전송승인(sendNeedsApproval)을 두 축으로 보여준다.

### authState 의미 (감사 선택 보정)
- `none` = **인증이 필요 없는 커넥터**(공개). "인증 미설정"이 아니다.
- 저장된 자격이 있어야 하는 커넥터의 미설정 상태는 별도 `requiresAuth`(+미설정) 필드로 다음 slice에서
  구분한다. 지금은 none=인증불요로 고정한다.

## 3. 범위 (오너 — 계약·최소 동작)

실제 Telegram/Slack adapter·relay·gateway는 만들지 않는다(Watchlist 참고, P6 후속). ConnectorProfile
계약 + 정규화 + 같은-흐름 라우팅 + mention-gating까지. 사용자 채팅 흐름 불변.

## 4. 검증

- **106개 테스트 통과**(+connector-profile 4 + server 채널 4).
- **감사 보정**: unknown 채널·disconnected 채널은 mention이 있어도 커널로 안 넘기고 blocked(미기록).
  반대 테스트로 확증(게이트 무력화 시 응답·기록으로 새어 실패).
- **라이브**: 일반 채팅 유지 / 채널 트리거 없음→gated / mention→reply(같은 커널) / unknown·disconnected→
  blocked / 커넥터 텔레그램(ok,전송승인) 슬랙(disconnected,전송승인).
- 회귀: auth≠approval·InboundEventGate·SelfState 정합 유지.

## 5. 제안하는 Kernel Contract 개정 (감사 후)

- §신규 ConnectorProfile 계약(authState·readiness·auth≠approval).
- §1.5 InboundEventGate에 normalizeInboundEvent(단일 정규화) 연결 명시.
- **감사 통과 후** 봉인 반영(지금 미수정).

## 6. P6 다음

실제 채널 adapter(단일 MessageEvent 파이프라인·registry), 채널별 세션 라우팅(profile_routing),
전송 시 customer-vault unmask, Connection Center 실화면. 이 계약이 그 경계.
