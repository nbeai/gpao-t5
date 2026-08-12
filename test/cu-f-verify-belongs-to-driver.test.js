// **CU F · 됐는지는 드라이버가 판정한다.** 우리가 전후를 추측하지 않는다.
//
// 오늘(2026-08-05) 라이브가 F 의 필요를 바꿔 놓았다. 계획서는 F 를 *"스크린샷"* 으로 적어 두고
// *"A~E 가 서면 무엇이 정말 눈으로만 판단되는지 그때 안다"* 고 미뤘다. 알아낸 것은 둘이다:
//
//   ① **스크린샷은 지금 못 보낸다.** 모델 길은 글자만 나른다(`교환결과` 가 문자열이다).
//      `verify_state` 의 `include_screenshot` 은 *"uninterpreted visual evidence for a
//      multimodal caller"* 인데, 우리 길이 아직 그 caller 가 아니다. 그건 별도 작업이다.
//   ② **정작 급한 것은 확인 계약이었다.** 우리 전후 대조가 오늘만 네 번 틀렸다 —
//      `launch` 를 앞으로 왔나로 재고, 창 관리자가 반영하기 전에 찍고,
//      드라이버가 `refused`·`unverifiable` 로 밝힌 것을 "안 됐다"로 바꿨다.
//
// `verify_state` 는 그 자리를 정확히 채운다:
//   *"Predicate results are satisfied, unsatisfied, or unknown; **unknown never implies
//    success**. Accessibility projections are conservative: absence remains unknown unless
//    the observed search domain is proven exhaustive."*
// 우리가 A14 로 세운 것과 **같은 문장**이고, 게다가 `stable_samples`·`timeout_ms` 로
// **상태가 가라앉을 때까지 기다린다** — 우리가 못 하던 것이다.
//
// 그래서 **판정을 드라이버에게 넘긴다.** 커널은 모델이 낸 기대를 술어로 옮기고 답을 적는다.
// 드라이버가 그 능력이 없으면(네이티브) 예전 전후 대조가 그대로 돈다 — 슬롯은 안 바뀐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDesktopActTool } from '../src/runtime/desktop-act-tool.js';

const 버튼 = { id: 'b7', 토큰: 's1:5', role: 'AXButton', label: '7', isEnabled: true };
const 표시 = { id: 'disp', role: 'AXStaticText', label: '결과', value: '0', isEnabled: true };

function 손세우기({ 판정 = null, 요소들 = [버튼, 표시], 부른것 = [] } = {}) {
  const 드라이버 = {
    id: 'fake',
    status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ frontmost: { name: '계산기' }, windows: [{ id: 1 }], elements: 요소들 }),
    act: () => ({ ok: true }),
  };
  // **능력이 있을 때만 붙인다** — 없는 드라이버도 그대로 돌아야 슬롯이 안 깨진다.
  if (판정) 드라이버.verify = async (기대) => { 부른것.push(기대); return 판정; };
  return makeDesktopActTool({ drivers: [드라이버] });
}

// ── ① 드라이버가 판정하면 그 답을 쓴다 ───────────────────────────────────
test('드라이버가 됐다고 판정하면 우리 전후 추측으로 뒤집지 않는다', async () => {
  const 손 = 손세우기({ 판정: { 판정: 'satisfied', 근거: 'verify_state' } });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.result?.단계, 'goal_verified', `${JSON.stringify(r).slice(0, 200)}`);
  assert.match(String(r.result.확인방법), /verify/, '무엇을 믿고 됐다고 하는지가 없다');
});

test('드라이버가 안 됐다고 판정하면 됐다고 하지 않는다', async () => {
  const 손 = 손세우기({ 판정: { 판정: 'unsatisfied' } });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.진행?.판정, 'unsatisfied');
});

test('드라이버가 모른다고 하면 모른다 — 안 됐다로 바꾸지 않는다', async () => {
  const 손 = 손세우기({ 판정: { 판정: 'unknown' } });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.진행?.판정, 'unknown', `${JSON.stringify(r.진행)}`);
  assert.doesNotMatch(JSON.stringify(r.다음수단 ?? []), /retry/, '모르는 채로 다시 누르라고 한다');
});

