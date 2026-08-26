import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ReflectionSourceWindowCoordinator } from '../src/reflection-source-window-coordinator.js';

const BACKING_ROOT = mkdtempSync(join(tmpdir(), 't5-reflection-window-coordinator-'));
test.after(() => rmSync(BACKING_ROOT, { recursive: true, force: true }));
let backingIdentity = 0;

function actualFile(name) {
  const path = join(BACKING_ROOT, name);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) writeFileSync(path, 'fixture');
  return path;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
};
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function enumeration({ epoch = 0, writerRegistrations = [] } = {}) {
  const heads = writerRegistrations.map((item) => ({ store: item.store,
    headDigest: hash(`head:${item.store}:${epoch}`),
    writerRegistrationDigest: item.writerRegistrationDigest }))
    .toSorted((left, right) => left.store.localeCompare(right.store));
  const schema = 't5.reflection-store-head-receipt.v1';
  return { runtimeSnapshot: { source: 'store-owned' }, episodeAllowlist: [],
    recordSourceReader: { async reopen() { return null; } },
    storeHeadReceipt: { schema, epoch, heads, receiptDigest: hash({ schema, epoch, heads }) } };
}

function fakeMaterializer(counter, hook = null) {
  return async (input) => {
    counter.calls += 1;
    await hook?.(input, counter.calls);
    const value = { attempt: counter.calls, hypothesis: input.meaningProposal.hypothesis,
      reflectionId: input.reflectionId, materializationDigest: `materialization-${counter.calls}` };
    counter.values.push(value);
    return value;
  };
}

class FakeLedger {
  constructor({ fail = 0, delay = null,
    path = actualFile(`ledger-${++backingIdentity}/reflection.jsonl`) } = {}) {
    this.path = path;
    this.fail = fail; this.delay = delay; this.calls = 0; this.active = 0; this.maxActive = 0;
    this.consumed = new Set(); this.byHypothesis = new Map();
  }
  async propose(materialization) {
    if (this.consumed.has(materialization)) {
      const error = new Error('materialization already consumed');
      error.code = 'reflection_materialization_not_fresh'; throw error;
    }
    this.consumed.add(materialization); this.calls += 1; this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await this.delay?.();
      if (this.fail > 0) { this.fail -= 1; throw new Error('injected Reflection append failure'); }
      const existing = this.byHypothesis.get(materialization.hypothesis);
      if (existing) return { created: false, idempotent: true, candidate: existing };
      this.byHypothesis.set(materialization.hypothesis, materialization.reflectionId);
      return { created: true, idempotent: false, candidate: materialization.reflectionId };
    } finally { this.active -= 1; }
  }
}

const DEFAULT_STORES = ['conversation', 'memory', 'run', 'work'];
function backingObjects(names = DEFAULT_STORES,
  prefix = join(BACKING_ROOT, `store-set-${++backingIdentity}`)) {
  return Object.fromEntries(names.map((name) => {
    const directory = join(prefix, name); mkdirSync(directory, { recursive: true });
    return [name, { name, directory }];
  }));
}
function bindingsFor(names = DEFAULT_STORES, objects = null, participation = {}) {
  const stores = objects ?? backingObjects(names);
  return Object.fromEntries(names.map((name) => [name, { store: stores[name],
    foregroundParticipating: participation[name] !== false }]));
}

function makeCoordinator({ ledger = new FakeLedger(), storeBindings = null,
  materialize, enumerate = async (context) => enumeration(context),
  requiredStores = ['conversation', 'run', 'work', 'memory'],
  participation = {} } = {}) {
  let reflection = 0;
  const bindings = storeBindings ?? bindingsFor(requiredStores, null, participation);
  return new ReflectionSourceWindowCoordinator({ ledger, enumerateSourceWindow: enumerate,
    requiredStores, storeBindings: bindings, materialize,
    clock: () => '2026-08-27T02:00:00.000Z', makeReflectionId: () => `reflection-${++reflection}` });
}

