import test from 'node:test';
import assert from 'node:assert/strict';

import { LearningReviewScheduler } from '../src/learning-review-scheduler.js';

const source = (id, signaled = true) => ({ eligible: true,
  learningSignals: signaled ? ['failure_recovered_by_different_route'] : [],
  pointer: { workId: `w-${id}`, runId: `r-${id}` } });

test('foreground는 reviewer를 기다리지 않고 quiet boundary 뒤 exact source window를 한 번 검토한다', async () => {
  const reviewed = []; let release; const gate = new Promise((resolve) => { release = resolve; });
  const scheduler = new LearningReviewScheduler({ idleMs: 0,
    loadSources: async () => [source(1), source(2)],
    review: async (input) => { reviewed.push(input); await gate; } });
  const began = performance.now(); assert.equal(await scheduler.consider(), true);
  assert.ok(performance.now() - began < 20); await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(reviewed.length, 1); assert.deepEqual(reviewed[0].sources.map((item) => item.pointer.runId), ['r-1', 'r-2']);
  release(); await scheduler.close();
});

test('같은 source window와 eligible source 한 개는 reviewer를 다시 열지 않는다', async () => {
  let calls = 0; const scheduler = new LearningReviewScheduler({ idleMs: 0,
    loadSources: async () => [source(1), source(2)], alreadyReviewed: async () => true,
    review: async () => { calls += 1; } });
  assert.equal(await scheduler.consider(), false); await scheduler.close(); assert.equal(calls, 0);
  const one = new LearningReviewScheduler({ idleMs: 0,
    loadSources: async () => [source(1)], review: async () => { calls += 1; } });
  assert.equal(await one.consider(), false); await one.close(); assert.equal(calls, 0);
});

test('단순 achieved Work 두 개는 기본 활성이어도 reviewer를 열지 않는다', async () => {
  let calls = 0; const scheduler = new LearningReviewScheduler({ idleMs: 0,
    loadSources: async () => [source(1, false), source(2, false)],
    review: async () => { calls += 1; } });
  assert.equal(await scheduler.consider(), false); await scheduler.close(); assert.equal(calls, 0);
});
