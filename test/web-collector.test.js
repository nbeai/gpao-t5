import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeWebCollector, httpToFetchState } from '../src/runtime/web-collector.js';
import { assertWebEvidence } from '../src/kernel/l2-plan/web-tool.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

// 주입 fetch — 실네트워크 없이 상태·본문을 통제한다.
function fakeFetch(status, body = '', url = 'http://x/') {
  return async () => ({ status, url, headers: { get: () => 'text/html' }, text: async () => body });
}

// ── httpToFetchState: 코드+본문 → 상태 분류 ──
test('httpToFetchState: 코드·본문 신호로 벽/차단 분리', () => {
  assert.equal(httpToFetchState(200, { body: '<title>문서</title>본문' }), 'ok');
  assert.equal(httpToFetchState(200, { body: '로그인 해주세요' }), 'login_wall', '200이어도 로그인 페이지');
  assert.equal(httpToFetchState(401), 'login_wall');
  assert.equal(httpToFetchState(429), 'bot_wall');
  assert.equal(httpToFetchState(403, { body: 'are you human captcha' }), 'bot_wall', '403+봇신호');
  assert.equal(httpToFetchState(403, { body: '접근이 거부되었습니다' }), 'blocked', '403 접근차단');
  assert.equal(httpToFetchState(500), 'blocked');
  assert.equal(httpToFetchState(404), 'blocked');
});

// ── 핵심: 봤다 → 출처 필수 / 못 봤다 → 내용·출처 없음(정직) ──
test('실브라우징: 로컬 http 서버를 실제 fetch로 수집 → 출처 포함 성공', async () => {
  const srv = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<title>테스트 문서</title><body>공개 본문 내용입니다.</body>');
  });
  await new Promise((r) => srv.listen(0, r));
  const { port } = srv.address();
  try {
    const collector = makeWebCollector(); // 실제 global fetch — 진짜 브라우징(로컬 대상)
    const out = await collector.handler({ url: `http://127.0.0.1:${port}/` });
    assert.ok(out.result, '봤다');
    assert.equal(out.result.title, '테스트 문서');
    assert.equal(out.sources.length, 1, '출처 근거 1');
    assert.match(out.sources[0].sourceUrl, /127\.0\.0\.1/);
    assert.equal(out.sources[0].title, '테스트 문서');
    assert.ok(out.sources[0].excerptHash, '발췌 지문');
    assertWebEvidence(out); // 계약 통과(출처 있는 성공)
  } finally {
    await new Promise((r) => srv.close(r));
  }
});

test('로그인벽: 401 → login_wall, 내용·출처 없이 정직하게', async () => {
  const c = makeWebCollector({ fetchImpl: fakeFetch(401, '<title>Login</title>') });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.blocked, true);
  assert.equal(out.fetchState, 'login_wall');
  assert.equal(out.result, undefined, '못 봤으면 내용 없음');
  assert.ok(!out.sources, '못 봤으면 출처 없음');
  assertWebEvidence(out); // 실패 상태는 내용·출처 없이 통과
});

test('200이지만 로그인 페이지: 본문 신호로 login_wall(못 본 걸 본 척 안 함)', async () => {
  const c = makeWebCollector({ fetchImpl: fakeFetch(200, '<title>로그인</title>로그인이 필요합니다') });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.blocked, true);
  assert.equal(out.fetchState, 'login_wall');
  assert.equal(out.result, undefined);
});

test('robots 불허: fetch 없이 robots_disallow', async () => {
  let fetched = false;
  const c = makeWebCollector({
    fetchImpl: async () => { fetched = true; return fakeFetch(200, 'ok')(); },
    robotsCheck: async () => false,
  });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.fetchState, 'robots_disallow');
  assert.equal(fetched, false, 'robots 불허면 fetch 자체를 안 한다');
});

test('네트워크 실패: timeout으로 정직하게(내용 없음)', async () => {
  const c = makeWebCollector({ fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.blocked, true);
  assert.equal(out.fetchState, 'timeout');
  assert.equal(out.result, undefined);
});

test('URL 없음(검색어 단독)은 이 슬라이스에서 수집 불가(정직)', async () => {
  const c = makeWebCollector({ fetchImpl: fakeFetch(200, 'x') });
  const out = await c.handler({ searchQuery: '환율' });
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /URL/);
});

test('freeform 요청문에서 URL 추출 → 수집(turn generic {request} 경로)', async () => {
  const c = makeWebCollector({ fetchImpl: fakeFetch(200, '<title>추출됨</title>본문') });
  const out = await c.handler({ request: '이 페이지 좀 봐줘 https://example.com/a 확인해줘' });
  assert.ok(out.result, 'request에서 URL 뽑아 수집');
  assert.equal(out.result.title, '추출됨');
  assert.equal(out.sources.length, 1);
});

// ── ToolRunner 통합: 출처 강제는 런타임이 한다(P6-2 계약 재확인) ──
test('ToolRunner: 실수집 성공은 sources 포함, 차단은 미확인', async () => {
  const env = { model: { authSignal: 'ok' }, connections: [{ id: 'web.collect', status: 'usable', connected: true }], grantedAuthorities: [] };
  const self = buildSelfState(env);
  const okTools = new ToolRunner({ 'web.collect': makeWebCollector({ fetchImpl: fakeFetch(200, '<title>T</title>본문') }) });
  const ok = await okTools.run('web.collect', { url: 'http://x/' }, self);
  assert.equal(ok.failureState, 'none');
  assert.ok(Array.isArray(ok.sources) && ok.sources.length >= 1, '성공엔 출처');

  const blockTools = new ToolRunner({ 'web.collect': makeWebCollector({ fetchImpl: fakeFetch(403, '접근 차단') }) });
  const blocked = await blockTools.run('web.collect', { url: 'http://x/' }, self);
  assert.equal(blocked.failureState, 'blocked');
  assert.ok(!blocked.sources || blocked.sources.length === 0, '차단엔 출처 없음(확인 못 함)');
});
