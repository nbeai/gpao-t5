import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { activatePreparedWholeStateRestore, createWholeStateBundle, restoreWholeStateBundle,
  stageWholeStateGeneration, wholeStateTreeDigest } from '../src/whole-state-bundle.js';
import { WholeStateComponentRegistry } from '../src/whole-state-component-registry.js';

async function fixture(room) {
  const source = join(room, 'source'); await mkdir(join(source, 'work'), { recursive: true });
  await writeFile(join(source, 'console-sessions.json'), '{"version":1,"sessions":[]}');
  await writeFile(join(source, 'work', 'events.jsonl'), '{"schema":"t5.work-event.v1"}\n');
  const registry = new WholeStateComponentRegistry(source);
  registry.register({ id: 'sessions', files: ['console-sessions.json'], restoreOrder: 10 });
  registry.register({ id: 'work', files: ['work/events.jsonl'], restoreOrder: 20, relationships: ['sessions'] });
  return { source, registry };
}

test('staging은 source와 copied hash가 generation manifest와 모두 같을 때만 선다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-stage-'));
  try {
    const { source, registry } = await fixture(room);
    await assert.rejects(() => stageWholeStateGeneration({ registry, stagingParent: room,
      generationId: '11111111-1111-4111-8111-111111111111', createdAt: '2026-08-27T00:00:00.000Z',
      afterSourceManifest: () => writeFile(join(source, 'work', 'events.jsonl'), 'changed') }),
    { code: 'T5_BACKUP_SOURCE_CHANGED' });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('bundle은 manifest와 payload를 함께 암호화하고 올바른 암호만 격리 복원한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-bundle-'));
  try {
    const { registry } = await fixture(room); const bundle = join(room, 'backup.t5backup');
    const receipt = await createWholeStateBundle({ registry, outputFile: bundle, password: 'correct horse battery',
      stagingParent: room, generationId: '22222222-2222-4222-8222-222222222222', createdAt: '2026-08-27T00:00:00.000Z' });
    assert.equal(receipt.encrypted, true);
    const encrypted = await readFile(bundle);
    assert.equal(encrypted.includes(Buffer.from('console-sessions')), false);
    assert.equal(encrypted.includes(Buffer.from('t5.work-event')), false);
    const destination = join(room, 'restored');
    const restored = await restoreWholeStateBundle({ bundleFile: bundle, password: 'correct horse battery',
      destinationStateRoot: destination });
    assert.equal(restored.restored, true); assert.equal(restored.externalEffectsRetried, 0);
    assert.equal((await readFile(join(destination, 'console-sessions.json'), 'utf8')).includes('sessions'), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('wrong password·부분 손상·version 불일치·relationship 실패는 기존 destination을 한 byte도 바꾸지 않는다', async () => {
  for (const fault of ['password', 'cipher', 'partial', 'version', 'relationship']) {
    const room = await mkdtemp(join(tmpdir(), `t5-whole-restore-${fault}-`));
    try {
      const { registry } = await fixture(room); const bundle = join(room, 'backup.t5backup');
      await createWholeStateBundle({ registry, outputFile: bundle, password: 'correct horse battery',
        stagingParent: room, generationId: '33333333-3333-4333-8333-333333333333', createdAt: '2026-08-27T00:00:00.000Z' });
      if (fault === 'cipher') { const bytes = await readFile(bundle); bytes[bytes.length - 20] ^= 0xff; await writeFile(bundle, bytes); }
      if (fault === 'partial') { const bytes = await readFile(bundle); await writeFile(bundle, bytes.subarray(0, bytes.length - 40)); }
      if (fault === 'version') { const bytes = await readFile(bundle); const text = bytes.toString('binary');
        const offset = text.indexOf('t5.whole-state-encrypted.v1'); bytes.write('t5.whole-state-encrypted.v2', offset, 'ascii'); await writeFile(bundle, bytes); }
      const destination = join(room, 'current'); await mkdir(destination); await writeFile(join(destination, 'sentinel'), 'CURRENT');
      await assert.rejects(() => restoreWholeStateBundle({ bundleFile: bundle,
        password: fault === 'password' ? 'wrong password value' : 'correct horse battery',
        destinationStateRoot: destination,
        validateRelationships: fault === 'relationship' ? async () => { throw new Error('broken relationship'); } : undefined }));
      assert.equal(await readFile(join(destination, 'sentinel'), 'utf8'), 'CURRENT');
    } finally { await rm(room, { recursive: true, force: true }); }
  }
});

test('prepared activation은 digest를 다시 확인하고 현재 상태를 rollback sibling으로 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-activate-'));
  try {
    const prepared = join(room, 'prepared'); const current = join(room, 'state');
    await mkdir(prepared); await mkdir(current); await writeFile(join(prepared, 'new.json'), '{"new":true}');
    await writeFile(join(current, 'old.json'), '{"old":true}');
    const digest = await wholeStateTreeDigest(prepared);
    const result = await activatePreparedWholeStateRestore({ preparedStateRoot: prepared,
      destinationStateRoot: current, expectedStateDigest: digest });
    assert.equal(result.previousStatePreserved, true); assert.equal(await readFile(join(current, 'new.json'), 'utf8'), '{"new":true}');
    assert.equal(await readFile(join(room, result.previousStateName, 'old.json'), 'utf8'), '{"old":true}');
  } finally { await rm(room, { recursive: true, force: true }); }
});
