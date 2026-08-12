# P-RT-1 · Model Provider Adapter (실 런타임 착지 Slice-1)

날짜: 2026-07-26 · 브랜치: `p-rt-1-model-provider`

## 오너 지시 (2026-07-26, 정본)

> T5가 모델 연결에 있어 ①OpenAI OAuth 연결 방식 ②OpenAI·Claude·Gemini API 키 연결 방식을
> 모두 기본 지원하고, ③다른 오픈소스나 모델들과의 API 연결·구동 호환성도 준비되기를 바란다.

## 배경 (실측)

- `StubModelClient`([model-client.js](../src/runtime/model-client.js))가 유일한 두뇌 — canned 응답, 실 LLM 0줄.
- seam은 준비돼 있음: `server.js` `deps.model` DI + `ModelClient.respond(tc)` 단일 인터페이스.
- 자격 분류는 kernel `classifyModelAuth`(SelfState)가 단일 소스 — billing≠rate_limit 분리(T3 재발 방지).
- channel-sender(P6-6)가 실 HTTP 어댑터의 정본 패턴: 선언형 와이어 스펙 + fetchImpl 주입 + 정직한 실패 분류.

## 범위 (이 슬라이스)

`src/runtime/model-provider.js` — 선언형 provider 어댑터. **와이어는 여기, 정책(분류·승인·타임아웃 사용자 언어)은 커널.**

| provider | 와이어 | 자격 | 기본 모델 |
|---|---|---|---|
| `anthropic` | `POST /v1/messages` (x-api-key + anthropic-version) | `ANTHROPIC_API_KEY` | `claude-opus-4-8` |
| `openai` | `POST /v1/chat/completions` (Bearer) | `OPENAI_API_KEY` | `gpt-5.1` |
| `openai_oauth` | 위와 동일 와이어, 토큰만 OAuth access token | `OPENAI_OAUTH_ACCESS_TOKEN` | `gpt-5.1` |
| `gemini` | `POST /v1beta/models/{id}:generateContent` (x-goog-api-key) | `GEMINI_API_KEY` | `gemini-flash-latest`(안정 별칭 — 버전 고정은 "신규 미제공" 404로 낡음, 라이브 실측) |
| `openai_compatible` | OpenAI 와이어 + `GPAO_T5_MODEL_BASE_URL` (예: Ollama `http://localhost:11434/v1`) | 토큰 선택(로컬 서버는 무자격 허용) | 없음 — `GPAO_T5_MODEL_ID` 필수 |
| `beai` | 자사 V1 `chat.beai.kr/api/external/v1` — OpenAI 와이어, 단 **user/assistant만 허용**(실측) → system 사실을 user 턴에 합침(`noSystemRole`) | `BEAI_API_KEY` | `beai-8.6` |

`noSystemRole`은 beai 전용이 아닌 일반 플래그다 — system role 없는 호환 서버는
`GPAO_T5_MODEL_NO_SYSTEM_ROLE=1`로 같은 경로를 탄다.

- env: `GPAO_T5_MODEL_PROVIDER`(명시) / 미지정 시 자격 유무로 추론(anthropic→openai→gemini→beai→oauth→base_url 순).
  `GPAO_T5_MODEL_ID`·`GPAO_T5_MODEL_BASE_URL`·`GPAO_T5_MODEL_HTTP_TIMEOUT_MS`(기본 25s) 오버라이드.
- 미구성 → `StubModelClient` 폴백 + `env.model.id='beai5-stub'` (보이는 것=실제, 초록 오표시 금지).
- 오류는 정직하게: provider 원문 신호를 `authSignal`로 실어 `ModelProviderError`로 던지고,
  분류는 kernel `classifyModelAuth`가 한다(어댑터에 분류표 중복 금지). Gemini의 `API_KEY_INVALID`처럼
  분류기가 못 읽는 벤더 고유 표기만 어댑터가 정규 토큰으로 보강한다.
- 타임아웃: `withTimeout`+AbortController — 초과 시 **fetch를 실제로 abort**(§6.21 "진짜 취소"의 HTTP 구간 착지).
  어댑터 기본 25s < 서버 `withModelTimeout` 30s → 내부가 먼저 끊어 orphan promise를 줄인다.
  초과는 `ModelTimeoutError`로 던져 기존 사용자 언어 경로("응답이 늦어…")를 그대로 탄다.
- 모델 입력: `buildModelMessages(tc)` — §11 그대로 사실만(currentRequest 원문·admittedContext·evidenceFacts·
  authorityFacts). 장문 지시문 주입 금지, diagnosticTrace 절대 미포함.

## 경계 (불변)

- 자동실행 없음 — 어댑터는 turn이 부르는 실행자일 뿐, 승인·안전 바닥 계약 불변.
- 자격은 어댑터가 소유하지 않는다(env 주입). 없으면 stub 폴백, 몰래 호출하지 않는다.
- 테스트는 실 API를 치지 않는다(fetchImpl 주입). 라이브 실측은 실 키로 별도 수행.
- **구성됨≠검증됨(감사 보정)**: 키가 있으면 `env.model.authSignal='ok'`로 잡히는데 이는 **자격이
  구성됐다**는 뜻이지 실시간 유효성 검증이 아니다. 키 만료·오류는 첫 호출에서 정직하게 잡혀
  classifyModelAuth 로 갈리지만, 그 전까지 화면의 "준비됨"은 낙관적 표시다. 문서·화면 문구에서
  "선택된 모델=실행 모델"까지만 주장하고 "자격 항상 검증됨"을 주장하지 않는다. 상시 검증은
  후속 provider doctor/health-check 에서 닫는다.

## 후속 (이 슬라이스 아님)

- **P-RT-2 OpenAI OAuth 플로우**: 브라우저 로그인/PKCE/refresh/토큰 저장. 이 슬라이스는 토큰 주입 seam까지.
- **provider doctor/health-check**: 자격 상태 상시 검증(구성됨→검증됨 승격) — /channels doctor 와 같은 계열.
- 연결 설정 UX(키 입력 화면·keychain 저장) — 연결 전략(관리형→가이드 폴백)과 함께.
- 스트리밍 응답(현재 단발 respond) · 외부 AbortSignal 관통(§6.21 잔여) · openai/anthropic 실 키 실측.

## 검증

- 단위: provider별 와이어 셰이프·추출·오류 신호→kernel 분류 통합·타임아웃 abort·env 해석·stub 폴백.
- 반대 검증: 401/429/quota 신호가 각각 auth_failed/rate_limited/billing_blocked로 갈리는 것을
  kernel classifyModelAuth로 직접 확인(분류표 어긋나면 실패).
- 라이브(2026-07-26 실측 완료): **gemini**(gemini-flash-latest, fast_chat·complex_work 실응답 2건,
  evidenceFacts 반영 확인) · **beai**(beai-8.6 실응답, noSystemRole 경로) · 가짜 키 401 정직 실패·프로세스
  생존 · stub 폴백 턴. **openai/anthropic 은 와이어 단위테스트만**(실 키 미확보 — 미검증으로 남김).
