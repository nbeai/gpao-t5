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

// **이 두 검사의 전제가 바뀌었다**(오너 결정 2026-08-07 · 장착을 공식대로).
//
// `--grant existing-profile` 은 **`serve`(데몬) 쪽 인자**다. 예전엔 우리가 `mcp --direct` 로
// 런타임을 직접 소유해서 거기 같이 실을 수 있었는데, 그 `--direct` 가 **호스트 TCC 를
// 상속**하는 것이라 뺐다(이틀간 권한이 흔들린 뿌리). 이제 드라이버가 스스로 데몬을 띄우고
// 우리는 프록시로 붙으므로, 프로필 허가는 기동 인자에 실을 자리가 없다.
//
// **로그인된 브라우저에 붙는 목적은 안 버렸다** — 노드 A ① 을 장착이 선 뒤에 다시 연다.
// 그때 `BROWSER.md` 를 읽고 간다: 우리가 크롬 동의 시트를 직접 누르던 코드도
// *"never click a similar-looking prompt yourself"* 에 걸려 다시 봐야 한다.
test('기동 인자에 데몬 전용 허가를 싣지 않는다 — 조용히 무시되거나 거절된다', () => {
  for (const 밝힘 of [true, false]) {
    const { args } = 기동인자({ binPath: '/x/cua-driver', 기존프로필허용: 밝힘 });
    assert.deepEqual(args, ['mcp'],
      `**데몬 전용 인자를 mcp 에 준다**(밝힘=${밝힘}): ${JSON.stringify(args)}`);
  }
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
// ── **부재 봉인 2**(스윕 2번 (a) · PM 지시 2026-08-09) ──────────────────────
//
// 여기 있던 검사는 *"시트 때문에 막히면 우리가 허용을 누르고 한 번 더 붙는다"* 였다.
// 그 행동을 걷었으므로(도달 불가 코드 — 아래 근거) 같은 자리를 **부재로 뒤집는다.**
// `a1-browser-opens-only-when-asked` 의 부재 봉인과 한 쌍이다 — 그쪽은 발화 있는 경로를,
// 여기는 **드라이버가 거절을 내는 경로**를 막는다(우리가 그 거절을 클릭으로 우회하던 자리).
//
// 근거(프로브 실측 2026-08-09 · 사람 개입 0 · 우리 클릭 0):
//   browser_prepare{existing_profile} → refused / browser_consent_required ·
//   legacy_approval_enabled: false — **시트가 뜨지 않고 요청 자체가 거절된다.**
//   정본 경로는 `--grant existing-profile`(serve) 또는 embedding authorization host.
test('부재 봉인: 붙기가 거절돼도 우리가 승인 UI 를 누르지 않는다', async () => {
  const 부른것 = [];
  const 시트버튼 = { element_token: 's1:9', element_index: 9, role: 'AXButton', label: '허용', frame: {} };
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [크롬창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [시트버튼] };
      // 실물이 내는 그대로 — 거절한다(우리는 이 거절을 우회하지 않는다).
      if (이름 === 'browser_prepare') {
        return { status: 'refused', refusal: { code: 'browser_consent_required', message: 'standard mode requires --grant existing-profile' } };
      }
      if (이름 === 'get_browser_state') return { status: 'refused' };
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자) { return { 구조: await this.call(이름, 인자), 조각: [] }; },
  };
  // 발화가 있어도(문을 딸 명분이 가장 강한 조건) 누르지 않는다.
  await makeCuaDriver({ mcp, 기존프로필허용: true })
    .observe({ scope: 'window', app: 'Google Chrome', 발화: '내 크롬에 열려 있는 탭 알려줘' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false,
    `**거절을 클릭으로 우회한다** — BROWSER.md 가 못박은 그 사고다: ${JSON.stringify(부른것.map((c) => c.이름))}`);
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
