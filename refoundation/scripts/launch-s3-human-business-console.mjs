#!/usr/bin/env node
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';
import { makeDuckDuckGoSearchProvider } from '../src/duckduckgo-search-provider.js';
import { makeBingSearchProvider } from '../src/bing-search-provider.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';
import { findExecutable, makeGitHubCliRegistration } from '../src/github-cli-broker.js';
import { makeTerminalCredentialBroker } from '../src/terminal-credential-broker.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { MessengerCredentialStore } from '../src/messenger-credential-store.js';
import {
  findS3HumanBusinessScenario, loadS3HumanBusinessScenarios,
  materializeS3HumanBusinessScenario, snapshotS3BusinessWorkspace,
} from '../src/s3-human-business-scenarios.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function publicScenario(scenario) {
  return {
    id: scenario.id, title: scenario.title, business: scenario.business,
    domain: scenario.domain, environment: scenario.environment,
    sentinel: scenario.sentinel === true,
    qualificationStatus: scenario.qualificationStatus,
    portfolioRole: scenario.portfolioRole,
    requestStage: scenario.requestStage,
    sourceRefs: scenario.sourceRefs,
  };
}

const catalogOnly = process.argv.includes('--list');
if (catalogOnly) {
  const catalog = await loadS3HumanBusinessScenarios();
  console.log(JSON.stringify({
    schema: catalog.schema,
    scenarios: catalog.scenarios.map(publicScenario),
  }, null, 2));
  process.exit(0);
}

if (!process.argv.includes('--human-controlled')) {
  throw new Error('--human-controlled is required: this launcher opens a visible live-model console');
}

