// **막혔을 때야말로 다음 수가 필요하다.**
//
// 라이브(오너 2026-08-05) `오늘 한국 증시 상황 알려줘`: 검색이 후보 다섯을 실제로 돌려줬는데
// 앞의 셋이 전부 막혔다. 그러자 T5 는 *"대신 제가 아는 경로로 찾아볼게요"* 라고 해 놓고
// **아무 데도 안 갔다.** 손이 이미 쥐고 있던 나머지 후보가 모델에게 한 칸도 안 갔기 때문이다.
//
// 구멍의 모양(앞 세션이 스스로 적어 둔 것):
//   읽기에 **성공해야** `result` 가 생기고 거기 `다음수단`·`다른후보` 가 실린다.
//   막히면 `result` 자체가 없어서 → 재료 조립이 실패한 영수증에서 `data` 를 빼고 → 모델은
//   *"막혔다"* 라는 사실 하나만 받는다. **다음 수가 정확히 필요한 자리에서 다음 수가 사라진다.**
//
// ── 이 검사가 재는 것: 실패해도 **사실**은 간다, 그러나 **내용**은 안 간다 ──────────
//
// 실패한 호출의 `data`(읽은 본문)를 안 싣는 계약은 **옳고 그대로 둔다** — 못 본 것을 본 척하는
// 자리다. 그런데 `다른후보` 는 못 본 페이지의 내용이 아니라 **검색기가 실제로 돌려준 목록**이다.
// 확인된 사실이고, 이걸 같이 버린 것이 구멍이었다.
//
//   버려야 하는 것   막힌 페이지의 본문      (못 봤다 — 지금도 안 간다)
//   가야 하는 것     안 가 본 후보 목록      (검색기가 실제로 준 것 — 이 검사가 세운다)
//
// 커널이 "어디로 가라"를 정하지 않는다(§1.2 · 절대원칙 8). **쓸 수 있는 수를 주고 모델이 둔다.**
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebCollector } from '../src/runtime/web-collector.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv } from '../src/surface/demo-context.js';

const 후보다섯 = [
  { title: '네이버 금융', url: 'https://finance.naver.com/sise/', snippet: '' },
  { title: '한국거래소', url: 'https://krx.example/idx', snippet: '' },
  { title: '연합인포맥스', url: 'https://infomax.example/kospi', snippet: '' },
  { title: '구글 파이낸스', url: 'https://google.example/finance/KOSPI', snippet: '' },
  { title: '인베스팅닷컴', url: 'https://investing.example/kospi', snippet: '' },
];

const 검색 = { search: async () => ({ state: 'ok', provider: 'duckduckgo', providerLabel: '덕덕고', results: 후보다섯, tried: ['duckduckgo'] }) };

/** 무엇을 열든 403 으로 막는 fetch — 앞의 셋이 전부 막힌 그날 그대로. */
const 전부막힘 = async (url) => ({
  status: 403, url, headers: { get: () => 'text/html' },
  text: async () => '<html><body>접근이 거부되었습니다</body></html>',
});

// ── ① 손: 막혀도 자기가 쥔 다음 길을 낸다 ────────────────────────────────
test('막힌 수집도 안 가 본 후보를 낸다 — 검색기가 실제로 준 목록이다', async () => {
  const c = makeWebCollector({ fetchImpl: 전부막힘, search: 검색 });
  const out = await c.handler({ request: '오늘 코스피 지수' });

  assert.equal(out.blocked, true, '막힌 건 막힌 것이다 — 성공으로 뭉개지 않는다');
  assert.equal(out.result, undefined, '못 봤으면 내용은 없다(이 계약은 그대로다)');
  assert.ok(!out.sources, '못 봤으면 출처도 없다');

  // 여기가 새로 서는 자리다.
  assert.ok(Array.isArray(out.다른후보) && out.다른후보.length, '막혔는데 안 가 본 후보가 한 칸도 없다');
  const 준주소 = out.다른후보.map((x) => x.url);
  assert.ok(준주소.includes('https://google.example/finance/KOSPI'),
    '시도조차 안 한 후보가 빠졌다 — 모델은 그리로 갈 수 없다');
  assert.ok(Array.isArray(out.다음수단) && out.다음수단.some((m) => m.방법 === 'read_url'),
    '지금 바로 부를 수 있는 수가 없다 — "다른 데 찾아볼게요"만 하고 아무 데도 못 간다');
  assert.ok(out.다음수단.some((m) => m.방법 === 'search'), '검색을 다시 하는 길도 늘 열려 있어야 한다');

  // **시도해서 막힌 곳을 다시 권하지 않는다.** 같은 벽으로 두 번 보내는 것은 다음 수가 아니다.
  assert.ok(!준주소.includes('https://finance.naver.com/sise/'), '방금 막힌 곳을 다시 권했다');
});

