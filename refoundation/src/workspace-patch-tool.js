import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { buildAuthoringPreview } from './authoring-plan.js';
import { prepareAuthoringPlan } from './authoring-prepare.js';
import { AuthoringLockCoordinator } from './authoring-lock.js';
import { publishAuthoringTransaction } from './authoring-publish.js';
import { verifyAuthoringTransaction } from './authoring-verify.js';
import { settleAuthoringTransaction } from './authoring-settle.js';
import { AuthoringUndoStore } from './authoring-undo-store.js';
import { executeAuthoringUndo } from './authoring-undo.js';

export function makeWorkspacePatchTool({ workspace, stateRoot, sessionId = 'local', makeId = randomUUID } = {}) {
  if (!workspace || !stateRoot || !sessionId) throw new TypeError('workspace patch roots required');
  const plans = new Map(); const locks = new AuthoringLockCoordinator(join(stateRoot, 'locks'));
  const undoStore = new AuthoringUndoStore(join(stateRoot, 'undo'));
  return {
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
}
