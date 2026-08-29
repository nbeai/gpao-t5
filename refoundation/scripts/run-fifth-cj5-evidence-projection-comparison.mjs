#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { consoleInstructions, makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const connectionId = process.env.T5_FIFTH_MODEL_CONNECTION_ID ?? 'chatgpt_oauth:gpt-5.5';
const sourceState = JSON.parse(await readFile(sourceFile, 'utf8'));
const selected = sourceState.connections.find((connection) => connection.id === connectionId);
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');
const wireContextMode = process.env.T5_FIFTH_WIRE_CONTEXT_MODE ?? 'append-continuation';
if (!['append-continuation', 'canonical-rebuild'].includes(wireContextMode)) {
  throw new Error('unsupported qualification wire context mode');
}
const room = await mkdtemp(join(tmpdir(), 't5-fifth-cj5-'));
const connectionFile = join(room, 'model-connection.json'); const stateDir = join(room, 'state');
await mkdir(stateDir, { recursive: true });
await writeFile(connectionFile, JSON.stringify({ version: sourceState.version,
  connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
await chmod(connectionFile, 0o600);
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }),
  wireContextPolicy: { [selected.provider]: wireContextMode } });
const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });

const fillers = { one: 'A'.repeat(24_000), two: 'B'.repeat(24_000) };
const markers = { one: 'CJ5-FIRST-7391', two: 'CJ5-SECOND-8520' };
const tool = {
  name: 'exec',
  description: 'Read one synthetic evidence part. For this qualification call part one exactly once, then part two exactly once, and answer with both markers.',
  parameters: { type: 'object', additionalProperties: false,
    properties: { part: { type: 'string', enum: ['one', 'two'] } }, required: ['part'] },
  async execute({ part }) {
    return { state: 'completed', stdout: `${markers[part]}\n${fillers[part]}`, stderr: '',
      truncated: false, omittedChars: 0, exitCode: 0, signal: null,
      effectObservation: { declared: { kind: 'observe', summary: `read ${part}`, targets: [part] },
        changed: false } };
  },
};

async function arm(mode) {
  const model = await access.model({ sessionId: `cj5-${mode}`, workspace, computer: {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  }, instructionsOverride: consoleInstructions(workspace, {
    platform: 'darwin', architecture: 'arm64', commandFamily: 'posix', commandProgram: '/bin/zsh',
  }) });
  const started = performance.now();
  const result = await runAgent({
    request: 'exec를 사용해 part one과 part two를 이 순서로 각각 정확히 한 번 읽고, 두 marker를 모두 써줘.',
    model, tools: [tool], currentRunEvidenceMode: mode, maxModelTurns: 6,
  });
  const calls = result.modelCalls;
  return {
    mode, passed: result.status === 'completed'
      && Object.values(markers).every((marker) => String(result.answer ?? '').includes(marker))
      && result.receipts.length === 2
      && result.receipts.map((receipt) => receipt.requestedCall.args.part).join(',') === 'one,two',
    answer: result.answer, modelCalls: result.modelTurns, toolCalls: result.receipts.length,
    tokens: calls.reduce((sum, call) => sum + Number(call.usage?.total_tokens ?? 0), 0),
    requestBytes: calls.reduce((sum, call) => sum + Number(call.contextReceipt?.requestBytes ?? 0), 0),
    canonicalFirstReceiptBytes: Buffer.byteLength(JSON.stringify(result.receipts[0])),
    wallMs: Number((performance.now() - started).toFixed(3)),
  };
}

try {
  const full = await arm('full'); const projected = await arm('settled-tool-facts-v1');
  const output = { schema: 't5.fifth-cj5-evidence-projection-comparison.v1',
    model: selected.modelId, provider: selected.provider, wireContextMode,
    actualUserData: false, externalWrites: 0,
    full, projected, delta: {
      modelCalls: projected.modelCalls - full.modelCalls,
      toolCalls: projected.toolCalls - full.toolCalls,
      tokens: projected.tokens - full.tokens,
      requestBytes: projected.requestBytes - full.requestBytes,
      wallMs: Number((projected.wallMs - full.wallMs).toFixed(3)),
    }, passed: full.passed && projected.passed };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) process.exitCode = 1;
} finally { await rm(room, { recursive: true, force: true }); }
