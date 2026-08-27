import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileIntelligenceIndex } from '../src/file-intelligence-index.js';

function identity(value) { return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs }; }

test('OCR cache는 exact file generation과 engine에서만 재사용되고 FTS로 다시 찾는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-file-index-')); const file = join(room, 'KakaoTalk_random.png');
  await writeFile(file, 'first'); const before = await lstat(file); const index = new FileIntelligenceIndex(join(room, 'state', 'files.sqlite'));
  try {
    await index.record({ path: file, fileIdentity: identity(before), displayName: 'KakaoTalk_random.png',
      locationText: '~/Downloads/KakaoTalk_random.png', extension: '.png', observationKind: 'ocr',
      engine: 'macos-vision-local:v1', text: '한빛상사 견적 금액 4,780,000원',
      observations: [{ text: '한빛상사', confidence: 0.97, box: { x: 0.1, y: 0.8, width: 0.4, height: 0.1 } }] });
    const hit = await index.lookup({ path: file, fileIdentity: identity(before), observationKind: 'ocr', engine: 'macos-vision-local:v1' });
    assert.equal(hit.state, 'cached'); assert.match(hit.text, /4,780,000/u);
    assert.equal((await index.search({ query: '한빛상사 견적', limit: 5 }))[0].path, file);
    assert.equal(await index.lookup({ path: file, fileIdentity: identity(before), observationKind: 'ocr', engine: 'other' }), null);
    await new Promise((resolve) => setTimeout(resolve, 5)); await writeFile(file, 'changed'); const after = await lstat(file);
    assert.equal(await index.lookup({ path: file, fileIdentity: identity(after), observationKind: 'ocr', engine: 'macos-vision-local:v1' }), null);
    assert.deepEqual(await index.deletePath(file), { deleted: 1 }); assert.deepEqual(await index.search({ query: '한빛상사' }), []);
    assert.equal((await stat(join(room, 'state', 'files.sqlite'))).mode & 0o777, 0o600);
    assert.doesNotMatch(await readFile(join(room, 'state', 'files.sqlite'), 'latin1'), /sk-|Bearer/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
