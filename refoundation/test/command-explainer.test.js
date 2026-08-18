import test from 'node:test';
import assert from 'node:assert/strict';

import { explainShellCommand } from '../src/command-explainer.js';

test('파이프와 조건 연쇄를 실제 명령 단계와 operator로 추출한다', async () => {
  const source = 'find . -type f | sort && printf done';
  const result = await explainShellCommand(source);
  assert.equal(result.ok, true);
  assert.deepEqual(result.steps.map((step) => step.executable), ['find', 'sort', 'printf']);
  assert.deepEqual(result.steps.map((step) => step.argv), [
    ['find', '.', '-type', 'f'], ['sort'], ['printf', 'done'],
  ]);
  assert.deepEqual(result.operators.map((operator) => operator.kind), ['pipe', 'and']);
  assert.ok(result.shapes.includes('pipeline'));
  assert.ok(result.shapes.includes('and'));
  assert.equal(result.steps[0].text, 'find . -type f');
});

test('명령 치환 안의 실행도 nested step으로 보존한다', async () => {
  const result = await explainShellCommand('printf "%s\\n" "$(git rev-parse HEAD)"');
  assert.equal(result.ok, true);
  assert.ok(result.steps.some((step) => step.executable === 'printf' && step.context === 'top-level'));
  assert.ok(result.steps.some((step) => step.executable === 'git' && step.context === 'command-substitution'));
});

test('문법 오류는 실행 가능한 명령인 척하지 않고 parse error를 남긴다', async () => {
  const result = await explainShellCommand("printf '닫히지 않음");
  assert.equal(result.ok, false);
  assert.equal(result.hasParseError, true);
});

test('지나치게 큰 명령은 파서에 넣지 않는다', async () => {
  await assert.rejects(
    () => explainShellCommand(`printf x ${'a'.repeat(128 * 1024)}`),
    /too large to explain/,
  );
});
