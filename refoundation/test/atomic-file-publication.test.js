import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { observePublicationPreimage, publishAtomicFile } from '../src/atomic-file-publication.js';

test('atomic publication은 same-directory replace·sync·readback과 기존 mode를 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-atomic-publish-')); const target = join(root, 'result.txt');
  try {
    await writeFile(target, 'old'); await chmod(target, 0o640);
    const preimage = await observePublicationPreimage(target);
    const result = await publishAtomicFile({ target, bytes: 'new-complete', expectedPreimage: preimage });
    assert.equal(result.state, 'published'); assert.equal(result.effectUnknown, false);
    assert.equal(await readFile(target, 'utf8'), 'new-complete');
    assert.equal((await observePublicationPreimage(target)).mode, 0o640);
    assert.equal((await readdir(root)).some((name) => name.includes('.t5-')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('stale preimage와 replace 전 실패는 target을 바꾸지 않고 temp를 정리한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-atomic-stale-')); const target = join(root, 'result.txt');
  try {
    await writeFile(target, 'old'); const stale = await observePublicationPreimage(target); await writeFile(target, 'changed');
    await assert.rejects(publishAtomicFile({ target, bytes: 'new', expectedPreimage: stale }), /preimage changed/u);
    assert.equal(await readFile(target, 'utf8'), 'changed');
    const current = await observePublicationPreimage(target);
    await assert.rejects(publishAtomicFile({ target, bytes: 'new', expectedPreimage: current,
      io: { rename: async () => { throw new Error('rename failed'); } } }), /rename failed/u);
    assert.equal(await readFile(target, 'utf8'), 'changed');
    assert.equal((await readdir(root)).some((name) => name.includes('.t5-')), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('directory sync 실패는 이미 바뀐 target을 not_published로 꾸미지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-atomic-dir-sync-')); const target = join(root, 'result.txt');
  try {
    const actualOpen = (await import('node:fs/promises')).open;
    const result = await publishAtomicFile({ target, bytes: 'landed', expectedPreimage: null,
      io: { open: async (path, flags, mode) => {
        const handle = await actualOpen(path, flags, mode);
        if (flags === 'r') handle.sync = async () => { throw new Error('dir sync failed'); };
        return handle;
      } } });
    assert.equal(result.state, 'published_durability_unknown'); assert.equal(result.effectUnknown, true);
    assert.equal(await readFile(target, 'utf8'), 'landed');
  } finally { await rm(root, { recursive: true, force: true }); }
});
