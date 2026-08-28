import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeExecTool } from '../src/exec-tool.js';

async function room(work, shell = '/bin/zsh') {
  const workspace = await mkdtemp(join(tmpdir(), 't5-pipeline-truth-'));
  try { return await work(makeExecTool({ workingDirectory: workspace, shell })); }
  finally { await rm(workspace, { recursive: true, force: true }); }
}

const effect = { kind: 'observe', targets: [], confirmation: 'not_applicable', rollbackOfToolCallId: null };
const run = (tool, command) => tool.execute({ command, cwd: null, effect });

test('앞 pipeline 단계 실패는 마지막 exit 0에 숨지 않고 stage truth로 실패한다', () => room(async (tool) => {
  const result = await run(tool, 'false | true');
  assert.equal(result.originalExitCode, 0);
  assert.equal(result.exitCode, 1);
  assert.equal(result.state, 'pipeline_stage_failed');
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [1, 0]);
  assert.deepEqual(result.pipelineObservation.hiddenFailureIndices, [0]);
  assert.equal(result.stderr, '');
}));

test('정상 head 조기종료의 upstream exit 141은 사실로 남기고 숨은 실패로 승격하지 않는다', () => room(async (tool) => {
  const result = await run(tool, 'yes | head -n 1');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [141, 0]);
  assert.deepEqual(result.pipelineObservation.upstreamExit141Indices, [0]);
  assert.deepEqual(result.pipelineObservation.hiddenFailureIndices, []);
  assert.match(result.stdout, /^y/u);
}));

test('모든 pipeline 단계 0은 기존 foreground 성공과 stdout을 보존한다', () => room(async (tool) => {
  const result = await run(tool, "printf x | sed 's/x/y/'");
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [0, 0]);
  assert.deepEqual(result.pipelineObservation.hiddenFailureIndices, []);
  assert.equal(result.stdout, 'y');
}));

test('명령 stderr는 내부 status sideband 제거 뒤에도 그대로 보존된다', () => room(async (tool) => {
  const result = await run(tool, "printf 'warning\\n' >&2; printf x | cat");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, 'warning\n');
  assert.doesNotMatch(result.stderr, /T5_PIPELINE_STATUS/u);
}));

test('bash PIPESTATUS도 같은 숨은 실패와 exit 141 사실을 보존한다', () => room(async (tool) => {
  const failed = await run(tool, 'false | true');
  assert.equal(failed.state, 'pipeline_stage_failed');
  assert.deepEqual(failed.pipelineObservation.stageExitCodes, [1, 0]);
  const head = await run(tool, 'yes | head -n 1');
  assert.equal(head.exitCode, 0);
  assert.deepEqual(head.pipelineObservation.upstreamExit141Indices, [0]);
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

test('KHB-S01 macOS find -printf 실패는 stderr suppression과 head 뒤에도 실패다', {
  skip: process.platform !== 'darwin',
}, () => room(async (tool) => {
  const result = await run(tool, "find . -type f -printf '%p\\n' 2>/dev/null | head -20");
  assert.equal(result.state, 'pipeline_stage_failed');
  assert.equal(result.originalExitCode, 0);
  assert.deepEqual(result.pipelineObservation.stageExitCodes, [1, 0]);
  assert.equal(result.stderr, '');
}));
