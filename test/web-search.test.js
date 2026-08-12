// Phase 0-2 · 웹 검색 검증.
// **핵심 계약(오너 지시)**: 작동하는 경로가 하나라도 있으면 "검색 연결하세요"를 절대 말하지 않는다.
// 그 외: 계층 순서(무키→키), 차단 페이지를 성공으로 읽지 않기, 가짜 주소 미노출.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWebSearch, searchConnectionSuggestion, SEARCH_PROVIDERS } from '../src/runtime/web-search.js';

const DDG_OK = `
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.bok.or.kr%2Frate">한국은행 기준금리</a>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnews.example.com%2Fa">관련 기사</a>`;
const DDG_BLOCKED = '<html><head><title>DuckDuckGo</title></head><body>anomaly detected, please solve the challenge</body></html>';

function fetchMap(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(url);
    for (const [needle, res] of routes) if (url.includes(needle)) return res(url, init);
    return { status: 404, text: async () => '', json: async () => ({}) };
  };
  return { impl, calls };
}
const html = (body, status = 200) => () => ({ status, text: async () => body });
const json = (obj, status = 200) => () => ({ status, json: async () => obj, text: async () => JSON.stringify(obj) });

// ── 절대 규칙: 되는데 연결을 권하지 않는다 ────────────────────────────────
test('모델 내장 검색이 있으면 연결 권유를 절대 만들지 않는다', () => {
  assert.equal(searchConnectionSuggestion({ modelNativeSearch: true, searchState: 'unavailable' }), null);
});

test('무키 검색이 성공하면 연결 권유를 절대 만들지 않는다', () => {
  assert.equal(searchConnectionSuggestion({ searchState: 'ok' }), null);
});

test('이미 검색 키가 연결돼 있으면 권유하지 않는다', () => {
  assert.equal(searchConnectionSuggestion({ searchState: 'unavailable', hasKey: true }), null);
});

test('실패가 확정되지 않았으면(빈 질의 등) 권유하지 않는다', () => {
  assert.equal(searchConnectionSuggestion({ searchState: 'empty_query' }), null);
  assert.equal(searchConnectionSuggestion({}), null);
});

test('모두 실패했을 때만 권유하고, 그때도 대안(주소 주기)을 함께 준다', () => {
  const s = searchConnectionSuggestion({ searchState: 'unavailable' });
  assert.ok(s, '모두 실패하면 안내는 해야 한다');
  assert.ok(s.userSafeSummary.includes('찾아보지 못했'));
  assert.ok(s.nextSafeAction.includes('주소'), '연결 말고도 지금 할 수 있는 길을 준다(막다른 답 금지)');
});

// ── 계층 순서 ─────────────────────────────────────────────────────────────
test('무키(덕덕고)가 되면 키 경로를 아예 호출하지 않는다', async () => {
  const { impl, calls } = fetchMap([['duckduckgo.com', html(DDG_OK)], ['tavily', json({ results: [] })]]);
  const s = await makeWebSearch({ fetchImpl: impl, apiKey: 'tvly-x' }).search('한국은행 기준금리');
  assert.equal(s.state, 'ok');
  assert.equal(s.provider, 'duckduckgo');
  assert.equal(calls.some((u) => u.includes('tavily')), false, '위층이 됐는데 아래층을 부르면 안 된다');
});

test('덕덕고가 차단되면 조용히 다음 층(Tavily)으로 넘어간다', async () => {
  const { impl } = fetchMap([
    ['duckduckgo.com', html(DDG_BLOCKED, 202)],
    ['tavily', json({ results: [{ title: '결과', url: 'https://example.com/a', content: '요약' }] })],
  ]);
  const s = await makeWebSearch({ fetchImpl: impl, apiKey: 'tvly-x' }).search('질의');
  assert.equal(s.state, 'ok');
  assert.equal(s.provider, 'tavily');
  assert.deepEqual(s.tried, ['duckduckgo', 'tavily']);
});

test('키가 없으면 키 경로는 시도조차 하지 않는다', async () => {
  const { impl, calls } = fetchMap([['duckduckgo.com', html(DDG_BLOCKED, 202)]]);
  const s = await makeWebSearch({ fetchImpl: impl }).search('질의');
  assert.equal(s.state, 'unavailable');
  assert.deepEqual(s.tried, ['duckduckgo']);
  assert.equal(calls.some((u) => u.includes('tavily')), false);
});

