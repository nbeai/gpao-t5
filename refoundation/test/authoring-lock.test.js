import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { basename } from 'node:path';
import test from 'node:test';
import { buildAuthoringPreview } from '../src/authoring-plan.js';
import { prepareAuthoringPlan } from '../src/authoring-prepare.js';
import { assertAuthoringAdmission, AuthoringLockCoordinator } from '../src/authoring-lock.js';

async function fixture(root) {
  await writeFile(join(root, 'z.txt'), 'z-old'); await writeFile(join(root, 'a.txt'), 'a-old');
  const { plan } = await buildAuthoringPreview({ workspace: root, operations: [
    { type: 'modify', path: 'z.txt', content: 'z-new' },
    { type: 'modify', path: 'a.txt', content: 'a-new' },
  ] });
  return (await prepareAuthoringPlan({ plan, scratchRoot: join(root, '.scratch') })).prepared;
}

test('F3는 canonical target lock을 정렬 획득하고 contention에서 publication을 열지 않는다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f3-lock-'));
  try {
    const prepared = await fixture(root); const first = new AuthoringLockCoordinator(join(root, '.locks'));
    const { admission, receipt } = await first.acquireAndRevalidate(prepared);
    assert.equal(assertAuthoringAdmission(admission), admission); assert.equal(receipt.lockedTargets, 2);
    assert.deepEqual(admission.claims.map((item) => basename(item.path)), ['a.txt', 'z.txt']);
    assert.equal(receipt.orderedTargetDigests.length, 2);
    const second = new AuthoringLockCoordinator(join(root, '.locks'));
    const contender = await fixture(root);
    await assert.rejects(second.acquireAndRevalidate(contender), /locked/u);
    assert.deepEqual(await first.release(admission), { released: 2 });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F3 preimage stale은 전체 admission을 거부하고 이미 잡은 lock을 모두 해제한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f3-stale-'));
  try {
    const prepared = await fixture(root); await writeFile(join(root, 'z.txt'), 'external-change');
    const locks = join(root, '.locks'); const coordinator = new AuthoringLockCoordinator(locks);
    await assert.rejects(coordinator.acquireAndRevalidate(prepared), /preimage changed/u);
    assert.deepEqual(await readdir(locks), []);
    assert.equal(prepared.state, 'prepared');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('F3 scratch candidate 변조는 target publication admission 전에 차단한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-f3-scratch-'));
  try {
    const prepared = await fixture(root); await writeFile(prepared.candidates[0].path, 'tampered');
    const coordinator = new AuthoringLockCoordinator(join(root, '.locks'));
    await assert.rejects(coordinator.acquireAndRevalidate(prepared), /candidate changed/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
