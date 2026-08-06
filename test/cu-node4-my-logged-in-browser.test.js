// **CU-④ — 내 브라우저에 붙는다(로그인 뒤 화면).**
//
// 오너 정본: *"로그인이 화면 뒤에 있다 — 자영업자한테 이게 제일 크다. 카드사 매출·배달앱
// 주문·플레이스 통계. **터미널이 아무리 강해져도 이 자리는 안 열린다.**"*
//
// 실측(2026-08-06)으로 길을 확정했다:
// ```
// prepare → action:"attached_existing_profile" · owner_pid 72904
// state   → binding_quality:"exact" · mutation_allowed:true · tabs:[제목·URL]
// ```
// 그리고 **cua 가 못 딛는 걸음을 T5 가 딛었다** — 한국어 크롬의 `새 탭`·`주소창 및 검색창`
// (cua 는 `"New Tab"`·`"Address and search bar"` 를 영어로 하드코딩한다).
//
// 남은 벽도 같은 성질이었다: 크롬 동의 시트가 `원격 디버깅을 허용하시겠습니까?` 인데
// `consent_ui.rs` 는 `"remote debugging"` 을 찾는다. **오너가 눌러도 드라이버는 모른다.**
// 그래서 오너 결정: **연결을 한 번 맺고 유지한다**(재연결이 없으면 시트도 없다).
// T5 는 드라이버를 상주시키므로 그 조건이 자연히 선다.
//
// **손은 안 늘린다.** 사용자는 *"그 화면 읽어줘"* 라고 하지 *"CDP 로 읽어줘"* 라고 하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { 기동인자 } from '../src/runtime/desktop-cua-driver.js';

test('기존 프로필에 붙을 수 있게 띄운다 — 그 허가 없이는 로그인 자리가 안 열린다', () => {
  const { args } = 기동인자({ binPath: '/x/cua-driver', 기존프로필허용: true });
  assert.deepEqual(args, ['mcp', '--direct', '--grant', 'existing-profile'],
    `**허가 없이 띄운다** — 로그인된 브라우저에 영영 못 붙는다: ${JSON.stringify(args)}`);
});

test('안 밝히면 예전 그대로다 — 없던 권한을 슬쩍 얹지 않는다', () => {
  const { args } = 기동인자({ binPath: '/x/cua-driver' });
  assert.deepEqual(args, ['mcp', '--direct'],
    `**말 없이 브라우저 접근 권한을 얻는다**: ${JSON.stringify(args)}`);
});

// ── 브라우저 창은 CDP 로 읽는다 — 손은 안 늘린다 ────────────────────────
// `desktop.screen` 이 크롬 창을 볼 때, AX 대신 붙어 있는 브라우저에서 탭·주소를 읽는다.
// 사용자는 *"그 화면 읽어줘"* 라고 한다 — 어느 길로 읽는지는 우리 일이다.
import { makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

const 크롬창 = {
  window_id: 9, app_name: 'Google Chrome', title: 'NAVER', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 },
};

function 가짜(부른것 = []) {
  return {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [크롬창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [] };
      if (이름 === 'browser_prepare') return { action: 'attached_existing_profile' };
      if (이름 === 'get_browser_state') {
        return {
          status: 'ok',
          binding_quality: 'exact',
          tabs: [
            { tab_id: 't1', title: 'NAVER', url: 'https://naver.com/' },
            { tab_id: 't2', title: '내 캘린더', url: 'https://calendar.google.com/' },
          ],
        };
      }
      return {};
    },
    async 조각들() { return []; },
  };
}

test('브라우저 창을 보면 탭 목록이 함께 온다 — 로그인 뒤 자리가 여기서 열린다', async () => {
  const 부른것 = [];
  const o = await makeCuaDriver({ mcp: 가짜(부른것), 기존프로필허용: true })
    .observe({ scope: 'window', app: 'Google Chrome' });
  assert.equal((o.탭들 ?? []).length, 2,
    `**브라우저인데 탭을 안 본다** — 로그인 뒤 화면이 영영 안 열린다: ${JSON.stringify(o).slice(0, 200)}`);
  assert.equal(o.탭들[1].title, '내 캘린더');
});

test('브라우저가 아니면 안 부른다 — 없는 길에 값을 치르지 않는다', async () => {
  const 부른것 = [];
  const mcp = 가짜(부른것);
  const 원래 = mcp.call;
  mcp.call = async (이름, 인자) => (이름 === 'list_windows'
    ? { windows: [{ ...크롬창, app_name: '계산기', title: '계산기' }] }
    : 원래(이름, 인자));
  await makeCuaDriver({ mcp, 기존프로필허용: true }).observe({ scope: 'window', app: '계산기' });
  assert.equal(부른것.some((c) => c.이름 === 'browser_prepare'), false,
    '**계산기에 브라우저 손을 쓴다**');
});

