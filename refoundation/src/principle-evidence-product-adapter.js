import { createHash } from 'node:crypto';

import { makePrincipleEvidenceRuntime } from './principle-evidence-materializer.js';
import { ReflectionLedger } from './reflection-ledger.js';
import { isReflectionSourceWindowCoordinator } from './reflection-source-window-coordinator.js';

const ADAPTER_FIELDS = new Set(['reflectionLedger', 'sourceWindowCoordinator', 'recordSourceReader',
  'workStore', 'runLedger', 'contextReceiptStore', 'correctionObserver', 'blindEvaluator',
  'taskOracle', 'searchStore', 'effectObserver', 'rng', 'observeMethod']);
const FIXTURE_FIELDS = new Set(['pairReceipts', 'currentCorrection', 'nearMissSearch',
  'counterexampleSearch', 'sideEffects', 'fieldHead', 'fieldEvaluator', 'seed']);
const BRANDS = Object.fromEntries(['reader', 'work', 'run', 'context', 'correction', 'evaluator',
  'oracle', 'search', 'effects', 'rng'].map((name) => [name, new WeakSet()]));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const hash = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const clone = (value) => structuredClone(value);

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.size
    || Object.keys(value).some((key) => !fields.has(key))) throw new TypeError(`${label} is invalid`);
}
function brand(name, value) { BRANDS[name].add(value); return Object.freeze(value); }
function required(name, value) {
  if (!value || !BRANDS[name].has(value)) throw new TypeError(`Principle ${name} dependency is not branded`);
  return value;
}
function accountingDigest(refs) { return hash(refs.map((value) => ({ recordId: value.recordId,
  observedSha256: value.sha256 })).toSorted((a, b) => a.recordId.localeCompare(b.recordId))); }

export function makePrincipleRecordSourceReaderAdapter(reader) {
  if (typeof reader?.reopen !== 'function') throw new TypeError('Principle RecordSourceReader is required');
  return brand('reader', { reopen: (...args) => reader.reopen(...args) });
}

export function makePrincipleQualificationFixtureDependencies(input = {}) {
  exact(input, FIXTURE_FIELDS, 'Principle qualification fixture dependencies');
  if (!Array.isArray(input.pairReceipts) || input.pairReceipts.length < 2
    || !Number.isSafeInteger(input.seed)) throw new TypeError('Principle fixture canonical data is incomplete');
  const pairs = clone(input.pairReceipts); const fieldHead = clone(input.fieldHead);
  const fieldEvaluator = clone(input.fieldEvaluator); let rngCalls = 0;
  return Object.freeze({
    workStore: brand('work', { async loadPair(_pair, index) { const receipt = pairs[index];
      return { baselineHead: clone(receipt.baselineHead), candidateHead: clone(receipt.candidateHead) }; },
    async loadField() { return clone(fieldHead); } }),
    runLedger: brand('run', { async verifyHeads(heads) { return clone(heads); } }),
    contextReceiptStore: brand('context', { async verifyHeads(heads) { return clone(heads); } }),
    correctionObserver: brand('correction', { async observe() { return clone(input.currentCorrection); } }),
    blindEvaluator: brand('evaluator', { async evaluatePair(_pair, _canonical, index, mapping) {
      const receipt = pairs[index];
      if (mapping.mappingDigest !== receipt.armMapping.mappingDigest) throw new Error('opaque arm map mismatch');
      return { evaluatorRequest: clone(receipt.evaluatorRequest), evaluatorOutput: clone(receipt.evaluatorOutput) };
    }, async evaluateField() { return clone(fieldEvaluator); } }),
    taskOracle: brand('oracle', { async evaluatePair(_pair, _evaluation, index) {
      return clone(pairs[index].taskOracleReceipt); }, async verifyField() { return true; } }),
    searchStore: brand('search', { async nearMiss() { return clone(input.nearMissSearch); },
      async counterexamples() { return clone(input.counterexampleSearch); } }),
    effectObserver: brand('effects', { async observe() { return clone(input.sideEffects); } }),
    rng: brand('rng', { async map(_pair, index) { rngCalls += 1;
      const expected = (input.seed + index) % 2 === 0
        ? { baselineLabel: 'A', candidateLabel: 'B' } : { baselineLabel: 'B', candidateLabel: 'A' };
      const receipt = pairs[index].armMapping;
      if (receipt.baselineLabel !== expected.baselineLabel || receipt.candidateLabel !== expected.candidateLabel) {
        throw new Error('seeded opaque arm mapping is not deterministic');
      }
      return clone(receipt); }, calls: () => rngCalls }),
  });
}

