import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AutomationStore } from '../src/automation-store.js';
import { AutomationScheduler } from '../src/automation-scheduler.js';

test('같은 시각의 두 작업은 서로 기다리지 않고 독립 Run으로 실행된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-scheduler-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    for (const name of ['A', 'B']) await store.create({ name, prompt: name, sessionId: `session-${name}`,
      scheduleKind: 'at', schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul' });
    let active = 0; let peak = 0;
    const scheduler = new AutomationScheduler({ store, now: () => now, maxSleepMs: 1_000,
      execute: async ({ job }) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 25)); active -= 1; return { runId: `run-${job.name}` }; } });
    await scheduler.start(); now += 2_000; await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 60)); await scheduler.stop();
    const state = await store.list();
    assert.equal(peak, 2);
    assert.deepEqual(state.runs.map((run) => run.status), ['succeeded', 'succeeded']);
    assert.deepEqual(state.jobs.map((job) => job.state), ['expired', 'expired']);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('반복 작업은 멈춤·재개 뒤 다음 시각을 다시 계산하고 기록을 보존한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-pause-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '매시간', prompt: '확인', sessionId: 's', scheduleKind: 'every', schedule: '1h', timezone: 'Asia/Seoul' });
    await store.pause(job.id); assert.equal((await store.inspect(job.id)).state, 'paused');
    now += 100_000; const resumed = await store.resume(job.id);
    assert.equal(resumed.nextRunAt, now + 3_600_000);
    await store.cancel(job.id); assert.equal((await store.inspect(job.id)).state, 'cancelled');
  } finally { await rm(room, { recursive: true, force: true }); }
});
