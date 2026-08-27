import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RuntimeContinuityLedger, makeRuntimeContinuityMonitor } from '../src/runtime-continuity.js';

test('재부팅·crash 뒤 시작은 clean stop으로 꾸미지 않고 중단과 미실행 시간을 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-continuity-'));
  try {
    const ledger = new RuntimeContinuityLedger(room);
    assert.equal((await ledger.start({ generationId: 'generation-a', at: 1000 })).previousDisposition, 'first_start');
    const restarted = await ledger.start({ generationId: 'generation-b', at: 6000 });
    assert.equal(restarted.previousDisposition, 'interrupted'); assert.equal(restarted.downtimeMs, 5000);
    assert.equal(restarted.executionClaimedDuringDowntime, false);
    await ledger.stop({ generationId: 'generation-b', reason: 'user_full_stop', at: 7000 });
    assert.equal((await ledger.start({ generationId: 'generation-c', at: 9000 })).previousDisposition, 'clean_stop');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('sleep 같은 wall gap은 실행 성공이 아니라 gap receipt와 canonical reconcile만 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-runtime-gap-')); let reconciled = 0; let clock = 1000;
  try {
    const ledger = new RuntimeContinuityLedger(room);
    const monitor = makeRuntimeContinuityMonitor({ ledger, generationId: 'generation-a', gapThresholdMs: 100,
      tickMs: 5, now: () => clock, onGap: async () => { reconciled += 1; } });
    clock = 1200; await new Promise((resolve) => setTimeout(resolve, 15)); await monitor.stop();
    const events = (await ledger.read()).events;
    assert.equal(events.length, 1); assert.equal(events[0].executionClaimedDuringGap, false);
    assert.equal(events[0].gapMs, 200); assert.equal(reconciled, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
