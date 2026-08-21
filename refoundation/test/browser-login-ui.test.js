import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('로그인 handoff는 대화에 지속되는 안내와 로그인 창 보기 버튼을 제공한다', async () => {
  const html = await readFile(resolve(root, 'src/surface/web/index.html'), 'utf8');
  assert.match(html, /browserHandoff/u);
  assert.match(html, /내 Chrome에서 로그인할 페이지를 열었어요/u);
  assert.match(html, /로그인 창 보기/u);
  assert.match(html, /\/browser\/login\/reveal/u);
  assert.match(html, /앞에 표시하지 못했어요/u);
  assert.doesNotMatch(html, /T5 브라우저 로그인 모두 지우기/u);
});
