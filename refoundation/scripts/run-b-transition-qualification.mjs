#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';

const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const models = ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const phrases = {
  steer: ['그건 PDF만 봐.', '지금 범위를 PDF 파일로만 바꿔줘.'],
  followup: ['끝나면 표로도 정리해줘.', '현재 결과를 먼저 마치고 그 다음에 표를 만들어줘.'],
  cancel: ['그건 멈춰.', '지금 하던 일은 중단해줘.'],
};
const room = await mkdtemp(join(tmpdir(), 't5-b-transition-live-'));
const results = [];

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

for (const modelId of models) {
  const modelRoom = join(room, modelId.replaceAll(/[^a-z0-9.-]+/giu, '_'));
  const stateDir = join(modelRoom, 'state'); const workspace = join(modelRoom, 'workspace');
  await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(modelRoom, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile, stateDir }); const scenarios = new Map();
  const server = makeConsoleServer({ stateDir, workspace, modelStatus: () => access.status(),
    modelFactory: async (context) => {
      const scenario = scenarios.get(context.sessionId);
      if (!scenario || scenario.initialModelCreated) return {
        async respond() { return { text: '현재 결과를 정리했습니다.', toolCalls: [] }; },
      };
      scenario.initialModelCreated = true; const actual = await access.model(context); let call = 0;
      return { async respond(input) {
        call += 1;
        if (call === 1) { scenario.started(); await scenario.gate; return { text: '현재 결과', toolCalls: [] }; }
        if (call === 2) return actual.respond(input);
        return { text: '사용자 변경을 반영했습니다.', toolCalls: [] };
      } };
    } });
  const base = await listen(server);
  try {
    for (const [expected, variants] of Object.entries(phrases)) for (const phrase of variants) {
      for (let repeat = 1; repeat <= 2; repeat += 1) {
        const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
        let started; const startedPromise = new Promise((resolveStarted) => { started = resolveStarted; });
        let release; const gate = new Promise((resolveGate) => { release = resolveGate; });
        scenarios.set(session.id, { started, gate, initialModelCreated: false });
        const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, text: '여러 자료를 검토해서 결과를 만들어줘.' }),
        }).then((response) => response.json());
        const stream = fetch(`${base}/turn/stream?streamId=${first.streamId}`).then((response) => response.text());
        await startedPromise; const began = performance.now();
        const admittedResponse = await fetch(`${base}/turn/stream-start`, { method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, text: phrase }),
        });
        const admitted = await admittedResponse.json(); release(); await stream;
        let input = null;
        for (let attempt = 0; attempt < 200; attempt += 1) {
          input = (await server.workStore.read()).inputs.find((item) => item.inputId === admitted.inputId);
          if (input?.relation) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 20));
        }
        const wallMs = performance.now() - began;
        const state = await server.workStore.read();
        const transitionEvents = state.events.filter((event) => event.type === 'input_classified'
          && event.inputId === admitted.inputId);
        const runs = await server.runLedger.list({ sessionId: session.id });
        const classificationRun = runs.find((run) => run.events.some((event) => (
          event.type === 'tool_started' && event.payload?.name === 'work_transition'
        ))) ?? null;
        const modelEvents = classificationRun?.events.filter((event) => event.type === 'model_completed') ?? [];
        const toolEvents = classificationRun?.events.filter((event) => event.type === 'tool_completed') ?? [];
        const usage = modelEvents.reduce((sum, event) => ({
          inputTokens: sum.inputTokens + Number(event.payload?.response?.usage?.input_tokens ?? 0),
          outputTokens: sum.outputTokens + Number(event.payload?.response?.usage?.output_tokens ?? 0),
          totalTokens: sum.totalTokens + Number(event.payload?.response?.usage?.total_tokens ?? 0),
        }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
        results.push({ modelId, expected, phrase, repeat, httpStatus: admittedResponse.status,
          actual: input?.relation ?? null, inputState: input?.state ?? null,
          classifications: transitionEvents.length, wallMs: Number(wallMs.toFixed(3)),
          modelCalls: modelEvents.length, toolCalls: toolEvents.length, usage,
          passed: admittedResponse.status === 202 && input?.relation === expected && transitionEvents.length === 1 });
      }
    }
  } finally {
    await server.closeMessengers(); server.closeWakeStreams(); await server.closeBrowsers();
    await server.managedProcesses.stopAll('qualification_finished');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}

const report = { schema: 't5.s2-b-transition-live.v1', recordedAt: new Date().toISOString(),
  results, passed: results.every((item) => item.passed), total: results.length,
  totals: results.reduce((sum, item) => ({ modelCalls: sum.modelCalls + item.modelCalls,
    toolCalls: sum.toolCalls + item.toolCalls, inputTokens: sum.inputTokens + item.usage.inputTokens,
    outputTokens: sum.outputTokens + item.usage.outputTokens,
    totalTokens: sum.totalTokens + item.usage.totalTokens,
    wallMs: sum.wallMs + item.wallMs }),
  { modelCalls: 0, toolCalls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, wallMs: 0 }),
  byModel: Object.fromEntries(models.map((modelId) => [modelId, {
    passed: results.filter((item) => item.modelId === modelId && item.passed).length,
    total: results.filter((item) => item.modelId === modelId).length,
  }])) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await rm(room, { recursive: true, force: true });
if (!report.passed) process.exitCode = 1;
