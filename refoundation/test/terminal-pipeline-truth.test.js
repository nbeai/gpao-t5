import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';

async function room(work, shell = '/bin/zsh') {
  const workspace = await mkdtemp(join(tmpdir(), 't5-pipeline-truth-'));
  try { return await work(makeExecTool({ workingDirectory: workspace, shell }), workspace); }
  finally { await rm(workspace, { recursive: true, force: true }); }
}

const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null };
const run = (tool, command) => tool.execute({ command, cwd: null, effect });

test('grep no-match의 stage exit 1은 wc의 정상 결과를 Runtime 실패로 바꾸지 않는다',
  () => room(async (tool) => {
    const result = await run(tool, 'grep no-match /dev/null | wc -l');
    assert.equal(result.state, 'completed');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), '0');
    assert.deepEqual(result.pipelineObservation.stageExitCodes, [1, 0]);
    assert.equal(result.pipelineObservation.overallExitCode, 0);
  }));

test('diff의 differences exit 1은 sed가 만든 정상 비교 출력을 Runtime 실패로 바꾸지 않는다',
  () => room(async (tool, workspace) => {
    await writeFile(join(workspace, 'a'), 'old\n');
    await writeFile(join(workspace, 'b'), 'new\n');
    const result = await run(tool, "diff a b | sed -n '1,12p'");
    assert.equal(result.state, 'completed');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /< old[\s\S]*> new/u);
    assert.deepEqual(result.pipelineObservation.stageExitCodes, [1, 0]);
    assert.equal(result.pipelineObservation.overallExitCode, 0);
  }));

test('앞 pipeline 단계 nonzero는 Runtime 의미 승격 없이 stage exit 사실로 남는다', () => room(async (tool) => {
  const result = await run(tool, 'false | true');
  assert.equal(result.exitCode, 0);
  assert.equal(result.state, 'completed');
  assert.deepEqual(result.pipelineObservation, {
    state: 'observed', shell: 'zsh', scope: 'last_foreground_pipeline',
    stageExitCodes: [1, 0], overallExitCode: 0,
  });
  assert.equal(result.originalExitCode, undefined);
  assert.equal(result.reason, undefined);
  assert.equal(result.stderr, '');
}));

test('마지막 stage nonzero인 shell 실패는 기존 overall state와 exit를 그대로 보존한다',
  () => room(async (tool) => {
    const result = await run(tool, 'true | false');
    assert.equal(result.state, 'failed');
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.pipelineObservation.stageExitCodes, [0, 1]);
    assert.equal(result.pipelineObservation.overallExitCode, 1);
  }));

test('head 조기종료의 upstream exit 141도 별도 의미 없이 stage exit 사실로 남는다', () => room(async (tool) => {
  const result = await run(tool, 'yes | head -n 1');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [141, 0]);
  assert.equal(result.pipelineObservation.overallExitCode, 0);
  assert.match(result.stdout, /^y/u);
}));

test('모든 pipeline 단계 0은 기존 foreground 성공과 stdout을 보존한다', () => room(async (tool) => {
  const result = await run(tool, "printf x | sed 's/x/y/'");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [0, 0]);
  assert.equal(result.pipelineObservation.overallExitCode, 0);
  assert.equal(result.stdout, 'y');
}));

test('명령 stderr는 내부 status sideband 제거 뒤에도 그대로 보존된다', () => room(async (tool) => {
  const result = await run(tool, "printf 'warning\\n' >&2; printf x | cat");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, 'warning\n');
  assert.doesNotMatch(result.stderr, /T5_PIPELINE_STATUS/u);
}));

test('bash PIPESTATUS도 명령 의미를 정하지 않고 stage exit 사실만 보존한다', () => room(async (tool) => {
  const failed = await run(tool, 'false | true');
  assert.equal(failed.state, 'completed');
  assert.equal(failed.exitCode, 0);
  assert.deepEqual(failed.pipelineObservation.stageExitCodes, [1, 0]);
  const head = await run(tool, 'yes | head -n 1');
  assert.equal(head.exitCode, 0);
  assert.deepEqual(head.pipelineObservation.stageExitCodes, [141, 0]);
}), '/bin/bash');

test('마지막 foreground가 pipeline이 아니면 다른 명령 상태를 pipeline 관측으로 오인하지 않는다',
  () => room(async (tool) => {
    const result = await run(tool, 'false | true; printf done');
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'done');
    assert.equal(result.pipelineObservation, undefined);
  }));

test('조건 분기 안 pipeline은 실행 여부를 확정할 수 없어 stage 관측 범위에서 제외한다',
  () => room(async (tool) => {
    const result = await run(tool, 'false && printf x | cat');
    assert.equal(result.exitCode, 1);
    assert.equal(result.pipelineObservation, undefined);
  }));

test('모델이 흉내 낸 다른 marker 문자열은 Runtime sideband로 오인하지 않는다', () => room(async (tool) => {
  const result = await run(tool, "printf '__T5_PIPELINE_STATUS_fake__1,0:0\\n'; printf x | cat");
  assert.match(result.stdout, /T5_PIPELINE_STATUS_fake/u);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [0, 0]);
}));

test('KHB-S01 macOS find -printf nonzero는 stderr suppression 뒤에도 stage 사실로 남는다', {
  skip: process.platform !== 'darwin',
}, () => room(async (tool) => {
  const result = await run(tool, "find . -type f -printf '%p\\n' 2>/dev/null | head -20");
  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [1, 0]);
  assert.equal(result.pipelineObservation.overallExitCode, 0);
  assert.equal(result.stderr, '');
}));
