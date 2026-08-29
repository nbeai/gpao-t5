#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { findExecutable, githubCliCredentialRoots, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const option = (name) => { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; };
const root = await realpath(resolve(option('--root') ?? ''));
if (!root) throw new TypeError('--root is required');
const home = join(root, 'home'); const stateDir = join(root, 'state'); const workspace = join(root, 'workspace');
const control = join(root, 'control'); await Promise.all([home, stateDir, workspace, control]
  .map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = stored.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? stored.connections?.find((item) => item.id === stored.activeId);
if (!selected) throw new Error('qualified gpt-5.5 connection is unavailable');
const connectionFile = join(control, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ ...stored, activeId: selected.id, connections: [selected] }), { mode: 0o600 });
process.env.T5_REFOUNDATION_HOME = home; process.env.T5_REFOUNDATION_WORKSPACE = workspace;
const computer = discoverComputerEnvironment({ userHome: home });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
const secretStore = makePlatformSecretStore({ platform: computer.platform });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
const catalog = makeStoredModelCredentialCatalog({ file: connectionFile, secretStore });
const status = await access.status(); if (!status.connected || status.modelId !== 'gpt-5.5') throw new Error('gpt-5.5 is not active');
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const cloudflaredCli = await findExecutable('cloudflared', terminalEnvironment.PATH ?? '');
const adapter = await makeTerminalPlatformAdapter({ platform: computer.platform, managedWorkspace: workspace,
  protectedReadRoots: [dirname(sourceConnectionFile), control, join(stateDir, 'connections'),
    join(homedir(), 'Library', 'Keychains'),
    ...githubCliCredentialRoots({ platform: computer.platform, home: homedir(), env: process.env })],
  protectedExecutableNames: [githubCli ? 'gh' : null, cloudflaredCli ? 'cloudflared' : null].filter(Boolean) });
const broker = makeTerminalCredentialBroker({ registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
  generalTerminalIsolationQualified: adapter.qualified === true });
const server = makeConsoleServer({ stateDir, workspace, computerEnvironment: computer, terminalEnvironment,
  computerFileRoots: [workspace, home], restrictFileRealityToComputerRoots: true,
  terminalPlatformAdapter: adapter, terminalCredentialBroker: broker,
  modelFactory: (context) => access.model(context), modelStatus: () => access.status(),
  browserDriverFactory: (sessionId) => makeAgentBrowserDriver({ ownerId: sessionId,
    outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts') }),
  quickPreviewProgram: cloudflaredCli, webReadOptions: { allowPrivateUrls: true },
  messengerCredentialStore: new MessengerCredentialStore(join(stateDir, 'messenger-hq-empty')),
  workspaceConnectionInspectors: [], workspaceConnectionServices: [], learningReviewMode: 'off',
  onError: (error) => console.error('[s4-hq-console]', error?.message ?? error) });
await new Promise((resolveListen, reject) => { server.once('error', reject);
  server.listen(Number(option('--port') ?? 0), '127.0.0.1', resolveListen); });
let sourceCommit = 'unknown'; try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}
const url = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(control, 'hq-runtime.json'), `${JSON.stringify({ sourceCommit, url, workspace, stateDir,
  model: status.modelId, messengerCredentialsLoaded: 0, connectorServicesLoaded: 0,
  cloudflaredInstalled: Boolean(cloudflaredCli) }, null, 2)}\n`, { mode: 0o600 });
console.log(`T5 S4-HQ Console → ${url}`); console.log(`workspace → ${workspace}`);
const shutdown = async () => { server.closeWakeStreams(); server.closeModelConnections(); await server.closeCommandExplainer();
  await server.closeMessengers(); await server.closeBrowsers(); await server.managedProcesses.stopAll('s4_hq_shutdown');
  await new Promise((done) => server.close(done)); };
process.once('SIGINT', () => shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => shutdown().finally(() => process.exit(0)));
