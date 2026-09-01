#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access as accessFile, chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';
import {
  makeStoredModelCredentialCatalog, migrateStoredModelCredentials,
} from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeNaverSearchProvider } from '../src/naver-search-provider.js';
import { makeNaverIdentityBroker } from '../src/naver-identity-broker.js';
import { naverReadableUrlResolver } from '../src/naver-readable-url.js';
import { makeConsoleServer } from '../src/console-server.js';
import { DEFAULT_AGENT_BROWSER_BINARY, makeAgentBrowserDriver, sessionNameForOwner } from '../src/agent-browser-driver.js';
import { makePersistentBrowserHost } from '../src/persistent-browser-host.js';
import { resolveConsoleWorkspace } from '../src/console-config.js';
import { defaultWindowsComputerFileRoots, discoverComputerEnvironment,
  discoverMacOSComputerFileRoots } from '../src/computer-environment.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import {
  findExecutable, githubCliCredentialRoots, makeGitHubCliRegistration,
} from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makeRegisteredCliConnectionInspector } from '../src/existing-capability-inspectors.js';
import { discoverLocalSyncRoots, makeLocalSyncCapability } from '../src/local-sync-capability.js';
import { makeNativeComputerInspector } from '../src/native-computer-tool.js';
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
import { makeMacOSFSEventsAdapter, makeWindowsUSNAdapter } from '../src/file-activity-platform-adapters.js';
import { makeNativeFolderSelector } from '../src/native-folder-selector.js';
import { CoarseAppActivityLedger } from '../src/coarse-app-activity-ledger.js';
import { makeCoarseAppActivityService } from '../src/coarse-app-activity-service.js';
import { makeMacOSCoarseAppAdapter, makeWindowsCoarseAppAdapter } from '../src/coarse-app-activity-platform-adapters.js';
import { ManagedProcessRegistry } from '../src/managed-process.js';
import { resolveWindowsProductEnvironment } from '../src/windows-product-environment.js';
import { LocalRuntimeOwnership } from '../src/durable-process-ownership.js';
import { RuntimeContinuityLedger, makeRuntimeContinuityMonitor } from '../src/runtime-continuity.js';
import { makeLocalNotificationService, makeMacOSNotificationAdapter } from '../src/local-notification.js';
import { deleteT5OwnedLocalData } from '../src/local-data-deletion.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makeAudioDecode, makeAudioRealityProbe } from '../src/audio-reality.js';
import { AuditoryModelStore, loadAuditoryModelCatalog } from '../src/auditory-model-store.js';
import { makeAuditoryCapabilityService } from '../src/auditory-capability-service.js';
import { makeWhisperHostQualifier } from '../src/whisper-host-qualification.js';
import { makeAuditoryTranscriptionSpine } from '../src/auditory-transcription-spine.js';
import { verifyTranscriptCoverage } from '../src/transcript-coverage.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const port = Number(option('--port') ?? process.env.T5_REFOUNDATION_CONSOLE_PORT ?? 4174);
const computerEnvironment = discoverComputerEnvironment({ userHome: homedir() });
const windowsProduct = computerEnvironment.platform === 'win32'
  ? await resolveWindowsProductEnvironment({ productRoot: option('--product-root') }) : null;
const stateDir = resolve(process.env.T5_REFOUNDATION_CONSOLE_STATE
  ?? windowsProduct?.stateDir ?? join(homedir(), '.local', 'state', 'gpao-t5', 'refoundation-console'));
const workspace = process.env.T5_REFOUNDATION_WORKSPACE
  ? resolveConsoleWorkspace(process.env, homedir()) : (windowsProduct?.workspace ?? resolveConsoleWorkspace(process.env, homedir()));
const terminalEnvironment = await resolveTerminalShellEnvironment({
  computer: computerEnvironment, home: homedir(),
});
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? windowsProduct?.connectionFile ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const cloudflaredCli = await findExecutable('cloudflared', terminalEnvironment.PATH ?? '');
const localSyncCapability = makeLocalSyncCapability({
  platform: computerEnvironment.platform, home: homedir(), env: process.env,
});
const protectedTerminalReadRoots = [
  dirname(connectionFile),
  join(stateDir, 'connections'),
  ...githubCliCredentialRoots({
    platform: computerEnvironment.platform, home: homedir(), env: process.env,
  }),
  ...(computerEnvironment.platform === 'darwin' ? [
    join(homedir(), 'Library', 'Keychains'),
    join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials'),
  ] : []),
  ...(windowsProduct ? [windowsProduct.credentialDirectory] : []),
];
const observedLocalSyncRoots = await discoverLocalSyncRoots({ platform: computerEnvironment.platform,
  home: homedir(), env: process.env });
