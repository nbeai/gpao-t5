import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TurnTiming,
  assertTurnTimingRecord,
} from '../src/kernel/l0-evidence/turn-timing.js';

const ID = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';

function fixture(clock) {
  return new TurnTiming({
    measurementId: ID,
    turnRef: { sessionId: SESSION, turnSeq: 7 },
    surface: 'web',
    clock,
  });
}

test('단조 시계를 주입하고 서버 사건은 첫 기록만 유지한다', () => {
  let now = 100;
  const timing = fixture(() => now);
  now = 104;
  assert.equal(timing.markServer('stream_connected'), 4);
  now = 109;
  assert.equal(timing.markServer('stream_connected'), 4, '같은 사건은 첫 값이 진실이다');
  now = 111;
  timing.markServer('server_committed');

  const record = timing.finalize({ outcome: 'reply', pathClass: 'chat' });
  assert.equal(record.server.input_received, 0);
  assert.equal(record.server.stream_connected, 4);
  assert.equal(record.server.server_committed, 11);
});

test('선택 origin은 stream-start 수신 원점을 constructor 뒤에도 보존한다', () => {
  let now = 120;
  const timing = new TurnTiming({
    measurementId: ID,
    turnRef: { sessionId: SESSION, turnSeq: 8 },
    surface: 'web',
    origin: 100,
    clock: () => now,
  });
  assert.equal(timing.markServer('stream_connected'), 20);
  assert.equal(timing.finalize().server.input_received, 0);
  assert.throws(() => new TurnTiming({
    measurementId: ID,
    turnRef: { sessionId: SESSION, turnSeq: 9 },
    origin: -1,
    clock: () => now,
  }), /origin|원점|0 이상/);
});

test('markServerAt은 TurnRef 발급 전 선행 시각을 같은 단조축에 정확히 결합한다', () => {
  let now = 160;
  const timing = new TurnTiming({
    measurementId: ID,
    turnRef: { sessionId: SESSION, turnSeq: 10 },
    surface: 'web',
    origin: 100,
    clock: () => now,
  });
  assert.equal(timing.markServerAt('stream_connected', 120), 20);
  assert.equal(timing.markServerAt('queue_entered', 135), 35);
  assert.equal(timing.markServerAt('stream_connected', 150), 20, '이미 찬 사건은 첫 값이 이긴다');
  assert.throws(() => timing.markServerAt('queue_started', 99), /origin|원점/);
  assert.throws(() => timing.markServerAt('queue_started', 161), /현재|sampled/);
  assert.throws(() => timing.markServerAt('first_feedback_emitted', 130), /순서|단조/,
    'queue_entered 뒤 사건이 더 이른 시각이면 안 된다');
});

test('겹치는 외부 대기는 합산하지 않고 구간 합집합으로 계산한다', () => {
  let now = 100;
  const timing = fixture(() => now);
  const model = timing.beginExternalWait('model');
  now = 110;
  const tool = timing.beginExternalWait('tool');
  now = 130;
  model.end();
  now = 150;
  tool.end();
  now = 160;
  timing.markServer('server_committed');

  const record = timing.finalize({ outcome: 'reply', pathClass: 'mixed' });
  assert.equal(record.externalWait.unionMs, 50, '100~150은 50ms이지 70ms가 아니다');
  assert.deepEqual(record.externalWait.counts, { model: 1, tool: 1, network: 0, service: 0 });
  assert.equal(record.server.t5_overhead, 10, '전체 60ms - 외부 대기 합집합 50ms');
});

test('뒤로 가는 시계와 음수 브라우저 시간은 거부한다', () => {
  let now = 10;
  const timing = fixture(() => now);
  now = 9;
  assert.throws(() => timing.markServer('stream_connected'), /단조|뒤로/);
  assert.throws(
    () => timing.reportBrowser('first_feedback_visible', -1, 'visible'),
    /음수|0 이상/,
  );
});

test('외부 대기 종료도 단조성을 지키고 두 번 종료해 시간을 늘리지 않는다', () => {
  let now = 20;
  const timing = fixture(() => now);
  const wait = timing.beginExternalWait('network');
  now = 30;
  assert.equal(wait.end(), 10);
  now = 50;
  assert.equal(wait.end(), 10, '같은 span의 종료는 첫 값만 유지한다');
  timing.markServer('server_committed');
  assert.equal(timing.finalize({ outcome: 'reply' }).externalWait.unionMs, 10);
});

test('브라우저 표시 사건도 first-write-wins이며 출처를 주장으로 표시한다', () => {
  const timing = fixture(() => 1);
  assert.equal(timing.reportBrowser('first_feedback_visible', 3.5, 'visible'), 3.5);
  assert.equal(timing.reportBrowser('first_feedback_visible', 1.2, 'visible'), 3.5);
  timing.reportBrowser('first_grounded_content', 8, 'visible');
  timing.reportBrowser('turn_complete', 11, 'visible');

  const record = timing.finalize({ outcome: 'reply' });
  assert.equal(record.browser.source, 'browser_report');
  assert.equal(record.browser.first_feedback_visible, 3.5);
  assert.equal(record.browser.turn_complete, 11);
});

test('알 수 없는 사건·대기 종류·표면 상태는 거부한다', () => {
  const timing = fixture(() => 1);
  assert.throws(() => timing.markServer('prompt_sent'), /알 수 없는/);
  assert.throws(() => timing.beginExternalWait('database'), /알 수 없는/);
  assert.throws(() => timing.reportBrowser('painted', 1, 'visible'), /알 수 없는/);
  assert.throws(() => timing.reportBrowser('turn_complete', 1, 'mystery'), /visibility/);
});

test('저장 스키마는 원문·도구 인자·임의 필드를 허용하지 않는다', () => {
  const timing = fixture(() => 1);
  const record = timing.finalize({ outcome: 'reply', pathClass: 'chat' });
  assert.doesNotThrow(() => assertTurnTimingRecord(record));
  assert.throws(() => assertTurnTimingRecord({ ...record, text: '비밀 메시지' }), /허용되지 않은/);
  assert.throws(() => assertTurnTimingRecord({ ...record, args: { token: 'secret' } }), /허용되지 않은/);
  assert.throws(() => assertTurnTimingRecord({ ...record, server: { ...record.server, prompt: '원문' } }), /허용되지 않은/);
});

test('열린 외부 대기나 완료보다 긴 외부 대기는 최종 기록으로 만들 수 없다', () => {
  let now = 0;
  const open = fixture(() => now);
  open.beginExternalWait('model');
  now = 5;
  open.markServer('server_committed');
  assert.throws(() => open.finalize({ outcome: 'reply' }), /열린 외부 대기/);

  const invalid = fixture(() => now);
  const span = invalid.beginExternalWait('tool');
  now = 15;
  span.end();
  assert.throws(() => invalid.finalize({ outcome: 'reply' }), /server_committed/);
});

test('외부 대기 구간은 길이가 작아도 server commit 뒤까지 이어질 수 없다', () => {
  let now = 0;
  const timing = fixture(() => now);
  now = 10;
  const wait = timing.beginExternalWait('service');
  now = 15;
  timing.markServer('server_committed');
  now = 20;
  wait.end();
  assert.throws(() => timing.finalize({ outcome: 'reply' }), /commit.*뒤|server_committed/);
});
