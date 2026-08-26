import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('기존 Work·Run·Conversation만으로 bounded 작업 기록을 검색·재개방한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-history-product-')); let calls = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    modelFactory: () => ({ async respond(input) {
      calls += 1;
      if (calls === 1) return { text: '', toolCalls: [{ id: 'complete-work', name: 'work_completion',
        args: { outcome: 'achieved', inputSettlements: [] } }] };
      return { text: '분기 보고서를 확인했습니다.', toolCalls: [] };
    } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const turn = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '분기 보고서를 확인해줘' }) });
    assert.equal(turn.status, 200, await turn.text()); const callsAfterTurn = calls;
    const listResponse = await fetch(`${base}/work-history?query=${encodeURIComponent('분기 보고서')}&limit=10`);
    const list = await listResponse.json(); assert.equal(listResponse.headers.get('cache-control'), 'no-store');
    assert.equal(list.items.length, 1); assert.deepEqual(list.items[0].status, { text: '완료' });
    assert.equal(list.items[0].actorText, '내 요청'); assert.equal(calls, callsAfterTurn);
    const serialized = JSON.stringify(list);
    assert.doesNotMatch(serialized, new RegExp(session.id, 'u'));
    assert.doesNotMatch(serialized, /runId|workId|sessionId|toolCallId|sha256|filePath|\/Users\//u);
    const detail = await fetch(`${base}/work-history/${list.items[0].historyHandle}`).then((response) => response.json());
    assert.equal(detail.detail.objective, '분기 보고서를 확인해줘');
    assert.equal(detail.detail.finalAnswer, '결과 답변은 대화를 열어 확인할 수 있어요.');
    assert.equal(calls, callsAfterTurn);
    const reopened = await fetch(`${base}/work-history/reopen`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ historyHandle: list.items[0].historyHandle }) })
      .then((response) => response.json());
    assert.equal(reopened.sessionId, session.id); assert.equal(calls, callsAfterTurn);
  } finally {
    server.closeWakeStreams(); await server.managedProcesses.stopAll('test_shutdown');
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
