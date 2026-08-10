import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { isSendTool } from '../contracts.js';
import { AUTHORITY_KINDS, classifyTier, isAuthorityKind } from '../l2-plan/authority.js';
import { toolActionKind } from '../l2-plan/action-plan.js';

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
    queued: ['claimed'],
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
    // W2·R1: 행동 종류 어휘만 받는다. 도구 id 가 이 칸에 들어가면 부모⊇자식 비교가
    // 의미 없는 문자열 비교가 된다 — 도구 신분은 allowedTools 다.
    ['allowedKinds must use authority kinds', !stringArray(e.allowedKinds) || e.allowedKinds.every(isAuthorityKind)],
    ['allowedTools must be a string array', e.allowedTools === undefined || stringArray(e.allowedTools)],
    ['allowedTargets must be a string array', stringArray(e.allowedTargets)],
    ['workspaceRoots must be a string array', stringArray(e.workspaceRoots)],
    ['expiresAt must be finite or null', e.expiresAt === null || finite(e.expiresAt)],
    ['maxRuns must be a positive integer', Number.isInteger(e.maxRuns) && e.maxRuns > 0],
    ['maxCost must be a non-negative number or null', e.maxCost === null || (finite(e.maxCost) && e.maxCost >= 0)],
    ['requiresFreshApprovalFor must be a string array', stringArray(e.requiresFreshApprovalFor)],
  ]);
  if (e.ceiling === 'A2' && e.maxRuns > 1) {
    if (!Array.isArray(e.allowedKinds) || e.allowedKinds.length === 0) errors.push('repeated A2 requires fixed allowedKinds');
    if (!Array.isArray(e.allowedTargets) || e.allowedTargets.length === 0) errors.push('repeated A2 requires fixed allowedTargets');
    if (!finite(e.expiresAt)) errors.push('repeated A2 requires expiresAt');
  }
  return result(errors);
}

const 권한순위 = Object.freeze({ A0: 0, A1: 1, A2: 2, A3: 3 });

function 행동대상(args = {}) {
  const keys = new Set(['target', 'recipient', 'to', 'channel', 'channelid', 'chatid', 'userid']);
  return [...new Set(Object.entries(args)
    .filter(([key, value]) => keys.has(key.toLowerCase()) && string(value))
    .map(([, value]) => value))];
}

/**
 * 승인 화면은 일정과 활성 스킬·담당 역할만 고른다. 실행 인자와 권한은 후보 action에서
 * 서버가 파생한다. 요청 본문이 후보보다 넓은 계약을 새로 쓰는 경로를 만들지 않는다.
 */