const scenarioId = option('--scenario');
if (!scenarioId) throw new Error('--scenario is required; use --list first');
const requestedModel = option('--model') ?? null;
const variant = Number(option('--variant') ?? 0);
if (!Number.isSafeInteger(variant) || variant < 0) throw new Error('--variant must be a non-negative integer');
const connectionFile = resolve(option('--connection-file')
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const { catalog, scenario } = await findS3HumanBusinessScenario(scenarioId);
if (scenario.qualificationStatus !== 'source_grounded'
  && !process.argv.includes('--include-research-derived')
  && !process.argv.includes('--allow-research-draft')) {
  throw new Error(
    `scenario ${scenario.id} is research-derived rather than observed-demand; `
    + 'pass --include-research-derived to select it explicitly',
  );
}
const prompts = [scenario.primaryPrompt, ...(scenario.alternatePrompts ?? [])];
if (!prompts[variant]) throw new Error(`scenario ${scenario.id} has no variant ${variant}`);

const root = await mkdtemp(join(tmpdir(), `t5-s3-human-${scenario.id.toLowerCase()}-`));
const home = join(root, 'home');
const data = join(root, 'data');
const stateDir = join(root, 'state');
const workspace = join(root, 'workspace');
const control = join(root, 'tester-control');
const skillsRoot = join(root, 'skills-empty');
await Promise.all([home, data, stateDir, workspace, control, skillsRoot]
  .map((path) => mkdir(path, { recursive: true, mode: 0o700 })));

const fixture = await materializeS3HumanBusinessScenario({ scenario, catalog, workspace });
const baseline = await snapshotS3BusinessWorkspace(workspace);
const modelStateRaw = await readFile(connectionFile, 'utf8');
const modelState = JSON.parse(modelStateRaw);
const forbiddenSecretField = /^(key|apiKey|access|refresh|password|token|credential)$/iu;
function assertPublicMetadata(value, path = 'model connection') {
  if (Array.isArray(value)) { value.forEach((item, index) => assertPublicMetadata(item, `${path}[${index}]`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [name, child] of Object.entries(value)) {
    if (forbiddenSecretField.test(name)) throw new Error(`${path} contains legacy raw secret field: ${name}`);
    assertPublicMetadata(child, `${path}.${name}`);
  }
}
assertPublicMetadata(modelState);
const isolatedConnectionFile = join(control, 'model-connection.json');
await writeFile(isolatedConnectionFile, `${JSON.stringify(modelState, null, 2)}\n`, { mode: 0o600 });

const previousHome = process.env.T5_REFOUNDATION_HOME;
const previousData = process.env.T5_REFOUNDATION_DATA_DIR;
const previousWorkspace = process.env.T5_REFOUNDATION_WORKSPACE;
process.env.T5_REFOUNDATION_HOME = home;
process.env.T5_REFOUNDATION_DATA_DIR = data;
process.env.T5_REFOUNDATION_WORKSPACE = workspace;

const computer = discoverComputerEnvironment({ userHome: home });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
const secretStore = makePlatformSecretStore({ platform: computer.platform });
const credentialCatalog = makeStoredModelCredentialCatalog({
  file: isolatedConnectionFile, secretStore,
});
const availableConnections = await credentialCatalog.list();
if (requestedModel) {
  const selected = availableConnections.find((item) => item.modelId === requestedModel);
  if (!selected) throw new Error(`model is not configured: ${requestedModel}`);
  await credentialCatalog.activate(selected.id);
}
const access = makeConsoleModelAccess({
  connectionFile: isolatedConnectionFile, stateDir, secretStore,
});
const initialModel = await access.status();
if (!initialModel.connected) throw new Error('a verified T5 model connection is required');
const githubCli = await findExecutable('gh', terminalEnvironment.PATH ?? '');
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({
  platform: computer.platform,
  protectedReadRoots: [
    dirname(connectionFile), control, join(stateDir, 'connections'),
    join(homedir(), 'Library', 'Keychains'),
  ],
  protectedExecutableNames: githubCli ? ['gh'] : [],
});
const terminalCredentialBroker = makeTerminalCredentialBroker({
  registrations: githubCli ? [makeGitHubCliRegistration(githubCli)] : [],
});
const webSearchProviders = [
  makeStoredOpenAIWebSearchProvider({ credentialCatalog }),
  makeDuckDuckGoSearchProvider(),
  makeBingSearchProvider(),
];

let sourceCommit = 'unknown';
try { sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
catch { /* packaged console */ }
const manifest = {
  schema: 't5.s3.human-business-live-run.v1',
  createdAt: new Date().toISOString(), sourceCommit,
  scenario: publicScenario(scenario), variant,
  prompt: prompts[variant], testerInterventions: scenario.testerInterventions ?? [],
  purpose: scenario.purpose, acceptance: scenario.acceptance,
  environment: fixture.profile, expectedFacts: fixture.expectedFacts,
  paths: { root, workspace, stateDir, control }, baseline,
  model: { provider: initialModel.provider, modelId: initialModel.modelId },
  boundaries: {
    realUserData: false, realAccounts: false, realExternalWrites: false,
    connectorServicesLoaded: 0, messengerCredentialsLoaded: 0,
    browserAutomationLoaded: false, learningReviewMode: 'off',
  },
};
await writeFile(join(control, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await writeFile(join(control, 'human-assessment.json'), `${JSON.stringify({
  schema: 't5.s3.human-business-assessment.v1', scenarioId: scenario.id,
  modelId: initialModel.modelId,
  purposeAchieved: null, resultCorrect: null, resultComplete: null,
  feltEasy: null, progressReassuring: null, correctionAndCancelWorked: null,
  artifactActuallyUsable: null, uncertaintyHonest: null,
  unnecessaryApprovalOrSetup: null, wouldDelegateAgain: null,
  humanTimeSaved: null, notes: '',
}, null, 2)}\n`, { mode: 0o600 });

const server = makeConsoleServer({
  stateDir, workspace, skillsRoot,
  modelFactory: (context) => access.model(context),
  modelStatus: () => access.status(),
  computerEnvironment: computer, terminalEnvironment,
  terminalPlatformAdapter, terminalCredentialBroker, webSearchProviders,
  learningReviewMode: 'off',
  messengerCredentialStore: new MessengerCredentialStore(join(stateDir, 'messenger-empty')),
  workspaceConnectionInspectors: [], workspaceConnectionServices: [],
  onError: (error) => console.error('[s3-human-business-console]', error?.message ?? error),
});
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(Number(option('--port') ?? 0), '127.0.0.1', resolveListen);
});
const url = `http://127.0.0.1:${server.address().port}`;

console.log('\nT5 인간 사업 시나리오 라이브 콘솔');
console.log(`시나리오: ${scenario.id} · ${scenario.title}`);
console.log(`사업/영역: ${scenario.business} · ${scenario.domain}`);
console.log(`현실 상태: ${fixture.profile.connectionReality} · ${fixture.profile.localEvidence}`);
console.log(`모델: ${initialModel.provider} · ${initialModel.modelId}`);
console.log(`콘솔: ${url}`);
console.log(`격리 작업공간: ${workspace}`);
console.log(`평가 기록: ${join(control, 'human-assessment.json')}`);
console.log('\n사용자 요청문장');
console.log('────────────────────────────────────────');
console.log(prompts[variant]);
console.log('────────────────────────────────────────');
if (scenario.testerInterventions?.length) {
  console.log('\n실행 중 순서대로 보낼 교정/취소');
  scenario.testerInterventions.forEach((text, index) => console.log(`${index + 1}. ${text}`));
}
console.log('\n종료 후 요약 명령');
console.log(`npm run refoundation:summarize:business-human -- --room ${JSON.stringify(root)}`);

if (!process.argv.includes('--no-open')) {
  if (process.platform === 'darwin') {
    spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
  } else if (process.platform === 'win32') {
    spawn('cmd.exe', ['/d', '/s', '/c', 'start', '', url], {
      stdio: 'ignore', detached: true, windowsHide: true,
    }).unref();
  }
}

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('s3_human_business_shutdown').catch(() => {});
  await new Promise((resolveClose) => server.close(resolveClose));
  if (previousHome == null) delete process.env.T5_REFOUNDATION_HOME;
  else process.env.T5_REFOUNDATION_HOME = previousHome;
  if (previousData == null) delete process.env.T5_REFOUNDATION_DATA_DIR;
  else process.env.T5_REFOUNDATION_DATA_DIR = previousData;
  if (previousWorkspace == null) delete process.env.T5_REFOUNDATION_WORKSPACE;
  else process.env.T5_REFOUNDATION_WORKSPACE = previousWorkspace;
  console.log(`\n격리 증거를 보존했습니다: ${root}`);
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
