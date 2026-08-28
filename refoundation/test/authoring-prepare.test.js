import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAuthoringPreview } from '../src/authoring-plan.js';
import { assertPreparedAuthoring, prepareAuthoringPlan } from '../src/authoring-prepare.js';

test('F2 prepare는 모든 candidate를 scratch에 exact bytes로 만들고 target write는 0이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f2-prepare-')); const scratch = join(root, '.scratch');
  try {
    const json = join(root, 'config.json'); const yaml = join(root, 'config.yaml');
    await writeFile(json, '{"old":true}\n'); await writeFile(yaml, 'old: true\n');
    const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
      { type: 'modify', path: 'config.json', content: '{"next":true}\n' },
      { type: 'modify', path: 'config.yaml', content: 'next: true\n' },
      { type: 'create', path: 'literal.txt', content: '$HOME literal' },
    ] });
    const { prepared, receipt } = await prepareAuthoringPlan({ plan, scratchRoot: scratch });
    assert.equal(assertPreparedAuthoring(prepared), prepared); assert.equal(receipt.targetWrites, 0);
    assert.deepEqual(receipt.candidates.map((item) => item.validation.state),
      ['valid', 'valid', 'not_structurally_validated']);
    assert.equal(await readFile(json, 'utf8'), '{"old":true}\n');
    assert.equal(await readFile(yaml, 'utf8'), 'old: true\n');
    await assert.rejects(readFile(join(root, 'literal.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(prepared.candidates[2].path, 'utf8'), '$HOME literal');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F2 prepare의 한 candidate 형식 실패는 scratch 전체를 정리하고 target을 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f2-invalid-')); const scratch = join(root, '.scratch');
  try {
    const a = join(root, 'a.json'); const b = join(root, 'b.json');
    await writeFile(a, '{"old":1}'); await writeFile(b, '{"old":2}');
    const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
      { type: 'modify', path: 'a.json', content: '{"ok":1}' },
      { type: 'modify', path: 'b.json', content: '{broken' },
    ] });
    await assert.rejects(prepareAuthoringPlan({ plan, scratchRoot: scratch }));
    assert.equal(await readFile(a, 'utf8'), '{"old":1}'); assert.equal(await readFile(b, 'utf8'), '{"old":2}');
    assert.deepEqual(await readdir(scratch), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
