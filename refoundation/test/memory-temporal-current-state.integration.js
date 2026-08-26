import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function session(base) {
  return fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
}
async function turn(base, sessionId, text) {
  return fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, text }),
  }).then((response) => response.json());
}

test('현재·과거 temporal 질문은 pointer 선택 뒤 exact source reopen으로만 claim content를 받는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-temporal-current-product-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  let base; const calls = new Map();
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelFactory: ({ sessionId }) => ({ async respond(input) {
      const count = calls.get(sessionId) ?? 0; calls.set(sessionId, count + 1);
      const request = input.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
      if (count === 0) {
        assert.equal(input.messages.some((message) => /dark roast|light roast/u.test(message.content)), false,
          'temporal claim content must not be injected before exact read');
        if (/이제는/u.test(request)) return { text: '현재 말씀하신 decaf 선호를 우선하겠습니다.', toolCalls: [] };
        const pointers = input.messages.find((message) => /T5 TEMPORAL MEMORY POINTERS/u.test(message.content));
        assert.ok(pointers);
        const memoryId = /작년/u.test(request) ? 'memory-old' : 'memory-current';
        assert.match(pointers.content, new RegExp(`"memoryId":"${memoryId}"`, 'u'));
        return { text: '', toolCalls: [{ id: `read-${memoryId}`, name: 'memory', args: {
          action: 'read', memoryIds: [memoryId], memoryId: null, kind: null, content: null,
          subjects: null, alwaysRelevant: null,
        } }] };
      }
      const receipt = JSON.parse(input.messages.find((message) => message.role === 'tool'
        && message.name === 'memory').content).result;
      assert.equal(receipt.state, 'read');
      assert.equal(receipt.source.availability, 'available');
      return { text: receipt.claims[0].value, toolCalls: [] };
    } }),
  });
  base = await listen(server);
  try {
    const sourceSession = await session(base);
    await server.conversationLedger.ensure({ sessionId: sourceSession.id });
    const oldEvent = await server.conversationLedger.appendMessage({
      sessionId: sourceSession.id, messageId: 'source-old',
      message: { role: 'user', content: 'In 2025 I preferred dark roast.' },
    });
    const currentEvent = await server.conversationLedger.appendMessage({
      sessionId: sourceSession.id, messageId: 'source-current',
      message: { role: 'user', content: 'From 2026 I prefer light roast.' },
    });
    const ref = (event) => projectConversationRecordReference({
      event, expectedSessionId: sourceSession.id, trust: 'user_asserted',
      sensitivity: 'personal', channel: 'console', observedAt: '2026-08-26T05:00:00.000Z',
    });
    await server.memoryLedger.ensure();
    await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({
      memoryId: 'memory-old', kind: 'preference', subjectKey: 'subject-coffee', value: 'dark roast',
      scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
      sources: [ref(oldEvent)], recordedAt: '2026-01-02T00:00:00.000Z',
      validFrom: '2025-01-01T00:00:00.000Z', validTo: '2026-01-01T00:00:00.000Z',
      subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
      sensitivity: 'personal', alwaysRelevant: false,
    }) });
    await server.memoryLedger.commitClaim({ claim: makeMemoryClaim({
      memoryId: 'memory-current', kind: 'preference', subjectKey: 'subject-coffee', value: 'light roast',
      scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
      sources: [ref(currentEvent)], recordedAt: '2026-01-02T00:01:00.000Z',
      validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
      subjectRevision: 2, sourceOrder: 3, status: 'active', supersedes: ['memory-old'], conflictsWith: [],
      sensitivity: 'personal', alwaysRelevant: false,
    }) });

    const current = await session(base); const currentReply = await turn(base, current.id, '현재 커피 선호는 뭐야?');
    assert.equal(currentReply.reply, 'light roast');
    const historical = await session(base); const historicalReply = await turn(base, historical.id, '작년 커피 선호는 뭐였어?');
    assert.equal(historicalReply.reply, 'dark roast');
    const correction = await session(base); const corrected = await turn(base, correction.id, '이제는 decaf를 선호해. 지금부터 반영해.');
    assert.equal(corrected.reply, '현재 말씀하신 decaf 선호를 우선하겠습니다.');
    assert.equal(calls.get(correction.id), 1, 'current correction must not require stale memory read');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('사용자는 자연어로 temporal claim을 기억·교정·확인·철회하고 새 Session에서 이어간다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-temporal-natural-product-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const phase = new Map();
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelFactory: ({ sessionId }) => ({ async respond(input) {
      const count = phase.get(sessionId) ?? 0; phase.set(sessionId, count + 1);
      const request = input.messages.filter((message) => message.role === 'user').at(-1)?.content ?? '';
      if (/내보내/u.test(request)) {
        const exportedReceipt = input.messages.find((message) => message.role === 'tool'
          && message.toolCallId === 'export');
        if (exportedReceipt) {
          const result = JSON.parse(exportedReceipt.content).result;
          assert.equal(result.state, 'exported');
          assert.equal(result.bundle.schema, 't5.memory-portable.v1');
          return { text: `exported:${result.bundle.claims.length}`, toolCalls: [] };
        }
        const searchReceipt = input.messages.find((message) => message.role === 'tool'
          && message.toolCallId === 'find-export');
        if (searchReceipt) {
          const result = JSON.parse(searchReceipt.content).result;
          assert.deepEqual(result.activatedTools, ['memory_control']);
          return { text: '', toolCalls: [{ id: 'export', name: 'memory_control', args: {
            action: 'export', requestId: null, memoryId: null,
          } }] };
        }
        if (input.tools.some((tool) => tool.name === 'memory_control')) {
          return { text: '', toolCalls: [{ id: 'export', name: 'memory_control', args: {
            action: 'export', requestId: null, memoryId: null,
          } }] };
        }
        return { text: '', toolCalls: [{ id: 'find-export', name: 'tool_search', args: {
          query: 'portable JSON export restore',
        } }] };
      }
      const expectedCallId = /복원/u.test(request) ? 'restore'
        : /뭐라고/u.test(request) ? 'read'
        : /기억해/u.test(request) ? 'remember'
        : /고쳐/u.test(request) ? 'correct'
          : /잊어/u.test(request) ? 'retract' : null;
      const receiptMessage = input.messages.find((message) => message.role === 'tool'
        && message.toolCallId === expectedCallId);
      if (receiptMessage) {
        const receipt = JSON.parse(receiptMessage.content).result;
        if (receiptMessage.name === 'memory' && receipt.state === 'read') {
          return { text: receipt.claims[0].value, toolCalls: [] };
        }
        return { text: receipt.state, toolCalls: [] };
      }
      const pointers = input.messages.find((message) => /T5 TEMPORAL MEMORY POINTERS/u.test(message.content));
      const pointerLines = pointers?.content.split('\n').filter((line) => line.startsWith('{')).map(JSON.parse) ?? [];
      const active = pointerLines.find((item) => item.temporalState === 'current');
      const forgetPointers = input.messages.find((message) => /T5 RECOVERABLE FORGET POINTERS/u.test(message.content));
      const forgotten = forgetPointers?.content.split('\n').filter((line) => line.startsWith('{')).map(JSON.parse)[0];
      if (/복원/u.test(request) && forgotten) return { text: '', toolCalls: [{
        id: 'restore', name: 'memory_control', args: {
          action: 'restore', requestId: forgotten.requestId, memoryId: forgotten.memoryId,
        },
      }] };
      if (/뭐라고/u.test(request) && active) return { text: '', toolCalls: [{
        id: 'read', name: 'memory', args: {
          action: 'read', memoryIds: [active.memoryId], memoryId: null, kind: null,
          content: null, subjects: null, alwaysRelevant: null,
        },
      }] };
      if (/뭐라고/u.test(request)) return { text: '현재 유효한 커피 기억이 없습니다.', toolCalls: [] };
      if (/기억해/u.test(request)) return { text: '', toolCalls: [{
        id: 'remember', name: 'memory_claim', args: {
          action: 'remember', kind: 'preference', value: 'dark roast', subjectHandle: null,
          validTimeMeaning: { from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z', certainty: 'explicit' },
          scopeMeaning: 'global',
        },
      }] };
      if (/고쳐/u.test(request)) return { text: '', toolCalls: [{
        id: 'correct', name: 'memory_claim', args: {
          action: 'correct', kind: 'preference', value: 'light roast',
          subjectHandle: active.subjectHandle,
          validTimeMeaning: { from: '2026-08-26T00:00:00.000Z', to: '2027-08-26T00:00:00.000Z', certainty: 'explicit' },
          scopeMeaning: 'global',
        },
      }] };
      if (/잊어/u.test(request)) return { text: '', toolCalls: [{
        id: 'retract', name: 'memory_claim', args: {
          action: 'retract', kind: 'preference', value: 'retract coffee preference',
          subjectHandle: active.subjectHandle,
          validTimeMeaning: { from: null, to: null, certainty: 'unknown' },
          scopeMeaning: 'global',
        },
      }] };
      return { text: '현재 유효한 커피 기억이 없습니다.', toolCalls: [] };
    } }),
  });
  const base = await listen(server);
  try {
    const rememberSession = await session(base);
    assert.equal((await turn(base, rememberSession.id, '내 커피 선호를 dark roast로 기억해.')).reply, 'committed');
    const firstRecall = await session(base);
    assert.notEqual(firstRecall.id, rememberSession.id);
    assert.equal((await turn(base, firstRecall.id, '내 커피 선호를 뭐라고 기억해?')).reply, 'dark roast');
    const correctionSession = await session(base);
    assert.equal((await turn(base, correctionSession.id, '그 커피 선호를 light roast로 고쳐.')).reply, 'committed');
    const secondRecall = await session(base);
    assert.equal((await turn(base, secondRecall.id, '내 커피 선호를 뭐라고 기억해?')).reply, 'light roast');
    const retractSession = await session(base);
    const retractedSurface = await turn(base, retractSession.id, '그 커피 선호를 잊어.');
    assert.equal(retractedSurface.reply, 'retracted');
    const retractRun = await fetch(`${base}/runs/${retractedSurface.runId}`).then((response) => response.json());
    const forgetReceipt = retractRun.events.find((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.actualCall?.name === 'memory_claim')?.payload?.receipt?.result?.forgetReceipt;
    assert.equal(forgetReceipt.searchHitAfter, 0);
    assert.equal(forgetReceipt.contextProjectionAfter, 0);
    assert.equal(forgetReceipt.behaviorProbeAfter, 'unknown');
    const after = await session(base);
    assert.equal((await turn(base, after.id, '내 커피 선호를 뭐라고 기억해?')).reply,
      '현재 유효한 커피 기억이 없습니다.');
    const restoreSession = await session(base);
    assert.equal((await turn(base, restoreSession.id, '방금 잊은 커피 기억을 복원해.')).reply, 'restored');
    const restoredRecall = await session(base);
    assert.equal((await turn(base, restoredRecall.id, '내 커피 선호를 뭐라고 기억해?')).reply,
      'light roast');
    const exportSession = await session(base);
    const exportSurface = await turn(base, exportSession.id, '내 기억을 portable JSON으로 내보내.');
    assert.equal(exportSurface.reply, 'exported:2', JSON.stringify(exportSurface));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
