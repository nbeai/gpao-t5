import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeWhisperHostQualifier } from '../src/whisper-host-qualification.js';

const sha = (value) => createHash('sha256').update(value).digest('hex');

test('exact helper·model만 silence fixture schema qualification을 만들고 scratch를 정리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whisper-host-')); const helper = join(room, 'helper');
  const model = join(room, 'model.bin'); const helperBytes = Buffer.from('helper'); const modelBytes = Buffer.from('model');
  await writeFile(helper, helperBytes); await writeFile(model, modelBytes); const calls = [];
  try {
    const qualify = makeWhisperHostQualifier({ helper, expectedHelperSha256: sha(helperBytes),
      run: async (_command, args) => { calls.push(args);
        if (args[0] === '--version') return { stdout: 'whisper.cpp b4938', stderr: '' };
        const output = args[args.indexOf('-of') + 1]; await writeFile(`${output}.json`, JSON.stringify({
          model: { type: 'large' }, transcription: [{ text: '', offsets: { from: 0, to: 1000 } }],
        })); return { stdout: '', stderr: '' }; } });
    const result = await qualify({ path: model, asset: { sha256: sha(modelBytes) }, scratchRoot: room });
    assert.equal(result.qualified, true); assert.match(result.receiptDigest, /^[0-9a-f]{64}$/u);
    assert.equal(result.helperSha256, sha(helperBytes)); assert.equal(calls.length, 2);
    assert.equal(calls[1].includes(await realpath(model)), true); assert.equal(calls[1].includes('--no-prints'), true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('helper/model digest mismatch와 malformed output은 qualification을 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-whisper-host-reject-')); const helper = join(room, 'helper');
  const model = join(room, 'model.bin'); await writeFile(helper, 'helper'); await writeFile(model, 'model');
  try {
    const wrong = makeWhisperHostQualifier({ helper, expectedHelperSha256: '0'.repeat(64), run: async () => ({}) });
    await assert.rejects(wrong({ path: model, asset: { sha256: sha(Buffer.from('model')) }, scratchRoot: room }), /identity changed/u);
    const malformed = makeWhisperHostQualifier({ helper, run: async (_command, args) => {
      if (args[0] === '--version') return { stdout: 'version' };
      const output = args[args.indexOf('-of') + 1]; await writeFile(`${output}.json`, '{}'); return { stdout: '' };
    } });
    await assert.rejects(malformed({ path: model, asset: { sha256: sha(Buffer.from('model')) }, scratchRoot: room }), /output is invalid/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
