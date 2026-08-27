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

test('Windows와 malformed native receipt는 OCR 성공으로 꾸미지 않는다', async () => {
  const windows = makeLocalImageOcr({ platform: 'win32', runCommand: async () => { throw new Error('must not run'); } });
  assert.deepEqual(await windows('/tmp/x'), { state: 'unavailable', reason: 'local_image_ocr_not_qualified' });
  const room = await mkdtemp(join(tmpdir(), 't5-local-ocr-')); const image = join(room, 'x.png'); await writeFile(image, 'x');
  try { const malformed = makeLocalImageOcr({ platform: 'darwin', runCommand: async () => ({ stdout: '{}' }) });
    assert.deepEqual(await malformed(image), { state: 'unavailable', reason: 'local_image_ocr_failed' });
  } finally { await rm(room, { recursive: true, force: true }); }
});
