import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const htmlUrl = new URL('../ui/index.html', import.meta.url);

test('배운 점 검토는 기억 설정에서만 lazy load하고 기억 패널 실패와 분리한다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const start = html.indexOf('async function renderReflectionReview');
  const end = html.indexOf('\nconst SET_RENDER =', start);
  const review = html.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.equal((html.match(/fetch\('\/reflection\/review\/state'/gu) ?? []).length, 1);
  assert.match(review, /try \{[\s\S]*fetch\('\/reflection\/review\/state'\)[\s\S]*\} catch \{/u);
  const memory = html.slice(html.indexOf('async memory()'), html.indexOf('async looks()'));
  assert.match(memory, /await renderReflectionReview\(setBody\)/u);
  assert.match(review, /기억과 기록은 그대로 확인할 수 있어요/u);
});

test('검토 UI는 sanitized detail·source·action 계약과 사용자 문장만 사용한다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const start = html.indexOf('async function renderReflectionReview');
  const end = html.indexOf('\nconst SET_RENDER =', start);
  const review = html.slice(start, end);
  for (const endpoint of ['/reflection/review/detail', '/reflection/review/source', '/reflection/review/action']) {
    assert.ok(review.includes(`fetch('${endpoint}'`));
  }
  for (const label of ['배운 점 검토', '근거', '반례', '확실하지 않은 점', '현재 교정',
    '검토용으로 남기기', '사용하지 않기', '나중에']) assert.ok(review.includes(label));
  assert.match(review, /const requestId = requestIds\.get\(decision\) \?\? reflectionReviewRequestId\(\)/u);
  assert.match(review, /requestId,\s*reviewHandle:\s*detail\.reviewHandle,\s*revisionHandle:\s*detail\.revisionHandle,\s*decision/u);
  assert.doesNotMatch(review, /innerHTML|insertAdjacentHTML|outerHTML/u);
  assert.doesNotMatch(review, /ReflectionCandidate|RecordRef|materializationDigest|candidateDigest|sourceFence|stateHistory|["']taint["']/u);
});

test('서버 데이터는 mk·textContent로만 표시하고 opaque handle은 화면 문장에 넣지 않는다', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  const start = html.indexOf('async function renderReflectionReview');
  const end = html.indexOf('\nconst SET_RENDER =', start);
  const review = html.slice(start, end);
  assert.match(review, /mk\('div', 'settings-item-title', item\.hypothesis\)/u);
  assert.match(review, /mk\('div', 'settings-item-title', detail\.hypothesis\)/u);
  assert.match(review, /destination\.textContent = response\.ok/u);
  assert.doesNotMatch(review, /mk\([^\n]*(?:reviewHandle|revisionHandle|sourceHandle)/u);
  assert.doesNotMatch(review, /\.textContent\s*=\s*(?:item|detail|source)\.(?:reviewHandle|revisionHandle|sourceHandle)/u);
});
