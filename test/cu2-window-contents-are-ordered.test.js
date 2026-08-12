// **창 안을 봤다면 그 창 것만, 화면 순서로 준다.**
//
// 오너 라이브(2026-08-06, 사진 대조): `카톡에서 정영현이 보낸 마지막 메세지 봐줄래?`
// T5 가 손을 써서 읽었고 — 여기까지는 됐다 — 이렇게 답했다:
//   *"보이는 마지막 메시지가 `메시지가 삭제되었습니다.` 예요."*
// **틀렸다.** 화면의 마지막은 `두시가 나을 것 같네요…`(오후 6:52)다.
//
// 왜 틀렸나(실측):
//   · 요소 순서가 **화면 순서가 아니다.** 끝 4개가 `ChatGPT` · `Finder에서 'ChatGPT' 보기` —
//     **Dock 메뉴가 섞여 있다.** 카톡 창을 봤다면서 창 밖 것이 들어왔다.
//   · `삭제되었습니다` 는 9번째, 진짜 마지막은 38번째. 순서가 무의미하니 모델이 앞엣것을 골랐다.
//   · 요소에 `bounds{x,y}` 가 **있다.** 화면 순서를 알 수 있는데 안 쓰고 있었다.
//
// "마지막 메시지"는 **아래쪽**이다. 그건 우리가 줄 수 있는 사실이고, 안 주면 모델이 못 맞힌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

const 창 = { id: 9, app: '카카오톡', title: '정영현', bounds: { x: 100, y: 50, w: 400, h: 700 } };

/** 창 안(위→아래)과 창 밖(Dock)이 섞여 오는 실물 모양. */
const 섞인요소 = [
  { id: 'c', type: 'AXTextArea', label: '', value: '두시가 나을 것 같네요', bounds: { x: 120, y: 600, w: 200, h: 40 } },
  { id: 'a', type: 'AXTextArea', label: '', value: '메시지가 삭제되었습니다.', bounds: { x: 120, y: 120, w: 200, h: 40 } },
  { id: 'dock', type: 'AXButton', label: 'ChatGPT', bounds: { x: 900, y: 1300, w: 50, h: 50 } },
  { id: 'b', type: 'AXTextArea', label: '', value: '여쭤보면 될까요?', bounds: { x: 120, y: 400, w: 200, h: 40 } },
];

const 손세우기 = () => makeDesktopTool({
  drivers: [{
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ frontmost: { name: 'Claude' }, windows: [창], elements: 섞인요소, 본창: 창 }),
  }],
});

test('창 안을 봤으면 창 밖 것은 안 섞는다 — Dock 이 대화에 끼어들었다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const ids = (r.result?.elements ?? []).map((e) => e.id);
  assert.equal(ids.includes('dock'), false,
    `**창 밖 요소가 섞였다** — 대화 목록 끝에 Dock 이 붙는다: ${ids.join(' ')}`);
});

test('화면 순서(위→아래)로 준다 — "마지막 메시지"는 아래쪽이다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const ids = (r.result?.elements ?? []).map((e) => e.id);
  assert.deepEqual(ids, ['a', 'b', 'c'],
    `**화면 순서가 아니다** — 모델이 앞엣것을 "마지막"으로 고른다: ${ids.join(' ')}`);
});

test('무슨 순서인지 밝힌다 — 모델이 믿고 쓸 수 있어야 한다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  assert.match(String(r.result?.요소창?.순서 ?? ''), /위|아래|화면/,
    '순서를 안 밝히면 모델은 그 목록을 임의 순서로 본다');
});

test('자리를 모르는 요소는 버리지 않는다 — 못 잰 것과 창 밖은 다르다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [창], 본창: 창,
        elements: [{ id: 'noxy', type: 'AXTextArea', value: '자리 모름' },
          { id: 'in', type: 'AXTextArea', value: '안', bounds: { x: 120, y: 100, w: 10, h: 10 } }],
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const ids = (r.result?.elements ?? []).map((e) => e.id);
  assert.ok(ids.includes('noxy'), `**못 잰 것을 창 밖으로 몰아 버렸다**: ${ids.join(' ')}`);
});

