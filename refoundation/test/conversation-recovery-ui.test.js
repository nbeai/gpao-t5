import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('회복권은 모델 답장이 아니라 대화 카드와 항상 접근 가능한 대화 메뉴에 있다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /같은 자리에서 진행되지 않고 있어요/u);
  assert.match(html, /이 대화 상태 다시 준비/u);
  assert.match(html, /새 대화에서 이어가기/u);
  assert.match(html, /\/sessions\/recover/u);
  assert.match(html, /activeRecoveryIds/u);
  assert.doesNotMatch(html, /["'`]Doctor["'`]|Run reset|thread reset/u);
});
