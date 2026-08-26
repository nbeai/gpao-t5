import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { materializeReflectionEvidence } from './reflection-evidence-materializer.js';

const SHARED_WINDOWS = new Map();
const MATERIALIZE_FIELDS = new Set(['meaningProposal']);
const MUTATION_FIELDS = new Set(['store', 'mutate']);
const ENUMERATION_FIELDS = new Set([
  'runtimeSnapshot', 'episodeAllowlist', 'recordSourceReader', 'storeHeadReceipt',
]);
const CONSTRUCTOR_FIELDS = new Set([
  'ledger', 'enumerateSourceWindow', 'requiredStores', 'storeBindings', 'materialize',
  'clock', 'makeReflectionId', 'createdBy',
]);
const STORE_BINDING_FIELDS = new Set(['store', 'foregroundParticipating']);
const STORE_HEAD_RECEIPT_FIELDS = new Set(['schema', 'epoch', 'heads', 'receiptDigest']);
const STORE_HEAD_FIELDS = new Set(['store', 'headDigest', 'writerRegistrationDigest']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value;
}

function exact(value, fields, label) {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new TypeError(`${label} has unknown field: ${field}`);
  }
  for (const field of fields) {
    if (!(field in value)) throw new TypeError(`${label}.${field} is required`);
  }
}

function known(value, fields, label) {
  object(value, label);
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) throw new TypeError(`${label} has unknown field: ${field}`);
  }
}

function text(value, label) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > 256
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new TypeError(`${label} must be bounded non-empty text`);
  }
  return value;
}

function stores(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new TypeError(`${label} must be a bounded non-empty array`);
  }
  const result = value.map((item) => text(item, `${label} item`));
  if (new Set(result).size !== result.length) throw new TypeError(`${label} must be unique`);
  return result.toSorted();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function digest(value, label) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function backingIdentity(value, label) {
  if ((!value || (typeof value !== 'object' && typeof value !== 'function'))) {
    throw new TypeError(`${label} must be an authoritative object identity`);
  }
  const usesDirectory = typeof value.directory === 'string' && value.directory.trim();
  const candidate = usesDirectory ? value.directory
    : typeof value.path === 'string' && value.path.trim() ? value.path : null;
  if (!candidate) {
    throw new TypeError(`${label} must expose an absolute backing .path or .directory`);
  }
  if (!isAbsolute(candidate)) throw new TypeError(`${label} backing path must be absolute`);
  let canonical;
  try { canonical = realpathSync.native(candidate); }
  catch {
    throw new TypeError(`${label} backing path must already exist and be resolvable`);
  }
  const stat = lstatSync(canonical);
  if ((usesDirectory && !stat.isDirectory()) || (!usesDirectory && !stat.isFile())) {
    throw new TypeError(`${label} backing path has an invalid canonical type`);
  }
  return canonical;
}

function normalizeBindings(requiredStores, input) {
  object(input, 'storeBindings');
  const names = Object.keys(input).toSorted();
  if (JSON.stringify(names) !== JSON.stringify(requiredStores)) {
    throw new TypeError('storeBindings must exactly cover requiredStores');
  }
  const seenObjects = new Set();
  return Object.fromEntries(names.map((name) => {
    const binding = input[name]; exact(binding, STORE_BINDING_FIELDS, `storeBindings.${name}`);
    if (typeof binding.foregroundParticipating !== 'boolean') {
      throw new TypeError(`storeBindings.${name}.foregroundParticipating must be boolean`);
    }
    const storeBackingIdentity = backingIdentity(binding.store, `storeBindings.${name}.store`);
    if (seenObjects.has(storeBackingIdentity)) {
      throw new TypeError('one canonical store object cannot impersonate multiple required stores');
    }
    seenObjects.add(storeBackingIdentity);
    const writerRegistrationDigest = hash({ schema: 't5.reflection-writer-registration.v1',
      store: name, storeBackingIdentity, foregroundParticipating: binding.foregroundParticipating });
    return [name, { store: binding.store, foregroundParticipating: binding.foregroundParticipating,
      storeBackingIdentity, writerRegistrationDigest }];
  }));
}