const standardComputerFileRoots = computerEnvironment.platform === 'darwin'
  ? await discoverMacOSComputerFileRoots(homedir())
  : computerEnvironment.platform === 'win32'
    ? defaultWindowsComputerFileRoots(homedir()) : [homedir()];
const computerFileRoots = [...new Set([
  ...observedLocalSyncRoots.map((item) => item.path), ...standardComputerFileRoots,
])];
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
  platform: computerEnvironment.platform,
  managedWorkspace: workspace,
  protectedReadRoots: protectedTerminalReadRoots,
  protectedExecutableNames: [githubCli ? 'gh' : null, cloudflaredCli ? 'cloudflared' : null].filter(Boolean),
});
const terminalCredentialBroker = makeTerminalCredentialBroker({
  registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
  generalTerminalIsolationQualified: terminalPlatformAdapter.qualified === true,
});
const existingCapabilityInspectors = [
  localSyncCapability,
  makeNativeComputerInspector({ platform: computerEnvironment.platform }),
  ...(githubCli ? [makeRegisteredCliConnectionInspector({
    broker: terminalCredentialBroker, capabilityId: 'github-cli-read', label: 'GitHub CLI',
  })] : []),
];
const portFileValue = option('--port-file') ?? process.env.T5_REFOUNDATION_PORT_FILE;
const portFile = portFileValue ? resolve(portFileValue) : null;
await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
const runtimeOwnership = new LocalRuntimeOwnership(join(stateDir, 'ownership'));
const runtimeLease = await runtimeOwnership.acquire();
if (!runtimeLease.claimed) throw Object.assign(new Error('T5 local runtime is already running'), {
  code: 'T5_RUNTIME_OWNER_ACTIVE', owner: runtimeLease.owner,
});
const runtimeGenerationId = randomUUID();
const runtimeContinuity = new RuntimeContinuityLedger(join(stateDir, 'runtime-continuity'));
await runtimeContinuity.start({ generationId: runtimeGenerationId });

const fileActivityLedger = new ScopedFileActivityLedger(join(stateDir, 'file-activity'));
const packagedFileActivityHelper = process.platform === 'darwin'
  ? resolve(process.env.T5_FILE_ACTIVITY_HELPER ?? join(dirname(process.execPath), 't5-macos-file-activity'))
  : windowsProduct?.fileActivityHelper ?? null;
let fileActivityAdapterFactory = null;
if (packagedFileActivityHelper) {
  try {
    await accessFile(packagedFileActivityHelper, constants.X_OK);
    fileActivityAdapterFactory = async () => (process.platform === 'darwin' ? makeMacOSFSEventsAdapter({
      helper: packagedFileActivityHelper, ledger: fileActivityLedger,
      onError: (error) => console.error('[file-activity]', error?.message ?? 'collector failed'),
    }) : makeWindowsUSNAdapter({
      helper: packagedFileActivityHelper, ledger: fileActivityLedger,
      onError: (error) => console.error('[file-activity]', error?.message ?? 'collector failed'),
    }));
  } catch {}
}
const fileActivityService = makeScopedFileActivityService({
  ledger: fileActivityLedger, adapterFactory: fileActivityAdapterFactory,
  onError: (error) => console.error('[file-activity]', error?.message ?? 'collector failed'),
});
const fileActivityRootSelector = makeNativeFolderSelector({ windowsHelper: windowsProduct?.folderPickerHelper ?? null });
await fileActivityService.resumeConfigured().catch(() => {});

const appActivityLedger = new CoarseAppActivityLedger(join(stateDir, 'app-activity'));
const packagedAppActivityHelper = process.platform === 'darwin'
  ? resolve(process.env.T5_APP_ACTIVITY_HELPER ?? join(dirname(process.execPath), 't5-macos-coarse-app-activity'))
  : windowsProduct?.appActivityHelper ?? null;
let appActivityAdapterFactory = null;
if (packagedAppActivityHelper) {
    try { await accessFile(packagedAppActivityHelper, constants.X_OK); appActivityAdapterFactory = async () => (process.platform === 'darwin' ? makeMacOSCoarseAppAdapter({
      helper: packagedAppActivityHelper, ledger: appActivityLedger,
      onError: (error) => console.error('[app-activity]', error?.message ?? 'collector failed'),
    }) : makeWindowsCoarseAppAdapter({
      helper: packagedAppActivityHelper, ledger: appActivityLedger,
      onError: (error) => console.error('[app-activity]', error?.message ?? 'collector failed'),
    })); } catch {}
}
const appActivityService = makeCoarseAppActivityService({ ledger: appActivityLedger, adapterFactory: appActivityAdapterFactory,
  onError: (error) => console.error('[app-activity]', error?.message ?? 'collector failed') });
