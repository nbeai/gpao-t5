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

## 2. 흐름

```
채널 메시지 → normalizeInboundEvent → runTurn(source=external_channel, triggerSignals)
           → InboundEventGate: 트리거 있으면 respond(같은 커널), 없으면 gated(조용, 미기록)
```
`POST /channel/inbound`가 이 흐름을 태운다. gated 이벤트는 transcript에 남기지 않는다(조용).
`GET /connectors`는 자격(readiness)과 전송승인(sendNeedsApproval)을 두 축으로 보여준다.

## 3. 범위 (오너 — 계약·최소 동작)

실제 Telegram/Slack adapter·relay·gateway는 만들지 않는다(Watchlist 참고, P6 후속). ConnectorProfile
계약 + 정규화 + 같은-흐름 라우팅 + mention-gating까지. 사용자 채팅 흐름 불변.

## 4. 검증

- **104개 테스트 통과**(+connector-profile 4 + server 채널 2).
- **라이브**: 일반 채팅 유지 / 채널 트리거 없음→gated(미기록) / 채널 mention→reply(같은 커널) /
  커넥터 텔레그램(ok,전송승인) 슬랙(disconnected,전송승인).
- 회귀: auth≠approval·InboundEventGate·SelfState 정합 유지.

## 5. 제안하는 Kernel Contract 개정 (감사 후)

- §신규 ConnectorProfile 계약(authState·readiness·auth≠approval).
- §1.5 InboundEventGate에 normalizeInboundEvent(단일 정규화) 연결 명시.
- **감사 통과 후** 봉인 반영(지금 미수정).

## 6. P6 다음

실제 채널 adapter(단일 MessageEvent 파이프라인·registry), 채널별 세션 라우팅(profile_routing),
전송 시 customer-vault unmask, Connection Center 실화면. 이 계약이 그 경계.