function sharedWindow(identity, requiredStores, bindings) {
  let state = SHARED_WINDOWS.get(identity);
  if (!state) {
    state = {
      epoch: 0,
      tail: Promise.resolve(),
      requiredStores: [...requiredStores],
      invalidatedWriters: new Set(),
      lastStoreHeadReceipt: null,
      metrics: {
        snapshots: 0, materializations: 0, proposeAttempts: 0, proposalsCommitted: 0,
        idempotentProposals: 0, staleRejected: 0, appendFailures: 0,
        rematerializationsRequired: 0, foregroundMutations: 0,
      },
    };
    SHARED_WINDOWS.set(identity, state);
  } else if (JSON.stringify(state.requiredStores) !== JSON.stringify(requiredStores)) {
    throw new TypeError('shared Reflection source-window required-store configuration mismatch');
  }
  for (const name of requiredStores) {
    if (!bindings[name].foregroundParticipating) state.invalidatedWriters.add(name);
  }
  return state;
}

function exclusive(state, work) {
  const next = state.tail.then(work, work);
  state.tail = next.catch(() => {});
  return next;
}

function coverageManifest(requiredStores, bindings, state) {
  const nonParticipatingStores = requiredStores.filter((store) => (
    !bindings[store].foregroundParticipating || state.invalidatedWriters.has(store)
  ));
  const configuredCoverageComplete = nonParticipatingStores.length === 0;
  const observed = state.lastStoreHeadReceipt;
  const coordinatedSnapshotCoverageQualified = configuredCoverageComplete
    && state.epoch % 2 === 0 && observed?.epoch === state.epoch;
  return {
    schema: 't5.reflection-source-window-coverage.v1',
    requiredStores: [...requiredStores],
    configuredStoreNames: Object.keys(bindings).toSorted(),
    configuredCoverageComplete,
    nonParticipatingStores,
    storeBackingIdentities: requiredStores.map((store) => ({ store,
      identityDigest: hash(bindings[store].storeBackingIdentity) })),
    observedStoreHeads: structuredClone(observed?.heads ?? []),
    observedStoreHeadEpoch: observed?.epoch ?? null,
    windowComponents: [
      'achieved_episode_heads', 'conversation_run_work_records', 'current_corrections',
      'forget_heads', 'counterexample_search_receipt',
    ],
    configuredAndObserved: coordinatedSnapshotCoverageQualified,
    coordinatedSnapshotCoverageQualified,
    sameProcessCoverageQualified: false,
    directWriterObservationQualified: false,
    prePublicationStoreHeadsReobserved: false,
    crossProcessQualified: false,
    crossStoreAtomicCasQualified: false,
    nonParticipatingWriterQualified: false,
  };
}

function snapshotStatus(identityDigest, state, requiredStores, bindings) {
  return {
    schema: 't5.reflection-source-window-coordinator-status.v1',
    windowIdentityDigest: identityDigest,
    epoch: state.epoch,
    stable: state.epoch % 2 === 0,
    coverageManifest: coverageManifest(requiredStores, bindings, state),
    metrics: structuredClone(state.metrics),
    limitations: [
      'cross_process_lock_unqualified',
      'cross_store_atomic_cas_unqualified',
      'non_participating_writers_unobservable',
      'direct_same_process_writers_unobservable',
      'pre_publication_store_heads_not_reobserved',
      'backing_identity_replacement_after_construction_unqualified',
    ],
  };
}

function staleError(startEpoch, currentEpoch) {
  const error = new Error('Reflection source window changed before proposal publication');
  error.code = 'reflection_source_window_stale';
  error.startEpoch = startEpoch;
  error.currentEpoch = currentEpoch;
  return error;
}

