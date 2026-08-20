import { capabilityObservationsForRun } from './capability-outcome-evidence.js';

function used(run, kind, id) {
  return capabilityObservationsForRun(run).some((item) => item.relation === 'used' && item.kind === kind && item.id === id);
}

function terminalPayload(run) {
  return [...(run.events ?? [])].reverse().find((event) => /^run_(?:completed|cancelled|failed)$/u.test(event.type))?.payload ?? {};
}

function facts(run) {
  const receipts = (run.events ?? []).filter((event) => event.type === 'tool_completed').map((event) => event.payload?.receipt).filter(Boolean);
  const durationMs = run.startedAt && run.endedAt ? new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime() : null;
  return {
    runId: run.runId, status: run.status,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null,
    modelTurns: terminalPayload(run).modelTurns ?? null,
    toolCalls: receipts.filter((receipt) => receipt.actualCall).length,
    failedToolCalls: receipts.filter((receipt) => receipt.outcome === 'failed').length,
    notExecutedToolCalls: receipts.filter((receipt) => receipt.outcome === 'not_executed').length,
  };
}

function distribution(values) {
  const known = values.filter(Number.isFinite).sort((a, b) => a - b); const middle = Math.floor(known.length / 2);
  const median = !known.length ? null : known.length % 2 ? known[middle] : (known[middle - 1] + known[middle]) / 2;
  return { observed: known.length, unknown: values.length - known.length, min: known[0] ?? null, median, max: known.at(-1) ?? null };
}

function arm(runs) {
  const items = runs.map(facts); const statuses = { completed: 0, failed: 0, cancelled: 0, interrupted: 0, running: 0 };
  for (const item of items) statuses[item.status] = (statuses[item.status] ?? 0) + 1;
  return {
    sampleSize: items.length, status: statuses,
    durationMs: distribution(items.map((item) => item.durationMs)),
    modelTurns: distribution(items.map((item) => item.modelTurns)),
    toolCalls: items.reduce((sum, item) => sum + item.toolCalls, 0),
    failedToolCalls: items.reduce((sum, item) => sum + item.failedToolCalls, 0),
    notExecutedToolCalls: items.reduce((sum, item) => sum + item.notExecutedToolCalls, 0),
    runs: items,
  };
}

export function compareCapabilityRuns({ kind, id, baselineRuns = [], candidateRuns = [] } = {}) {
  if (!['cli', 'skill'].includes(kind) || !id) throw new TypeError('capability kind and id are required');
  if (!baselineRuns.length || !candidateRuns.length) throw new Error('both comparison arms require at least one Run');
  if (baselineRuns.length > 20 || candidateRuns.length > 20) throw new Error('comparison arm is too large');
  const baselineIds = new Set(baselineRuns.map((run) => run.runId));
  if (candidateRuns.some((run) => baselineIds.has(run.runId))) throw new Error('comparison arms must not share a Run');
  if (baselineRuns.some((run) => used(run, kind, id))) throw new Error('baseline Run must not use the compared capability');
  if (candidateRuns.some((run) => !used(run, kind, id))) throw new Error('every candidate Run must contain observed capability use');
  return {
    schema: 't5.capability-comparison.v1', capability: { kind, id },
    baseline: arm(baselineRuns), candidate: arm(candidateRuns),
    comparisonBoundary: {
      selectedByModel: true, samePurposeVerified: false, answerCorrectnessMeasured: false,
      qualityMeasured: false, userSatisfactionMeasured: false, lifecycleChanges: 0,
    },
  };
}

export function makeCapabilityComparisonTool({ runLedger } = {}) {
  if (!runLedger?.read) throw new TypeError('run ledger is required');
  return {
    name: 'capability_compare',
    description: 'Compare exact past baseline Runs with Runs that used one prepared method or managed command when the user asks whether it was actually better. You must select Runs that represent the same user goal; the runtime does not infer similarity. It returns status, time, model turns, tool calls, and failures without choosing a winner, recommending lifecycle changes, or claiming quality or satisfaction.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['compare'] }, kind: { type: 'string', enum: ['cli', 'skill'] }, id: { type: 'string' },
      baselineRunIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
      candidateRunIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
    }, required: ['action', 'kind', 'id', 'baselineRunIds', 'candidateRunIds'] },
    async execute(args) {
      if (args.action !== 'compare') throw new Error('unsupported capability comparison action');
      const baselineRuns = await Promise.all(args.baselineRunIds.map((runId) => runLedger.read(runId)));
      const candidateRuns = await Promise.all(args.candidateRunIds.map((runId) => runLedger.read(runId)));
      return compareCapabilityRuns({ kind: args.kind, id: args.id, baselineRuns, candidateRuns });
    },
  };
}
