# P-RT-3 · OpenAI OAuth — 사전 조사 결과 (구현 전 오너 결정 필요)

날짜: 2026-07-26 · 상태: **조사 완료, 구현 보류(리스크 결정 대기)**

## 실측·조사로 확인된 사실

1. **공식 경로 없음**: 2026-07 현재, 사용자의 ChatGPT 구독으로 서드파티 앱이 모델을 쓰게 하는
   공식 OAuth 는 존재하지 않는다. OpenAI 의 "Sign in with ChatGPT"는 **신원 인증(SSO)** 용도로,
   구독 모델 사용량을 앱에 주지 않는다.
2. **비공식 경로는 존재**: Codex CLI 의 PKCE OAuth 를 역공학한 방식 —
   - authorize `https://auth.openai.com/oauth/authorize` · token `https://auth.openai.com/oauth/token`
   - client_id `app_EMoamEEZ73f0CkXaXp7hrann`(**Codex CLI 의 공개 client — 우리 것이 아님**)
   - callback `http://localhost:1455/auth/callback`, refresh 동일 endpoint
3. **토큰의 실제 사용처 제약**: 이 OAuth access token 은 표준 플랫폼 API
   (`api.openai.com/v1/chat/completions`)에서 **작동하지 않는다**. `chatgpt.com/backend-api/codex/responses`
   (Codex 전용 백엔드, Responses 셰이프)에서만 동작한다 → P-RT-1 의 `openai_oauth` provider(플랫폼
   와이어 + Bearer seam)는 이 토큰으로는 그대로 착지 불가, 별도 와이어가 필요하다.
4. **리스크**: 비공식 경로는 OpenAI ToS 회색지대다. Anthropic 은 동일 계열 사용을 이미 차단했고,
   OpenAI 도 언제든 차단 가능. 차단·계정 제재 리스크는 **최종 사용자에게 전가**된다.
   자사 제품의 "기본 지원"으로 싣기에는 사업·법무 판단이 선행돼야 한다.

## 선택지 (오너 결정)

- **A. 비공식 경로 구현(옵트인·실험 딱지)**: 실제로 동작(구독 사용량). Codex 백엔드 와이어 추가 +
  PKCE 로그인/refresh/저장. 단 타사 client_id 의존·차단 리스크 상시. 화면에 실험·리스크 고지 필수.
- **B. 기계장치만 일반형으로 준비**: PKCE·토큰 저장·refresh 모듈을 IdP-불문 일반형으로 넣고
  OpenAI 연결은 API 키 경로 유지. 공식 경로가 열리면 즉시 활성화. (미사용 부품을 main 에 두는
  부담 — §7 단순함 원칙과 긴장.)
- **C. 이월(기록만)**: 이 문서로 근거를 봉인하고 P-RT-3 은 공식 경로가 열릴 때 재개.
  당장의 OpenAI 연결은 API 키(§6.22)로 충분히 동작 중.
- **D. (별도 트랙) beai 자체 OAuth**: chat.beai.kr 은 자사 서비스 — 자사 IdP 로그인은 ToS 리스크 0.
  단 백엔드(OAuth 서버) 작업이 선행돼야 하므로 T5 단독으로 못 닫는다.

## 권고

**C(이월) + 필요 시 D 를 백엔드 로드맵에**. A 는 "타사 비공식 백엔드+타사 client_id 위에 자사
제품 기본 기능을 세우는" 구조라 — 배포 치환·낡음보다 더 통제 불가능한 외부 리스크다.
오너가 A 를 원하면 옵트인·실험 표기 조건으로 구현한다(기술적으로는 가능).

근거 출처: openai/codex 이슈·Codex 인증 문서·역공학 정리(gist)·2026 OAuth 동향 글 —
세부 링크는 세션 기록(2026-07-26) 참조.
