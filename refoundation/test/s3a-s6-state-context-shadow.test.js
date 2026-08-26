import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createS6Fixture, measureS6Fixture, ORACLE_MARKERS } from './helpers/s3a-s6-state-context.js';

test('S6 short/long은 현재 목적·oracle이 같고 long만 1000 messages·checkpoint를 가진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3a-s6-contract-'));
  try {
    const short = await createS6Fixture(join(room, 'short'), 'short_session');
    const long = await createS6Fixture(join(room, 'long'), 'long_session');
    const [shortResult, longResult] = await Promise.all([
      measureS6Fixture(short), measureS6Fixture(long),
    ]);
    assert.equal(shortResult.stateFacts.conversationMessages, 8);
    assert.equal(longResult.stateFacts.conversationMessages, 1000);
    assert.equal(shortResult.context.checkpointPresent, false);
    assert.equal(longResult.context.checkpointPresent, true);
    for (const marker of ORACLE_MARKERS) {
      assert.equal(shortResult.context.oracle[marker], true, `short missing ${marker}`);
      assert.equal(longResult.context.oracle[marker], true, `long missing ${marker}`);
    }
    assert.ok(longResult.context.tailEntries < longResult.stateFacts.conversationMessages);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('S6 O2 shadow는 state read/replay와 context compilation만 content-free로 분리한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3a-s6-phase-'));
  try {
    const fixture = await createS6Fixture(room, 'long_session');
    const result = await measureS6Fixture(fixture);
    assert.deepEqual(Object.keys(result.phases), ['state_read_replay', 'context_compilation']);
    assert.ok(result.phases.state_read_replay.durationNs > 0);
    assert.ok(result.phases.context_compilation.durationNs > 0);
    assert.deepEqual(result.diagnostics, { clockFailures: 0, droppedSpans: 0, writerFailures: 0 });
    assert.doesNotMatch(JSON.stringify(result.phases), /PROJECT-S6|UNKNOWN-COST|LATEST-CORRECTION/u);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('S6 cold/warm shadow는 같은 fixture의 provider body digest와 quality를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3a-s6-warm-'));
  try {
    const fixture = await createS6Fixture(room, 'long_session');
    const cold = await measureS6Fixture(fixture, { resident: false });
    const warm = await measureS6Fixture(fixture, { resident: true });
    assert.equal(cold.context.bodyDigest, warm.context.bodyDigest);
    assert.deepEqual(cold.context.oracle, warm.context.oracle);
    assert.equal(cold.context.requestBytes, warm.context.requestBytes);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
