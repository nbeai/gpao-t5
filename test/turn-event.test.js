import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeTurnEvent, isDurable, isTerminal, EVENT_TYPES } from '../src/kernel/l0-evidence/turn-event.js';
import { EventLog } from '../src/surface/event-log.js';

// ── 계약: durable 분리 · 사고 원문 아님 · 단조 eventId. ──
test('TurnEvent: durable 분리(answer_delta/heartbeat 비지속), 종료 판정', () => {
  assert.equal(isDurable('trace_status'), true);
  assert.equal(isDurable('complete'), true);
  assert.equal(isDurable('answer_delta'), false, '조각은 진실의 출처가 아님');
  assert.equal(isDurable('heartbeat'), false);
  assert.equal(isTerminal('complete'), true);
  assert.equal(isTerminal('blocked'), true);
  assert.equal(isTerminal('trace_status'), false);
  const e = makeTurnEvent({ turnId: 't1', eventId: 1, type: 'trace_status', payload: { text: '요청을 이해했어요' } });
  assert.equal(e.durable, true);
  assert.equal(e.payload.text, '요청을 이해했어요');
});

test('TurnEvent: 알 수 없는 유형·비정수 eventId는 거부', () => {
  assert.throws(() => makeTurnEvent({ turnId: 't', eventId: 1, type: 'chain_of_thought' }), /알 수 없는/);
  assert.throws(() => makeTurnEvent({ turnId: 't', eventId: 1.5, type: 'complete' }), /단조/);
  assert.ok(EVENT_TYPES.includes('capability_needed'));
});

// ── EventLog: durable만 지속, lastEventId 재접속 복구, 미종료 복구 표시. ──
async function withLog(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-evt-'));
  return fn(new EventLog(dir), randomUUID());
}

test('EventLog: durable만 남고, lastEventId 이후만 재생(재접속)', async () => {
  await withLog(async (log, sid) => {
    const mk = (id, type, payload) => makeTurnEvent({ turnId: 'T', eventId: id, type, payload });
    await log.append(sid, mk(1, 'trace_status', { text: '이해' }));
    await log.append(sid, mk(2, 'answer_delta', { text: '안녕' })); // 비지속 → 안 남음
    await log.append(sid, mk(3, 'tool_progress', { text: '웹 확인 중' }));
    await log.append(sid, mk(4, 'complete', {}));
    const all = await log.since(sid, 0);
    assert.deepEqual(all.map((e) => e.eventId), [1, 3, 4], 'durable만, answer_delta 제외');
    // 재접속: lastEventId=1 이후만
    const resume = await log.since(sid, 1);
    assert.deepEqual(resume.map((e) => e.eventId), [3, 4]);
    assert.equal(await log.lastIsTerminal(sid), true);
  });
});

test('EventLog: complete 없이 끊긴 turn은 미종료(복구 표시 대상)', async () => {
  await withLog(async (log, sid) => {
    await log.append(sid, makeTurnEvent({ turnId: 'T', eventId: 1, type: 'trace_status', payload: { text: '이해' } }));
    await log.append(sid, makeTurnEvent({ turnId: 'T', eventId: 2, type: 'tool_progress', payload: { text: '확인 중' } }));
    // complete가 오기 전에 끊김
    assert.equal(await log.lastIsTerminal(sid), false, '무한 대기 금지 — UI가 복구 중을 표시할 신호');
    const next = await log.nextEventId(sid);
    assert.equal(next, 3, '단조 증가 유지');
  });
});

test('EventLog: 경로 traversal 방지(잘못된 sessionId 거부)', async () => {
  await withLog(async (log) => {
    await assert.rejects(async () => log.since('../../etc/passwd'), /bad sessionId/);
  });
});
