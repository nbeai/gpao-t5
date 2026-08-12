import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  migrateAutomationWorkspaceDataV1,
} from '../kernel/l5-growth/automation-contracts.js';
import { atomicWritePrivate, serializeByFile } from './versioned-json-store.js';
import { defaultAutomationDir } from './automation-store.js';

const migrations = new Map();

/** 내용이 실제로 달라졌을 때만 쓴다(같은 내용 재기록도 남의 갱신을 지운다). */
async function 바뀌었으면쓰기(file, before, after) {
  if (JSON.stringify(before) === JSON.stringify(after)) return false;
  await atomicWritePrivate(file, after);
  return true;
}

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

    // 저장소 update 와 같은 파일 큐를 공유한다. 각 단계는 잠금을 얻은 뒤 최신 디스크 상태를
    // 다시 읽으므로, migration 시작 전에 읽은 스냅샷이 그 사이의 canonical 갱신을 덮지 않는다.
    await serializeByFile(skillFile, async () => {
      const before = {
        skills: await readJson(skillFile, { skills: [] }),
        profiles: await readJson(profileFile, { profiles: [] }),
        automation: await readJson(automationFile, { candidates: [], jobs: [] }),
      };
      const migrated = migrateAutomationWorkspaceDataV1(before, now);
      await 바뀌었으면쓰기(skillFile, before.skills, migrated.skills);
    });
    await serializeByFile(profileFile, async () => {
      const before = {
        skills: await readJson(skillFile, { skills: [] }),
        profiles: await readJson(profileFile, { profiles: [] }),
        automation: await readJson(automationFile, { candidates: [], jobs: [] }),
      };
      const migrated = migrateAutomationWorkspaceDataV1(before, now);
      await 바뀌었으면쓰기(profileFile, before.profiles, migrated.profiles);
    });
    return serializeByFile(automationFile, async () => {
      const before = {
        skills: await readJson(skillFile, { skills: [] }),
        profiles: await readJson(profileFile, { profiles: [] }),
        automation: await readJson(automationFile, { candidates: [], jobs: [] }),
      };
      const migrated = migrateAutomationWorkspaceDataV1(before, now);
      await 바뀌었으면쓰기(automationFile, before.automation, migrated.automation);
      return migrated;
    });
  });
  migrations.set(dir, current);
  return current.finally(() => {
    if (migrations.get(dir) === current) migrations.delete(dir);
  });
}
