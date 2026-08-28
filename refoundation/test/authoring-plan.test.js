import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assertAuthoringPlan, buildAuthoringPreview } from '../src/authoring-plan.js';

test('F1 preview는 모든 create·modify·delete·move target을 첫 write 전에 닫는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f1-preview-'));
  try {
    await Promise.all([writeFile(join(root, 'modify.txt'), 'old-modify'),
      writeFile(join(root, 'delete.txt'), 'old-delete'), writeFile(join(root, 'move.txt'), 'old-move')]);
    const { plan, preview } = await buildAuthoringPreview({ workspace: root, operations: [
      { type: 'create', path: 'create.txt', content: '$HOME literal' },
      { type: 'modify', path: 'modify.txt', content: 'new-modify' },
      { type: 'delete', path: 'delete.txt' },
      { type: 'move', path: 'move.txt', to: 'moved.txt' },
    ] });
    assert.equal(assertAuthoringPlan(plan), plan); assert.equal(preview.readyToPrepare, true);
    assert.deepEqual(preview.changes.map((item) => item.type), ['create', 'modify', 'delete', 'move']);
    assert.equal(JSON.stringify(preview).includes('$HOME literal'), false);
    assert.equal(await readFile(join(root, 'modify.txt'), 'utf8'), 'old-modify');
    assert.equal(await readFile(join(root, 'delete.txt'), 'utf8'), 'old-delete');
    assert.equal(await readFile(join(root, 'move.txt'), 'utf8'), 'old-move');
    await assert.rejects(readFile(join(root, 'create.txt')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(root, 'moved.txt')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F1 preview는 root escape·중복 destination·hardlink source를 write 전에 거부한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f1-boundary-')); const outside = join(root, 'outside');
  try {
    await mkdir(outside); await writeFile(join(root, 'a'), 'a');
    await writeFile(join(outside, 'shared'), 'shared'); await link(join(outside, 'shared'), join(root, 'hard'));
    await assert.rejects(buildAuthoringPreview({ workspace: root, operations: [
      { type: 'create', path: '../escape', content: 'x' },
    ] }), /escaped/u);
    await assert.rejects(buildAuthoringPreview({ workspace: root, operations: [
      { type: 'modify', path: 'a', content: 'x' }, { type: 'delete', path: 'a' },
    ] }), /duplicated/u);
    await assert.rejects(buildAuthoringPreview({ workspace: root, operations: [
      { type: 'modify', path: 'hard', content: 'x' },
    ] }), /single-link/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
