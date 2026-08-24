#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeNotionTool } from '../src/notion-tool.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const selected = option('--model-id');
const models = selected ? [selected] : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-f-connected-hand-live-'));
const results = [];

for (const modelId of models) {
  const modelRoom = join(room, modelId.replaceAll(/[^a-z0-9.-]+/giu, '_'));
  const stateDir = join(modelRoom, 'state'); await mkdir(stateDir, { recursive: true });
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(modelRoom, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const calls = []; let pageText = '결정사항 없음';
  const runtime = {
    async listTools() { return [{
      name: 'notion-update-page', description: 'Update one exact Notion page.',
      inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false },
    }, {
      name: 'notion-fetch', description: 'Fetch one exact Notion page by id.',
      inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: false },
    }]; },
    async callTool(call) {
      calls.push(structuredClone(call));
      if (call.name === 'notion-update-page') {
        pageText = '결정사항: 금요일 재검토';
        return { isError: false, content: [{ type: 'text', text: JSON.stringify({ id: 'page-1', updated: true }) }] };
      }
      return { isError: false, content: [{ type: 'text', text: JSON.stringify({ id: 'page-1', text: pageText }) }] };
    },
  };
  const notion = makeNotionTool({ runtime, authorizeEffect: async () => ({ allowed: true }) });
  const events = []; const began = performance.now();
  try {
    const model = await access.model({ sessionId: `f-${modelId}`, workspace: modelRoom,
      computer: { platform: process.platform, architecture: process.arch } });
    const result = await runAgent({
      request: '연결된 Notion의 page-1 회의 페이지에 결정사항 “금요일 재검토”를 추가하고, 실제 반영됐는지 다시 확인한 뒤 알려줘.',
      model, tools: [notion], resourceSituationMode: 'off', activeOptimizationMode: 'off',
      onEvent: (event) => events.push(structuredClone(event)),
    });
    const toolEnds = events.filter((event) => event.type === 'tool_end');
    const verified = toolEnds.find((event) => event.receipt?.result?.state === 'notion_write_verified');
    const usage = events.filter((event) => event.type === 'model_end').reduce((sum, event) => ({
      inputTokens: sum.inputTokens + Number(event.response?.usage?.input_tokens ?? 0),
      outputTokens: sum.outputTokens + Number(event.response?.usage?.output_tokens ?? 0),
      totalTokens: sum.totalTokens + Number(event.response?.usage?.total_tokens ?? 0),
    }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    const updateCalls = calls.filter((call) => call.name === 'notion-update-page').length;
    const fetchCalls = calls.filter((call) => call.name === 'notion-fetch').length;
    const userSafe = /금요일\s*재검토/u.test(result.answer)
      && !/verified_write|read-after-write|Resource|Run|ToolReceipt/iu.test(result.answer);
    const passed = result.status === 'completed' && updateCalls === 1 && fetchCalls >= 1
      && verified?.receipt?.result?.verification?.expectedFound === true && userSafe;
    results.push({ modelId, passed, wallMs: Math.round(performance.now() - began),
      modelCalls: events.filter((event) => event.type === 'model_end').length,
      toolCalls: toolEnds.length, updateCalls, fetchCalls, usage,
      verifiedState: verified?.receipt?.result?.state ?? null, userSafe });
  } catch (error) {
    results.push({ modelId, passed: false, wallMs: Math.round(performance.now() - began),
      updateCalls: calls.filter((call) => call.name === 'notion-update-page').length,
      fetchCalls: calls.filter((call) => call.name === 'notion-fetch').length,
      failure: error?.message ?? String(error) });
  }
}

const report = { schema: 't5.s2-f-connected-hand-live.v1', recordedAt: new Date().toISOString(),
  visibleBrowserCalls: 0, results, passed: results.every((result) => result.passed) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await rm(room, { recursive: true, force: true });
if (!report.passed) process.exitCode = 1;
