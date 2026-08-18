import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWebReadTool, normalizeWebUrl, webUserAgentForPlatform } from '../src/web-read-tool.js';

test('URL은 사람이 쓴 IRI를 보존해 안전한 HTTP 주소로 정규화한다', () => {
  assert.equal(
    normalizeWebUrl('example.com/한글 문서?q=작은 가게'),
    'https://example.com/%ED%95%9C%EA%B8%80%20%EB%AC%B8%EC%84%9C?q=%EC%9E%91%EC%9D%80%20%EA%B0%80%EA%B2%8C',
  );
  assert.throws(() => normalizeWebUrl('https://user:secret@example.com/private'), /credentials/i);
  assert.throws(() => normalizeWebUrl('file:///Users/test/secret'), /protocol/i);
});

test('웹 요청의 브라우저 현실은 현재 운영체제를 따르고 macOS에 고정되지 않는다', () => {
  assert.match(webUserAgentForPlatform('darwin'), /Macintosh/);
  assert.match(webUserAgentForPlatform('win32'), /Windows NT/);
  assert.match(webUserAgentForPlatform('linux'), /Linux x86_64/);
});

test('web_read는 redirect 원주소와 최종주소를 모두 남기고 최종 HTML 본문을 읽는다', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === 'https://example.com/start') {
      return new Response('', { status: 302, headers: { location: '/article' } });
    }
    return new Response(`<!doctype html><html><head><title>가게 소식</title>
      <link rel="canonical" href="https://example.com/article"></head><body><main><article>
      <h1>가게 소식</h1><p>${'오늘의 실제 본문입니다. '.repeat(20)}</p></article></main></body></html>`, {
      status: 200, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  };
  const tool = makeWebReadTool({ fetchImpl, resolveHost: async () => ['93.184.216.34'] });
  const result = await tool.execute({ url: 'https://example.com/start', maxChars: 20_000 });

  assert.deepEqual(calls, ['https://example.com/start', 'https://example.com/article']);
  assert.equal(result.state, 'read');
  assert.equal(result.source.requestedUrl, 'https://example.com/start');
  assert.equal(result.source.finalUrl, 'https://example.com/article');
  assert.equal(result.source.canonicalUrl, 'https://example.com/article');
  assert.deepEqual(result.source.redirects, [{ status: 302, from: 'https://example.com/start', to: 'https://example.com/article' }]);
  assert.equal(result.source.contentType, 'text/html');
  assert.equal(result.source.trust, 'untrusted_external');
  assert.equal(result.content.instructionAuthority, 'none');
  assert.match(result.content.text, /오늘의 실제 본문/);
  assert.equal(result.content.truncated, false);
});

test('web_read는 resolver가 밝힌 읽기 좋은 주소를 쓰되 원주소와 전략을 보존한다', async () => {
  const seen = [];
  const tool = makeWebReadTool({
    urlResolvers: [{ id: 'mobile-ssr', resolve() { return { url: 'https://m.example.com/place/7', reason: 'mobile_ssr' }; } }],
    resolveHost: async () => ['93.184.216.34'],
    fetchImpl: async (url, init) => {
      seen.push({ url, headers: init.headers });
      return new Response(`<html><head><title>모바일 장소</title></head><body><article><p>${'읽히는 장소 정보 '.repeat(30)}</p></article></body></html>`, {
        status: 200, headers: { 'content-type': 'text/html' },
      });
    },
  });
  const result = await tool.execute({ url: 'https://desktop.example.com/place/7', maxChars: 10_000 });
  assert.equal(seen[0].url, 'https://m.example.com/place/7');
  assert.match(seen[0].headers['user-agent'], /Mozilla\/5\.0/);
  assert.equal(result.source.requestedUrl, 'https://desktop.example.com/place/7');
  assert.deepEqual(result.source.readStrategy, {
    resolver: 'mobile-ssr', reason: 'mobile_ssr', selectedUrl: 'https://m.example.com/place/7',
  });
  assert.match(result.content.text, /읽히는 장소 정보/);
});

