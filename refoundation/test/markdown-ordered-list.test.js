import assert from 'node:assert/strict';
import test from 'node:test';

import { renderMarkdown } from '../ui/markdown.js';

test('빈 줄로 나뉜 ordered list도 원문의 1·2·3 시작 번호를 보존한다', () => {
  assert.equal(renderMarkdown([
    '1. 첫째',
    '',
    '2. 둘째',
    '',
    '3. 셋째',
  ].join('\n')), [
    '<ol><li>첫째</li></ol>',
    '<ol start="2"><li>둘째</li></ol>',
    '<ol start="3"><li>셋째</li></ol>',
  ].join(''));
});

test('붙어 있는 반복 1. 표식은 Markdown 관례대로 한 목록에서 자연 증가한다', () => {
  assert.equal(renderMarkdown([
    '1. 첫째',
    '1. 둘째',
    '1. 셋째',
  ].join('\n')), '<ol><li>첫째</li><li>둘째</li><li>셋째</li></ol>');
});

test('unordered list가 사이에 있어도 각 ordered list의 명시 번호를 잃지 않는다', () => {
  assert.equal(renderMarkdown([
    '2. 둘째',
    '',
    '- 참고',
    '',
    '3. 셋째',
  ].join('\n')), [
    '<ol start="2"><li>둘째</li></ol>',
    '<ul><li>참고</li></ul>',
    '<ol start="3"><li>셋째</li></ol>',
  ].join(''));
});

test('ordered list 시작 번호 보존은 기존 HTML escape 경계를 넓히지 않는다', () => {
  const rendered = renderMarkdown('2. <img src=x onerror="alert(1)"> [실행](javascript:alert(1))');
  assert.equal(rendered,
    '<ol start="2"><li>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; [실행](javascript:alert(1))</li></ol>');
  assert.doesNotMatch(rendered, /<img|onerror="|href="javascript:/u);
});
