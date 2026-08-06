# P-ONB-1 · 다중 모델 연결 + 선택 + 역할별 바인딩

날짜: 2026-07-26 · 브랜치: `p-onb-1-multi-connection`
오너 지시(T5 마무리, 2026-07-26): "여러 개를 연결했을 경우에는 모델을 선택적으로 사용하거나
에이전트별로 다른 모델을 사용하는 것도 가능해야지."

## 배경

현재(§6.24·§6.25)는 **활성 연결이 항상 하나**다 — 새 연결이 오면 이전 것이 사라진다.
오너 요구는 ①여러 개 보관 ②그중 선택 ③역할(에이전트)별로 다른 모델.

## 저장 구조 (v2, v1 자동 이관)

```
{ version: 2,
  connections: [ { id, label, kind:'api_key'|'chatgpt_oauth', provider, modelId, baseUrl?,
                   key?|credential?, addedAt } ],
  activeId: '<id>',
  roleBindings: { '<role>': '<connectionId>' } }
```

- v1(단일 객체)은 로드 시 connections 1건 + activeId 로 **자동 이관**(사용자 재연결 불필요).
- 파일 권한·원자 교체(0600, tmp→chmod→rename)는 §6.24 계약 그대로.
- id 는 `${provider}:${modelId}` 정규화(같은 조합 재연결은 갱신, 중복 누적 방지).

## 역할(role) 축 — 일반형, 사례 전용 금지

T5 에 아직 "에이전트" 개체는 없다. 그러므로 **역할 문자열**을 seam 으로 둔다:

- `resolveModel(role)` → roleBindings[role] → 없으면 activeId → 없으면 stub.
- 지금 실재하는 역할: `'default'`(사용자 대화). 이후 자동화·학습·서브에이전트가 생기면
  그 호출부가 role 만 넘기면 된다 — 커널 변경 없이 확장된다.
- turn 은 `ctx.model` 을 그대로 쓰되, 서버가 세션·요청의 role 로 클라이언트를 고른다.
- **T3 교훈(allowlist 사고)**: 역할 바인딩은 "허용 목록"이 아니라 "선택"이다. 목록에 없다고
  실행을 막지 않는다 — 바인딩이 없으면 조용히 기본 연결로 간다(막다른 답 금지).

## 표면

- `GET /model/connections` — 목록(마스킹만) + activeId + roleBindings
- `POST /model/connections/activate` `{id}` — 기본 연결 전환(핫스왑)
- `POST /model/connections/bind` `{role, id|null}` — 역할 바인딩 설정·해제
- `DELETE /model/connections/{id}` — 개별 해제(활성이면 남은 것 중 하나로 승계)
- 기존 `/model/connect`(추가·검증), `/model/disconnect`(전체 해제), `/model/health` 유지.
- UI: 칩 패널 "모델 연결" 블록에 연결 목록(라디오=기본, 각 항목 해제) + 역할 바인딩은
  기본 접힌 상태(안티 대시보드 §5.5).

## 경계

- 저장 정책은 §6.27(확실한 무효만 거절)을 따른다 — usable 은 검증됨, unreachable/rate_limited 는
  저장하되 verified:false, auth_failed/model_missing/billing_blocked 는 미저장. 여러 개여도 각각 검증한다.
- 원본 키·토큰은 어떤 응답에도 없다(마스킹만) — §6.24·§6.25 계약 승계.
- 활성/바인딩 전환은 실행 중 턴에 영향 없다(다음 턴부터 적용, 핫스왑).
- 연결이 0개가 되면 stub 으로 정직 복귀.

## 검증

- 단위: v1→v2 이관 · 여러 연결 보관·중복 갱신 · activate 전환이 다음 respond 에 반영 ·
  role 바인딩이 우선하고 없으면 기본 · 바인딩된 연결 삭제 시 기본으로 폴백(막다른 답 금지) ·
  목록 응답에 원본 키 없음 · 활성 삭제 시 승계.
- 라이브: beai 실키 + gemini 실키 2개 동시 연결 → 전환 → 각 모델로 실응답 확인.
