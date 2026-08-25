import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('설정은 우측 overlay panel이 아니라 독립 경로·전체 작업면·브라우저 back을 가진 정식 page다', async () => {
  const [html, server] = await Promise.all([
    readFile(resolve(root, 'src/surface/web/index.html'), 'utf8'),
    readFile(resolve(root, 'refoundation/src/console-server.js'), 'utf8'),
  ]);
  assert.equal(server.includes("url.pathname === '/settings'"), true);
  assert.equal(server.includes("/^\\/settings\\/[a-z0-9-]+$/u.test(url.pathname)"), true);
  assert.match(html, /#setov \{ position:fixed; inset:0 0 0 var\(--side-width\)/u);
  assert.match(html, /#setpanel \{[^}]*width:100%;[^}]*box-shadow:none/su);
  assert.match(html, /history\.pushState\(\{ t5View: 'settings', section \}, '', path\)/u);
  assert.match(html, /window\.addEventListener\('popstate'/u);
  assert.match(html, /settingsSectionFromPath\(window\.location\.pathname\)/u);
  assert.doesNotMatch(html, /#tbov, #setov \{ position:fixed; inset:0;[^}]*background:rgba/su);
});

test('도구와 연결 page는 OAuth와 사업자 credential을 같은 Connection Truth에서 그린다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /action\.kind === 'credentials'/u);
  assert.match(html, /connection\.credentialRequest\?\.fields/u);
  assert.match(html, /type = field\.secret \? 'password' : 'text'/u);
  assert.match(html, /JSON\.stringify\(\{ credentials \}\)/u);
  assert.doesNotMatch(html, /localStorage\.setItem\([^\n]*credential/iu);
  assert.match(html, /mk\('div', 'connection-catalog-grid'\)/u);
  assert.match(html, /connectionIcon\(entry\.id, entry\.label, entry\.iconUrl\)/u);
});

test('한국 사업자 catalog는 아이콘·용도·연결 준비 상태를 서비스별로 가진다', async () => {
  const catalog = JSON.parse(await readFile(resolve(root,
    'refoundation/config/korea-business-connection-catalog.json'), 'utf8'));
  const byId = Object.fromEntries(catalog.entries.map((entry) => [entry.id, entry]));
  for (const id of ['kakaotalk', 'naver', 'naver-works', 'google-workspace', 'microsoft-365', 'notion',
    'slack', 'telegram', 'naver-smartstore', 'coupang-wing', 'kakao-channel', 'instagram-business',
    'youtube', 'channel-talk', 'shopify', 'shopee']) {
    assert.ok(byId[id]); assert.ok(byId[id].icon); assert.ok(byId[id].description); assert.ok(byId[id].availability);
  }
});
