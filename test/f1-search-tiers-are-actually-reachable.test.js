// **F1 · 검색기가 하나뿐이었다** (상태 지도 §12 F1 · `live-context.js:193`).
//
// 코드에는 3층이 서 있다 — 무키 DDG → SearXNG → Tavily(`web-search.js`). 층을 고르는 자리도
// 옳다(`needs` 계약). **그런데 자격이 들어오는 문이 없었다.** `live-context.js` 가
// `makeWebSearchTool({timeoutMs})` 만 넘겼고, `apiKey`·`instanceUrl` 을 읽을 env 자리가
// **소스 전체에 없었다**(`TAVILY|SEARXNG` grep 0건). 그래서 2·3층은 `needs` 검사에서
// 매번 건너뛰어졌고, **실제로 도는 검색기는 DDG 하나뿐**이었다.
//
// DDG 는 공식 API 가 아니다 — 오픈클로가 자기 문서에 그대로 적어 둔 성질이다:
//   `docs/tools/duckduckgo-search.md:92`
//   *"**Bot-challenge risk** - DuckDuckGo may serve CAPTCHAs or block requests
//     under heavy or automated use"*
// 그날이 오면 **그 턴의 검색은 그대로 끝난다.** 아래로 갈 층이 하나도 없기 때문이다.
//
// 이름은 지어내지 않는다. 오픈클로가 이미 쓰는 이름을 그대로 쓴다 —
//   `docs/tools/web.md:125`  | [Tavily](/tools/tavily) | … | `TAVILY_API_KEY` |
//   `docs/tools/searxng-search.md:99` *"Set `SEARXNG_BASE_URL` as an alternative to config"*
// 이미 다른 도구를 쓰느라 그 값을 세워 둔 사람은 **T5 에서 아무것도 안 해도 3층이 선다.**
// (같은 파일이 `SLACK_BOT_TOKEN`·`TELEGRAM_BOT_TOKEN` 을 그렇게 읽는다 — 같은 관습이다.)
//
// **키를 지어내지 않는다.** 없으면 지금처럼 그 층을 조용히 건너뛴다(아래 반대시험).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveDeps } from '../src/surface/live-context.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildTaskContext } from '../src/kernel/l1-intent/task-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const SEARX = 'http://127.0.0.1:8888';

/**
 * 가짜 드라이버 층 — **네트워크에 안 나간다.** 어느 층이 실제로 불렸는지만 기록한다.
 * DDG 는 봇 차단 페이지(anomaly)를 돌려준다 — `web-search.js:39` 이 그걸 실패로 읽는 그 모양 그대로.
 */
function 가짜검색망({ tavily = true, searxng = true } = {}) {
  const 밟은곳 = [];
  const 원래 = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    밟은곳.push(u);
    if (u.includes('duckduckgo.com')) {
      return { status: 200, async text() { return '<html>anomaly detected</html>'; } };
    }
    if (u.startsWith(SEARX)) {
      return searxng
        ? { status: 200, async json() { return { results: [{ title: '서크스', url: 'https://example.org/s', content: '요약' }] }; } }
        : { status: 429, async json() { return null; } };
    }
    if (u.includes('api.tavily.com')) {
      return tavily
        ? { status: 200, async json() { return { results: [{ title: '타빌리', url: 'https://example.org/t', content: '요약' }] }; } }
        : { status: 401, async json() { return null; } };
    }
    return { status: 404, async text() { return ''; }, async json() { return null; } };
  };
  return { 밟은곳, 되돌리기: () => { globalThis.fetch = 원래; } };
}

/** `liveDeps` 가 세운 **진짜 배선**으로 찾는 손을 부른다(손을 따로 만들지 않는다 — 배선이 대상이다). */
async function 찾아본다(env, 망옵션) {
  const 망 = 가짜검색망(망옵션);
  try {
    // 손은 `globalThis.fetch` 를 **만들 때** 붙잡는다 — 그래서 망을 먼저 세우고 liveDeps 를 부른다.
    const { tools } = liveDeps({ GPAO_T5_BROWSER_PATH: '', ...env });
    const 결과 = await tools.tools['web.search'].handler({ query: '코스피 지수' });
    return { 결과, 밟은곳: 망.밟은곳 };
  } finally { 망.되돌리기(); }
}

// ── 2층: 인스턴스 주소가 있으면 SearXNG 가 실제로 시도된다 ──────────────────
test('F1 · SEARXNG_BASE_URL 이 있으면 1층이 막혔을 때 2층이 실제로 불린다', async () => {
  const { 결과, 밟은곳 } = await 찾아본다({ SEARXNG_BASE_URL: SEARX });
  assert.ok(밟은곳.some((u) => u.includes('duckduckgo.com')), '1층은 여전히 먼저 시도된다');
  assert.ok(밟은곳.some((u) => u.startsWith(SEARX)), '**2층이 실제로 불렸다** — 자격이 배선을 타고 내려갔다');
  assert.equal(결과.blocked, undefined, '2층이 답을 냈으므로 막히지 않는다');
  assert.equal(결과.result.후보[0].url, 'https://example.org/s');
});

