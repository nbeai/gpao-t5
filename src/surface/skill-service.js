import {
  AUTOMATION_SCHEMA_VERSION,
  reviseSkillDefinition,
  rollbackSkillDefinition,
  transitionState,
  validateSkillDefinition,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  activeSkillSnapshot,
  normalizeSkillProposal,
  normalizeSkillRevision,
} from '../kernel/l5-growth/skill-closure.js';
import { runSkillReplay, verifyStoredSkillReplay } from '../kernel/l5-growth/skill-replay.js';

export const SKILL_SERVICE_CONTROL_NAMES = Object.freeze(['skill.propose']);

function canonicalStateError(detail) {
  return new Error(`canonical skill state required: ${detail}`);
}

export function assertCanonicalSkillState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw canonicalStateError('state must be an object');
  }
  if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) {
    throw canonicalStateError('schemaVersion must be 2');
  }
  if (state.compatibility !== undefined) {
    throw canonicalStateError('legacy compatibility views are not accepted');
  }
  if (!Array.isArray(state.skills)) throw canonicalStateError('skills must be an array');
  for (const skill of state.skills) {
    if (skill?.__v2Definition !== undefined) {
      throw canonicalStateError('__v2Definition legacy views are not accepted');
    }
    const checked = validateSkillDefinition(skill);
    if (!checked.ok) throw canonicalStateError(checked.errors.join('; '));
  }
  return state;
}

function approvalMatches(skill, approval) {
  return approval
    && typeof approval.id === 'string'
    && approval.id.trim().length > 0
    && approval.decision === 'approved'
    && approval.skillId === skill.id
    && approval.skillVersion === skill.version
    && approval.skillHash === skill.contentHash
    && approval.replayDigest === skill.lastReplay?.replayDigest;
}

export class SkillService {
  constructor(options = {}) {
    if (Object.hasOwn(options, 'replay')) {
      throw new TypeError('custom replay adapters are forbidden; use the shared AgentRun boundary');
    }
    const { store, agentRunner, evidenceStore, selfState } = options;
    if (typeof store?.load !== 'function' || typeof store?.update !== 'function') {
      throw new TypeError('SkillService requires the canonical SkillDefinitionStore load/update API');
    }
    this.store = store;
    this.replayContext = { agentRunner, evidenceStore, selfState };
  }

