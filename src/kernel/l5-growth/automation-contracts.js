import { createHash } from 'node:crypto';

export const AUTOMATION_SCHEMA_VERSION = 2;

export const SKILL_DEFINITION_STATES = Object.freeze([
  'proposed', 'replay_required', 'approved', 'active', 'paused',
  'retired', 'rejected', 'quarantined', 'stale',
]);
export const AGENT_PROFILE_STATES = Object.freeze(['proposed', 'active', 'paused', 'retired']);
export const AUTOMATION_JOB_STATES = Object.freeze([
  'proposed', 'approved', 'scheduled', 'paused', 'cancelled', 'expired', 'needs_review',
]);
export const AGENT_RUN_STATES = Object.freeze([
  'queued', 'claimed', 'running', 'waiting_approval',
  'succeeded', 'failed', 'cancelled', 'unknown',
]);

const TRANSITIONS = Object.freeze({
  skill: {
    proposed: ['replay_required', 'rejected', 'quarantined'],
    replay_required: ['approved', 'rejected', 'quarantined', 'stale'],
    approved: ['active', 'rejected', 'quarantined', 'stale'],
    active: ['paused', 'retired', 'quarantined', 'stale'],
    paused: ['active', 'retired', 'quarantined', 'stale'],
    stale: ['replay_required', 'retired', 'quarantined'],
    retired: [], rejected: [], quarantined: [],
  },
  agentProfile: {
    proposed: ['active', 'retired'],
    active: ['paused', 'retired'],
    paused: ['active', 'retired'],
    retired: [],
  },
  automationJob: {
    proposed: ['approved', 'cancelled'],
    approved: ['scheduled', 'cancelled', 'expired', 'needs_review'],
    scheduled: ['paused', 'cancelled', 'expired', 'needs_review'],
    paused: ['scheduled', 'cancelled', 'expired', 'needs_review'],
    needs_review: ['approved', 'cancelled', 'expired'],
    cancelled: [], expired: [],
  },
  agentRun: {
    queued: ['claimed', 'cancelled'],
    claimed: ['running', 'cancelled', 'unknown'],
    running: ['waiting_approval', 'succeeded', 'failed', 'cancelled', 'unknown'],
    waiting_approval: ['running', 'failed', 'cancelled', 'unknown'],
    succeeded: [], failed: [], cancelled: [], unknown: [],
  },
});

const A = Object.freeze(['A0', 'A1', 'A2']);
const TRIGGER_KINDS = Object.freeze(['once', 'interval', 'daily', 'weekly']);
const MISFIRE_POLICIES = Object.freeze(['skip', 'catch_up_once']);
const CHILD_DENY = Object.freeze([
  'agent.create', 'agent.delegate', 'automation.create', 'automation.modify',
  'memory.propose', 'memory.confirm',
]);

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function string(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return Number.isFinite(value);
}

function stringArray(value) {
  return Array.isArray(value) && value.every(string);
}

function errorsFor(checks) {
  return checks.filter(([, ok]) => !ok).map(([message]) => message);
}

