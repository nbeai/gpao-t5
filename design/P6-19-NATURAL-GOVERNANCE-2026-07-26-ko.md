# P6-19 · Natural Governance 첫 슬라이스

작성: 2026-07-26 · 상태: 구현·라이브 검증 완료, 봉인 반영.
근거: 윤 지시 — "부자연스러운 거버넌스가 아니라 사용자 입장에서 아주 자연스러운 거버넌스"
관련: P-STAB-1 Model Timeout, P6-12 Streaming, P6-18 Status Overview

## 목표

T5의 거버넌스는 사용자에게 통제 장치처럼 보이면 안 된다. 사용자는 그냥 말하고, T5는 선 넘기 전·실패 후·반영 전 같은
경계에서만 조용히 다음 행동을 보여야 한다.

첫 슬라이스는 P-STAB-1의 모델 타임아웃을 사용자 경험까지 닫는다. 서버가 `recoverable_error + complete`로
바운드해도, Work Chat이 그 이벤트를 trace로만 소비하고 지우면 사용자는 "아무 답 없이 사라졌다"고 느낀다.
자연스러운 거버넌스에서는 회복 가능한 실패가 **같은 턴의 사용자 언어 안내**로 남아야 한다.

## 계약

- `recoverable_error`는 개발자 오류 표시가 아니라 사용자 회복 안내다.
- trace는 진행 상태이고, 회복 안내는 대화 기록에 남는 메시지다.
- 모델 타임아웃·만료·세션 없음 같은 회복 가능 실패는 `text`와 `nextSafeAction`을 사용자 언어로 보여 준다.
- 실패 안내는 실행 성공이나 완료로 보이면 안 된다.
- 내부 오류 원문·스택·provider 진단은 화면에 노출하지 않는다.

## 구현

- `streamTurn()`이 `recoverable_error` 이벤트를 듣고 recovery payload를 보관한다.
- `complete` 시 recovery가 있으면 `submit()`이 assistant 결과를 찾지 않고 `renderRecovery()`를 호출한다.
- `renderRecovery()`는 같은 턴 박스 안에 `GPAO-T5` 메시지로 `text`와 `다음: nextSafeAction`을 보여 준다.
- 정상 complete 경로는 기존처럼 세션 transcript의 assistant 결과를 렌더한다.

## 검증

- 서버 타임아웃 테스트: 멈춘 모델은 `recoverable_error + complete`로 닫힌다.
- 세션 큐 테스트: 멈춘 모델 뒤 같은 세션 다음 턴은 정상 완료한다.
- Work Chat 회귀 테스트: HTML 클라이언트가 `recoverable_error`를 듣고 `renderRecovery()`로 다음 행동을 남긴다.

## 후속

- POST `/turn` 경로의 모델 타임아웃도 500 대신 사용자 언어 recovery JSON으로 표면화.
- 회복 안내를 Status Overview의 "최근 막힘"으로 조용히 요약할지 검토.
- 실 provider AbortSignal 연결로 백그라운드 orphan promise까지 취소.
