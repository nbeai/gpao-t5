import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionActivityStore } from '../src/session-activity-store.js';

test('세션 활동은 동시에 실행되는 Run을 섞지 않고 현재 안전 문구만 투영한다', () => {
  const store = new SessionActivityStore({ now: (() => { let value = 100; return () => ++value; })() });
  const first = store.start({ sessionId: 'session-a', runId: 'run-a', text: '요청을 이해하고 있어요' });
  store.start({ sessionId: 'session-b', runId: 'run-b', text: '웹에서 관련 자료를 찾고 있어요' });
  store.update({ sessionId: 'session-a', runId: 'run-a', text: '페이지 내용을 살펴보고 있어요', phase: 'tool' });

  assert.equal(first.status, 'running');
  assert.equal(store.get('session-a').text, '페이지 내용을 살펴보고 있어요');
  assert.equal(store.get('session-b').text, '웹에서 관련 자료를 찾고 있어요');
  assert.equal(store.get('session-a').runId, 'run-a');
  assert.equal(store.update({ sessionId: 'session-a', runId: 'stale-run', text: 'secret-token' }), null);
  assert.doesNotMatch(JSON.stringify(store.list()), /secret-token/u);

  const completed = store.finish({ sessionId: 'session-b', runId: 'run-b', status: 'completed' });
  assert.equal(completed.status, 'completed');
  assert.equal(store.get('session-b'), null);
  assert.equal(store.get('session-a').status, 'running');
});

test('확인된 활동 사실만 중복 없이 최근 여섯 단계로 복원한다', () => {
  const store = new SessionActivityStore({ now: (() => { let value = 200; return () => ++value; })() });
  store.start({ sessionId: 'session-a', runId: 'run-a', text: '요청을 이해하고 있어요' });
  const fact = (index) => ({ schema: 't5.public-activity-fact.v1', kind: `step-${index}`,
    text: `확인된 단계 ${index}`, dedupeKey: `step-${index}` });
  store.record({ sessionId: 'session-a', runId: 'run-a', fact: fact(1) });
  store.record({ sessionId: 'session-a', runId: 'run-a', fact: fact(1) });
  for (let index = 2; index <= 7; index += 1) {
    store.record({ sessionId: 'session-a', runId: 'run-a', fact: fact(index) });
  }
  assert.deepEqual(store.get('session-a').steps.map((step) => step.dedupeKey),
    ['step-2', 'step-3', 'step-4', 'step-5', 'step-6', 'step-7']);
  assert.equal(store.record({ sessionId: 'session-a', runId: 'other-run', fact: fact(8) }), null);
  assert.equal(store.record({ sessionId: 'session-a', runId: 'run-a', fact: { text: '임의 문장' } }), null);
});