function result(errors) {
  return { ok: errors.length === 0, errors };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!object(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function contentHash(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function validateAuthorityEnvelope(envelope) {
  const e = envelope ?? {};
  const errors = errorsFor([
    ['authorityEnvelope must be an object', object(e)],
    ['authority ceiling must be A0, A1, or A2', A.includes(e.ceiling)],
    ['A3 unattended authority is forbidden', e.ceiling !== 'A3'],
    ['allowedKinds must be a string array', stringArray(e.allowedKinds)],
    ['allowedTargets must be a string array', stringArray(e.allowedTargets)],
    ['workspaceRoots must be a string array', stringArray(e.workspaceRoots)],
    ['expiresAt must be finite or null', e.expiresAt === null || finite(e.expiresAt)],
    ['maxRuns must be a positive integer', Number.isInteger(e.maxRuns) && e.maxRuns > 0],
    ['maxCost must be a non-negative number or null', e.maxCost === null || (finite(e.maxCost) && e.maxCost >= 0)],
    ['requiresFreshApprovalFor must be a string array', stringArray(e.requiresFreshApprovalFor)],
  ]);
  if (e.ceiling === 'A2' && e.maxRuns > 1) {
    if (e.allowedKinds.length === 0) errors.push('repeated A2 requires fixed allowedKinds');
    if (e.allowedTargets.length === 0) errors.push('repeated A2 requires fixed allowedTargets');
    if (!finite(e.expiresAt)) errors.push('repeated A2 requires expiresAt');
  }
  return result(errors);
}

export function validateTriggerSpec(trigger) {
  const t = trigger ?? {};
  const errors = errorsFor([
    ['trigger must be an object', object(t)],
    ['trigger kind is unsupported', TRIGGER_KINDS.includes(t.kind)],
    ['timezone is required', string(t.timezone)],
    ['misfirePolicy must be skip or catch_up_once', MISFIRE_POLICIES.includes(t.misfirePolicy)],
    ['nextRunAt must be finite or null', t.nextRunAt === null || finite(t.nextRunAt)],
  ]);
  if (t.kind === 'once' && !finite(t.at)) errors.push('once trigger requires at');
  if (t.kind === 'interval' && !(finite(t.intervalMs) && t.intervalMs > 0)) errors.push('interval trigger requires positive intervalMs');
  if (t.kind === 'daily' && !string(t.localTime)) errors.push('daily trigger requires localTime');
  if (t.kind === 'weekly') {
    if (!string(t.localTime)) errors.push('weekly trigger requires localTime');
    if (!Array.isArray(t.weekdays) || t.weekdays.length === 0
      || t.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      errors.push('weekly trigger requires weekdays from 0 through 6');
    }
  }
  if (string(t.timezone)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: t.timezone }).format(0);
    } catch {
      errors.push('timezone must be an IANA timezone');
    }
  }
  if (string(t.localTime) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(t.localTime)) {
    errors.push('localTime must be HH:MM');
  }
  return result(errors);
}

export function validateSkillDefinition(skill) {
  const s = skill ?? {};
  return result(errorsFor([
    ['skill must be an object', object(s)],
    ['skill schemaVersion must be 2', s.schemaVersion === AUTOMATION_SCHEMA_VERSION],
    ['skill id is required', string(s.id)],
    ['skill name is required', string(s.name)],
    ['skill purpose is required', string(s.purpose)],
    ['skill version must be a positive integer', Number.isInteger(s.version) && s.version > 0],
    ['skill contentHash must be sha256 hex', /^[a-f0-9]{64}$/.test(s.contentHash ?? '')],
    ['skill inputs must be an array', Array.isArray(s.inputs)],
    ['skill steps must be an array', Array.isArray(s.steps)],
    ['skill resultContract must be an object', object(s.resultContract)],
    ['skill requiredCapabilities must be a string array', stringArray(s.requiredCapabilities)],
    ['skill authorityHints must be a string array', stringArray(s.authorityHints)],
    ['skill replayCases must be an array', Array.isArray(s.replayCases)],
    ['skill source must be an object', object(s.source)],
    ['skill state is invalid', SKILL_DEFINITION_STATES.includes(s.state)],
    ['skill createdAt must be finite', finite(s.createdAt)],
    ['skill updatedAt must be finite', finite(s.updatedAt)],
    ['skill previousVersion must be an object or null', s.previousVersion === null || object(s.previousVersion)],
  ]));
}

export function validateAgentProfile(profile) {
  const p = profile ?? {};
  const authority = A.includes(p.authorityCeiling);
  return result(errorsFor([
    ['agent profile must be an object', object(p)],
    ['agent profile schemaVersion must be 2', p.schemaVersion === AUTOMATION_SCHEMA_VERSION],
    ['agent profile id is required', string(p.id)],
    ['agent profile name is required', string(p.name)],
    ['agent profile purpose is required', string(p.purpose)],
    ['agent profile modelRole is required', string(p.modelRole)],
    ['agent profile toolAllowlist must be a string array', stringArray(p.toolAllowlist)],
    ['agent profile workspaceScope must be a string array', stringArray(p.workspaceScope)],
    ['agent profile defaultBudgets must be an object', object(p.defaultBudgets)],
    ['agent profile authorityCeiling must be A0, A1, or A2', authority],
    ['agent profile state is invalid', AGENT_PROFILE_STATES.includes(p.state)],
    ['agent profile createdAt must be finite', finite(p.createdAt)],
    ['agent profile updatedAt must be finite', finite(p.updatedAt)],
  ]));
}

