// **열린 창을 세어만 주면 모델은 아무것도 못 짚는다.**
//
// 라이브(2026-08-07): *"카카오톡 TNT 대화방을 위로 올려가면서 찾아서 알려줘"*
// → 원장에 **스크롤 걸음이 없다.** 시도조차 안 했다. 남은 것은 둘뿐이었다:
// ```
// "그 창은 글자로는 못 읽어서 화면을 보고 말씀드릴게요."
// "지금 Claude 창 11개가 떠 있어요."          ← 모델이 받은 전부
// ```
// 그때 카카오톡 창은 **떠 있었다**(실측: `TNT(The Next Table)` id=16045 `보임=true`).
// 손도 멀쩡했다 — `창제목:'TNT'` 를 주면 그 창을 집고 그림도 준다.
//
// 창 목록 자체는 갔다(결과 JSON 에 다 있다). **틀린 것은 우리가 붙인 한 줄**이다:
//   `지금 ${frontmost} 창 ${windows.length}개가 떠 있어요`
// 11 은 **전체 창 수**인데 앞 앱 이름을 붙여 *"Claude 창 11개"* 가 됐다. 모델은 그 말을
// 읽고 **떠 있는 것이 전부 Claude 라고** 믿었고, 카카오톡을 찾을 생각을 접었다.
//
// 계열 B 그대로다 — 손이 가져온 사실(창 11개 중 카톡 2개)을 **우리 문장이 덮었다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 창들 = [
  { id: 1, app: 'Claude', title: '', 보임: true },
  { id: 2, app: 'Claude', title: '', 보임: true },
  { id: 16045, app: '카카오톡', title: 'TNT(The Next Table)', 보임: true },
  { id: 16076, app: '카카오톡', title: '정영현', 보임: true },
  { id: 16172, app: '계산기', title: '계산기', 보임: true },
];

const 손 = (본것) => makeDesktopTool({
  drivers: [{
    id: 'cua',
    status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
    observe: async () => 본것,
  }],
});

test('앞 앱 이름에 전체 창 수를 붙이지 않는다 — 다 그 앱 것인 줄 알게 된다', async () => {
  const r = await 손({ frontmost: { name: 'Claude' }, windows: 창들 }).handler({ scope: 'screen' });
  const 말 = String(r.userSafeSummary ?? '');
  assert.doesNotMatch(말, /Claude 창 5개/,
    `**전체 수를 앞 앱 것으로 말한다** — 모델이 카톡을 찾을 생각을 접는다: ${말}`);
});

test('무엇이 떠 있는지 이름을 준다 — 개수는 짚을 수 없는 사실이다', async () => {
  const r = await 손({ frontmost: { name: 'Claude' }, windows: 창들 }).handler({ scope: 'screen' });
  const 말 = String(r.userSafeSummary ?? '');
  assert.match(말, /카카오톡/,
    `**떠 있는 앱 이름이 말에 없다** — 모델은 카톡이 있는 줄도 모른다: ${말}`);
  assert.match(말, /계산기/, `일부만 준다: ${말}`);
});

test('창이 하나도 없으면 예전 그대로다 — 없는 것을 지어내지 않는다', async () => {
  const r = await 손({ frontmost: { name: 'Claude' }, windows: [] }).handler({ scope: 'screen' });
  assert.match(String(r.userSafeSummary ?? ''), /창이 없|열려 있는 창/,
    `${r.userSafeSummary}`);
});
