import { inputSettlementDispositions } from './input-settlement-scope.js';

export function makeWorkCompletionTool({ store, runId, inputSettlementScope = null } = {}) {
  if (!store || !runId) throw new TypeError('work completion identity is required');
  const settlementHandles = () => inputSettlementScope?.handles?.() ?? [];
  return {
    name: 'work_completion', informationFamily: 'continuity', informationAlwaysVisible: true,
    get description() { return settlementHandles().length
      ? 'Before giving the final user answer, explicitly propose whether the current user purpose is achieved or unresolved. Provide exactly one settlement for every opaque busy input handle allowed by this schema. This is only a proposal: runtime verifies Work revision, input ownership, and receipts.'
      : 'Before giving the final user answer, explicitly propose whether the current user purpose is achieved or unresolved. This Run has no model-settled busy input handles: inputSettlements must be an empty array. Runtime settles the initial user input after the final surface.'; },
    get parameters() { const handles = settlementHandles(); return { type: 'object', properties: {
      outcome: { type: 'string', enum: ['achieved', 'unresolved'] },
      inputSettlements: { type: 'array', minItems: handles.length, maxItems: handles.length,
        items: { type: 'object', properties: {
          handle: { type: 'string', ...(handles.length ? { enum: handles } : {}) },
          disposition: { type: 'string', enum: inputSettlementDispositions },
        }, required: ['handle', 'disposition'], additionalProperties: false } },
    }, required: ['outcome', 'inputSettlements'], additionalProperties: false }; },
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
