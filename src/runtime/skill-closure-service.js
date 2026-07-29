import { transitionState } from '../kernel/l5-growth/automation-contracts.js';
import { normalizeSkillProposal } from '../kernel/l5-growth/skill-closure.js';
import { runSkillReplay } from './skill-replay-runner.js';

export class SkillClosureService {
  constructor({ store, executeReplayCase }) {
    if (!store || typeof store.load !== 'function' || typeof store.save !== 'function') {
      throw new TypeError('SkillClosureService requires a skill definition store');
    }
    this.store = store;
    this.executeReplayCase = executeReplayCase;
    this.pending = Promise.resolve();
  }

  #serialize(operation) {
    const next = this.pending.then(operation, operation);
    this.pending = next.catch(() => {});
    return next;
  }

  propose(raw, context = {}) {
    return this.#serialize(async () => {
      const normalized = normalizeSkillProposal(raw, context);
      if (!normalized.ok) return normalized;
      const state = await this.store.load();
      const existing = state.skills.find((skill) => skill.id === normalized.skill.id);
      if (existing) {
        if (existing.contentHash !== normalized.skill.contentHash) {
          return { ok: false, reason: 'proposal_id_conflict' };
        }
        return { ok: true, created: false, skill: existing };
      }
      const skill = normalized.skill;
      await this.store.save({
        schemaVersion: state.schemaVersion,
        skills: [...state.skills, skill],
      });
      return { ok: true, created: true, skill };
    });
  }

  replay(skillId, options = {}) {
    return this.#serialize(async () => {
      const state = await this.store.load();
      const index = state.skills.findIndex((skill) => skill.id === skillId);
      if (index < 0) return { ok: false, reason: 'skill_not_found' };

      let skill = state.skills[index];
      if (skill.state === 'proposed') {
        const moved = transitionState('skill', skill, 'replay_required', options.now ?? 0);
        if (!moved.ok) return { ok: false, reason: moved.reason, errors: moved.errors };
        skill = moved.record;
        state.skills[index] = skill;
        await this.store.save(state);
      } else if (skill.state !== 'replay_required') {
        return { ok: false, reason: 'skill_not_replayable' };
      }

      const snapshot = structuredClone(skill);
      const replay = await runSkillReplay(snapshot, {
        execute: this.executeReplayCase,
        runAt: options.now,
      });

      const latestState = await this.store.load();
      const latestIndex = latestState.skills.findIndex((entry) => entry.id === skillId);
      const latest = latestState.skills[latestIndex];
      if (!latest
        || latest.version !== snapshot.version
        || latest.contentHash !== snapshot.contentHash) {
        return { ok: false, reason: 'skill_changed_during_replay', replay };
      }

      latestState.skills[latestIndex] = {
        ...latest,
        lastReplay: replay,
        updatedAt: Number.isFinite(options.now) ? options.now : latest.updatedAt,
      };
      await this.store.save(latestState);
      return replay;
    });
  }
}
