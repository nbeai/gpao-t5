import { calculateReflectionSourceFence } from './reflection-candidate.js';
import { materializeReflectionReviewProbe } from './reflection-ledger.js';
import { isReflectionSourceWindowCoordinator } from './reflection-source-window-coordinator.js';
import {
  projectReflectionReviewDetail, projectReflectionReviewList, projectReflectionReviewSource,
  reflectionReviewHandle, reflectionReviewRevisionHandle, reflectionReviewSourceHandle,
} from './reflection-review-surface.js';

const DETAIL_FIELDS = new Set(['reviewHandle']);
const SOURCE_FIELDS = new Set(['reviewHandle', 'sourceHandle']);
const LATER_FIELDS = new Set(['reviewHandle', 'revisionHandle']);
const DECISION_FIELDS = new Set(['requestId', 'reviewHandle', 'revisionHandle']);
const clone = (value) => structuredClone(value);
const STABLE_OBSERVERS = new WeakSet();

export function makeReflectionReviewCurrentEvidenceObserver({ sourceWindowCoordinator, observe } = {}) {
  if (!isReflectionSourceWindowCoordinator(sourceWindowCoordinator) || typeof observe !== 'function') {
    throw new TypeError('Reflection review observer requires a source-window coordinator and observer');
  }
  const adapter = Object.freeze({ async withStableWindow(commit) {
    if (typeof commit !== 'function') throw new TypeError('Reflection review stable commit is required');
    return sourceWindowCoordinator.withStableRead({ observe,
      commit: async (observation) => commit(observation) });
  } });
  STABLE_OBSERVERS.add(adapter); return adapter;
}

