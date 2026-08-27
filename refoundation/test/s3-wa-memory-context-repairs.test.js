import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';
import { ForgettingCoordinator } from '../src/forgetting-coordinator.js';
import { MemoryLedger } from '../src/memory-ledger.js';
import {
  forgetTombstoneProjection, memoryCandidateProjection, selectMemoryPortfolio,
} from '../src/memory-portfolio.js';
import { projectMemorySurface } from '../src/memory-surface.js';
import { makePurposeBoundedHistoryAdapter } from '../src/purpose-bounded-history.js';
import { makeRecordReference } from '../src/record-reference.js';
import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';
import { makeScopedFileActivityService } from '../src/scoped-file-activity-service.js';
import { projectWorkHistoryEntry } from '../src/work-history-projection.js';

const at = (second) => `2026-08-27T00:00:${String(second).padStart(2, '0')}.000Z`;

function sourceReference(recordedAt = '2025-01-01T00:00:00.000Z') {
  return makeRecordReference({
    sourceKind: 'user_note', sourceStore: 'fixture', sourceId: `note-${recordedAt}`,
    sourceRevision: 1, sha256: null, occurredAt: recordedAt, recordedAt,
    scope: { sessionId: null, workId: null, subjectKeys: [], channel: 'settings' },
    trust: 'user_asserted', sensitivity: 'personal', coverage: 'metadata_only', availability: 'available',
  });
}

test('legacy private-channel memory is neither auto-injected nor advertised in a foreign channel', () => {
  const item = { memoryId: 'private', kind: 'user', content: 'PRIVATE_CANARY',
    subjects: ['private-subject'], alwaysRelevant: true,
    source: { channel: 'telegram-private', senderId: 'owner' } };
  assert.deepEqual(selectMemoryPortfolio({ items: [item], currentChannel: 'console', enforceChannelScope: true }), []);
  assert.equal(memoryCandidateProjection([{ ...item, alwaysRelevant: false }], {
    currentChannel: 'console', enforceChannelScope: true,
  }), null);
  const unscopedLegacy = { ...item, memoryId: 'legacy-global', source: { origin: 'pre_checkpoint' } };
  assert.deepEqual(selectMemoryPortfolio({ items: [unscopedLegacy], currentChannel: 'console',
    enforceChannelScope: true }), []);
  const pointer = memoryCandidateProjection([unscopedLegacy], {
    currentChannel: 'console', enforceChannelScope: true,
  });
  assert.match(pointer.content, /legacy-global/u); assert.doesNotMatch(pointer.content, /PRIVATE_CANARY/u);
});

test('expired forget tombstone cannot restore and produces no model or UI recovery pointer', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-wa-forget-expiry-'));
  const ledger = new MemoryLedger(room); await ledger.ensure(); const source = sourceReference();
  await ledger.commitClaim({ claim: {
    memoryId: 'memory-1', kind: 'preference', subjectKey: 'subject-1', value: '기억',
    scope: { global: true, workId: null, projectId: null, personId: 'owner', organizationId: null },
    sources: [source], recordedAt: '2025-01-01T00:00:00.000Z', validFrom: null, validTo: null,
    subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
    sensitivity: 'personal', alwaysRelevant: false,
  } });
  const forgetter = new ForgettingCoordinator({ memoryLedger: ledger, makeId: () => 'forget-1',
    now: () => '2025-01-01T00:00:00.000Z' });
  const plan = await forgetter.preview({ memoryIds: ['memory-1'], subjectKeys: [], scopeIds: [] });
  await forgetter.execute({ plan, recordRefs: [source] });
  const expired = new ForgettingCoordinator({ memoryLedger: ledger,
    now: () => '2026-08-27T00:00:00.000Z' });
  await assert.rejects(() => expired.restore({ requestId: 'forget-1', memoryId: 'memory-1', recordRefs: [source] }),
    (error) => error.code === 'T5_FORGET_EXPIRED');
  const state = await ledger.read();
  assert.equal(forgetTombstoneProjection(state.tombstones, { asOf: '2026-08-27T00:00:00.000Z' }), null);
  assert.deepEqual(projectMemorySurface(state, { asOf: '2026-08-27T00:00:00.000Z' }).forgotten, []);
});