test('foreground latch가 materialization 뒤 append 전에 서면 old window는 stale이고 ledger commit은 0이다', async () => {
  const enteredMaterializer = deferred(); const releaseMaterializer = deferred();
  const mutationEntered = deferred(); const releaseMutation = deferred();
  const counter = { calls: 0, values: [] }; const ledger = new FakeLedger();
  const coordinator = makeCoordinator({ ledger, materialize: fakeMaterializer(counter, async () => {
    enteredMaterializer.resolve(); await releaseMaterializer.promise;
  }) });
  const review = coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'stale-review' } });
  await enteredMaterializer.promise;
  const mutation = coordinator.withForegroundMutation({ store: 'memory', mutate: async ({ changingEpoch }) => {
    assert.equal(changingEpoch % 2, 1); mutationEntered.resolve(); await releaseMutation.promise;
    return 'corrected';
  } });
  await mutationEntered.promise;
  releaseMaterializer.resolve();
  releaseMutation.resolve();
  await mutation;
  await assert.rejects(review, (error) => error.code === 'reflection_source_window_stale');
  assert.equal(ledger.calls, 0);
  const status = coordinator.status();
  assert.equal(status.epoch, 2); assert.equal(status.stable, true);
  assert.equal(status.metrics.materializations, 1); assert.equal(status.metrics.staleRejected, 1);
});

test('append failure는 consumed attempt를 재사용하지 않고 다음 호출에서 exact rematerialization한다', async () => {
  const ledger = new FakeLedger({ fail: 1 }); const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ ledger, materialize: fakeMaterializer(counter) });
  await assert.rejects(coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'retry' } }),
    (error) => error.message.includes('injected') && error.reflectionMaterializationConsumed === true
      && error.rematerializationRequired === true);
  const second = await coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'retry' } });
  assert.equal(second.proposal.created, true);
  assert.equal(counter.calls, 2); assert.notEqual(counter.values[0], counter.values[1]);
  assert.equal(ledger.consumed.has(counter.values[0]), true);
  assert.equal(ledger.consumed.has(counter.values[1]), true);
  const metrics = coordinator.status().metrics;
  assert.equal(metrics.appendFailures, 1); assert.equal(metrics.rematerializationsRequired, 1);
  assert.equal(metrics.proposalsCommitted, 1);
});

test('동일 hypothesis의 새 materialization은 ledger idempotency를 보존한다', async () => {
  const ledger = new FakeLedger(); const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ ledger, materialize: fakeMaterializer(counter) });
  const first = await coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'same' } });
  const duplicate = await coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'same' } });
  assert.equal(first.proposal.created, true); assert.equal(duplicate.proposal.created, false);
  assert.equal(duplicate.receipt.duplicateIdempotent, true);
  assert.equal(duplicate.receipt.coverageManifest.sameProcessCoverageQualified, false);
  assert.equal(duplicate.receipt.coverageManifest.coordinatedSnapshotCoverageQualified, true);
  assert.equal(duplicate.receipt.coverageManifest.configuredAndObserved, true);
  assert.equal(duplicate.receipt.coverageManifest.prePublicationStoreHeadsReobserved, false);
  assert.equal(duplicate.receipt.storeHeadReceipt.heads.length, 4);
  assert.equal(coordinator.status().metrics.idempotentProposals, 1);
});

