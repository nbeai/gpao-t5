#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(option('--port') ?? process.env.T5_REFOUNDATION_CONSOLE_PORT ?? 4174);
const stateDir = resolve(process.env.T5_REFOUNDATION_CONSOLE_STATE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'refoundation-console'));
const workspace = resolveConsoleWorkspace(process.env, homedir());
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);

const access = makeConsoleModelAccess({ connectionFile, stateDir });
const server = makeConsoleServer({
  stateDir,
  workspace,
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
  onError: (error) => console.error('[refoundation-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});
const url = `http://127.0.0.1:${server.address().port}`;
console.log(`T5 재창립 콘솔 준비됨 → ${url}`);
console.log(`작업 공간 → ${workspace}`);

if (!process.argv.includes('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

const stop = () => server.close(() => process.exit(0));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
