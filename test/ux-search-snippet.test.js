import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('검색 결과는 맞은 대목을 표시하고 원 대화의 첫 일치로 이동한다', () => {
  assert.match(html, /document\.createElement\('mark'\)/);
  assert.match(html, /src\.matchStart/);
  assert.match(html, /src\.matchText/);
  assert.match(html, /scrollIntoView\(\{ block: 'center'/);
  assert.match(html, /이 대목은 접힌 이전 대화에 있어요/);
});
