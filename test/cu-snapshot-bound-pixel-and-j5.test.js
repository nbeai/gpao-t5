import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 창 = {
  window_id: 9, app_name: '카카오톡', title: '대화 목록', pid: 77,
  is_on_screen: true, z_index: 1,
  bounds: { x: 100, y: 200, width: 400, height: 800 },
};

test('관측 계보 없는 x/y는 화면에서 본 자리로 승격하지 않는다', async () => {
  const 간것 = [];
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'fixture',
      status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: async () => ({
        frontmost: { name: '카카오톡' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '카카오톡', pid: 77, bounds: { x: 100, y: 200, w: 400, h: 800 } },
        elements: [],
      }),
      act: async (요청) => { 간것.push(요청); return { effect: 'confirmed' }; },
    }],
  });

  const 결과 = await 손.handler({ action: 'double_click', app: '카카오톡', 대상: { x: 120, y: 250 } });
  assert.equal(간것.length, 0,
    `관측 계보 없는 좌표가 실행됐다: ${JSON.stringify(간것[0] ?? null)}`);
  assert.equal(결과.blocked, true);
  assert.match(String(결과.userSafeSummary ?? ''), /다시|화면|관찰|스냅샷/);
});

test('드라이버도 관측 계보 없는 좌표에 from_zoom을 붙이지 않는다', async () => {
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return { effect: 'confirmed' };
    },
    async 조각들(이름, 인자) {
      부른것.push({ 이름, 인자, 조각: true });
      return [{ type: 'image', mimeType: 'image/jpeg', data: 'Q'.repeat(2_000), width: 500, height: 768 }];
    },
  };

  const 결과 = await makeCuaDriver({ mcp }).act({
    행동: 'double_click', 대상: { 창: 9, pid: 77, x: 120, y: 250 },
  });
  assert.equal(부른것.some((x) => x.이름 === 'zoom'), false,
    '관측 계보가 없는데 새 zoom을 만들어 과거 좌표의 근거로 삼았다');
  assert.equal(부른것.some((x) => x.이름 === 'double_click'), false,
    '관측 계보가 없는 좌표를 실행했다');
  assert.equal(결과.effect, 'refused');
});

function 픽셀가짜(그림고르기 = () => 'Q'.repeat(2_000)) {
  const 부른것 = [];
  return {
    부른것,
    mcp: {
      async call(이름, 인자) {
        부른것.push({ 이름, 인자 });
        if (이름 === 'list_windows') return { windows: [창] };
        if (이름 === 'get_accessibility_tree') return { windows: [] };
        if (이름 === 'get_window_state') return { elements: [] };
        return { effect: 'confirmed' };
      },
      async 조각들(이름, 인자) {
        부른것.push({ 이름, 인자, 조각: true });
        return [{ type: 'image', mimeType: 'image/jpeg', data: 그림고르기(), width: 500, height: 768 }];
      },
    },
  };
}

test('같은 창·같은 그림에서 관측한 좌표만 from_zoom으로 실행한다', async () => {
  const 가짜 = 픽셀가짜();
  const 드라이버 = makeCuaDriver({ mcp: 가짜.mcp });
  const 관측 = await 드라이버.observe({ scope: 'window', app: '카카오톡' });
  assert.match(String(관측.그림스냅샷 ?? ''), /^px:/, '그림 관측에 픽셀 스냅샷 신분이 없다');

  const 결과 = await 드라이버.act({
    행동: 'double_click',
    대상: { 창: 9, pid: 77, x: 120, y: 250, 스냅샷: 관측.그림스냅샷 },
  });
  const 실행 = 가짜.부른것.find((x) => x.이름 === 'double_click');
  assert.equal(결과.effect, 'confirmed');
  assert.equal(실행?.인자?.from_zoom, true);
  assert.equal(실행?.인자?.x, 120);
  assert.equal(실행?.인자?.y, 250);
});

test('관측 뒤 그림이 달라지면 오래된 좌표를 실행하지 않는다', async () => {
  let 그림번호 = 0;
  const 가짜 = 픽셀가짜(() => (++그림번호 === 1 ? 'Q' : 'R').repeat(2_000));
  const 드라이버 = makeCuaDriver({ mcp: 가짜.mcp });
  const 관측 = await 드라이버.observe({ scope: 'window', app: '카카오톡' });
  const 결과 = await 드라이버.act({
    행동: 'click',
    대상: { 창: 9, pid: 77, x: 120, y: 250, 스냅샷: 관측.그림스냅샷 },
  });
  assert.equal(결과.code, 'stale_pixel_snapshot');
  assert.equal(가짜.부른것.some((x) => x.이름 === 'click'), false, '달라진 화면의 옛 좌표를 눌렀다');
});

test('미지원 거절 자기보고는 실제 17개 동사와 같은 진실을 쓴다', async () => {
  const 손 = makeDesktopActTool({ drivers: [{ id: 'fixture' }] });
  const 결과 = await 손.handler({ action: 'teleport' });
  const 문장 = String(결과.userSafeSummary ?? '');
  const 실제동사 = [
    'focus', 'scroll', 'move', 'resize', 'launch', 'quit', 'click', 'type',
    'double_click', 'right_click', 'drag', 'press_key', 'hotkey', 'menu', 'copy', 'paste', 'wait',
  ];
  for (const 동사 of 실제동사) assert.match(문장, new RegExp(`(^|[^a-z_])${동사}([^a-z_]|$)`), 동사);
  assert.doesNotMatch(문장, /창을 앞으로 띄우거나, 내리거나, 옮기거나, 앱을 켜고 끄는 것까지/,
    '실제 능력을 여섯 동사로 축소한 옛 자기보고가 남았다');
});