await appActivityService.resumeConfigured().catch(() => {});

const platformSecretStore = makePlatformSecretStore({ platform: computerEnvironment.platform,
  windows: windowsProduct ? {
    directory: windowsProduct.credentialDirectory, program: windowsProduct.jobCredentialHost,
  } : {} });
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
const naverIdentityConnection = makeNaverIdentityBroker({ profileHandle: null });
const browserHost = makePersistentBrowserHost({
  root: join(stateDir, 'managed-browser'), binary: DEFAULT_AGENT_BROWSER_BINARY,
});
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
const workspaceConnectionServices = [naverIdentityConnection, notionConnection, linearConnection, channelTalkConnection];
if (slackConnection) workspaceConnectionServices.push(slackConnection);
const localConsoleToken = randomBytes(32).toString('base64url');
const processRegistry = new ManagedProcessRegistry({ platform: computerEnvironment.platform,
  windowsJobHost: windowsProduct?.jobCredentialHost ?? null });
const localNotifications = makeLocalNotificationService({ deliver: process.platform === 'darwin'
  ? makeMacOSNotificationAdapter({ spawnProcess: spawn }) : null });
const fileOcrProbe = computerEnvironment.platform === 'win32'
  ? makeLocalImageOcr({ platform: 'win32', helper: windowsProduct?.imageOcrHelper }) : null;
let audioRealityProbe = null;
if (computerEnvironment.platform === 'darwin') {
  const audioRealityHelper = resolve(process.env.T5_AUDIO_REALITY_HELPER
    ?? join(dirname(process.execPath), 't5-macos-audio-reality'));
  try {
    await accessFile(audioRealityHelper, constants.X_OK);
    audioRealityProbe = makeAudioRealityProbe({ platform: 'darwin', helper: audioRealityHelper });
  } catch { /* audio identity remains available while native track reality is unqualified */ }
} else if (computerEnvironment.platform === 'win32' && windowsProduct?.audioRealityHelper) {
  audioRealityProbe = makeAudioRealityProbe({
    platform: 'win32', helper: windowsProduct.audioRealityHelper,
  });
}
let auditoryCapabilityService = null;
let auditoryScratchRoot = null;
const whisperHost = computerEnvironment.platform === 'darwin'
  ? resolve(process.env.T5_WHISPER_HOST ?? join(dirname(process.execPath), 't5-whisper-host'))
  : windowsProduct?.whisperHost ?? null;
if (whisperHost) {
  try {
    await accessFile(whisperHost, constants.X_OK);
    const auditoryRoot = join(stateDir, 'auditory'); auditoryScratchRoot = join(auditoryRoot, 'scratch');
    await mkdir(auditoryScratchRoot, { recursive: true, mode: 0o700 }); await chmod(auditoryScratchRoot, 0o700);
    const auditoryCatalog = loadAuditoryModelCatalog(JSON.parse(await readFile(
      join(scriptDirectory, '..', 'config', 'auditory-model-assets.json'), 'utf8',
    )));
    const auditoryModelStore = new AuditoryModelStore({
      root: join(auditoryRoot, 'models'), catalog: auditoryCatalog,
    });
    auditoryCapabilityService = makeAuditoryCapabilityService({
      store: auditoryModelStore, scratchRoot: auditoryScratchRoot,
      qualifier: makeWhisperHostQualifier({ helper: whisperHost }),
    });
  } catch { /* auditory capability remains not prepared until packaged helper is exact */ }
}
const auditoryTranscriptionSpine = auditoryCapabilityService && audioRealityProbe && auditoryScratchRoot
  ? makeAuditoryTranscriptionSpine({ capabilityService: auditoryCapabilityService,
    decodeAudio: makeAudioDecode({ observe: audioRealityProbe, platform: computerEnvironment.platform,
      ...(computerEnvironment.platform === 'win32' ? { converter: windowsProduct.audioRealityHelper } : {}) }),
    processRegistry, helper: whisperHost, verifyCoverage: verifyTranscriptCoverage }) : null;
