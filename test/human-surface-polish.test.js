import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fallbackReplyFrom } from '../src/kernel/turn.js';

const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

test('성공 영수증이 있으면 설명 실패를 사용자 재요청으로 바꾸지 않는다', () => {
  const reply = fallbackReplyFrom([{
    failureState: 'none',
    userSafeSummary: '정산_요약.txt를 만들었어요.',
  }]);
  assert.match(reply, /정산_요약/);
  assert.doesNotMatch(reply, /다시.*말씀/);
});

test('기본 스마트 승인은 카드에 모드 설명을 반복하지 않는다', () => {
  assert.doesNotMatch(html, /smart:\s*['"]스마트['"]/, '기본 상태를 매 승인마다 설명한다');
});

test('승인 카드는 별도 봇 말풍선 없이 현재 행동 하나로 말한다', () => {
  const branch = html.slice(html.indexOf("if (r.kind === 'approval')"), html.indexOf("const box = turnBox();", html.indexOf("if (r.kind === 'approval')") + 30));
  assert.doesNotMatch(branch, /r\.reply/, '승인 카드 앞에 같은 내용을 답 말풍선으로 반복한다');
});

test('모델 답이 있으면 복구 문장을 답 뒤에 자동으로 덧붙이지 않는다', () => {
  assert.match(html, /r\.reply\?\.trim\(\)\s*\?\s*r\.reply\s*:\s*\(r\.nextSafeAction/);
});

test('일반 merge 후속은 조용히 합치고 실제 interrupt만 상태로 알린다', () => {
  assert.match(html, /r\.followUp\?\.decision\s*===\s*['"]interrupt['"]/);
});
