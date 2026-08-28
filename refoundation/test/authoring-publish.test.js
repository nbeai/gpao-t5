import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAuthoringPreview } from '../src/authoring-plan.js';
import { prepareAuthoringPlan } from '../src/authoring-prepare.js';
import { AuthoringLockCoordinator } from '../src/authoring-lock.js';
import { assertPublishedAuthoring, publishAuthoringTransaction } from '../src/authoring-publish.js';

async function setup(root) {
  await writeFile(join(root, 'modify'), 'modify-old'); await writeFile(join(root, 'delete'), 'delete-old');
  await writeFile(join(root, 'move'), 'move-old');
  const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
    { type: 'create', path: 'create', content: '$HOME literal' },
    { type: 'modify', path: 'modify', content: 'modify-new' },
    { type: 'delete', path: 'delete' },
    { type: 'move', path: 'move', to: 'moved' },
  ] });
  const prepared = (await prepareAuthoringPlan({ plan, scratchRoot: join(root, '.scratch') })).prepared;
  const coordinator = new AuthoringLockCoordinator(join(root, '.locks'));
  const admission = (await coordinator.acquireAndRevalidate(prepared)).admission;
  return { coordinator, admission };
}

test('F4는 모든 rollback pointer 뒤 target별 publication을 수행한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f4-publish-'));
  try {
    const state = await setup(root); const result = await publishAuthoringTransaction({ ...state,
      rollbackRoot: join(root, '.rollback') });
    assert.equal(assertPublishedAuthoring(result.transaction), result.transaction);
    assert.equal(result.receipt.state, 'published_pending_verification');
    assert.equal(await readFile(join(root, 'create'), 'utf8'), '$HOME literal');
    assert.equal(await readFile(join(root, 'modify'), 'utf8'), 'modify-new');
    await assert.rejects(readFile(join(root, 'delete')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(root, 'move')), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'moved'), 'utf8'), 'move-old');
    await state.coordinator.release(result.transaction.admission);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F4 후순위 실패는 앞선 target을 역순 exact 복원한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f4-rollback-'));
  try {
    const state = await setup(root); const result = await publishAuthoringTransaction({ ...state,
      rollbackRoot: join(root, '.rollback'), beforeOperation: async ({ index }) => {
        if (index === 2) throw new Error('injected third target failure');
      } });
    assert.equal(result.receipt.state, 'rolled_back_verified');
    await assert.rejects(readFile(join(root, 'create')), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'modify'), 'utf8'), 'modify-old');
    assert.equal(await readFile(join(root, 'delete'), 'utf8'), 'delete-old');
    assert.equal(await readFile(join(root, 'move'), 'utf8'), 'move-old');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F4 rollback 하나가 실패하면 전체 미적용으로 꾸미지 않고 partial unknown이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f4-unknown-'));
  try {
    const state = await setup(root); const result = await publishAuthoringTransaction({ ...state,
      rollbackRoot: join(root, '.rollback'), beforeOperation: async ({ index }) => {
        if (index === 2) throw new Error('injected failure');
      }, restore: async () => { throw new Error('restore failed'); } });
    assert.equal(result.receipt.state, 'partial_effect_unknown');
    assert.equal(result.receipt.targetLocksReleased, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
