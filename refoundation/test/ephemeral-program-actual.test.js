import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { assertExecutedEphemeralProgram, executeEphemeralProgramActual } from '../src/ephemeral-program-actual.js';
import { admitEphemeralProgramPreparation, prepareEphemeralProgram } from '../src/ephemeral-program-preparation.js';
import { observeBundledQuickJsInterpreter, qualifyEphemeralProgramFixture } from '../src/ephemeral-program-quickjs.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeRecordSourceReader } from '../src/record-source-reader.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const registry = () => new ManagedProcessRegistry({
  platform: process.platform === 'win32' ? 'linux' : process.platform, outputLimit: 128 * 1024,
});

function reference(id, bytes) {
  return makeRecordReference({ sourceKind: 'local_file', sourceStore: 'managed-file', sourceId: id,
    sourceRevision: 1, sha256: digest(bytes), occurredAt: null, recordedAt: '2026-08-29T00:00:00.000Z',
    scope: { sessionId: 'session-g4', workId: 'work-g4', subjectKeys: [], channel: null },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available' });
}

async function setup(root) {
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const values = new Map(); const inputs = [];
  for (const [id, text] of [['a', 'A,10\n'], ['b', 'B,20\n']]) {
    const path = join(workspace, `${id}.csv`); const bytes = Buffer.from(text); await writeFile(path, bytes);
    values.set(id, { root: workspace, path }); inputs.push(reference(id, bytes));
  }
  const source = `function transform(input) {
    const value = JSON.parse(input);
    if (Array.isArray(value)) return { fixtureCount: value.length };
    return { outputs: { "result/summary.json": JSON.stringify({ inputCount: value.inputs.length,
      lines: value.inputs.map((item) => item.text.trim()) }) } };
  }`;
  const admission = admitEphemeralProgramPreparation({ capsuleId: 'capsule-g4', workId: 'work-g4', revision: 1,
    source: { fileName: 'transform.js', bytes: source }, fixture: { bytes: '[1]' },
    oracle: { bytes: '{"fixtureCount":1}', provenance: 'independent_observer_contract' }, inputs,
    outputs: [{ relativePath: 'result/summary.json', kind: 'application/json', category: 'publishable' }] });
  const prepared = (await prepareEphemeralProgram({ admission, scratchRoot: join(root, 'scratch') })).prepared;
  const qualification = (await qualifyEphemeralProgramFixture({ prepared,
    interpreter: await observeBundledQuickJsInterpreter(), processRegistry: registry() })).qualification;
  const sourceReader = makeRecordSourceReader({ mode: 'O2_full_shadow',
    localFileResolver: async (item) => values.get(item.sourceId) });
  return { workspace, values, inputs, qualification, sourceReader };
}

test('G4는 exact RecordRef 두 개를 reopen해 qualified source를 한 번 실행하고 unverified scratch candidate만 만든다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g4-actual-'));
  try {
    const fixture = await setup(root); const before = await Promise.all(['a', 'b'].map((id) => (
      readFile(fixture.values.get(id).path))));
    const result = await executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: fixture.sourceReader, processRegistry: registry() });
    assert.equal(assertExecutedEphemeralProgram(result.execution), result.execution);
    assert.equal(result.receipt.state, 'actual_output_unverified'); assert.equal(result.receipt.inputCount, 2);
    assert.equal(result.receipt.actualExecutions, 1); assert.equal(result.receipt.userTargetWrites, 0);
    const output = JSON.parse(await readFile(result.execution.outputPath, 'utf8'));
    assert.deepEqual(output, { outputs: { 'result/summary.json': '{"inputCount":2,"lines":["A,10","B,20"]}' } });
    assert.deepEqual(await Promise.all(['a', 'b'].map((id) => readFile(fixture.values.get(id).path))), before);
    await assert.rejects(executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: fixture.sourceReader, processRegistry: registry() }), /already attempted/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4 input이 실행 전에 바뀌면 helper·candidate·user write 0이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g4-stale-before-'));
  try {
    const fixture = await setup(root); await writeFile(fixture.values.get('a').path, 'changed');
    let starts = 0; const processes = { async start() { starts += 1; } };
    const result = await executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: fixture.sourceReader, processRegistry: processes });
    assert.equal(result.execution, null); assert.match(result.receipt.reason, /input_changed/u);
    assert.equal(result.receipt.actualExecutions, 0); assert.equal(starts, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4 input이 helper 실행 뒤 바뀌면 output candidate를 publish하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g4-stale-after-'));
  try {
    const fixture = await setup(root); let rounds = 0;
    const changingReader = { async reopen(reference, scope) {
      rounds += 1;
      if (rounds === fixture.inputs.length + 1) await writeFile(fixture.values.get('a').path, 'late-change');
      return fixture.sourceReader.reopen(reference, scope);
    } };
    const result = await executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: changingReader, processRegistry: registry() });
    assert.equal(result.execution, null); assert.equal(result.receipt.reason, 'input_changed_after_execution');
    assert.equal(result.receipt.actualExecutions, 1);
    await assert.rejects(readFile(join(fixture.qualification.prepared.directory, 'actual', 'output.candidate.json')),
      { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G4 helper cancel은 no-effect로 닫히고 같은 qualification을 재실행하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g4-cancel-'));
  try {
    const fixture = await setup(root); const controller = new AbortController(); controller.abort();
    const result = await executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: fixture.sourceReader, processRegistry: registry(), signal: controller.signal });
    assert.equal(result.execution, null); assert.equal(result.receipt.reason, 'cancelled');
    assert.equal(result.receipt.actualExecutions, 1); assert.equal(result.receipt.userTargetWrites, 0);
    await assert.rejects(executeEphemeralProgramActual({ qualification: fixture.qualification,
      sourceReader: fixture.sourceReader, processRegistry: registry() }), /already attempted/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