export class ReflectionSourceWindowCoordinator {
  constructor(input = {}) {
    known(input, CONSTRUCTOR_FIELDS, 'ReflectionSourceWindowCoordinator');
    const { ledger, enumerateSourceWindow, requiredStores: inputRequiredStores,
      storeBindings: inputStoreBindings, materialize = materializeReflectionEvidence,
      clock = () => new Date().toISOString(), makeReflectionId = randomUUID,
      createdBy = 'background_reviewer' } = input;
    if (typeof ledger?.propose !== 'function' || typeof enumerateSourceWindow !== 'function'
      || typeof materialize !== 'function' || typeof clock !== 'function'
      || typeof makeReflectionId !== 'function') {
      throw new TypeError('Reflection source-window coordinator dependencies are required');
    }
    if (!['main_model', 'background_reviewer'].includes(createdBy)) {
      throw new TypeError('Reflection source-window createdBy is invalid');
    }
    this.ledger = ledger;
    this.enumerateSourceWindow = enumerateSourceWindow;
    this.requiredStores = stores(inputRequiredStores, 'requiredStores');
    this.storeBindings = normalizeBindings(this.requiredStores, inputStoreBindings);
    this.materialize = materialize;
    this.clock = clock;
    this.makeReflectionId = makeReflectionId;
    this.createdBy = createdBy;
    const ledgerIdentity = backingIdentity(ledger, 'Reflection ledger');
    const sourceIdentity = [ledgerIdentity, ...this.requiredStores.map((name) => (
      `${name}:${this.storeBindings[name].storeBackingIdentity}`
    ))].join('|');
    this.windowIdentityDigest = hash(sourceIdentity);
    this.shared = sharedWindow(sourceIdentity, this.requiredStores, this.storeBindings);
  }

  status() {
    return snapshotStatus(this.windowIdentityDigest, this.shared, this.requiredStores, this.storeBindings);
  }

  async withForegroundMutation(input = {}) {
    exact(input, MUTATION_FIELDS, 'ReflectionForegroundMutation');
    const store = text(input.store, 'ReflectionForegroundMutation.store');
    if (typeof input.mutate !== 'function') throw new TypeError('foreground mutate function is required');
    if (!this.storeBindings[store]?.foregroundParticipating
      || this.shared.invalidatedWriters.has(store)) {
      const error = new Error('foreground writer is not covered by this source window');
      error.code = 'reflection_source_window_writer_unqualified';
      throw error;
    }
    return exclusive(this.shared, async () => {
      if (this.shared.epoch % 2 !== 0) throw new Error('Reflection source window is already changing');
      this.shared.epoch += 1;
      const changingEpoch = this.shared.epoch;
      this.shared.metrics.foregroundMutations += 1;
      try {
        const value = await input.mutate({ changingEpoch,
          windowIdentityDigest: this.windowIdentityDigest, store: this.storeBindings[store].store });
        return { value, changingEpoch, stableEpoch: changingEpoch + 1 };
      } finally {
        this.shared.epoch += 1;
      }
    });
  }

  async materializeAndPropose(input = {}) {
    exact(input, MATERIALIZE_FIELDS, 'ReflectionMaterializeAndPropose');
    let manifest = coverageManifest(this.requiredStores, this.storeBindings, this.shared);
    if (!manifest.configuredCoverageComplete) {
      const error = new Error('Reflection source window has non-participating canonical writers');
      error.code = 'reflection_source_window_unqualified';
      error.coverageManifest = manifest;
      throw error;
    }

    const observed = await exclusive(this.shared, async () => {
      if (this.shared.epoch % 2 !== 0) throw staleError(this.shared.epoch, this.shared.epoch);
      const startEpoch = this.shared.epoch;
      const writerRegistrations = this.requiredStores.map((store) => ({ store,
        writerRegistrationDigest: this.storeBindings[store].writerRegistrationDigest }));
      const enumerated = await this.enumerateSourceWindow({
        windowIdentityDigest: this.windowIdentityDigest, epoch: startEpoch,
        stores: Object.fromEntries(this.requiredStores.map((name) => [name, this.storeBindings[name].store])),
        writerRegistrations: structuredClone(writerRegistrations),
      });
      exact(enumerated, ENUMERATION_FIELDS, 'ReflectionSourceWindowEnumeration');
      if (!Array.isArray(enumerated.episodeAllowlist)
        || typeof enumerated.recordSourceReader?.reopen !== 'function') {
        throw new TypeError('Reflection source-window enumeration is incomplete');
      }
      const storeHeadReceipt = this.#validateStoreHeadReceipt(enumerated.storeHeadReceipt,
        startEpoch, writerRegistrations);
      this.shared.lastStoreHeadReceipt = storeHeadReceipt;
      this.shared.metrics.snapshots += 1;
      return {
        startEpoch,
        runtimeSnapshot: structuredClone(enumerated.runtimeSnapshot),
        episodeAllowlist: structuredClone(enumerated.episodeAllowlist),
        recordSourceReader: enumerated.recordSourceReader,
        storeHeadReceipt,
      };
    });

