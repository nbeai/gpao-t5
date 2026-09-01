import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { makeConsoleServer } from '../src/console-server.js';

test('Console selection open→Tool 0 stream은 main transcript·Work를 바꾸지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-selection-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace, { recursive: true });
  const calls = [];
  const server = makeConsoleServer({ stateDir, workspace,
    modelFactory: ({ purpose }) => ({ async respond(input) {
      calls.push({ purpose, tools: structuredClone(input.tools), messages: structuredClone(input.messages) });
      return { text: purpose === 'selection_exploration'
        ? '선택한 15,500원은 검증된 차액입니다.' : '정산 결과는 **15,500원 차이**입니다.', toolCalls: [] };
    } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '정산 결과 알려줘' }) }).then((response) => response.json());
    const surface = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
    const assistant = surface.transcript.find((entry) => entry.role === 'assistant');
    assert.match(assistant.result.reply, /15,500원/u); assert.ok(assistant.selection?.messageHandle);
    const visible = '정산 결과는 15,500원 차이입니다.'; const startUtf16 = visible.indexOf('15,500원');
    const opened = await fetch(`${base}/selection-explorations`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
        messageHandle: assistant.selection.messageHandle,
        projectionVersion: assistant.selection.projectionVersion,
        projectionDigest: assistant.selection.projectionDigest,
        startUtf16, endUtf16: startUtf16 + '15,500원 차이'.length, requestId: 'open-1' })
    }).then((response) => response.json());
    assert.equal(opened.anchor.quote, '15,500원 차이');
    const beforeWork = await server.workStore.read();
    const started = await fetch(`${base}/selection-explorations/stream-start`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id,
        handle: opened.handle, question: '이 금액은 무슨 뜻이야?', requestId: 'answer-1' })
    }).then((response) => response.json());
    const stream = await fetch(`${base}/selection-explorations/stream?streamId=${started.streamId}`)
      .then((response) => response.text());
    assert.match(stream, /event: complete/u); assert.match(stream, /"state":"completed"/u);
    assert.deepEqual(await server.workStore.read(), beforeWork);
    const ledger = new ConversationLedger(join(stateDir, 'conversations'));
    const after = await ledger.read(session.id);
    assert.equal(after.entries.length, 2); assert.equal(after.explorations.length, 1);
    assert.deepEqual(after.explorations[0].messages.map((item) => item.role), ['user', 'assistant']);
    assert.equal(calls.at(-1).purpose, 'selection_exploration'); assert.deepEqual(calls.at(-1).tools, []);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});
