import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('오래된 콘솔 화면은 새 런타임을 감지하고 초안·첨부를 보존한 복구를 안내한다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  const wake = await readFile(resolve(root, 'refoundation/src/wake-events.js'), 'utf8');

  assert.match(wake, /runtime_ready/u);
  assert.match(wake, /t5:runtime-changed/u);
  assert.match(html, /t5:runtime-changed/u);
  assert.match(html, /T5가 새로 준비됐어요/u);
  assert.match(html, /화면 다시 연결/u);
  assert.match(html, /sessionStorage/u);
  assert.match(html, /stagedAttachments/u);
  assert.match(html, /text\.value/u);
  assert.match(html, /activeLocalTurns/u);
  assert.match(html, /location\.reload/u);
});
