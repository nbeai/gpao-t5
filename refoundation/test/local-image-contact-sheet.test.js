import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { buildLocalImageContactSheet } from '../src/local-image-contact-sheet.js';

test('local contact sheet는 최대 12개 후보를 C번호와 bounded PNG 한 장으로 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-contact-sheet-'));
  try {
    const paths = [];
    for (const [index, color] of ['#ffffff', '#336699', '#ffeecc', '#111111'].entries()) {
      const path = join(room, `${index}.png`); await writeFile(path, await sharp({ create: { width: 80 + index,
        height: 100 + index, channels: 3, background: color } }).png().toBuffer()); paths.push({ path });
    }
    const result = await buildLocalImageContactSheet(paths); assert.deepEqual(result.labels, ['C1', 'C2', 'C3', 'C4']);
    assert.equal(result.width, 720); assert.equal(result.height, 544);
    const metadata = await sharp(result.png).metadata(); assert.equal(metadata.width, 720); assert.equal(metadata.height, 544);
    await assert.rejects(buildLocalImageContactSheet(Array.from({ length: 13 }, () => paths[0])), /count/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
