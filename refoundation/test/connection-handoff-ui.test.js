import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('자연어로 시작한 계정 연결은 대화 안에서 사용자 동의·완료·재연결 상태를 보여준다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  const server = await readFile(resolve(root, 'refoundation/src/console-server.js'), 'utf8');
  assert.match(html, /connectionHandoff/u);
  assert.match(html, /계정 연결 계속하기/u);
  assert.match(html, /열린 화면에서 계정을 선택하고 허용/u);
  assert.match(html, /activeConnectionHandoffIds/u);
  assert.match(server, /connection_completed/u);
  assert.doesNotMatch(html, /access_token|refresh_token|client_secret/u);
});