export function bindAutomationCandidate(candidate, skill, profile, options = {}) {
  const action = candidate?.action;
  const tool = action?.tool;
  const args = action?.args;
  if (!string(tool) || !object(args)) return { ok: false, reason: 'candidate_action_incomplete' };
  const kind = toolActionKind({ toolId: tool, args });
  if (!isAuthorityKind(kind)) return { ok: false, reason: 'candidate_action_unknown' };
  const tier = classifyTier({ kind });
  if (tier === 'A3') return { ok: false, reason: 'candidate_action_forbidden' };
  if (skill?.state !== 'active' || !(skill.requiredCapabilities ?? []).includes(tool)) {
    return { ok: false, reason: 'skill_action_mismatch' };
  }
  if (profile?.state !== 'active' || !(profile.toolAllowlist ?? []).includes(tool)) {
    return { ok: false, reason: 'profile_action_mismatch' };
  }
  if (!(profile.authorityCeiling in 권한순위) || 권한순위[tier] > 권한순위[profile.authorityCeiling]) {
    return { ok: false, reason: 'profile_authority_too_narrow' };
  }
  const trigger = options.trigger;
  const checkedTrigger = validateTriggerSpec(trigger);
  if (!checkedTrigger.ok) return { ok: false, reason: 'invalid_trigger', errors: checkedTrigger.errors };
  const repeated = trigger.kind !== 'once';
  const expiresAt = repeated ? options.expiresAt : null;
  if (repeated && !finite(expiresAt)) return { ok: false, reason: 'repeated_requires_expiry' };
  const inputTemplate = structuredClone(args);
  if (string(inputTemplate.path) && !isAbsolute(inputTemplate.path) && !inputTemplate.path.startsWith('~/')) {
    if (profile.workspaceScope.length !== 1) return { ok: false, reason: 'relative_path_needs_workspace' };
    inputTemplate.path = resolve(profile.workspaceScope[0], inputTemplate.path);
  }
  const authorityEnvelope = {
    ceiling: tier,
    allowedKinds: [kind],
    allowedTools: [tool],
    allowedTargets: 행동대상(args),
    workspaceRoots: [...(profile.workspaceScope ?? [])],
    expiresAt,
    maxRuns: repeated ? Math.min(30, options.maxRuns ?? 30) : 1,
    maxCost: finite(profile.defaultBudgets?.maxCost) ? profile.defaultBudgets.maxCost : null,
    requiresFreshApprovalFor: [],
  };
  const checkedAuthority = validateAuthorityEnvelope(authorityEnvelope);
  if (!checkedAuthority.ok) {
    return { ok: false, reason: 'invalid_authority', errors: checkedAuthority.errors };
  }
  return {
    ok: true,
    inputTemplate,
    authorityEnvelope,
    deliveryPolicy: { mode: options.deliveryIntent === 'chat' ? 'chat' : 'none' },
  };
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
  const errors = errorsFor([
    ['skill must be an object', object(s)],
    ['skill schemaVersion must be 2', s.schemaVersion === AUTOMATION_SCHEMA_VERSION],
    ['skill id is required', string(s.id)],
    ['skill name is required', string(s.name)],
    ['skill purpose is required', string(s.purpose)],
    ['skill version must be a positive integer', Number.isInteger(s.version) && s.version > 0],
    ['skill contentHash must be sha256 hex', typeof s.contentHash === 'string' && /^[a-f0-9]{64}$/.test(s.contentHash)],
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
  ]);
  if (errors.length === 0) {
    try {
      if (contentHash(skillHashSource(s)) !== s.contentHash) errors.push('skill contentHash does not match content');
    } catch {
      errors.push('skill content cannot be hashed');
    }
  }
  return result(errors);
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
    ['automation job skillRef hash must be sha256 hex', typeof j.skillRef?.contentHash === 'string' && /^[a-f0-9]{64}$/.test(j.skillRef.contentHash)],
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
    ['agent run inputSnapshot must be an object when present', r.inputSnapshot === undefined || object(r.inputSnapshot)],
    ['agent run agentSnapshot must be an object', object(r.agentSnapshot)],
    ['agent run status is invalid', AGENT_RUN_STATES.includes(r.status)],
    ['agent run owner must be an object or null', r.owner === null || object(r.owner)],
    ['agent run heartbeatAt must be finite or null', r.heartbeatAt === null || finite(r.heartbeatAt)],
    ['agent run budgets must be an object', object(r.budgets)],
    ['agent run receipts must be an array', Array.isArray(r.receipts)],
    ['agent run deliveryState must be an object', object(r.deliveryState)],
    ['agent run startedAt must be finite or null', r.startedAt === null || finite(r.startedAt)],
    ['agent run finishedAt must be finite or null', r.finishedAt === null || finite(r.finishedAt)],
    ['agent run updatedAt must be finite, null, or absent', r.updatedAt == null || finite(r.updatedAt)],
  ]);
  const skill = validateSkillDefinition(r.skillSnapshot);
  const trigger = validateTriggerSpec(r.triggerSnapshot);
  const agent = validateAgentProfile(r.agentSnapshot);
  errors.push(...skill.errors.map((e) => `skillSnapshot: ${e}`));
  errors.push(...trigger.errors.map((e) => `triggerSnapshot: ${e}`));
  errors.push(...agent.errors.map((e) => `agentSnapshot: ${e}`));
  errors.push(...authority.errors.map((e) => `authority: ${e}`));
  const active = ['claimed', 'running', 'waiting_approval'].includes(r.status);
  const terminal = ['succeeded', 'failed', 'cancelled', 'unknown'].includes(r.status);
  if (r.status === 'queued') {
    if (r.owner !== null
      || r.heartbeatAt !== null
      || r.startedAt !== null
      || r.finishedAt !== null) {
      errors.push('queued run cannot have owner or lifecycle timestamps');
    }
  } else {
    if (!(Number.isInteger(r.owner?.pid) && r.owner.pid > 0 && string(r.owner?.ownerToken))) {
      errors.push('claimed or finished run requires pid and ownerToken');
    }
    if (!finite(r.heartbeatAt)) errors.push('claimed or finished run requires heartbeatAt');
    if (!finite(r.startedAt)) errors.push('claimed or finished run requires startedAt');
    if (!finite(r.updatedAt)) errors.push('claimed or finished run requires updatedAt');
  }
  if (active && r.finishedAt !== null) errors.push('active run cannot have finishedAt');
  if (terminal && (!finite(r.finishedAt)
    || !finite(r.startedAt)
    || r.finishedAt < r.startedAt)) {
    errors.push('terminal run requires finishedAt at or after startedAt');
  }
  if (object(r.skillSnapshot) && string(r.jobId) && finite(r.scheduledFor)) {
    const expected = agentRunIdempotencyKey({
      jobId: r.jobId,
      scheduledFor: r.scheduledFor,
      skillVersion: r.skillSnapshot.version,
      skillHash: r.skillSnapshot.contentHash,
    });
    if (r.idempotencyKey !== expected) errors.push('agent run idempotencyKey does not match snapshots');
  }
  return result(errors);
}