export function validateAutomationJob(job) {
  const j = job ?? {};
  const trigger = validateTriggerSpec(j.trigger);
  const authority = validateAuthorityEnvelope(j.authorityEnvelope);
  const errors = errorsFor([
    ['automation job must be an object', object(j)],
    ['automation job schemaVersion must be 2', j.schemaVersion === AUTOMATION_SCHEMA_VERSION],
    ['automation job id is required', string(j.id)],
    ['automation job name is required', string(j.name)],
    ['automation job skillRef must be an object', object(j.skillRef)],
    ['automation job skillRef id is required', string(j.skillRef?.id)],
    ['automation job skillRef version must be positive', Number.isInteger(j.skillRef?.version) && j.skillRef.version > 0],
    ['automation job skillRef hash must be sha256 hex', /^[a-f0-9]{64}$/.test(j.skillRef?.contentHash ?? '')],
    ['automation job agentProfileId is required', string(j.agentProfileId)],
    ['automation job inputTemplate must be an object', object(j.inputTemplate)],
    ['automation job deliveryPolicy must be an object', object(j.deliveryPolicy)],
    ['automation job state is invalid', AUTOMATION_JOB_STATES.includes(j.state)],
    ['automation job nextRunAt must be finite or null', j.nextRunAt === null || finite(j.nextRunAt)],
    ['automation job lastRunId must be a string or null', j.lastRunId === null || string(j.lastRunId)],
    ['automation job createdAt must be finite', finite(j.createdAt)],
    ['automation job updatedAt must be finite', finite(j.updatedAt)],
  ]);
  errors.push(...trigger.errors.map((e) => `trigger: ${e}`));
  errors.push(...authority.errors.map((e) => `authority: ${e}`));
  return result(errors);
}

export function validateAgentRun(run) {
  const r = run ?? {};
  const authority = validateAuthorityEnvelope(r.authorityEnvelope);
  const errors = errorsFor([
    ['agent run must be an object', object(r)],
    ['agent run schemaVersion must be 2', r.schemaVersion === AUTOMATION_SCHEMA_VERSION],
    ['agent run id is required', string(r.id)],
    ['agent run jobId is required', string(r.jobId)],
    ['agent run scheduledFor must be finite', finite(r.scheduledFor)],
    ['agent run idempotencyKey is required', string(r.idempotencyKey)],
    ['agent run skillSnapshot must be an object', object(r.skillSnapshot)],
    ['agent run triggerSnapshot must be an object', object(r.triggerSnapshot)],
    ['agent run agentSnapshot must be an object', object(r.agentSnapshot)],
    ['agent run status is invalid', AGENT_RUN_STATES.includes(r.status)],
    ['agent run owner must be an object or null', r.owner === null || object(r.owner)],
    ['agent run heartbeatAt must be finite or null', r.heartbeatAt === null || finite(r.heartbeatAt)],
    ['agent run budgets must be an object', object(r.budgets)],
    ['agent run receipts must be an array', Array.isArray(r.receipts)],
    ['agent run deliveryState must be an object', object(r.deliveryState)],
    ['agent run startedAt must be finite or null', r.startedAt === null || finite(r.startedAt)],
    ['agent run finishedAt must be finite or null', r.finishedAt === null || finite(r.finishedAt)],
  ]);
  const skill = validateSkillDefinition(r.skillSnapshot);
  const trigger = validateTriggerSpec(r.triggerSnapshot);
  const agent = validateAgentProfile(r.agentSnapshot);
  errors.push(...skill.errors.map((e) => `skillSnapshot: ${e}`));
  errors.push(...trigger.errors.map((e) => `triggerSnapshot: ${e}`));
  errors.push(...agent.errors.map((e) => `agentSnapshot: ${e}`));
  errors.push(...authority.errors.map((e) => `authority: ${e}`));
  if (r.status === 'succeeded' && r.finishedAt === null) errors.push('succeeded run requires finishedAt');
  return result(errors);
}

export function assertValid(validator, value, label = 'record') {
  const checked = validator(value);
  if (!checked.ok) throw new Error(`${label} invalid: ${checked.errors.join('; ')}`);
  return value;
}

export function transitionState(kind, record, nextState, now) {
  const key = kind === 'agentRun' ? 'status' : 'state';
  const allowed = TRANSITIONS[kind]?.[record?.[key]];
  if (!allowed || !allowed.includes(nextState)) {
    return { ok: false, record, reason: 'invalid_transition' };
  }
  const next = { ...record, [key]: nextState, updatedAt: now };
  return { ok: true, record: next };
}

function subset(child, parent) {
  const allowed = new Set(parent);
  return child.every((value) => allowed.has(value));
}

