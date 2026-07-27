// P2-10 · 브라우저 표면 — **URL 읽기로 닿지 않는 화면을 실제로 본다.**
//
// 네이버 전용 기능이 아니다. 이 파일에 사이트 이름은 fixture 로도 안 넣는다 —
// 검사하는 것은 **화면의 일반 구조**뿐이다: 무엇을 봤나 · 얼마나 못 봤나 · 무엇을 더 열 수 있나.
//
// 실제 브라우저를 띄우는 검사는 여기 없다(게이트 5초 기준선). 브라우저를 띄우는 확인은 라이브로 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { observationFacts, makeBrowserObserveTool, makeBrowserActTool } from '../src/runtime/browser-tool.js';
import { findBrowserSync } from '../src/runtime/browser.js';
import { demoDescriptors, demoEnv, demoTools } from '../src/surface/demo-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';

const view = (over = {}) => ({
  title: '어떤 화면', url: 'https://x.example/page', text: '가'.repeat(600), textTotal: 1000,
  scroll: { y: 0, viewport: 500, total: 5000 },
  actionable: [
    { ref: 'e1', role: 'tab', text: '첫째 탭' },
    { ref: 'e2', role: 'tab', text: '둘째 탭' },
    { ref: 'e3', role: 'button', text: '더보기', expanded: 'false' },
    { ref: 'e4', role: 'link', text: '어떤 링크', href: 'https://x.example/other' },
  ],
  ...over,
});

// ── 본 범위 / 못 본 범위 ────────────────────────────────────────────────
// 본 범위는 **글자 기준**이다. 픽셀로 재면 "1%만 봤다"면서 문서 전체를 설명하는 모순이 난다
// (라이브 실측 2026-07-27 — innerText 는 화면에 보이는 만큼이 아니라 DOM 전체를 준다).
test('본 범위는 글자 기준이다(화면 픽셀이 아니라)', () => {
  const f = observationFacts(view());
  assert.equal(f.seen.chars, 600);
  assert.equal(f.seen.percent, 60, '600/1000 자를 받았다');
  assert.equal(f.unseen.chars, 400, '상한에서 잘린 몫');
  assert.equal(f.moreBelow, true, '화면 아래는 별개 사실 — 더 내리면 새로 불러올 수 있다');
});

test('글을 다 받았으면 100%, 화면 끝까지 갔으면 더 없다고 말한다(둘은 다른 사실)', () => {
  const f = observationFacts(view({ text: '가'.repeat(1000), scroll: { y: 4500, viewport: 500, total: 5000 } }));
  assert.equal(f.seen.percent, 100, '글은 다 받았다');
  assert.equal(f.unseen.chars, 0);
  assert.equal(f.moreBelow, false, '화면도 끝까지 갔다 — 없는 미확인 영역을 지어내지 않는다');
});

test('더 열 수 있는 것은 **누를 수 있는 것과 같은 집합**이다(못 누를 걸 보여주면 거짓말)', () => {
  const f = observationFacts(view());
  assert.deepEqual(f.canOpen.map((c) => c.kind), ['tab', 'tab', 'expander']);
  assert.ok(!f.canOpen.some((c) => c.text === '어떤 링크'), '링크는 누르지 않는다 — 주소로 여는 게 더 정직하다');
});

// ── 안전은 구조로 좁혔다(단어 목록이 아니라 역할로) ──────────────────────
test('탭·더보기가 아닌 것을 누르면 실패가 아니라 **경계**로 말한다', async () => {
  const tool = makeBrowserActTool({
    browser: { async click() { return { clicked: false, reason: 'not_observational' }; } },
  });
  const r = await tool.handler({ action: 'click', ref: 'e9' });
  assert.match(r.userSafeSummary, /탭이나 더보기가 아니라서/);
  assert.ok(r.nextSafeAction, '막다른 답 금지');
  assert.equal(r.failureState, undefined, '경계는 실패가 아니다');
});

test('브라우저가 없으면 없다고 말하고 되는 길을 준다(능력 부재는 실패가 아니다)', async () => {
  const r = await makeBrowserObserveTool({}).handler({ action: 'open', url: 'https://x.example' });
  assert.match(r.userSafeSummary, /브라우저를 찾지 못했어요/);
  assert.match(r.nextSafeAction, /주소를 주시면/, '되는 기능을 못 한다고 하지 않는다');
});

test('본 화면은 출처가 남는다(봤다고 주장하려면 근거가 있어야 한다)', async () => {
  const tool = makeBrowserObserveTool({ browser: { async open() { return view(); } } });
  const r = await tool.handler({ action: 'open', url: 'https://x.example/page' });
  assert.equal(r.sources[0].sourceUrl, 'https://x.example/page');
  assert.equal(r.result.surfaceAction, 'browser_open', '사후 기록(P2-9 와 같은 계약)');
  assert.match(r.nextSafeAction, /화면 아래쪽이 남아 있어요/, '못 본 영역이 있으면 다음 길을 준다');
});

