import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { makeS3aPerformanceObserver } from './helpers/s3a-performance-observer.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function journey(mode, { nowNs, maxSpans, contaminate = false } = {}) {
  const observer = makeS3aPerformanceObserver({ mode, nowNs, maxSpans });
  let writerCalls = 0;
  const request = { user: 'safe-fixture-request', tools: ['observe_fixture'] };
  if (contaminate) request.s3aTraceId = 'must-change-request-digest';
  const product = { requestDigest: digest(request), toolCalls: [], authority: [], effects: [], surface: null };
  await observer.measure('state_read_replay', async () => ({ revision: 3 }), { itemCount: 3 });
  await observer.measure('context_compilation', async () => ({ requestDigest: product.requestDigest }), { bytesOut: 91 });
  await observer.measure('provider_wait_combined_unknown', async () => ({ response: 'tool' }), { attempt: 1, bytesIn: 91 });
  await observer.measure('tool_execution', async () => {
    product.toolCalls.push({ name: 'observe_fixture', argsDigest: digest({ target: 'fixture' }) });
    product.authority.push({ effect: 'observe', allowed: true });
    product.effects.push({ kind: 'observe', outcome: 'succeeded' });
    return { count: 3 };
  }, { itemCount: 3 });
  await observer.measure('verification', async () => ({ exactCount: 3 }), { itemCount: 3 });
  await observer.measure('model_generation_combined_unknown', async () => ({ answer: '확인용 파일은 3개예요.' }));
  await observer.measure('surface_publication', async () => {
    product.surface = { kind: 'reply', answer: '확인용 파일은 3개예요.', artifacts: [] };
    return product.surface;
  }, { bytesOut: 41 });
  const productDigestBeforeFlush = digest(product);
  assert.equal(writerCalls, 0, 'writer must not run before the product result is terminal');
  const flush = await observer.flush(async () => { writerCalls += 1; });
  return { product, productDigestBeforeFlush, observer: observer.snapshot(), flush, writerCalls };
}

test('O0/O1/O2는 provider request·tool·authority·effect·surface를 바꾸지 않는다', async () => {
  let tick = 1000n;
  const nowNs = () => { tick += 10n; return tick; };
  const results = [];
  for (const mode of ['O0_off', 'O1_clock_only', 'O2_full_shadow']) {
    results.push(await journey(mode, { nowNs }));
  }
  assert.equal(new Set(results.map((result) => result.productDigestBeforeFlush)).size, 1);
  assert.deepEqual(results.map((result) => result.writerCalls), [0, 0, 1]);
  assert.deepEqual(results.map((result) => result.flush.state), ['not_applicable', 'not_applicable', 'written']);
});

test('full-shadow는 content-free bounded span만 남기고 raw metadata를 복제하지 않는다', async () => {
  const result = await journey('O2_full_shadow');
  const encoded = JSON.stringify(result.observer);
  assert.equal(result.observer.spans.length, 7);
  assert.doesNotMatch(encoded, /safe-fixture-request|확인용 파일|observe_fixture|must-change/u);
  for (const span of result.observer.spans) {
    assert.deepEqual(Object.keys(span), [
      'schema', 'sequence', 'phase', 'status', 'monotonicStartNs', 'monotonicEndNs',
      'durationNs', 'attempt', 'bytesIn', 'bytesOut', 'itemCount',
    ]);
  }
});

test('clock·writer·buffer 실패는 제품 결과나 원래 오류 identity를 바꾸지 않는다', async () => {
  const brokenClock = await journey('O2_full_shadow', { nowNs: () => { throw new Error('clock secret'); }, maxSpans: 2 });
  assert.equal(brokenClock.observer.diagnostics.clockFailures, 14);
  assert.equal(brokenClock.observer.diagnostics.droppedSpans, 5);
  assert.equal(brokenClock.product.surface.answer, '확인용 파일은 3개예요.');

  const observer = makeS3aPerformanceObserver({ mode: 'O2_full_shadow' });
  const original = new Error('original operation failure');
  await assert.rejects(observer.measure('tool_execution', async () => { throw original; }), (error) => error === original);
  const flush = await observer.flush(async () => { throw new Error('writer failed'); });
  assert.equal(flush.state, 'degraded');
  assert.equal(observer.snapshot().diagnostics.writerFailures, 1);
});

test('trace field가 provider request에 들어가면 비개입 digest 반대시험이 실제로 실패한다', async () => {
  const clean = await journey('O0_off');
  const contaminated = await journey('O2_full_shadow', { contaminate: true });
  assert.notEqual(clean.product.requestDigest, contaminated.product.requestDigest);
  assert.notEqual(clean.productDigestBeforeFlush, contaminated.productDigestBeforeFlush);
});
