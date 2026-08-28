import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { publishAtomicFile } from '../src/atomic-file-publication.js';
import { admitEphemeralProgramPreparation, assertPreparedEphemeralProgram,
  prepareEphemeralProgram } from '../src/ephemeral-program-preparation.js';
import { makeRecordReference } from '../src/record-reference.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function record({ workId = 'work-g2', bytes = Buffer.from('actual input must not be copied') } = {}) {
  return makeRecordReference({
    sourceKind: 'local_file', sourceStore: 'managed-file', sourceId: 'source-g2', sourceRevision: 7,
    sha256: digest(bytes), occurredAt: null, recordedAt: '2026-08-29T00:00:00.000Z',
    scope: { sessionId: 'session-g2', workId, subjectKeys: [], channel: null },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
  });
}

function admission(overrides = {}) {
  return admitEphemeralProgramPreparation({
    capsuleId: 'capsule-g2', workId: 'work-g2', revision: 1,
    source: { fileName: 'transform.mjs', bytes: 'console.log("fixture only")\n' },
    fixture: { bytes: 'fixture,input\nA,1\n' },
    oracle: { bytes: 'expected,output\nA,1\n', provenance: 'independent_observer_contract' },
    inputs: [record()], outputs: [
      { relativePath: 'result/final.csv', kind: 'text/csv', category: 'publishable' },
      { relativePath: 'internal/index.json', kind: 'application/json', category: 'internal_intermediate' },
      { relativePath: 'diagnostic/run.log', kind: 'text/plain', category: 'diagnostic' },
      { relativePath: 'temporary/cache.bin', kind: 'application/octet-stream', category: 'temporary' },
    ], ...overrides,
  });
}

test('G2는 source·fixture·독립 oracle·output declaration을 scratch에 exact하게 준비하고 actual input을 복제하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g2-prepare-')); const scratch = join(root, 'scratch');
  const userInput = join(root, 'actual.csv'); const actualCanary = 'ACTUAL-PRIVATE-CONTENT-MUST-NOT-BE-COPIED';
  try {
    await writeFile(userInput, actualCanary); const accepted = admission({ inputs: [record({ bytes: Buffer.from(actualCanary) })] });
    const { prepared, receipt } = await prepareEphemeralProgram({ admission: accepted, scratchRoot: scratch,
      makeId: () => 'fixed_generation_0001' });
    assert.equal(assertPreparedEphemeralProgram(prepared), prepared);
    assert.equal(await readFile(join(prepared.directory, 'source', 'program.mjs'), 'utf8'),
      'console.log("fixture only")\n');
    assert.equal(await readFile(join(prepared.directory, 'fixture', 'input.fixture'), 'utf8'), 'fixture,input\nA,1\n');
    assert.equal(await readFile(join(prepared.directory, 'fixture', 'expected.oracle'), 'utf8'),
      'expected,output\nA,1\n');
    const manifestText = await readFile(join(prepared.directory, 'manifest.json'), 'utf8');
    assert.doesNotMatch(manifestText, new RegExp(actualCanary, 'u'));
    assert.equal(prepared.manifest.inputs[0].sha256, digest(actualCanary));
    assert.equal((await stat(prepared.directory)).mode & 0o077, 0);
    for (const path of ['source/program.mjs', 'fixture/input.fixture', 'fixture/expected.oracle',
      'outputs.json', 'manifest.json']) assert.equal((await stat(join(prepared.directory, path))).mode & 0o077, 0);
    assert.deepEqual(receipt.outputCategories,
      { publishable: 1, internal_intermediate: 1, diagnostic: 1, temporary: 1 });
    assert.deepEqual({ targetWrites: receipt.targetWrites, fixtureExecutions: receipt.fixtureExecutions,
      actualExecutions: receipt.actualExecutions, networkCalls: receipt.networkCalls,
      packageInstalls: receipt.packageInstalls, credentialReads: receipt.credentialReads },
    { targetWrites: 0, fixtureExecutions: 0, actualExecutions: 0, networkCalls: 0,
      packageInstalls: 0, credentialReads: 0 });
    assert.equal(await readFile(userInput, 'utf8'), actualCanary);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G2 한 candidate 실패는 이미 준비한 scratch 전체를 지우고 admission 재사용과 실행을 열지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g2-failure-')); const scratch = join(root, 'scratch');
  try {
    const accepted = admission(); let calls = 0;
    const publish = async (input) => { calls += 1;
      if (calls === 3) throw new Error('oracle publication failed'); return publishAtomicFile(input); };
    await assert.rejects(prepareEphemeralProgram({ admission: accepted, scratchRoot: scratch,
      makeId: () => 'failed_generation_0001', publish }), /oracle publication failed/u);
    assert.deepEqual(await readdir(scratch), []);
    await assert.rejects(prepareEphemeralProgram({ admission: accepted, scratchRoot: scratch,
      makeId: () => 'failed_generation_0002' }), /fresh capsule preparation admission/u);
    assert.throws(() => assertPreparedEphemeralProgram(accepted), /fresh prepared ephemeral program/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G2는 자기 oracle·foreign Work·output escape·duplicate와 forged admission을 준비 전에 거부한다', async () => {
  assert.throws(() => admission({ oracle: { bytes: 'claimed', provenance: 'capsule_manifest' } }),
    /oracle provenance/u);
  assert.throws(() => admission({ inputs: [record({ workId: 'other-work' })] }), /another Work/u);
  assert.throws(() => admission({ outputs: [
    { relativePath: '../escape.csv', kind: 'text/csv', category: 'publishable' },
  ] }), /declared output root/u);
  assert.throws(() => admission({ outputs: [
    { relativePath: 'same.csv', kind: 'text/csv', category: 'publishable' },
    { relativePath: 'same.csv', kind: 'text/csv', category: 'diagnostic' },
  ] }), /unique/u);
  await assert.rejects(prepareEphemeralProgram({ admission: {}, scratchRoot: '/tmp/t5-g2-forged' }),
    /fresh capsule preparation admission/u);
});

test('G2는 symlink scratch와 generation path escape를 외부 write 전에 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-g2-scratch-')); const outside = join(root, 'outside');
  const linked = join(root, 'scratch-link');
  try {
    await mkdir(outside); await writeFile(join(outside, 'sentinel.txt'), 'unchanged');
    await symlink(outside, linked, 'dir');
    await assert.rejects(prepareEphemeralProgram({ admission: admission(), scratchRoot: linked }),
      /managed directory/u);
    assert.deepEqual(await readdir(outside), ['sentinel.txt']);
    await assert.rejects(prepareEphemeralProgram({ admission: admission(), scratchRoot: join(root, 'safe'),
      makeId: () => '../outside' }), /generation is invalid/u);
    assert.deepEqual(await readdir(outside), ['sentinel.txt']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('G2 source preparation은 process·network·package 실행을 import하지 않는다', async () => {
  const [source, consoleServer] = await Promise.all([
    readFile(new URL('../src/ephemeral-program-preparation.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(source, /node:child_process|\bfetch\s*\(|npm install|pip install|tool RPC/iu);
  assert.doesNotMatch(consoleServer, /ephemeral-program-preparation/u);
});
