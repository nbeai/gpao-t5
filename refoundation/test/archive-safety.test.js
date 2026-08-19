import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';

import { extractSafeZip, inspectZipArchive } from '../src/archive-safety.js';

test('ZIP manifest는 안전한 상대경로와 실제 압축·해제 크기를 먼저 관측한다', () => {
  const bytes = Buffer.from(zipSync({
    'reports/august.txt': strToU8('AUGUST-REPORT'),
    'notes.txt': strToU8('SAFE-NOTE'),
  }));
  const manifest = inspectZipArchive(bytes);
  assert.equal(manifest.state, 'safe_manifest');
  assert.equal(manifest.entries.length, 2);
  assert.deepEqual(manifest.entries.map((entry) => entry.path), ['notes.txt', 'reports/august.txt']);
  assert.equal(manifest.totalUncompressedBytes, 22);
  assert.equal(manifest.unsafeEntries.length, 0);
});

test('ZIP traversal과 압축폭탄 비율은 해제 전에 멈춘다', () => {
  const traversal = Buffer.from(zipSync({ '../outside.txt': strToU8('escape') }));
  const unsafe = inspectZipArchive(traversal);
  assert.equal(unsafe.state, 'unsafe_archive');
  assert.equal(unsafe.unsafeEntries[0].reason, 'path_traversal');

  const bomb = Buffer.from(zipSync({ 'huge.txt': strToU8('A'.repeat(2_000_000)) }, { level: 9 }));
  const compressed = inspectZipArchive(bomb, { maxCompressionRatio: 20 });
  assert.equal(compressed.state, 'unsafe_archive');
  assert.ok(compressed.unsafeEntries.some((entry) => entry.reason === 'compression_ratio_exceeded'));
});

test('safe ZIP만 별도 managed root에 풀고 원문과 hash를 확인한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-archive-safe-'));
  const bytes = Buffer.from(zipSync({ 'nested/value.txt': strToU8('ROUNDTRIP-7391') }));
  const result = await extractSafeZip({ bytes, directory: join(room, 'extract') });
  assert.equal(result.state, 'extracted');
  assert.equal(result.files.length, 1);
  assert.equal(await readFile(result.files[0].path, 'utf8'), 'ROUNDTRIP-7391');
  assert.match(result.files[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.root, await realpath(join(room, 'extract')));
});

test('unsafe ZIP은 managed root에 어떤 파일도 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-archive-stop-'));
  const bytes = Buffer.from(zipSync({ '/absolute.txt': strToU8('no') }));
  await assert.rejects(() => extractSafeZip({ bytes, directory: join(room, 'extract') }), /unsafe archive/i);
});
