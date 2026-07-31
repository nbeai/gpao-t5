import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { makeWebCollector, httpToFetchState } from '../src/runtime/web-collector.js';
import { classifyWebFetch } from '../src/kernel/l2-plan/web-tool.js';
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
  // P2-11: 429 는 **봇 차단이 아니라 속도 제한**이다. 예전엔 bot_wall 로 묶어 "봇 차단이 걸려
  // 있어요"라고 말했는데, 사실이 아니고 사용자는 "원래 안 되는 사이트"로 오해한다.
  // 잠시 뒤면 되는 일이고, 대개는 **우리가 너무 자주 물어서** 생긴다(실측 2026-07-27).
  assert.equal(httpToFetchState(429), 'rate_limited');
  assert.equal(httpToFetchState(503), 'rate_limited', '서버가 잠시 쉬라는 것도 같다');
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
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
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

// 감사 보정(P6-5): 끝나지 않는 응답은 timeoutMs 후 timeout으로 잡힌다 — Work Chat이 멈추지 않는다.
// (이 테스트가 hang 없이 끝나는 것 자체가 시간 제한이 실제로 동작한다는 증거.)
test('timeout: 끝나지 않는 fetch는 timeoutMs 후 timeout(blocked, 내용·출처 없음)', async () => {
  const hanging = () => new Promise(() => {}); // 영원히 미해결(signal 무시)
  const c = makeWebCollector({ fetchImpl: hanging, timeoutMs: 30 });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.blocked, true);
  assert.equal(out.fetchState, 'timeout');
  assert.equal(out.result, undefined, '못 봤으면 내용 없음');
  assert.ok(!out.sources, '못 봤으면 출처 없음');
  assertWebEvidence(out);
});

// 본문 읽기가 멈춰도 잡힌다(헤더는 왔지만 text()가 안 끝나는 경우).
test('timeout: 본문(text) 지연도 timeout으로 잡힌다', async () => {
  const slowBody = async () => ({ status: 200, url: 'http://x/', headers: { get: () => 'text/html' }, text: () => new Promise(() => {}) });
  const c = makeWebCollector({ fetchImpl: slowBody, timeoutMs: 30 });
  const out = await c.handler({ url: 'http://x/' });
  assert.equal(out.fetchState, 'timeout');
  assert.equal(out.result, undefined);
});

// 시간 제한 안에 끝나는 응답은 정상 성공(경계가 정상 요청을 막지 않는다).
test('timeout 경계: 제한 안에 끝나면 정상 수집', async () => {
  const quick = async () => { await new Promise((r) => setTimeout(r, 5)); return { status: 200, url: 'http://x/', headers: { get: () => 'text/html' }, text: async () => '<title>빠름</title>본문' }; };
  const c = makeWebCollector({ fetchImpl: quick, timeoutMs: 200 });
  const out = await c.handler({ url: 'http://x/' });
  assert.ok(out.result, '제한 안이면 성공');
  assert.equal(out.result.title, '빠름');
});

// Phase 0-2 로 계약이 바뀌었다: 주소가 없으면 **찾아서 실제로 읽는다**(검색만 하고 아는 척 금지).
test('주소가 없으면 찾아서 읽고, 출처는 실제로 읽은 페이지다', async () => {
  const search = { search: async () => ({ state: 'ok', provider: 'duckduckgo', providerLabel: '덕덕고',
    results: [{ title: '한국은행', url: 'https://www.bok.or.kr/rate', snippet: '' }], tried: ['duckduckgo'] }) };
  // 실제 fetch 는 최종 URL 을 res.url 로 준다 — 가짜도 그렇게 흉내 낸다.
  const fetched = [];
  const fetchImpl = async (u) => {
    fetched.push(u);
    return { status: 200, url: u, headers: { get: () => 'text/html' }, text: async () => '<title>기준금리</title>본문' };
  };
  const c = makeWebCollector({ fetchImpl, search });
  const out = await c.handler({ query: '한국은행 기준금리' });
  assert.equal(out.blocked, undefined);
  assert.deepEqual(fetched, ['https://www.bok.or.kr/rate'], '찾은 페이지를 실제로 읽는다(스니펫으로 때우지 않는다)');
  assert.equal(out.sources.length, 1);
  assert.equal(out.sources[0].sourceUrl, 'https://www.bok.or.kr/rate', '실제로 읽은 페이지가 출처다');
  assert.match(out.userSafeSummary, /찾아서 읽었어요/);
  assert.equal(out.result.foundVia.provider, '덕덕고');
});

test('검색 경로가 모두 막히면 정직하게 말하고 대안을 준다(연결 권유는 이때만)', async () => {
  const search = { search: async () => ({ state: 'unavailable', tried: ['duckduckgo'] }) };
  const c = makeWebCollector({ fetchImpl: fakeFetch(200, 'x'), search });
  const out = await c.handler({ query: '요즘 뉴스' });
  assert.equal(out.blocked, true);
  assert.match(out.userSafeSummary, /찾아보지 못했/);
  assert.ok(out.nextSafeAction.includes('주소'), '지금 할 수 있는 길도 함께 준다');
});

