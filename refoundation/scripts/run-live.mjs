#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeExecTool } from '../src/exec-tool.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePromptDumper } from '../src/prompt-dump.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const apiKey = process.env.T5_REFOUNDATION_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('T5_REFOUNDATION_OPENAI_API_KEY 또는 OPENAI_API_KEY가 필요합니다.');
  process.exit(2);
}

const modelId = option('--model') ?? process.env.T5_REFOUNDATION_MODEL ?? 'gpt-5.6-terra';
const endpoint = process.env.T5_REFOUNDATION_OPENAI_ENDPOINT ?? 'https://api.openai.com/v1/responses';
const customRequest = option('--request');
const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-refoundation-live-'));
const home = join(room, 'home');
const data = join(room, 'data');
const workspace = join(room, 'workspace');
const dumpDir = join(data, 'prompt-dump');
await Promise.all([home, data, workspace].map((path) => mkdir(path, { recursive: true })));
await Promise.all([
  writeFile(join(workspace, '첫째.txt'), '13\n', 'utf8'),
  writeFile(join(workspace, '둘째.txt'), '29\n', 'utf8'),
]);

const request = customRequest ?? [
  '작업 폴더에 있는 모든 .txt 파일을 터미널로 직접 읽어 숫자 합계를 알려줘.',
  '추측하지 말고 실제 결과를 확인한 뒤 답해.',
].join(' ');

const instructions = [
  'You are T5, a capable personal agent operating an isolated computer workspace.',
  'Understand the user goal and use the available exec tool whenever computer evidence is needed.',
  'Do not ask the user to run commands that you can run.',
  'Read each tool result, and if a method fails or is insufficient, choose another method and continue.',
  'Never claim that an action ran or a result was observed unless the tool observation supports it.',
  'When the goal is satisfied, answer naturally in the user language.',
  `The isolated workspace is ${workspace}. Use cwd null for its root.`,
].join('\n');

const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = home;
try {
  const model = makeOpenAIResponsesModel({
    apiKey,
    model: modelId,
    endpoint,
    instructions,
    dump: makePromptDumper({ directory: dumpDir, sensitiveValues: [apiKey] }),
  });
  const result = await runAgent({
    request,
    model,
    tools: [makeExecTool({ workspace })],
    maxModelTurns: 12,
  });
  const fixturePassed = customRequest ? null : (
    result.status === 'completed'
    && result.receipts.some((receipt) => receipt.actualCall?.name === 'exec')
    && /(^|\D)42(\D|$)/.test(result.answer ?? '')
  );
  console.log(JSON.stringify({
    status: result.status,
    model: modelId,
    answer: result.answer,
    modelTurns: result.modelTurns,
    toolCalls: result.receipts.map((receipt) => ({
      tool: receipt.actualCall?.name ?? receipt.requestedCall?.name,
      outcome: receipt.outcome,
      command: receipt.actualCall?.args?.command ?? null,
      exitCode: receipt.result?.exitCode ?? null,
    })),
    fixturePassed,
    promptDumpDirectory: dumpDir,
    room: keep ? room : null,
  }, null, 2));
  if (fixturePassed === false || result.status !== 'completed') process.exitCode = 1;
} finally {
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
