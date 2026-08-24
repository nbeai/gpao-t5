import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';

function extractSituation(instructions) {
  const line = String(instructions).split('\n').find((item) => item.startsWith('{"schema":"t5.resource-situation.v1"'));
  return line ? JSON.parse(line) : null;
}

test('콘솔은 자원 전환 요청에만 최신 Situation을 넣고 Conversation에는 누적하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-resource-situation-console-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const instructions = []; let request = 0;
  const model = makeOpenAIResponsesModel({
    apiKey: 'fixture-key', model: 'fixture-model', instructions: 'STABLE CONSTITUTION',
    fetchImpl: async (_url, options) => {
      request += 1; const body = JSON.parse(options.body); instructions.push(body.instructions);
      if (request === 1) return new Response(JSON.stringify({
        id: 'response-1', model: 'fixture-model', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        output: [{ type: 'function_call', call_id: 'observe-1', name: 'exec', arguments: JSON.stringify({
          command: "printf 'evidence-ok'", cwd: null,
          effect: { kind: 'observe', summary: 'fixture read', targets: [], reversible: true,
            backupAvailable: true, recipientNew: false, approvalToken: null },
        }) }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (request === 2) return new Response(JSON.stringify({
        id: 'response-2', model: 'fixture-model', usage: { input_tokens: 110, output_tokens: 10, total_tokens: 120 },
        output: [{ type: 'function_call', call_id: 'observe-2', name: 'exec', arguments: JSON.stringify({
          command: "printf 'evidence-ok'", cwd: null,
          effect: { kind: 'observe', summary: 'fixture read', targets: [], reversible: true,
            backupAvailable: true, recipientNew: false, approvalToken: null },
        }) }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({
        id: 'response-3', model: 'fixture-model', usage: { input_tokens: 120, output_tokens: 10, total_tokens: 130 },
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '관측을 마쳤습니다.' }] }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const server = makeConsoleServer({ stateDir, workspace, modelFactory: () => model,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture-model' }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const reply = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '실제로 확인해줘' }) }).then((response) => response.json());
    assert.equal(reply.reply, '관측을 마쳤습니다.');
    assert.equal(instructions.length, 3);
    assert.match(instructions[0], /^STABLE CONSTITUTION/u);
    assert.equal(extractSituation(instructions[0]), null);
    assert.equal(extractSituation(instructions[1]), null);
    const third = extractSituation(instructions[2]);
    assert.equal(third.usage.foregroundModelTurns, 2);
    assert.equal(third.usage.allObservedModelCalls, 2);
    assert.equal(third.evidence.novel, 1);
    assert.equal(third.evidence.repeated, 1);
    assert.equal(third.legacyFixedBoundaries.modelTurns.configured, 16);
    assert.equal(third.legacyFixedBoundaries.changedBySituation, false);
    const run = await server.runLedger.read(reply.runId);
    assert.equal(run.events.filter((event) => event.type === 'resource_situation_built').length, 1);
    const choice = run.events.filter((event) => event.type === 'resource_optimization_choice');
    assert.equal(choice.length, 1);
    assert.deepEqual(choice[0].payload, { turn: 3, choice: 'settle', toolCalls: 0 });
    const conversation = await server.conversationLedger.read(session.id);
    assert.doesNotMatch(JSON.stringify(conversation), /T5 CURRENT RESOURCE SITUATION|t5\.resource-situation\.v1/u);
    assert.doesNotMatch(reply.reply, /Resource|token|model turn/u);
  } finally {
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