export function assertValid(validator, value, label = 'record') {
  const checked = validator(value);
  if (!checked.ok) throw new Error(`${label} invalid: ${checked.errors.join('; ')}`);
  return value;
}

export function transitionState(kind, record, nextState, now, patch = {}) {
  const key = kind === 'agentRun' ? 'status' : 'state';
  const allowed = TRANSITIONS[kind]?.[record?.[key]];
  if (!allowed || !allowed.includes(nextState)) {
    return { ok: false, record, reason: 'invalid_transition' };
  }
  const next = { ...record, ...patch, [key]: nextState, updatedAt: now };
  const validator = {
    skill: validateSkillDefinition,
    agentProfile: validateAgentProfile,
    automationJob: validateAutomationJob,
    agentRun: validateAgentRun,
  }[kind];
  const checked = validator?.(next);
  if (checked && !checked.ok) return { ok: false, record, reason: 'invalid_record', errors: checked.errors };
  if (kind === 'agentRun' && !agentRunTransitionWithin(record, next)) {
    return { ok: false, record, reason: 'run_envelope_expanded' };
  }
  return { ok: true, record: next };
}

export function agentRunIdempotencyKey({ jobId, scheduledFor, skillVersion, skillHash }) {
  return `${jobId}:${scheduledFor}:${skillVersion}:${skillHash}`;
}

export function claimAgentRun(run, owner, now) {
  return transitionState('agentRun', run, 'claimed', now, {
    owner: { pid: owner?.pid, ownerToken: owner?.ownerToken },
    heartbeatAt: now,
    startedAt: run.startedAt ?? now,
  });
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
  if (!subset(child.allowedTools ?? [], parent.allowedTools ?? [])) return false;
  if (!subset(child.allowedTargets, parent.allowedTargets)) return false;
  if (!subset(child.workspaceRoots, parent.workspaceRoots)) return false;
  if (!subset(parent.requiresFreshApprovalFor, child.requiresFreshApprovalFor)) return false;
  if (child.maxRuns > parent.maxRuns) return false;
  if (parent.maxCost !== null && (child.maxCost === null || child.maxCost > parent.maxCost)) return false;
  if (parent.expiresAt !== null && (child.expiresAt === null || child.expiresAt > parent.expiresAt)) return false;
  return true;
}

