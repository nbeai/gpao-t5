import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const consoleHtml = resolve(root, 'src/surface/web/index.html');

test('진행 표면은 서버 startedAt을 사용해 3초 뒤부터 실제 경과 시간을 표시한다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  const source = html.match(/function formatActivityElapsed\(elapsedMs\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const format = Function(`${source}; return formatActivityElapsed;`)();
  assert.equal(format(2_999), '2초');
  assert.equal(format(65_000), '1분 5초');
  assert.match(html, /elapsed >= 3000/u);
  assert.match(html, /setActivityTrace\(trace, activity\.text[^\n]*activity\.startedAt\)/u);
  assert.match(html, /setActivityTrace\(trace, JSON\.parse\(e\.data\)\.text/u);
});

test('초기 세션 목록만 180ms 뒤 고정 형태 스켈레톤을 보이고 오래된 응답은 버린다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /\.session-skeleton/u);
  assert.match(html, /function scheduleSessionSkeleton\(sequence\)/u);
  assert.match(html, /sequence !== sessionLoadSequence \|\| sessionsEl\.children\.length/u);
  assert.match(html, /Array\.from\(\{ length: 3 \}/u);
  assert.match(html, /\}, 180\)/u);
  assert.match(html, /if \(sequence !== sessionLoadSequence\) return/u);
  assert.match(html, /const loadingTimer = scheduleSessionSkeleton\(sequence\);[\s\S]*fetch\('\/sessions'\)/u);
});

test('실행 중에는 중지 버튼이 있고 미완료 상태를 정형 오류 카드로 만들지 않는다', async () => {
  const html = await readFile(consoleHtml, 'utf8');
  assert.match(html, /createElement\('button'\); stop\.type = 'button'; stop\.className = 'stopbtn'/u);
  assert.match(html, /aria-label', '현재 작업 멈추기'/u);
  assert.match(html, /fetch\('\/turn\/cancel'/u);
  assert.match(html, /if \(activeLocalTurns > 0\) return/u);
  assert.doesNotMatch(html, /failure-title', '이번 작업을 끝내지 못했어요'/u);
  assert.doesNotMatch(html, /el\('msg bot error'\)/u);
  assert.match(html, /failure-reason/u);
  assert.match(html, /failure-next/u);
});
