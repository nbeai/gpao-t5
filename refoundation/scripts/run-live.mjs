#!/usr/bin/env node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeExecTool } from '../src/exec-tool.js';
import { makeOpenAIResponsesModel } from '../src/openai-responses-model.js';
import { makePromptDumper } from '../src/prompt-dump.js';
import {
  makeStoredChatGptCredentialSource, makeStoredModelCredentialCatalog,
} from '../src/chatgpt-oauth-credential.js';
import { makeChatGptResponsesModel } from '../src/chatgpt-responses-model.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const authMode = option('--auth') ?? process.env.T5_REFOUNDATION_AUTH ?? 'console';
const modelOverride = option('--model') ?? process.env.T5_REFOUNDATION_MODEL;
const customRequest = option('--request');
const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-refoundation-live-'));
const home = join(room, 'home');
const data = join(room, 'data');
const workspace = join(room, 'workspace');
const dumpDir = join(data, 'prompt-dump');
const responseDumpDir = join(data, 'response-dump');
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
  let model;
  let modelId;
  let selectedAuth;
  if (authMode === 'console') {
    const file = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
      ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
    const selected = await makeStoredModelCredentialCatalog({ file }).select(option('--connection'));
    selectedAuth = selected.kind;
    modelId = modelOverride ?? selected.modelId;
    if (selected.kind === 'chatgpt_oauth') {
      const responseDumper = makePromptDumper({ directory: responseDumpDir });
      model = makeChatGptResponsesModel({
        credentials: makeStoredChatGptCredentialSource({ file }),
        model: modelId,
        endpoint: process.env.T5_REFOUNDATION_CHATGPT_ENDPOINT,
        instructions,
        dump: makePromptDumper({ directory: dumpDir }),
        observeResponse: ({ status, raw }) => responseDumper({
          body: { raw }, meta: { provider: 'chatgpt_oauth', status },
        }),
      });
    } else if (selected.kind === 'api_key') {
      const base = String(selected.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
      model = makeOpenAIResponsesModel({
        apiKey: selected.apiKey,
        model: modelId,
        endpoint: process.env.T5_REFOUNDATION_OPENAI_ENDPOINT ?? `${base}/responses`,
        instructions,
        dump: makePromptDumper({ directory: dumpDir, sensitiveValues: [selected.apiKey] }),
      });
    }
  } else if (authMode === 'api-key') {
    const apiKey = process.env.T5_REFOUNDATION_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('콘솔 연결 또는 보호된 API 키 입력이 필요합니다.');
    selectedAuth = 'api_key';
    modelId = modelOverride ?? 'gpt-5.6-terra';
    model = makeOpenAIResponsesModel({
      apiKey,
      model: modelId,
      endpoint: process.env.T5_REFOUNDATION_OPENAI_ENDPOINT,
      instructions,
      dump: makePromptDumper({ directory: dumpDir, sensitiveValues: [apiKey] }),
    });
  } else {
    throw new Error(`지원하지 않는 인증 방식: ${authMode}`);
  }
  if (!model) throw new Error('사용할 모델 연결을 만들지 못했습니다.');
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
    auth: selectedAuth,
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
    responseDumpDirectory: selectedAuth === 'chatgpt_oauth' ? responseDumpDir : null,
    room: keep ? room : null,
  }, null, 2));
  if (fixturePassed === false || result.status !== 'completed') process.exitCode = 1;
} finally {
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
