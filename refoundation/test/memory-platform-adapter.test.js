import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveNativeSearchProjection, reconcileNativeSearch,
} from '../src/memory-platform-adapter.js';
import { makeMacOSMemoryPlatformAdapter } from '../src/macos-memory-platform-adapter.js';

function claim(memoryId, sensitivity, value = memoryId, status = 'active', revision = 1) {
  return { memoryId, kind: 'preference', subjectKey: `subject.${memoryId}`, value, status,
    subjectRevision: revision, recordedAt: '2026-08-27T01:00:00.000Z', sensitivity, sources: [] };
}

function searchDriver() {
  const items = new Map(); const calls = [];
  return { items, calls,
    async available() { return true; },
    async list() { calls.push(['list']); return [...items.values()]; },
    async index(next) { calls.push(['index', next.map((item) => item.identifier)]);
      for (const item of next) items.set(item.identifier, structuredClone(item)); },
    async delete(identifiers) { calls.push(['delete', identifiers]);
      for (const id of identifiers) items.delete(id); },
  };
}

test('native search는 normal만 기본 허용하고 personal 이상을 값 없이 차단한다', () => {
  const state = { claims: [claim('normal', 'normal'), claim('personal', 'personal'),
    claim('private', 'private'), claim('secret', 'secret_ref'), claim('never', 'never_store')] };
  const result = deriveNativeSearchProjection({ state });
  assert.deepEqual(result.items.map((item) => item.memoryId), ['normal']);
  assert.deepEqual(result.blocked.map((item) => [item.memoryId, item.reason]), [
    ['personal', 'personal_opt_in_required'], ['private', 'sensitivity_blocked'],
    ['secret', 'sensitivity_blocked'], ['never', 'sensitivity_blocked'],
  ]);
  assert.equal(result.blocked.some((item) => 'value' in item), false);
  assert.equal(JSON.stringify(result.items).includes('rr_'), false);
});

test('personal opt-in은 exact memory identity만 열고 private로 하향되지 않는다', () => {
  const state = { claims: [claim('allowed', 'personal'), claim('other', 'personal'),
    claim('private', 'private')] };
  const result = deriveNativeSearchProjection({ state, personalOptInMemoryIds: ['allowed', 'private'] });
  assert.deepEqual(result.items.map((item) => item.memoryId), ['allowed']);
  assert.deepEqual(result.blocked.map((item) => item.memoryId), ['other', 'private']);
});

test('search reconcile은 add·update·retract를 exact list readback 뒤에만 통과시킨다', async () => {
  const driver = searchDriver(); const adapter = makeMacOSMemoryPlatformAdapter({ search: driver });
  const first = await reconcileNativeSearch({ state: { claims: [claim('coffee', 'normal', '산미', 'active', 1)] },
    adapter });
  assert.equal(first.state, 'verified');
  assert.equal(driver.items.get('t5.memory.coffee').content, '산미');
  const updated = await reconcileNativeSearch({ state: { claims: [claim('coffee', 'normal', '고소함', 'active', 2)] },
    adapter });
  assert.equal(updated.state, 'verified');
  assert.equal(driver.items.get('t5.memory.coffee').content, '고소함');
  const removed = await reconcileNativeSearch({ state: { claims: [claim('coffee', 'normal', '고소함', 'retracted', 2)] },
    adapter });
  assert.equal(removed.state, 'verified');
  assert.equal(driver.items.size, 0);
  assert.ok(driver.calls.some(([kind, ids]) => kind === 'delete' && ids.includes('t5.memory.coffee')));
});

test('search delete readback이 남으면 성공으로 꾸미지 않는다', async () => {
  const driver = searchDriver(); driver.items.set('t5.memory.private', {
    identifier: 't5.memory.private', domain: 't5.life-continuity.memory', memoryId: 'private',
    revision: 1, title: '기억', content: '노출되면 안 됨', contentDigest: 'old',
  });
  driver.delete = async () => {};
  const result = await reconcileNativeSearch({ state: { claims: [claim('private', 'private')] },
    adapter: makeMacOSMemoryPlatformAdapter({ search: driver }) });
  assert.equal(result.state, 'verification_failed');
  assert.deepEqual(result.remainingIdentifiers, ['t5.memory.private']);
});

test('EventKit은 권한·사용자 시작·exact identity·read-after-write 없이는 실행하지 않는다', async () => {
  const calls = []; const eventKit = {
    async authorization() { return 'not_determined'; },
    async save() { calls.push('save'); return { itemId: 'event-1' }; },
    async read() { calls.push('read'); return null; },
  };
  const adapter = makeMacOSMemoryPlatformAdapter({ search: searchDriver(), eventKit });
  assert.equal((await adapter.upsertCalendarItem({ userInitiated: false })).state, 'user_action_required');
  const permission = await adapter.upsertCalendarItem({ userInitiated: true, operationId: 'op-1',
    kind: 'event', title: '검토', calendarId: 'calendar-1', startsAt: '2026-08-28T01:00:00.000Z',
    endsAt: '2026-08-28T02:00:00.000Z', dueAt: null });
  assert.equal(permission.state, 'permission_required');
  assert.deepEqual(calls, []);
});

test('EventKit full access는 save identity를 같은 store에서 다시 읽어 exact match해야 verified다', async () => {
  const stored = new Map();
  const eventKit = {
    async authorization() { return 'full_access'; },
    async save(item) { const saved = { ...item, itemId: 'event-1' }; stored.set('event-1', saved);
      return { itemId: 'event-1' }; },
    async read({ itemId }) { return stored.get(itemId) ?? null; },
    async remove({ itemId }) { stored.delete(itemId); },
  };
  const adapter = makeMacOSMemoryPlatformAdapter({ search: searchDriver(), eventKit });
  const input = { userInitiated: true, operationId: 'op-verified', kind: 'event', title: '검토',
    calendarId: 'calendar-1', startsAt: '2026-08-28T01:00:00.000Z',
    endsAt: '2026-08-28T02:00:00.000Z', dueAt: null };
  const saved = await adapter.upsertCalendarItem(input);
  assert.equal(saved.state, 'verified'); assert.equal(saved.itemId, 'event-1');
  const removed = await adapter.removeCalendarItem({ userInitiated: true, operationId: 'op-remove',
    kind: 'event', itemId: saved.itemId });
  assert.equal(removed.state, 'verified_absent');
});

test('EventKit readback mismatch와 non-macOS는 성공으로 승격하지 않는다', async () => {
  const eventKit = { async authorization() { return 'full_access'; },
    async save() { return { itemId: 'event-2' }; },
    async read() { return { itemId: 'event-2', kind: 'event', title: '다른 내용',
      calendarId: 'calendar-1', startsAt: '2026-08-28T01:00:00.000Z',
      endsAt: '2026-08-28T02:00:00.000Z', dueAt: null }; } };
  const input = { userInitiated: true, operationId: 'op-mismatch', kind: 'event', title: '검토',
    calendarId: 'calendar-1', startsAt: '2026-08-28T01:00:00.000Z',
    endsAt: '2026-08-28T02:00:00.000Z', dueAt: null };
  const mismatch = await makeMacOSMemoryPlatformAdapter({ search: searchDriver(), eventKit })
    .upsertCalendarItem(input);
  assert.equal(mismatch.state, 'verification_failed');
  const nonTarget = makeMacOSMemoryPlatformAdapter({ platform: 'win32', search: searchDriver(), eventKit });
  assert.equal((await nonTarget.upsertCalendarItem(input)).state, 'platform_unavailable');
});
