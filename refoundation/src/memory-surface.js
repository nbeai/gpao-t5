import { randomUUID } from 'node:crypto';

import { makeRecordReference } from './record-reference.js';

function visibleValue(claim) {
  return claim.sensitivity === 'never_store' ? '저장하지 않은 민감 정보' : claim.value;
}

function sourceHandle(reference) {
  return {
    recordId: reference.recordId,
    kind: reference.sourceKind,
    recordedAt: reference.recordedAt,
    availability: reference.availability,
  };
}

function publicClaim(claim, forgotten = false) {
  return {
    memoryId: claim.memoryId,
    kind: claim.kind,
    value: forgotten ? '내용을 지운 기억' : visibleValue(claim),
    status: claim.status,
    validFrom: claim.validFrom,
    validTo: claim.validTo,
    recordedAt: claim.recordedAt,
    sensitivity: forgotten ? null : claim.sensitivity,
    sources: forgotten ? [] : claim.sources.map(sourceHandle),
  };
}

export function projectMemorySurface(state, { asOf = new Date().toISOString() } = {}) {
  const temporalIds = new Set(state.claims.map((claim) => claim.memoryId));
  const forgottenIds = new Set(state.tombstones.map((item) => item.memoryId));
  return {
    schema: 't5.memory-surface.v1',
    current: state.claims.filter((claim) => claim.status === 'active').map((claim) => publicClaim(claim)),
    history: state.claims.filter((claim) => claim.status !== 'active')
      .map((claim) => publicClaim(claim, forgottenIds.has(claim.memoryId))),
    forgotten: state.tombstones.filter((tombstone) => (
      tombstone.reversibleUntil != null && tombstone.reversibleUntil > asOf
    )).map((tombstone) => ({
      memoryId: tombstone.memoryId,
      requestId: tombstone.requestId,
      reversibleUntil: tombstone.reversibleUntil,
    })),
    legacy: state.items.filter((item) => !temporalIds.has(item.memoryId)).map((item) => ({
      memoryId: item.memoryId, kind: item.kind, value: item.content,
      recordedAt: item.updatedAt ?? item.createdAt,
    })),
    // Temporary compatibility for the pre-temporal checkpoint reader. Keep it derived and bounded;
    // never expose temporal contracts or raw RecordRefs through the user settings endpoint.
    items: state.items.map((item) => ({
      memoryId: item.memoryId, kind: item.kind, content: item.content,
      source: temporalIds.has(item.memoryId) ? null : item.source,
      createdAt: item.createdAt, updatedAt: item.updatedAt,
    })),
    counts: {
      current: state.claims.filter((claim) => claim.status === 'active').length,
      history: state.claims.filter((claim) => claim.status !== 'active').length,
      forgotten: state.tombstones.length,
    },
  };
}

export function makeSettingsMemoryRecordReference({
  action, memoryId, now = new Date().toISOString(), makeId = randomUUID,
} = {}) {
  const sourceId = `memory-settings:${makeId()}`;
  return makeRecordReference({
    sourceKind: 'user_note', sourceStore: 'memory-settings', sourceId, sourceRevision: 1,
    // The click is not copied into another canonical store. Preserve its identity but do not
    // claim that a source body or digest can be reopened.
    sha256: null,
    occurredAt: now, recordedAt: now,
    scope: { sessionId: null, workId: null, subjectKeys: [], channel: 'settings' },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'metadata_only',
    availability: 'unknown',
  });
}

function bounded(value, max = 8_000) {
  return String(value ?? '').slice(0, max);
}

export function projectReopenedSource(reference, reopened) {
  const common = {
    state: reopened.state,
    kind: reference.sourceKind,
    recordedAt: reference.recordedAt,
    availability: reopened.accounting?.availability ?? reference.availability,
    digestMatched: reopened.accounting?.digestMatched ?? null,
  };
  if (reopened.state !== 'reopened') return { ...common, content: null };
  const source = reopened.source ?? {};
  if (reference.sourceKind === 'conversation_message') {
    return { ...common, label: '대화', content: bounded(source.message?.content),
      recordedAt: source.recordedAt ?? reference.recordedAt };
  }
  if (['attachment', 'artifact'].includes(reference.sourceKind)) {
    return { ...common, label: '파일', content: bounded(source.originalName ?? '파일 기록') };
  }
  const safeSummary = source.userSafeSummary ?? source.summary ?? source.payload?.userSafeSummary;
  return { ...common, label: '작업 기록', content: safeSummary ? bounded(safeSummary) : null };
}
