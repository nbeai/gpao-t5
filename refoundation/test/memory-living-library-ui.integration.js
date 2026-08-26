import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { projectConversationRecordReference } from '../src/record-projection.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function post(base, path, input) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  return { status: response.status, body: await response.json() };
}

test('설정과 Living Library는 같은 temporal state에서 출처·망각·복원을 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-surface-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({ stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'test', modelId: 'test-model' }) });
  const base = await listen(server);
  try {
    const session = await server.sessionStore.create();
    await server.conversationLedger.ensure({ sessionId: session.id });
    await server.conversationLedger.appendMessage({ sessionId: session.id, messageId: 'memory-source',
      runId: 'seed', message: { role: 'user', content: '나는 산미 있는 커피를 좋아해.' } });
    const conversation = await server.conversationLedger.read(session.id);
    const sourceEvent = conversation.events.find((event) => event.messageId === 'memory-source');
    const source = projectConversationRecordReference({ event: sourceEvent,
      expectedSessionId: session.id, observedAt: sourceEvent.recordedAt,
      trust: 'user_asserted', sensitivity: 'personal', channel: 'console' });
    await server.memoryLedger.ensure();
    const memoryState = await server.memoryLedger.read();
    await server.memoryLedger.commitClaim({ claim: {
      memoryId: 'coffee-preference', kind: 'preference', subjectKey: 'coffee.preference',
      value: '산미 있는 커피', scope: { global: true, workId: null, projectId: null,
        personId: null, organizationId: null }, sources: [source], recordedAt: sourceEvent.recordedAt,
      validFrom: null, validTo: null, subjectRevision: 1,
      sourceOrder: memoryState.events.length + 1, status: 'active', supersedes: [], conflictsWith: [],
      sensitivity: 'personal', alwaysRelevant: false,
    } });

    const initial = await fetch(`${base}/memory/state`).then((response) => response.json());
    assert.equal(initial.current[0].value, '산미 있는 커피');
    assert.equal(initial.history.length, 0);
    assert.equal('events' in initial, false);

    const reopened = await post(base, '/memory/source', {
      memoryId: 'coffee-preference', recordId: source.recordId,
    });
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.source.content, '나는 산미 있는 커피를 좋아해.');
    assert.equal(reopened.body.source.digestMatched, true);

    const forgotten = await post(base, '/memory/forget', { memoryId: 'coffee-preference' });
    assert.equal(forgotten.status, 200);
    assert.equal(forgotten.body.receipt.searchHitAfter, 0);
    assert.equal(forgotten.body.receipt.contextProjectionAfter, 0);
    assert.deepEqual(forgotten.body.receipt.unknownTargets, []);
    const absent = await fetch(`${base}/memory/state`).then((response) => response.json());
    assert.equal(absent.current.length, 0);
    assert.equal(absent.history[0].status, 'retracted');
    assert.equal(absent.forgotten.length, 1);

    const restored = await post(base, '/memory/restore', {
      memoryId: 'coffee-preference', requestId: absent.forgotten[0].requestId,
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.state, 'restored');
    const active = await fetch(`${base}/memory/state`).then((response) => response.json());
    assert.equal(active.current[0].value, '산미 있는 커피');
    assert.equal(active.forgotten.length, 0);

    const built = await post(base, '/memory/library/rebuild', {});
    assert.equal(built.status, 200);
    assert.equal(built.body.canonical, false);
    assert.match(built.body.viewUrl, /^\/memory\/library\/view\/[a-f0-9]{24}\/$/u);
    const view = await fetch(`${base}${built.body.viewUrl}`);
    assert.equal(view.status, 200);
    assert.match(await view.text(), /산미 있는 커피/u);
  } finally {
    await server.closeBrowsers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('기억 설정 UI는 내부 원장 대신 출처·바로잡기·잊기·복원·기록 보기를 제공한다', async () => {
  const html = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  for (const label of ['출처 보기', '바로잡기', '잊기', '되돌리기', '기록 보기 만들기', '기록 보기 열기']) {
    assert.match(html, new RegExp(label, 'u'));
  }
  assert.doesNotMatch(html, /fetch\('\/memory\/ledger'\)/u);
  assert.match(html, /from '\/markdown\.js'/u);
  assert.match(html, /from '\/approval-state\.js'/u);
});
