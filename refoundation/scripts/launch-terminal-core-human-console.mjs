#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import {
  makeStoredModelCredentialCatalog, migrateStoredModelCredentials,
} from '../src/chatgpt-oauth-credential.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { findExecutable, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeConsoleServer } from '../src/console-server.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { materializeTerminalPerformanceCase, TERMINAL_PERFORMANCE_CASES } from '../src/terminal-performance.js';

if (!process.argv.includes('--human-controlled')) throw new Error('--human-controlled is required');
const option = (name) => {
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined;
};
const connectionFile = resolve(option('--connection-file')
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const root = await mkdtemp(join(tmpdir(), 't5-terminal-core-human-'));
const stateDir = join(root, 'state'); const workspace = join(root, 'workspace');
await Promise.all([mkdir(stateDir, { mode: 0o700 }), mkdir(workspace, { mode: 0o700 })]);

const scale = TERMINAL_PERFORMANCE_CASES.find((item) => item.id === 'scale-aggregate');
await materializeTerminalPerformanceCase(scale, join(workspace, '01-bulk'));
await Promise.all(['02-managed', '03-tty', '04-large'].map((name) => mkdir(join(workspace, name))));
await writeFile(join(workspace, '02-managed', 'server.mjs'), [
  "import {createServer} from 'node:http';",
  "const s=createServer((q,r)=>{r.end(q.url==='/health'?'HEALTHY-4821\\n':'NOT-FOUND\\n')});",
  "s.listen(0,'127.0.0.1',()=>process.stdout.write(`READY ${s.address().port}\\n`));",
  "const x=()=>s.close(()=>process.exit(0));process.on('SIGTERM',x);process.on('SIGINT',x);",
].join('\n'), { mode: 0o600 });
await writeFile(join(workspace, '03-tty', 'prompt.mjs'), [
  "if(!process.stdin.isTTY||!process.stdout.isTTY){process.stderr.write('TTY_REQUIRED\\n');process.exit(73)}",
  "process.stdout.write('거래 확인 코드를 입력하세요: ');process.stdin.setEncoding('utf8');",
  "process.stdin.once('data',v=>{const c=v.trim();process.stdout.write(c==='은하-4821'?'TTY_ACCEPTED 은하-4821\\n':`TTY_REJECTED ${c}\\n`);process.exit(c==='은하-4821'?0:74)});",
].join('\n'), { mode: 0o600 });
await writeFile(join(workspace, '04-large', 'output.mjs'),
  "process.stdout.write(`BEGIN\\n${'앞'.repeat(40000)}\\n정확한-중간-표식: 파랑새-7391\\n${'뒤'.repeat(40000)}\\nEND\\n`);\n", { mode: 0o600 });

const computer = discoverComputerEnvironment({ userHome: homedir() });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home: homedir() });
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const secretStore = makePlatformSecretStore({ platform: computer.platform });
await migrateStoredModelCredentials({ file: connectionFile, secretStore });
const selectedCredential = await makeStoredModelCredentialCatalog({
  file: connectionFile, secretStore,
}).select();
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
const initialModel = await access.status();
if (!initialModel.connected) throw new Error('verified T5 model connection is required');
const server = makeConsoleServer({
  stateDir, workspace, computerEnvironment: computer, terminalEnvironment,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  modelConnections: makeModelConnectionService({ file: connectionFile, secretStore }),
  learningReviewMode: 'off',
  // This local file store is intentionally empty: real Telegram credentials are never opened here.
  messengerCredentialStore: new MessengerCredentialStore(join(stateDir, 'messenger-credentials')),
  terminalPlatformAdapter: await makeTerminalPlatformAdapter({
    platform: computer.platform,
    protectedReadRoots: [dirname(connectionFile), join(stateDir, 'connections'),
      join(homedir(), 'Library', 'Keychains')],
    protectedExecutableNames: githubCli ? ['gh'] : [],
  }),
  terminalCredentialBroker: makeTerminalCredentialBroker({
    registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
  }),
  onError: (error) => console.error('[terminal-human-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject); server.listen(Number(option('--port') ?? 0), '127.0.0.1', resolveListen);
});
const url = `http://127.0.0.1:${server.address().port}`;
console.log(JSON.stringify({ url, root, workspace,
  model: { connected: initialModel.connected, provider: initialModel.provider,
    modelId: initialModel.modelId, credentialReady: Boolean(selectedCredential.kind) } }, null, 2));
if (!process.argv.includes('--no-open') && process.platform === 'darwin') {
  spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
}
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('human_console_shutdown').catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose)); process.exit(0);
};
process.once('SIGINT', stop); process.once('SIGTERM', stop);