export function makePrincipleEvidenceProductAdapter(input = {}) {
  try { exact(input, ADAPTER_FIELDS, 'Principle product evidence adapter'); }
  catch { throw new TypeError('Principle product evidence adapter requires exact canonical dependencies'); }
  const { reflectionLedger, sourceWindowCoordinator, observeMethod } = input;
  if (!(reflectionLedger instanceof ReflectionLedger)
    || !isReflectionSourceWindowCoordinator(sourceWindowCoordinator)
    || (observeMethod !== null && typeof observeMethod !== 'function')) {
    throw new TypeError('Principle product evidence adapter requires exact canonical dependencies');
  }
  const reader = required('reader', input.recordSourceReader); const work = required('work', input.workStore);
  const run = required('run', input.runLedger); const context = required('context', input.contextReceiptStore);
  const correction = required('correction', input.correctionObserver);
  const evaluator = required('evaluator', input.blindEvaluator); const oracle = required('oracle', input.taskOracle);
  const searches = required('search', input.searchStore); const effects = required('effects', input.effectObserver);
  const rng = required('rng', input.rng); const observed = (name) => observeMethod?.(name);
  return makePrincipleEvidenceRuntime({
    async withStableWindow(callback) { observed('withStableWindow');
      return sourceWindowCoordinator.withStableRead({ observe: async () => ({ stable: true }),
        commit: async () => callback() }); },
    async loadReviewedReflections(candidate) { observed('loadReviewedReflections');
      const state = await reflectionLedger.read();
      return candidate.sourceReflectionIds.map((reflectionId) => {
        const entry = state.reflectionEntries.find((item) => item.candidate.candidate.reflectionId === reflectionId);
        const receipt = state.reviewReceipts.find((item) => item.materializationDigest === entry?.materializationDigest
          && item.afterCandidateDigest === entry?.candidate.candidateDigest && item.decision === 'retain');
        if (!entry || entry.candidate.candidate.state !== 'reviewed' || !receipt) {
          throw new Error('retained Reflection source is unavailable');
        }
        return { reflectionId, revisionDigest: entry.candidate.candidateDigest,
          materializationDigest: entry.materializationDigest, reviewReceiptDigest: receipt.receiptDigest,
          state: 'reviewed', decision: 'retain', scopeHandles: [...entry.candidate.candidate.affectedScopes],
          counterexampleIds: [...entry.candidate.candidate.counterexampleRecordIds] };
      }); },
    async loadCanonicalPair(pair, index) { observed('loadCanonicalPair');
      const heads = await work.loadPair(pair, index); await run.verifyHeads(heads); await context.verifyHeads(heads);
      return { ...heads, recordSourceReader: reader }; },
    async evaluateBlindPair(pair, canonicalPair, index) { observed('evaluateBlindPair');
      const armMapping = await rng.map(pair, index); const evaluation = await evaluator.evaluatePair(
        pair, canonicalPair, index, armMapping); const taskOracleReceipt = await oracle.evaluatePair(
        pair, evaluation, index); const core = { pairId: pair.pairId, armMapping,
        baselineHead: { ...canonicalPair.baselineHead, recordRefs: undefined,
          accountingDigest: accountingDigest(canonicalPair.baselineHead.recordRefs) },
        candidateHead: { ...canonicalPair.candidateHead, recordRefs: undefined,
          accountingDigest: accountingDigest(canonicalPair.candidateHead.recordRefs) },
        ...evaluation, taskOracleReceipt };
      return { pairId: pair.pairId, armMapping, baselineHead: canonicalPair.baselineHead,
        candidateHead: canonicalPair.candidateHead, ...evaluation, taskOracleReceipt,
        receiptDigest: hash(core) }; },
    async observeCurrentCorrection(candidate) { observed('observeCurrentCorrection');
      return { proof: await correction.observe(candidate), recordSourceReader: reader }; },
    async searchNearMiss(value) { observed('searchNearMiss'); return searches.nearMiss(value); },
    async searchCounterexamples(value) { observed('searchCounterexamples'); return searches.counterexamples(value); },
    async observeSideEffects() { observed('observeSideEffects'); return effects.observe(); },
    async loadCanonicalField(field) { observed('loadCanonicalField'); const fieldHead = await work.loadField(field);
      await run.verifyHeads(fieldHead); await context.verifyHeads(fieldHead);
      return { fieldHead, recordSourceReader: reader }; },
    async evaluateField(field, replay) { observed('evaluateField');
      if (!await oracle.verifyField(field, replay)) throw new Error('field task oracle failed');
      return evaluator.evaluateField(field, replay); },
  });
}
