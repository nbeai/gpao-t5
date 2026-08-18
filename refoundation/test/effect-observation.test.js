import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { observeDeclaredEffect } from '../src/effect-observation.js';
import { makeExecTool } from '../src/exec-tool.js';

test('선언된 로컬 target만 존재·종류·크기·hash로 관측한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-effect-observe-'));
  try {
    const target = join(root, 'target.txt');
    const missing = await observeDeclaredEffect({
      kind: 'local_change', targets: [target], summary: '생성',
    }, root);
    assert.equal(missing.targets[0].exists, false);
    await writeFile(target, 'hello', 'utf8');
    const present = await observeDeclaredEffect({
      kind: 'local_change', targets: [target], summary: '생성',
    }, root);
    assert.equal(present.targets[0].exists, true);
    assert.equal(present.targets[0].type, 'file');
    assert.equal(present.targets[0].size, 5);
    assert.match(present.targets[0].sha256, /^[0-9a-f]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('foreground exec Receipt는 선언 효과와 target 전후 현실을 분리해 남긴다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-effect-exec-'));
  try {
    const target = join(root, 'created.txt');
    const tool = makeExecTool({ workspace: root });
    const result = await tool.execute({
      command: `printf created > '${target}'`, cwd: null,
      effect: {
        kind: 'local_change', summary: '파일 생성', targets: [target],
        reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null,
      },
    });
    assert.equal(result.effectObservation.declared.kind, 'local_change');
    assert.equal(result.effectObservation.before.targets[0].exists, false);
    assert.equal(result.effectObservation.after.targets[0].exists, true);
    assert.equal(result.effectObservation.changed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('외부 효과는 선언과 실행 결과를 기록하되 실제 도착을 관측한 척하지 않는다', async () => {
  const observed = await observeDeclaredEffect({
    kind: 'external_send', targets: ['https://example.invalid'], summary: '전송',
  }, '/tmp');
  assert.equal(observed.scope, 'external');
  assert.equal(observed.observed, false);
});