test('창 자리를 모르면 아무것도 안 거른다 — 모르면 버리지 않는다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [{ id: 9, app: 'K' }], 본창: { id: 9, app: 'K' }, elements: 섞인요소 }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: 'K' });
  assert.equal((r.result?.elements ?? []).length, 4, '창 범위를 모르는데 걸러 냈다');
});

// ── 못 찾으면 앞 창으로 조용히 떨어지지 않는다 ───────────────────────────
// 라이브(2026-08-06): 모델이 `app:'KakaoTalk'`(영문)로 물었더니 **Claude 창**을 봤다.
// 창 목록의 이름은 `카카오톡` 뿐이라 못 찾았고, 우리는 **앞 창으로 떨어졌다.**
// 그건 오대상 관찰이다 — 모델은 카톡을 봤다고 믿고 남의 창 내용으로 답한다.
test('지목한 앱을 못 찾으면 앞 창을 대신 보여 주지 않는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') {
        return { windows: [{ window_id: 1, app_name: 'Claude', pid: 11 }] };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(부른것.some((c) => c.이름 === 'get_window_state'), false,
    '**엉뚱한 창을 봤다** — 모델은 카톡을 봤다고 믿는다');
  assert.equal(o.본창, undefined);
  assert.ok(o.그앱없음, `못 찾았다는 사실이 없다: ${JSON.stringify(o).slice(0, 160)}`);
});

test('앱 이름은 창 이름·앱 목록 양쪽으로 찾는다 — 영문/한글이 다르다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') {
        return { windows: [{ window_id: 9, app_name: '카카오톡', pid: 77 }] };
      }
      if (이름 === 'list_apps') {
        return { apps: [{ name: '카카오톡', bundle_id: 'com.kakao.KakaoTalkMac', pid: 77, launch_path: '/Applications/KakaoTalk.app' }] };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: 'KakaoTalk' });
  assert.equal(o.본창?.id, 9, `**영문 이름으로는 못 찾는다** — 모델이 실제로 그렇게 물었다: ${JSON.stringify(o.본창)}`);
});

// ── 잘렸으면 **끝쪽으로 가는 길**을 준다 ────────────────────────────────
// 라이브(2026-08-06): 순서를 고치니 앞 40개가 **위쪽(오래된 것)** 이 됐고,
// 카톡은 마지막이 아래쪽이라 T5 가 *"마지막 메시지를 못 읽겠다"* 고 답했다.
// 정직해졌지만 **목적은 여전히 미달**이다 — "마지막"을 물었으면 끝을 볼 수 있어야 한다.
// `offset` 은 있었지만 모델이 총 개수에서 빼야 했다. 그 계산을 **우리가 해서 준다**(계열 F).
test('잘렸으면 끝쪽으로 가는 다음 수를 준다 — "마지막"은 아래쪽에 있다', async () => {
  const 많은요소 = Array.from({ length: 129 }, (_, i) => ({
    id: `e${i}`, type: 'AXTextArea', value: `줄${i}`, bounds: { x: 120, y: 60 + i, w: 10, h: 10 },
  }));
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({ frontmost: { name: 'X' }, windows: [창], 본창: 창, elements: 많은요소 }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  const 창정보 = r.result?.요소창 ?? {};
  assert.equal(창정보.총, 129);
  assert.equal(창정보.끝, 40);
  const 다음 = JSON.stringify(r.result?.다음수단 ?? []);
  assert.match(다음, /89/, `**끝쪽 자리를 안 알려 준다** — 모델이 총에서 빼야 한다: ${다음}`);
  assert.match(다음, /끝|최근|마지막|아래/, `왜 거기로 가는지가 없다: ${다음}`);
});

test('다 보였으면 끝쪽 이야기를 안 붙인다', async () => {
  const r = await 손세우기().handler({ action: 'observe', scope: 'window', app: '카카오톡' });
  assert.doesNotMatch(JSON.stringify(r.result?.다음수단 ?? []), /끝쪽/);
});

test('본창에 자리(bounds)를 싣는다 — 없으면 창 밖·스크롤 밖이 안 걸러진다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') {
        return { windows: [{ window_id: 9, app_name: '카카오톡', pid: 77, title: '정영현', bounds: { x: 93, y: 60, width: 380, height: 675 } }] };
      }
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.ok(o.본창?.bounds, `**창 자리가 없다** — 스크롤 위로 벗어난 y=-5081 같은 것이 그대로 섞인다: ${JSON.stringify(o.본창)}`);
  assert.equal(o.본창.bounds.y, 60);
});

