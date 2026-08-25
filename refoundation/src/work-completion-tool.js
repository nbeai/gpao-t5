import { inputSettlementDispositions } from './input-settlement-scope.js';

export function makeWorkCompletionTool({ store, runId, inputSettlementScope = null } = {}) {
  if (!store || !runId) throw new TypeError('work completion identity is required');
  return {
    name: 'work_completion', informationFamily: 'continuity', informationAlwaysVisible: true,
    description: 'Before giving the final user answer, explicitly propose whether the current user purpose is achieved or unresolved. For every busy input handle shown in this Run, provide exactly one settlement disposition. Handles are opaque runtime identities. This is only a proposal: runtime verifies Work revision, input ownership, and receipts.',
    parameters: { type: 'object', properties: {
      outcome: { type: 'string', enum: ['achieved', 'unresolved'] },
      inputSettlements: { type: 'array', maxItems: 32, items: { type: 'object',
        properties: {
          handle: { type: 'string' },
          disposition: { type: 'string', enum: inputSettlementDispositions },
        }, required: ['handle', 'disposition'], additionalProperties: false } },
    }, required: ['outcome', 'inputSettlements'], additionalProperties: false },
    async execute(args, context = {}) {
      const work = await store.workForRun(runId);
      if (!work || work.status !== 'active' || work.revision !== work.claimedRevision) {
        throw new Error('current Run does not own the latest active work revision');
      }
      const receipts = context.priorReceipts ?? [];
      const inputSettlement = inputSettlementScope
        ? await inputSettlementScope.evaluate(args.inputSettlements, {
          workId: work.workId, revision: work.revision,
        }) : { settlements: [], blockers: [] };
      const evaluation = evaluateWorkCompletion({ proposedOutcome: args.outcome, receipts,
        facts: { inputSettlementBlockers: inputSettlement.blockers } });
      await store.proposeCompletion({ workId: work.workId, revision: work.revision, runId,
        proposedOutcome: args.outcome, verifiedOutcome: evaluation.verifiedOutcome,
        blockerDigest: evaluation.blockerDigest, blockers: evaluation.blockers,
        inputSettlements: inputSettlement.settlements });
      return { state: 'proposal_recorded', proposedOutcome: args.outcome,
        verifiedOutcome: evaluation.verifiedOutcome, blockerReceipts: evaluation.blockers.length,
        blockerDigest: evaluation.blockerDigest,
        inputSettlements: inputSettlement.settlements.map(({ handle, disposition }) => ({ handle, disposition })) };
    },
  };
}
import { evaluateWorkCompletion } from './work-completion-evaluator.js';
