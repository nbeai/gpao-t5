import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeLocalImageOcr } from '../src/local-image-ocr.js';

test('macOS local OCR은 exact argv와 bounded receipt만 돌려준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-local-ocr-')); const image = join(room, 'random.png'); await writeFile(image, 'fixture');
  try {
    const calls = []; const ocr = makeLocalImageOcr({ platform: 'darwin', helper: '/runtime/t5-helper',
      runCommand: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: JSON.stringify({
        schema: 't5.local-image-ocr.v1', width: 600, height: 800, truncated: false,
        observations: [{ text: '한빛상사 4,780,000', confidence: 0.97, box: { x: 0.1, y: 0.8, width: 0.5, height: 0.1 } }],
      }) }; } });
    const result = await ocr(image, { timeoutMs: 1234 }); assert.equal(result.state, 'observed');
    assert.equal(result.text, '한빛상사 4,780,000'); assert.equal(result.engine, 'macos-vision-local');
    assert.equal(calls[0].args[0], '--ocr-image'); assert.match(calls[0].args[1], /random\.png$/u);
    assert.equal(calls[0].options.timeout, 1234);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Windows helper는 confidence unknown을 보존하고 malformed receipt는 성공으로 꾸미지 않는다', async () => {
  const windows = makeLocalImageOcr({ platform: 'win32', runCommand: async () => { throw new Error('must not run'); } });
  assert.deepEqual(await windows('/tmp/x'), { state: 'unavailable', reason: 'local_image_ocr_not_qualified' });
  const room = await mkdtemp(join(tmpdir(), 't5-local-ocr-')); const image = join(room, 'x.png'); await writeFile(image, 'x');
  try {
    const native = makeLocalImageOcr({ platform: 'win32', helper: 'C:\\T5\\t5-windows-image-ocr.exe',
      runCommand: async () => ({ stdout: JSON.stringify({ schema: 't5.local-image-ocr.v1',
        width: 100, height: 50, truncated: false,
        observations: [{ text: '한빛상사', confidence: null, box: { x: 0, y: 0, width: 1, height: 1 } }] }) }) });
    const observed = await native(image); assert.equal(observed.state, 'observed');
    assert.equal(observed.engine, 'windows-media-ocr-local');
    assert.equal(observed.observations[0].confidence, null);
    const malformed = makeLocalImageOcr({ platform: 'darwin', runCommand: async () => ({ stdout: '{}' }) });
    assert.deepEqual(await malformed(image), { state: 'unavailable', reason: 'local_image_ocr_failed' });
  } finally { await rm(room, { recursive: true, force: true }); }
});
