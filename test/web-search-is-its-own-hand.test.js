// **모델이 목록을 보고 출처를 고른다.**
//
// 밟은 사실(오너 라이브 2026-08-05) — 같은 질문 `오늘 한국 증시 상황은 어때?` 를 두 곳에 던져
// 기계적 차이를 냈다. 차이는 도구가 아니라 **순서**였다:
//
//   | | 비교군(Claude Code) | T5 |
//   |---|---|---|
//   | 검색 결과 | **목록을 보고 출처를 고른다** | 첫 결과를 읽는다 |
//   | 막혔을 때 | **출처를 바꾼다** | **질의 문구를 바꾼다** |
//
// 실제로 T5 는 손을 세 번 쓰면서 **세 번 다 질의 문구만** 바꿨다(`장중` → `마감` → 날짜 붙이기).
// 그리고 같은 코드로 6턴을 돌리면 4턴째만 코스피 6,634 를 맞혔다 — 차단도 추출도 아니고
// **검색이 고르는 출처의 편차**다. 첫 결과가 좋은 날엔 맞고 아닌 날엔 틀린다.
//
// 원인은 손의 모양에 있었다. `web.collect{request}` **한 칸에 "찾을 것"과 "읽을 주소"가 섞여**
// 있고, 검색하면 자동으로 첫 결과를 읽는다. 그래서 **모델이 "후보만 보여 줘"를 부를 수 없다.**
// 고를 기회 자체가 없으니 고를 수가 없다.
//
// 그래서 나눈다 — 찾는 손과 읽는 손. 커널은 어느 후보가 좋은지 정하지 않는다(§1.2).
// **목록을 주고 모델이 고른다.**
//
// ── 함께 지켜야 하는 것: 검색은 읽은 것이 아니다 ────────────────────────────
// 손이 하나 늘면 **다른 쪽의 우연한 방어가 사라질 수 있다**(§4.7). 여기서 실제로 그렇다 —
// 거짓 성공 게이트(`읽은척차단`)는 *이번 턴에 성공한 실행이 하나라도 있으면 막지 않는다*.
// 검색 성공을 "읽었다"로 세면, 페이지를 하나도 못 읽은 턴에서 그 게이트가 통째로 꺼진다.
// 그 칸을 이 파일이 함께 잰다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebSearchTool } from '../src/runtime/web-search-tool.js';
import { makeWebCollector } from '../src/runtime/web-collector.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoContext, demoEnv } from '../src/surface/demo-context.js';
import { 읽기사실, 읽은척차단 } from '../src/kernel/l2-plan/recovery-ladder.js';

const 결과다섯 = [
  { title: '코스피 시세 — 네이버 금융', url: 'https://finance.naver.com/sise/', snippet: '코스피 6,634.21 전일대비 +33.10' },
  { title: 'KRX 지수', url: 'https://krx.example/idx', snippet: '유가증권시장 지수 안내' },
  { title: '증권사 광고', url: 'https://ad.example/promo', snippet: '지금 계좌 개설하면' },
  { title: '구글 파이낸스 KOSPI', url: 'https://google.example/finance/KOSPI', snippet: 'KOSPI 6,634.21' },
  { title: '인베스팅닷컴', url: 'https://investing.example/kospi', snippet: '실시간 지수' },
];
const 검색 = { search: async () => ({ state: 'ok', provider: 'duckduckgo', providerLabel: '덕덕고', results: 결과다섯, tried: ['duckduckgo'] }) };

// ── ① 찾는 손은 읽지 않는다 — 후보만 준다 ────────────────────────────────
test('web.search 는 후보 목록만 낸다 — 페이지를 열지 않는다', async () => {
  const 열어본곳 = [];
  const tool = makeWebSearchTool({
    search: 검색,
    fetchImpl: async (u) => { 열어본곳.push(u); throw new Error('찾는 손이 페이지를 열면 안 된다'); },
  });
  const out = await tool.handler({ query: '오늘 코스피 지수' });

  assert.equal(열어본곳.length, 0, '찾는 손이 페이지를 열었다 — 그러면 고를 기회가 또 사라진다');
  assert.equal(out.blocked, undefined);
  assert.equal(out.result.후보.length, 5, '목록이 통째로 와야 모델이 고를 수 있다');
  const 첫째 = out.result.후보[0];
  assert.equal(첫째.순위, 1);
  assert.ok(첫째.title && 첫째.url, '제목과 주소가 있어야 고를 수 있다');
  assert.equal(첫째.snippet, '코스피 6,634.21 전일대비 +33.10', '요약을 지우면 무엇을 고를지 알 수 없다');
  assert.equal(out.result.provider, '덕덕고');
});

test('찾은 후보 하나하나가 바로 부를 수 있는 다음 수가 된다', async () => {
  const tool = makeWebSearchTool({ search: 검색 });
  const out = await tool.handler({ query: '오늘 코스피 지수' });
  const 읽기수 = out.result.다음수단.filter((m) => m.방법 === 'read_url');
  assert.equal(읽기수.length, 5, '목록만 주고 부를 길을 안 주면 절반이다');
  assert.ok(읽기수.some((m) => m.url === 'https://google.example/finance/KOSPI'));
  assert.ok(out.result.다음수단.some((m) => m.방법 === 'search'), '다시 찾는 길도 남는다');
});