  async #load() {
    return assertCanonicalSkillState(await this.store.load());
  }

  async #update(operation) {
    let outcome;
    await this.store.update(async (state) => {
      assertCanonicalSkillState(state);
      const changed = await operation(structuredClone(state));
      outcome = changed.outcome;
      return assertCanonicalSkillState(changed.state ?? state);
    });
    return outcome;
  }

  async list() {
    return structuredClone(await this.#load());
  }

  async get(skillId) {
    const state = await this.#load();
    const skill = state.skills.find((entry) => entry.id === skillId);
    return skill
      ? { ok: true, skill: structuredClone(skill) }
      : { ok: false, reason: 'skill_not_found' };
  }

  async active() {
    const state = await this.#load();
    return state.skills.map(activeSkillSnapshot).filter(Boolean);
  }

  async propose(raw, context = {}) {
    const normalized = normalizeSkillProposal(raw, context);
    if (!normalized.ok) return normalized;
    return this.#update(async (state) => {
      const existing = state.skills.find((skill) => skill.id === normalized.skill.id);
      if (existing) {
        const outcome = existing.contentHash === normalized.skill.contentHash
          ? { ok: true, created: false, skill: structuredClone(existing) }
          : { ok: false, reason: 'proposal_id_conflict' };
        return { state, outcome };
      }
      state.skills.push(normalized.skill);
      return {
        state,
        outcome: { ok: true, created: true, skill: structuredClone(normalized.skill) },
      };
    });
  }

  async revise(skillId, patch, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      const current = state.skills[index];
      if (['retired', 'rejected', 'quarantined'].includes(current.state)) {
        return { state, outcome: { ok: false, reason: 'skill_not_revisable' } };
      }
      const normalized = normalizeSkillRevision(current, patch);
      if (!normalized.ok) return { state, outcome: normalized };
      const revised = reviseSkillDefinition(current, {
        ...normalized.patch,
        lastReplay: undefined,
        approval: undefined,
        activatedAt: undefined,
      }, now);
      delete revised.lastReplay;
      delete revised.approval;
      delete revised.activatedAt;
      state.skills[index] = revised;
      return { state, outcome: { ok: true, skill: structuredClone(revised) } };
    });
  }

  async replay(skillId, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    const prepared = await this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      let skill = state.skills[index];
      if (skill.state === 'proposed' || skill.state === 'stale') {
        const moved = transitionState('skill', skill, 'replay_required', now);
        if (!moved.ok) {
          return { state, outcome: { ok: false, reason: moved.reason, errors: moved.errors } };
        }
        skill = moved.record;
        state.skills[index] = skill;
      } else if (skill.state !== 'replay_required') {
        return { state, outcome: { ok: false, reason: 'skill_not_replayable' } };
      }
      return { state, outcome: { ok: true, snapshot: structuredClone(skill) } };
    });
    if (!prepared.ok) return prepared;

    const replay = await runSkillReplay(prepared.snapshot, {
      ...this.replayContext,
      runAt: now,
    });
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      const latest = state.skills[index];
      if (!latest
        || latest.state !== 'replay_required'
        || latest.version !== prepared.snapshot.version
        || latest.contentHash !== prepared.snapshot.contentHash) {
        return {
          state,
          outcome: { ok: false, reason: 'skill_changed_during_replay', replay },
        };
      }
      state.skills[index] = {
        ...latest,
        lastReplay: structuredClone(replay),
        updatedAt: now,
      };
      return { state, outcome: replay };
    });
  }

  async approve(skillId, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      const skill = state.skills[index];
      if (skill.state !== 'replay_required') {
        return { state, outcome: { ok: false, reason: 'skill_not_approvable' } };
      }
      if (skill.lastReplay?.ok !== true
        || skill.lastReplay.skillVersion !== skill.version
        || skill.lastReplay.skillHash !== skill.contentHash) {
        return { state, outcome: { ok: false, reason: 'passing_replay_required' } };
      }
      if (!approvalMatches(skill, options.approval)) {
        return { state, outcome: { ok: false, reason: 'explicit_approval_required' } };
      }
      const storedReplay = await verifyStoredSkillReplay(skill, skill.lastReplay, this.replayContext);
      if (!storedReplay.ok) {
        return {
          state,
          outcome: {
            ok: false,
            reason: 'stored_replay_invalid',
            evidenceReason: storedReplay.reason,
          },
        };
      }
      const approval = {
        id: options.approval.id.trim(),
        decision: 'approved',
        skillId: skill.id,
        skillVersion: skill.version,
        skillHash: skill.contentHash,
        replayDigest: skill.lastReplay.replayDigest,
        decidedAt: now,
      };
      const moved = transitionState('skill', skill, 'approved', now, { approval });
      if (!moved.ok) {
        return { state, outcome: { ok: false, reason: moved.reason, errors: moved.errors } };
      }
      state.skills[index] = moved.record;
      return { state, outcome: { ok: true, skill: structuredClone(moved.record) } };
    });
  }

  async activate(skillId, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      const skill = state.skills[index];
      if (skill.state !== 'approved') {
        return { state, outcome: { ok: false, reason: 'skill_not_activatable' } };
      }
      if (!approvalMatches(skill, skill.approval) || skill.lastReplay?.ok !== true) {
        return { state, outcome: { ok: false, reason: 'approval_binding_invalid' } };
      }
      const storedReplay = await verifyStoredSkillReplay(skill, skill.lastReplay, this.replayContext);
      if (!storedReplay.ok) {
        return {
          state,
          outcome: {
            ok: false,
            reason: 'stored_replay_invalid',
            evidenceReason: storedReplay.reason,
          },
        };
      }
      const moved = transitionState('skill', skill, 'active', now, { activatedAt: now });
      if (!moved.ok) {
        return { state, outcome: { ok: false, reason: moved.reason, errors: moved.errors } };
      }
      state.skills[index] = moved.record;
      return { state, outcome: { ok: true, skill: structuredClone(moved.record) } };
    });
  }

  async reject(skillId, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      const moved = transitionState('skill', state.skills[index], 'rejected', now, {
        rejectedReason: 'explicit_rejection',
      });
      if (!moved.ok) {
        return { state, outcome: { ok: false, reason: moved.reason, errors: moved.errors } };
      }
      state.skills[index] = moved.record;
      return { state, outcome: { ok: true, skill: structuredClone(moved.record) } };
    });
  }

  async rollback(skillId, options = {}) {
    const now = Number.isFinite(options.now) ? options.now : 0;
    return this.#update(async (state) => {
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { state, outcome: { ok: false, reason: 'skill_not_found' } };
      const skill = state.skills[index];
      if (!['active', 'paused'].includes(skill.state)) {
        return { state, outcome: { ok: false, reason: 'skill_not_rollbackable' } };
      }
      const rolledBack = rollbackSkillDefinition(skill, now);
      if (!rolledBack.ok) {
        return { state, outcome: { ok: false, reason: rolledBack.reason } };
      }
      state.skills[index] = rolledBack.record;
      return { state, outcome: { ok: true, skill: structuredClone(rolledBack.record) } };
    });
  }
}