test('SearXNG 는 인스턴스 주소가 있을 때만 시도한다(사용자가 자기 것을 가진 경우)', async () => {
  const { impl, calls } = fetchMap([
    ['duckduckgo.com', html(DDG_BLOCKED, 202)],
    ['my-searx.example', json({ results: [{ title: 'T', url: 'https://a.example/1', content: 'C' }] })],
  ]);
  const s = await makeWebSearch({ fetchImpl: impl, instanceUrl: 'https://my-searx.example' }).search('질의');
  assert.equal(s.provider, 'searxng');
  assert.ok(calls.some((u) => u.includes('my-searx.example')));
});

// ── 차단·가짜 결과를 성공으로 읽지 않는다 ─────────────────────────────────
test('차단 페이지(anomaly/challenge)를 결과로 착각하지 않는다', async () => {
  const { impl } = fetchMap([['duckduckgo.com', html(DDG_BLOCKED, 202)]]);
  const s = await makeWebSearch({ fetchImpl: impl }).search('질의');
  assert.equal(s.state, 'unavailable', '차단을 성공으로 읽으면 없는 결과를 지어내게 된다');
});

test('덕덕고 리다이렉트 주소를 실제 주소로 풀고, 못 풀면 버린다(가짜 출처 금지)', async () => {
  const { impl } = fetchMap([['duckduckgo.com', html(`${DDG_OK}<a class="result__a" href="/y.js?ad=1">광고</a>`)]]);
  const s = await makeWebSearch({ fetchImpl: impl }).search('질의');
  assert.equal(s.results.length, 2);
  assert.equal(s.results[0].url, 'https://www.bok.or.kr/rate');
  assert.ok(s.results.every((r) => /^https?:\/\//.test(r.url) && !r.url.includes('duckduckgo')));
});

test('한 층이 예외로 죽어도 다음 층으로 넘어간다(막다른 답 금지)', async () => {
  const impl = async (url) => {
    if (url.includes('duckduckgo')) throw new Error('network down');
    return { status: 200, json: async () => ({ results: [{ title: 'T', url: 'https://a.example/1', content: 'C' }] }) };
  };
  const s = await makeWebSearch({ fetchImpl: impl, apiKey: 'k' }).search('질의');
  assert.equal(s.state, 'ok');
  assert.equal(s.provider, 'tavily');
});

test('빈 질의는 검색하지 않는다', async () => {
  const { impl, calls } = fetchMap([]);
  const s = await makeWebSearch({ fetchImpl: impl }).search('   ');
  assert.equal(s.state, 'empty_query');
  assert.equal(calls.length, 0);
});

test('provider 선언: 무키/키 구분이 명시돼 있다', () => {
  assert.equal(SEARCH_PROVIDERS.duckduckgo.keyless, true);
  assert.equal(SEARCH_PROVIDERS.searxng.keyless, true);
  assert.equal(SEARCH_PROVIDERS.tavily.keyless, false);
});

// ── 능력 설명이 실제와 어긋나지 않는다 (감사 지적: 되는데 "못 한다"고 말했다) ──
test('web.collect 능력 설명이 검색 가능을 반영한다 — T5 가 자기를 틀리게 설명하면 안 된다', async () => {
  // 1축: 능력 문장은 descriptor 파생이다 — selfState 를 통해 읽는다(수동 맵 없음).
  const { toolCapabilityLine } = await import('../src/kernel/tool-labels.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const line = toolCapabilityLine('web.collect', buildSelfState(demoEnv()));
  assert.ok(!/검색어로 찾아 주는 기능은 아직 없다/.test(line), '기능이 생겼는데 없다고 말하면 안 된다');
  assert.ok(/찾아서 읽는다|찾아 준다|검색/.test(line), '찾을 수 있다는 사실이 설명에 있어야 한다');
  assert.ok(/출처/.test(line), '출처와 함께 준다는 것도 사용자가 알아야 한다');
  assert.ok(/읽지 못한다|막은|로그인/.test(line), '못 하는 것도 함께 말해야 과장이 아니다');
});