test('스크롤 밖(위로 벗어난) 요소는 안 준다 — 화면에 없는 것은 "보이는 것"이 아니다', async () => {
  const 창b = { id: 9, app: 'K', bounds: { x: 90, y: 60, w: 380, h: 675 } };
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [창b], 본창: 창b,
        elements: [
          { id: '위로벗어남', type: 'AXTextArea', value: '옛날 메시지', bounds: { x: 120, y: -5081, w: 10, h: 10 } },
          { id: '보임', type: 'AXTextArea', value: '두시가 나을 것 같네요', bounds: { x: 120, y: 561, w: 10, h: 10 } },
        ],
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: 'K' });
  const ids = (r.result?.elements ?? []).map((e) => e.id);
  assert.deepEqual(ids, ['보임'], `**화면 밖 것이 섞여 "마지막"이 뒤바뀐다**: ${ids.join(' ')}`);
});

// ── 뿌리 · **글자만 보는 축**이 없었다 ──────────────────────────────────
// 라이브에서 모델이 `type:'textField'` → 0개, `type:'text'` → 0개로 헛짚었다.
// 카톡 메시지는 `AXTextArea` 다. **역할 이름을 알아맞히게 하는 것이 잘못**이다 —
// 앱마다 역할이 다르고(그건 앱이 정한다) 모델은 그걸 미리 알 수 없다.
//
// 사용자가 원하는 건 *"글자"* 지 *"AXTextArea"* 가 아니다. 그 축을 준다.
// 그러면 129개 중 37개로 줄어 **한 번에 다 보인다** — 잘림도 없고 "마지막"도 정확하다.
test('글자 있는 것만 보는 축이 있다 — 역할 이름을 알아맞히게 하지 않는다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [창], 본창: 창,
        elements: [
          { id: 'm1', type: 'AXTextArea', value: '안녕', bounds: { x: 120, y: 100, w: 10, h: 10 } },
          { id: 'btn', type: 'AXButton', label: '', bounds: { x: 120, y: 200, w: 10, h: 10 } },
          { id: 'm2', type: 'AXStaticText', label: '오후 6:52', bounds: { x: 120, y: 300, w: 10, h: 10 } },
          { id: 'cell', type: 'AXCell', bounds: { x: 120, y: 400, w: 10, h: 10 } },
        ],
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: '카카오톡', 글자만: true });
  const ids = (r.result?.elements ?? []).map((e) => e.id);
  assert.deepEqual(ids, ['m1', 'm2'],
    `**글자만 보는 길이 없다** — 모델이 역할 이름을 알아맞히다 0개를 받는다: ${ids.join(' ')}`);
});

test('글자만 축에도 무엇을 걸렀는지 남긴다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'X' }, windows: [창], 본창: 창,
        elements: [{ id: 'btn', type: 'AXButton', label: '', bounds: { x: 120, y: 200, w: 10, h: 10 } }],
      }),
    }],
  });
  const r = await 손.handler({ action: 'observe', scope: 'window', app: 'K', 글자만: true });
  assert.equal(r.result?.요소창?.총, 0);
  assert.equal(r.result?.요소창?.거르개가못물었다, true, '왜 0인지 안 말한다');
});

