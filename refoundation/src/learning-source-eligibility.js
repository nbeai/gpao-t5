import { createHash } from 'node:crypto';

const DELIVERY_CONFIRMED = new Set(['persisted', 'sent', 'succeeded', 'not_requested']);

function terminalSettlements(workState) {
  return (workState?.events ?? []).filter((event) => event.type === 'work_settled');
}

function hasUnknownEffect(run) {
  return (run?.events ?? []).some((event) => {
    if (event.type !== 'tool_completed') return false;
    const receipt = event.payload?.receipt;
    return receipt?.outcome === 'unknown' || receipt?.result?.effectUnknown === true;
  });
}

function callIdentity(receipt) {
  const call = receipt?.requestedCall ?? receipt?.actualCall ?? {};
  return createHash('sha256').update(JSON.stringify({ name: call.name ?? null, args: call.args ?? null })).digest('hex');
}

function learningSignals(run, revision) {
  const signals = [];
  if (Number.isInteger(revision) && revision > 1) signals.push('work_revised');
  const receipts = (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .map((event) => event.payload?.receipt).filter(Boolean);
  const failed = receipts.findIndex((receipt) => receipt.outcome === 'failed');
  if (failed >= 0) {
    const failedIdentity = callIdentity(receipts[failed]);
    if (receipts.slice(failed + 1).some((receipt) => receipt.outcome === 'succeeded'
      && callIdentity(receipt) !== failedIdentity)) signals.push('failure_recovered_by_different_route');
  }
  if ((run?.events ?? []).some((event) => event.type === 'resource_intervention'
    || (event.type === 'resource_situation'
      && (event.payload?.anomaly?.category === 'pathology_candidate'
        || event.payload?.situation?.anomaly?.category === 'pathology_candidate')))) {
    signals.push('resource_pathology_observed');
  }
  return [...new Set(signals)];
}

export function deriveLearningSourceEligibility({ workState = {}, runs = [] } = {}) {
  const runById = new Map(runs.map((run) => [run.runId, run]));
  const sources = terminalSettlements(workState).map((settlement) => {
    const reasons = []; const work = (workState.works ?? []).find((item) => item.workId === settlement.workId);
    const proposal = (workState.proposals ?? []).find((item) => item.runId === settlement.runId
      && item.workId === settlement.workId && item.revision === settlement.revision);
    const result = (workState.results ?? []).find((item) => item.runId === settlement.runId
      && item.workId === settlement.workId && item.revision === settlement.revision);
    const run = runById.get(settlement.runId);
    if (settlement.outcome !== 'achieved') reasons.push('work_not_achieved');
    if (!proposal || proposal.verifiedOutcome !== 'achieved') reasons.push('completion_not_verified');
    else if ((proposal.blockers ?? []).length) reasons.push('completion_blocked');
    if (!result) reasons.push('result_missing');
    else {
      if (result.objectiveOutcome !== 'achieved') reasons.push('objective_not_achieved');
      if (result.state !== 'delivery_terminal') reasons.push('surface_or_delivery_not_terminal');
      if (!DELIVERY_CONFIRMED.has(result.delivery?.state)) reasons.push('delivery_not_confirmed');
    }
    if (!run) reasons.push('run_missing');
    else {
      if (run.status !== 'completed') reasons.push('run_not_completed');
      if (hasUnknownEffect(run)) reasons.push('effect_unknown');
    }
    return {
      eligible: reasons.length === 0, reasons: [...new Set(reasons)],
      learningSignals: learningSignals(run, settlement.revision),
      pointer: {
        workId: settlement.workId, revision: settlement.revision, runId: settlement.runId,
        sessionId: work?.sessionId ?? result?.sessionId ?? null,
        sourceMessageId: work?.sourceMessageId ?? null,
        resultDigest: result?.resultDigest ?? null,
      },
      recordedAt: settlement.recordedAt ?? null,
    };
  });
  return { schema: 't5.learning-source-eligibility.v1', sources,
    eligible: sources.filter((source) => source.eligible).length,
    ineligible: sources.filter((source) => !source.eligible).length };
}
