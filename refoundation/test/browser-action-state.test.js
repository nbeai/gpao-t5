import test from 'node:test';
import assert from 'node:assert/strict';

import { makeBrowserObservationRegistry } from '../src/browser-action-state.js';

const observed = (observationId, tabId = 't1', refs = { e1: { role: 'button', name: '다음' } }) => ({
  observationId, refs,
  refScope: { observationId, tabId, targetId: `target-${tabId}`, url: 'https://example.com/' },
});

test('ref는 같은 tab의 최신 observationId에만 결속된다', () => {
  const registry = makeBrowserObservationRegistry();
  registry.remember(observed('a'.repeat(64)));
  assert.equal(registry.resolve({ observationId: 'a'.repeat(64), tabId: 't1', ref: 'e1' }).ok, true);
  registry.remember(observed('b'.repeat(64)));
  assert.deepEqual(registry.resolve({ observationId: 'a'.repeat(64), tabId: 't1', ref: 'e1' }), {
    ok: false, state: 'stale_observation', latestObservationId: 'b'.repeat(64),
  });
});

test('다른 tab과 관측하지 않은 ref는 action target이 되지 않는다', () => {
  const registry = makeBrowserObservationRegistry();
  registry.remember(observed('c'.repeat(64)));
  assert.equal(registry.resolve({ observationId: 'c'.repeat(64), tabId: 't2', ref: 'e1' }).state, 'observation_tab_mismatch');
  assert.equal(registry.resolve({ observationId: 'c'.repeat(64), tabId: 't1', ref: 'e9' }).state, 'ref_not_observed');
});

test('registry는 최근 tab 관측만 bounded 보존한다', () => {
  const registry = makeBrowserObservationRegistry({ maxTabs: 2 });
  registry.remember(observed('1'.repeat(64), 't1'));
  registry.remember(observed('2'.repeat(64), 't2'));
  registry.remember(observed('3'.repeat(64), 't3'));
  assert.equal(registry.resolve({ observationId: '1'.repeat(64), tabId: 't1', ref: 'e1' }).state, 'observation_unknown');
  assert.equal(registry.resolve({ observationId: '3'.repeat(64), tabId: 't3', ref: 'e1' }).ok, true);
});
