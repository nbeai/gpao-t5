#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';
import {
  DEFAULT_AGENT_BROWSER_BINARY, makeAgentBrowserDriver, sessionNameForOwner,
} from '../src/agent-browser-driver.js';
import { makeConsoleServer } from '../src/console-server.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makePersistentBrowserHost } from '../src/persistent-browser-host.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(option('--port') ?? process.env.T5_REFOUNDATION_CONSOLE_PORT ?? 4174);
const stateDir = resolve(process.env.T5_REFOUNDATION_CONSOLE_STATE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'refoundation-console'));
const workspace = resolveConsoleWorkspace(process.env, homedir());
const computerEnvironment = discoverComputerEnvironment({ userHome: homedir() });
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const portFile = process.env.T5_REFOUNDATION_PORT_FILE
  ? resolve(process.env.T5_REFOUNDATION_PORT_FILE) : null;
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);

const access = makeConsoleModelAccess({ connectionFile, stateDir });
const modelConnections = makeModelConnectionService({ file: connectionFile });
const credentialCatalog = makeStoredModelCredentialCatalog({ file: connectionFile });
const webSearchProviders = [makeStoredOpenAIWebSearchProvider({ credentialCatalog })];
const browserRoot = join(stateDir, 'browser');
const persistentBrowserHost = makePersistentBrowserHost({
  root: browserRoot, binary: DEFAULT_AGENT_BROWSER_BINARY,
});
const server = makeConsoleServer({
  stateDir,
  workspace,
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
  modelConnections,
  computerEnvironment,
  webSearchProviders,
  webReadOptions: { urlResolvers: [naverReadableUrlResolver] },
  browserDriverFactory: (sessionId) => makeAgentBrowserDriver({
    ownerId: sessionId,
    outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts'),
    browserHost: persistentBrowserHost,
  }),
  browserHost: persistentBrowserHost,
  onError: (error) => console.error('[refoundation-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});
const url = `http://127.0.0.1:${server.address().port}`;
if (portFile) {
  await mkdir(resolve(portFile, '..'), { recursive: true, mode: 0o700 });
  const temporary = `${portFile}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ port: server.address().port, pid: process.pid })}\n`, {
    encoding: 'utf8', mode: 0o600,
  });
  await chmod(temporary, 0o600);
  await rename(temporary, portFile);
}
console.log(`T5 재창립 콘솔 준비됨 → ${url}`);
console.log(`작업 공간 → ${workspace}`);

if (!process.argv.includes('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

const stop = async () => {
  server.closeWakeStreams();
  server.closeModelConnections();
  await server.closeMessengers();
  await server.closeBrowsers();
  await persistentBrowserHost.close().catch(() => {});
  await server.managedProcesses.stopAll('runtime_shutdown');
  server.close(async () => {
    if (portFile) await rm(portFile, { force: true }).catch(() => {});
    process.exit(0);
  });
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
