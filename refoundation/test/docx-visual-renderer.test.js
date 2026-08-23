import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderDocxFirstPage } from '../src/docx-visual-renderer.js';

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);

test('macOS DOCX renderer는 exact file을 Quick Look 한 장 PNG로만 투영한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-docx-render-test-'));
  const result = await renderDocxFirstPage('/tmp/input.docx', {
    platform: 'darwin', temporaryRoot: root,
    runCommand: async (command, args) => {
      assert.equal(command, '/usr/bin/qlmanage'); assert.equal(args.at(-1), '/tmp/input.docx');
      const output = args[args.indexOf('-o') + 1]; await writeFile(join(output, 'input.docx.png'), png);
    },
  });
  assert.equal(result.state, 'rendered'); assert.equal(result.engine, 'macos-quicklook');
  assert.deepEqual(result.bytes, png); assert.equal(result.page, 1);
});

test('자격화하지 않은 플랫폼과 여러 출력은 읽었다고 승격하지 않는다', async () => {
  assert.deepEqual(await renderDocxFirstPage('/tmp/input.docx', { platform: 'win32' }), {
    state: 'capability_boundary', reason: 'docx_visual_renderer_not_qualified',
  });
  const root = await mkdtemp(join(tmpdir(), 't5-docx-render-many-'));
  const result = await renderDocxFirstPage('/tmp/input.docx', {
    platform: 'darwin', temporaryRoot: root,
    runCommand: async (_command, args) => {
      const output = args[args.indexOf('-o') + 1];
      await writeFile(join(output, 'a.png'), png); await writeFile(join(output, 'b.png'), png);
    },
  });
  assert.equal(result.state, 'capability_boundary'); assert.equal(result.reason, 'docx_visual_output_ambiguous');
});