test('막힌 이유는 후보마다 남는다 — 어디가 왜 안 됐는지 모르면 같은 곳을 또 고른다', async () => {
  const c = makeWebCollector({ fetchImpl: 전부막힘, search: 검색 });
  const out = await c.handler({ request: '오늘 코스피 지수' });
  assert.ok(Array.isArray(out.막힌곳) && out.막힌곳.length >= 1, '무엇을 시도했는지가 사라졌다');
  assert.ok(out.막힌곳.every((x) => x.url && x.fetchState), '주소와 막힌 종류가 짝으로 있어야 한다');
});

// ── ② 실행 경계: 영수증이 그 사실을 떨어뜨리지 않는다 ──────────────────────
test('차단 영수증이 다음 수단을 그대로 들고 나온다', async () => {
  const runner = new ToolRunner({
    'web.collect': makeWebCollector({ fetchImpl: 전부막힘, search: 검색 }),
  });
  const rec = await runner.run('web.collect', { request: '오늘 코스피 지수' }, buildSelfState(demoEnv()));
  assert.equal(rec.failureState, 'blocked');
  assert.equal(rec.result, undefined, '막힌 영수증에 내용이 실리면 안 된다');
  assert.ok(rec.다음수단?.some((m) => m.방법 === 'read_url'), '영수증이 다음 수단을 떨어뜨렸다');
  assert.ok(rec.다른후보?.length, '영수증이 안 가 본 후보를 떨어뜨렸다');
});

// ── ③ 재료 조립: 모델이 실제로 받는 자리 ──────────────────────────────────
test('모델이 받는 재료에 다음 수단이 온다 — 내용은 여전히 안 온다', () => {
  const rec = {
    intended: '증시 확인', failureState: 'blocked',
    userSafeSummary: '그 사이트가 접근을 막고 있어요.',
    nextSafeAction: '다른 자료로 다시 찾아볼까요?',
    actualCall: { tool: 'web.collect', args: { request: '오늘 코스피 지수' }, providerCallId: 'call_WEB1' },
    다음수단: [{ 방법: 'read_url', url: 'https://google.example/finance/KOSPI', 왜: '검색에서 같이 나온 곳' }],
    다른후보: [{ title: '구글 파이낸스', url: 'https://google.example/finance/KOSPI' }],
  };
  const tc = buildTaskContext({
    intent: { currentRequest: '오늘 한국 증시 상황 알려줘', answerMode: 'complex_work' },
    selfState: buildSelfState(demoEnv()), receipts: [rec],
  });
  const x = tc.turnExchange?.[0];
  assert.ok(x, '실행이 교환에 없다');
  assert.equal(x.failureState, 'blocked');
  assert.equal(x.data, undefined, '실패한 호출의 내용은 사실이 아니다 — 이 계약은 그대로다');
  assert.ok(x.다음수단?.length, '모델에게 닿는 자리에서 다음 수가 사라졌다 — 구멍은 여기였다');
  assert.equal(x.다음수단[0].url, 'https://google.example/finance/KOSPI');
});

// ── 반대시험: 검색이 애초에 없었으면 없는 수를 지어내지 않는다 ───────────────
test('주소를 직접 받아 막힌 경우에는 없는 후보를 지어내지 않는다', async () => {
  const c = makeWebCollector({ fetchImpl: 전부막힘 });
  const out = await c.handler({ url: 'https://finance.naver.com/sise/' });
  assert.equal(out.blocked, true);
  assert.equal(out.다른후보, undefined, '검색을 안 했는데 후보를 지어냈다');
  // 그래도 **막다른 답은 아니다** — 검색이라는 수는 늘 있다.
  assert.ok(out.다음수단?.some((m) => m.방법 === 'search'), '주소 하나가 막혔다고 길이 끝나면 안 된다');
});
