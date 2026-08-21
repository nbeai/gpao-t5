import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('로그인 handoff는 눈앞의 T5 브라우저에서 사용자가 직접 로그인하도록 안내한다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /browserHandoff/u);
  assert.match(html, /로그인 창을 열었어요/u);
  assert.match(html, /눈앞에 열린 T5 브라우저/u);
  assert.match(html, /앞에 표시하지 못해 여기서 멈췄어요/u);
  assert.doesNotMatch(html, /원격 디버깅|Chrome 연결/u);
  assert.doesNotMatch(html, /T5 브라우저 로그인 모두 지우기/u);
});

test('제품 진입점은 0.1.1의 대화별 visible T5 브라우저를 사용하고 공용 host·원격 연결을 열지 않는다', async () => {
  const source = await readFile(resolve(root, 'refoundation/scripts/start-console.mjs'), 'utf8');
  assert.match(source, /makeAgentBrowserDriver/u);
  assert.match(source, /sessionNameForOwner/u);
  assert.doesNotMatch(source, /makePersistentBrowserHost|makeUserChrome|chrome-devtools-mcp/u);
});
