import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSkillSnapshot, mergeSkillSnapshots } from '../src/skill-runtime.js';
import { ManagedSkillStore } from '../src/managed-skill-store.js';

const packages = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill-packages');

test('검증된 text-only 방법은 T5 관리 root에 0600 설치되고 제거·복원된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-skill-'));
  try {
    const catalog = await loadSkillSnapshot({ directory: packages }); const store = new ManagedSkillStore({ root: room, catalogSnapshot: catalog });
    const installed = await store.install('customer-inquiry-triage'); assert.equal(installed.state, 'installed'); assert.match(installed.content, /바로 답변 가능/u);
    assert.equal((await stat(join(room, 'active/customer-inquiry-triage/SKILL.md'))).mode & 0o777, 0o600);
    const managed = await loadSkillSnapshot({ directory: join(room, 'active') });
    const merged = mergeSkillSnapshots([{ skills: [], rejected: [], contentByName: new Map() }, managed]);
    assert.equal(merged.skills[0].name, 'customer-inquiry-triage');
    assert.equal((await store.remove('customer-inquiry-triage')).recoverable, true);
    assert.deepEqual(await store.installedNames(), []);
    await store.restore('customer-inquiry-triage'); assert.deepEqual(await store.installedNames(), ['customer-inquiry-triage']);
  } finally { await rm(room, { recursive: true, force: true }); }
});
