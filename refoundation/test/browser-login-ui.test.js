import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('일반 대화 UI는 전용 T5 브라우저 handoff를 표시하지 않는다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  assert.doesNotMatch(html, /browserHandoff/u);
  assert.doesNotMatch(html, /눈앞에 열린 T5 브라우저/u);
  assert.doesNotMatch(html, /원격 디버깅|Chrome 연결/u);
  assert.doesNotMatch(html, /T5 브라우저 로그인 모두 지우기/u);
});

test('제품 진입점은 기존 관리 Browser driver를 Console에 연결하고 별도 host를 만들지 않는다', async () => {
  const source = await readFile(resolve(root, 'refoundation/scripts/start-console.mjs'), 'utf8');
  assert.match(source, /makeAgentBrowserDriver/u);
  assert.match(source, /browserDriverFactory/u);
  assert.match(source, /clientInstanceId: runtimeGenerationId/u);
  assert.doesNotMatch(source, /makePersistentBrowserHost/u);
  assert.doesNotMatch(source, /browserHost/u);
  assert.doesNotMatch(source, /makeUserChrome|chrome-devtools-mcp/u);
});