export function authorityWithin(parent, child) {
  const p = validateAuthorityEnvelope(parent);
  const c = validateAuthorityEnvelope(child);
  if (!p.ok || !c.ok) return false;
  const rank = { A0: 0, A1: 1, A2: 2 };
  if (rank[child.ceiling] > rank[parent.ceiling]) return false;
  if (!subset(child.allowedKinds, parent.allowedKinds)) return false;
  if (!subset(child.allowedTargets, parent.allowedTargets)) return false;
  if (!subset(child.workspaceRoots, parent.workspaceRoots)) return false;
  if (!subset(parent.requiresFreshApprovalFor, child.requiresFreshApprovalFor)) return false;
  if (child.maxRuns > parent.maxRuns) return false;
  if (parent.maxCost !== null && (child.maxCost === null || child.maxCost > parent.maxCost)) return false;
  if (parent.expiresAt !== null && (child.expiresAt === null || child.expiresAt > parent.expiresAt)) return false;
  return true;
}

export function reviewJobSkillBinding(job, skill, now) {
  const exact = job?.skillRef?.id === skill?.id
    && job?.skillRef?.version === skill?.version
    && job?.skillRef?.contentHash === skill?.contentHash;
  if (exact) return { ok: true, record: job, changed: false };
  const moved = transitionState('automationJob', job, 'needs_review', now);
  if (!moved.ok) return moved;
  return { ...moved, changed: true, reason: 'skill_binding_changed' };
}

function skillHashSource(skill) {
  return {
    name: skill.name,
    purpose: skill.purpose,
    inputs: skill.inputs,
    steps: skill.steps,
    resultContract: skill.resultContract,
    requiredCapabilities: skill.requiredCapabilities,
    authorityHints: skill.authorityHints,
    replayCases: skill.replayCases,
  };
}

export function reviseSkillDefinition(skill, patch, now) {
  const base = { ...skill, ...patch };
  const previousVersion = {
    version: skill.version,
    contentHash: skill.contentHash,
    state: skill.state,
    snapshot: structuredClone(skill),
  };
  const revised = {
    ...base,
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    version: skill.version + 1,
    state: 'proposed',
    updatedAt: now,
    previousVersion,
  };
  revised.contentHash = contentHash(skillHashSource(revised));
  return assertValid(validateSkillDefinition, revised, 'skill revision');
}

export function markSkillStale(skill, now) {
  const moved = transitionState('skill', skill, 'stale', now);
  if (!moved.ok) return moved;
  return { ...moved, record: { ...moved.record, staleFromHash: skill.contentHash } };
}

export function rollbackSkillDefinition(skill, now) {
  const snapshot = skill?.previousVersion?.snapshot;
  if (!object(snapshot)) return { ok: false, record: skill, reason: 'no_previous_version' };
  const restored = {
    ...structuredClone(snapshot),
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    state: snapshot.state === 'retired' ? 'paused' : snapshot.state,
    updatedAt: now,
    rolledBackFrom: { version: skill.version, contentHash: skill.contentHash },
  };
  return { ok: true, record: assertValid(validateSkillDefinition, restored, 'skill rollback') };
}

function legacySkillState(state) {
  return ({
    detected: 'proposed',
    candidate: 'proposed',
    replay_required: 'replay_required',
    approved: 'approved',
    admitted: 'active',
    rejected: 'rejected',
  })[state] ?? 'quarantined';
}

function legacyJobState(state) {
  return ({
    scheduled: 'scheduled',
    paused: 'paused',
    cancelled: 'cancelled',
    completed: 'expired',
    expired: 'expired',
    failed: 'needs_review',
  })[state] ?? 'needs_review';
}

export function migrateSkillDefinitionV1(legacy, now = 0) {
  if (legacy?.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
    return assertValid(validateSkillDefinition, legacy, 'skill');
  }
  const createdAt = finite(legacy?.createdAt) ? legacy.createdAt : now;
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: String(legacy?.id ?? ''),
    name: String(legacy?.label ?? legacy?.name ?? legacy?.id ?? '이름 없는 스킬'),
    purpose: String(legacy?.purpose ?? legacy?.trigger ?? legacy?.label ?? '이전 스킬을 보존해 옮김'),
    version: 1,
    contentHash: '',
    inputs: Array.isArray(legacy?.inputs) ? legacy.inputs : [],
    steps: Array.isArray(legacy?.steps) ? legacy.steps : [],
    resultContract: object(legacy?.resultContract) ? legacy.resultContract : { kind: 'legacy_result' },
    requiredCapabilities: string(legacy?.tool) ? [legacy.tool] : [],
    authorityHints: Array.isArray(legacy?.authorityHints) ? legacy.authorityHints : [],
    replayCases: Array.isArray(legacy?.replayCases) ? legacy.replayCases : [],
    source: {
      kind: 'legacy_v1',
      sessionId: legacy?.sessionId ?? null,
      traceIds: Array.isArray(legacy?.fromTraceIds) ? legacy.fromTraceIds : [],
    },
    state: legacySkillState(legacy?.state),
    createdAt,
    updatedAt: finite(legacy?.updatedAt) ? legacy.updatedAt : createdAt,
    previousVersion: null,
    legacyV1: structuredClone(legacy ?? {}),
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  return assertValid(validateSkillDefinition, skill, 'migrated skill');
}

