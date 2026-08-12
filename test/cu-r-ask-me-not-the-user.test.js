// **후보를 손에 쥐여 줬으면 되묻지 말고 골라라.**
//
// 라이브(2026-08-07): *"카카오톡 TNT 대화방에서 어제 오후에 무슨 얘기가 오갔는지 알려줘"*
// → T5 가 카톡을 못 보고 **엉뚱한 창**을 봤다. 원장이 남긴 걸음:
// ```
// confirmed  "그 창은 글자로는 못 읽어서 화면을 보고 말씀드릴게요."
//            "지금 Claude 창 12개가 떠 있어요."      ← 카톡이 아니다
// ```
// 손은 멀쩡했다(실측): `창제목:'TNT'` 를 주면 창 16045 를 정확히 집고 그림도 준다.
// 모델이 `app:'카카오톡'` 으로 물었고, 창이 넷이라 A02 가 옳게 되물었고 — **거기서 멈췄다.**
//
// 우리가 그렇게 시켰다. 되물음 문장이 이랬다:
//   *"…중 어느 것인지 **창제목으로 짚어 주세요**."*
// 이건 **사용자에게 하는 말**이다. 그런데 이 문장을 읽는 것은 모델이고, 모델은 시킨 대로
// 사용자에게 되묻는다. 후보(`다음수단`)를 같은 결과에 담아 줬는데도 그 길로 안 간다 —
// **말이 길과 반대 방향을 가리키면 말이 이긴다.**
//
// 오너 규율: *"자동성이 의무다 — 승인으로 안전을 사지 마라."* A02 는 **임의로 열지 말라**는
// 것이지 **사람을 부르라**는 것이 아니다. 고를 근거가 손 안에 있으면 골라야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 카톡창들 = [
  { window: 16076, title: '정영현', app: '카카오톡' },
  { window: 16045, title: 'TNT(The Next Table)', app: '카카오톡' },
  { window: 16080, title: '(4기) 사장개조 사관학교', app: '카카오톡' },
];

const 손 = (본것) => makeDesktopTool({
  drivers: [{
    id: 'cua',
    status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
    observe: async () => 본것,
  }],
});

test('되물음이 모델에게 말한다 — 사용자에게 떠넘기라고 시키지 않는다', async () => {
  const r = await 손({ windows: [], 창을골라야함: 카톡창들 }).handler({ scope: 'window', app: '카카오톡' });
  const 말 = String(r.userSafeSummary ?? '');
  assert.doesNotMatch(말, /짚어 주세요|알려 주세요|골라 주세요/,
    `**사용자에게 되물으라고 시킨다** — 후보가 손 안에 있는데 대화가 한 번 더 돈다: ${말}`);
  assert.match(말, /골라|다시 (보|부)/,
    `**다음에 무엇을 하는지 안 말한다** — 모델이 딴 창을 보고 그것으로 답한다: ${말}`);
});

test('후보 이름이 그 말 안에 그대로 있다 — 모델이 되붙일 한 벌이어야 한다', async () => {
  const r = await 손({ windows: [], 창을골라야함: 카톡창들 }).handler({ scope: 'window', app: '카카오톡' });
  assert.match(String(r.userSafeSummary ?? ''), /TNT\(The Next Table\)/,
    '**제목을 잘라 준다** — 그대로 못 되붙이면 모델은 다시 못 짚는다');
});

test('다음수단이 창제목으로 다시 부르라고 가리킨다 — 길과 말이 같은 곳을 본다', async () => {
  const r = await 손({ windows: [], 창을골라야함: 카톡창들 }).handler({ scope: 'window', app: '카카오톡' });
  const 길 = r.result?.다음수단 ?? r.다음수단 ?? [];
  assert.equal(길.length, 3, `후보 수가 다르다: ${JSON.stringify(길)}`);
  assert.ok(길.every((x) => x.방법 === 'observe' && x.창제목),
    `**길이 창제목을 안 준다**: ${JSON.stringify(길)}`);
});
