# P6-6 · Real Channel / Messenger Sender (첫 슬라이스)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기

ConnectorProfile(§6.7)은 **선언형**(auth≠approval, 자격·클라이언트 구성 미소유)까지 있었다. 빠진 것은 그
계약을 실제로 실행하는 **전송 어댑터**. P6-5(웹)와 같은 패턴으로 얹는다.

## 핵심 안전 경계 (깊은 감사)

- **A2 우회 없음**: 전송은 항상 승인 뒤에만. 어댑터는 게이트를 우회하지 않는다 — ActionPlan이 승인시킨 뒤
  executePlan이 부르는 "실행자"일 뿐. intent가 슬랙/텔레그램/보내를 A2_SIGNALS로 잡아 승인 게이트로 보낸다.
- **자격은 어댑터가 소유하지 않음**: 토큰은 사용자가 config/env로 넣는다. 없으면 정직하게 `needs_auth`
  (몰래 안 보냄, 가짜 성공 없음).
- **정직한 실패 분류**: `auth_failed`(재시도로 안 풀림→blocked→permanent) vs `rate_limited`/`timeout`
  (transient→failed→P6-4 백오프). 보냈으면 `sent`, 못 보냈으면 보낸 척 안 한다.
- **테스트·기본은 실 API를 안 침**: fetchImpl 주입. 라이브 서버만 실제 어댑터 배선.

## 어댑터 (`src/runtime/channel-sender.js`)

`makeChannelSender({channel, token, defaultTarget, fetchImpl, timeoutMs})` — 채널별 엔드포인트·요청·응답 해석:
- telegram: `api.telegram.org/bot<token>/sendMessage`, `{chat_id, text}`, `ok:true`→sent.
- slack: `slack.com/api/chat.postMessage`, `Bearer <token>`, `{channel, text}`, `ok:true`→sent, `error`로 분류.
- 시간 제한(P6-5 공유 `withTimeout`) + AbortController — 끝나지 않는 전송이 Work Chat을 멈추지 못하게.

## ToolRunner 확장 (general)

핸들러가 `{failed:true, userSafeSummary, nextSafeAction}`를 돌리면 **FAILED**(transient) receipt로 매핑한다.
기존 `{blocked}`(permanent)와 분리 — 레이트리밋 같은 일시 실패를 정직한 메시지와 함께 남기고, 자동화에선
P6-4 백오프 대상이 된다. 모든 도구에 적용되는 일반 개선.

## 배선

- 라이브 서버: `slack.post` → 실제 slack 어댑터(`SLACK_BOT_TOKEN`/`SLACK_DEFAULT_CHANNEL` env). 토큰 없으면
  어댑터가 `needs_auth`(가짜 성공 아님). 기본 `demoTools()`는 offline 스텁 유지(테스트 결정성).
- `withTimeout`을 `runtime/with-timeout.js`로 추출(web-collector와 공유, DRY).

## 테스트 (9)

슬랙/텔레그램 sent · 자격없음 needs_auth(fetch 안 함) · 대상없음 blocked · invalid_auth→blocked(permanent) ·
429→failed(transient, classifyRetry 확인) · timeout · ToolRunner 통합(delivered/blocked/failed) ·
**A2 경계**(슬랙 전송 요청 → approval, 승인 전 실제 전송 0).

반대 테스트: (1) needs_auth 가드 제거 → 토큰 없이 전송 시도(테스트 실패). (2) ToolRunner failed 분기 제거 →
rate_limited가 none으로(테스트 실패). 둘 다 복원 시 통과.

## 라이브 검증

토큰 없이: `/turn "슬랙에 …올려줘"` → **approval**(pending "슬랙 게시", 전송 0) → 승인 → 실제 sender →
`needs_auth` 정직("채널 자격이 아직 없어요"). A2 경계 + 몰래 안 보냄 + 가짜 성공 없음 실증.
성공 전송 경로는 주입 fetch 단위 테스트로 검증(실 Slack/Telegram·실 토큰은 사용자 소유·승인).

## 남은 후속

- 텔레그램을 NL 도구로 라이브 배선(descriptor+intent route) — 어댑터·테스트는 이미 지원.
- 대상(채널/채팅) NL 파싱·기본 대상 관리, 첨부·서식.
- OAuth 실제 토큰 회전·연결 UX(§6.7 requiresAuth 후속). 전송 결과의 채널 원장(§7).
