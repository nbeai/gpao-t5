// **화면을 본 세션이 그 다음 턴부터 통째로 죽는다.**
//
// 오너 화면(2026-08-06). 카톡 창을 한 번 보고 나면 그 뒤로 무슨 말을 해도 같은 문장이 나왔다:
//   *"처리 중 문제가 있었어요. 다음: 잠시 후 같은 요청을 다시 해볼까요?"*
// 사용자가 *"다시해봐"*, *"아까 지시한 내용 다시 해봐"* 라고 해도 똑같았다.
//
// 덤프로 밟은 기계 사실:
//   · 한 턴 안에서 **같은 그림이 걸음마다 다시 실린다** — 4장이 쌓여 요청이 **298KB**
//   · 그 turnExchange 가 원장 가림(`redactSensitiveResult`)을 지나면서 base64 가
//     `[민감정보 — 원문은 저장하지 않음]` **20자 문자열**로 바뀐다
//   · 다음 턴에 그것이 `data:image/jpeg;base64,[민감정보…]` 로 나간다 → 공급자 **500**
//
// 즉 **우리가 만든 깨진 이미지**가 세션을 죽였다. 그리고 우리는 재시도도 안 했다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_PROVIDERS } from '../src/runtime/model-provider.js';
import { 이번턴만그림 } from '../src/kernel/l1-intent/task-context.js';

const 몸통 = (exchange) => String(MODEL_PROVIDERS.openai.body(
  { modelId: 'x', baseUrl: 'https://x/v1', 눈있음: true },
  { system: 's', user: 'u', history: [], exchange },
));

test('못 쓰는 그림은 안 싣는다 — 깨진 이미지 하나가 턴을 죽인다', () => {
  const s = 몸통([{
    ref: 'p1', tool: 'desktop.screen', args: {}, summary: '봤어요',
    그림: { mime: 'image/jpeg', base64: '[민감정보 — 원문은 저장하지 않음]' },
  }]);
  assert.ok(!s.includes('민감정보'),
    `**가려진 자리표시자를 이미지로 보낸다** — 공급자가 500 을 낸다: ${s.slice(0, 200)}`);
  assert.ok(!s.includes('image_url'), '깨진 그림 자리를 그대로 남겼다');
});

test('짧은 것도 그림이 아니다 — 모양으로 거른다(이름 목록이 아니다)', () => {
  const s = 몸통([{ ref: 'p1', tool: 'desktop.screen', args: {}, summary: '봤어요', 그림: { mime: 'image/png', base64: 'AAAB' } }]);
  assert.ok(!s.includes('image_url'), `**4자짜리를 그림이라고 보낸다**: ${s.slice(0, 160)}`);
});

test('멀쩡한 그림은 그대로 간다 — 없던 벽을 만들지 않는다', () => {
  const s = 몸통([{ ref: 'p1', tool: 'desktop.screen', args: {}, summary: '봤어요', 그림: { mime: 'image/jpeg', base64: 'Q'.repeat(2000) } }]);
  assert.ok(s.includes('image_url'), '멀쩡한 그림을 버렸다');
});

// ── 한 턴에 같은 화면을 여러 장 싣지 않는다 ──────────────────────────────
test('한 턴에 그림은 마지막 것 하나다 — 걸음마다 쌓으면 300KB가 된다', () => {
  const 화면 = (n) => ({ ref: `p${n}`, tool: 'desktop.screen', args: {}, summary: '봤어요', 그림: { mime: 'image/jpeg', base64: `${n}`.repeat(2000) } });
  const s = 몸통([화면(1), 화면(2), 화면(3), 화면(4)]);
  const 장수 = (s.match(/data:image/g) ?? []).length;
  assert.equal(장수, 1,
    `**같은 화면을 걸음마다 다시 싣는다** — 실측 4장 · 298KB · 공급자 500: ${장수}장`);
  assert.ok(s.includes('4'.repeat(100)), '가장 최근 화면이 아니라 옛 화면을 남겼다');
});

// ── 다음 턴으로는 그림을 안 넘긴다(이미 있는 계약을 다시 못 박는다) ────────
test('이번 턴 그림은 다음 턴으로 안 넘어간다 — 원장에 남으면 지워지지 않는다', () => {
  const 남은것 = 이번턴만그림([{ ref: 'p1', tool: 'desktop.screen', 그림: { mime: 'image/jpeg', base64: 'Q'.repeat(2000) }, summary: 's' }]);
  assert.equal(남은것[0].그림, undefined);
  assert.equal(남은것[0].summary, 's', '그림만 벗겨야 하는데 사실까지 지웠다');
});
