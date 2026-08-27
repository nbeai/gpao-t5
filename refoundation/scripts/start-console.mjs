#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access as accessFile, chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import {
  makeStoredModelCredentialCatalog, migrateStoredModelCredentials,
} from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';
import { makeConsoleServer } from '../src/console-server.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { findExecutable, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import {
  MessengerPlatformCredentialStore, migrateMessengerCredentials,
} from '../src/messenger-platform-credential-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import { makeNotionMcpConnection } from '../src/notion-mcp-connection.js';
import { makeNotionCliInspector } from '../src/notion-cli-inspector.js';
import { makeRemoteMcpConnection } from '../src/remote-mcp-connection.js';
import { makeChannelTalkConnection } from '../src/channel-talk-connection.js';
import { makeSlackMcpConnection } from '../src/slack-mcp-connection.js';
import { ConnectionStateStore } from '../src/connection-state-store.js';
import { ConnectionCredentialCoordinator } from '../src/connection-credential-coordinator.js';
import { ScopedFileActivityLedger } from '../src/scoped-file-activity-ledger.js';
import { makeScopedFileActivityService } from '../src/scoped-file-activity-service.js';
import { makeMacOSFSEventsAdapter } from '../src/file-activity-platform-adapters.js';
import { makeNativeFolderSelector } from '../src/native-folder-selector.js';
import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';
import { makeMacOSCoarseAppAdapter } from '../src/coarse-app-activity-platform-adapters.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(option('--port') ?? process.env.T5_REFOUNDATION_CONSOLE_PORT ?? 4174);
const stateDir = resolve(process.env.T5_REFOUNDATION_CONSOLE_STATE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'refoundation-console'));
const workspace = resolveConsoleWorkspace(process.env, homedir());
const computerEnvironment = discoverComputerEnvironment({ userHome: homedir() });
const terminalEnvironment = await resolveTerminalShellEnvironment({
  computer: computerEnvironment, home: homedir(),
});
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
  platform: computerEnvironment.platform,
  protectedReadRoots: [
    dirname(connectionFile),
    join(stateDir, 'connections'),
    join(homedir(), 'Library', 'Keychains'),
    join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials'),
  ],
  protectedExecutableNames: githubCli ? ['gh'] : [],
});
const terminalCredentialBroker = makeTerminalCredentialBroker({
  registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
});
const portFile = process.env.T5_REFOUNDATION_PORT_FILE
  ? resolve(process.env.T5_REFOUNDATION_PORT_FILE) : null;
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);

const fileActivityLedger = new ScopedFileActivityLedger(join(stateDir, 'file-activity'));
const packagedFileActivityHelper = process.platform === 'darwin'
  ? resolve(process.env.T5_FILE_ACTIVITY_HELPER ?? join(dirname(process.execPath), 't5-macos-file-activity')) : null;
let fileActivityAdapterFactory = null;
if (packagedFileActivityHelper) {
  try {
    await accessFile(packagedFileActivityHelper, constants.X_OK);
    fileActivityAdapterFactory = async () => makeMacOSFSEventsAdapter({
      helper: packagedFileActivityHelper, ledger: fileActivityLedger,
      onError: (error) => console.error('[file-activity]', error?.message ?? 'collector failed'),
    });
  } catch {}
}
const fileActivityService = makeScopedFileActivityService({
  ledger: fileActivityLedger, adapterFactory: fileActivityAdapterFactory,
  onError: (error) => console.error('[file-activity]', error?.message ?? 'collector failed'),
});
const fileActivityRootSelector = makeNativeFolderSelector();
await fileActivityService.resumeConfigured().catch(() => {});

const appActivityLedger = new CoarseAppActivityLedger(join(stateDir, 'app-activity'));
const packagedAppActivityHelper = process.platform === 'darwin'
  ? resolve(process.env.T5_APP_ACTIVITY_HELPER ?? join(dirname(process.execPath), 't5-macos-coarse-app-activity')) : null;
let appActivityAdapterFactory = null;
if (packagedAppActivityHelper) {
  try { await accessFile(packagedAppActivityHelper, constants.X_OK); appActivityAdapterFactory = async () => makeMacOSCoarseAppAdapter({
    helper: packagedAppActivityHelper, ledger: appActivityLedger,
    onError: (error) => console.error('[app-activity]', error?.message ?? 'collector failed'),
  }); } catch {}
}
const appActivityService = makeCoarseAppActivityService({ ledger: appActivityLedger, adapterFactory: appActivityAdapterFactory,
  onError: (error) => console.error('[app-activity]', error?.message ?? 'collector failed') });