function sameValue(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function budgetsWithin(previous, next) {
  if (!object(previous) || !object(next)) return false;
  const before = Object.keys(previous).sort();
  const after = Object.keys(next).sort();
  if (!sameValue(before, after)) return false;
  return before.every((key) => {
    const oldValue = previous[key];
    const newValue = next[key];
    if (finite(oldValue) && finite(newValue)) return newValue <= oldValue;
    return sameValue(oldValue, newValue);
  });
}

function receiptsExtend(previous, next) {
  if (!Array.isArray(previous) || !Array.isArray(next) || next.length < previous.length) return false;
  return previous.every((receipt, index) => sameValue(receipt, next[index]));
}

export function agentRunTransitionWithin(previous, next) {
  if (!object(previous) || !object(next)) return false;
  if (previous.id !== next.id
    || previous.jobId !== next.jobId
    || previous.scheduledFor !== next.scheduledFor
    || previous.idempotencyKey !== next.idempotencyKey) return false;
  if (!sameValue(previous.skillSnapshot, next.skillSnapshot)) return false;
  if (!sameValue(previous.triggerSnapshot, next.triggerSnapshot)) return false;
  if (!sameValue(previous.inputSnapshot ?? {}, next.inputSnapshot ?? {})) return false;
  if (!sameValue(previous.agentSnapshot, next.agentSnapshot)) return false;
  if (!authorityWithin(previous.authorityEnvelope, next.authorityEnvelope)) return false;
  if (!budgetsWithin(previous.budgets, next.budgets)) return false;
  if (!receiptsExtend(previous.receipts, next.receipts)) return false;
  if (previous.status === 'queued') {
    if (next.status !== 'claimed') return false;
  } else {
    if (!sameValue(previous.owner, next.owner)) return false;
    if (previous.startedAt !== next.startedAt) return false;
  }
  if (finite(previous.heartbeatAt) && next.heartbeatAt < previous.heartbeatAt) return false;
  if (finite(previous.updatedAt) && next.updatedAt < previous.updatedAt) return false;
  return true;
}

export function reviewJobSkillBinding(job, skill, now) {
  const skillValid = validateSkillDefinition(skill).ok;
  const exact = skillValid
    && job?.skillRef?.id === skill?.id
    && job?.skillRef?.version === skill?.version
    && job?.skillRef?.contentHash === skill?.contentHash;
  if (exact) return { ok: true, record: job, changed: false };
  const moved = transitionState('automationJob', job, 'needs_review', now);
  if (!moved.ok) return moved;
  return { ...moved, changed: true, reason: 'skill_binding_changed' };
}

export function skillHashSource(skill) {
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

/** 레거시 action → 행동 종류. selfState 없이도 descriptor 맵·파일/프로세스/명령 규칙이 답한다. */
function 종류로(action) {
  const kind = toolActionKind({ toolId: action?.tool, args: action?.args });
  return isAuthorityKind(kind) ? [kind] : [];
}

function legacySkillState(state) {
  return ({
    detected: 'proposed',
    candidate: 'proposed',
    replay_required: 'replay_required',
    approved: 'approved',
    admitted: 'active',
    paused: 'paused',
    rejected: 'rejected',
  })[state] ?? 'quarantined';
}

function v2SkillState(state) {
  return ({
    proposed: 'candidate',
    replay_required: 'replay_required',
    approved: 'approved',
    active: 'admitted',
    paused: 'paused',
    retired: 'rejected',
    rejected: 'rejected',
    quarantined: 'rejected',
    stale: 'replay_required',
  })[state] ?? 'rejected';
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

export function projectSkillDefinitionV1(skill) {
  const legacy = structuredClone(skill?.legacyV1 ?? {});
  return {
    ...legacy,
    id: skill.id,
    label: legacy.label ?? skill.name,
    trigger: legacy.trigger ?? skill.purpose,
    steps: legacy.steps ?? skill.steps,
    tool: legacy.tool ?? skill.requiredCapabilities?.[0] ?? null,
    state: v2SkillState(skill.state),
    userConfirmed: legacy.userConfirmed ?? ['approved', 'active', 'paused'].includes(skill.state),
    replayPassed: legacy.replayPassed ?? ['approved', 'active', 'paused'].includes(skill.state),
    createdAt: legacy.createdAt ?? skill.createdAt,
    __v2Definition: skill,
  };
}

/**
 * v1 뷰 → v2 레코드. **`base` 는 지금 디스크에 있는 레코드다.**
 *
 * Codex 중간 감사(2026-08-02): 예전엔 뷰가 들고 있던 `__v2Definition`(로드 시점 스냅샷)을
 * 통째로 되썼다. 그래서 T0 로드 → T1 다른 저장선의 갱신 → T2 저장이 T1 을 지웠다(lost update).
 * 한 프로세스 안에서도 난다 — 자동화 워커와 라우트가 같은 저장소를 번갈아 쓴다.
 *
 * 규칙: **v1 은 자기가 소유한 칸만 쓴다**(state·legacy 블록). 나머지는 현재 레코드가 진실이다.
 * 스냅샷은 디스크에 그 레코드가 없을 때(새로 만드는 경우)만 바탕이 된다.
 */
export function mergeSkillDefinitionV1(view, now = 0, base = null) {
  if (!view?.__v2Definition) return migrateSkillDefinitionV1(view, now);
  const { __v2Definition: 스냅샷, ...legacy } = view;
  const __v2Definition = base ?? 스냅샷;
  // W2·R4 · **v1 투영은 읽기용이다.** v1 어휘(6종)는 v2 아홉 상태를 다 표현하지 못해서
  // (stale·retired·quarantined 가 replay_required·rejected 로 뭉개진다), 왕복만 해도 상태가
  // 조용히 낮아졌다 — 그리고 저장은 배열 전체를 다시 쓰므로 무관한 스킬까지 낮아졌다.
  // 규칙: v1 이 **실제로 상태를 바꿨을 때만** 그 결정을 받는다. 안 바꿨으면 아는 층(v2)이 이긴다.
  // 상태 결정은 **v1 이 본 것**(스냅샷)과 비교한다 — 그래야 "v1 이 바꿨나"가 참말이 된다.
  const v1이바꿨나 = legacy.state !== v2SkillState(스냅샷.state);
  const merged = {
    ...__v2Definition,
    state: v1이바꿨나 ? legacySkillState(legacy.state) : __v2Definition.state,
    updatedAt: finite(legacy.updatedAt) ? legacy.updatedAt : now,
    legacyV1: structuredClone(legacy),
  };
  return assertValid(validateSkillDefinition, merged, 'compatible skill');
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

export function migrateAutomationJobV1(legacy, now = 0, opts = {}) {
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
      // W2·R1: 행동 종류는 **제품 전체와 같은 판정 함수**로 뽑는다(승인·자동화·tick 한 답).
      // 도구 id 를 여기 넣던 옛 판이 두 어휘를 한 칸에 섞었다.
      allowedKinds: string(action.tool) ? 종류로(action) : [],
      allowedTools: string(action.tool) ? [action.tool] : [],
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
    migrationIntendedState: legacyJobState(legacy?.state),
  };
  if (!opts.referencesReady && ['approved', 'scheduled', 'paused'].includes(job.state)) {
    job.state = 'needs_review';
    job.migrationReview = 'exact skill and agent profile references are not installed yet';
  }
  if (external && maxRuns > 1 && (!expiresAt || job.authorityEnvelope.allowedTargets.length === 0)) {
    job.state = 'needs_review';
    job.authorityEnvelope.ceiling = 'A1';
  }
  return assertValid(validateAutomationJob, job, 'migrated automation job');
}

export function projectAutomationJobV1(job) {
  const legacy = structuredClone(job?.legacyV1 ?? {});
  return {
    ...legacy,
    id: job.id,
    statement: legacy.statement ?? job.name,
    state: job.state,
    nextRunAt: job.nextRunAt,
    lastRunId: job.lastRunId,
    executions: Array.isArray(legacy.executions) ? legacy.executions : [],
    action: legacy.action ?? {
      tool: job.authorityEnvelope?.allowedTools?.[0] ?? null,
      args: job.inputTemplate ?? {},
    },
    __v2Job: job,
  };
}

/** v1 뷰 → v2 job. `base` 는 지금 디스크의 레코드(위 mergeSkillDefinitionV1 과 같은 계약). */
export function mergeAutomationJobV1(view, now = 0, base = null) {
  if (!view?.__v2Job) return migrateAutomationJobV1(view, now);
  const { __v2Job: 스냅샷, ...legacy } = view;
  const __v2Job = base ?? 스냅샷;
  // skills 와 같은 계약: **v1 이 자기가 본 값에서 실제로 바꾼 칸만** 받는다. 안 바꾼 칸은
  // 현재 레코드가 이긴다 — 안 그러면 오래된 뷰가 그 사이의 갱신을 덮는다(동시 저장 실측).
  const 본상태 = AUTOMATION_JOB_STATES.includes(스냅샷.state) ? 스냅샷.state : legacyJobState(스냅샷.state);
  const 뷰상태 = AUTOMATION_JOB_STATES.includes(legacy.state) ? legacy.state : legacyJobState(legacy.state);
  const state = 뷰상태 === 본상태 ? __v2Job.state : 뷰상태;
  const nextRunAt = (finite(legacy.nextRunAt) && legacy.nextRunAt !== 스냅샷.nextRunAt)
    ? legacy.nextRunAt : __v2Job.nextRunAt;
  const lastRunId = (legacy.lastRunId !== undefined && legacy.lastRunId !== 스냅샷.lastRunId)
    ? legacy.lastRunId : __v2Job.lastRunId;
  const merged = {
    ...__v2Job,
    state,
    nextRunAt,
    lastRunId,
    updatedAt: finite(legacy.updatedAt) ? legacy.updatedAt : now,
    legacyV1: structuredClone(legacy),
  };
  return assertValid(validateAutomationJob, merged, 'compatible automation job');
}

export function syntheticSkillForLegacyJob(legacy, now = 0) {
  const action = object(legacy?.action) ? legacy.action : {};
  const createdAt = finite(legacy?.createdAt) ? legacy.createdAt : now;
  const skill = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: `legacy-action:${legacy?.id ?? ''}`,
    name: String(legacy?.statement ?? legacy?.id ?? '이전 자동화 작업'),
    purpose: String(legacy?.statement ?? '이전 자동화의 실행 방법을 보존'),
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'legacy_action', action: structuredClone(action) }],
    resultContract: { kind: 'legacy_tool_receipt' },
    requiredCapabilities: string(action.tool) ? [action.tool] : [],
    authorityHints: [],
    replayCases: [],
    source: { kind: 'legacy_automation_v1', sessionId: null, traceIds: [] },
    state: 'active',
    createdAt,
    updatedAt: createdAt,
    previousVersion: null,
    legacyV1: { sourceJobId: legacy?.id ?? null, action: structuredClone(action) },
  };
  skill.contentHash = contentHash(skillHashSource(skill));
  return assertValid(validateSkillDefinition, skill, 'synthetic legacy skill');
}