// ── 3층: 키가 있으면 Tavily 가 실제로 시도된다 ──────────────────────────────
test('F1 · TAVILY_API_KEY 가 있으면 1·2층이 막혔을 때 3층이 실제로 불린다', async () => {
  const { 결과, 밟은곳 } = await 찾아본다({ TAVILY_API_KEY: 'tvly-테스트' });
  assert.ok(밟은곳.some((u) => u.includes('api.tavily.com')), '**3층이 실제로 불렸다**');
  assert.equal(결과.result.후보[0].url, 'https://example.org/t');
});

// ── 셋 다 있으면 위에서 되는 층이 이긴다(층 순서는 안 바뀐다) ────────────────
test('F1 · 자격이 다 있어도 층 순서는 그대로 — 위에서 되면 아래로 안 간다', async () => {
  const { 결과, 밟은곳 } = await 찾아본다({ SEARXNG_BASE_URL: SEARX, TAVILY_API_KEY: 'tvly-테스트' });
  assert.equal(결과.result.후보[0].url, 'https://example.org/s', '2층이 됐으면 3층은 안 간다');
  assert.ok(!밟은곳.some((u) => u.includes('api.tavily.com')), '3층은 부르지도 않았다');
});

// ── 반대시험: 자격이 없으면 **지어내지 않고** 그 층을 건너뛴다 ───────────────
test('F1 반대시험 · 자격이 없으면 그 층은 조용히 건너뛴다(키를 지어내지 않는다)', async () => {
  const { 밟은곳 } = await 찾아본다({});
  assert.ok(밟은곳.some((u) => u.includes('duckduckgo.com')), '1층은 자격이 필요 없다');
  assert.ok(!밟은곳.some((u) => u.includes('api.tavily.com')), '키가 없으면 3층을 부르지 않는다');
  assert.ok(!밟은곳.some((u) => u.startsWith(SEARX)), '주소가 없으면 2층을 부르지 않는다');
});

// ── 그리고 **그 사실이 모델에게 간다** ────────────────────────────────────
//
// 하나뿐이라 막힌 것과 셋 다 해 보고 막힌 것은 **다른 사실**이다. 모델이 그걸 모르면
// "웹이 원래 안 되나 보다"로 읽고 사용자에게 떠넘긴다(없는 한계를 지어내는 자리).
// 실패 영수증의 기계 원문 칸(`diagnosticTrace` → `task-context.js:608` 실패원문칸)이 그 길이다.
test('F1 · 「검색기가 하나뿐이라 막혔다」가 손 결과에 실린다', async () => {
  const { 결과 } = await 찾아본다({});
  assert.equal(결과.blocked, true);
  const 검색기 = 결과.diagnosticTrace?.검색기;
  assert.ok(검색기, '막힌 결과에 검색기 사실이 실린다');
  assert.deepEqual(검색기.시도함, ['duckduckgo'], '실제로 시도한 층은 하나뿐이었다');
  const 건너뜀 = new Map((검색기.건너뜀 ?? []).map((x) => [x.id, x.없는것]));
  assert.deepEqual(건너뜀.get('searxng'), ['instanceUrl'], '2층이 왜 안 돌았는지');
  assert.deepEqual(건너뜀.get('tavily'), ['apiKey'], '3층이 왜 안 돌았는지');
});

test('F1 · 그 사실이 영수증을 타고 모델 입력까지 간다', async () => {
  const 망 = 가짜검색망();
  let rec;
  try {
    const { tools, env } = liveDeps({ GPAO_T5_BROWSER_PATH: '' });
    const selfState = buildSelfState(env);
    rec = await new ToolRunner(tools.tools).run('web.search', { query: '코스피 지수' }, selfState);
  } finally { 망.되돌리기(); }
  assert.equal(rec.failureState, 'blocked');
  assert.ok(rec.diagnosticTrace?.검색기, '영수증이 기계 원문 칸으로 사실을 들고 간다');

  const tc = buildTaskContext({
    intent: { currentRequest: '코스피 알려줘', answerMode: 'complex_work' },
    selfState: buildSelfState(liveDeps({ GPAO_T5_BROWSER_PATH: '' }).env),
    receipts: [rec],
  });
  const 교환 = (tc.turnExchange ?? []).find((x) => x.tool === 'web.search');
  assert.ok(교환, '이번 턴 교환에 실린다');
  assert.match(String(교환.실패원문 ?? ''), /검색기/, '모델이 읽는 자리에 사실이 도착한다');
  assert.match(String(교환.실패원문 ?? ''), /instanceUrl|apiKey/, '무엇이 없어서 층이 안 돌았는지까지');
});