test('same_canonical_stores_different_keys_cannot_bypass_epoch: 별도 instance도 canonical objects가 같으면 공유한다', async () => {
  const releaseFirstAppend = deferred(); let append = 0;
  const ledger = new FakeLedger({ delay: async () => {
    append += 1; if (append === 1) await releaseFirstAppend.promise;
  } });
  const counter = { calls: 0, values: [] };
  const backing = backingObjects(DEFAULT_STORES);
  const firstBindings = bindingsFor(DEFAULT_STORES, backing);
  const separateInstances = Object.fromEntries(DEFAULT_STORES.map((name) => [name,
    { name, directory: backing[name].directory }]));
  const secondBindings = bindingsFor(DEFAULT_STORES, separateInstances);
  const first = makeCoordinator({ ledger, storeBindings: firstBindings, materialize: fakeMaterializer(counter) });
  const second = makeCoordinator({ ledger, storeBindings: secondBindings, materialize: fakeMaterializer(counter) });
  const one = first.materializeAndPropose({ meaningProposal: { hypothesis: 'one' } });
  for (let attempt = 0; attempt < 100 && ledger.active === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const two = second.materializeAndPropose({ meaningProposal: { hypothesis: 'two' } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(ledger.maxActive, 1);
  releaseFirstAppend.resolve();
  await Promise.all([one, two]);
  assert.equal(ledger.maxActive, 1);
  assert.equal(first.status().epoch, second.status().epoch);
  assert.deepEqual(first.status().metrics, second.status().metrics);
  assert.equal(first.status().windowIdentityDigest, second.status().windowIdentityDigest);
});

test('same_backing_store_separate_instances_cannot_bypass_epoch', async () => {
  const ledgerPath = actualFile(`shared-ledger-${++backingIdentity}/reflection.jsonl`);
  const firstLedger = new FakeLedger({ path: ledgerPath });
  const secondLedger = new FakeLedger({ path: ledgerPath });
  const backing = backingObjects(DEFAULT_STORES);
  const firstStores = bindingsFor(DEFAULT_STORES, backing);
  const secondStores = bindingsFor(DEFAULT_STORES, Object.fromEntries(DEFAULT_STORES.map((name) => [name,
    { directory: backing[name].directory }])), {});
  const entered = deferred(); const release = deferred();
  const counter = { calls: 0, values: [] };
  const first = makeCoordinator({ ledger: firstLedger, storeBindings: firstStores,
    materialize: fakeMaterializer(counter) });
  const second = makeCoordinator({ ledger: secondLedger, storeBindings: secondStores,
    materialize: fakeMaterializer(counter, async () => { entered.resolve(); await release.promise; }) });
  const review = second.materializeAndPropose({ meaningProposal: { hypothesis: 'same-backing-stale' } });
  await entered.promise;
  await first.withForegroundMutation({ store: 'memory', mutate: async () => 'corrected' });
  release.resolve();
  await assert.rejects(review, (error) => error.code === 'reflection_source_window_stale');
  assert.equal(secondLedger.calls, 0);
  assert.equal(first.status().epoch, 2); assert.equal(second.status().epoch, 2);
  assert.equal(first.status().windowIdentityDigest, second.status().windowIdentityDigest);
});

test('foreground mutation 실패도 epoch를 안정된 다음 세대로 넘겨 이전 snapshot을 무효화한다', async () => {
  const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter) });
  await assert.rejects(coordinator.withForegroundMutation({ store: 'work', mutate: async () => {
    throw new Error('canonical mutation failed after latch');
  } }), /canonical mutation failed/u);
  assert.equal(coordinator.status().epoch, 2);
  assert.equal(coordinator.status().stable, true);
});

test('stable review window는 pre-commit store heads를 재확인하고 ledger commit까지 foreground를 막는다', async () => {
  const enteredCommit = deferred(); const releaseCommit = deferred(); let mutationRan = false;
  const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter) });
  const review = coordinator.withStableRead({ observe: async ({ storeHeadReceipt }) => {
    assert.equal(storeHeadReceipt.heads.length, 4); return 'observed';
  }, commit: async (value) => { assert.equal(value, 'observed'); enteredCommit.resolve();
    await releaseCommit.promise; return 'committed'; } });
  await enteredCommit.promise;
  const mutation = coordinator.withForegroundMutation({ store: 'memory', mutate: async () => {
    mutationRan = true; return 'changed';
  } });
  await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(mutationRan, false);
  releaseCommit.resolve(); assert.equal(await review, 'committed'); await mutation;
  assert.equal(mutationRan, true); assert.equal(coordinator.status().epoch, 2);
});

test('stable review window는 observe 뒤 direct store-head 변화가 보이면 commit하지 않는다', async () => {
  let enumerations = 0; let commits = 0; const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter),
    enumerate: async (context) => {
      enumerations += 1; const result = enumeration(context);
      if (enumerations === 2) {
        result.storeHeadReceipt.heads[0].headDigest = hash('direct-writer-change');
        const { schema, epoch, heads } = result.storeHeadReceipt;
        result.storeHeadReceipt.receiptDigest = hash({ schema, epoch, heads });
      }
      return result;
    } });
  await assert.rejects(coordinator.withStableRead({ observe: async () => 'observed',
    commit: async () => { commits += 1; return 'committed'; } }),
  (error) => error.code === 'reflection_source_window_stale');
  assert.equal(commits, 0); assert.equal(enumerations, 2);
});

