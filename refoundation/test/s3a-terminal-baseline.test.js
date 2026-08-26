import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createTerminalBaselineFixture, measureTerminalBaseline,
} from './helpers/s3a-terminal-baseline.js';

async function baseline() {
  const room = await mkdtemp(join(tmpdir(), 't5-s3a-terminal-'));
  try {
    const fixture = await createTerminalBaselineFixture(room);
    return await measureTerminalBaseline(fixture);
  } finally { await rm(room, { recursive: true, force: true }); }
}

test('S3-T0 봉인 fixture는 일반 파일과 당시 비밀 read 경계를 실제 실행으로 구분한다', async () => {
  const result = await baseline();
  assert.equal(result.fixture.normalReadable, true);
  assert.equal(result.fixture.privateKeyReadable, true);
  assert.equal(result.fixture.cliCredentialReadable, true);
  assert.doesNotMatch(JSON.stringify(result), /FIXTURE-PRIVATE-KEY|FIXTURE-CLI-TOKEN/u);
});

test('S3-T0 fixture는 현재 effect schema 개선과 output-store 없는 기준선 간극을 수치로 남긴다', async () => {
  const result = await baseline();
  assert.deepEqual(result.toolSurface.execRequiredTopLevel, ['command', 'cwd', 'effect']);
  assert.deepEqual(result.toolSurface.effectRequiredFields, ['kind', 'targets', 'confirmation']);
  assert.ok(result.toolSurface.schemaBytes > 0);
  assert.equal(result.foregroundOutput.truncated, true);
  assert.ok(result.foregroundOutput.omittedChars > 0);
  assert.equal(result.foregroundOutput.preservesHead, true);
  assert.equal(result.foregroundOutput.preservesTail, true);
  assert.equal(result.foregroundOutput.exactRecallHandlePresent, false);
});

test('S3-T0는 같은 process handle의 delta 관측과 terminal 정산이 이미 성립함을 보존한다', async () => {
  const result = await baseline();
  assert.equal(result.processContinuity.startedWithHandle, true);
  assert.equal(result.processContinuity.initialState, 'running');
  assert.equal(result.processContinuity.terminalState, 'completed');
  assert.equal(result.processContinuity.exitCode, 0);
  assert.equal(result.processContinuity.firstObserved, true);
  assert.equal(result.processContinuity.secondObserved, true);
  assert.equal(result.processContinuity.duplicateSecondCount, 1);
  assert.equal(result.observer.diagnostics.clockFailures, 0);
});
