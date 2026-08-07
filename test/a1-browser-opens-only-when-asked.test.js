// **노드 A ① — 로그인해 둔 브라우저를 기본으로 연다. 다만 시킨 자리에서만 문을 딴다.**
//
// 오너 지시(2026-08-07 · PM 전달): `GPAO_T5_BROWSER_PROFILE` 을 **기본 켬**.
// CU-④ 로 만든 것이 진짜인데 사장님이 켜면 없다 — 오늘 아침 `GPAO_T5_CUA_BIN` 과 똑같은
// 모양이고 **오늘 다섯 번째 같은 병**이다(만든 것과 닿은 것). 그리고 사장님이 환경변수
// 이름을 알아야 하는 것 자체가 비전 위반이다 — *"API·MCP·CLI·환경변수 같은 말을 알고
// 싶어 하지 않는다."* 끄는 길(`=0`)은 남긴다. **기본값만 뒤집는다.**
//
// ── 함께 걸어야 할 조건 ─────────────────────────────────────────────────
// 크롬은 재연결마다 *"원격 디버깅을 허용하시겠습니까?"* 시트를 띄우고, cua 는 그 시트를
// 못 읽는다(`consent_ui.rs` 가 영어 `"remote debugging"` 을 찾는다). **그래서 T5 가 누른다.**
// 기본으로 켜면 그 누름이 self-grant 모양이 되고 `BUTLER §B` 가 금지한 자리다.
//
// **가르는 선은 발화다.**
// ```
// 사장님이 지금 브라우저·그 화면 이야기를 했다  →  눌러도 된다.  시킨 일을 하는 것이다
// 사장님이 딴 이야기를 하고 있다               →  안 누른다.  T5 가 스스로 얻는 것이 된다
// ```
// 한 번 붙으면 유지하는 것은 오너 결정이라 그대로다. **유지는 "다시 안 물어봐도 된다"이지
// "언제든 봐도 된다"가 아니다.** 그리고 헌장에 다섯째 승인 질문을 만들지 않는다 —
// *"로그인해 둔 크롬을 봐도 될까요?"* 를 매번 묻는 건 이 결정의 반대편이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 기동인자, makeCuaDriver } from '../src/runtime/desktop-cua-driver.js';

// **기본 켬을 되돌렸다**(오너 지시 2026-08-07 · `BROWSER.md` 를 읽고).
//
// 우리가 크롬 동의 시트를 직접 누르는 코드가 있는데 문서가 못박아 금지한다 —
// *"never click a similar-looking prompt yourself."* 드라이버가 거부하는 것은 못해서가
// 아니라 **엉뚱한 것을 승인하는 사고를 막으려고 일부러** 그러는 것이다.
// 기본 켬은 그 우회로를 사장님이 켜자마자 열어 두는 것이었다.
//
// 아래 **발화 조건**은 그대로 둔다 — 켜져 있을 때 *언제* 누르는가는 여전히 지켜야 한다.
test('밝힐 때만 켠다 — 문서가 금지한 우회로를 기본값으로 열지 않는다', async () => {
  const 소스 = await import('node:fs').then((fs) => fs.readFileSync(
    new URL('../src/surface/live-context.js', import.meta.url), 'utf8',
  ));
  assert.match(소스, /GPAO_T5_BROWSER_PROFILE === '1'/,
    '**밝히지 않아도 켜진다** — 우리가 직접 시트를 누르는 경로가 기본으로 열린다');
});

// **장착이 바뀌면서 이 검사의 자리도 바뀌었다**(2026-08-07).
// `--grant existing-profile` 은 `serve` 쪽 인자인데 우리는 이제 데몬을 직접 안 띄운다 —
// `mcp` 가 드라이버 자신의 데몬에 프록시한다. 그래서 기동 인자에는 프로필 허가가 없다.
// **브라우저 프로필 붙이기는 장착이 선 뒤에 다시 본다**(노드 A ① 재개).
test('기동 인자에 프로필 허가가 안 붙는다 — 그건 이제 데몬 쪽 이야기다', () => {
  const { args } = 기동인자({ binPath: '/x/cua-driver', 기존프로필허용: true });
  assert.ok(!args.includes('--grant'),
    `**데몬 인자를 mcp 에 준다** — 조용히 무시되거나 거절된다: ${JSON.stringify(args)}`);
  assert.ok(!args.includes('--direct'),
    `**호스트 TCC 를 상속한다**: ${JSON.stringify(args)}`);
});

