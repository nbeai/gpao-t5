import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('일반 사용자는 설정에서 연결 상태와 가능한 다음 행동을 다시 확인할 수 있다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /연결 상태 확인/u);
  assert.match(html, /\/connections\/doctor/u);
  assert.match(html, /다시 확인/u);
  assert.match(html, /연결됨|연결 필요|사용 가능|확인 필요/u);
  assert.doesNotMatch(html, /oauth_pending_internal|connector_state_enum/u);
});