await appActivityService.resumeConfigured().catch(() => {});

const platformSecretStore = makePlatformSecretStore({ platform: computerEnvironment.platform });
await migrateStoredModelCredentials({ file: connectionFile, secretStore: platformSecretStore });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore: platformSecretStore });
const modelConnections = makeModelConnectionService({
  file: connectionFile, secretStore: platformSecretStore,
});
const credentialCatalog = makeStoredModelCredentialCatalog({
  file: connectionFile, secretStore: platformSecretStore,
});
const webSearchProviders = [
  makeStoredOpenAIWebSearchProvider({ credentialCatalog }),
  makeNaverSearchProvider(),
  makeDuckDuckGoSearchProvider(),
  makeBingSearchProvider(),
];
const connectionStateStore = new ConnectionStateStore(join(stateDir, 'connections', 'connection-state.sqlite'));
const connectionCredentialCoordinator = new ConnectionCredentialCoordinator({
  stateStore: connectionStateStore, secretStore: platformSecretStore, makeId: randomUUID,
});
const messengerCredentialStore = new MessengerPlatformCredentialStore(platformSecretStore);
await migrateMessengerCredentials({
  source: new MessengerCredentialStore(join(stateDir, 'messenger')),
  target: messengerCredentialStore,
});
const notionConnection = makeNotionMcpConnection({
  secretStore: platformSecretStore,
  browserAvailable: false,
  cliInspect: makeNotionCliInspector(),
});
const linearConnection = makeRemoteMcpConnection({
  id: 'linear', label: 'Linear', serverUrl: 'https://mcp.linear.app/mcp',
  resource: 'https://mcp.linear.app/mcp', secretStore: platformSecretStore,
  stateStore: connectionStateStore, credentialCoordinator: connectionCredentialCoordinator,
});
const channelTalkConnection = makeChannelTalkConnection({ secretStore: platformSecretStore });
const slackClientId = String(process.env.T5_SLACK_OAUTH_CLIENT_ID ?? '').trim();
const slackClientSecret = String(process.env.T5_SLACK_OAUTH_CLIENT_SECRET ?? '').trim();
const slackCallbackPort = Number(process.env.T5_SLACK_OAUTH_CALLBACK_PORT ?? 4185);
const slackPublicSearchToolName = String(process.env.T5_SLACK_PUBLIC_SEARCH_TOOL_NAME ?? '').trim();
let slackPublicSearchPolicy = null;
if (slackPublicSearchToolName) {
  let probeArguments;
  try { probeArguments = JSON.parse(process.env.T5_SLACK_PUBLIC_SEARCH_PROBE_JSON ?? ''); }
  catch { throw new Error('T5 Slack public search qualification is invalid'); }
  slackPublicSearchPolicy = { toolName: slackPublicSearchToolName, probeArguments };
}
if ((!slackClientId && slackClientSecret) || (slackClientId && !slackClientSecret)
  || !Number.isInteger(slackCallbackPort) || slackCallbackPort < 1024 || slackCallbackPort > 65_535) {
  throw new Error('T5 Slack OAuth application configuration is incomplete');
}
const slackConnection = slackClientId && slackPublicSearchPolicy ? makeSlackMcpConnection({ secretStore: platformSecretStore,
  stateStore: connectionStateStore, credentialCoordinator: connectionCredentialCoordinator,
  clientId: slackClientId, clientSecret: slackClientSecret, callbackPort: slackCallbackPort,
  publicSearchPolicy: slackPublicSearchPolicy }) : null;
const workspaceConnectionServices = [notionConnection, linearConnection, channelTalkConnection];
if (slackConnection) workspaceConnectionServices.push(slackConnection);
const localConsoleToken = randomBytes(32).toString('base64url');
const server = makeConsoleServer({
  stateDir,
  workspace,
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
  modelConnections,
  computerEnvironment,
  terminalEnvironment,
  terminalPlatformAdapter,
  terminalCredentialBroker,
  webSearchProviders,
  webReadOptions: { urlResolvers: [naverReadableUrlResolver] },
  videoTextFetchImpl: globalThis.fetch,
  workspaceConnectionInspectors: [],
  workspaceConnectionServices,
  messengerCredentialStore,
  fileActivityService,
  fileActivityRootSelector,
  appActivityService,
  localConsoleToken,
  onError: (error) => console.error('[refoundation-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, '127.0.0.1', resolveListen);
});
await server.resumeQueuedWork();
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
    boundedShutdown(() => server.closeFileActivity()),
    boundedShutdown(() => server.closeAppActivity()),
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