test('nonparticipating canonical writer는 coverage manifest에 남고 proposal qualification을 열지 않는다', async () => {
  let enumerations = 0; const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter),
    requiredStores: ['conversation', 'run', 'work', 'memory'],
    participation: { memory: false },
    enumerate: async () => { enumerations += 1; return enumeration(); } });
  const status = coordinator.status();
  assert.equal(status.coverageManifest.configuredCoverageComplete, false);
  assert.equal(status.coverageManifest.sameProcessCoverageQualified, false);
  assert.deepEqual(status.coverageManifest.nonParticipatingStores, ['memory']);
  assert.equal(status.coverageManifest.nonParticipatingWriterQualified, false);
  assert.equal(status.coverageManifest.crossProcessQualified, false);
  assert.equal(status.coverageManifest.crossStoreAtomicCasQualified, false);
  assert.equal(status.coverageManifest.directWriterObservationQualified, false);
  await assert.rejects(coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'unsafe' } }),
    (error) => error.code === 'reflection_source_window_unqualified');
  assert.equal(enumerations, 0); assert.equal(counter.calls, 0);
  await assert.rejects(coordinator.withForegroundMutation({ store: 'memory', mutate: async () => {} }),
    (error) => error.code === 'reflection_source_window_writer_unqualified');
  let observed = 0; let committed = 0;
  await assert.rejects(coordinator.withStableRead({ observe: async () => { observed += 1; },
    commit: async () => { committed += 1; } }),
  (error) => error.code === 'reflection_source_window_unqualified');
  assert.equal(observed, 0); assert.equal(committed, 0);
});

test('arbitrary supplied key는 constructor contract 밖이며 같은 canonical store epoch를 우회할 수 없다', () => {
  assert.throws(() => new ReflectionSourceWindowCoordinator({ key: 'attacker-window' }),
    /unknown field: key/u);
});

test('matching_store_names_without_store_head_receipts_unqualified', async () => {
  const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter),
    enumerate: async () => ({ ...enumeration(), storeHeadReceipt: null }) });
  assert.equal(coordinator.status().coverageManifest.configuredCoverageComplete, true);
  assert.equal(coordinator.status().coverageManifest.sameProcessCoverageQualified, false);
  assert.equal(coordinator.status().coverageManifest.coordinatedSnapshotCoverageQualified, false);
  await assert.rejects(coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'headless' } }),
    /ReflectionStoreHeadReceipt must be an object/u);
  assert.equal(counter.calls, 0);
});

test('store-head receipt의 required set·writer registration·epoch digest는 exact해야 한다', async () => {
  const counter = { calls: 0, values: [] };
  const coordinator = makeCoordinator({ materialize: fakeMaterializer(counter),
    enumerate: async (context) => {
      const result = enumeration(context); result.storeHeadReceipt.heads.pop();
      const { schema, epoch, heads } = result.storeHeadReceipt;
      result.storeHeadReceipt.receiptDigest = hash({ schema, epoch, heads });
      return result;
    } });
  await assert.rejects(coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'partial-heads' } }),
    /exact required store set/u);
  assert.equal(counter.calls, 0);
});

test('unregistered_same_process_writer_invalidates_window for every coordinator sharing canonical objects', async () => {
  const ledger = new FakeLedger(); const stores = backingObjects(DEFAULT_STORES);
  const registered = bindingsFor(DEFAULT_STORES, stores);
  const counter = { calls: 0, values: [] };
  const first = makeCoordinator({ ledger, storeBindings: registered, materialize: fakeMaterializer(counter) });
  assert.equal(first.status().coverageManifest.configuredCoverageComplete, true);
  const unregistered = bindingsFor(DEFAULT_STORES, stores, { memory: false });
  const second = makeCoordinator({ ledger, storeBindings: unregistered, materialize: fakeMaterializer(counter) });
  for (const coordinator of [first, second]) {
    assert.equal(coordinator.status().coverageManifest.configuredCoverageComplete, false);
    assert.deepEqual(coordinator.status().coverageManifest.nonParticipatingStores, ['memory']);
    await assert.rejects(coordinator.materializeAndPropose({ meaningProposal: { hypothesis: 'invalid' } }),
      (error) => error.code === 'reflection_source_window_unqualified');
  }
  assert.equal(counter.calls, 0);
});

test('같은 store 이름이라도 다른 canonical object 집합은 같은 창이라고 주장하지 않는다', () => {
  const ledger = new FakeLedger(); const counter = { calls: 0, values: [] };
  const first = makeCoordinator({ ledger, storeBindings: bindingsFor(), materialize: fakeMaterializer(counter) });
  const second = makeCoordinator({ ledger, storeBindings: bindingsFor(), materialize: fakeMaterializer(counter) });
  assert.notEqual(first.status().windowIdentityDigest, second.status().windowIdentityDigest);
  assert.notDeepEqual(first.status().coverageManifest.storeBackingIdentities,
    second.status().coverageManifest.storeBackingIdentities);
});

