// ═══════════════════════════════════════════════════════════════════════════
// 브라우저 손이 글자를 친다 + 로그인이 따라온다 (선빨강)
//
// 닫는 문장: *"네이버 열어서 전세사기 검색 결과 알려줘"* 가 **사용자 손 0회**로 끝난다.
//
// 실측(2026-08-11)이 만든 세 개의 빨강:
//   ① 브라우저 손으로는 글자를 못 친다 — `browser.act` enum 이 `['scroll','click']` 뿐이고
//      `type` 은 `coveredBy: desktop.act` 로 이관돼 있다. 그래서 네이버 과업에서 브라우저로
//      열고 **화면 손(픽셀)으로 돌아갔고 승인 카드 2장**이 떴다.
//   ② 로그인이 안 따라온다 — `browser.js` 는 회차마다 `mkdtemp` → `--headless=new` → `rm`.
//      격리용 하나뿐이라 실계정 자리가 없다.
//   ③ 헤드리스가 남는다 — 켠 크롬을 끄는 경로가 프로세스 종료에 안 걸려 있다
//      (실측: 39분 된 것까지 다섯 개).
//
// 비교군 축(문구가 아니라 축):
//   OpenClaw `docs/tools/browser-control.md` — `type`·`fill`·`press` 를 **스냅샷 ref 위에서**
//     친다(좌표가 아니다) · `docs/tools/browser.md` — 격리 프로필과 `profile="user"` **둘 다**
//   Hermes  `tools/toolsets.py` — `browser_type`
//
// **경계는 넓히지 않는다**(헌장 넷 그대로):
//   자동   ref 로 짚은 **보안 칸이 아닌** 입력칸에 글자 넣기 · 검색 칸의 엔터
//   안 연다 보안 칸(비밀번호)·파일 올리기·폼 제출 버튼 · **상대가 있는 칸의 엔터**
//          (그 걸음은 카드를 가진 `desktop.act` 가 그대로 맡는다 — 여기서 우회로를 만들지 않는다)
//   모름   = 안 한다. 요소 종류를 못 읽으면 손이 물러난다(fail-closed)
// ═══════════════════════════════════════════════════════════════════════════
import test from 'node:test';
import assert from 'node:assert/strict';

import * as 브 from '../src/runtime/browser.js';
import { makeBrowserActTool } from '../src/runtime/browser-tool.js';
import { demoDescriptors } from '../src/surface/demo-context.js';

// **선빨강이 한 줄로 뭉치지 않게 한다.** 이름 가져오기(named import)로 받으면 아직 없는
// 수출 하나가 모듈 적재를 통째로 깨뜨려 **빨강 열한 개가 빨강 하나로 보인다** — 무엇이
// 빠졌는지 안 보이고, 고친 뒤에도 무엇이 초록이 됐는지 안 보인다.
const 없는손 = (이름) => () => { throw new Error(`\`${이름}\` 이(가) 아직 없다`); };
const { makeBrowser } = 브;
const 타이핑판정 = 브.타이핑판정 ?? 없는손('타이핑판정');
const 엔터판정 = 브.엔터판정 ?? 없는손('엔터판정');
const 칸종류 = 브.칸종류 ?? 없는손('칸종류');
const 살아있는브라우저수 = 브.살아있는브라우저수 ?? 없는손('살아있는브라우저수');
const 브라우저전부끄기 = 브.브라우저전부끄기 ?? 없는손('브라우저전부끄기');
const 종료훅걸렸나 = 브.종료훅걸렸나 ?? 없는손('종료훅걸렸나');

// ── 가짜 크롬 — 실기기 0. CDP 는 계약이지 구현이 아니다 ──────────────────────
/** 페이지 스크립트의 답. `칸` 을 주면 요소 사실을 그것으로 답한다. */
function 답하기(칸) {
  return (expr) => {
    if (expr.includes('있나: false')) return 칸 ?? { 있나: false };   // 요소 사실 뜨기
    if (expr.includes('.focus(')) return 'ok';                        // 짚기
    if (expr.includes('innerText||""')) return 600;                   // 정착 대기(길이가 안 자란다)
    return 화면();                                                     // 관찰
  };
}

/** 시험은 렌더 정착을 기다릴 필요가 없다 — 기다림은 실기기의 사실이지 계약이 아니다. */
const 빠르게 = { settleMs: 5, maxWaitMs: 30 };