test('web_read는 SPA HTML에 심긴 균형 JSON에서 사람이 읽을 데이터를 함께 관측한다', async () => {
  const html = `<html><head><title>팔식당 : 네이버\u001c</title></head><body><div id="root"></div>
    <footer>이용약관 고객센터</footer><script>
    window.__APOLLO_STATE__={"Place:7":{"__typename":"Place","id":"7","name":"팔식당","category":"돼지고기구이","address":"서울 강남구 도산대로90길 7","description":"신선한 한돈을 직접 손질합니다.","imageUrl":"https://secret.example/image.jpg","menus":[{"name":"숙성 생갈비","price":"23000"}]}};
    </script>${'<script src="chunk.js"></script>'.repeat(300)}</body></html>`;
  const tool = makeWebReadTool({
    fetchImpl: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    resolveHost: async () => ['93.184.216.34'],
  });
  const result = await tool.execute({ url: 'https://example.com/place/7', maxChars: 10_000 });
  assert.equal(result.state, 'partial_dynamic');
  assert.equal(result.source.title, '팔식당 : 네이버');
  assert.equal(result.source.embeddedData.present, true);
  assert.equal(result.source.embeddedData.itemLimitReached, false);
  assert.match(result.content.text, /팔식당/);
  assert.match(result.content.text, /서울 강남구 도산대로90길 7/);
  assert.match(result.content.text, /숙성 생갈비/);
  assert.doesNotMatch(result.content.text, /secret\.example/);
});

test('web_read는 로그인벽과 동적 껍데기를 읽기 성공으로 꾸미지 않는다', async (t) => {
  await t.test('401 로그인벽', async () => {
    const tool = makeWebReadTool({
      fetchImpl: async () => new Response('login', { status: 401, headers: { 'content-type': 'text/html' } }),
      resolveHost: async () => ['93.184.216.34'],
    });
    const result = await tool.execute({ url: 'https://example.com/account', maxChars: 10_000 });
    assert.equal(result.state, 'login_required');
    assert.equal(result.content, null);
  });

  await t.test('자바스크립트 껍데기', async () => {
    const tool = makeWebReadTool({
      fetchImpl: async () => new Response('<html><head><title>앱</title></head><body><div id="root"></div><script src="app.js"></script></body></html>', {
        status: 200, headers: { 'content-type': 'text/html' },
      }),
      resolveHost: async () => ['93.184.216.34'],
    });
    const result = await tool.execute({ url: 'https://example.com/app', maxChars: 10_000 });
    assert.equal(result.state, 'dynamic_required');
    assert.equal(result.content, null);
    assert.equal(result.capabilityBoundary.required, 'browser_render');
  });

  await t.test('큰 동적 페이지에서 footer 일부만 읽힌 경우', async () => {
    const shell = `<html><head><title>사업주 화면</title></head><body><div id="root"></div>
      <footer>${'이용약관 고객센터 사업자정보 '.repeat(20)}</footer><script>${'x'.repeat(12_000)}</script></body></html>`;
    const tool = makeWebReadTool({
      fetchImpl: async () => new Response(shell, { status: 200, headers: { 'content-type': 'text/html' } }),
      resolveHost: async () => ['93.184.216.34'],
    });
    const result = await tool.execute({ url: 'https://example.com/owner', maxChars: 10_000 });
    assert.equal(result.state, 'partial_dynamic');
    assert.match(result.content.text, /이용약관/);
    assert.equal(result.source.coverage.kind, 'partial_dynamic');
    assert.equal(result.source.coverage.browserMayRevealMore, true);
    assert.deepEqual(result.capabilityBoundary, {
      required: 'browser_render', available: false, staticObservationExhausted: true,
    });
  });
});

test('web_read는 큰 JSON을 본 범위만 돌려주고 생략량을 정확히 밝힌다', async () => {
  const payload = JSON.stringify({ rows: Array.from({ length: 200 }, (_, index) => ({ index, value: `VALUE-${index}` })) });
  const tool = makeWebReadTool({
    fetchImpl: async () => new Response(payload, { status: 200, headers: { 'content-type': 'application/json' } }),
    resolveHost: async () => ['93.184.216.34'],
  });
  const result = await tool.execute({ url: 'https://example.com/data.json', maxChars: 500 });

  assert.equal(result.state, 'read');
  assert.equal(result.content.truncated, true);
  assert.equal(result.content.text.length, 500);
  assert.equal(result.content.omittedChars, result.content.totalChars - 500);
  assert.equal(result.source.contentType, 'application/json');
});

test('web_read는 public URL이 private 주소로 해석되거나 redirect되면 fetch하지 않는다', async () => {
  let calls = 0;
  const tool = makeWebReadTool({
    fetchImpl: async () => { calls += 1; return new Response('should not run'); },
    resolveHost: async () => ['127.0.0.1'],
  });
  const result = await tool.execute({ url: 'https://example.com/internal', maxChars: 1000 });
  assert.equal(calls, 0);
  assert.equal(result.state, 'blocked');
  assert.equal(result.reason, 'private_network');
});
