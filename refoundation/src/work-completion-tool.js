export function makeWorkCompletionTool({ store, runId } = {}) {
  if (!store || !runId) throw new TypeError('work completion identity is required');
  return {
    name: 'work_completion', informationFamily: 'continuity', informationAlwaysVisible: true,
    description: 'Before giving the final user answer, explicitly propose whether the current user purpose is achieved or unresolved. This is only a proposal: runtime verifies the current Work revision and receipts. Propose unresolved when any requested result, effect, delivery, verification, or artifact remains missing or unknown.',
    parameters: { type: 'object', properties: {
      outcome: { type: 'string', enum: ['achieved', 'unresolved'] },
    }, required: ['outcome'], additionalProperties: false },
    async execute(args, context = {}) {
      const work = await store.workForRun(runId);
      if (!work || work.revision !== work.claimedRevision) throw new Error('stale work revision');
      const receipts = context.priorReceipts ?? [];
      const blockers = receipts.filter((receipt) => receipt.outcome === 'unknown'
        || receipt.result?.effectUnknown === true || receipt.result?.state === 'approval_required'
        || receipt.outcome === 'failed');
      const verifiedOutcome = args.outcome === 'achieved' && blockers.length === 0 ? 'achieved' : 'unresolved';
      await store.proposeCompletion({ workId: work.workId, revision: work.revision, runId,
        proposedOutcome: args.outcome, verifiedOutcome });
      return { state: 'proposal_recorded', proposedOutcome: args.outcome,
        verifiedOutcome, blockerReceipts: blockers.length };
    },
  };
}