// ── ② 무엇을 확인해 달라고 넘기는가 ──────────────────────────────────────
test('모델이 말한 기대를 그대로 넘긴다 — 커널이 새로 지어내지 않는다', async () => {
  const 부른것 = [];
  const 손 = 손세우기({ 판정: { 판정: 'satisfied' }, 부른것 });
  await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(부른것.length, 1, '판정을 안 맡겼다');
  assert.equal(부른것[0].값, '7', `기대한 값이 안 갔다: ${JSON.stringify(부른것[0])}`);
  // 요소는 **관찰이 준 신분**으로 짚는다 — 모델이 준 id 만으로는 드라이버가 못 찾는다.
  assert.equal(부른것[0].라벨, '결과', `요소 신분이 안 갔다: ${JSON.stringify(부른것[0])}`);
  assert.equal(부른것[0].역할, 'AXStaticText');
});

test('기대가 없으면 판정을 맡기지 않는다 — 없는 것을 확인해 달라고 하지 않는다', async () => {
  const 부른것 = [];
  const 손 = 손세우기({ 판정: { 판정: 'satisfied' }, 부른것 });
  await 손.handler({ action: 'focus', app: '계산기' });
  assert.equal(부른것.length, 0);
});

// ── ③ 능력이 없는 드라이버도 그대로 돈다 ─────────────────────────────────
test('판정 능력이 없는 드라이버는 예전 길로 간다 — 슬롯이 안 깨진다', async () => {
  const 손 = 손세우기({ 판정: null, 요소들: [버튼, { ...표시, value: '7' }] });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.result?.단계, 'goal_verified', '전후 대조 길이 막혔다');
});

test('판정하다 터져도 손은 안 터진다 — 모른다로 떨어진다', async () => {
  const 드라이버 = {
    id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
    observe: () => ({ frontmost: { name: 'x' }, windows: [], elements: [버튼, 표시] }),
    act: () => ({ ok: true }),
    verify: async () => { throw new Error('안 보임'); },
  };
  const 손 = makeDesktopActTool({ drivers: [드라이버] });
  const r = await 손.handler({ action: 'click', 대상: 버튼, 기대: { 요소: 'disp', 값: '7' } });
  assert.equal(r.진행?.판정, 'unknown', `터진 판정을 성공으로 읽었다: ${JSON.stringify(r).slice(0, 180)}`);
});

// ── ④ cua 드라이버가 verify_state 를 실제로 부른다 ───────────────────────
// 계약만 세우고 드라이버가 안 부르면 죽은 계약이다.
test('cua 드라이버가 verify_state 를 부르고 답을 그대로 옮긴다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { frontmost: { name: '계산기', pid: 7 }, windows: [{ id: 3, pid: 7 }] };
      // 실물 응답 칸은 **`status`** 다 — `result` 로 읽다가 전부 unknown 이 됐다(실측).
      if (이름 === 'verify_state') return { predicates: [{ index: 0, status: 'satisfied' }], status: 'satisfied', samples: 2 };
      return {};
    },
  };
  const d = makeCuaDriver({ mcp });
  const r = await d.verify({ 값: '7', 라벨: '결과', 역할: 'AXStaticText', 창: 3 });
  assert.equal(r.판정, 'satisfied', `답을 못 옮겼다: ${JSON.stringify(r)}`);
  const 부름 = 부른것.find((c) => c.이름 === 'verify_state');
  assert.ok(부름, '**verify_state 를 안 불렀다** — 계약이 죽어 있다');
  const 술어 = 부름.인자?.expect?.[0]?.element ?? {};
  assert.equal(술어.value_equals, '7', `기대 값이 술어로 안 갔다: ${JSON.stringify(부름.인자)}`);
  assert.equal(술어.selector?.label_contains, '결과');
  assert.equal(술어.selector?.role, 'AXStaticText');
  // **가라앉을 때까지 기다린다** — 우리 전후 대조가 못 하던 것이고, 오늘 오판의 원인이다.
  assert.ok(Number(부름.인자?.stable_samples) >= 2, '안정 표본을 안 요구했다');
  assert.ok(Number(부름.인자?.timeout_ms) > 0, '기다릴 시간을 안 줬다');
  // 그림은 아직 못 보낸다(모델 길이 글자만 나른다) — 괜히 받아서 비용만 쓰지 않는다.
  assert.notEqual(부름.인자?.include_screenshot, true, '못 쓰는 그림을 받아 온다');
});

