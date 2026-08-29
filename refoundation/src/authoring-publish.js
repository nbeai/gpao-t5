import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertAuthoringAdmission } from './authoring-lock.js';
import { observePublicationPreimage, publishAtomicFile } from './atomic-file-publication.js';
import { createExactTargetRollbackPointer, restoreExactTargetRollback } from './exact-target-rollback.js';

const TRANSACTIONS = new WeakSet();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
async function syncDirectory(path) { const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); } }
async function deleteExact(target, expected) {
  if (!same(await observePublicationPreimage(target), expected)) throw new Error('authoring delete preimage changed');
  const parent = await realpath(dirname(target)); await unlink(target);
  try { await syncDirectory(parent); } catch { return { state: 'deleted_durability_unknown', effectUnknown: true }; }
  return await observePublicationPreimage(target) === null
    ? { state: 'deleted', effectUnknown: false } : { state: 'deleted_durability_unknown', effectUnknown: true };
}
async function createMissingParents(operation, workspace) {
  for (const path of [...(operation.missingParents ?? []), ...(operation.toMissingParents ?? [])]) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
    const identity = await lstat(path);
    const canonical = await realpath(path);
    if (!identity.isDirectory() || identity.isSymbolicLink()
      || !(canonical === workspace || canonical.startsWith(`${workspace}/`))) {
      throw new Error('authoring parent creation is unsafe');
    }
  }
}

export async function publishAuthoringTransaction({ admission: rawAdmission, coordinator,
  rollbackRoot, beforeOperation = async () => {},
  restore = restoreExactTargetRollback } = {}) {
  const admission = assertAuthoringAdmission(rawAdmission); const prepared = admission.prepared;
  const plan = prepared.plan; const candidates = new Map(prepared.candidates.map((item) => [item.operationIndex, item]));
  const pointers = new Map(); const pointerFor = async (path) => {
    if (!pointers.has(path)) pointers.set(path, await createExactTargetRollbackPointer({
      target: path, rollbackRoot: join(rollbackRoot, plan.planId),
    }));
    return pointers.get(path);
  };
  try {
    for (const operation of plan.operations) {
      await pointerFor(operation.path); if (operation.to) await pointerFor(operation.to);
    }
  } catch (error) {
    await coordinator.release(admission); throw error;
  }
  const applied = [];
  try {
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = plan.operations[index]; await beforeOperation({ index, operation });
      await createMissingParents(operation, plan.workspace);
      if (['create', 'modify'].includes(operation.type)) {
        const candidate = candidates.get(index); const bytes = await readFile(candidate.path);
        const result = await publishAtomicFile({ target: operation.path, bytes,
          expectedPreimage: operation.preimage });
        if (result.state !== 'published') throw Object.assign(new Error('authoring publication durability unknown'),
          { effectUnknown: true });
        applied.push({ pointer: pointers.get(operation.path), expectedPostimage: result.postimage });
      } else if (operation.type === 'delete') {
        const result = await deleteExact(operation.path, operation.preimage);
        applied.push({ pointer: pointers.get(operation.path), expectedPostimage: null });
        if (result.state !== 'deleted') throw Object.assign(new Error('authoring deletion durability unknown'),
          { effectUnknown: true });
      } else if (operation.type === 'move') {
        const bytes = await readFile(operation.path);
        const destination = await publishAtomicFile({ target: operation.to, bytes,
          expectedPreimage: null, mode: operation.preimage.mode });
        if (destination.state !== 'published') throw Object.assign(new Error('authoring move destination unknown'),
          { effectUnknown: true });
        applied.push({ pointer: pointers.get(operation.to), expectedPostimage: destination.postimage });
        const deleted = await deleteExact(operation.path, operation.preimage);
        applied.push({ pointer: pointers.get(operation.path), expectedPostimage: null });
        if (deleted.state !== 'deleted') throw Object.assign(new Error('authoring move source unknown'),
          { effectUnknown: true });
      }
    }
    const transaction = { schema: 't5.authoring-transaction.v1', admission, pointers,
      applied, state: 'published_pending_verification', publishedAt: new Date().toISOString() };
    TRANSACTIONS.add(transaction); admission.state = 'published';
    return { transaction, receipt: { state: 'published_pending_verification',
      planId: plan.planId, publishedTargets: applied.length } };
  } catch (error) {
    let restored = 0; let unknown = error?.effectUnknown === true;
    for (const item of [...applied].reverse()) {
      try { const result = await restore({ pointer: item.pointer, expectedPostimage: item.expectedPostimage });
        if (!['restored', 'removed_created_target'].includes(result.state)) unknown = true; else restored += 1; }
      catch { unknown = true; }
    }
    await coordinator.release(admission);
    return { transaction: null, receipt: { state: unknown ? 'partial_effect_unknown' : 'rolled_back_verified',
      planId: plan.planId, publishedTargets: applied.length, restoredTargets: restored,
      targetLocksReleased: true } };
  }
}

export function assertPublishedAuthoring(value) {
  if (!TRANSACTIONS.has(value) || value.state !== 'published_pending_verification') {
    throw new TypeError('published authoring transaction required');
  }
  return value;
}