export function syntheticAgentProfileForLegacyJobs(legacyJobs, now = 0) {
  const toolAllowlist = [...new Set((legacyJobs ?? []).map((job) => job?.action?.tool).filter(string))];
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'legacy-default-agent',
    name: '이전 자동화 실행 역할',
    purpose: '이전 자동화의 승인 범위와 실행 도구를 그대로 보존',
    modelRole: 'worker',
    toolAllowlist,
    workspaceScope: [],
    defaultBudgets: {},
    authorityCeiling: 'A2',
    state: 'active',
    createdAt: now,
    updatedAt: now,
  };
}

export function migrateSkillsStateV1(raw, now = 0) {
  if (raw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) return raw;
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    skills: (raw?.skills ?? []).map((skill) => migrateSkillDefinitionV1(skill, now)),
  };
}

/**
 * W2·R1 복구 · 이미 v2 로 저장된 레코드가 **옛 어휘**(allowedKinds 에 도구 id)를 갖고 있으면
 * 격리하지 않고 제자리로 옮긴다. 검증만 조이면 멀쩡한 사용자 자동화가 통째로 격리된다 —
 * 계약을 조일 때는 이미 디스크에 있는 것을 어떻게 할지가 계약의 일부다.
 */
function 어휘복구(job) {
  const env = job?.authorityEnvelope;
  if (!object(env) || !Array.isArray(env.allowedKinds)) return job;
  const 옛어휘 = env.allowedKinds.filter((k) => !isAuthorityKind(k));
  if (옛어휘.length === 0) return job;
  const 종류 = env.allowedKinds.filter(isAuthorityKind);
  const 도구 = [...new Set([...(Array.isArray(env.allowedTools) ? env.allowedTools : []), ...옛어휘])];
  // 종류를 잃었으면 legacy action 에서 다시 뽑는다(지어내지 않는다 — 못 뽑으면 빈 채로 둔다).
  const 되찾은 = 종류.length ? 종류 : 종류로(job?.legacyV1?.action ?? { tool: 도구[0] });
  return { ...job, authorityEnvelope: { ...env, allowedKinds: 되찾은, allowedTools: 도구 } };
}

