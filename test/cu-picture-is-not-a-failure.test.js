// **글자로 못 읽는 것과 그림이 없는 것은 다르다.**
//
// 오너 지시(2026-08-07): 드라이버가 그림 55,892B 를 내놓는데 모델은 못 읽는다고 답한다.
//
// ```
// 그림          55,892B  ← 있다
// 못읽은이유     ax_window_unresolved
// ```
//
// 사람에게 하는 말은 이미 맞았다 — *"그 창은 글자로는 못 읽어서 **화면을 보고** 말씀드릴게요."*
// 그런데 **모델이 읽는 `result` 에는 `ax_window_unresolved` 가 그대로** 실려서,
// 모델은 그것을 이 관찰의 **실패**로 읽고 *"못 읽었다"* 고 답한다.
//
// `ax_window_unresolved` 는 **접근성 트리로 글자를 못 뽑았다**는 뜻이지 **화면을 못 봤다**는
// 뜻이 아니다. 그림이 있으면 그 창은 읽을 수 있다 — 눈으로 읽으면 된다.
// 계열 C 그대로다: **없는 것과 못 본 것을 가른다.** 여기서는 *한 축이 안 된 것*과
// *아무것도 안 된 것*을 가른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 손 = (본것) => makeDesktopTool({
  drivers: [{
    id: 'cua',
    status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
    observe: async () => 본것,
  }],
});

const 그림있음 = {
  windows: [], 본창: { id: 1, app: '계산기', title: '계산기' },
  그림: { mime: 'image/png', base64: 'x'.repeat(1200) },
  그림크기: { w: 460, h: 816 },
  못읽은이유: 'ax_window_unresolved — 창을 다시 앞으로 가져와 보세요',
  elements: [],
};

test('그림이 있으면 실패로 보이지 않는다 — 모델이 "못 읽었다"로 읽는 자리다', async () => {
  const r = await 손(그림있음).handler({ scope: 'window', app: '계산기' });
  const 실린것 = JSON.stringify(r.result ?? {});
  // `글자만못읽은이유` 가 이 낱말을 품고 있으니 **키 이름으로** 정확히 본다.
  assert.doesNotMatch(실린것, /"못읽은이유":/,
    `**그림이 있는데 실패 이유가 같이 간다** — 모델이 그걸 이 관찰의 실패로 읽는다: ${실린것.slice(0, 300)}`);
});

// **이름을 바꾸는 것으로는 부족했다**(오너 지시 2026-08-07 · 첫 판 정정).
// 첫 판은 `글자만못읽은이유` 로 이름만 갈랐는데, 라이브에서 여전히 못 읽었다.
// **어떤 이름이든 실패 코드가 결과에 있으면 모델은 그것을 붙들고 "못 읽었다"로 간다.**
// 접근성 트리가 창을 못 잡는 것은 정상 상태 중 하나이지 실패가 아니다 —
// 그림이 있으면 그림으로 읽는 것이 정답이고, 모델이 붙들 실패 코드가 없어야 그리로 간다.
test('그림이 있으면 실패 코드를 통째로 안 준다 — 이름을 바꿔도 모델은 붙든다', async () => {
  const r = await 손(그림있음).handler({ scope: 'window', app: '계산기' });
  const 실린것 = JSON.stringify(r.result ?? {});
  assert.doesNotMatch(실린것, /ax_window_unresolved/,
    `**실패 코드가 남아 있다** — 모델이 그걸 붙들고 그림을 안 본다: ${실린것.slice(0, 300)}`);
  assert.doesNotMatch(실린것, /못읽은이유/,
    `**이유 칸이 남아 있다**: ${실린것.slice(0, 300)}`);
});

test('그림이 없으면 예전 그대로다 — 진짜 못 본 것은 못 봤다고 해야 한다', async () => {
  const r = await 손({ ...그림있음, 그림: null, 그림크기: null }).handler({ scope: 'window', app: '계산기' });
  assert.match(JSON.stringify(r.result ?? {}), /못읽은이유/,
    '**정말 못 본 것을 안 말한다** — 그건 조용한 0 이다');
});

test('사람에게 하는 말은 그대로다 — 이미 맞았던 자리를 안 건드린다', async () => {
  const r = await 손(그림있음).handler({ scope: 'window', app: '계산기' });
  assert.match(String(r.userSafeSummary ?? ''), /화면을 보고/,
    `사람 말이 바뀌었다: ${r.userSafeSummary}`);
});
