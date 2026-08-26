import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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

async function sourceFor(server, sessionId, messageId, content) {
  await server.conversationLedger.appendMessage({ sessionId, messageId, runId: 'fixture',
    message: { role: 'user', content } });
  const conversation = await server.conversationLedger.read(sessionId);
  const event = conversation.events.find((item) => item.messageId === messageId);
  return projectConversationRecordReference({ event, expectedSessionId: sessionId,
    observedAt: event.recordedAt, trust: 'user_asserted', sensitivity: 'personal', channel: 'console' });
}

function claim({ memoryId, value, source, revision, sourceOrder, supersedes = [] }) {
  return { memoryId, kind: 'preference', subjectKey: 'coffee.preference.internal', value,
    scope: { global: true, workId: null, projectId: null, personId: null, organizationId: null },
    sources: [source], recordedAt: source.recordedAt, validFrom: null, validTo: null,
    subjectRevision: revision, sourceOrder, status: 'active', supersedes, conflictsWith: [],
    sensitivity: 'personal', alwaysRelevant: false };
}

test('교정·망각은 stale Living Library를 fence·purge하고 복원 뒤 현재 state만 다시 만든다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-memory-library-cascade-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const server = makeConsoleServer({ stateDir, workspace,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  const base = await listen(server);
  try {
    const session = await server.sessionStore.create();
    await server.conversationLedger.ensure({ sessionId: session.id });
    await server.memoryLedger.ensure();
    const oldSource = await sourceFor(server, session.id, 'source-old', '예전에는 산미 있는 커피를 좋아했어.');
    let state = await server.memoryLedger.read();
    await server.memoryLedger.commitClaim({ claim: claim({ memoryId: 'memory-old',
      value: 'OLD_PRIVATE_VALUE_731', source: oldSource, revision: 1,
      sourceOrder: state.events.length + 1 }) });
    const first = await post(base, '/memory/library/rebuild', {});
    assert.equal(first.status, 200);
    const firstView = await fetch(`${base}${first.body.viewUrl}`);
    assert.match(await firstView.text(), /OLD_PRIVATE_VALUE_731/u);

    const newSource = await sourceFor(server, session.id, 'source-new', '이제는 고소한 커피를 좋아해.');
    state = await server.memoryLedger.read();
    await server.memoryLedger.commitClaim({ claim: claim({ memoryId: 'memory-new',
      value: 'NEW_PRIVATE_VALUE_852', source: newSource, revision: 2,
      sourceOrder: state.events.length + 1, supersedes: ['memory-old'] }) });
    const stale = await fetch(`${base}${first.body.viewUrl}`);
    assert.ok([409, 410].includes(stale.status), `stale status=${stale.status}`);

    const second = await post(base, '/memory/library/rebuild', {});
    assert.equal(second.status, 200);
    const secondText = await fetch(`${base}${second.body.viewUrl}`).then((response) => response.text());
    assert.match(secondText, /NEW_PRIVATE_VALUE_852/u);
    for (const internal of ['coffee.preference.internal', 'rr_', 'memory-old', 'memory-new', 'source-new', 'noteId']) {
      assert.doesNotMatch(secondText, new RegExp(internal, 'u'), internal);
    }

    const forgotten = await post(base, '/memory/forget', { memoryId: 'memory-new' });
    assert.equal(forgotten.status, 200);
    assert.ok(forgotten.body.receipt.executedTargets.some((item) => item.startsWith('library_view:')),
      JSON.stringify(forgotten.body.receipt));
    assert.equal(forgotten.body.receipt.searchHitAfter, 0);
    const afterForget = await fetch(`${base}/memory/state`).then((response) => response.json());
    assert.doesNotMatch(JSON.stringify(afterForget), /NEW_PRIVATE_VALUE_852/u);
    const oldAfterForget = await fetch(`${base}${second.body.viewUrl}`);
    assert.ok([404, 409, 410].includes(oldAfterForget.status));
    const generationDir = join(stateDir, 'living-library', `generation-${second.body.generationId}`);
    await assert.rejects(stat(join(generationDir, 'index.html')), { code: 'ENOENT' });

    const tombstone = afterForget.forgotten.find((item) => item.memoryId === 'memory-new');
    const restored = await post(base, '/memory/restore', {
      memoryId: 'memory-new', requestId: tombstone.requestId,
    });
    assert.equal(restored.status, 200);
    const third = await post(base, '/memory/library/rebuild', {});
    const restoredText = await fetch(`${base}${third.body.viewUrl}`).then((response) => response.text());
    assert.match(restoredText, /NEW_PRIVATE_VALUE_852/u);
    assert.doesNotMatch(restoredText, /rr_|coffee\.preference\.internal/u);
    const manifest = JSON.parse(await readFile(join(stateDir, 'living-library',
      `generation-${third.body.generationId}`, 'manifest.json'), 'utf8'));
    assert.equal('memoryIds' in manifest, false);
    assert.ok(Array.isArray(manifest.memoryHandles));
  } finally {
    await server.closeBrowsers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
