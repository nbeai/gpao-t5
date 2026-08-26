import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('세션 전환 UI는 제출 세션을 고정하고 목록·재진입에서 진행 상태를 복원한다', async () => {
  const html = await readFile(resolve(root, 'refoundation/ui/index.html'), 'utf8');
  const wake = await readFile(resolve(root, 'refoundation/src/wake-events.js'), 'utf8');
  assert.match(html, /submittedSessionId/u);
  assert.match(html, /renderSessionActivity/u);
  assert.match(html, /sess-status/u);
  assert.match(html, /t5:session-activity/u);
  assert.match(wake, /session_activity/u);
  assert.match(wake, /t5:session-activity/u);
  assert.doesNotMatch(html, /모델 또는 터미널 작업을 완료하지 못했어요/u);
});