function 가짜크롬({ 평가 = 답하기() } = {}) {
  const 켠것 = []; const 보낸것 = [];
  const launch = (path, args) => {
    const p = { path, args, killed: false, kill() { p.killed = true; } };
    켠것.push(p); return p;
  };
  const fetchImpl = async () => ({ json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1/x' }) });
  const connect = () => ({
    ready: Promise.resolve(),
    async send(method, params) {
      보낸것.push({ method, params });
      if (method === 'Target.createTarget') return { result: { targetId: 't1' } };
      if (method === 'Target.attachToTarget') return { result: { sessionId: 's1' } };
      if (method === 'Runtime.evaluate') return { result: { result: { value: 평가(params.expression) } } };
      return { result: {} };
    },
    close() {},
  });
  return { launch, fetchImpl, connect, 켠것, 보낸것 };
}

/** 화면 한 장 — 관찰이 준 것과 같은 모양. 검색칸 하나와 비밀번호 칸 하나가 있다. */
const 화면 = (over = {}) => ({
  title: '어떤 화면', url: 'https://x.example/s', text: '가'.repeat(600), textTotal: 600,
  scroll: { y: 0, viewport: 500, total: 500 },
  actionable: [],
  ...over,
});

const 칸사실 = {
  검색: { 있나: true, 태그: 'input', type: 'search', role: '', autocomplete: '', 편집가능: false, 읽기전용: false, 보임: true, 폼: { method: 'get', role: '' } },
  일반글자: { 있나: true, 태그: 'input', type: 'text', role: '', autocomplete: '', 편집가능: false, 읽기전용: false, 보임: true, 폼: null },
  비밀번호: { 있나: true, 태그: 'input', type: 'password', role: '', autocomplete: 'current-password', 편집가능: false, 읽기전용: false, 보임: true, 폼: { method: 'post', role: '' } },
  일회용번호: { 있나: true, 태그: 'input', type: 'text', role: '', autocomplete: 'one-time-code', 편집가능: false, 읽기전용: false, 보임: true, 폼: null },
  파일: { 있나: true, 태그: 'input', type: 'file', role: '', autocomplete: '', 편집가능: false, 읽기전용: false, 보임: true, 폼: null },
  체크박스: { 있나: true, 태그: 'input', type: 'checkbox', role: '', autocomplete: '', 편집가능: false, 읽기전용: false, 보임: true, 폼: null },
  대화입력: { 있나: true, 태그: 'div', type: '', role: 'textbox', autocomplete: '', 편집가능: true, 읽기전용: false, 보임: true, 폼: null },
  로그인아이디: { 있나: true, 태그: 'input', type: 'text', role: '', autocomplete: 'username', 편집가능: false, 읽기전용: false, 보임: true, 폼: { method: 'post', role: '' } },
  없음: { 있나: false },
};

// ── ① 선언 — 브라우저 손이 자기 동사를 갖는다 ────────────────────────────────
test('빨강① `browser.act` 가 `type`·`press` 를 자기 동사로 갖는다(글자는 화면 손으로 돌아가지 않는다)', () => {
  const d = demoDescriptors().find((x) => x.id === 'browser.act');
  const enumv = d.schema.parameters.properties.action.enum;
  assert.ok(enumv.includes('type'), `browser.act enum 에 type 이 없다: ${JSON.stringify(enumv)}`);
  assert.ok(enumv.includes('press'), `browser.act enum 에 press 가 없다: ${JSON.stringify(enumv)}`);
  // 동사 목록은 산문이 아니라 `행위` 표에서 생성된다(칸 1 S4) — 표에도 있어야 모델이 안다.
  assert.ok(d.행위?.type?.말, '`type` 의 사용자 말이 없다 — 모델이 그 동사를 알 길이 없다');
  assert.ok(d.행위?.press?.말, '`press` 의 사용자 말이 없다');
  // **이관 부정이 남아 있으면 안 된다.** 손이 실제로 갖게 됐는데 "이 손으로는 안 한다"가
  // 프롬프트에 함께 실리면 모델은 자기 손을 다시 모른다(칸 1 성질 1 의 얼굴).
  const 이관 = (d.limits ?? []).filter((l) => l.동사 === 'type' && l.coveredBy);
  assert.deepEqual(이관, [], '`type` 이 여전히 desktop.act 로 이관돼 있다');
});

// ── ② 경계 — 문구 목록이 아니라 **요소 종류**로 가른다 ───────────────────────
test('빨강② 칸 종류는 요소가 말한다(단어를 세지 않는다)', () => {
  assert.equal(칸종류(칸사실.검색), 'search');
  assert.equal(칸종류(칸사실.일반글자), 'text');
  assert.equal(칸종류(칸사실.비밀번호), 'secure');
  assert.equal(칸종류(칸사실.일회용번호), 'secure', '일회용 비밀번호도 비밀값이다(헌장 ①)');
  assert.equal(칸종류(칸사실.파일), 'file');
  assert.equal(칸종류(칸사실.체크박스), 'unknown', '모르는 요소는 글자칸이 아니다');
  assert.equal(칸종류(칸사실.대화입력), 'text');
});

test('빨강③ 보안 칸에는 손이 물러난다 — 그건 사람이 직접 넣는다(헌장 ①)', () => {
  assert.equal(타이핑판정(칸사실.비밀번호).된다, false);
  assert.equal(타이핑판정(칸사실.비밀번호).이유, 'secure_field');
  assert.equal(타이핑판정(칸사실.일회용번호).된다, false);
  // **모름 = 안 한다.** 요소를 못 읽으면 자동으로 흘리지 않는다.
  assert.equal(타이핑판정(칸사실.없음).된다, false);
  assert.equal(타이핑판정(칸사실.체크박스).된다, false);
  assert.equal(타이핑판정(칸사실.파일).된다, false, '파일 올리기는 이 손이 안 연다');
  // 보안 칸이 아닌 입력칸은 자동이다 — 글자는 이 컴퓨터 밖으로 안 나간다.
  assert.equal(타이핑판정(칸사실.검색).된다, true);
  assert.equal(타이핑판정(칸사실.일반글자).된다, true);
  assert.equal(타이핑판정(칸사실.대화입력).된다, true);
});

test('빨강④ 엔터는 **검색 칸에서만** — 상대가 있는 칸의 엔터는 이 손이 안 연다(헌장 ③)', () => {
  assert.equal(엔터판정(칸사실.검색).된다, true, '검색은 상대가 없다 — 밖으로 나가는 걸음이 아니다');
  assert.equal(엔터판정(칸사실.대화입력).된다, false, '폼도 없는 JS 입력칸 = 상대를 모른다');
  assert.equal(엔터판정(칸사실.대화입력).이유, 'not_search');
  assert.equal(엔터판정(칸사실.로그인아이디).된다, false, 'POST 폼의 엔터는 제출이다');
  assert.equal(엔터판정(칸사실.비밀번호).된다, false);
});

// ── ③ 손 — ref 위에서 친다. 좌표는 없다 ─────────────────────────────────────
test('빨강⑤ ref 로 짚은 칸에 CDP 로 글자를 넣는다(좌표 타이핑은 열지 않는다)', async () => {
  const 크롬 = 가짜크롬({ 평가: 답하기(칸사실.검색) });
  const b = makeBrowser({ browserPath: '/bin/chrome', ...빠르게, ...크롬 });
  const r = await b.type('e1', '전세사기');
  assert.equal(r.typed, true, `못 쳤다: ${JSON.stringify(r)}`);
  const 넣기 = 크롬.보낸것.filter((c) => c.method === 'Input.insertText');
  assert.equal(넣기.length, 1, `Input.insertText 가 안 갔다: ${크롬.보낸것.map((c) => c.method).join(',')}`);
  assert.equal(넣기[0].params.text, '전세사기');
  // 좌표를 안 쓴다 — 마우스로 짚는 길은 이 손에 없다.
  assert.equal(크롬.보낸것.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 0);
  await b.close();
});

test('빨강⑥ 검색 칸에서 엔터를 친다(검색이 끝나야 결과가 온다)', async () => {
  const 크롬 = 가짜크롬({ 평가: 답하기(칸사실.검색) });
  const b = makeBrowser({ browserPath: '/bin/chrome', ...빠르게, ...크롬 });
  const r = await b.press('e1', 'Enter');
  assert.equal(r.pressed, true, `엔터를 못 쳤다: ${JSON.stringify(r)}`);
  const 키 = 크롬.보낸것.filter((c) => c.method === 'Input.dispatchKeyEvent');
  assert.ok(키.length >= 2, `keyDown/keyUp 이 안 갔다: ${키.length}`);
  assert.equal(키[0].params.key, 'Enter');
  await b.close();
});

test('빨강⑦ 손이 물러날 때는 **실패가 아니라 경계**로 말하고 되는 길을 준다', async () => {
  const tool = makeBrowserActTool({
    browser: {
      async type() { return { typed: false, reason: 'secure_field' }; },
      async press() { return { pressed: false, reason: 'not_search' }; },
    },
  });
  const 비번 = await tool.handler({ action: 'type', ref: 'e1', text: 'x' });
  assert.match(비번.userSafeSummary, /비밀번호|보안/, `보안 칸을 왜 안 했는지 안 말한다: ${비번.userSafeSummary}`);
  assert.ok(비번.nextSafeAction, '막다른 답 금지');
  assert.equal(비번.failureState, undefined, '경계는 실패가 아니다');
  const 엔터 = await tool.handler({ action: 'press', ref: 'e1', key: 'Enter' });
  assert.ok(엔터.nextSafeAction, '막다른 답 금지');
});

// ── ④ 프로필 둘 — 격리용과 실계정용 ─────────────────────────────────────────
test('빨강⑧ 프로필이 둘이다 — 기본은 격리(매번 새 자리), 영속은 **같은 자리를 재사용**한다', async () => {
  const 격리 = 가짜크롬({ 평가: () => 화면() });
  const b1 = makeBrowser({ browserPath: '/bin/chrome', ...빠르게, ...격리 });
  await b1.open('https://x.example');
  const 자리1 = (격리.켠것[0].args.find((a) => a.startsWith('--user-data-dir=')) ?? '').slice(16);
  await b1.close();
  await b1.open('https://x.example');
  const 자리2 = (격리.켠것[1].args.find((a) => a.startsWith('--user-data-dir=')) ?? '').slice(16);
  assert.notEqual(자리1, 자리2, '격리 프로필인데 같은 자리를 재사용한다');
  assert.equal(b1.profileKind(), 'isolated');
  await b1.close();

  const 영속 = 가짜크롬({ 평가: () => 화면() });
  const b2 = makeBrowser({ browserPath: '/bin/chrome', profile: 'persistent', profileDir: '/tmp/t5-persist-시험', ...빠르게, ...영속 });
  await b2.open('https://x.example');
  await b2.close();
  await b2.open('https://x.example');
  const 둘 = 영속.켠것.map((p) => p.args.find((a) => a.startsWith('--user-data-dir=')));
  assert.equal(둘[0], 둘[1], '영속 프로필인데 자리가 매번 바뀐다 — 로그인이 안 따라온다');
  assert.equal(둘[0], '--user-data-dir=/tmp/t5-persist-시험');
  assert.equal(b2.profileKind(), 'persistent');
  // 영속은 **헤드리스가 아니다** — 사람이 한 번 로그인해야 남는다.
  assert.ok(!영속.켠것[0].args.includes('--headless=new'), '영속 프로필을 헤드리스로 열면 사람이 로그인할 수 없다');
  await b2.close();
});

test('빨강⑨ 어느 프로필로 봤는지 **영수증에 찍힌다**(사용자가 "로그인된 걸로 봤나"를 알아야 한다)', async () => {
  const tool = makeBrowserActTool({
    browser: {
      profileKind: () => 'isolated',
      async scroll() { return { ...화면(), scrolled: 1, stopped: 'reached_bottom' }; },
    },
  });
  const r = await tool.handler({ action: 'scroll', times: 1 });
  assert.equal(r.result.observation.profile, 'isolated',
    '영수증에 프로필이 없다 — 로그인 상태로 본 화면인지 알 수 없다');
});

// ── ⑤ 켰으면 끈다 ───────────────────────────────────────────────────────────
test('빨강⑩ 켠 크롬은 프로세스가 끝날 때 함께 꺼진다(회차마다 하나씩 새지 않는다)', async () => {
  // **앞 검사가 남긴 것에 기대지 않는다.** 절단 시험에서 드러났다(2026-08-11): 앞 줄이
  // 실패해 손을 못 닫으면 이 줄의 기준값이 흔들려 **엉뚱한 봉인이 함께 빨개진다** —
  // 그러면 절단이 "무엇을 무는지"를 못 가린다.
  브라우저전부끄기();
  const 시작 = 살아있는브라우저수();
  const 크롬 = 가짜크롬({ 평가: () => 화면() });
  const b = makeBrowser({ browserPath: '/bin/chrome', ...빠르게, ...크롬 });
  await b.open('https://x.example');
  assert.equal(살아있는브라우저수(), 시작 + 1, '켠 브라우저가 어디에도 안 적힌다 — 누가 끄나');
  assert.equal(종료훅걸렸나(), true, '프로세스 종료 훅이 없다 — 나가면 크롬이 남는다');
  브라우저전부끄기();
  assert.equal(크롬.켠것[0].killed, true, '나가는데 크롬을 안 죽였다');
  assert.equal(살아있는브라우저수(), 시작, '끈 뒤에도 명부에 남아 있다');
  await b.close();
});

test('빨강⑪ 같은 손을 두 번 불러도 크롬은 하나다(같은 포트에 둘을 띄우지 않는다)', async () => {
  const 크롬 = 가짜크롬({ 평가: () => 화면() });
  const b = makeBrowser({ browserPath: '/bin/chrome', ...빠르게, ...크롬 });
  await Promise.all([b.open('https://x.example'), b.snapshot(), b.snapshot()]);
  assert.equal(크롬.켠것.length, 1, `동시에 부르면 크롬이 ${크롬.켠것.length}개 뜬다`);
  await b.close();
});
