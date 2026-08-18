import test from 'node:test';
import assert from 'node:assert/strict';

import { scoreFileDiscoveryAnswer } from '../src/skill-value-comparison.js';

test('비교기는 같은 정답의 절대경로와 작업공간 상대경로를 모두 목적 달성으로 본다', () => {
  const input = {
    workspace: '/private/tmp/workspace',
    expectedPath: '/private/tmp/workspace/recent/비아이5.txt',
    execCalls: 1,
  };
  assert.deepEqual(scoreFileDiscoveryAnswer({
    ...input, answer: '찾음: /private/tmp/workspace/recent/비아이5.txt',
  }), { passed: true, absolutePathReported: true });
  assert.deepEqual(scoreFileDiscoveryAnswer({
    ...input, answer: '찾음: ./recent/비아이5.txt',
  }), { passed: true, absolutePathReported: false });
});

test('미발견은 정직한 답과 제한된 탐색을 함께 만족해야 통과한다', () => {
  const common = { workspace: '/tmp/workspace', expectedPath: null };
  assert.equal(scoreFileDiscoveryAnswer({ ...common, answer: '찾지 못했습니다.', execCalls: 1 }).passed, true);
  assert.equal(scoreFileDiscoveryAnswer({ ...common, answer: '찾았습니다.', execCalls: 1 }).passed, false);
  assert.equal(scoreFileDiscoveryAnswer({ ...common, answer: '없습니다.', execCalls: 3 }).passed, false);
});
