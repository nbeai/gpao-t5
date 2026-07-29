import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  migrateAutomationWorkspaceDataV1,
} from '../kernel/l5-growth/automation-contracts.js';
import { atomicWritePrivate } from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';

const migrations = new Map();

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

// Dependency-first staged commit:
// old automation remains executable while skills/profiles are installed, and the
// job file moves only after every exact reference exists.
export function migrateAutomationWorkspaceV1(dir = defaultAutomationDir(), now = 0) {
  const previous = migrations.get(dir) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    const skillFile = join(dir, 'skills.json');
    const profileFile = join(dir, 'agent-profiles.json');
    const automationFile = join(dir, 'automation.json');
    const data = migrateAutomationWorkspaceDataV1({
      skills: await readJson(skillFile, { skills: [] }),
      profiles: await readJson(profileFile, { profiles: [] }),
      automation: await readJson(automationFile, { candidates: [], jobs: [] }),
    }, now);

    await atomicWritePrivate(skillFile, data.skills);
    await atomicWritePrivate(profileFile, data.profiles);
    await atomicWritePrivate(automationFile, data.automation);
    return data;
  });
  migrations.set(dir, current);
  return current.finally(() => {
    if (migrations.get(dir) === current) migrations.delete(dir);
  });
}