// ── 발화 안에서만 문을 딴다 ─────────────────────────────────────────────
const 크롬창 = {
  window_id: 9, app_name: 'Google Chrome', title: 'NAVER', pid: 77,
  is_on_screen: true, z_index: 1, bounds: { x: 0, y: 0, width: 1200, height: 800 },
};
const 시트버튼 = { element_token: 's1:9', element_index: 9, role: 'AXButton', label: '허용', frame: {} };

function 가짜(부른것 = []) {
  let 눌렀나 = false;
  return {
    부른것,
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'list_windows') return { windows: [크롬창] };
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      if (이름 === 'get_window_state') return { snapshot_id: 's1', elements: [시트버튼] };
      if (이름 === 'browser_prepare') {
        return 눌렀나 ? { action: 'attached_existing_profile' }
          : { status: 'refused', refusal: { code: 'browser_wrong_target_refused' } };
      }
      if (이름 === 'click') { 눌렀나 = true; return { effect: 'confirmed' }; }
      if (이름 === 'get_browser_state') {
        return 눌렀나 ? { status: 'ok', tabs: [{ tab_id: 't1', title: 'NAVER', url: 'https://naver.com/' }] } : { status: 'refused' };
      }
      return {};
    },
    async 조각들() { return []; },
    async 구조와조각(이름, 인자) { return { 구조: await this.call(이름, 인자), 조각: [] }; },
  };
}

const 보기 = async (발화, 부른것) => makeCuaDriver({ mcp: 가짜(부른것), 기존프로필허용: true })
  .observe({ scope: 'window', app: 'Google Chrome', 발화 });

test('브라우저 이야기를 했으면 시트를 눌러 준다 — 시킨 일을 하는 것이다', async () => {
  for (const 말 of ['내 크롬에 열려 있는 탭 알려줘', '브라우저에 뭐 떠 있어?',
    '지금 보고 있는 사이트 주소 뭐야', '네이버 화면 좀 읽어줘']) {
    const 부른것 = [];
    const o = await 보기(말, 부른것);
    assert.ok(부른것.some((c) => c.이름 === 'click'),
      `**시킨 일을 안 한다** — 사장님이 "${말}" 이라고 했는데 시트를 안 눌러 영영 못 붙는다`);
    assert.equal((o.탭들 ?? []).length, 1, `누르고 나서 안 붙는다: ${JSON.stringify(o.탭들)}`);
  }
});

test('딴 이야기 중이면 안 누른다 — 유지는 "언제든 봐도 된다"가 아니다', async () => {
  for (const 말 of ['지난달 정산 파일 정리해줘', '계산기 화면에 뭐라고 나와 있어?',
    '카톡 대화창 읽어줘', '오늘 날씨 어때']) {
    const 부른것 = [];
    await 보기(말, 부른것);
    assert.equal(부른것.some((c) => c.이름 === 'click'), false,
      `**T5 가 스스로 문을 딴다** — 사장님은 "${말}" 이라고 했다(BUTLER §B self-grant)`);
  }
});