    const materialization = await this.materialize({
      meaningProposal: input.meaningProposal,
      episodeAllowlist: observed.episodeAllowlist,
      runtimeSnapshot: observed.runtimeSnapshot,
      recordSourceReader: observed.recordSourceReader,
      reflectionId: this.makeReflectionId(),
      createdBy: this.createdBy,
      observedAt: this.clock(),
    });
    this.shared.metrics.materializations += 1;

    return exclusive(this.shared, async () => {
      if (this.shared.epoch !== observed.startEpoch || this.shared.epoch % 2 !== 0) {
        this.shared.metrics.staleRejected += 1;
        throw staleError(observed.startEpoch, this.shared.epoch);
      }
      manifest = coverageManifest(this.requiredStores, this.storeBindings, this.shared);
      if (!manifest.coordinatedSnapshotCoverageQualified) {
        this.shared.metrics.staleRejected += 1;
        throw staleError(observed.startEpoch, this.shared.epoch);
      }
      this.shared.metrics.proposeAttempts += 1;
      let proposal;
      try {
        proposal = await this.ledger.propose(materialization);
      } catch (error) {
        this.shared.metrics.appendFailures += 1;
        this.shared.metrics.rematerializationsRequired += 1;
        error.reflectionMaterializationConsumed = true;
        error.rematerializationRequired = true;
        throw error;
      }
      if (this.shared.epoch !== observed.startEpoch || this.shared.epoch % 2 !== 0) {
        throw new Error('Reflection source-window epoch changed inside serialized publication');
      }
      if (proposal?.created === true) this.shared.metrics.proposalsCommitted += 1;
      if (proposal?.idempotent === true) this.shared.metrics.idempotentProposals += 1;
      return {
        schema: 't5.reflection-source-window-publication.v1',
        proposal,
        receipt: {
          sourceEpoch: observed.startEpoch,
          stableAfterProposal: true,
          materializationDigest: materialization.materializationDigest ?? null,
          duplicateIdempotent: proposal?.idempotent === true,
          crossProcessQualified: false,
          crossStoreAtomicCasQualified: false,
          coverageManifest: manifest,
          storeHeadReceipt: structuredClone(observed.storeHeadReceipt),
        },
      };
    });
  }

  #validateStoreHeadReceipt(input, epoch, writerRegistrations) {
    exact(input, STORE_HEAD_RECEIPT_FIELDS, 'ReflectionStoreHeadReceipt');
    if (input.schema !== 't5.reflection-store-head-receipt.v1' || input.epoch !== epoch
      || !Array.isArray(input.heads)) {
      throw new TypeError('Reflection store-head receipt is invalid');
    }
    const expectedRegistrations = new Map(writerRegistrations.map((item) => [item.store,
      item.writerRegistrationDigest]));
    const heads = input.heads.map((head) => {
      exact(head, STORE_HEAD_FIELDS, 'ReflectionStoreHead');
      const store = text(head.store, 'ReflectionStoreHead.store');
      const headDigest = digest(head.headDigest, 'ReflectionStoreHead.headDigest');
      const writerRegistrationDigest = digest(head.writerRegistrationDigest,
        'ReflectionStoreHead.writerRegistrationDigest');
      if (writerRegistrationDigest !== expectedRegistrations.get(store)) {
        throw new TypeError('Reflection store head has an unregistered writer');
      }
      return { store, headDigest, writerRegistrationDigest };
    }).toSorted((left, right) => left.store.localeCompare(right.store));
    if (new Set(heads.map((head) => head.store)).size !== heads.length
      || JSON.stringify(heads.map((head) => head.store)) !== JSON.stringify(this.requiredStores)) {
      throw new TypeError('Reflection store-head receipt must cover the exact required store set');
    }
    const receiptDigest = digest(input.receiptDigest, 'ReflectionStoreHeadReceipt.receiptDigest');
    if (receiptDigest !== hash({ schema: input.schema, epoch, heads })) {
      throw new TypeError('Reflection store-head receipt digest does not match exact heads');
    }
    return { schema: input.schema, epoch, heads, receiptDigest };
  }
}
