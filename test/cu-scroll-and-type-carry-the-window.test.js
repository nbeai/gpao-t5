// **어느 창에 하는지 안 들고 가면 아무 데나 간다.**
//
// 오너의 네 질문 중 ③(스크롤로 이전 대화)·④(메시지 입력)가 여기서 막혔다.
// 라이브(2026-08-06)에서 T5 는 카톡 창을 눈으로 읽어 놓고 *"스크롤은 제가 직접 못 올린다"*
// 로 끝냈다. 손이 `scroll` 을 부르긴 했는데 **창도 pid 도 방향도 안 실었다.**
//
// 실물이 계약을 그대로 말해 준다:
//   `scroll {}`                              → *"Missing required integer field: pid"*
//   `scroll {window_id, pid}`                → *"Missing required string field: direction"*
//   `scroll {window_id, pid, direction}`     → `refused` · `same_pid_keyboard_ambiguity`
//        *"pid 4340 owns 6 other eligible top-level window(s) … could mutate a sibling window"*
//   `scroll {window_id, pid, x, y, direction}` → `route: synthetic_events` ✔
//
// 마지막 줄이 핵심이다. **자리를 안 찍으면 드라이버가 형제 창을 건드릴까 봐 거절한다** —
// 그건 옳은 거절이고, 우리가 자리를 줘야 풀린다. 창 가운데를 찍는다.
// `type` 도 같다 — 안 실으면 앞 창에 친다(사용자가 보던 창에 글자가 들어간다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 9, app_name: '카카오톡', title: '정영현', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 100, y: 200, width: 400, height: 800 },
};

function 가짜(부른것) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return { effect: 'unverifiable', route: 'synthetic_events' };
    },
  };
}

test('스크롤이 어느 창인지 들고 간다 — 없으면 드라이버가 형제 창을 걱정해 거절한다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 대상: { 창: 9, pid: 77, bounds: { x: 100, y: 200, w: 400, h: 800 } }, 값: 'up' });
  const c = 부른것.find((x) => x.이름 === 'scroll');
  assert.ok(c, '스크롤을 아예 안 불렀다');
  assert.equal(c.인자.window_id, 9, `창을 안 들고 갔다: ${JSON.stringify(c.인자)}`);
  assert.equal(c.인자.pid, 77, `pid 를 안 들고 갔다: ${JSON.stringify(c.인자)}`);
  assert.equal(c.인자.direction, 'up', `방향을 안 들고 갔다: ${JSON.stringify(c.인자)}`);
  // 자리를 안 찍으면 `same_pid_keyboard_ambiguity` 로 거절당한다(실측).
  assert.equal(c.인자.x, 300, `자리를 안 찍었다 — 거절당한다: ${JSON.stringify(c.인자)}`);
  assert.equal(c.인자.y, 600, `자리를 안 찍었다 — 거절당한다: ${JSON.stringify(c.인자)}`);
});

test('방향을 안 주면 위로 본다 — "이전 대화 보여줘"가 그 말이다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 대상: { 창: 9, pid: 77, bounds: { x: 0, y: 0, w: 10, h: 10 } } });
  assert.equal(부른것.find((x) => x.이름 === 'scroll')?.인자?.direction, 'up');
});

test('얼마나 굴릴지도 말한다 — 한 칸만 굴리면 앞 대화가 안 나온다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'scroll', 대상: { 창: 9, pid: 77, bounds: { x: 0, y: 0, w: 10, h: 10 } }, 값: { 방향: 'down', 양: 3 } });
  const 인자 = 부른것.find((x) => x.이름 === 'scroll')?.인자;
  assert.equal(인자?.direction, 'down');
  assert.ok(Number(인자?.clicks ?? 인자?.amount) > 0, `양을 안 보냈다: ${JSON.stringify(인자)}`);
});

test('글자도 어느 창인지 들고 간다 — 안 그러면 사용자가 보던 창에 친다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) })
    .act({ 행동: 'type', 대상: { 창: 9, pid: 77 }, 값: '안녕' });
  const c = 부른것.find((x) => x.이름 === 'type_text');
  assert.equal(c?.인자?.window_id, 9, `**앞 창에 친다**: ${JSON.stringify(c?.인자)}`);
  assert.equal(c?.인자?.pid, 77);
  assert.equal(c?.인자?.text, '안녕');
});

// ── 손도 같은 사실을 들고 가야 한다 ─────────────────────────────────────
// 드라이버가 창을 실을 수 있어도 **손이 안 짚어 주면** 여전히 빈손이다.
// 라이브에서 모델은 `{action:'scroll', app:'KakaoTalk', window:0}` 만 보냈다 —
// 창 id 도 pid 도 테두리도 없다. 그건 모델이 알 일이 아니다. **방금 본 화면에 있다.**
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

test('앱 이름만 줘도 손이 그 창을 짚어 넘긴다 — 모델이 창 id 를 베끼게 하지 않는다', async () => {
  const 간것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => ({
        frontmost: { name: '다른앱' }, windows: [{ id: 9, pid: 77 }], elements: [],
        본창: { id: 9, app: '카카오톡', title: '정영현', pid: 77, bounds: { x: 100, y: 200, w: 400, h: 800 } },
        볼자리: a,
      }),
      act: (요청) => { 간것.push(요청); return { effect: 'unverifiable' }; },
    }],
  });
  await 손.handler({ action: 'scroll', app: 'KakaoTalk', 값: 'up' });
  const 대상 = 간것[0]?.대상 ?? {};
  assert.equal(대상.창, 9, `**창을 안 짚었다** — 드라이버가 거절한다: ${JSON.stringify(대상)}`);
  assert.equal(대상.pid, 77, `pid 를 안 짚었다: ${JSON.stringify(대상)}`);
  assert.ok(대상.bounds?.w > 0, `테두리를 안 짚었다 — 자리를 못 찍는다: ${JSON.stringify(대상)}`);
});

test('창을 보고 짚는다 — 앞 창이 남의 것이어도 그 창을 본다', async () => {
  const 본자리 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: (a) => { 본자리.push(a); return { frontmost: { name: '다른앱' }, windows: [], elements: [], 본창: { id: 9, app: 'K' } }; },
      act: () => ({ effect: 'unverifiable' }),
    }],
  });
  await 손.handler({ action: 'scroll', app: 'KakaoTalk', 값: 'up' });
  assert.ok(본자리.some((a) => a?.scope === 'window'),
    `**앞 창(남의 것)만 보고 굴린다**: ${JSON.stringify(본자리)}`);
});

test('본 창에는 pid 가 적힌다 — 다음 걸음이 그걸 요구한다', async () => {
  const mcp = {
    async call(이름) {
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.본창?.pid, 77, `**아는 사실을 안 적는다** — 손이 못 실어 보낸다: ${JSON.stringify(o.본창)}`);
});
