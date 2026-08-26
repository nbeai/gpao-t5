import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('작업 기록 UI는 기본 접힘·lazy GET·textContent 전용이며 내부 ID를 표시하지 않는다', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(html, /<details class="work-history" id="workHistory">/u);
  assert.doesNotMatch(html, /<details class="work-history" id="workHistory" open/u);
  const start = html.indexOf('async function loadWorkHistory');
  const end = html.indexOf("document.getElementById('listtabs')", start);
  const code = html.slice(start, end);
  assert.match(code, /new URLSearchParams/u);
  assert.match(code, /fetch\(`\/work-history\?\$\{params\}`\)/u);
  assert.match(code, /event\.currentTarget\.open/u);
  assert.match(code, /textContent = '대화 열기'/u);
  assert.match(code, /workHistoryQuery/u);
  assert.match(code, /payload\.nextCursor/u);
  assert.doesNotMatch(code, /새 대화에서 이어서 요청하기|\/work-history\/continue/u);
  assert.doesNotMatch(code, /innerHTML|runId|workId|sha256|filePath|toISOString/u);
});
