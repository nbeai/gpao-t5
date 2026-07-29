import { join } from 'node:path';
import {
  AGENT_PROFILE_STATES,
  AUTOMATION_SCHEMA_VERSION,
  validateAgentProfile,
} from '../kernel/l5-growth/automation-contracts.js';
import {
  atomicWritePrivate,
  assertStateRecords,
  loadVersionedJson,
} from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';

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
    if (state.schemaVersion !== AUTOMATION_SCHEMA_VERSION) throw new Error('agent profiles schemaVersion must be 2');
    assertStateRecords(state.profiles, validateAgentProfile, 'agent profile');
    await atomicWritePrivate(this.file, state);
    return state;
  }
}