test('cua 가 모른다고 하면 모른다로 옮긴다 — 성공으로 승격하지 않는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') return { frontmost: { pid: 7 }, windows: [{ id: 3, pid: 7 }] };
      if (이름 === 'verify_state') return { status: 'unknown', predicates: [{ status: 'unknown', unknown_reason: 'not_exhaustive' }] };
      return {};
    },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 값: '7', 라벨: '결과', 창: 3 });
  assert.equal(r.판정, 'unknown');
});

test('신분이 없으면 부르지 않는다 — 아무 요소나 확인해 달라고 하지 않는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { frontmost: { pid: 7 }, windows: [{ id: 3, pid: 7 }] };
      return {};
    },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 값: '7' });
  assert.equal(r.판정, 'unknown');
  assert.equal(부른것.some((c) => c.이름 === 'verify_state'), false, '**라벨도 없이 확인을 시켰다**');
});

test('pid 와 창 id 를 둘 다 보낸다 — 스키마가 둘 다 필수다(실측: 하나 빠뜨려 invalid_arguments)', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      // 날것 창 목록의 키는 `window_id` 다 — `id` 만 보다가 실제로 빠뜨렸다.
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 14346, pid: 41816 }] };
      if (이름 === 'verify_state') return { result: 'satisfied' };
      return {};
    },
  };
  await makeCuaDriver({ mcp }).verify({ 값: '7', 라벨: '결과', 창: 14346 });
  const 인자 = 부른것.find((c) => c.이름 === 'verify_state')?.인자 ?? {};
  assert.equal(인자.pid, 41816, `pid 가 안 갔다: ${JSON.stringify(인자)}`);
  assert.equal(인자.window_id, 14346, `**창 id 가 안 갔다** — invalid_arguments 로 떨어진다: ${JSON.stringify(인자)}`);
});

test('창을 못 찾으면 부르지 않는다 — 잘못 불러 놓고 "확인 못 했다"고 하지 않는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { windows: [] };
      return {};
    },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 값: '7', 라벨: '결과', 창: 1 });
  assert.equal(r.판정, 'unknown');
  assert.equal(r.근거, 'no_window');
  assert.equal(부른것.some((c) => c.이름 === 'verify_state'), false);
});

test('값을 안 말했으면 "있느냐"를 잰다 — 빈 값이냐를 묻지 않는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const 부른것 = [];
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 3, pid: 7 }] };
      if (이름 === 'verify_state') return { status: 'satisfied' };
      return {};
    },
  };
  await makeCuaDriver({ mcp }).verify({ 라벨: '7', 역할: 'AXButton', 창: 3 });
  const 술어 = 부른것.find((c) => c.이름 === 'verify_state')?.인자?.expect?.[0]?.element ?? {};
  assert.equal(술어.exists, true, `**값 없이 value_equals 를 보낸다** — 늘 안 맞는다: ${JSON.stringify(술어)}`);
  assert.equal(술어.value_equals, undefined);
});

test('못 판정한 이유를 그대로 옮긴다 — 왜 모르는지가 사라지면 다음 수를 못 정한다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 3, pid: 7 }] };
      if (이름 === 'verify_state') return { status: 'unknown', predicates: [{ status: 'unknown', unknown_reason: 'not_exhaustive' }] };
      return {};
    },
  };
  const r = await makeCuaDriver({ mcp }).verify({ 값: '7', 라벨: '결과', 창: 3 });
  assert.equal(r.판정, 'unknown');
  assert.equal(r.근거, 'not_exhaustive');
});

