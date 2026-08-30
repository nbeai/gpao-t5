import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { buildAuthoringPreview } from './authoring-plan.js';
import { prepareAuthoringPlan } from './authoring-prepare.js';
import { AuthoringLockCoordinator } from './authoring-lock.js';
import { publishAuthoringTransaction } from './authoring-publish.js';
import { verifyAuthoringTransaction } from './authoring-verify.js';
import { settleAuthoringTransaction } from './authoring-settle.js';
import { AuthoringUndoStore } from './authoring-undo-store.js';
import { executeAuthoringUndo } from './authoring-undo.js';
import { createExactTargetRollbackPointer, discardExactTargetRollbackPointer } from './exact-target-rollback.js';
import { observePublicationPreimage } from './atomic-file-publication.js';

const inside = (candidate, root) => { const value = relative(root, candidate); return value !== ''
  && value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value); };

export function makeWorkspacePatchTool({ workspace, stateRoot, sessionId = 'local', makeId = randomUUID } = {}) {
  if (!workspace || !stateRoot || !sessionId) throw new TypeError('workspace patch roots required');
  const plans = new Map(); const locks = new AuthoringLockCoordinator(join(stateRoot, 'locks'));
  const undoStore = new AuthoringUndoStore(join(stateRoot, 'undo'));
  const tool = {
    name: 'workspace_patch',
    description: 'Preview, apply, or roll back a closed multi-file create, modify, delete, or move transaction inside the managed workspace without shell quoting. Preview first; apply only its fresh plan handle, and roll back only its durable undo handle.',
    searchTerms: ['multi file edit patch structured authoring create modify delete move transaction rollback',
      '여러 파일 수정 생성 삭제 이동 구조화 편집 원복'],
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['preview', 'apply', 'rollback'] },
      planHandle: { type: ['string', 'null'] },
      undoHandle: { type: ['string', 'null'] },
      operations: { type: 'array', maxItems: 32, items: { type: 'object', additionalProperties: false,
        properties: { type: { type: 'string', enum: ['create', 'modify', 'delete', 'move'] },
          path: { type: 'string', maxLength: 1000 }, to: { type: ['string', 'null'], maxLength: 1000 },
          content: { type: ['string', 'null'], maxLength: 262144 } },
        required: ['type', 'path', 'to', 'content'] } },
    }, required: ['action', 'planHandle', 'undoHandle', 'operations'] },
    async execute(args = {}) {
      if (args.action === 'preview') {
        if (args.planHandle != null || args.undoHandle != null || !args.operations.length) throw new TypeError('preview operations required');
        const operations = args.operations.map((item) => ({ type: item.type, path: item.path,
          ...(item.to != null ? { to: item.to } : {}),
          ...(['create', 'modify'].includes(item.type) ? { content: item.content ?? '' } : {}) }));
        const { plan, preview } = await buildAuthoringPreview({ workspace, operations });
        const handle = `authoring_${makeId()}`; plans.set(handle, plan);
        return { ...preview, planHandle: handle, planId: undefined };
      }
      if (args.action === 'rollback') {
        if (!args.undoHandle || args.planHandle != null || args.operations.length) {
          throw new TypeError('rollback undo handle required');
        }
        const claim = await undoStore.claim({ handle: args.undoHandle, sessionId });
        return executeAuthoringUndo({ claim, store: undoStore, locks });
      }
      if (args.action !== 'apply' || !args.planHandle || args.operations.length) {
        throw new TypeError('fresh apply plan handle required');
      }
      const plan = plans.get(args.planHandle); if (!plan) throw new Error('authoring plan handle is stale');
      plans.delete(args.planHandle);
      const prepared = (await prepareAuthoringPlan({ plan,
        scratchRoot: join(stateRoot, 'scratch') })).prepared;
      const admission = (await locks.acquireAndRevalidate(prepared)).admission;
      const published = await publishAuthoringTransaction({ admission, coordinator: locks,
        rollbackRoot: join(stateRoot, 'rollback') });
      if (!published.transaction) return published.receipt;
      const verified = await verifyAuthoringTransaction({ transaction: published.transaction, coordinator: locks });
      if (!verified.verification) return verified.receipt;
      const settled = await settleAuthoringTransaction({ verification: verified.verification, coordinator: locks });
      if (!settled.settlement) return settled.receipt;
      const undo = await undoStore.save({ sessionId, settlement: settled.settlement });
      return { ...settled.receipt, undoHandle: undo.handle };
    },
  };
  tool.prepareExternalUndo = async ({ targets }) => {
    if (!Array.isArray(targets) || !targets.length || targets.length > 32) return null;
    const root = await realpath(resolve(workspace)); const absolute = targets.map((target) => resolve(root, String(target)));
    if (new Set(absolute).size !== absolute.length || absolute.some((target) => !inside(target, root))) return null;
    const pointers = [];
    try {
      for (const target of absolute) pointers.push(await createExactTargetRollbackPointer({ target,
        rollbackRoot: join(stateRoot, 'rollback') }));
      return { pointers };
    } catch {
      await Promise.all(pointers.map((pointer) => discardExactTargetRollbackPointer(pointer).catch(() => {})));
      return null;
    }
  };
  tool.settleExternalUndo = async (capture) => {
    if (!capture?.pointers?.length) return null;
    const changed = [];
    for (const pointer of capture.pointers) {
      const expectedPostimage = await observePublicationPreimage(pointer.target);
      if (JSON.stringify(expectedPostimage) !== JSON.stringify(pointer.preimage)) {
        changed.push({ pointer, expectedPostimage });
      } else await discardExactTargetRollbackPointer(pointer);
    }
    if (!changed.length) return null;
    const saved = await undoStore.saveTargets({ sessionId, planId: 'foreground_local_change', targets: changed });
    return { undoHandle: saved.handle, undoTargets: saved.targetCount };
  };
  tool.discardExternalUndo = async (capture) => {
    if (!capture?.pointers?.length) return;
    await Promise.all(capture.pointers.map((pointer) => discardExactTargetRollbackPointer(pointer).catch(() => {})));
  };
  tool.undoAvailable = ({ undoHandle }) => undoStore.available({ handle: undoHandle, sessionId });
  return tool;
}
