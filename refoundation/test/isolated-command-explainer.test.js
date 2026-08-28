import assert from 'node:assert/strict';
import test from 'node:test';

import { makeProcessStartTool } from '../src/exec-tool.js';
import { IsolatedCommandExplainer } from '../src/isolated-command-explainer.js';

test('isolated command explainer는 동시 요청을 exact identity로 돌리고 정상 종료한다', async () => {
  const explainer = new IsolatedCommandExplainer();
  try {
    const commands = Array.from({ length: 8 }, (_, index) => `printf 'item-${index}'`);
    const results = await Promise.all(commands.map((command) => explainer.explain(command)));
    assert.deepEqual(results.map((result) => result.source), commands);
    assert.deepEqual(results.map((result) => result.steps[0].argv[1]),
      commands.map((_, index) => `item-${index}`));
  } finally { await explainer.close(); }
  assert.equal(explainer.child, null);
});

test('제품 explainer failure는 managed process를 시작하기 전에 fail closed한다', async () => {
  let starts = 0;
  const registry = { async start() { starts += 1; return { state: 'completed' }; },
    async stopOwner() {}, forget() {} };
  const tool = makeProcessStartTool({ workingDirectory: process.cwd(), processRegistry: registry,
    explainCommand: async () => { throw Object.assign(new Error('helper died'), {
      code: 'T5_COMMAND_EXPLAINER_UNAVAILABLE',
    }); } });
  await assert.rejects(() => tool.execute({ command: "printf 'must-not-run'", cwd: null,
    effect: { kind: 'observe', targets: [] } }), /helper died/u);
  assert.equal(starts, 0);
});