test('relative backing과 존재하지 않거나 해석 불가능한 backing은 constructor에서 거부한다', () => {
  const counter = { calls: 0, values: [] };
  assert.throws(() => makeCoordinator({ ledger: new FakeLedger({ path: 'relative/reflection.jsonl' }),
    materialize: fakeMaterializer(counter) }), /backing path must be absolute/u);
  assert.throws(() => makeCoordinator({ ledger: new FakeLedger({
    path: join(BACKING_ROOT, 'missing-ledger', 'reflection.jsonl') }),
  materialize: fakeMaterializer(counter) }), /must already exist and be resolvable/u);

  const actual = actualFile(`priority-${++backingIdentity}/reflection.jsonl`);
  assert.throws(() => makeCoordinator({ ledger: { path: actual,
    directory: join(BACKING_ROOT, 'missing-priority-directory'), async propose() {} },
  materialize: fakeMaterializer(counter) }), /must already exist and be resolvable/u);
});

test('symlink alias는 canonical realpath로 합쳐 epoch를 나누지 못한다', async () => {
  const target = join(BACKING_ROOT, `alias-target-${++backingIdentity}`);
  mkdirSync(target, { recursive: true });
  const alias = join(BACKING_ROOT, `alias-link-${++backingIdentity}`);
  symlinkSync(target, alias, 'dir');
  const ledgerTarget = actualFile(`${target.slice(BACKING_ROOT.length + 1)}/ledger/reflection.jsonl`);
  const storeTarget = backingObjects(DEFAULT_STORES, join(target, 'stores'));
  const realBindings = bindingsFor(DEFAULT_STORES, storeTarget);
  const aliasObjects = Object.fromEntries(DEFAULT_STORES.map((name) => [name,
    { directory: join(alias, 'stores', name) }]));
  const aliasBindings = bindingsFor(DEFAULT_STORES, aliasObjects);
  const entered = deferred(); const release = deferred(); const counter = { calls: 0, values: [] };
  const real = makeCoordinator({ ledger: new FakeLedger({ path: ledgerTarget }),
    storeBindings: realBindings, materialize: fakeMaterializer(counter) });
  const aliased = makeCoordinator({ ledger: new FakeLedger({
    path: join(alias, 'ledger', 'reflection.jsonl') }), storeBindings: aliasBindings,
  materialize: fakeMaterializer(counter, async () => { entered.resolve(); await release.promise; }) });
  assert.equal(real.status().windowIdentityDigest, aliased.status().windowIdentityDigest);
  const review = aliased.materializeAndPropose({ meaningProposal: { hypothesis: 'alias-stale' } });
  await entered.promise;
  await real.withForegroundMutation({ store: 'memory', mutate: async () => 'changed' });
  release.resolve();
  await assert.rejects(review, (error) => error.code === 'reflection_source_window_stale');
  assert.equal(aliased.ledger.calls, 0);
  assert.equal(real.status().limitations.includes('symlink_alias_identity_unqualified'), false);
  assert.equal(real.status().limitations.includes(
    'backing_identity_replacement_after_construction_unqualified'), true);
});

test('macOS /tmp와 /private/tmp alias는 같은 backing identity다', { skip: process.platform !== 'darwin' }, () => {
  const tmpAliasRoot = mkdtempSync('/tmp/t5-reflection-window-alias-');
  try {
    const name = tmpAliasRoot.slice('/tmp/'.length);
    const privateRoot = `/private/tmp/${name}`;
    const ledgerPath = join(tmpAliasRoot, 'ledger', 'reflection.jsonl');
    mkdirSync(dirname(ledgerPath), { recursive: true }); writeFileSync(ledgerPath, 'fixture');
    const firstStores = backingObjects(DEFAULT_STORES, join(tmpAliasRoot, 'stores'));
    const secondStores = Object.fromEntries(DEFAULT_STORES.map((store) => [store,
      { directory: join(privateRoot, 'stores', store) }]));
    const counter = { calls: 0, values: [] };
    const first = makeCoordinator({ ledger: new FakeLedger({ path: ledgerPath }),
      storeBindings: bindingsFor(DEFAULT_STORES, firstStores), materialize: fakeMaterializer(counter) });
    const second = makeCoordinator({ ledger: new FakeLedger({
      path: join(privateRoot, 'ledger', 'reflection.jsonl') }),
    storeBindings: bindingsFor(DEFAULT_STORES, secondStores), materialize: fakeMaterializer(counter) });
    assert.equal(first.status().windowIdentityDigest, second.status().windowIdentityDigest);
  } finally { rmSync(tmpAliasRoot, { recursive: true, force: true }); }
});