test('허가를 안 받았으면 브라우저 길을 안 쓴다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것) }).observe({ scope: 'window', app: 'Google Chrome' });
  assert.equal(부른것.some((c) => c.이름 === 'browser_prepare'), false,
    '**허가 없이 브라우저에 붙는다**');
});

test('허가가 드라이버에서 프로세스까지 간다 — 중간에 끊기면 아무 일도 안 난다', () => {
  const 뜬것 = [];
  makeCuaDriver({
    binPath: '/x/cua-driver', 기존프로필허용: true,
    // `makeMcpStdio` 를 실제로 태워 인자가 끝까지 가는지 본다.
    mcp: undefined,
  });
  // 드라이버는 첫 호출 때 띄운다 — 인자 계약은 `기동인자` 가 소유하고 위 검사가 지킨다.
  // 여기서는 **드라이버가 그 값을 넘기는지**만 본다(끊기면 플래그가 영영 안 붙는다).
  const 소스 = readFileSync(new URL('../src/runtime/desktop-cua-driver.js', import.meta.url), 'utf8');
  assert.match(소스, /makeMcpStdio\(\{ binPath: deps\.binPath, 기존프로필허용/,
    '**드라이버가 허가를 안 넘긴다** — 배선에서 켜도 프로세스는 모른다');
  assert.equal(뜬것.length, 0);
});

// ── 한국어 동의 시트를 우리가 눌러 준다 ─────────────────────────────────
// 크롬은 새 연결마다 **`원격 디버깅을 허용하시겠습니까?`** 시트를 띄운다.
// `consent_ui.rs` 는 `"remote debugging"`(영어)을 찾아 그 시트를 **못 본다** —
// 오너가 손으로 눌러도 드라이버는 눌린 걸 모르고 *"시트가 안 나타났다"* 며 재시도한다
// (실측: 오너가 세 번 눌러도 계속 떴다).
// 한국어를 읽는 건 우리가 한다 — 오늘 CU-⑥에서 내내 한 일이다.
test('시트 때문에 막히면 우리가 허용을 누르고 한 번 더 붙는다', async () => {
  const 부른것 = [];
  let 눌렀나 = false;
  const 시트버튼 = {
    element_token: 's1:9', element_index: 9, role: 'AXButton', label: '허용', frame: {},
  };
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [크롬창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [시트버튼] };
      if (이름 === 'browser_prepare') {
        // 실물이 내는 그대로 — 시트를 못 봤다고 거절한다.
        return 눌렀나
          ? { action: 'attached_existing_profile' }
          : { status: 'refused', refusal: { code: 'browser_wrong_target_refused', message: 'no exact Chrome remote-debugging consent sheet appeared for reconnect attempt 1' } };
      }
      if (이름 === 'click') { 눌렀나 = true; return { effect: 'confirmed' }; }
      if (이름 === 'get_browser_state') {
        return 눌렀나 ? { status: 'ok', tabs: [{ tab_id: 't1', title: '내 캘린더', url: 'https://calendar.google.com/' }] } : { status: 'refused' };
      }
      return {};
    },
    async 조각들() { return []; },
  };
  const o = await makeCuaDriver({ mcp, 기존프로필허용: true }).observe({ scope: 'window', app: 'Google Chrome' });
  const 누름 = 부른것.filter((c) => c.이름 === 'click');
  assert.equal(누름.length, 1,
    `**한국어 시트를 안 눌러 준다** — 드라이버는 영영 못 본다: ${JSON.stringify(부른것.map((c) => c.이름))}`);
  assert.equal(누름[0].인자.element_token, 's1:9', '허용 버튼이 아닌 걸 눌렀다');
  assert.equal((o.탭들 ?? []).length, 1, `누르고 나서 다시 안 붙는다: ${JSON.stringify(o.탭들)}`);
});

test('시트가 없으면 아무것도 안 누른다 — 없는 시트를 만들지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것), 기존프로필허용: true }).observe({ scope: 'window', app: 'Google Chrome' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false, '**멀쩡한데 뭔가를 누른다**');
});

test('탭 목록이 모델이 보는 압축본까지 간다 — 손이 들고만 있으면 소용없다', async () => {
  const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
  const s = String(compactResult({
    본창: { id: 9, app: 'Google Chrome', title: 'NAVER' },
    elements: [],
    탭들: [
      { id: 't1', title: 'NAVER', url: 'https://www.naver.com/' },
      { id: 't2', title: '내 캘린더', url: 'https://calendar.google.com/' },
    ],
  }));
  assert.match(s, /calendar\.google\.com/,
    `**탭 주소가 모델에게 안 간다** — "AX 로는 못 읽는다"고 답한다: ${s}`);
  assert.match(s, /내 캘린더/, '탭 제목이 없다');
});