// ── 선언 ⊆ 손 (1축의 계약을 그대로 따른다) ──────────────────────────────
test('손이 없으면 모델에게 안 보이고, 있으면 보인다(선언 ⊆ 손, 양방향)', () => {
  assert.equal(demoDescriptors().some((d) => d.id === 'browser.observe'), true,
    'descriptor 는 있다 — 손은 이 컴퓨터에 브라우저가 있을 때만 라이브가 붙인다');
  // 손을 안 넘기면 도구함에 등록되지 않는다(스텁 금지).
  assert.equal(demoTools().tools['browser.observe'], undefined, '손 없이 등록되면 "된다"고 거짓말하게 된다');

  // 손이 없는 환경 → 모델에게 **보이면 안 된다**(없는 도구를 고르게 하면 되는 줄 알고 약속한다).
  const without = toolSchemasFor(buildSelfState(demoEnv())).map((t) => t.name);
  assert.ok(!without.includes('browser.observe'), '브라우저 없는 컴퓨터에서 보이면 거짓말이다');

  // 손이 있는 환경 → 모델 스키마에 나타난다(1축: 스키마는 descriptor 파생).
  // P5-B-0: 연결 표시만으로는 부족하다 — **손을 실제로 붙여야** 실행 가능이다.
  // 예전엔 `connected:true` 만으로 보이게 했는데, 그건 손 없이 "된다"고 말하는 조합이었다.
  const 손 = { async handler() { return { result: {} }; } };
  const withHand = toolSchemasFor(buildSelfState(demoEnv({
    browserObserve: 손, browserAct: 손,
    factOverrides: { 'browser.observe': { connected: true }, 'browser.act': { connected: true } },
  }))).map((t) => t.name);
  assert.ok(withHand.includes('browser.observe'), `손이 있는데 안 보이면 존재를 모른다: ${withHand.join(',')}`);
  assert.ok(withHand.includes('browser.act'), '보기와 조작은 따로 보인다(오너 지시: observe/act 분리)');
});

test('이 컴퓨터의 브라우저 탐지는 있으면 경로, 없으면 undefined 다(지어내지 않는다)', () => {
  const p = findBrowserSync();
  assert.ok(p === undefined || typeof p === 'string');
  assert.equal(findBrowserSync(['/없는/경로']), undefined);
});

// ── 사이트 파서를 만들지 않았다 ─────────────────────────────────────────
test('브라우저 계층에 사이트 이름이 없다(네이버 전용 기능이 아니다)', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['../src/runtime/browser.js', '../src/runtime/browser-tool.js']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.doesNotMatch(code, /naver|place\.naver|리뷰탭/i, `${f} 에 사이트 전용 코드가 있다`);
  }
});

// ── 영수증 필수 4항목 (오너 지시) ───────────────────────────────────────
// 실제 본 범위 · 못 본 범위 · 스크롤 가능성 · 조작 여부. 하나라도 빠지면 모델이 빈칸을 지어낸다.
test('영수증에 본 범위·못 본 범위·스크롤 가능성·조작 여부가 모두 남는다', async () => {
  const tool = makeBrowserActTool({
    browser: {
      async scroll() { return { ...view({ scroll: { y: 2000, viewport: 500, total: 5000 } }), scrolled: 3, stopped: 'no_new_content' }; },
    },
  });
  const o = (await tool.handler({ action: 'scroll', times: 5 })).result.observation;
  assert.equal(o.seen.percent, 60, '실제 본 범위(글자 기준)');
  assert.equal(o.unseen.percent, 40, '못 본 범위(상한에서 잘린 몫)');
  assert.equal(o.canScroll, true, '스크롤 가능성');
  assert.deepEqual(o.acted, { kind: 'scroll', times: 3, stopped: 'no_new_content' }, '조작 여부');
});

test('스크롤은 승인 없이 진행하되 **왜 멈췄는지**를 말한다(한도·차단 조짐)', async () => {
  const mk = (stopped) => makeBrowserActTool({
    browser: { async scroll() { return { ...view({ scroll: { y: 4500, viewport: 500, total: 5000 } }), scrolled: 2, stopped }; } },
  });
  const stopped = await (mk('no_new_content')).handler({ action: 'scroll', times: 5 });
  assert.match(stopped.nextSafeAction ?? '', /새 내용이 나오지 않아서/, '더 안 나오면 밀어붙이지 않는다');
  const bottom = await (mk('reached_bottom')).handler({ action: 'scroll', times: 5 });
  assert.match(bottom.nextSafeAction ?? '', /끝까지 내려갔어요/, '끝까지 본 것과 막힌 것은 다른 사실이다');
  // 승인 경계를 건드리지 않았다 — 스크롤은 읽기다.
  const { classifyTier } = await import('../src/kernel/l2-plan/authority.js');
  assert.equal(classifyTier({ kind: 'read' }), 'A0', '읽기는 자동 진행(매번 승인받게 만들지 않는다)');
});

// 실측(2026-07-27): 네이버가 띄운 IP 제한 안내(124자)를 "100% 봤다"로 남겼더니, 모델이
// "첫 화면의 일부 리뷰를 확인했다"고 말했다 — 사실은 안내문만 봤다. 비율만으로는 안 보인다.
test('열렸어도 글이 거의 없으면 "읽었다"고 하지 않는다(차단·안내 화면)', async () => {
  const thin = view({ text: '서비스 이용이 제한되었습니다.', textTotal: '서비스 이용이 제한되었습니다.'.length, scroll: { y: 0, viewport: 500, total: 500 } });
  const f = observationFacts(thin);
  assert.equal(f.seen.percent, 100, '받은 글자 기준으로는 100% 가 맞다');
  assert.equal(f.thin, true, '그런데 24자다 — 비율만으로는 이 차이가 안 보인다');
  const r = await makeBrowserObserveTool({ browser: { async open() { return thin; } } })
    .handler({ action: 'open', url: 'https://x.example/blocked' });
  assert.match(r.userSafeSummary, /글이 거의 없어요/, '열린 것과 읽은 것은 다르다');
});
