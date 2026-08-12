import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('큰 대화는 최근 80개만 그리고 생략 수와 원문 보존을 말한다', () => {
  assert.match(html, /const 최근대화표시한도 = 80/);
  assert.match(html, /대화\.slice\(-최근대화표시한도\)/);
  assert.match(html, /이전 대화 \$\{접은수\}개는 화면에서 접어 두었어요/);
  assert.match(html, /저장된 원문은 그대로예요/);
});