test('못 찾으면 정직하게 막히고, 그래도 길은 남는다', async () => {
  const tool = makeWebSearchTool({ search: { search: async () => ({ state: 'unavailable', tried: ['duckduckgo'] }) } });
  const out = await tool.handler({ query: '오늘 코스피 지수' });
  assert.equal(out.blocked, true);
  assert.equal(out.result, undefined, '못 찾았으면 후보를 지어내지 않는다');
  assert.ok(out.nextSafeAction, '막다른 답이 되면 안 된다');
});

// ── ② 검색은 읽은 것이 아니다 (§4.7 — 손이 늘 때 사라지는 방어) ──────────────
test('검색 성공은 "읽었다"로 세지 않는다 — 거짓 성공 게이트가 안 꺼진다', async () => {
  const runner = new ToolRunner({
    'web.search': makeWebSearchTool({ search: 검색 }),
    'web.collect': makeWebCollector({
      search: 검색,
      fetchImpl: async (u) => ({ status: 403, url: u, headers: { get: () => 'text/html' }, text: async () => '접근이 거부되었습니다' }),
    }),
  });
  const selfState = buildSelfState(demoEnv());
  const 찾음 = await runner.run('web.search', { query: '오늘 코스피 지수' }, selfState);
  const 못읽음 = await runner.run('web.collect', { url: 'https://finance.naver.com/sise/' }, selfState);

  assert.equal(찾음.failureState, 'none', '검색 자체는 성공했다 — 실패로 뭉개지 않는다');
  assert.equal(못읽음.failureState, 'blocked');

  const 사실 = 읽기사실([찾음, 못읽음]);
  assert.deepEqual(사실.확인한것, [], '후보 목록을 받은 것은 페이지를 읽은 것이 아니다');
  assert.equal(사실.못본것.length, 1, '못 읽은 것은 그대로 못 읽은 것이다');

  // 원장 어디에도 없는 숫자를 답이 말하면 — 검색이 성공했더라도 — 막혀야 한다.
  const 막힘 = 읽은척차단([찾음, 못읽음], '오늘 코스피는 9,999.99로 마감했어요.', {
    출처계약손: ['web.collect'],
  });
  assert.ok(막힘, '검색 성공 하나로 거짓 성공 게이트가 통째로 꺼졌다');
});

test('검색이 실제로 준 숫자는 원장이 뒷받침한다 — 정직한 답까지 막지 않는다', async () => {
  const runner = new ToolRunner({ 'web.search': makeWebSearchTool({ search: 검색 }) });
  const 찾음 = await runner.run('web.search', { query: '오늘 코스피 지수' }, buildSelfState(demoEnv()));
  const 막힘 = 읽은척차단([찾음], '검색 결과에는 코스피 6,634.21 로 나와 있어요.', { 출처계약손: ['web.collect'] });
  assert.equal(막힘, null, '실패한 읽기가 없는데 막았다 — 정직한 답을 죽이면 안 된다');
});

// ── ③ 모델이 실제로 받는 자리 ────────────────────────────────────────────
test('후보 목록이 모델에게 그대로 닿는다', async () => {
  const runner = new ToolRunner({ 'web.search': makeWebSearchTool({ search: 검색 }) });
  const rec = await runner.run('web.search', { query: '오늘 코스피 지수' }, buildSelfState(demoEnv()));
  const tc = buildTaskContext({
    intent: { currentRequest: '오늘 한국 증시 상황 알려줘', answerMode: 'complex_work' },
    selfState: buildSelfState(demoEnv()), receipts: [rec],
  });
  const 실린것 = JSON.stringify(tc.turnExchange?.[0]?.data ?? {});
  assert.match(실린것, /google\.example/, '후보가 모델에게 안 갔다 — 고를 수 없다');
  assert.match(실린것, /6,634\.21/, '요약이 잘려 나갔다');
});

// ── ④ 선언과 손은 한 자리에서 함께 선다(P5-B-0) ───────────────────────────
test('선언한 손은 실제로 붙어 있다 — 없는 손을 선언하지 않는다', () => {
  const ctx = demoContext({ webSearch: makeWebSearchTool({ search: 검색 }) });
  const 선언 = ctx.descriptors.find((d) => d.id === 'web.search');
  assert.ok(선언, 'web.search 선언이 없다');
  assert.ok(ctx.tools.tools['web.search'], '선언은 있는데 손이 없다');
  const self = buildSelfState(ctx.env);
  const t = self.connectedTools.find((x) => x.id === 'web.search');
  assert.ok(t?.executable, '모델에게 실행 가능으로 안 보인다');
  // **읽는 손과 역할이 갈렸다고 말해야 모델이 고른다.**
  assert.match(선언.schema.description, /web\.collect/, '읽는 손을 안 가리키면 목록만 보고 끝난다');
});

// ── ⑤ 대조군 보존: 읽는 손은 하던 대로 돈다 ────────────────────────────────
test('web.collect 는 그대로다 — 주소를 주면 읽고, 없으면 찾아서 읽는다', async () => {
  const c = makeWebCollector({
    search: 검색,
    fetchImpl: async (u) => ({ status: 200, url: u, headers: { get: () => 'text/html' }, text: async () => '<title>코스피</title><article>코스피 6,634.21 로 마감했습니다.</article>' }),
  });
  const out = await c.handler({ request: '오늘 코스피 지수' });
  assert.equal(out.result.title, '코스피');
  assert.equal(out.sources.length, 1, '읽은 손은 출처를 남긴다(이 계약은 그대로다)');
});
