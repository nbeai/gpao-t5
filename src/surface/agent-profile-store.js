import { join } from 'node:path';
import {
  AGENT_PROFILE_STATES,
  AUTOMATION_SCHEMA_VERSION,
  validateAgentProfile,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  serializeByFile,
  atomicWritePrivate,
  assertStateRecords,
  loadVersionedJson,
} from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';
import {
  proposeAgentProfile,
  reviseAgentProfile,
  transitionAgentProfile,
} from '../kernel/l5-growth/agent-profile.js';

function migrateProfiles(raw) {
  if (raw?.schemaVersion === AUTOMATION_SCHEMA_VERSION) return raw;
  const profiles = (raw?.profiles ?? []).map((profile) => ({
    ...profile,
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    toolAllowlist: Array.isArray(profile.toolAllowlist) ? profile.toolAllowlist : [],
    workspaceScope: Array.isArray(profile.workspaceScope) ? profile.workspaceScope : [],
    defaultBudgets: profile.defaultBudgets ?? {},
    authorityCeiling: profile.authorityCeiling ?? 'A1',
    state: AGENT_PROFILE_STATES.includes(profile.state) ? profile.state : 'proposed',
    createdAt: Number.isFinite(profile.createdAt) ? profile.createdAt : 0,
    updatedAt: Number.isFinite(profile.updatedAt) ? profile.updatedAt : (profile.createdAt ?? 0),
    legacyV1: structuredClone(profile),
  }));
  return { schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles };
}

export class AgentProfileStore {
  constructor(dir = defaultAutomationDir()) {
    this.dir = dir;
    this.file = join(dir, 'agent-profiles.json');
  }

  async load() {
    const fallback = { schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [] };
    const loaded = await loadVersionedJson(
      this.file,
      fallback,
      migrateProfiles,
      (state) => {
        if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('agent profiles schemaVersion must be 2');
        assertStateRecords(state.profiles, validateAgentProfile, 'agent profile');
      },
    );
    return { ...loaded.state, ...(loaded.recovery ? { recovery: loaded.recovery } : {}) };
  }

  async save(state) {
    return serializeByFile(this.file, () => this.#write(state));
  }

  async #write(state) {
    if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('agent profiles schemaVersion must be 2');
    assertStateRecords(state.profiles, validateAgentProfile, 'agent profile');
    await atomicWritePrivate(this.file, {
      schemaVersion: AUTOMATION_SCHEMA_VERSION,
      profiles: state.profiles ?? [],
    });
    return state;
  }

  async #mutate(change) {
    return serializeByFile(this.file, async () => {
      const state = await this.load();
      const next = await change({
        schemaVersion: AUTOMATION_SCHEMA_VERSION,
        profiles: [...(state.profiles ?? [])],
      });
      await this.#write(next.state);
      return next.record;
    });
  }

  async propose(input, now = Date.now()) {
    return this.#mutate((state) => {
      if (state.profiles.some((profile) => profile.id === input?.id)) {
        throw new Error('agent profile id already exists');
      }
      const record = proposeAgentProfile(input, now);
      return { state: { ...state, profiles: [...state.profiles, record] }, record };
    });
  }

  async update(id, patch, now = Date.now()) {
    return this.#mutate((state) => {
      const index = state.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new Error('agent profile not found');
      const record = reviseAgentProfile(state.profiles[index], patch, now);
      const profiles = [...state.profiles];
      profiles[index] = record;
      return { state: { ...state, profiles }, record };
    });
  }

  async transition(id, nextState, now = Date.now()) {
    return this.#mutate((state) => {
      const index = state.profiles.findIndex((profile) => profile.id === id);
      if (index < 0) throw new Error('agent profile not found');
      const moved = transitionAgentProfile(state.profiles[index], nextState, now);
      if (!moved.ok) throw new Error(`agent profile transition invalid: ${moved.reason}`);
      const profiles = [...state.profiles];
      profiles[index] = moved.record;
      return { state: { ...state, profiles }, record: moved.record };
    });
  }

  activate(id, now = Date.now()) {
    return this.transition(id, 'active', now);
  }

  pause(id, now = Date.now()) {
    return this.transition(id, 'paused', now);
  }

  retire(id, now = Date.now()) {
    return this.transition(id, 'retired', now);
  }
}