let resolveRuntimeStopRequest;
const runtimeStopReady = new Promise((resolveStop) => { resolveRuntimeStopRequest = resolveStop; });
const server = makeConsoleServer({
  stateDir,
  workspace,
  capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1',
  learningReviewMode: 'proposal',
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
  productVersion: process.env.T5_PRODUCT_VERSION ?? null,
  modelConnections,
  computerEnvironment,
  terminalEnvironment,
  terminalPlatformAdapter,
  terminalCredentialBroker,
  workspaceConnectionInspectors: existingCapabilityInspectors,
  terminalCapabilityAttribution: (facts) => localSyncCapability.attributeCommand(facts),
  computerFileRoots,
  protectedFileRoots: protectedTerminalReadRoots,
  processRegistry,
  browserDriverFactory: (sessionId) => makeAgentBrowserDriver({
    ownerId: sessionId,
    clientInstanceId: runtimeGenerationId,
    outputDirectory: join(stateDir, 'browser', sessionNameForOwner(sessionId), 'artifacts'),
    browserHost,
  }),
  browserHost,
  webSearchProviders,
  webReadOptions: { urlResolvers: [naverReadableUrlResolver] },
  quickPreviewProgram: cloudflaredCli,
  videoTextFetchImpl: globalThis.fetch,
  workspaceConnectionServices,
  ...(fileOcrProbe ? { fileOcrProbe } : {}),
  ...(audioRealityProbe ? { audioRealityProbe } : {}),
  ...(auditoryCapabilityService ? { auditoryCapabilityService } : {}),
  ...(auditoryTranscriptionSpine ? { auditoryTranscriptionSpine, auditoryScratchRoot } : {}),
  messengerCredentialStore,
  fileActivityService,
  fileActivityRootSelector,
  appActivityService,
  localConsoleToken,
  runtimeOwnerToken: runtimeLease.claim.ownerToken,
  requestRuntimeStop: async (reason) => (await runtimeStopReady)(reason),
  notifyUser: (kind) => localNotifications.notify(kind),
  scheduleWholeStateActivation: async ({ preparedStateRoot, stateDigest }) => {
    if (!portFile) throw new Error('T5 restore activation requires a port file');
    const args = [resolve(scriptDirectory, 'activate-whole-state-restore.mjs'),
      '--prepared-state', preparedStateRoot, '--destination-state', stateDir,
      '--state-digest', stateDigest, '--port-file', portFile];
    const productRoot = option('--product-root'); if (productRoot) args.push('--product-root', resolve(productRoot));
    const child = spawn(process.execPath, args, { cwd: resolve(scriptDirectory, '..', '..'),
      env: process.env, detached: true, stdio: 'ignore', windowsHide: true });
    await new Promise((resolveSpawn, rejectSpawn) => { child.once('spawn', resolveSpawn); child.once('error', rejectSpawn); });
    child.unref(); return true;
  },
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
const runtimeContinuityMonitor = makeRuntimeContinuityMonitor({ ledger: runtimeContinuity,
  generationId: runtimeGenerationId, onGap: async () => {
    await server.resumeQueuedWork();
    await server.recoverAutomationPublications();
  } });

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

const stop = async (reason = 'runtime_signal') => {
  if (stopping) return;
  stopping = true;
  server.beginRuntimeDrain();
  server.closeWakeStreams();
  await Promise.all([
    boundedShutdown(() => server.closeMessengers()),
    boundedShutdown(() => server.closeAutomations()),
  ]);
  await boundedShutdown(() => server.drainActiveWork());
  await boundedShutdown(() => runtimeContinuityMonitor.stop());
  server.closeModelConnections();
  await Promise.all([
    boundedShutdown(() => server.closeBrowsers()),
    boundedShutdown(() => browserHost.close()),
    boundedShutdown(() => server.closeCommandExplainer()),
    boundedShutdown(() => server.closeWorkspaceConnections()),
    boundedShutdown(() => server.closeFileActivity()),
    boundedShutdown(() => server.closeAppActivity()),
    boundedShutdown(() => server.managedProcesses.stopAll('runtime_shutdown')),
  ]);
  await boundedShutdown(() => new Promise((resolveClose) => {
    server.close(resolveClose);
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
  }), 1_000);
  await runtimeContinuity.stop({ generationId: runtimeGenerationId,
    reason: 'runtime_stop_requested' }).catch(() => {});
  await runtimeOwnership.release(runtimeLease.claim).catch(() => {});
  if (portFile) await rm(portFile, { force: true }).catch(() => {});
  let exitCode = 0;
  if (reason === 'user_delete_local_state') {
    try {
      await deleteT5OwnedLocalData({ stateDir, connectionFile, modelConnections,
        messengerCredentialStore, workspaceConnectionServices });
    } catch (error) {
      exitCode = 1;
      console.error('[local-data-deletion]', error?.message ?? 'T5 local data deletion failed');
    }
  }
  process.exit(exitCode);
};
resolveRuntimeStopRequest(stop);
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
