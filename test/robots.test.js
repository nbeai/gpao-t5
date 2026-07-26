// robots.txt 실제 확인 (Phase 0 감사 보정) — 라이브에서 한 번도 안 돌던 검사를 실제로 돌린다.
// 계약: 없으면 허용, 5xx 는 금지, 가장 긴 일치가 이긴다, 같은 origin 은 한 번만 받아 온다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRobotsCheck, parseRobots, robotsAllows } from '../src/runtime/robots.js';
import { liveDeps } from '../src/surface/live-context.js';

const txt = (body, status = 200) => ({ status, text: async () => body });

test('`*` 그룹만 읽는다(다른 봇 규칙을 우리 것으로 착각하지 않는다)', () => {
  const rules = parseRobots(`
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
Allow: /private/public
`);
  assert.deepEqual(rules, [{ allow: false, path: '/private' }, { allow: true, path: '/private/public' }]);
});

// 감사 실측: 현실의 robots.txt(구글 등)는 `User-agent` 줄이 연달아 나오고 `*`·`$` 를 쓴다.
// 합성 fixture(단일 UA)로만 테스트했더니 실제 본문에서 규칙을 **전량** 잃는 것을 못 잡았다.
// 그래서 현실 형태를 그대로 재현한 본문으로 고정한다(절대원칙 1: 산출물 형태로 검증).
// `User-agent: *` 뒤에 다른 UA 줄이 이어지는 형태가 핵심이다 — 이전 파서는 여기서 `*` 그룹을
// 통째로 버렸다(뒤 UA 줄이 상태를 덮어썼다). 현실의 큰 사이트 robots.txt 가 이 모양이다.
const REAL_SHAPED = `# robots.txt
User-agent: *
User-agent: Yandex
Disallow: /search
Allow: /search/about
Disallow: /*.pdf$
Disallow: /?hl=*&
Sitemap: https://example.com/sitemap.xml

User-agent: AdsBot-Google
User-agent: AdsBot-Google-Mobile
Disallow: /maps/api

User-agent: Twitterbot
Allow: /imgres
`;

test('연속된 User-agent 줄을 한 그룹으로 읽는다(현실 형태에서 규칙을 잃지 않는다)', () => {
  const rules = parseRobots(REAL_SHAPED);
  assert.ok(rules.length >= 4, `실제 형태에서 규칙을 잃었다: ${JSON.stringify(rules)}`);
  assert.equal(robotsAllows(rules, '/search'), false);
  assert.equal(robotsAllows(rules, '/search/about'), true, '더 긴 Allow 가 이긴다');
  assert.equal(robotsAllows(rules, '/maps/api'), true, '다른 봇 그룹의 규칙을 우리 것으로 삼지 않는다');
});

test('`*`·`$` 와일드카드를 읽는다(못 읽으면 흔한 금지 규칙을 그냥 통과시킨다)', () => {
  const rules = parseRobots(REAL_SHAPED);
  assert.equal(robotsAllows(rules, '/docs/a.pdf'), false, '/*.pdf$ 가 걸려야 한다');
  assert.equal(robotsAllows(rules, '/docs/a.pdf.html'), true, '$ 는 끝맞춤이다');
  assert.equal(robotsAllows(rules, '/?hl=ko&q=1'), false);
});

test('Sitemap·Crawl-delay 같은 줄이 그룹을 끊지 않는다', () => {
  const rules = parseRobots('User-agent: *\nSitemap: https://e.com/s.xml\nDisallow: /x');
  assert.equal(robotsAllows(rules, '/x'), false);
});

test('가장 긴 일치가 이긴다', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b');
  assert.equal(robotsAllows(rules, '/a/x'), false);
  assert.equal(robotsAllows(rules, '/a/b/c'), true);
  assert.equal(robotsAllows(rules, '/other'), true);
});

test('빈 Disallow 는 전부 허용, 주석은 무시한다', () => {
  assert.deepEqual(parseRobots('User-agent: *\nDisallow:   # 전부 허용'), []);
  assert.equal(robotsAllows(parseRobots('User-agent: *\nDisallow:'), '/무엇이든'), true);
});

test('robots 가 막은 경로는 금지, 허용한 경로는 통과', async () => {
  const check = makeRobotsCheck({ fetchImpl: async () => txt('User-agent: *\nDisallow: /admin') });
  assert.equal(await check('https://example.com/admin/page'), false);
  assert.equal(await check('https://example.com/news/1'), true);
});

test('robots.txt 가 없으면(404) 허용한다 — 못 읽었다고 사용자를 막지 않는다', async () => {
  const check = makeRobotsCheck({ fetchImpl: async () => txt('', 404) });
  assert.equal(await check('https://example.com/any'), true);
});

test('네트워크가 죽어도 막다른 답을 만들지 않는다(허용)', async () => {
  const check = makeRobotsCheck({ fetchImpl: async () => { throw new Error('network down'); } });
  assert.equal(await check('https://example.com/any'), true);
});

test('사이트가 5xx 면 긁지 않는다(보수적 금지)', async () => {
  const check = makeRobotsCheck({ fetchImpl: async () => txt('', 503) });
  assert.equal(await check('https://example.com/any'), false);
});

test('같은 origin 은 한 번만 받아 온다(페이지마다 robots 를 다시 치지 않는다)', async () => {
  let calls = 0;
  const check = makeRobotsCheck({ fetchImpl: async () => { calls += 1; return txt('User-agent: *\nDisallow: /x'); } });
  await check('https://example.com/a');
  await check('https://example.com/b');
  await check('https://other.com/a');
  assert.equal(calls, 2, 'origin 당 1회');
});

// 절대원칙 1 — 배선이 실제로 라이브에 있는가. 이게 빠져서 검사가 통째로 안 돌았다.
test('라이브 수집기에 robots 검사가 실제로 배선돼 있다', () => {
  const collector = liveDeps({}).tools?.tools?.['web.collect'];
  assert.ok(collector, '라이브에 web.collect 가 있어야 한다');
  assert.equal(typeof collector.robotsCheck, 'function', '주입이 없으면 robots 검사는 한 줄도 돌지 않는다');
});
