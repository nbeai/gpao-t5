import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('서버 스냅샷이 늦어도 아직 안 실린 사용자 말과 받은 답을 다시 붙인다', () => {
  assert.match(html, /data-optimistic-users/);
  assert.match(html, /data-optimistic-assistants/);
  assert.match(html, /data-optimistic-session/);
  assert.match(html, /서버사용자수 <= 기준사용자수/);
  assert.match(html, /서버답수 <= 기준답수/);
  assert.match(html, /streamed\.answerText/);
});

test('새 대화는 직전 대화의 서버 발화 수를 물려받지 않는다', () => {
  const body = html.match(/async function newSession\(\) \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(body, /마지막서버사용자수 = 0/);
  assert.match(body, /마지막서버답수 = 0/);
});
