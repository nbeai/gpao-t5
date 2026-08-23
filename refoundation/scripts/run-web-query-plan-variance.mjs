#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { queryPlanAgreement } from '../src/web-variance-analysis.js';
import { makeWebResearchTool } from '../src/web-research-tool.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const datasetPath = option('--dataset') ? resolve(option('--dataset')) : null;
const repeatCount = Number(option('--repeats') ?? 3);
const requestedModelId = option('--model-id');
if (!datasetPath) throw new TypeError('--dataset is required');
if (!Number.isInteger(repeatCount) || repeatCount < 2 || repeatCount > 5) throw new TypeError('--repeats must be 2 to 5');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-w9-query-plan-'));
const dataset = (await readFile(datasetPath, 'utf8')).trim().split(/\n/u).map(JSON.parse);
const probes = JSON.parse(await readFile(new URL('../config/w9-web-variance-probes.json', import.meta.url), 'utf8'));
const modelIds = requestedModelId ? [requestedModelId]
  : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const tool = makeWebResearchTool({ searchTool: { execute() {} }, readTool: { execute() {} } });
const definition = { name: tool.name, description: tool.description, parameters: tool.parameters };

async function privateConnection(modelId) {
  const stored = JSON.parse(await readFile(connectionFile, 'utf8')); stored.activeId = modelId;
  const path = join(room, `${modelId.replace(/[^a-z0-9.-]+/giu, '-')}.json`);
  await writeFile(path, JSON.stringify(stored), { mode: 0o600 }); return path;
}

const results = [];
try {
  for (const modelId of modelIds) {
    const privateFile = await privateConnection(modelId);
    const stateDir = join(room, modelId.split(':').at(-1)); const workspace = join(stateDir, 'workspace');
    await mkdir(workspace, { recursive: true });
    const access = makeConsoleModelAccess({ connectionFile: privateFile, stateDir: join(stateDir, 'model') });
    const tasks = [];
    for (const probe of probes.tasks.filter((task) => task.source.index != null)) {
      const problem = dataset[probe.source.index]?.problem;
      if (!problem) throw new Error(`missing dataset problem ${probe.source.index}`);
      const plans = [];
      for (let repeat = 1; repeat <= repeatCount; repeat += 1) {
        process.stderr.write(`[w9-plan] ${modelId} ${probe.id} ${repeat}/${repeatCount}\n`);
        const model = await access.model({ sessionId: `${probe.id}-${repeat}`, workspace, computer: {} });
        const response = await model.respond({ messages: [{ role: 'user', content: problem }], tools: [definition] });
        const call = response.toolCalls?.find((item) => item.name === 'web_research') ?? null;
        const queries = call ? [...new Set((call.args?.queries?.length ? call.args.queries : [call.args?.query])
          .map((value) => String(value ?? '').trim()).filter(Boolean))] : [];
        plans.push({ repeat, called: Boolean(call), provider: call?.args?.provider ?? null,
          query: call?.args?.query ?? null, queries, sourceLimit: call?.args?.sourceLimit ?? null });
      }
      tasks.push({ id: probe.id, plans, agreement: queryPlanAgreement(plans) });
    }
    results.push({ modelId, tasks });
  }
  process.stdout.write(`${JSON.stringify({
    schema: 't5.w9-web-query-plan-variance.v1', recordedAt: new Date().toISOString(), repeatCount, results,
  }, null, 2)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
