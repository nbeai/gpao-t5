import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAuthoringPreview } from '../src/authoring-plan.js';
import { prepareAuthoringPlan } from '../src/authoring-prepare.js';
import { AuthoringLockCoordinator } from '../src/authoring-lock.js';
import { publishAuthoringTransaction } from '../src/authoring-publish.js';
import { verifyAuthoringTransaction } from '../src/authoring-verify.js';
import { assertAuthoringSettlement, settleAuthoringTransaction } from '../src/authoring-settle.js';

async function verified(root) {
  await writeFile(join(root, 'a.json'), '{"revision":1}');
  const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
    { type: 'modify', path: 'a.json', content: '{"revision":2}' },
    { type: 'create', path: 'b.json', content: '{"revision":2}' },
  ] });
  const prepared = (await prepareAuthoringPlan({ plan, scratchRoot: join(root, '.scratch') })).prepared;
  const coordinator = new AuthoringLockCoordinator(join(root, '.locks'));
  const admission = (await coordinator.acquireAndRevalidate(prepared)).admission;
  const transaction = (await publishAuthoringTransaction({ admission, coordinator,
    rollbackRoot: join(root, '.rollback') })).transaction;
  const verification = (await verifyAuthoringTransaction({ transaction, coordinator,
    relationVerifier: async () => ({ state: 'verified' }) })).verification;
  return { coordinator, verification, scratch: prepared.directory };
}

test('F6는 verified transaction의 lock·scratch를 닫고 opaque Undo 범위를 보존한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f6-settle-'));
  try {
    const state = await verified(root); const result = await settleAuthoringTransaction(state);
    assert.equal(assertAuthoringSettlement(result.settlement), result.settlement);
    assert.deepEqual(result.receipt, { state: 'published_verified',
      planId: result.receipt.planId, verifiedTargets: 2, undoAvailableTargets: 2,
      targetLocksReleased: true, scratchCleaned: true });
    assert.equal(JSON.stringify(result.receipt).includes(root), false);
    assert.equal(await readFile(join(root, 'a.json'), 'utf8'), '{"revision":2}');
    assert.equal(await readFile(join(root, 'b.json'), 'utf8'), '{"revision":2}');
    await assert.rejects(readFile(state.scratch), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F6 scratch cleanup 미확인은 published_verified로 승격하지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f6-cleanup-'));
  try {
    const state = await verified(root); const result = await settleAuthoringTransaction({ ...state,
      removeScratch: async () => { throw new Error('cleanup failed'); } });
    assert.equal(result.settlement, null); assert.equal(result.receipt.state, 'partial_effect_unknown');
    assert.equal(result.receipt.targetLocksReleased, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
