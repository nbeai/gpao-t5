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
      execute: async ({ job }) => { active += 1; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 25)); active -= 1; return {
        runId: `run-${job.name}`, objectiveStatus: 'achieved', deliveryStatus: 'succeeded',
      }; } });
    await scheduler.start(); now += 2_000; await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 60)); await scheduler.stop();
    const state = await store.list();
    assert.equal(peak, 2);
    assert.deepEqual(state.runs.map((run) => run.status), ['succeeded', 'succeeded']);
    assert.deepEqual(state.jobs.map((job) => job.state), ['expired', 'expired']);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('모델 Run이 끝나도 목적 달성 영수증이 없으면 자동화는 failed다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-objective-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    const job = await store.create({ name: '게시', prompt: '게시해', sessionId: 's', scheduleKind: 'at',
      schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul' });
    const scheduler = new AutomationScheduler({ store, now: () => now, maxSleepMs: 1_000,
      execute: async () => ({ runId: 'model-run', objectiveStatus: 'not_achieved', error: 'publish_missing' }) });
    await scheduler.start(); now += 2_000; await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 20)); await scheduler.stop();
    const state = await store.list();
    assert.equal(state.runs[0].status, 'failed');
    assert.equal(state.jobs[0].state, 'needs_review');
    assert.equal(state.jobs[0].lastError, 'publish_missing');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('목적이 달성돼도 계약된 Telegram 전달이 실패하면 자동화는 succeeded가 아니다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-automation-delivery-')); let now = Date.parse('2026-08-21T00:00:00Z');
  try {
    const store = new AutomationStore(join(room, 'automation.json'), { now: () => now });
    await store.create({ name: '뉴스', prompt: '뉴스를 조사해', sessionId: 'console', scheduleKind: 'at',
      schedule: new Date(now + 1_000).toISOString(), timezone: 'Asia/Seoul',
      requirements: { requiredTools: ['web_research'], requiredEffect: null, requireResultUrl: false },
      delivery: { kind: 'telegram', sessionId: 'telegram-owner' } });
    const scheduler = new AutomationScheduler({ store, now: () => now, maxSleepMs: 1_000,
      execute: async () => ({ runId: 'news-run', objectiveStatus: 'achieved', deliveryStatus: 'failed' }) });
    await scheduler.start(); now += 2_000; await scheduler.tick();
    await new Promise((resolve) => setTimeout(resolve, 20)); await scheduler.stop();
    const state = await store.list();
    assert.equal(state.runs[0].status, 'failed');
    assert.equal(state.runs[0].deliveryStatus, 'failed');
    assert.equal(state.jobs[0].state, 'needs_review');
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
