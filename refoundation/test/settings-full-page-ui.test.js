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
});
