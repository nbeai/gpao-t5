# P6-16 · ChannelRegistry / Gateway 운영 골격 (첫 슬라이스)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기.
근거: OpenClaw gateway/channel 운영 구조 흡수(복제 아님, T5 재구성), 헌법 §3(auth≠approval),
Kernel Contract §1.5(InboundEventGate)·§6.7(ConnectorProfile). 관련: [[gpao-t5-hermes-absorption-roadmap]].

## 왜 (정리 작업이지 새 기능 폭발 아님)

지금 T5엔 웹·채널·자동화·승인·전달·도구함이 꽤 붙었다. 여기서 채널/커넥터를 **기능마다 따로** 다루기
시작하면 T3처럼 금방 엉킨다(누더기). ChannelRegistry는 그 전에 **연결 상태·자격·승인·진단·사용자 안내를 한
곳으로 묶는** 정리다. 이 슬라이스는 **이미 만든 것을 덜 헤매게** 하는 데까지 — 실제 외부 전송·설정 변경은 없다.

## 재사용 (신규 발명 아님)

- `connector-profile.js`: 자격(authState)·`connectorReadiness`·`sendNeedsApproval`(auth ≠ approval) — **단일 진실**.
- `inbound-gate.js`: mention/allowlist/DM **결정적 게이팅**. 정책은 레지스트리가 선언하고, 게이팅 자체는 게이트가
  수행한다(중복 아님). `/channel/inbound`의 게이트 순서(1~8)·gated/blocked 미기록은 이미 구현·테스트됨(server.test).
- `liveDeps`(2.0-A): 토큰 유무 → 도구 사용 가능 단일 진실. 레지스트리는 이 상태를 **참조**해 표면화만.

## 계약 (`l2-plan/channel-registry.js`)

순수·선언형(무 I/O)이라 connector-profile 옆(kernel/l2-plan)에 둔다. runtime은 I/O 어댑터 전용이라 여기 아님.
- `defineChannel({id, label?, connector, inboundPolicy?, outboundTool?})` — 커넥터(자격) + inbound 정책 +
  outbound 도구 **바인딩** + 라벨을 한 서술자로. outboundTool은 바인딩만(이 슬라이스는 실제 전송 안 함).
- `INBOUND_POLICIES = ['mention_required','dm_open','allowlist_only']`(선언값).
- `channelStatus(channel)` → `{id, label, status, ready, userSafe, inboundPolicy, outboundTool,
  sendNeedsApproval, diagnosis}`. **ready(초록)는 readiness==ok일 때만** — 미연결·미자격은 절대 초록 아님.
  `userSafe`·`diagnosis`는 **사용자 언어**(내부 readiness 코드 미노출). doctor `diagnosis.nextAction`:
  connect/authenticate/retry/null.
- `projectChannels(channels)` — 레지스트리 전체를 사용자 안전 뷰로.
- `sendNeedsApproval=true` 항상: **connected ≠ approved**(전송은 어느 상태든 A2).

## 배선

- **라이브 표면은 실제 자격에서 파생**(감사 blocker 보정): `liveDeps(processEnv)`가 `channels`도 반환한다 —
  `liveChannels`가 `TELEGRAM_BOT_TOKEN`/`SLACK_BOT_TOKEN` 유무로 `connected`를 정한다. 토큰 없으면 채널은
  `ready:false`(연결 안내). standalone server는 `makeServer({env, tools, channels})`로 이 라이브 채널을 넘긴다.
  **"보이는 것 = 실제 가능한 것"** — 2.0-A slack 초록 오표시와 같은 계열을 채널에서도 막는다.
- `demoChannels()`는 **demo/test 전용 fixture**(telegram connected:true 고정) — 라이브 표면에 쓰지 않는다.
  server 기본 fallback은 테스트 편의용이며, 라이브는 항상 liveChannels를 주입받는다.
- `GET /channels` — 사용자 안전 뷰 + doctor. 기존 `/connectors`(원시 두 축)는 내부/디버그 뷰로 유지.
- UI 콘솔화(연결 페이지에 이 상태 표시)는 **P6-18**로 분리(안티 대시보드 원칙 함께).

## 테스트 (10, 총 249)

미연결→초록 아님+연결 안내 · 미자격→needs_auth+로그인 안내 · 연결·자격 갖춤만 ready · **connected ≠ approved
(ready여도 전송 A2)** · userSafe·doctor에 내부 코드 미노출 · inbound 정책/outbound 바인딩 선언 · `GET /channels`
사용자 언어(원시 readiness 코드 미노출·전송 모두 승인). 인바운드 게이팅·gated 미기록은 server.test에서 이미 커버.
**라이브 자격(blocker)**: `liveDeps({}).channels`는 telegram/slack.channel 모두 ready 아님 · `liveChannels`는
실제 토큰(TELEGRAM_BOT_TOKEN/SLACK_BOT_TOKEN)이 있을 때만 ready · 라이브 자격 주입 서버의 `/channels`는 토큰 없이
telegram을 "받을 준비됨"으로 말하지 않음.

반대 테스트: (a) `ready` 무조건 true 주입 시 미연결/미자격/endpoint 3건 실패. (b) `liveChannels`가 토큰을 무시하고
connected:true면(fixture-style) 라이브 자격 테스트 3건 실패 실측 → 자격 파생이 load-bearing. 라이브 standalone:
토큰 없음→telegram·slack.channel 둘 다 ready:false(연결 안내), TELEGRAM_BOT_TOKEN 주면 telegram ready:true.

## 완료/미완료 (사용자 언어)

- **된 것**: 채널을 한 곳(레지스트리)으로 묶어, 각 채널이 "받을 준비됐는지 / 로그인·연결이 필요한지"를
  사용자 말로 보여주고, 무엇을 하면 되는지(doctor)까지 준다. 미연결·미자격은 초록으로 안 보인다. 전송은 어느
  채널이든 보내기 전에 승인을 받는다.
  라이브 표면은 실제 토큰이 있을 때만 "받을 준비됨"으로 보인다 — 토큰 없이 초록으로 속이지 않는다.
- **아직 아닌 것**: 실제 외부 전송·설정 변경, 채널별 inbound 정책의 게이트 반영(지금은 선언값), 연결 페이지 UI
  표시(P6-18), 실 provider 연동·토큰 유효성 실측(지금은 토큰 존재 유무까지). 이 슬라이스는 정리·표면화까지.

## 남은 후속

- inboundPolicy를 inbound-gate가 실제 소비(채널별 mention_required/dm_open 차등) — 게이트 확장 슬라이스.
- ChannelRegistry를 `/channel/inbound` 조회의 단일 소스로 승격(현재 커넥터 조회와 통합).
- P6-18: 연결 페이지에 채널 status·doctor 표면화(조용히·필요할 때만, 안티 대시보드).
- 실 provider/토큰 회전·doctor 실측(연결 생존성 ping).
