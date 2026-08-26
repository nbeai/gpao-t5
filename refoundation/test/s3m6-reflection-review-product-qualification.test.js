import assert from 'node:assert/strict';
import test from 'node:test';

import { runReflectionReviewProductQualification } from '../scripts/run-s3m6-reflection-review-product-qualification.mjs';

test('실제 Turn5 adapter는 격리 console에서 review journeys를 product side effect 없이 통과한다', async () => {
  const result = await runReflectionReviewProductQualification();
  assert.equal(result.pass, true, JSON.stringify(result));
  assert.equal(result.journeys.length, 10);
  assert.ok(result.journeys.every((journey) => journey.pass));
  assert.deepEqual({ defaultBackgroundEnabled: result.defaultBackgroundEnabled,
    externalWrites: result.externalWrites, modelCalls: result.modelCalls,
    providerCalls: result.providerCalls, contextCanaryHits: result.contextCanaryHits }, {
    defaultBackgroundEnabled: false, externalWrites: 0, modelCalls: 0,
    providerCalls: 0, contextCanaryHits: 0,
  });
});

test('product adapter factory는 default console hot path를 수정하거나 background를 시작하지 않는다', async () => {
  const [adapter, consoleServer] = await Promise.all([
    import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/reflection-review-product-adapter.js', import.meta.url), 'utf8')),
    import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../src/console-server.js', import.meta.url), 'utf8')),
  ]);
  assert.doesNotMatch(adapter, /setInterval|setTimeout|queueMicrotask|modelFactory|respond\(/u);
  assert.match(consoleServer, /reflectionReviewCoordinator = null/u);
});