test('검색이 되는데 연결을 권하지 않는다(오너 지시 — 절대 규칙)', async () => {
  const search = { search: async () => ({ state: 'ok', provider: 'duckduckgo', providerLabel: '덕덕고',
    results: [{ title: 'T', url: 'https://a.example/1', snippet: '' }], tried: ['duckduckgo'] }) };
  const c = makeWebCollector({ fetchImpl: fakeFetch(200, '<title>T</title>본문'), search });
  const out = await c.handler({ query: '질의' });
  assert.ok(!JSON.stringify(out).includes('연결하면'), '되는데 설정을 요구하면 안 된다');
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

// 오너 실사용(2026-07-27): 웹 검색·브라우징·스크래핑을 다 붙여 놨는데 **아무것도 못 읽었다**.
// 원인: 본문 어딘가에 "로그인" 단어가 하나만 있어도 login_wall 로 판정했다. 한국 사이트 대부분에
// 로그인 링크가 있으니 2층 수집이 통째로 죽어 있었다(위키백과조차 막힘으로 나왔다).
test('본문을 건졌으면 벽으로 판정하지 않는다(로그인 링크 하나로 막던 오판)', () => {
  const page = '로그인 회원가입 홈 뉴스 ' + '실제 본문입니다. '.repeat(30);
  assert.equal(classifyWebFetch({ body: page }), 'login_wall', '건진 게 없으면 신호대로 벽');
  assert.equal(classifyWebFetch({ body: page, readableChars: 500 }), 'ok', '본문을 건졌으면 읽은 것이다');
});

test('아무것도 못 건졌는데 로그인 신호만 있으면 그때는 벽이다', () => {
  assert.equal(classifyWebFetch({ body: '로그인이 필요합니다', readableChars: 20 }), 'login_wall');
});

test('httpToFetchState 도 건진 분량을 함께 본다', () => {
  assert.equal(httpToFetchState(200, { body: '로그인', readableChars: 1000 }), 'ok');
  assert.equal(httpToFetchState(200, { body: '로그인', readableChars: 0 }), 'login_wall');
  assert.equal(httpToFetchState(401, { body: '', readableChars: 9999 }), 'login_wall', '401 은 분량과 무관하게 벽');
});

// 오너 지시(2026-07-27): 네이버는 모바일 주소로 바꿔 적용한다.
// 근거(실측): map.naver.com 은 robots 차단이지만 m.place.naver.com 은 허용이고 내용이 HTML 에 있다.
test('네이버 지도 주소는 읽을 수 있는 모바일 주소로 바꾼다', async () => {
  const { preferReadableUrl } = await import('../src/runtime/web-collector.js');
  assert.equal(
    preferReadableUrl('https://map.naver.com/p/entry/place/1747125291?lng=127'),
    'https://m.place.naver.com/place/1747125291/home',
  );
  assert.equal(preferReadableUrl('https://blog.naver.com/someone/123'), 'https://m.blog.naver.com/someone/123');
  assert.equal(preferReadableUrl('https://example.com/a'), 'https://example.com/a', '관계없는 주소는 그대로');
  assert.equal(preferReadableUrl('그냥 글자'), '그냥 글자', '주소가 아니면 건드리지 않는다');
});

// robots 는 **후보마다** 확인해야 한다. 원래 주소로만 보면 바꾼 주소가 허용인데도 시도조차 못 한다.
test('원래 주소가 막혀도 허용된 대체 주소는 시도한다', async () => {
  const seen = [];
  const collector = makeWebCollector({
    fetchImpl: async (url) => {
      seen.push(url);
      return { status: 200, url, text: async () => '<html><body><article><p>' + '읽을 수 있는 본문입니다. '.repeat(20) + '</p></article></body></html>' };
    },
    robotsCheck: async (u) => !u.includes('map.naver.com'), // 데스크톱만 차단
  });
  const out = await collector.handler({ request: 'https://map.naver.com/p/entry/place/123' });
  assert.ok(!out.blocked, `막히면 안 된다: ${out.userSafeSummary}`);
  assert.ok(seen.some((u) => u.includes('m.place.naver.com')), '허용된 대체 주소를 시도해야 한다');
  assert.ok(!seen.some((u) => u.includes('map.naver.com')), 'robots 가 막은 주소는 치지 않는다');
});

test('사용자 대신 여는 도구임을 밝히는 요청 헤더를 보낸다(헤더 없이는 429 로 막힌다)', async () => {
  let headers;
  const collector = makeWebCollector({
    fetchImpl: async (url, init) => {
      headers = init?.headers;
      return { status: 200, url, text: async () => '<html><body><article><p>' + '본문입니다. '.repeat(30) + '</p></article></body></html>' };
    },
  });
  await collector.handler({ request: 'https://example.com/a' });
  assert.ok(headers?.['user-agent'], 'User-Agent 없이 요청하면 주요 서비스가 막는다(실측 429)');
  assert.match(headers['accept-language'], /ko/);
});
