import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAuthoringPreview } from '../src/authoring-plan.js';
import { prepareAuthoringPlan } from '../src/authoring-prepare.js';
import { AuthoringLockCoordinator } from '../src/authoring-lock.js';
import { publishAuthoringTransaction } from '../src/authoring-publish.js';
import { assertAuthoringVerification, verifyAuthoringTransaction } from '../src/authoring-verify.js';

async function published(root) {
  await writeFile(join(root, 'a.json'), '{"revision":1}'); await writeFile(join(root, 'move.txt'), 'move');
  const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
    { type: 'modify', path: 'a.json', content: '{"revision":2}' },
    { type: 'create', path: 'b.json', content: '{"revision":2}' },
    { type: 'move', path: 'move.txt', to: 'moved.txt' },
  ] });
  const prepared = (await prepareAuthoringPlan({ plan, scratchRoot: join(root, '.scratch') })).prepared;
  const coordinator = new AuthoringLockCoordinator(join(root, '.locks'));
  const admission = (await coordinator.acquireAndRevalidate(prepared)).admission;
  const transaction = (await publishAuthoringTransaction({ admission, coordinator,
    rollbackRoot: join(root, '.rollback') })).transaction;
  return { coordinator, transaction };
}

test('F5는 실제 target 전체를 reopen해 hash·형식·move와 relation을 독립 검증한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f5-verify-'));
  try {
    const state = await published(root); const result = await verifyAuthoringTransaction({ ...state,
      relationVerifier: async ({ targets }) => ({ state: targets.length === 3 ? 'verified' : 'failed' }) });
    assert.equal(assertAuthoringVerification(result.verification), result.verification);
    assert.equal(result.receipt.state, 'published_verified_pending_settlement');
    assert.equal(result.receipt.verifiedTargets, 3); assert.equal(result.receipt.relation, 'verified');
    await state.coordinator.release(result.verification.transaction.admission);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F5 relation 실패는 모든 published target을 exact rollback한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f5-relation-fail-'));
  try {
    const state = await published(root); const result = await verifyAuthoringTransaction({ ...state,
      relationVerifier: async () => ({ state: 'failed' }) });
    assert.equal(result.receipt.state, 'rolled_back_verified');
    assert.equal(await readFile(join(root, 'a.json'), 'utf8'), '{"revision":1}');
    await assert.rejects(readFile(join(root, 'b.json')), { code: 'ENOENT' });
    assert.equal(await readFile(join(root, 'move.txt'), 'utf8'), 'move');
    await assert.rejects(readFile(join(root, 'moved.txt')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F5 actual target 변조는 published success가 아니라 partial effect unknown이다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f5-tamper-'));
  try {
    const state = await published(root); await writeFile(join(root, 'a.json'), '{"thirdParty":true}');
    const result = await verifyAuthoringTransaction(state);
    assert.equal(result.receipt.state, 'partial_effect_unknown');
  } finally { await rm(root, { recursive: true, force: true }); }
});
