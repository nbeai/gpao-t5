#!/usr/bin/env node
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { ConsoleSessionStore } from '../src/console-session-store.js';
import { ConversationLedger } from '../src/conversation-ledger.js';

const keep = process.argv.includes('--keep');
const room = await mkdtemp(join(tmpdir(), 't5-incomplete-restart-live-'));
const stateDir = join(room, 'state');
const workspace = join(room, 'workspace');
const isolatedHome = join(room, 'home');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([stateDir, workspace, isolatedHome].map((path) => mkdir(path, { recursive: true })));
const previousHome = process.env.T5_REFOUNDATION_HOME;
process.env.T5_REFOUNDATION_HOME = isolatedHome;
const sessions = new ConsoleSessionStore(stateDir);
const session = await sessions.create();
const ledger = new ConversationLedger(join(stateDir, 'conversations'));
await ledger.ensure({ sessionId: session.id });
await ledger.appendMessage({
  sessionId: session.id, messageId: 'interrupted-user', runId: 'interrupted-run',
  message: { role: 'user', content: '아주 오래 걸리는 작업을 시작해줘.' },
});
await ledger.appendMessage({
  sessionId: session.id, messageId: 'interrupted-call', runId: 'interrupted-run', turn: 1,
  message: { role: 'assistant', content: '', toolCalls: [{
    id: 'interrupted-call-id', name: 'exec',
    args: { command: 'sleep 150 && echo done', cwd: null },
  }] },
});
const access = makeConsoleModelAccess({ connectionFile, stateDir });
const server = makeConsoleServer({
  stateDir, workspace,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  computerEnvironment: discoverComputerEnvironment({ userHome: workspace }),
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const response = await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      sessionId: session.id,
      text: '새 요청이야. 이전 작업은 다시 실행하지 말고 지금 인사에만 짧게 답해: 안녕',
    }),
  });
  const surface = await response.json();
  const run = surface.runId
    ? await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json()) : null;
  const canonical = await ledger.read(session.id);
  const terminalCalls = run?.events?.filter((event) => (
    event.type === 'tool_completed'
    && ['exec', 'process_start', 'process_control', 'pty_start'].includes(
      event.payload?.receipt?.requestedCall?.name,
    )
  )).length ?? null;
  const result = {
    schema: 't5.incomplete-tool-restart-qualification.v1',
    recordedAt: new Date().toISOString(), model: (await access.status()).modelId,
    actualUserData: false, sessionId: session.id, runId: surface.runId ?? null,
    httpStatus: response.status, runStatus: run?.status ?? 'unknown',
    answer: String(surface.reply ?? ''), terminalCalls,
    canonicalToolMessages: canonical.entries.filter((entry) => entry.message.role === 'tool').length,
    syntheticCanonicalWrites: canonical.entries.filter((entry) => (
      /interrupted-tool-result/.test(entry.message.content)
    )).length,
    passed: response.ok && run?.status === 'completed'
      && Boolean(String(surface.reply ?? '').trim()) && terminalCalls === 0
      && canonical.entries.filter((entry) => entry.message.role === 'tool').length === 0,
    room: keep ? room : null,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams();
  await server.managedProcesses.stopAll('incomplete_restart_shutdown');
  await new Promise((resolve) => server.close(resolve));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (!keep) await rm(room, { recursive: true, force: true });
}
