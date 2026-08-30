import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('6차 설치 제품은 proposal-only learning을 기본 활성화하고 Core 기본값은 명시적으로 유지한다', async () => {
  const entry = await readFile(new URL('../scripts/start-console.mjs', import.meta.url), 'utf8');
  const server = await readFile(new URL('../src/console-server.js', import.meta.url), 'utf8');
  assert.match(entry, /makeConsoleServer\(\{[\s\S]*learningReviewMode: 'proposal'/u);
  assert.match(server, /learningReviewMode = 'off'/u);
  assert.match(server, /learningReviewMode === 'proposal'[\s\S]*learningReviewer\?\.consider/u);
  assert.doesNotMatch(entry, /learningReviewIdleMs:\s*0/u);
  const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(ui, /sk\.learned \? '경험에서 배움'/u);
  assert.match(ui, /sk\.candidate \? '검증 중'/u);
});
