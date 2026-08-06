# P-RT-2 · Provider Doctor (구성됨 → 검증됨)

날짜: 2026-07-26 · 브랜치: `p-rt-2-provider-doctor`
번호 조정: 기존 "P-RT-2 OpenAI OAuth"는 **P-RT-3**으로 이월(윤 판정: doctor 우선 — "키가 구성됐다"
다음은 "진짜 지금 쓸 수 있다"를 사용자가 덜 헤매게 확인하는 단계).

## 배경 (P-RT-1 감사에서 남긴 간극)

- `authSignal:'ok'`는 자격 **구성됨**의 표시일 뿐, 실시간 유효성 검증이 아니다(§6.22 경계).
- 키 만료·오타·모델 낡음(gemini-2.5-flash 404 실측)은 첫 턴 실패로야 드러난다 — 사용자가 헤맨다.
- /channels 에 이미 doctor 패턴(사용자 언어 진단 + 다음 안전 행동)이 있다. 모델에 같은 계열을 적용한다.

## 범위

**비용 0의 실 검증**: provider마다 이미 있는 **모델 목록 endpoint**(과금 없는 GET)를 두드려
①키 유효성 ②도달성 ③설정된 모델의 실제 사용 가능 여부를 한 번에 검증한다.
(P-RT-1에서 gemini 낡음을 잡은 방법 그대로를 제품 기능으로.)

- `model-provider.js` 스펙에 선언 추가: `modelsEndpoint(cfg)` + `listModels(json)` —
  openai 계열 `GET {base}/models`, anthropic `GET /v1/models`, gemini `GET /v1beta/models`.
- `model-doctor.js` — `checkModelHealth(env, {fetchImpl})` → 사용자 언어 리포트:

| state | 뜻 | 사용자 언어(요지) |
|---|---|---|
| `stub` | 키 미구성(내장 안내 모드) | "아직 실제 모델이 연결되지 않았어요" + 키 연결 안내 |
| `usable` | 검증됨 — 지금 쓸 수 있음 | "지금 바로 쓸 수 있어요" |
| `model_missing` | 키는 유효한데 설정 모델을 못 씀(낡음·오타) | "설정된 모델을 지금 쓸 수 없어요" + 사용 가능 예시 |
| `auth_failed` / `billing_blocked` / `rate_limited` | classifyModelAuth 단일 소스 분류 | 기존 자격 문구 계열 |
| `unreachable` | 네트워크/서비스 불가 | "연결이 안 돼요, 잠시 후 다시" |
| `unverified` | doctor 미배선 구성(demo 등) | 검증 안 됨을 검증됨처럼 말하지 않는다 |

- **단일 진실 승격 — 두 축(감사 B1 보정)**: 자격 실패는 `env.model.authSignal`로, **모델 readiness
  (model_missing/unreachable/usable)는 별도 축 `env.model.healthState`로** 반영한다(auth 오염 없이).
  `buildSelfState → selfStateSummary.modelHealthState`까지 관통해 칩이 "준비됨" 대신
  **"모델 확인 필요"**를 표시 — "모델 이름이 틀렸는데 화면은 준비됨" 금지(보이는 것=되는 것).
  새 대시보드 없음(§5.5) — 표면은 기존 칩 재사용.
- 서버: `GET /model/health`(요청 시 재검증) + **부팅 시 1회 비차단 점검**(실패해도 부팅 계속).

## 경계

- 목록 조회만(GET) — 외부 효과 0, 토큰 과금 0. 자격은 여전히 어댑터/doctor가 소유하지 않는다.
- model_missing 은 자격 문제가 아니므로 authSignal 을 오염시키지 않는다 — 단 **별도 healthState 축으로
  SelfState·칩에 반영**한다(감사 B1: "리포트로만"은 화면 준비됨 오표시를 남겼다).
- **공개 리포트 위생(감사 B2)**: provider 원문 오류(`authSignal`)는 내부 진단값 — env 갱신에만 쓰고
  `/model/health` 공개 응답에서는 제거한다(키 조각·내부 문구 유출 방지, diagnostic/사용자면 분리).
- 검증 실패가 부팅·턴을 막지 않는다 — 정직한 표시가 목적, 게이트 추가가 아니다.
- 목록 endpoint 가 없는 호환 서버(200 아닌 목록 미구현)는 "키는 통과, 모델 목록 확인 불가"로 정직하게.

## 검증

- 단위: 스펙별 목록 와이어 · state 분기(stub/usable/model_missing/auth/billing/rate/unreachable) ·
  **doctor→env.model→buildSelfState 반영**(구성됨→검증됨이 SelfState 단일 진실에 실제로 착지하는지) ·
  /model/health 라우트 · 미배선 기본값(unverified).
- 라이브: 실 키(beai)로 usable · 가짜 키로 auth_failed · **유효 gemini 키 + 낡은 모델 id로 model_missing**
  (P-RT-1에서 실제로 당한 시나리오 재현).

## 후속

- P-RT-3 OpenAI OAuth 플로우(이월) · 키 입력·보관 UX · overview(§6.19)에 모델 상태 칩 통합 검토 ·
  주기 재검증(TTL) 여부 — 지금은 부팅 1회 + 요청 시.