function migrateTriggerV1(job) {
  if (finite(job?.intervalMs) && job.intervalMs > 0) {
    return {
      kind: 'interval', timezone: 'UTC', intervalMs: job.intervalMs,
      misfirePolicy: 'catch_up_once', nextRunAt: finite(job.nextRunAt) ? job.nextRunAt : null,
    };
  }
  return {
    kind: 'once', timezone: 'UTC',
    at: finite(job?.nextRunAt) ? job.nextRunAt : (finite(job?.createdAt) ? job.createdAt : 0),
    misfirePolicy: 'skip', nextRunAt: finite(job?.nextRunAt) ? job.nextRunAt : null,
  };
}

export function migrateAutomationJobV1(legacy, now = 0) {
  if (legacy?.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
    return assertValid(validateAutomationJob, legacy, 'automation job');
  }
  const createdAt = finite(legacy?.createdAt) ? legacy.createdAt : now;
  const action = object(legacy?.action) ? legacy.action : {};
  const target = action.args?.target ?? action.args?.path;
  const external = legacy?.external === true;
  const skillContentHash = contentHash({ action, statement: legacy?.statement ?? '' });
  const maxRuns = finite(legacy?.intervalMs) ? Number.MAX_SAFE_INTEGER : 1;
  const expiresAt = finite(legacy?.grantScope?.expiresAt) ? legacy.grantScope.expiresAt : null;
  const job = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: String(legacy?.id ?? ''),
    name: String(legacy?.name ?? legacy?.statement ?? legacy?.id ?? '이름 없는 자동화'),
    skillRef: { id: `legacy-action:${legacy?.id ?? ''}`, version: 1, contentHash: skillContentHash },
    trigger: migrateTriggerV1(legacy),
    agentProfileId: 'legacy-default-agent',
    inputTemplate: object(action.args) ? structuredClone(action.args) : {},
    authorityEnvelope: {
      ceiling: external ? 'A2' : 'A1',
      allowedKinds: string(action.tool) ? [action.tool] : [],
      allowedTargets: string(target) ? [String(target)] : [],
      workspaceRoots: [],
      expiresAt,
      maxRuns,
      maxCost: null,
      requiresFreshApprovalFor: external ? ['delivery'] : [],
    },
    deliveryPolicy: { mode: external ? 'separate' : 'none' },
    state: legacyJobState(legacy?.state),
    nextRunAt: finite(legacy?.nextRunAt) ? legacy.nextRunAt : null,
    lastRunId: legacy?.lastRunId ?? null,
    createdAt,
    updatedAt: finite(legacy?.updatedAt) ? legacy.updatedAt : createdAt,
    legacyV1: structuredClone(legacy ?? {}),
  };
  if (external && maxRuns > 1 && (!expiresAt || job.authorityEnvelope.allowedTargets.length === 0)) {
    job.state = 'needs_review';
    job.authorityEnvelope.ceiling = 'A1';
  }
  return assertValid(validateAutomationJob, job, 'migrated automation job');
}

export function migrateSkillsStateV1(raw, now = 0) {
  if (raw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) return raw;
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    skills: (raw?.skills ?? []).map((skill) => migrateSkillDefinitionV1(skill, now)),
  };
}

export function migrateAutomationStateV1(raw, now = 0) {
  if (raw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) return raw;
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: structuredClone(raw?.candidates ?? []),
    jobs: (raw?.jobs ?? []).map((job) => migrateAutomationJobV1(job, now)),
  };
}

export function childToolAllowlist(parentAllowlist, requested = []) {
  const parent = new Set(parentAllowlist ?? []);
  return (requested ?? []).filter((tool) => parent.has(tool)
    && !CHILD_DENY.includes(tool)
    && !tool.startsWith('send.')
    && !tool.endsWith('.send'));
}
