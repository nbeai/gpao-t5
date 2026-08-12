import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('실제로 닫는 입구는 모두 같은 말 닫기를 쓴다', () => {
  assert.match(html, /id="selCancel">닫기<\/button>/);
  assert.match(html, /id="tb-x"[^>]*>닫기<\/button>/);
  assert.match(html, /id="set-x"[^>]*>닫기<\/button>/);
  assert.match(html, /id="set-back"[^>]*>닫기<\/a>/);
  assert.match(html, /id="search-icon"/);
  assert.match(html, /searchIcon\.style\.display = open \? 'none' : ''/);
  assert.doesNotMatch(html, /id="(?:tb|set)-x"[^>]*>✕<\/button>/);
  assert.doesNotMatch(html, /id="set-back"[^>]*>← 대화로 돌아가기<\/a>/);
});