test('collector resume failure preserves desired recording intent and reports degraded truth', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-wa-collector-degraded-')); const root = join(room, 'scope'); await mkdir(root);
  const files = new ScopedFileActivityLedger(join(room, 'files'));
  await files.configure({ roots: [root], platform: 'darwin', recordedAt: at(0) });
  await files.setEnabled({ enabled: true, recordedAt: at(1) });
  const fileService = makeScopedFileActivityService({ ledger: files,
    adapterFactory: async () => { throw new Error('transient helper failure'); } });
  await assert.rejects(() => fileService.resumeConfigured(), /transient helper failure/u);
  const fileState = await fileService.status();
  assert.equal(fileState.desiredEnabled, true); assert.equal(fileState.enabled, false); assert.equal(fileState.degraded, true);
  assert.match(fileState.userSafeSummary, /다시 시작하지 못했/u);

  const apps = new CoarseAppActivityLedger(join(room, 'apps'));
  await apps.configure({ platform: 'darwin', recordedAt: at(0) });
  await apps.setEnabled({ enabled: true, recordedAt: at(1) });
  const appService = makeCoarseAppActivityService({ ledger: apps,
    adapterFactory: async () => { throw new Error('transient helper failure'); } });
  await assert.rejects(() => appService.resumeConfigured(), /transient helper failure/u);
  const appState = await appService.status();
  assert.equal(appState.desiredEnabled, true); assert.equal(appState.enabled, false); assert.equal(appState.degraded, true);
  assert.match(appState.userSafeSummary, /다시 시작하지 못했/u);
});

test('excluding one app physically removes only that app history', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-wa-app-exclude-'));
  const ledger = new CoarseAppActivityLedger(room);
  await ledger.configure({ platform: 'darwin', recordedAt: at(0) });
  await ledger.setEnabled({ enabled: true, recordedAt: at(1) });
  const segment = (id, appId, appLabel, start) => ({ segmentId: id, appId, appLabel,
    startedAt: at(start), endedAt: at(start + 1), durationMs: 1_000, afk: 'active', workBinding: null });
  await ledger.ingest({ source: 'fixture', policyGeneration: 2, recordedAt: at(6),
    segments: [segment('a', 'com.a', '앱A', 2), segment('b', 'com.b', '앱B', 3)] });
  const before = await ledger.query(); const appA = before.find((item) => item.appLabel === '앱A');
  const result = await ledger.excludeObservedApp({ appHandle: appA.appHandle, recordedAt: at(7) });
  assert.equal(result.remainingSegments, 1);
  assert.deepEqual((await ledger.query()).map((item) => item.appLabel), ['앱B']);
});

test('purpose history reads the actual WorkHistory projection shape and preserves Korean local date', async () => {
  const work = projectWorkHistoryEntry({ historyHandle: 'a'.repeat(32), title: '어제 견적 정리',
    recordedAt: '2026-08-26T16:00:00.000Z', timeZone: 'Asia/Seoul', status: 'completed', actorText: '내 요청',
    artifacts: {}, effects: {}, resources: {}, remaining: { count: 2, needsUserReview: true, text: '확인 2개' },
    internalValues: [] });
  assert.equal(work.whenText, '2026. 8. 27.');
  const adapter = makePurposeBoundedHistoryAdapter({
    workHistory: { list: async () => ({ items: [work] }), detail: async () => work },
    fileActivityService: { history: async () => ({ items: [] }) },
    appActivityService: { history: async () => ({ items: [] }) },
  });
  const candidate = (await adapter.search({ query: '견적', limit: 8 })).candidates[0];
  assert.equal(candidate.time, '2026. 8. 27.');
  assert.deepEqual(candidate.facts, { status: '완료', remaining: 2 });
});
