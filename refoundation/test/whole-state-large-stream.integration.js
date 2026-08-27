import assert from 'node:assert/strict';
import { mkdtemp, open, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createWholeStateBundle, restoreWholeStateBundle } from '../src/whole-state-bundle.js';
import { WholeStateComponentRegistry } from '../src/whole-state-component-registry.js';

test('260MiB raw state는 고정 payload 상한·Base64 전체 적재 없이 streaming v2로 왕복한다', { timeout: 120_000 }, async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whole-large-stream-')); const source = join(room, 'large.bin');
  const size = 260 * 1024 * 1024; const file = await open(source, 'w'); await file.truncate(size); await file.close();
  try {
    const registry = new WholeStateComponentRegistry(room);
    registry.register({ id: 'large-state', files: ['large.bin'], restoreOrder: 1 });
    const output = join(room, 'large.t5backup'); const baselineRss = process.memoryUsage().rss; let peakRss = baselineRss;
    const receipt = await createWholeStateBundle({ registry, outputFile: output,
      password: 'large streaming password', stagingParent: room,
      onProgress: () => { peakRss = Math.max(peakRss, process.memoryUsage().rss); } });
    assert.equal(receipt.streaming, true); assert.equal(receipt.files, 1); assert.equal(receipt.excludedFiles, 0);
    assert.ok((await stat(output)).size < 4 * 1024 * 1024);
    const destination = join(room, 'restored'); const restored = await restoreWholeStateBundle({
      bundleFile: output, password: 'large streaming password', destinationStateRoot: destination });
    assert.equal(restored.restored, true); assert.equal((await stat(join(destination, 'large.bin'))).size, size);
    assert.ok(peakRss - baselineRss < 192 * 1024 * 1024, `peak RSS delta ${peakRss - baselineRss}`);
  } finally { await rm(room, { recursive: true, force: true }); }
});
