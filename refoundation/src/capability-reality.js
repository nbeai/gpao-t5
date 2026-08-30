const ACQUISITION = new Set(['discovered', 'source_observed', 'prepared', 'qualified', 'rejected', 'unknown']);
const CONNECTION = new Set(['not_required', 'needs_connection', 'verifying', 'ready', 'needs_reauth',
  'needs_permission', 'unavailable', 'unknown']);
const LIFECYCLE = new Set(['candidate', 'inactive', 'active', 'degraded', 'quarantined', 'archived', 'removed', 'unknown']);

function axis(value, allowed, label) {
  const result = String(value ?? 'unknown');
  if (!allowed.has(result)) throw new TypeError(`${label} is invalid`); return result;
}

function id(value) {
  const result = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/u.test(result)) throw new TypeError('capability reality id is invalid');
  return result;
}

function derived({ acquisition, connection, lifecycle }) {
  if (acquisition === 'rejected' || lifecycle === 'quarantined') return 'incompatible';
  if (connection === 'needs_connection' || connection === 'needs_reauth'
    || connection === 'needs_permission') return 'needs_auth';
  if (lifecycle === 'degraded' || (lifecycle === 'active' && connection === 'unavailable')) return 'degraded';
  if (acquisition === 'qualified' && lifecycle === 'active'
    && ['ready', 'not_required'].includes(connection)) return 'usable_now';
  if (acquisition === 'qualified' && lifecycle === 'inactive') return 'available_inactive';
  if (['discovered', 'source_observed', 'prepared'].includes(acquisition)
    || lifecycle === 'candidate') return 'preparable';
  return 'unknown';
}

export function capabilityRealityFact(input = {}) {
  const acquisition = axis(input.acquisition, ACQUISITION, 'acquisition state');
  const connection = axis(input.connection, CONNECTION, 'connection state');
  const lifecycle = axis(input.lifecycle, LIFECYCLE, 'lifecycle state');
  return Object.freeze({ id: id(input.id), label: String(input.label ?? input.id).trim().slice(0, 160),
    kind: String(input.kind ?? 'unknown').trim().slice(0, 80),
    reality: derived({ acquisition, connection, lifecycle }),
    axes: { acquisition, connection, lifecycle },
    capabilities: input.capabilities && typeof input.capabilities === 'object'
      ? Object.fromEntries(Object.entries(input.capabilities).filter(([, value]) => typeof value === 'boolean')) : {},
    userSafeSummary: String(input.userSafeSummary ?? '').trim().slice(0, 500) });
}

function connectionAxis(state) {
  if (['connected', 'ready'].includes(state)) return 'ready';
  if (state === 'needs_connection') return 'needs_connection';
  if (state === 'needs_attention') return 'unavailable';
  if (state === 'unavailable') return 'unavailable';
  return 'unknown';
}

export function makeCapabilityRealityObserver({ connectionDoctor, catalogSnapshot, factSources = [], coverage = {} } = {}) {
  if (!connectionDoctor?.inspect || !catalogSnapshot) {
    throw new TypeError('capability reality observer inputs are required');
  }
  if (!Array.isArray(factSources) || factSources.some((source) => typeof source !== 'function')) {
    throw new TypeError('capability reality fact sources are invalid');
  }
  const coverageFacts = {};
  for (const [key, value] of Object.entries(coverage)) {
    if (!/^[a-z][a-zA-Z0-9]{1,63}$/u.test(key)
      || !['complete', 'partial', 'unavailable', 'unknown'].includes(value)) {
      throw new TypeError('capability reality coverage is invalid');
    }
    coverageFacts[key] = value;
  }
  return { async inspect() {
    const [report, snapshot, ...additional] = await Promise.all([
      connectionDoctor.inspect(), catalogSnapshot, ...factSources.map((source) => source()),
    ]);
    if (!Array.isArray(snapshot?.entries)) throw new TypeError('capability catalog snapshot is invalid');
    const current = new Map(report.connections.map((item) => [item.id, item]));
    const facts = report.connections.map((item) => capabilityRealityFact({ id: item.id, label: item.label,
      kind: item.category, acquisition: 'qualified', connection: connectionAxis(item.state),
      lifecycle: item.state === 'needs_attention' ? 'degraded'
        : ['connected', 'ready'].includes(item.state) ? 'active' : 'inactive',
      capabilities: item.capabilities, userSafeSummary: item.userSafeSummary }));
    for (const candidate of snapshot.entries) if (!current.has(candidate.id)) facts.push(capabilityRealityFact({
      id: candidate.id, label: candidate.label, kind: candidate.category,
      acquisition: 'source_observed', connection: 'unknown', lifecycle: 'candidate',
      capabilities: candidate.capabilities, userSafeSummary: candidate.userSafeSummary,
    }));
    const known = new Set(facts.map((fact) => fact.id));
    for (const entries of additional) {
      if (!Array.isArray(entries)) throw new TypeError('capability reality fact source result is invalid');
      for (const input of entries) {
        const fact = capabilityRealityFact(input);
        if (known.has(fact.id)) throw new TypeError('capability reality fact id is duplicated');
        known.add(fact.id); facts.push(fact);
      }
    }
    return { schema: 't5.capability-reality.v1', checkedAt: report.checkedAt,
      coverage: structuredClone(coverageFacts), facts };
  } };
}

export function makeCapabilityRealityTool({ observer } = {}) {
  if (!observer?.inspect) throw new TypeError('capability reality observer is required');
  return { name: 'capability_reality',
    completionProposalOptional: true,
    searchTerms: ['current usable missing degraded preparable external capability reality 연결 능력 현재 가능 부족'],
    description: 'Inspect factual current capability reality only when the current tools and connections may not satisfy the user goal. It separates acquisition, account connection, and lifecycle state. It does not choose a service, install anything, or treat a candidate as usable.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['list', 'inspect'] }, id: { type: ['string', 'null'], maxLength: 64 },
    }, required: ['action', 'id'] },
    async execute({ action, id: capabilityId }) { const report = await observer.inspect();
      if (action === 'list') return report;
      if (action !== 'inspect') throw new TypeError('capability reality action is invalid');
      const fact = report.facts.find((item) => item.id === String(capabilityId ?? ''));
      if (!fact) throw new Error('capability reality not found'); return { ...report, facts: [fact] }; } };
}