export function migrateAutomationStateV1(raw, now = 0, opts = {}) {
  if (raw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
    const jobs = (raw.jobs ?? []).map(어휘복구);
    const 바뀜 = jobs.some((job, i) => job !== (raw.jobs ?? [])[i]);
    return 바뀜 ? { ...raw, jobs } : raw;
  }
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    candidates: structuredClone(raw?.candidates ?? []),
    jobs: (raw?.jobs ?? []).map((job) => migrateAutomationJobV1(job, now, opts)),
  };
}

export function migrateAutomationWorkspaceDataV1({
  skills: skillRaw = { skills: [] },
  profiles: profileRaw = { profiles: [] },
  automation: automationRaw = { candidates: [], jobs: [] },
}, now = 0) {
  const skillState = migrateSkillsStateV1(skillRaw, now);
  const partialJobs = automationRaw?.schemaVersion === AUTOMATION_SCHEMA_VERSION
    ? (automationRaw?.jobs ?? []).filter((job) => object(job?.legacyV1)
      && string(job?.migrationIntendedState)
      && string(job?.migrationReview))
    : [];
  const legacyJobs = automationRaw?.schemaVersion === AUTOMATION_SCHEMA_VERSION
    ? partialJobs.map((job) => job.legacyV1)
    : (automationRaw?.jobs ?? []);
  const skills = [...skillState.skills];
  for (const legacy of legacyJobs) {
    const synthetic = syntheticSkillForLegacyJob(legacy, now);
    if (!skills.some((skill) => skill.id === synthetic.id)) skills.push(synthetic);
  }

  const profiles = profileRaw?.schemaVersion === AUTOMATION_SCHEMA_VERSION
    ? structuredClone(profileRaw.profiles ?? [])
    : (profileRaw?.profiles ?? []).map((profile) => ({
      ...profile,
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      toolAllowlist: Array.isArray(profile.toolAllowlist) ? profile.toolAllowlist : [],
      workspaceScope: Array.isArray(profile.workspaceScope) ? profile.workspaceScope : [],
      defaultBudgets: object(profile.defaultBudgets) ? profile.defaultBudgets : {},
      authorityCeiling: A.includes(profile.authorityCeiling) ? profile.authorityCeiling : 'A1',
      state: AGENT_PROFILE_STATES.includes(profile.state) ? profile.state : 'proposed',
      createdAt: finite(profile.createdAt) ? profile.createdAt : now,
      updatedAt: finite(profile.updatedAt) ? profile.updatedAt : (profile.createdAt ?? now),
      legacyV1: structuredClone(profile),
    }));
  if (legacyJobs.length && !profiles.some((profile) => profile.id === 'legacy-default-agent')) {
    profiles.push(syntheticAgentProfileForLegacyJobs(legacyJobs, now));
  } else if (legacyJobs.length) {
    const index = profiles.findIndex((profile) => profile.id === 'legacy-default-agent');
    const approvedTools = legacyJobs.map((job) => job?.action?.tool).filter(string);
    profiles[index] = {
      ...profiles[index],
      toolAllowlist: [...new Set([...(profiles[index].toolAllowlist ?? []), ...approvedTools])],
      updatedAt: now,
    };
  }
  for (const profile of profiles) assertValid(validateAgentProfile, profile, 'migrated agent profile');

  let automation;
  if (automationRaw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) {
    automation = structuredClone(automationRaw);
    automation.jobs = automation.jobs.map((job) => {
      if (!object(job.legacyV1)
        || !string(job.migrationIntendedState)
        || !string(job.migrationReview)) return job;
      const synthetic = skills.find((skill) => skill.id === `legacy-action:${job.id}`);
      if (!synthetic) return job;
      const recovered = migrateAutomationJobV1(job.legacyV1, now, { referencesReady: true });
      const { migrationReview: _migrationReview, ...withoutReview } = job;
      return assertValid(validateAutomationJob, {
        ...withoutReview,
        skillRef: {
          id: synthetic.id,
          version: synthetic.version,
          contentHash: synthetic.contentHash,
        },
        agentProfileId: 'legacy-default-agent',
        authorityEnvelope: recovered.authorityEnvelope,
        state: recovered.state,
        updatedAt: now,
      }, 'partially migrated workspace job');
    });
  } else {
    automation = migrateAutomationStateV1(automationRaw, now, { referencesReady: true });
    automation.jobs = automation.jobs.map((job) => {
      const skill = skills.find((entry) => entry.id === `legacy-action:${job.id}`);
      const next = {
        ...job,
        skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
        agentProfileId: 'legacy-default-agent',
      };
      return assertValid(validateAutomationJob, next, 'workspace migrated job');
    });
  }
  const references = validateAutomationReferences({ skills, profiles, jobs: automation.jobs });
  if (!references.ok) throw new Error(`automation references invalid: ${references.errors.join('; ')}`);
  return {
    skills: { schemaVersion: AUTOMATION_SCHEMA_VERSION, skills },
    profiles: { schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles },
    automation,
  };
}

export function validateAutomationReferences({ skills = [], profiles = [], jobs = [] }) {
  const skillById = new Map(skills.map((skill) => [skill.id, skill]));
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const errors = [];
  for (const job of jobs) {
    if (['cancelled', 'expired', 'needs_review'].includes(job.state)) continue;
    const skill = skillById.get(job.skillRef?.id);
    if (!skill
      || skill.version !== job.skillRef?.version
      || skill.contentHash !== job.skillRef?.contentHash
      || !validateSkillDefinition(skill).ok) {
      errors.push(`job ${job.id} has no exact skill binding`);
    }
    if (!profileIds.has(job.agentProfileId)) errors.push(`job ${job.id} has no agent profile`);
  }
  return result(errors);
}

export function childToolAllowlist(parentAllowlist, requested = [], selfState) {
  if (!Array.isArray(selfState?.connectedTools)) return [];
  const parent = new Set(parentAllowlist ?? []);
  const visible = new Set(selfState.connectedTools.map((tool) => tool.id));
  return (requested ?? []).filter((tool) => parent.has(tool)
    && visible.has(tool)
    && !isSendTool(tool, selfState)
    && !CHILD_DENY.includes(tool)
  );
}