test('발화를 모르면 안 누른다 — 모르는 것을 허락으로 읽지 않는다', async () => {
  const 부른것 = [];
  await makeCuaDriver({ mcp: 가짜(부른것), 기존프로필허용: true })
    .observe({ scope: 'window', app: 'Google Chrome' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false,
    '**발화가 없는데 누른다** — 자동 실행·예약에서 스스로 문을 딴다');
});

test('이미 붙어 있으면 시트가 없다 — 매번 묻지 않는다(헌장에 다섯째를 만들지 않는다)', async () => {
  const 부른것 = [];
  const mcp = 가짜(부른것);
  const 원래 = mcp.call.bind(mcp);
  mcp.call = async (이름, 인자) => (이름 === 'browser_prepare'
    ? { action: 'attached_existing_profile' } : 원래(이름, 인자));
  const d = makeCuaDriver({ mcp, 기존프로필허용: true });
  await d.observe({ scope: 'window', app: 'Google Chrome', 발화: '지난달 정산 정리해줘' });
  assert.equal(부른것.some((c) => c.이름 === 'click'), false, '멀쩡한데 누른다');
});

// ── 발화가 손까지 실제로 간다 ───────────────────────────────────────────
// **이 배선이 끊기면 조건이 늘 거짓이 되어 영영 안 붙는다.** 오늘 같은 병을 다섯 번 봤다 —
// 함수는 옳은데 인자가 안 채워져서(`connectedTools`) 가르침이 한 번도 안 실린 그 모양이다.
import { makeDesktopTool } from '../src/runtime/desktop-tool.js';

test('실행 문맥의 발화가 드라이버까지 간다 — 끊기면 조건이 늘 거짓이다', async () => {
  let 받은것 = null;
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'cua', status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
      observe: async (a) => { 받은것 = a; return { windows: [], frontmost: { name: 'X' } }; },
    }],
  });
  await 손.handler({ scope: 'window', app: 'Google Chrome' }, { currentRequest: '내 크롬 탭 알려줘' });
  assert.equal(받은것?.발화, '내 크롬 탭 알려줘',
    `**발화가 드라이버에 안 간다** — 동의 시트를 영영 못 누른다: ${JSON.stringify(받은것)}`);
});

test('문맥이 없어도 안 터진다 — 발화 없는 경로(자동 실행)가 여전히 돈다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'cua', status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
      observe: async () => ({ windows: [], frontmost: { name: 'X' } }),
    }],
  });
  const r = await 손.handler({ scope: 'app' });
  assert.ok(r, '문맥 없이 부르면 터진다');
});

// ── 창 목록에서 멈추지 않는다 ───────────────────────────────────────────
// 라이브(2026-08-07): *"내 크롬에 열려 있는 탭 알려줘"* → T5 가 창 목록만 보고 답했다.
// ```
// 원장  "지금 창 9개가 떠 있어요 — … Google Chrome('새 탭') …"
// 답    "크롬 창 제목이 '새 탭'이에요. 탭 목록은 macOS 가 창 제목만 보여줘서 안 드러나요."
// ```
// `browser_prepare` 가 **한 번도 안 불렸다.** 창 목록으로 답이 되니 거기서 멈춘 것이다.
// 탭은 그 창을 지목해서 봐야 나온다(CDP) — **모델은 그걸 모른다.**
//
// 오늘 아침 창 목록에 이름을 넣은 수정이 여기선 덜 파고들게 만들었다. 고치는 길은 같다:
// **길을 준다.** 창 목록에 브라우저가 있으면 `다음수단` 으로 그 창을 가리킨다.
test('창 목록에 브라우저가 있으면 탭까지 가는 길을 준다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'cua', status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
      observe: async () => ({
        frontmost: { name: 'Finder' },
        windows: [
          { id: 1, app: 'Google Chrome', title: '새 탭', 보임: true },
          { id: 2, app: '카카오톡', title: '카카오톡', 보임: true },
        ],
      }),
    }],
  });
  const r = await 손.handler({ scope: 'screen' }, { currentRequest: '내 크롬에 열려 있는 탭 알려줘' });
  const 길 = JSON.stringify(r.result?.다음수단 ?? []);
  assert.match(길, /새 탭/,
    `**탭까지 가는 길이 없다** — 모델이 창 목록에서 멈춰 "탭은 안 드러나요"로 답한다: ${길}`);
  assert.match(길, /창제목/, `창을 지목하는 법을 안 준다: ${길}`);
});

test('브라우저가 없으면 그 길을 안 준다 — 없는 것을 가리키지 않는다', async () => {
  const 손 = makeDesktopTool({
    drivers: [{
      id: 'cua', status: () => ({ connected: true, permissions: { accessibility: 'granted' } }),
      observe: async () => ({
        frontmost: { name: '계산기' },
        windows: [{ id: 1, app: '계산기', title: '계산기', 보임: true }],
      }),
    }],
  });
  const r = await 손.handler({ scope: 'screen' }, { currentRequest: '계산기 화면 읽어줘' });
  assert.doesNotMatch(JSON.stringify(r.result?.다음수단 ?? []), /탭/,
    '브라우저가 없는데 탭 이야기를 한다');
});
