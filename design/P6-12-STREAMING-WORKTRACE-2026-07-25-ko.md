# P6-12 · Streaming & Work Trace Surface

작성: 2026-07-25 · 상태: 설계 + P6-12-1 구현 중 · 정본: Codex 제안(오너 승인), 헌법 최상위 원칙.

## 목표

1. **응답 스트리밍 안정성** — 끊김·멈춤·재접속·느린 클라이언트·timeout을 견디는 대화 출력.
2. **사용자용 작업 흐름 표시** — 모델 내부 사고 원문이 아니라, 안심하고 따라갈 진행 상태.

## 절대 원칙 (안전 척추)

- **모델의 숨은 사고 원문을 노출하지 않는다.** 사용자에게 보이는 건 작업/근거/도구/복구 **상태**뿐.
- **스트림은 durable truth 위의 투영이다.** 진실의 출처는 `EventLog / ToolReceipt / TruthLedger`.
  스트림이 끊겨도 진실은 남고, 재접속·새로고침으로 **마지막 이벤트부터 복구**한다.
- **"생각 중…" 무한 대기 금지.** 모든 turn은 명시 종료(complete / blocked / recoverable_error)로 닫힌다.
- 스트리밍은 화면 효과가 아니라 **체감 성능·신뢰성 계약**이다.
- 모델 토큰 스트림과 도구 이벤트 스트림을 섞지 않는다.

## 이벤트 계약

각 이벤트: `{ turnId, eventId(단조 증가), type, createdAt, payload, durable }`.
`durable=true`는 EventLog에 남아 `lastEventId` 재접속으로 복구된다(trace/tool/evidence/approval/capability/
blocked/recoverable_error/partial/complete). `durable=false`는 연결 생존용(heartbeat)·중간 조각(answer_delta)이라
지속하지 않는다(끊기면 durable 상태에서 재구성).

| type | durable | 의미(사용자 언어) |
| --- | --- | --- |
| trace_status | ✓ | 요청을 이해했어요 / 확인 중 / 정리 중 / 작성 중 |
| tool_progress | ✓ | 도구 실행 진행 |
| evidence_added | ✓ | 출처/근거 추가 |
| approval_required | ✓ | 승인 필요 |
| capability_needed | ✓ | 연결/설정/도구 준비 필요 |
| blocked | ✓ | 막힘/차단 |
| recoverable_error | ✓ | 복구 가능한 오류(+다음 안전 행동) |
| partial_result | ✓ | 일부 결과 |
| answer_delta | ✗ | 최종 답변 본문 조각 |
| complete | ✓ | 완료(turn 종료) |
| heartbeat | ✗ | 연결 생존 신호 |

## UI 규칙

기본은 여전히 자연 채팅. 작업 흐름은 작고 조용하게, 필요할 때만. "요청을 이해했어요 / 웹에서 확인 중이에요 /
근거를 정리하고 있어요 / 답변을 작성하고 있어요" 수준의 사용자 언어. 도구 기록·근거는 접힌 형태. 오류는
"무엇이 안전한지 / 다음에 무엇을 하면 되는지"로 닫는다.

## 런타임 규칙

- **사용자 원문은 URL에 싣지 않는다(프라이버시).** `POST /turn/stream-start`(본문 text)로 `streamId`를 받고,
  `EventSource /turn/stream?sessionId&streamId`로 구독한다(일회성·30초 만료). URL엔 sessionId·streamId·
  lastEventId만 — 히스토리·프록시·서버 로그·crash report에 발화가 남지 않게.
- `heartbeat`(비지속)로 연결 생존을 알린다: SSE 개시 즉시 1회 + 이후 주기적(unref). 무한 대기 방지.
- 클라이언트는 `lastEventId`로 재접속 → EventLog에서 그 뒤부터 재생.
- 느린 클라이언트가 전체 turn을 막지 않게 **backpressure 한계**(버퍼 상한 + 초과 시 비-durable 드롭을 로그로,
  절대 조용히 버리지 않음).
- timeout / cancel / partial_result가 명시 상태로 EventLog에 남는다.
- 백그라운드 세션(자동화 tick 등)이 현재 대화 lane을 점유하지 못한다(세션 격리 유지).

## 슬라이스 분할

- **P6-12-1 (안전 척추, 이 슬라이스):** 이벤트 계약 + durable `EventLog`(turn별) + SSE 전송 + `lastEventId`
  재접속·복구 + trace_status/tool_progress/approval_required/capability_needed/complete/heartbeat.
  answer_delta는 스텁 청크. 목표: 끊겨도 진실 남고 재접속되고 무한 대기 없음.
- **P6-12-2 (후속):** 진짜 LLM 토큰 스트리밍 + backpressure 세밀화 + 느린 클라/느린 모델 + T3 lane 점유 회귀.

## 필수 테스트 (P6-12-1)

이벤트 계약(단조 eventId·durable 분리) · EventLog 지속·재생 · `lastEventId` 재접속(그 뒤부터) ·
complete 없이 끊긴 turn의 복구 표시 · approval 대기 중 스트림 정지(무한 대기 금지) · 여러 세션 동시(격리) ·
백그라운드 자동화 tick과 현재 대화 동시(현재 대화 안 멈춤 — T3 회귀).

## T3 회귀 앵커

gateway/event loop/lane 점유로 현재 대화가 멈추지 않는지를 회귀로 못 박는다. 진실은 항상 원장에 남으므로
스트림 장애가 데이터 손실로 이어지지 않는다.
