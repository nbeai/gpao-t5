import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const evidencePath = new URL('refoundation/evidence/s3-a-s6-state-context-shadow-2026-08-26.json', root);

test('S6 evidence는 local replay 우위를 관측해도 Event Kernel 구현으로 승격하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidencePath, 'utf8'));
  assert.equal(value.productCodeChanged, false);
  assert.equal(value.design.modelProviderCalled, false);
  assert.equal(value.fixtures.qualityPasses, '12/12');
  assert.ok(value.groups['long_session:cold_process'].stateReadReplayMedianMs
    > value.groups['long_session:cold_process'].contextCompilationMedianMs);
  assert.ok(value.groups['long_session:warm_resident'].stateReadReplayMedianMs
    > value.groups['long_session:warm_resident'].contextCompilationMedianMs);
  assert.match(value.interpretation.decision, /Do not open Event Kernel or SQLite/u);
});

test('S6 evidence의 production source와 test-shadow artifact digest가 현재 파일과 일치한다', async () => {
  const value = JSON.parse(await readFile(evidencePath, 'utf8'));
  const sources = {
    'conversation-ledger.js': 'refoundation/src/conversation-ledger.js',
    'work-store.js': 'refoundation/src/work-store.js',
    'memory-ledger.js': 'refoundation/src/memory-ledger.js',
    'conversation-checkpoint.js': 'refoundation/src/conversation-checkpoint.js',
    'information-context.js': 'refoundation/src/information-context.js',
    'conversation-projection.js': 'refoundation/src/conversation-projection.js',
    'context-receipt.js': 'refoundation/src/context-receipt.js',
  };
  const artifacts = {
    fixtureAndProbe: 'refoundation/test/helpers/s3a-s6-state-context.js',
    contractTest: 'refoundation/test/s3a-s6-state-context-shadow.test.js',
    worker: 'refoundation/scripts/run-s3a-s6-probe-worker.mjs',
    runner: 'refoundation/scripts/run-s3a-s6-state-context-shadow.mjs',
  };
  for (const [name, path] of Object.entries(sources)) {
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    assert.equal(actual, value.sourceDigests[name], path);
  }
  for (const [name, path] of Object.entries(artifacts)) {
    const actual = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex');
    assert.equal(actual, value.artifactDigests[name], path);
  }
});
