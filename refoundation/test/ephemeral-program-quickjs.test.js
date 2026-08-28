import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { admitEphemeralProgramPreparation, prepareEphemeralProgram } from '../src/ephemeral-program-preparation.js';
import { assertQualifiedEphemeralProgramFixture, observeBundledQuickJsInterpreter,
  qualifyEphemeralProgramFixture } from '../src/ephemeral-program-quickjs.js';
import { makeRecordReference } from '../src/record-reference.js';
import { createHash } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function record() {
  return makeRecordReference({ sourceKind: 'local_file', sourceStore: 'managed-file', sourceId: 'g3-input',
    sourceRevision: 1, sha256: digest('actual-input'), occurredAt: null,
    recordedAt: '2026-08-29T00:00:00.000Z',
    scope: { sessionId: 'session-g3', workId: 'work-g3', subjectKeys: [], channel: null },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
}

async function prepared(root, { source = 'function transform(input) { return { sum: JSON.parse(input).reduce((a,b)=>a+b,0) }; }',
  fixture = '[1,2,3]', oracle = '{"sum":6}' } = {}) {
  const admission = admitEphemeralProgramPreparation({ capsuleId: 'capsule-g3', workId: 'work-g3', revision: 1,
    source: { fileName: 'transform.js', bytes: source }, fixture: { bytes: fixture },
    oracle: { bytes: oracle, provenance: 'independent_observer_contract' }, inputs: [record()],
    outputs: [{ relativePath: 'result/summary.json', kind: 'application/json', category: 'publishable' }] });
  return (await prepareEphemeralProgram({ admission, scratchRoot: join(root, 'scratch') })).prepared;
}

test('G3 QuickJS는 host API 0의 bounded fixture를 independent oracle과 exact 비교한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g3-quickjs-'));
  try {
    const candidate = await prepared(root); const interpreter = await observeBundledQuickJsInterpreter();
    const result = await qualifyEphemeralProgramFixture({ prepared: candidate, interpreter });
    assert.equal(assertQualifiedEphemeralProgramFixture(result.qualification), result.qualification);
    assert.equal(result.receipt.state, 'fixture_verified'); assert.equal(result.receipt.guestHostApis, 0);
    assert.equal(result.receipt.interpreter.kind, 'quickjs_wasm_release_sync');
    assert.equal(result.receipt.interpreter.version, '0.32.0');
    assert.match(result.receipt.interpreter.wasmSha256, /^[a-f0-9]{64}$/u);
    assert.deepEqual({ actualExecutions: result.receipt.actualExecutions,
      userTargetWrites: result.receipt.userTargetWrites }, { actualExecutions: 0, userTargetWrites: 0 });
    assert.equal(await readFile(join(candidate.directory, 'fixture', 'observed.output'), 'utf8'), '{"sum":6}');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G3 guest에는 process·require·fetch·Worker·Date가 없고 source가 host filesystem을 직접 볼 수 없다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g3-hostless-'));
  try {
    const source = `function transform() { return {
      process: typeof process, require: typeof require, fetch: typeof fetch,
      worker: typeof Worker, date: typeof Date
    }; }`;
    const candidate = await prepared(root, { source, fixture: 'unused',
      oracle: '{"process":"undefined","require":"undefined","fetch":"undefined","worker":"undefined","date":"undefined"}' });
    const result = await qualifyEphemeralProgramFixture({ prepared: candidate,
      interpreter: await observeBundledQuickJsInterpreter() });
    assert.equal(result.receipt.state, 'fixture_verified');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G3 memory·timeout·output limit과 oracle mismatch는 fixture_failed이며 actual 실행을 열지 않는다', async () => {
  const cases = [
    { name: 'memory', source: 'function transform(){ new ArrayBuffer(16*1024*1024); return {}; }',
      oracle: '{}', options: { memoryLimitBytes: 1024 * 1024 }, reason: 'memory_limit' },
    { name: 'timeout', source: 'function transform(){ while(true){} }', oracle: '{}',
      options: { timeoutMs: 25 }, reason: 'timeout' },
    { name: 'output', source: 'function transform(){ return "x".repeat(4096); }', oracle: '"unused"',
      options: { maxOutputBytes: 512 }, reason: 'output_limit' },
    { name: 'mismatch', source: 'function transform(){ return {value:2}; }', oracle: '{"value":1}',
      options: {}, reason: 'oracle_mismatch' },
  ];
  for (const item of cases) {
    const root = await mkdtemp(join(tmpdir(), `t5-g3-${item.name}-`));
    try {
      const candidate = await prepared(root, { source: item.source, fixture: 'unused', oracle: item.oracle });
      const result = await qualifyEphemeralProgramFixture({ prepared: candidate,
        interpreter: await observeBundledQuickJsInterpreter(), ...item.options });
      assert.equal(result.qualification, null); assert.equal(result.receipt.state, 'fixture_failed');
      assert.equal(result.receipt.reason, item.reason); assert.equal(result.receipt.actualExecutions, 0);
      await assert.rejects(qualifyEphemeralProgramFixture({ prepared: candidate,
        interpreter: await observeBundledQuickJsInterpreter() }), /already attempted/u);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('G3는 prepared source 변경과 forged interpreter를 실행 전에 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g3-stale-'));
  try {
    const candidate = await prepared(root);
    await writeFile(join(candidate.directory, candidate.manifest.source.file), 'function transform(){return {sum:9}}');
    await assert.rejects(qualifyEphemeralProgramFixture({ prepared: candidate,
      interpreter: await observeBundledQuickJsInterpreter() }), /source changed/u);
    const fresh = await prepared(join(root, 'fresh'));
    await assert.rejects(qualifyEphemeralProgramFixture({ prepared: fresh,
      interpreter: { kind: 'quickjs_wasm_release_sync', version: '0.32.0' } }), /observed bundled/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G3 QuickJS 후보는 Console에 연결되지 않고 actual input·Tool RPC·package install을 열지 않는다', async () => {
  const [source, consoleServer] = await Promise.all([
    readFile(new URL('../src/ephemeral-program-quickjs.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(consoleServer, /ephemeral-program-quickjs/u);
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|tool RPC|npm install|pip install/iu);
});

test('G3 증거는 direct Node를 폐기하고 QuickJS core와 남은 helper 격리를 분리한다', async () => {
  const value = JSON.parse(await readFile(new URL(
    '../evidence/s4-g3-fixture-qualification-candidate-2026-08-29.json', import.meta.url), 'utf8'));
  assert.equal(value.status, 'G3_ACTIVE_QUICKJS_CORE_QUALIFIED_HELPER_ISOLATION_PENDING');
  assert.equal(value.productWiring, 0); assert.equal(value.actualInputExecutions, 0);
  assert.equal(value.rejectedNodeCandidate.adopted, false);
  assert.equal(value.rejectedNodeCandidate.hardRssBoundaryProven, false);
  assert.equal(value.quickJsCandidate.hostApis, 0);
  assert.equal(value.quickJsCandidate.focusedPassed, 5);
  assert.equal(value.quickJsCandidate.focusedFailed, 0);
  assert.equal(value.dependencyAudit.quickJsAdvisoriesObserved, 0);
  assert.ok(value.remainingBeforeG3Complete.includes('one-shot managed helper'));
});