test('창 자리를 못 받으면 그 사실이 드러난다 — 자리 없이는 스크롤 밖을 못 거른다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'list_windows') return { windows: [{ window_id: 9, app_name: 'K', pid: 7, title: 'k', is_on_screen: true, bounds: { x: 1, y: 2, width: 3, height: 4 } }] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: 'K' });
  assert.ok(o.본창?.bounds, `**창 자리를 안 받아 온다** — 스크롤 밖 요소가 그대로 섞인다: ${JSON.stringify(o.본창)}`);
  assert.equal(o.본창.bounds.w, 3);
});

// ── 앱 창이 여럿일 때 — 임의로 고르면 엉뚱한 대화를 읽는다 ──────────────
// 라이브(2026-08-06): `app:'KakaoTalk'` 로 물으니 그 pid 의 창이 **7개**였고
// 우리가 **첫 창을 임의로** 골랐다 — 하필 다른 대화창이었고 그 AX 트리는 20초를 넘겨
// **timeout** 이 났다. 보이는 창은 하나뿐이었는데 **안 보이는 창까지** 후보에 넣었다.
// A02(같은 이름이면 임의로 안 고른다)를 창 고르기에는 안 지킨 것이다.
test('보이는 창만 후보로 삼는다 — 숨은 창을 여느라 시간을 다 쓴다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      // 실물에서 창 정보(이름·제목·보임·자리·앞뒤)는 **`list_windows` 에 다 있다.**
      if (이름 === 'list_windows') {
        return { windows: [
          { window_id: 1, app_name: '카카오톡', pid: 77, title: '다른 대화', is_on_screen: false, z_index: 2, bounds: { x: 0, y: 0, width: 10, height: 10 } },
          { window_id: 2, app_name: '카카오톡', pid: 77, title: '정영현', is_on_screen: true, z_index: 1, bounds: { x: 90, y: 60, width: 380, height: 675 } },
        ] };
      }
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(o.본창?.id, 2, `**안 보이는 창을 열었다** — 엉뚱한 대화를 읽고 시간도 다 쓴다: ${JSON.stringify(o.본창)}`);
});

test('창 제목으로도 고를 수 있다 — 사용자는 "정영현"이라고 말한다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      // 창 목록의 주 통로는 `list_windows` 다(z_index·is_on_screen·bounds 가 거기 있다).
      if (이름 === 'list_windows') {
        return { windows: [
          { window_id: 1, app_name: '카카오톡', pid: 77, title: '채팅', is_on_screen: true, z_index: 2 },
          { window_id: 2, app_name: '카카오톡', pid: 77, title: '정영현', is_on_screen: true, z_index: 1 },
        ] };
      }
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', 창제목: '정영현' });
  assert.equal(o.본창?.id, 2, `**제목으로 못 고른다** — 사용자가 말한 대화창을 못 찾는다: ${JSON.stringify(o.본창)}`);
});

test('보이는 창이 여럿이면 임의로 안 고른다 — 어느 것이냐고 되묻는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') {
        return { windows: [
          { window_id: 1, app_name: '카카오톡', pid: 77, title: '정영현', is_on_screen: true, z_index: 2 },
          { window_id: 2, app_name: '카카오톡', pid: 77, title: '박종윤', is_on_screen: true, z_index: 1 },
        ] };
      }
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return {};
    },
  };
  const o = await makeCuaDriver({ mcp }).observe({ scope: 'window', app: '카카오톡' });
  assert.equal(부른것.some((c) => c.이름 === 'get_window_state'), false,
    '**둘 중 하나를 임의로 열었다** — 엉뚱한 대화를 읽는다');
  assert.equal(o.창을골라야함?.length, 2, `후보를 안 준다: ${JSON.stringify(o).slice(0, 200)}`);
});
