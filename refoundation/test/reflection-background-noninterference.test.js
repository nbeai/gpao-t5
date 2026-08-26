import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { qualifyReflectionBackgroundNoninterference } from '../src/reflection-background-noninterference.js';

test('AB/BA·O0/O2 quartet은 foreground 의미·도구·순서·provider·context·store ops를 바꾸지 않는다', async () => {
  const result = await qualifyReflectionBackgroundNoninterference();
  assert.equal(result.pass, true); assert.equal(result.quartet.length, 4);
  assert.deepEqual(result.quartet.map((item) => `${item.observerMode}:${item.order}`),
    ['O0_off:AB', 'O0_off:BA', 'O2_full_shadow:AB', 'O2_full_shadow:BA']);
  assert.equal(result.semanticDigestAgreement, true);
  for (const pair of result.quartet) {
    assert.equal(pair.sameForeground, true);
    assert.deepEqual(pair.samples.off.foreground.toolArgs, pair.samples.on.foreground.toolArgs);
    assert.deepEqual(pair.samples.off.foreground.order, pair.samples.on.foreground.order);
    assert.equal(pair.samples.on.foreground.providerCalls, 0);
    assert.equal(pair.samples.off.foreground.contextBytes, pair.samples.on.foreground.contextBytes);
    assert.deepEqual(pair.samples.off.measurement.foregroundStoreOps,
      pair.samples.on.measurement.foregroundStoreOps);
  }
});

test('background는 독립 lane에서 먼저 yield하고 foreground correction 뒤 stale commit 0이다', async () => {
  const result = await qualifyReflectionBackgroundNoninterference();
  for (const pair of result.quartet) {
    assert.equal(pair.backgroundIndependentLane, true);
    assert.equal(pair.backgroundYieldedBeforeForeground, true);
    assert.equal(pair.stalePublicationRejected, true);
    assert.equal(pair.stalePublicationCommits, 0);
    assert.equal(pair.samples.on.backgroundResult.state, 'inactive');
    assert.match(pair.samples.on.backgroundResult.reviewDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(pair.samples.on.measurement.backgroundStoreOps,
      { reads: 1, proposals: 1, commits: 0 });
  }
  assert.equal(new Set(result.quartet.map((pair) => pair.samples.on.backgroundResult.reviewDigest)).size, 1);
});

test('observer는 O0에서 product span 0, O2에서 fixed phases만 기록하고 측정치를 수치로 남긴다', async () => {
  const result = await qualifyReflectionBackgroundNoninterference();
  for (const pair of result.quartet) {
    for (const sample of Object.values(pair.samples)) {
      if (pair.observerMode === 'O0_off') assert.deepEqual(sample.observer.spans, []);
      else assert.deepEqual(sample.observer.spans.map((span) => span.phase), [
        'state_read_replay', 'context_compilation', 'tool_execution', 'verification', 'surface_publication',
      ]);
      for (const name of ['wallMs', 'processCpuMs', 'eventLoopDelayMs']) {
        assert.equal(Number.isFinite(sample.measurement[name]), true);
        assert.ok(sample.measurement[name] >= 0);
      }
    }
    assert.equal(pair.performanceQualified, true);
  }
});

test('qualification module은 console/background default에 연결되지 않고 model·external을 사용하지 않는다', async () => {
  const [module, consoleServer] = await Promise.all([
    readFile(new URL('../src/reflection-background-noninterference.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(consoleServer, /reflection-background-noninterference/u);
  assert.doesNotMatch(module, /fetch\(|modelFactory|\.respond\(|https?:\/\//u);
});
