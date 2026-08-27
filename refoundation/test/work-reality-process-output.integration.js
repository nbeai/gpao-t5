import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('foreground exec의 첫 output delta는 완료 전 content-free meaningful milestone이 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-work-reality-output-')); const workspace = join(room, 'workspace');
  await mkdir(workspace); let turn = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelFactory: () => ({ async respond() {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 'long-read', name: 'exec', args: {
        command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
          "process.stdout.write('PRIVATE-STEP-1\\n');setTimeout(()=>process.stdout.write('PRIVATE-DONE\\n'),700)")}`,
        cwd: null, effect: { kind: 'observe', targets: [], confirmation: 'not_applicable',
          rollbackOfToolCallId: null },
      } }] };
      return { text: '확인을 마쳤어요.', toolCalls: [] };
    } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const start = await fetch(`${base}/turn/stream-start`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '긴 확인 작업을 해줘' }) }).then((response) => response.json());
    const response = await fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${start.streamId}`);
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let eventText = '';
    const stream = (async () => { while (true) { const part = await reader.read(); if (part.done) break;
      eventText += decoder.decode(part.value, { stream: true }); } })();
    for (let attempt = 0; attempt < 50 && !eventText.includes('컴퓨터 작업에서 새 진행 내용을 확인했어요.'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await stream;
    const runs = await fetch(`${base}/runs?sessionId=${session.id}`).then((response) => response.json());
    const run = await fetch(`${base}/runs/${runs.runs[0].runId}`).then((response) => response.json());
    const activity = run.events.filter((event) => event.type === 'process_output_observed');
    assert.equal(activity.length, 1, JSON.stringify(run.events.map((event) => event.type)));
    assert.match(eventText, /컴퓨터 작업에서 새 진행 내용을 확인했어요/u);
    assert.doesNotMatch(eventText, /PRIVATE-STEP|PRIVATE-DONE|command|\/private\//u);
    assert.equal(activity[0].payload.deltaChars > 0, true);
    assert.ok(activity[0].sequence < run.events.find((event) => event.type === 'tool_completed').sequence);
    assert.equal('text' in activity[0].payload, false); assert.equal('command' in activity[0].payload, false);
  } finally {
    await server.managedProcesses.stopAll('test_cleanup'); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
