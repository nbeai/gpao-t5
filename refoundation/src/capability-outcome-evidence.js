function terminalPayload(run) {
  return [...(run.events ?? [])].reverse().find((event) => /^run_(?:completed|cancelled|failed)$/u.test(event.type))?.payload ?? {};
}

function duration(run) {
  if (!run.startedAt || !run.endedAt) return null;
  const value = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function capabilityRef(kind, id, version = null, digest = null) {
  if (!['cli', 'skill'].includes(kind) || !id) return null;
  return { kind, id: String(id), ...(version ? { version: String(version) } : {}), ...(digest ? { digest: String(digest) } : {}) };
}

function observations(receipt) {
  const found = [];
  for (const item of receipt?.result?.capabilitiesUsed ?? []) {
    const ref = capabilityRef(item.kind, item.id, item.version ?? null, item.digest ?? null);
    if (ref) found.push({ ...ref, relation: 'used' });
  }
  const name = receipt?.requestedCall?.name; const action = receipt?.requestedCall?.args?.action;
  if (receipt?.outcome === 'succeeded' && name === 'skill' && action === 'view') {
    const ref = capabilityRef('skill', receipt.result?.name, null, receipt.result?.contentDigest);
    if (ref) found.push({ ...ref, relation: 'used' });
  }
  if (receipt?.outcome === 'succeeded' && name === 'learning_trial' && action === 'view') {
    const ref = capabilityRef('skill', receipt.result?.name, null, receipt.result?.contentDigest);
    if (ref) found.push({ ...ref, relation: 'used', candidate: true,
      proposalId: receipt.result?.proposalId ?? null });
  }
  if (receipt?.outcome === 'succeeded' && name === 'capability_prepare' && ['install', 'restore'].includes(action)) {
    const ref = capabilityRef('skill', receipt.result?.name, receipt.result?.contentDigest);
    if (ref) found.push({ ...ref, relation: 'prepared' });
  }
  if (receipt?.outcome === 'succeeded' && name === 'cli_prepare' && ['install', 'restore', 'rollback'].includes(action)) {
    const ref = capabilityRef('cli', receipt.result?.id, receipt.result?.version ?? null);
    if (ref) found.push({ ...ref, relation: 'prepared' });
  }
  return found;
}

export function capabilityObservationsForRun(run) {
  return (run?.events ?? []).filter((event) => event.type === 'tool_completed')
    .flatMap((event) => observations(event.payload?.receipt));
}

function runFacts(run, receipts, refs) {
  const terminal = terminalPayload(run);
  return {
    runId: run.runId, startedAt: run.startedAt, status: run.status,
    durationMs: duration(run), modelTurns: terminal.modelTurns ?? null,
    toolCalls: receipts.filter((receipt) => receipt.actualCall).length,
    failedToolCalls: receipts.filter((receipt) => receipt.outcome === 'failed').length,
    notExecutedToolCalls: receipts.filter((receipt) => receipt.outcome === 'not_executed').length,
    prepared: refs.some((ref) => ref.relation === 'prepared'),
    used: refs.some((ref) => ref.relation === 'used'),
    preparations: refs.filter((ref) => ref.relation === 'prepared').length,
    uses: refs.filter((ref) => ref.relation === 'used').length,
  };
}

export function deriveCapabilityOutcomeEvidence(runs = []) {
  const byKey = new Map();
  for (const run of runs) {
    const receipts = (run.events ?? []).filter((event) => event.type === 'tool_completed').map((event) => event.payload?.receipt).filter(Boolean);
    const refs = capabilityObservationsForRun(run);
    const grouped = new Map();
    for (const ref of refs) {
      const key = `${ref.kind}:${ref.id}`; if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(ref);
    }
    for (const [key, runRefs] of grouped) {
      const first = runRefs[0]; if (!byKey.has(key)) byKey.set(key, { kind: first.kind, id: first.id, versions: new Set(), runs: [] });
      const entry = byKey.get(key); for (const ref of runRefs) if (ref.version || ref.digest) entry.versions.add(ref.version ?? ref.digest);
      entry.runs.push(runFacts(run, receipts, runRefs));
    }
  }
  const capabilities = [...byKey.values()].map((entry) => {
    const runsForCapability = entry.runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
    const used = runsForCapability.filter((item) => item.used);
    return {
      kind: entry.kind, id: entry.id, versions: [...entry.versions].sort(),
      preparationRuns: runsForCapability.filter((item) => item.prepared).length,
      usageRuns: used.length,
      completedUsageRuns: used.filter((item) => item.status === 'completed').length,
      failedUsageRuns: used.filter((item) => ['failed', 'interrupted'].includes(item.status)).length,
      cancelledUsageRuns: used.filter((item) => item.status === 'cancelled').length,
      lastUsedAt: used[0]?.startedAt ?? null,
      runs: runsForCapability,
    };
  }).sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
  return {
    schema: 't5.capability-outcome-evidence.v1', capabilities,
    interpretationBoundary: {
      runCompletionIsNotPurposeAchievement: true,
      qualityNotMeasured: true,
      userSatisfactionNotInferred: true,
      retirementNotAuthorized: true,
    },
  };
}

export function makeCapabilityEvidenceTool({ runLedger, maxRuns = 200 } = {}) {
  if (!runLedger?.list) throw new TypeError('run ledger is required');
  return {
    name: 'capability_evidence',
    description: 'Read observed use of prepared methods and managed commands when the user asks whether they are actually being used or remain useful. Reports use, completion/failure/cancellation, recent use, time, and retries from existing receipts. It never equates a completed run with user-goal success and never recommends, changes, or removes a capability.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list', 'inspect'] },
      kind: { type: ['string', 'null'], enum: ['cli', 'skill', null] },
      id: { type: ['string', 'null'] },
    }, required: ['action', 'kind', 'id'] },
    async execute(args) {
      const report = deriveCapabilityOutcomeEvidence((await runLedger.list()).slice(0, maxRuns));
      if (args.action === 'list') return { schema: report.schema, capabilities: report.capabilities
        .filter((item) => (!args.kind || item.kind === args.kind) && (!args.id || item.id.includes(args.id)))
        .map((item) => ({
        kind: item.kind, id: item.id, versions: item.versions, preparationRuns: item.preparationRuns,
        usageRuns: item.usageRuns, completedUsageRuns: item.completedUsageRuns,
        failedUsageRuns: item.failedUsageRuns, cancelledUsageRuns: item.cancelledUsageRuns,
        lastUsedAt: item.lastUsedAt,
      })), interpretationBoundary: report.interpretationBoundary };
      if (args.action === 'inspect') {
        if (!args.kind || !args.id) throw new TypeError('capability kind and id are required');
        const capability = report.capabilities.find((item) => item.kind === args.kind && item.id === args.id);
        return { schema: report.schema, capability: capability ?? null, interpretationBoundary: report.interpretationBoundary };
      }
      throw new Error('unsupported capability evidence action');
    },
  };
}
