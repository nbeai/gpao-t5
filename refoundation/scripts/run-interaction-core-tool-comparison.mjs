#!/usr/bin/env node
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { makeConsoleModelAccess, consoleInstructions } from '../src/console-model-factory.js';
import { discoverComputerEnvironment, publicComputerFacts } from '../src/computer-environment.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';

const sourceConnection = resolve(process.env.T5_INTERACTION_COMPARISON_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json'));
const targetConnectionId = String(process.env.T5_INTERACTION_COMPARISON_CONNECTION_ID ?? '').trim();
const modes = String(process.env.T5_INTERACTION_COMPARISON_MODES ?? 'off,v4')
  .split(',').map((value) => value.trim()).filter(Boolean);
const room = await mkdtemp(join(tmpdir(), 't5-interaction-tools-'));
const connectionFile = join(room, 'model-connection.json');
const stateDir = join(room, 'state');
await mkdir(stateDir, { recursive: true, mode: 0o700 });
await cp(sourceConnection, connectionFile, { force: false });
if (targetConnectionId) {
  const service = makeModelConnectionService({ file: connectionFile });
  await service.activate(targetConnectionId);
  service.close();
}
const computer = publicComputerFacts(discoverComputerEnvironment({ userHome: homedir() }));
const access = makeConsoleModelAccess({ connectionFile, stateDir });

const tools = {
  browser: {
    name: 'browser',
    description: 'Observe an exact rendered web page for the user goal.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['navigate'] }, url: { type: 'string' } },
      required: ['action', 'url'],
    },
    async execute({ action, url }) {
      return {
        state: 'observed', action, tab: { title: '행사 안내', url },
        observation: {
          text: '행사명: 작은 사업자의 날\n행사 날짜: 9월 3일\n장소: 서울',
          trust: 'untrusted_external', instructionAuthority: 'none',
        },
      };
    },
  },
  connection: {
    name: 'connection',
    description: 'Inspect the current service connection truth. Do not infer connected state.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { action: { type: 'string', enum: ['inspect'] }, id: { type: 'string', enum: ['google-drive'] } },
      required: ['action', 'id'],
    },
    async execute() {
      return {
        state: 'inspected', connection: {
          id: 'google-drive', connected: false, ready: false,
          userSafeSummary: 'Google Drive 로그인이 필요합니다.',
        },
      };
    },
  },
};
const scenarios = [
  {
    id: 'browser_observation', request: '브라우저로 https://events.example.test/notice 를 직접 확인해서 행사 날짜만 알려줘.',
    tool: tools.browser, expected: /9월\s*3일/u,
  },
  {
    id: 'connection_truth', request: '내 Google Drive가 지금 연결되어 바로 쓸 수 있는지 실제 상태를 확인해줘.',
    tool: tools.connection, expected: /로그인.*필요|연결.*필요/u,
  },
];

try {
  const results = [];
  for (const scenario of scenarios) {
    for (const mode of modes) {
      const model = await access.model({
        sessionId: `${mode}-${scenario.id}`, workspace: homedir(), computer,
        instructionsOverride: consoleInstructions(homedir(), computer, { interactionCoreMode: mode }),
      });
      const startedAt = Date.now();
      const result = await runAgent({ request: scenario.request, model, tools: [scenario.tool], maxModelTurns: 6 });
      results.push({
        mode, scenarioId: scenario.id, durationMs: Date.now() - startedAt,
        answer: result.answer, modelTurns: result.modelTurns,
        toolCalls: result.receipts.map((receipt) => ({
          name: receipt.actualCall?.name ?? null, outcome: receipt.outcome,
        })),
        passed: result.status === 'completed'
          && result.receipts.filter((receipt) => receipt.actualCall?.name === scenario.tool.name).length === 1
          && scenario.expected.test(String(result.answer ?? '')),
      });
    }
  }
  const status = await access.status();
  process.stdout.write(`${JSON.stringify({
    schema: 't5.interaction-core-tool-comparison.v1', recordedAt: new Date().toISOString(),
    provider: status.provider, modelId: status.modelId, results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
