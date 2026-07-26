# P-RT-4 · Model Connect UX (화면에서 키 연결 — 검증 통과만 저장·활성화)

날짜: 2026-07-26 · 브랜치: `p-rt-4-model-connect-ux`
번호: P-RT-3(OpenAI OAuth)은 라벨 유지·후속. 이 슬라이스가 만드는 연결 표면 위에 OAuth가 앉는다.

## 배경

- 모델 연결의 유일한 입구가 env 변수 — 개발자만 연결 가능("개발자-떠넘김 금지" 위반 잔여 구간).
- P-RT-2 doctor 가 이미 "즉시 실검증"을 갖고 있다 — 키 입력과 붙이면 연결 UX 가 완성된다.
- 연결 전략(관리형→세션 대행→가이드) 의 "가이드+즉시 검증" 계층에 해당.

## 범위

**흐름**: 사용자가 칩 패널에서 제공자·키(·모델) 입력 → `POST /model/connect` →
doctor 실검증(과금 0 목록 GET) → **usable 만 저장·활성화**(검증 실패 키는 저장하지 않는다) →
그 턴부터 실제 모델로 동작. 재시작해도 저장된 연결 유지.

- `model-connection.js`(surface): 연결 관리자 —
  - 활성 우선순위: **저장된 사용자 연결 > env(개발자) > stub**. 화면에서 넣은 최신 의사가 이긴다.
  - `model`: respond 를 현재 client 로 위임(핫스왑 — 재시작 없이 연결 교체).
  - `connect(input)`: `resolveModelConfigFromInput` → `checkConfigHealth` → usable 이면
    저장(`model-connection.json`, **0600**)+활성화+env.model 동기화. 아니면 리포트만(미저장·기존 유지).
  - `disconnect()`: 저장 제거 → env 구성 또는 stub 으로 복귀.
  - `doctor()`: 활성 구성 재검증(P-RT-2 의 env 반영·공개면 위생 로직 이관 — 두 축·authSignal 미노출 유지).
  - `status()`: 마스킹된 키(`beai…2790`)만 — **원본 키는 어떤 GET 에도 안 나간다.**
- `model-provider.js`: `resolveModelConfigFromInput`(provider allowlist·기본값 적용) 추가.
- `model-doctor.js`: `checkConfigHealth(cfg)` 분리(checkModelHealth 는 env 래퍼로 유지).
- 서버: `POST /model/connect` · `POST /model/disconnect` · `GET /model/connection`(마스킹 status).
  기존 `GET /model/health` 는 활성 구성 기준으로 동작(관리자 doctor 로 위임).
- UI(칩 패널): "모델 연결" 블록 — 현재 상태(모델·마스킹 키·출처) + 제공자 선택/키/모델(선택) 입력 +
  연결/해제 버튼 + doctor 결과 사용자 언어 표시. 안티 대시보드: 칩 열 때만.

## 경계

- **검증 통과만 저장**: auth_failed/model_missing 키는 저장·활성화하지 않는다(리포트로 안내만).
- 키는 저장 파일(0600)과 요청 본문에만 존재 — 로그·GET 응답·오류 메시지에 노출 금지(마스킹만).
- P-RT-2 계약 유지: 두 축(auth/health)·공개면 authSignal 미노출·stub 정직 폴백.
- env 로만 쓰던 기존 개발자 흐름은 그대로 동작(저장 연결이 없을 때의 폴백).
- 아키텍처 조정: liveDeps 의 model 이 관리자 위임 객체가 된다(핫스왑 필요) — 기존 테스트 1건의
  instanceof 단언을 동작 단언으로 조정(사유 명시).

## 검증

- 단위: 입력 해석(allowlist·기본값) · connect 성공(저장+활성+env 동기화+이후 respond 가 새 키 사용) ·
  실패 키 미저장·기존 유지 · disconnect 복귀 · status 마스킹 · **원본 키가 connect/health/connection
  어떤 응답에도 없음**(sk-secret 심기) · 재로드 지속(store 재사용) · 우선순위(저장>env).
- 라이브: env 없이 부팅 → 화면/HTTP 로 beai 실키 연결 → 실응답 → 재시작 → 연결 유지 →
  가짜 키 연결 시도 → 거부·기존 유지 → 해제 → stub 복귀. 브라우저 실확인 포함.

## 후속

- P-RT-3 OpenAI OAuth(이 연결 표면 위에) · keychain 등 OS 보안 저장소 검토(지금은 0600 파일) ·
  다중 연결 보관·전환 · overview 통합.
