import { observePublicationPreimage } from './atomic-file-publication.js';
import { restoreExactTargetRollback } from './exact-target-rollback.js';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const restoredMatches = (current, preimage) => preimage == null ? current == null : (
  current?.sha256 === preimage.sha256 && current?.size === preimage.size
  && current?.mode === preimage.mode && current?.nlink === 1
);

export async function executeAuthoringUndo({ claim, store, locks,
  restore = restoreExactTargetRollback } = {}) {
  const targets = claim.manifest.targets; const claims = await locks.acquirePaths(
    targets.map((item) => item.pointer.target));
  try {
    for (const item of targets) if (!same(await observePublicationPreimage(item.pointer.target),
      item.expectedPostimage)) {
      await store.complete(claim, 'not_published');
      return { state: 'not_published', reason: 'undo_target_changed', targetWrites: 0 };
    }
    let restored = 0; let unknown = false;
    for (const item of [...targets].reverse()) {
      try { const result = await restore({ pointer: item.pointer, expectedPostimage: item.expectedPostimage });
        if (!['restored', 'removed_created_target'].includes(result.state)) unknown = true; else restored += 1; }
      catch { unknown = true; }
    }
    if (!unknown) for (const item of targets) if (!restoredMatches(
      await observePublicationPreimage(item.pointer.target), item.pointer.preimage)) unknown = true;
    const state = unknown ? 'partial_effect_unknown' : 'rolled_back_verified';
    await store.complete(claim, state); return { state, restoredTargets: restored };
  } finally { await locks.releaseClaims(claims); }
}
