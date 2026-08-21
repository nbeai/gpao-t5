#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';
import { makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { makeConsoleServer } from '../src/console-server.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import {
  googleSyncAvailable, workspaceConnectionBaselineInspectors,
} from '../src/workspace-connection-baseline.js';
import { WorkspaceCredentialStore } from '../src/workspace-credential-store.js';
import { makeGoogleDriveConnection } from '../src/google-drive-connection.js';
import { makeGoogleDriveDesktop } from '../src/google-drive-desktop.js';
import { makeGoogleDriveApi } from '../src/google-drive-api.js';
import { makeGoogleDriveTool } from '../src/google-drive-tool.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeNotionMcpConnection } from '../src/notion-mcp-connection.js';
import { makeNotionCliInspector } from '../src/notion-cli-inspector.js';
import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function bundledGoogleOAuthConfig() {
  try {
    const config = JSON.parse(await readFile(new URL('../config/google-oauth.json', import.meta.url), 'utf8'));
    if (config?.schema !== 't5.google-oauth-client.v1'
      || !/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/u.test(config.clientId ?? '')) {
      throw new Error('bundled Google OAuth client config is invalid');
    }
    return config;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
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
const webSearchProviders = [
  makeStoredOpenAIWebSearchProvider({ credentialCatalog }),
  makeNaverSearchProvider(),
  makeDuckDuckGoSearchProvider(),
  makeBingSearchProvider(),
];
const workspaceCredentialStore = new WorkspaceCredentialStore(join(stateDir, 'connections'));
const bundledGoogleOAuth = await bundledGoogleOAuthConfig();
const googleOAuthClientId = process.env.T5_GOOGLE_OAUTH_CLIENT_ID
  ?? (bundledGoogleOAuth?.officialApiEnabled ? bundledGoogleOAuth.clientId : null);
const googleDriveDesktop = makeGoogleDriveDesktop({
  userHome: computerEnvironment.userHome, platform: computerEnvironment.platform,
});
const googleDriveConnection = makeGoogleDriveConnection({
  store: workspaceCredentialStore,
  clientId: googleOAuthClientId,
  browserAvailable: false,
  desktopRoute: googleDriveDesktop,
  localSyncAvailable: () => googleSyncAvailable(
    computerEnvironment.userHome, computerEnvironment.platform,
  ),
});
const googleDriveApi = makeGoogleDriveApi({ credential: () => googleDriveConnection.credential() });
const googleDriveService = {
  ...googleDriveConnection,
  toolName: 'google_drive',
  async makeTool({ attachments, sessionId, authorizeEffect, authorizeUploadPath }) {
    if ((await googleDriveConnection.inspect()).state !== 'connected') return null;
    return makeGoogleDriveTool({
      api: googleDriveApi, attachments, sessionId, authorizeEffect, authorizeUploadPath,
    });
  },
};
const platformSecretStore = makePlatformSecretStore({ platform: computerEnvironment.platform });
const notionConnection = makeNotionMcpConnection({
  secretStore: platformSecretStore,
  browserAvailable: true,
  cliInspect: makeNotionCliInspector(),
});
const linearConnection = makeRemoteMcpConnection({
  id: 'linear', label: 'Linear', serverUrl: 'https://mcp.linear.app/mcp',
  resource: 'https://mcp.linear.app/mcp', secretStore: platformSecretStore,
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
  videoTextFetchImpl: globalThis.fetch,
  browserDriverFactory: (sessionId) => makeAgentBrowserDriver({
    ownerId: sessionId,
    outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts'),
  }),
  workspaceConnectionInspectors: workspaceConnectionBaselineInspectors({
    userHome: computerEnvironment.userHome,
    platform: computerEnvironment.platform,
    browserAvailable: true,
    includeGoogle: false,
    includeNotion: false,
  }),
  workspaceConnectionServices: [googleDriveService, notionConnection, linearConnection],
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
await server.startAutomations();

if (!process.argv.includes('--no-open')) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
}

let stopping = false;
async function boundedShutdown(work, timeoutMs = 2_500) {
  let timer;
  await Promise.race([
    Promise.resolve().then(work).catch(() => {}),
    new Promise((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.closeWakeStreams();
  server.closeModelConnections();
  await Promise.all([
    boundedShutdown(() => server.closeMessengers()),
    boundedShutdown(() => server.closeBrowsers()),
    boundedShutdown(() => server.closeWorkspaceConnections()),
    boundedShutdown(() => server.closeAutomations()),
    boundedShutdown(() => server.managedProcesses.stopAll('runtime_shutdown')),
  ]);
  await boundedShutdown(() => new Promise((resolveClose) => {
    server.close(resolveClose);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }), 1_000);
  if (portFile) await rm(portFile, { force: true }).catch(() => {});
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
