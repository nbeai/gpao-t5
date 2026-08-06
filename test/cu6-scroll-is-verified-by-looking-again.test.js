// **스크롤은 다시 보면 확인된다.**
//
// 오너 계획서 ③을 라이브로 재니 T5 가 이렇게 답했다(2026-08-06):
//   *"제 쪽 자동 스크롤이 지금 **막혀 있어서** 제가 직접 더 올려보는 건 안 되는 상태예요."*
//   *"윤님이 손으로 위로 스크롤해서 더 위 화면을 캡처해 주셔야만…"*
//
// **막힌 적이 없다.** 원장이 그대로 보여 준다:
//   confirmed   화면 관찰 ×2
//   unconfirmed *"했어요. 다만 그 결과를 화면에서 확인하지는 못했어요 —
//                됐는지 안 됐는지는 모르겠어요. — 잠시 후 다시 시도할까요?"*
// 스크롤은 **실행됐다**(드라이버 실측: `route:"synthetic_events"` · 전후 그림이 달랐다).
// cua 가 `effect:"unverifiable"` 을 줬고, 우리는 그것을 정직하게 "모르겠다"로 옮겼다.
// 모델은 그 문장을 "막혔다"로 읽고 사용자에게 떠넘겼다.
//
// A14 는 옳다 — **모르는 것을 됐다고 하지 않는다.** 다만 스크롤은 **모를 이유가 없다.**
// 성공 조건이 하나뿐이기 때문이다: **화면이 달라졌나.** 우리는 전후 화면을 이미 들고 있다.
// 대조할 값(`본것.scroll`)이 cua 에서 늘 `null` 이라 재는 자리가 비어 있었을 뿐이다.
//
// **커널은 알맹이를 안 읽는다**(오너 정본). 그림이 같은지 다른지만 본다 — 무엇이 찍혔는지는
// 모델이 볼 일이다. 끝(더 올라갈 데 없음)도 같은 자로 잡힌다: 밀었는데 화면이 그대로면 끝이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 창 = { id: 9, app: '카카오톡', title: 'TNT' };
// **가짜가 실물 모양을 안 내면 계약이 아니라 모양만 지킨다.** 관찰이 주는 그림은
// 문자열이 아니라 `{mime, base64}` 다 — 첫 판은 문자열로 재서 검사는 초록인데
// 실물에서는 지문이 늘 `null` 이었다(실측 2026-08-06).
const 화면 = (씨) => ({ mime: 'image/jpeg', base64: 씨.repeat(40) });
function 드라이버({ 화면들, effect = 'unverifiable' }) {
  let n = 0;
  const 부른것 = [];
  return {
    부른것,
    id: 'cua',
    status: () => ({ connected: true }),
    async observe() {
      const 그림 = 화면들[Math.min(n, 화면들.length - 1)];
      n += 1;
      return { 본창: 창, windows: [창], elements: [], 그림, 그림크기: { w: 500, h: 768 } };
    },
    async act(요청) { 부른것.push(요청); return { effect, delivery: { mode: 'background' }, route: 'synthetic_events' }; },
  };
}

const 부르기 = (d, args) => makeDesktopActTool({ drivers: [d] })
  .handler({ action: 'scroll', 창제목: 'TNT', 값: 'up', ...args });

test('밀고 나서 화면이 달라졌으면 된 것이다 — 확인 못 했다고 말하지 않는다', async () => {
  const d = 드라이버({ 화면들: [화면('AAAA전화면'), 화면('BBBB밀린화면')] });
  const r = await 부르기(d);
  assert.notEqual(r.failed, true,
    `**밀었는데 실패라고 한다** — 모델이 "막혔다"고 읽고 사용자에게 떠넘긴다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('밀었는데 화면이 그대로면 거기가 끝이다 — 없는 대화를 찾아 헤매지 않는다', async () => {
  const d = 드라이버({ 화면들: [화면('같은화면')] });
  const r = await 부르기(d);
  assert.match(JSON.stringify(r), /더 없|끝|그대로/,
    `**끝을 못 알린다** — 모델이 같은 자리를 계속 민다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('드라이버가 확인해 주면 그것이 이긴다 — 우리 추측으로 덮지 않는다', async () => {
  const d = 드라이버({ 화면들: [화면('같은화면'), 화면('같은화면')], effect: 'confirmed' });
  const r = await 부르기(d);
  assert.notEqual(r.failed, true, `**드라이버가 됐다는데 실패로 뒤집는다**: ${JSON.stringify(r).slice(0, 200)}`);
});

test('그림이 아예 없으면 모른다고 한다 — 못 본 것을 됐다고 하지 않는다', async () => {
  const d = 드라이버({ 화면들: [undefined, undefined] });
  const r = await 부르기(d);
  assert.equal(r.failed, true, `**안 보고 됐다고 한다**: ${JSON.stringify(r).slice(0, 200)}`);
});

// ── 밀었으면 그 다음이 있다 ─────────────────────────────────────────────
// 라이브(2026-08-07): *"위로 올려가면서 찾아서 알려줘"* 라고 명시했는데 T5 는 창을 앞으로
// 띄우고 한 화면만 읽었다. 밀기는 됐다고 말해 줬는데 — **그 말이 거기서 끝났다.**
//
// 우리가 이 파일 위에서 배운 것과 같다: *"화면을 줬으면 그 다음 길도 준다."*
// 밀기의 결과는 **새 화면**이고, 그건 다시 봐야 손에 들어온다. 그 한 줄이 없으면
// 모델은 민 사실만 알고 그 열매를 못 가져간다.
test('밀고 나면 다시 보라고 한다 — 민 사실만 알고 열매를 못 가져가면 소용없다', async () => {
  const d = 드라이버({ 화면들: [화면('AAAA전화면'), 화면('BBBB밀린화면')] });
  const r = await 부르기(d);
  assert.match(JSON.stringify(r), /다시 보/,
    `**밀어 놓고 그 다음을 안 말한다** — 새 화면이 손에 있는데 안 읽는다: ${JSON.stringify(r).slice(0, 300)}`);
});

test('끝이면 더 밀라고 하지 않는다 — 없는 대화를 찾아 헤매지 않는다', async () => {
  const d = 드라이버({ 화면들: [화면('같은화면')] });
  const r = await 부르기(d);
  assert.doesNotMatch(JSON.stringify(r), /다시 보/,
    `**끝인데 계속 밀라고 한다**: ${JSON.stringify(r).slice(0, 300)}`);
});
