import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AutomationStore, nextAutomationRun, normalizeAutomationSchedule,
} from '../src/automation-store.js';

test('cron·간격·일회 예약은 시간대와 다음 실행을 검증된 parser로 계산한다', () => {
  const now = Date.parse('2026-08-21T00:00:00Z');
  const cron = normalizeAutomationSchedule({ kind: 'cron', value: '0 9 * * *', timezone: 'Asia/Seoul' }, now);
  assert.equal(new Date(cron.nextRunAt).toISOString(), '2026-08-22T00:00:00.000Z');
  assert.equal(nextAutomationRun(cron, now), cron.nextRunAt);
  assert.equal(normalizeAutomationSchedule({ kind: 'every', value: '15m', timezone: 'Asia/Seoul' }, now).nextRunAt, now + 900_000);
  assert.throws(() => normalizeAutomationSchedule({ kind: 'cron', value: 'bad', timezone: 'Asia/Seoul' }, now), /five fields/u);
});

test('원장은 실행 전 claim을 먼저 기록하고 crash 뒤 일회 작업을 자동 반복하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-store-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '한 번', prompt: '보고서 확인', sessionId: 's1', scheduleKind: 'at',
      schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul' });
    now += 2_000;
    const [claim] = await store.claimDue();
    assert.equal(claim.job.id, job.id); assert.equal(claim.run.status, 'claimed');
    assert.deepEqual(await store.claimDue(), []);
    const recovered = await store.recoverInterrupted();
    assert.deepEqual(recovered, [job.id]);
    const state = await store.list();
    assert.equal(state.jobs[0].state, 'needs_review');
    assert.equal(state.runs[0].status, 'unknown');
  } finally { await rm(room, { recursive: true, force: true }); }
});