// ── ⑤ 안 나간 것을 나갔다고 하지 않는다 ─────────────────────────────────
// 라이브(2026-08-05, 사진 대조로 확정): 모델이 클릭 인자에 토큰만 베껴 왔다.
// cua `click` 은 **pid 가 필수**라 `"Missing required integer field: pid"` 로 **거절**했다.
// 우리는 그걸 결과로 받아 *"했어요. 다만 확인은 못 했어요"* 라고 말했다 —
// **실행이 안 나갔는데 나갔다고 한 것**이고, 계산기 화면이 `778` 그대로였던 이유다.
//
// 고치는 자리가 둘이다:
//   ① **창·pid 는 관찰이 아는 사실이다** — 모델이 베끼게 하지 않고 손이 붙인다.
//   ② **"인자가 모자라다"는 어떤 손에서도 결과가 아니다** — 한 자리에서 막는다.
//      (`focus` 에만 세웠다가 `click` 에서 같은 병이 다시 났다. 세 번째다.)
test('클릭에 창·pid 를 붙여 보낸다 — 모델이 베끼게 하지 않는다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  const 부른것 = [];
  const 버튼 = { id: 'b3', 토큰: 's1:29', 스냅샷: 's1', role: 'AXButton', label: '3', isEnabled: true, 창: 14346, pid: 41816 };
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름, 인자) {
      부른것.push({ 이름, 인자 });
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 14346, pid: 41816 }] };
      if (이름 === 'verify_state') return { status: 'unknown' };
      return { ok: true };
    },
  };
  const d = makeCuaDriver({ mcp });
  const 원래관찰 = d.observe;
  d.observe = async () => ({ frontmost: { name: '계산기' }, windows: [{ id: 14346, pid: 41816 }], elements: [버튼] });
  void 원래관찰;
  const 손 = makeDesktopActTool({ drivers: [d] });
  // 모델은 토큰·라벨만 베껴 왔다 — 창·pid 가 없다.
  await 손.handler({ action: 'click', 대상: { id: 'b3', label: '3', 토큰: 's1:29' } });
  const 누름 = 부른것.find((c) => c.이름 === 'click');
  assert.ok(누름, '클릭을 안 불렀다');
  assert.equal(누름.인자?.pid, 41816, `**pid 가 안 갔다** — cua 가 거절하고 우리는 "했어요"라고 한다: ${JSON.stringify(누름.인자)}`);
  assert.equal(누름.인자?.window_id, 14346, '창이 안 갔다');
});

test('"인자가 모자라다"는 어떤 손에서도 결과가 아니다 — 한 자리에서 막는다', async () => {
  const { makeMcpStdio } = await import('../src/runtime/desktop-cua-driver.js');
  // 실물이 그렇게 답한다: `[{type:'text', text:'Missing required integer field: pid'}]`
  const 가짜spawn = () => { throw new Error('안 띄운다'); };
  const io = makeMcpStdio({ binPath: '/x', spawnImpl: 가짜spawn });
  assert.equal(typeof io.call, 'function');
  // 실제 거절 판정은 `거절인가` 가 한 자리에서 한다.
  // 읽는 자리는 **한 모듈**이다(계열 B) — 드라이버도 손도 여기만 본다.
  const { 거절인가 } = await import('../src/runtime/desktop-driver-answer.js');
  assert.equal(거절인가([{ type: 'text', text: 'Missing required integer field: pid' }]), true);
  assert.equal(거절인가({ effect: 'refused', code: 'window_target_not_found' }), true);
  assert.equal(거절인가({ ok: true }), false);
  assert.equal(거절인가({ delivery: { mode: 'background' }, effect: 'unverifiable' }), false,
    '**모른다를 거절로 본다** — 눌린 것을 안 눌렀다고 하게 된다');
});

