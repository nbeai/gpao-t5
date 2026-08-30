import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadSkillSnapshot, mergeSkillSnapshots } from '../src/skill-runtime.js';
import { ManagedSkillStore, makeSkillAcquisitionTool } from '../src/managed-skill-store.js';
import { loadSkillPolicyCatalog } from '../src/skill-policy-catalog.js';

const packages = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skill-packages');
const policyFile = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'skill-catalog.json');

test('검증된 text-only 방법은 T5 관리 root에 0600 설치되고 제거·복원된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-skill-'));
  try {
    const catalog = await loadSkillSnapshot({ directory: packages }); const policyCatalog = await loadSkillPolicyCatalog(policyFile);
    const store = new ManagedSkillStore({ root: room, catalogSnapshot: catalog, policyCatalog });
    const installed = await store.install('customer-inquiry-triage'); assert.equal(installed.state, 'installed'); assert.match(installed.content, /바로 답변 가능/u);
    assert.equal((await stat(join(room, 'active/customer-inquiry-triage/SKILL.md'))).mode & 0o777, 0o600);
    const managed = await loadSkillSnapshot({ directory: join(room, 'active') });
    const merged = mergeSkillSnapshots([{ skills: [], rejected: [], contentByName: new Map() }, managed]);
    assert.equal(merged.skills[0].name, 'customer-inquiry-triage');
    assert.equal((await store.remove('customer-inquiry-triage')).recoverable, true);
    assert.deepEqual(await store.installedNames(), []);
    const revision = store.entry('customer-inquiry-triage').metadata.contentDigest;
    await assert.rejects(() => store.restoreExact('customer-inquiry-triage', { digest: 'f'.repeat(64) }), /exact removed/u);
    await store.restoreExact('customer-inquiry-triage', { digest: revision }); assert.deepEqual(await store.installedNames(), ['customer-inquiry-triage']);
    assert.equal((await store.activeRevision('customer-inquiry-triage')).digest, revision);
    const restricted = await store.install('himalaya-email');
    assert.equal(restricted.state, 'explicit_selection_required');
    assert.equal(restricted.policy.selection, 'restricted_selected');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('사용자는 패키지 이름을 몰라도 현재 작업 방법을 보고 복구 가능한 보관·복원을 할 수 있다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-skill-list-'));
  try {
    const catalog = await loadSkillSnapshot({ directory: packages });
    const policyCatalog = await loadSkillPolicyCatalog(policyFile);
    const store = new ManagedSkillStore({ root: room, catalogSnapshot: catalog, policyCatalog });
    const tool = makeSkillAcquisitionTool({ store, catalogSnapshot: catalog });
    assert.equal(tool.completionProposalOptional({ action: 'search' }), true);
    assert.equal(tool.completionProposalOptional({ action: 'install' }), false);
    assert.equal((await tool.preflight({ action: 'install', effect: { kind: 'local_change',
      confirmation: 'not_applicable' } })).allowed, true);
    await store.install('xurl');
    const before = await tool.execute({ action: 'list', name: null, effect: null });
    assert.equal(before.skills.find((skill) => skill.name === 'xurl').installed, true);
    await tool.execute({ action: 'remove', name: 'xurl', effect: null });
    assert.equal((await tool.execute({ action: 'list', name: null, effect: null }))
      .skills.find((skill) => skill.name === 'xurl').installed, false);
    await tool.execute({ action: 'restore', name: 'xurl', effect: null });
    assert.equal((await tool.execute({ action: 'list', name: null, effect: null }))
      .skills.find((skill) => skill.name === 'xurl').installed, true);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('lifecycle append 실패는 activate·install·remove의 물리 상태를 원위치로 되돌린다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-managed-skill-settlement-'));
  try {
    const catalog = await loadSkillSnapshot({ directory: packages });
    const policyCatalog = await loadSkillPolicyCatalog(policyFile);
    const installStore = new ManagedSkillStore({ root: join(room, 'install'), catalogSnapshot: catalog, policyCatalog });
    installStore.append = async () => { throw new Error('injected-ledger-failure'); };
    await assert.rejects(() => installStore.install('customer-inquiry-triage'), /injected-ledger-failure/u);
    assert.deepEqual(await installStore.installedNames(), []);
    assert.deepEqual(await readdir(join(room, 'install', 'trash')), []);

    const learnedStore = new ManagedSkillStore({ root: join(room, 'learned'), catalogSnapshot: catalog, policyCatalog });
    const learned = learnedStore.entry('customer-inquiry-triage');
    learnedStore.append = async () => { throw new Error('injected-ledger-failure'); };
    await assert.rejects(() => learnedStore.activateLearned({ name: 'learned-fixture', content: learned.content,
      proposalId: 'proposal-fixture', revisionDigest: learned.metadata.contentDigest }), /injected-ledger-failure/u);
    assert.deepEqual(await learnedStore.installedNames(), []);
    assert.deepEqual(await readdir(join(room, 'learned', 'trash')), []);

    const removeStore = new ManagedSkillStore({ root: join(room, 'remove'), catalogSnapshot: catalog, policyCatalog });
    await removeStore.install('customer-inquiry-triage');
    removeStore.append = async () => { throw new Error('injected-ledger-failure'); };
    await assert.rejects(() => removeStore.remove('customer-inquiry-triage'), /injected-ledger-failure/u);
    assert.deepEqual(await removeStore.installedNames(), ['customer-inquiry-triage']);
  } finally { await rm(room, { recursive: true, force: true }); }
});
