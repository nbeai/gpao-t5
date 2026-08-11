// **C4 · 모델 응답에 상한이 아예 없었다** (상태 지도 §12 C4 · `model-timeout.js:48`).
//
// 2026-08-09 오너 결정으로 총시간 상한을 **0(무제한)** 으로 내린 것은 옳았다. 30초·180초로
// 자르던 자는 느린 모델과 죽은 모델을 구분하지 못했고, 정상 응답이 사용자 앞에서 잘렸다.
// *"20초의 99.9%는 모델 판단 시간이다. 왕복을 깎아 모델을 멍청하게 만들지 않는다."*
//
// **그런데 0 은 상한이 아니라 부재다.** 그리고 그 자리를 대신 지키기로 한 「정체 감시」가
// 단발 경로에는 없다 — `model-provider.js:1366` 이 `{ totalMs: timeoutMs, stallMs: 0 }` 으로
// 부른다(단발 POST 에는 셀 조각이 없으니 그건 그 자체로 옳다). 결과: **총시간 0 + 정체 0**.
// 소켓만 살아 있으면 그 턴은 영원히 안 끝나고, `withSessionQueue` 가 직렬화하므로
// **그 세션의 후속 턴이 전부 막힌다**(P-STAB-1 이 애초에 세워진 이유 그대로).
//
// 그래서 세우는 것은 **배급이 아니라 폭주 정지선**이다. 선행자도 무제한으로 두지 않는다 —
// 헤르메스는 무응답을 시계로 자르되 **추론 모델에는 바닥을 올려** 준다:
//   `agent/reasoning_timeouts.py:7`  *"Stream stale detector: `HERMES_STREAM_STALE_TIMEOUT` default 180s"*
//   `agent/reasoning_timeouts.py:9`  *"Non-stream stale detector: `HERMES_API_CALL_STALE_TIMEOUT` default 90s"*
//   `agent/reasoning_timeouts.py:66` `("nemotron-3-ultra", 600)` … `("claude-fable", 600)`
//   같은 파일 24행: *"It is a FLOOR … Never lowers an existing threshold."*
// 즉 **알려진 가장 깊은 추론 예산이 600초**다. 우리 정지선은 그보다 넉넉해야 하고
// (한 요청 900초), 무한이어서는 안 된다.
//
// 끄는 길·조이는 길은 그대로 남는다 — 환경변수에 `0` 을 주면 옛 무제한이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  modelResponseTimeoutMs, modelHttpTimeoutMs, modelStallMs,
  MODEL_HTTP_CEILING_MS, MODEL_TURN_CEILING_MS, DEFAULT_MODEL_STALL_MS,
} from '../src/runtime/model-timeout.js';

test('C4 · 한 요청의 총시간 기본값은 유한하다(무제한 아님)', () => {
  const 상한 = modelHttpTimeoutMs({});
  assert.ok(상한 > 0, `기본이 ${상한} 이다 — 0 은 상한이 아니라 부재다`);
  assert.equal(상한, MODEL_HTTP_CEILING_MS);
});

test('C4 · 한 턴(이어쓰기 포함)의 총시간 기본값도 유한하다', () => {
  const 상한 = modelResponseTimeoutMs({});
  assert.ok(상한 > 0, `기본이 ${상한} 이다 — 세션 큐가 영영 안 풀릴 수 있었다`);
  assert.equal(상한, MODEL_TURN_CEILING_MS);
});

// ── **배급이 아니다** — 알려진 가장 깊은 추론 예산보다 넉넉하다 ──────────────
test('C4 · 정지선은 헤르메스가 아는 가장 깊은 추론 예산(600s)보다 넉넉하다', () => {
  const 가장깊은추론예산 = 600_000; // reasoning_timeouts.py:66,93,116 — nemotron-3-ultra · o1 · claude-fable
  assert.ok(MODEL_HTTP_CEILING_MS > 가장깊은추론예산,
    `한 요청 상한 ${MODEL_HTTP_CEILING_MS}ms 가 ${가장깊은추론예산}ms 보다 커야 정상 응답을 안 자른다`);
});

test('C4 · 정지선은 정체 감시선보다 훨씬 뒤에 있다(정체가 먼저 잡는다)', () => {
  assert.ok(MODEL_HTTP_CEILING_MS > DEFAULT_MODEL_STALL_MS * 4,
    '흐르는 스트림은 정체 감시(180s)가 먼저 잡는다 — 총시간은 그 뒤의 마지막 그물이다');
});

test('C4 · 턴 상한은 한 요청 상한에서 파생된다(두 숫자가 갈라지지 않는다)', () => {
  // `model-provider.js:1256` — 첫판 + 이어쓰기 3회 = 최대 4번 왕복.
  assert.equal(MODEL_TURN_CEILING_MS, MODEL_HTTP_CEILING_MS * 4);
});

// ── 조이는 길·끄는 길은 그대로 ────────────────────────────────────────────
test('C4 반대시험 · 환경변수 0 은 여전히 무제한이다(선택을 없애지 않는다)', () => {
  assert.equal(modelHttpTimeoutMs({ GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0' }), 0);
  assert.equal(modelResponseTimeoutMs({ GPAO_T5_MODEL_TIMEOUT_MS: '0' }), 0);
});

test('C4 반대시험 · 환경변수로 조이는 길도 그대로', () => {
  assert.equal(modelHttpTimeoutMs({ GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '5000' }), 5000);
  assert.equal(modelResponseTimeoutMs({ GPAO_T5_MODEL_TIMEOUT_MS: '7000' }), 7000);
});

test('C4 반대시험 · 정체 감시 기본값은 안 건드린다(180초 그대로)', () => {
  assert.equal(modelStallMs({}), DEFAULT_MODEL_STALL_MS);
  assert.equal(DEFAULT_MODEL_STALL_MS, 180_000);
});
