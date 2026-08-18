import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';
import {
  PROJECT_CASES, assessProjectCase, materializeProjectCase, snapshotProject,
} from '../src/project-qualification.js';

test('두 프로젝트 fixture는 서로 다른 결함과 사용자 표현을 가진다', () => {
  assert.equal(PROJECT_CASES.length, 2);
  assert.notEqual(PROJECT_CASES[0].request, PROJECT_CASES[1].request);
  assert.notDeepEqual(PROJECT_CASES[0].sourcePaths, PROJECT_CASES[1].sourcePaths);
});

for (const definition of PROJECT_CASES) {
  test(`${definition.id}: 시작 fixture의 실제 테스트는 실패한다`, async () => {
    const root = await mkdtemp(join(tmpdir(), `t5-project-${definition.id}-`));
    try {
      await materializeProjectCase(definition, root);
      const result = await makeExecTool({ workspace: root }).execute({ command: 'npm test', cwd: null });
      assert.notEqual(result.exitCode, 0);
      assert.match(result.stderr + result.stdout, /fail|error|AssertionError|ERR_ASSERTION/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test('판정은 소스 변경·테스트 불변·최종 test 성공·모델 실행 영수증의 논리곱이다', () => {
  const definition = PROJECT_CASES[0];
  const before = {
    'src/add.js': 'old-source', 'test/add.test.js': 'same-test', 'package.json': 'same-package',
  };
  const after = {
    'src/add.js': 'new-source', 'test/add.test.js': 'same-test', 'package.json': 'same-package',
  };
  const agentResult = {
    status: 'completed', answer: '원인을 고치고 테스트를 확인했습니다.',
    receipts: [{
      actualCall: { name: 'exec', args: { command: 'npm test' } },
      outcome: 'succeeded', result: { exitCode: 0 },
    }],
  };
  const verdict = assessProjectCase({
    definition, before, after,
    baselineTest: { exitCode: 1 }, finalTest: { exitCode: 0 }, agentResult,
  });
  assert.equal(verdict.passed, true);
  assert.deepEqual(verdict.checks, {
    baselineFailed: true,
    finalPassed: true,
    sourceChanged: true,
    protectedUnchanged: true,
    modelCompleted: true,
    modelRanTests: true,
  });
});

test('모델이 테스트를 고쳐 초록을 만들면 판정은 실패한다', () => {
  const definition = PROJECT_CASES[0];
  const before = {
    'src/add.js': 'old-source', 'test/add.test.js': 'old-test', 'package.json': 'same-package',
  };
  const after = {
    'src/add.js': 'old-source', 'test/add.test.js': 'changed-test', 'package.json': 'same-package',
  };
  const verdict = assessProjectCase({
    definition, before, after,
    baselineTest: { exitCode: 1 }, finalTest: { exitCode: 0 },
    agentResult: {
      status: 'completed', answer: '됐습니다.',
      receipts: [{
        actualCall: { name: 'exec', args: { command: 'npm test' } },
        outcome: 'succeeded', result: { exitCode: 0 },
      }],
    },
  });
  assert.equal(verdict.passed, false);
  assert.equal(verdict.checks.protectedUnchanged, false);
  assert.equal(verdict.checks.sourceChanged, false);
});

test('snapshot은 프로젝트 상대 경로별 내용 digest를 만든다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-project-snapshot-'));
  try {
    await materializeProjectCase(PROJECT_CASES[0], root);
    const snapshot = await snapshotProject(root);
    assert.ok(snapshot['src/add.js']);
    assert.ok(snapshot['test/add.test.js']);
    assert.notEqual(snapshot['src/add.js'], snapshot['test/add.test.js']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
