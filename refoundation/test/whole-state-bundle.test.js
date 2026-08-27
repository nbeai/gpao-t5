import assert from 'node:assert/strict';
import { createCipheriv, randomBytes, scrypt as rawScrypt } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { activatePreparedWholeStateRestore, createWholeStateBundle, restoreWholeStateBundle,
  stageWholeStateGeneration, wholeStateTreeDigest } from '../src/whole-state-bundle.js';
import { WholeStateComponentRegistry } from '../src/whole-state-component-registry.js';

const scrypt = promisify(rawScrypt);

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
    assert.equal(receipt.encrypted, true); assert.equal(receipt.streaming, true);
    const encrypted = await readFile(bundle);
    assert.equal(encrypted.subarray(0, 8).toString('ascii'), 'T5WB002\n');
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
        const offset = text.indexOf('t5.whole-state-encrypted.v2'); bytes.write('t5.whole-state-encrypted.v3', offset, 'ascii'); await writeFile(bundle, bytes); }
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

test('기존 Base64 JSON v1 backup은 생성하지 않지만 restore 호환은 유지한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-v1-'));
  try {
    const { registry } = await fixture(room); const manifest = await registry.manifest({
      generationId: '99999999-9999-4999-8999-999999999999', createdAt: '2026-08-27T00:00:00.000Z' });
    const files = [];
    for (const component of manifest.components) for (const file of component.files) if (!file.state) {
      const bytes = await readFile(join(registry.stateRoot, file.path)); files.push({ path: file.path,
        bytes: file.bytes, sha256: file.sha256, data: bytes.toString('base64') });
    }
    const salt = randomBytes(16); const iv = randomBytes(12); const password = 'legacy backup password';
    const key = Buffer.from(await scrypt(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
    const cipher = createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify({ manifest, files }))), cipher.final()]); const tag = cipher.getAuthTag(); key.fill(0);
    const header = Buffer.from(JSON.stringify({ schema: 't5.whole-state-encrypted.v1',
      kdf: { name: 'scrypt', N: 16_384, r: 8, p: 1, salt: salt.toString('base64') },
      cipher: { name: 'aes-256-gcm', iv: iv.toString('base64'), tagBytes: 16 } }));
    const length = Buffer.alloc(4); length.writeUInt32BE(header.length); const bundle = join(room, 'legacy.t5backup');
    await writeFile(bundle, Buffer.concat([Buffer.from('T5WB001\n'), length, header, encrypted, tag]));
    const destination = join(room, 'restored'); const result = await restoreWholeStateBundle({
      bundleFile: bundle, password, destinationStateRoot: destination });
    assert.equal(result.restored, true); assert.match(await readFile(join(destination, 'console-sessions.json'), 'utf8'), /sessions/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('v2는 기존 output을 덮지 않고 실패한 partial archive를 정리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-v2-publish-'));
  try {
    const { registry } = await fixture(room); const output = join(room, 'backup.t5backup');
    await createWholeStateBundle({ registry, outputFile: output, password: 'atomic publish password', stagingParent: room });
    const before = await readFile(output);
    await assert.rejects(() => createWholeStateBundle({ registry, outputFile: output,
      password: 'atomic publish password', stagingParent: room }), { code: 'EEXIST' });
    assert.deepEqual(await readFile(output), before);
    const failed = join(room, 'failed.t5backup');
    await assert.rejects(() => createWholeStateBundle({ registry, outputFile: failed, password: 'short', stagingParent: room }),
      /password/u);
    assert.equal((await readdir(room)).some((name) => name.includes('failed.t5backup') && name.endsWith('.partial')), false);
  } finally { await rm(room, { recursive: true, force: true }); }
});