// ── ⑥ 토큰과 스냅샷은 짝이다 ─────────────────────────────────────────────
// 사진 대조로 잡았다(2026-08-05). 화면이 `14` 그대로인데 T5 는 *"했어요"* 라고 했다.
//
// 원인: 관찰할 때마다 **새 스냅샷**이 생긴다. 손은 A02 를 보려고 한 번 보고,
// 전 상태를 재려고 또 한 번 봤다. 그 사이 앞서 잡아 둔 토큰이 낡았고,
// **낡은 토큰으로 누르면 아무 데도 안 눌리는데** 드라이버는 `background`·`unverifiable`
// 을 돌려준다 — 우리 눈에는 "보냈다"로 보인다.
//
// 그래서 **마지막으로 본 화면 하나로 모은다.** 누를 때 쓰는 신분은 그 관찰의 것이어야 한다.
test('마지막으로 본 화면의 신분으로 누른다 — 토큰만 낡으면 아무 데도 안 눌린다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  let 회차 = 0;
  const 넘긴것 = [];
  const 요소 = (스냅샷) => ({
    id: 'b9', 토큰: `${스냅샷}:7`, 스냅샷, role: 'AXButton', label: '9',
    isEnabled: true, 창: 14346, pid: 41816,
  });
  const 손 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      // 볼 때마다 새 스냅샷 — 실물이 그렇다.
      observe: () => { 회차 += 1; return { frontmost: { name: '계산기' }, windows: [{ id: 14346, pid: 41816 }], elements: [요소(`s${회차}`)] }; },
      // **누를 때의 회차**를 함께 적는다 — 뒤에 관찰이 더 일어나므로 마지막 총계로 재면 틀린다.
      act: (req) => { 넘긴것.push({ ...req.대상, 누를때회차: 회차 }); return { delivery: { mode: 'background' }, effect: 'unverifiable' }; },
      verify: async () => ({ 판정: 'unknown' }),
    }],
  });
  // 모델은 **첫 관찰**의 토큰을 들고 온다.
  await 손.handler({ action: 'click', 대상: { id: 'b9', label: '9', 토큰: 's0:7' } });
  const 쓴것 = 넘긴것[0] ?? {};
  assert.equal(String(쓴것.토큰 ?? '').split(':')[0], String(쓴것.스냅샷 ?? ''),
    `**토큰과 스냅샷이 다른 회차다**: ${JSON.stringify(쓴것)}`);
  assert.notEqual(쓴것.토큰, 's0:7', '낡은 토큰을 그대로 썼다');
  // **마지막 회차여야 한다.** 짝만 맞으면 되는 게 아니다 — 앞 회차 스냅샷은 이미 지나갔고,
  // 그 토큰으로 누르면 아무 데도 안 눌린다(사진으로 확인한 그 자리다).
  assert.equal(쓴것.토큰, `s${쓴것.누를때회차}:7`, `**마지막으로 본 화면이 아니다** — 지나간 스냅샷이다: ${JSON.stringify(쓴것)}`);
});

test('드라이버가 거절하면 안 나간 것으로 적는다 — "했어요"가 나가지 않는다', async () => {
  const { makeDesktopActTool } = await import('../src/runtime/desktop-act-tool.js');
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') {
        return { frontmost: { name: '계산기', pid: 7 }, windows: [{ window_id: 3, pid: 7 }] };
      }
      if (이름 === 'get_window_state') {
        return { elements: [{ id: 'b9', element_token: 's1:7', snapshot_id: 's1', role: 'AXButton', label: '9', enabled: true }] };
      }
      // 실물이 이렇게 답한다 — 인자가 모자라면 **결과가 아니라 거절**이다.
      if (이름 === 'click') return [{ type: 'text', text: 'Missing required integer field: pid' }];
      return {};
    },
  };
  const 손 = makeDesktopActTool({ drivers: [makeCuaDriver({ mcp })] });
  const r = await 손.handler({ action: 'click', 대상: { id: 'b9', label: '9', 토큰: 's1:7' } });
  assert.notEqual(r.result?.단계, 'goal_verified');
  // 계약 이행(F-53): 나갔고 거절당했다 — 'refused' 가 참이다. "했어요" 금지는 위 줄이 지킨다.
  assert.equal(r.진행?.판정, 'refused', `거절이 거절로 안 적혔다: ${JSON.stringify(r.진행)}`);
});

test('드라이버 자신도 거절을 결과로 안 흘린다 — 손과 겹쳐 막는다', async () => {
  const { makeCuaDriver } = await import('../src/runtime/desktop-cua-driver.js');
  const mcp = {
    async call(이름) {
      if (이름 === 'get_accessibility_tree') return { windows: [{ window_id: 3, pid: 7 }] };
      if (이름 === 'click') return [{ type: 'text', text: 'Missing required integer field: pid' }];
      return {};
    },
  };
  const d = makeCuaDriver({ mcp });
  // 계약 이행(F-53 2026-08-09): 던지면 위층 거절 갈래가 영영 못 보고 일반 catch 가 사유를
  // 삼킨다(발신 시험 3연속 그 경로). 이제 **네 갈래 모양**(effect:'refused')으로 돌아온다 —
  // 이 검사의 불변식("결과처럼 흘리지 않는다")은 그 모양이 지킨다: 거절인가() 가 참이면
  // 손은 그것을 "했어요"로 읽을 수 없다.
  const r = await d.act({ 행동: 'click', 대상: { 토큰: 's1:1', 창: 3, pid: 7 } });
  assert.equal(r?.effect, 'refused', `거절이 결과처럼 흘렀다: ${JSON.stringify(r).slice(0, 120)}`);
  assert.match(String(r?.code ?? ''), /Missing required/, '사유가 사라졌다 — 원인 확정을 막는다');
});
