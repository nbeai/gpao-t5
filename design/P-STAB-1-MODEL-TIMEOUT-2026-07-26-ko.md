# P-STAB-1 · 장시간 안정성 Slice-1: Model Response Timeout

작성: 2026-07-26 · 상태: 구현·검증 완료, 깊은 감사 대기.
근거: ②장시간 안정성/스트리밍 내구성(윤 지정 순서 1번). T3 "잘 되다가 갑자기 멈춤" 재발 방지.
관련: [[gpao-t5-hermes-absorption-roadmap]], §6.11 Streaming.

## 왜 (실측으로 드러난 갭)

스트리밍 테스트는 이미 촘촘하다(heartbeat·always-complete·재접속 replay·동시 세션·같은세션 동시성·내부오류·
프라이버시). 실측 결과 **미커버 갭 하나**: `runTurn → model.respond()`에 **타임아웃이 없다**. 느리거나 멈춘
모델(실 provider)이 영영 안 끝나면 스트림은 heartbeat만 계속 나가고 턴이 안 닫히며, **withSessionQueue가
직렬화하므로 그 세션의 후속 턴까지 전부 막힌다.** 이게 정확히 T3의 "갑자기 멈춤" 재발 지점이다.

## 절대 원칙

- **어떤 턴도 무한히 매달리지 않는다.** 모델이 시한을 넘기면 바운드해 닫는다.
- **한 턴의 지연이 세션을 wedge하지 않는다.** 타임아웃은 기존 오류 경로로 흘러 큐를 풀어 다음 턴을 살린다.
- **정직**: 느린 모델은 사용자 언어로("응답이 늦어 잠시 멈췄어요"), 진단 원문이 아니라.

## 계약 (`runtime/model-timeout.js`)

- `withModelTimeout(model, ms)` — 어떤 ModelClient(스텁·실 provider)든 같은 계약으로 감싼다. `respond(tc)`를
  타임아웃과 race해 **초과 시 `ModelTimeoutError`로 reject**. `ms<=0`이면 원본 그대로(무제한). 타이머는 unref +
  finally clear(누수 방지).
- 왜 reject인가: 기존 오류 경로가 그대로 받는다 — 스트림 catch → `recoverable_error + complete`(큐 task는
  resolve되어 큐가 풀림), POST → 500. 오류 시 assistant 결과 미기록·미저장이라 half-state 없음(원자적).

## 배선

- server: `model = withModelTimeout(deps.model ?? StubModelClient, modelTimeoutMs)`. `modelTimeoutMs`는
  `deps.modelTimeoutMs ?? GPAO_T5_MODEL_TIMEOUT_MS ?? 30_000`. 모든 `ctx.model`이 감싸진 것을 쓴다(fast_chat·complex 공통).
- stream catch: `err.isModelTimeout`이면 "응답이 늦어 잠시 멈췄어요"로(그 외 일반 문구). 항상 complete로 닫는다.

## 테스트 (6, 총 298)

단위: ms 초과→ModelTimeoutError · 빠른 응답 통과 · ms<=0 원본. **헤드라인: 멈춘 모델 스트림은
recoverable_error+complete로 바운드(무한 매달림 금지) · 멈춘 모델 턴 뒤 같은 세션 다음 턴 정상 완료(큐 안 막힘)**
· 무제한(0)이어도 정상 턴은 그대로 complete.

반대 테스트: `withModelTimeout`을 무력화(원본 반환)하면 멈춘 모델 스트림 테스트가 **영영 안 끝나 hang/timeout**
실측 → 타임아웃이 무한 매달림을 막는 load-bearing 장치임을 확인(복원 후 298/298).

## 완료/미완료 (사용자 언어)

- **된 것**: 모델이 갑자기 느려지거나 멈춰도 대화가 "응답이 늦어 잠시 멈췄어요"로 정직하게 닫히고, **그 대화의
  다음 요청이 막히지 않는다.** T3의 "갑자기 멈춤"이 세션을 잠그던 문제를 원인에서 막았다.
- **아직 아닌 것**: 진짜 취소(AbortSignal을 모델까지 전달해 백그라운드 promise도 중단) — 지금은 orphan promise가
  무해하게 방치됨(unref, side-effect 없음). 실 provider 착지 때 AbortController 연결.

## 남은 후속 (②안정성 잔여)

- 재접속 중 미종료 스트림 재-attach(현재는 replay+종료 후 클라 재폴링) · EventLog 장시간 성장(append O(n) 재기록)
  상한/로테이션 · 느린 클라(backpressure) · POST 경로 타임아웃 사용자 언어 표면.
