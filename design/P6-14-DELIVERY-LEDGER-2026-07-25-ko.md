# P6-14 · Delivery Ledger (첫 슬라이스)

작성: 2026-07-25 · 상태: 구현·라이브 검증 완료, 깊은 감사 대기(외부 전송·복구·완료 의미).
근거: Hermes "Delivery Application Ledger"(복제 아님, T5 재구성), P6-12 EventLog, P6-13 VerificationReceipt,
§7 ToolReceipt.lifecycle, P6-6 ChannelSender. 헌법·CLAUDE.md "완료 = 실제 동작".

## 왜

P6-12가 작업흐름·durable EventLog를, P6-13이 완료 기준·VerificationReceipt를 깔았다. 웹/채널/자동화도 있다.
이제 남는 큰 사고는 **"결과는 만들었는데 전달이 안 됨 / 사용자는 못 받음 / 다시 시켜야 함"** — T3의 "했다는데
사용자가 못 받음"이다. **결과 생성과 결과 전달을 분리**하고, 실패해도 처음부터 다시가 아니라 **기존 산출물을
이어서 재전달**한다.

## 절대 원칙

- **완료는 실제 전달 확인(delivered) 이후에만.** "생성했다"·"보내려 했다"는 완료가 아니다.
- **재전달은 기존 산출물(artifact)로만 — 재생성하지 않는다.** 이미 만든 걸 다시 만들지 않는다.
- **외부 전송은 A2 유지**: 재전달은 원 승인 범위의 완결이지 새 외부 행동이 아니다(이미 승인된 산출물·대상).
- 실패는 정직하게 원장에 남긴다(중복 전송 방지 — delivered는 다시 안 보냄).

## 계약 (`l5-growth/delivery.js`)

`DeliveryRecord {id, tool, channel, target, artifact, state('attempting'|'delivered'|'failed'), attempts,
lastError, retriable, needsFix, createdAt}`.
- `makeDelivery` — 산출물과 함께 attempting으로 시작.
- `applyDeliveryResult(d, failureState, summary)` — none→delivered / failed·timeout→failed(retriable) /
  blocked·cancelled→failed(needsFix, 원인 해소 후 재전달). **산출물은 항상 보존.**
- `isDelivered`(완료 판정) · `isRetriable`(재전달 가능).

## 배선

- 턴: send 실행 시 `sentVia`에 대상·산출물(text)·전달 결과(failureState)를 실어 보낸다(생성≠전달 분리).
- 서버 `runAndPersistTurn`: `sentVia`→DeliveryRecord 기록(생성과 전달 분리). 실패면 `result.deliveryFailed`로
  채팅에 "결과는 만들었는데 전달이 막혔어요 / 다시 보낼까요?" 표면화(작업 복귀 경로→historical). **DefaultTarget
  학습 후보는 실제 전달된 경우에만 제안**(실패한 전송을 기본으로 잘못 학습하지 않게).
- `GET /deliveries` · `POST /deliveries/:id/retry`(저장된 산출물 그대로 재전달, delivered면 재전송 안 함).

## 테스트 (5, 총 217)

계약(attempting→delivered/failed·needsFix, 산출물 보존) · 전달 실패→원장+deliveryFailed(완료 아님) ·
재전달(같은 산출물, 재생성 없음)→delivered · 성공은 deliveryFailed 없음 · 이미 전달됨 재전달은 중복 전송 안 함.

반대 테스트: delivered 가드 제거 시 이미 전달된 것도 재전송 → 중복 전송 방지 테스트 실패.

## 라이브 검증

실패 기록 → `GET /deliveries`(failed, retriable) → `POST retry`(저장된 산출물 재전달)→ delivered
("다시 보냈어요", attempts 2) → 이미 전달됨 재요청은 `alreadyDelivered`(중복 전송 없음).

## 남은 후속

- 채널 외 전달 확장: 파일/다운로드 링크/웹 게시의 전달 확인(생성됐는데 링크 누락 등).
- 재전달의 A2 재확인 정책(원 승인 만료 시 재승인) · needsFix(연결/권한) 자동 안내→연결 흐름 연결(2.0-B).
- Completion Contract(P6-13)와 연결: 완료 게이트에 "전달 확인"을 포함. VerificationReceipt+DeliveryRecord를
  TruthLedger에 함께 durable.