function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length !== fields.size || keys.some((key) => !fields.has(key))) {
    throw new TypeError(`${label} has missing or unknown fields`);
  }
}
function bounded(value, label, max = 256) {
  if (typeof value !== 'string' || !value || value.trim() !== value || value.length > max
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} is invalid`);
  return value;
}
function failure(code, message) { return Object.assign(new Error(message), { code }); }

function resolveEntry(state, handle) {
  const requested = bounded(handle, 'Reflection review handle');
  const matches = (state.reflectionEntries ?? []).filter((entry) => reflectionReviewHandle(entry) === requested);
  if (matches.length !== 1) throw failure('reflection_review_not_found', '검토할 배운 점을 찾지 못했어요.');
  return matches[0];
}
function requireRevision(entry, value) {
  if (reflectionReviewRevisionHandle(entry) !== bounded(value, 'Reflection review revision')) {
    throw failure('reflection_review_version_changed', '검토 중 내용이 바뀌었어요. 다시 확인해 주세요.');
  }
}
function revisionHandleForDigest(entry, candidateDigest) {
  const historical = clone(entry); historical.candidate.candidateDigest = candidateDigest;
  return reflectionReviewRevisionHandle(historical);
}
async function replayPriorDecision({ ledger, state, entry, input, decision }) {
  const prior = (state.reviewReceipts ?? []).find((receipt) => receipt.requestId === input.requestId);
  if (!prior) return null;
  if (prior.decision !== decision
    || revisionHandleForDigest(entry, prior.beforeCandidateDigest) !== input.revisionHandle) {
    throw failure('reflection_review_request_conflict', '같은 요청 번호가 다른 검토 결정에 사용됐어요.');
  }
  return ledger.review(entry.candidate.candidate.reflectionId, {
    requestId: input.requestId, expectedCandidateDigest: prior.beforeCandidateDigest,
    decision, currentEvidence: null, sourceProbeReceipt: null });
}
function resolveSource(entry, handle) {
  const requested = bounded(handle, 'Reflection source handle');
  const matches = (entry.candidate.recordRefs ?? []).filter((reference) => (
    reflectionReviewSourceHandle(entry, reference) === requested
  ));
  if (matches.length !== 1) throw failure('reflection_source_not_found', '출처를 찾지 못했어요.');
  return matches[0];
}
function safeContent(reference, source) {
  if (reference.sourceKind === 'conversation_message') return source?.message?.content ?? null;
  if (['attachment', 'artifact', 'local_file'].includes(reference.sourceKind)) {
    return source?.originalName ?? source?.name ?? null;
  }
  return source?.userSafeSummary ?? source?.summary ?? source?.title ?? source?.statement ?? null;
}
async function reopen(reader, reference) {
  try {
    const reopened = await reader.reopen(reference, { expectedSessionId: reference.scope?.sessionId ?? null,
      expectedWorkId: reference.scope?.workId ?? null });
    const accounting = reopened?.accounting;
    const isExact = reopened?.state === 'reopened' && reopened.source
      && accounting?.recordId === reference.recordId && accounting?.availability === 'available'
      && accounting?.digestMatched === true && accounting?.observedSha256 === reference.sha256;
    if (isExact) return { state: 'reopened', content: safeContent(reference, reopened.source),
      recordedAt: reopened.source?.recordedAt ?? reference.recordedAt ?? null };
    const state = ['changed', 'missing', 'permission_denied', 'unknown'].includes(reopened?.state)
      ? reopened.state : accounting?.digestMatched === false ? 'changed' : 'unknown';
    return { state, content: null, recordedAt: reference.recordedAt ?? null };
  } catch { return { state: 'unknown', content: null, recordedAt: reference.recordedAt ?? null }; }
}
function verifyCurrentObservation(entry, observed) {
  if (!observed?.currentEvidence || !Array.isArray(observed.currentAffectedScopeHeads)
    || typeof observed.currentAffectedScopeDigest !== 'string') {
    throw failure('current_evidence_unqualified', '현재 교정과 망각 상태를 확인하지 못했어요.');
  }
  if (observed.currentAffectedScopeDigest !== entry.receipt.affectedScopeDigest
    || JSON.stringify(observed.currentAffectedScopeHeads) !== JSON.stringify(entry.receipt.affectedScopeHeads)) {
    throw failure('reflection_source_window_stale', '검토 중 현재 범위가 바뀌었어요. 다시 확인해 주세요.');
  }
  const currentFence = calculateReflectionSourceFence({
    affectedScopeHandles: observed.currentEvidence.affectedScopeHandles,
    episodes: observed.currentEvidence.episodes, recordRefs: observed.currentEvidence.recordRefs,
    correctionHeads: observed.currentEvidence.correctionHeads, forgetHeads: observed.currentEvidence.forgetHeads,
  });
  if (currentFence.windowDigest !== entry.candidate.sourceFence.windowDigest) {
    throw failure('reflection_source_window_stale', '검토 중 근거가 바뀌었어요. 다시 확인해 주세요.');
  }
  return observed.currentEvidence;
}
function decisionProjection(result) {
  const entry = { candidate: result.candidate, materialization: result.materialization,
    materializationDigest: result.materializationDigest, receipt: result.receipt };
  return { schema: 't5.reflection-review-decision.v1', item: projectReflectionReviewDetail(entry),
    decision: result.reviewReceipt.decision === 'retain' ? 'kept_for_review' : 'not_used',
    idempotent: result.idempotent === true, applied: false,
    sideEffects: clone(result.reviewReceipt.sideEffects) };
}

export class ReflectionReviewCoordinator {
  constructor({ ledger, recordSourceReader, currentEvidenceObserver } = {}) {
    if (typeof ledger?.read !== 'function' || typeof ledger?.review !== 'function'
      || typeof recordSourceReader?.reopen !== 'function'
      || typeof currentEvidenceObserver?.withStableWindow !== 'function'
      || !STABLE_OBSERVERS.has(currentEvidenceObserver)) {
      throw new TypeError('Reflection review coordinator dependencies are required');
    }
    this.ledger = ledger; this.recordSourceReader = recordSourceReader;
    this.currentEvidenceObserver = currentEvidenceObserver;
  }
  async list() {
    const state = await this.ledger.read();
    return { ...projectReflectionReviewList(state.reflectionEntries ?? []), sideEffects: { writes: 0 } };
  }
  async detail(input = {}) {
    exact(input, DETAIL_FIELDS, 'Reflection review detail input');
    const entry = resolveEntry(await this.ledger.read(), input.reviewHandle);
    return { item: projectReflectionReviewDetail(entry), sideEffects: { writes: 0 } };
  }
  async source(input = {}) {
    exact(input, SOURCE_FIELDS, 'Reflection review source input');
    const entry = resolveEntry(await this.ledger.read(), input.reviewHandle);
    const reference = resolveSource(entry, input.sourceHandle);
    return { source: projectReflectionReviewSource(entry, { sourceHandle: input.sourceHandle,
      reopened: await reopen(this.recordSourceReader, reference) }), sideEffects: { writes: 0 } };
  }
  async later(input = {}) {
    exact(input, LATER_FIELDS, 'Reflection review later input');
    const entry = resolveEntry(await this.ledger.read(), input.reviewHandle); requireRevision(entry, input.revisionHandle);
    return { schema: 't5.reflection-review-decision.v1', decision: 'unchanged',
      item: projectReflectionReviewDetail(entry), applied: false, sideEffects: { writes: 0 } };
  }
  async reject(input = {}) {
    exact(input, DECISION_FIELDS, 'Reflection review reject input');
    const state = await this.ledger.read(); const entry = resolveEntry(state, input.reviewHandle);
    const replay = await replayPriorDecision({ ledger: this.ledger, state, entry, input, decision: 'reject' });
    if (replay) return decisionProjection(replay);
    requireRevision(entry, input.revisionHandle);
    const result = await this.ledger.review(entry.candidate.candidate.reflectionId, {
      requestId: input.requestId, expectedCandidateDigest: entry.candidate.candidateDigest,
      decision: 'reject', currentEvidence: null, sourceProbeReceipt: null });
    return decisionProjection(result);
  }
  async retain(input = {}) {
    exact(input, DECISION_FIELDS, 'Reflection review retain input');
    const state = await this.ledger.read(); const entry = resolveEntry(state, input.reviewHandle);
    const replay = await replayPriorDecision({ ledger: this.ledger, state, entry, input, decision: 'retain' });
    if (replay) return decisionProjection(replay);
    requireRevision(entry, input.revisionHandle);
    return this.currentEvidenceObserver.withStableWindow(async (observed) => {
      const currentEvidence = verifyCurrentObservation(entry, observed);
      const probe = await materializeReflectionReviewProbe({ recordSourceReader: this.recordSourceReader,
        recordRefs: entry.candidate.recordRefs, sourceFenceDigest: entry.candidate.sourceFence.windowDigest,
        affectedScopeDigest: observed.currentAffectedScopeDigest });
      const result = await this.ledger.review(entry.candidate.candidate.reflectionId, {
        requestId: input.requestId, expectedCandidateDigest: entry.candidate.candidateDigest,
        decision: 'retain', currentEvidence, sourceProbeReceipt: probe });
      return decisionProjection(result);
    });
  }
}
