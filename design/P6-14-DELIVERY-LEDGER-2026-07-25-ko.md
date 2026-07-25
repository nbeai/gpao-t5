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
- **외부 전송은 A2 유지** (주석이 아니라 계약): 재전달은 원 승인 범위의 완결이지 새 외부 행동이 아니다.
  재전달이 허용되는 조건은 **정확히 다음 넷이 모두 성립할 때만**이다 —
  **same session + same approved artifact + same target + explicit user retry action.**
  이 넷 중 하나라도 어긋나면(다른 세션, 산출물·대상 변경, 사용자 명시 재전달 아님) 재전달하지 않는다.
  이 경계를 우회해 임의 대상·임의 내용을 보내는 것은 A2를 건너뛴 새 외부 행동이므로 금지.
- **전달 원장은 세션 소유**(전역 아님): `DeliveryRecord.sessionId`가 소유 세션. 조회·재전달은 그 세션에서만.
  다른 세션의 조회·재전달, sessionId 없는 재전달은 **거부하고 tool call 0**(외부 전송 미발생).
- 실패는 정직하게 원장에 남긴다(중복 전송 방지 — delivered는 다시 안 보냄).

## 계약 (`l5-growth/delivery.js`)

`DeliveryRecord {id, sessionId, tool, channel, target, artifact, state('attempting'|'delivered'|'failed'),
attempts, lastError, retriable, needsFix, createdAt}`. `sessionId`는 승인·생성한 소유 세션(권한 경계).
- `makeDelivery` — 산출물·소유 세션(sessionId)과 함께 attempting으로 시작.
- `applyDeliveryResult(d, failureState, summary)` — none→delivered / failed·timeout→failed(retriable) /
  blocked·cancelled→failed(needsFix, 원인 해소 후 재전달). **산출물은 항상 보존.**
- `isDelivered`(완료 판정) · `isRetriable`(재전달 가능).

## 배선

- 턴: send 실행 시 `sentVia`에 대상·산출물(text)·전달 결과(failureState)를 실어 보낸다(생성≠전달 분리).
- 서버 `runAndPersistTurn`: `sentVia`→DeliveryRecord 기록(생성과 전달 분리). 실패면 `result.deliveryFailed`로
  채팅에 "결과는 만들었는데 전달이 막혔어요 / 다시 보낼까요?" 표면화(작업 복귀 경로→historical). **DefaultTarget
  학습 후보는 실제 전달된 경우에만 제안**(실패한 전송을 기본으로 잘못 학습하지 않게).
- `GET /deliveries?sessionId=` — **세션별 조회만**(sessionId 없으면 400). 다른 세션의 전달은 안 보인다.
- `POST /deliveries/:id/retry {sessionId}` — 소유 세션 검증을 **tools.run 전에** 통과시킨다:
  sessionId 없음→400, 다른 세션→403, 둘 다 **tool call 0**. 통과 시에만 저장된 산출물 그대로 재전달
  (delivered면 재전송 안 함). 프론트 재전달 버튼은 현재 세션 id를 함께 보낸다.

## 테스트 (9, 총 224)

계약(attempting→delivered/failed·needsFix, 산출물 보존) · 전달 실패→원장+deliveryFailed(완료 아님) ·
재전달(같은 산출물, 재생성 없음)→delivered · 성공은 deliveryFailed 없음 · 이미 전달됨 재전달은 중복 전송 안 함.
세션 경계 4건: (1) S1 실패 delivery가 S2 조회에 안 보임 · (2) S2가 S1 id로 retry→403·tool call 0 ·
(3) sessionId 없이 retry→400·tool call 0 · (4) 올바른 S1 retry만 저장된 산출물로 delivered.

반대 테스트: delivered 가드 제거 시 이미 전달된 것도 재전송 → 중복 전송 방지 테스트 실패.
세션 경계 반대 테스트: 세션 필터·소유권 게이트 제거(pre-fix 서버)로 돌리면 경계1/2/3이 실패(tool 발동·타 세션 노출)함을 실측 확인.

## 라이브 검증

실패 기록 → `GET /deliveries`(failed, retriable) → `POST retry`(저장된 산출물 재전달)→ delivered
("다시 보냈어요", attempts 2) → 이미 전달됨 재요청은 `alreadyDelivered`(중복 전송 없음).

## 남은 후속

- 채널 외 전달 확장: 파일/다운로드 링크/웹 게시의 전달 확인(생성됐는데 링크 누락 등).
- 재전달의 A2 재확인 정책(원 승인 만료 시 재승인) · needsFix(연결/권한) 자동 안내→연결 흐름 연결(2.0-B).
- Completion Contract(P6-13)와 연결: 완료 게이트에 "전달 확인"을 포함. VerificationReceipt+DeliveryRecord를
  TruthLedger에 함께 durable.
