import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  migrateAutomationWorkspaceDataV1,
} from '../kernel/l5-growth/automation-contracts.js';
import { atomicWritePrivate } from './versioned-json-store.js';
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
    const before = {
      skills: await readJson(skillFile, { skills: [] }),
      profiles: await readJson(profileFile, { profiles: [] }),
      automation: await readJson(automationFile, { candidates: [], jobs: [] }),
    };
    const data = migrateAutomationWorkspaceDataV1(before, now);

    // W2·R5 · **안 바꾼 파일은 쓰지 않는다.** 이 migration 은 "job 이 참조할 skill·profile 이
    // 실재하게" 만드는 것이 일이다. 이미 그 조건이 참인 파일까지 되쓰면, 읽고→쓰는 사이에 낀
    // 다른 저장선의 갱신이 사라진다(같은 데이터 디렉터리를 쓰는 병렬 작업선의 lost update).
    // 새 job 승인마다 세 파일이 전부 다시 써지던 것이 실제 창이었다.
    await 바뀌었으면쓰기(skillFile, before.skills, data.skills);
    await 바뀌었으면쓰기(profileFile, before.profiles, data.profiles);
    await 바뀌었으면쓰기(automationFile, before.automation, data.automation);
    return data;
  });
  migrations.set(dir, current);
  return current.finally(() => {
    if (migrations.get(dir) === current) migrations.delete(dir);
  });
}
