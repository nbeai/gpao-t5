#!/usr/bin/env node
import { copyFile, lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { resolveTerminalShellEnvironment } from '../src/terminal-shell-environment.js';
import { makeTerminalPlatformAdapter } from '../src/terminal-platform-adapter.js';

const option = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; };
if (!process.argv.includes('--human-controlled')) throw new Error('--human-controlled is required');
const scenarioId = option('--scenario'); if (!scenarioId) throw new Error('--scenario is required');
const repository = resolve(dirname(new URL(import.meta.url).pathname), '..', '..');
const fixtureRoot = join(repository, 'refoundation', 'fixtures', 's6-ng5-dr0');
const oracle = JSON.parse(await readFile(join(repository, 'refoundation', 'evidence',
  's6-ng5-dr0-hidden-oracle-2026-08-31.json'), 'utf8'));
const scenario = oracle.scenarios.find((item) => item.id === scenarioId);
if (!scenario) throw new Error('unknown NX-1 scenario');

const sourceConnectionFile = resolve(option('--connection-file')
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const sourceConnections = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = sourceConnections.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') throw new Error('exact gpt-5.5 connection is required');

const root = await mkdtemp(join(tmpdir(), `t5-nx1-human-${scenarioId}-`));
const stateDir = join(root, 'state'); const workspace = join(root, 'workspace');
const home = join(root, 'home'); const control = join(root, 'control');
await Promise.all([stateDir, workspace, home, control].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
for (const source of scenario.sources) await copyFile(join(fixtureRoot, source.path), join(workspace, basename(source.path)));
const connectionFile = join(control, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: sourceConnections.version,
  activeId: selected.id, roleBindings: {}, connections: [selected] }), { mode: 0o600 });

const helperCandidate = resolve(option('--ocr-helper')
  ?? '/Applications/GPAO-T5.app/Contents/Resources/runtime/bin/t5-docx-page-renderer');
let helper = null;
try { const stat = await lstat(helperCandidate); if (stat.isFile() && !stat.isSymbolicLink()) helper = helperCandidate; }
catch { /* image Reality stays unavailable rather than using another path */ }

const computer = discoverComputerEnvironment({ userHome: home });
const terminalEnvironment = await resolveTerminalShellEnvironment({ computer, home });
const terminalPlatformAdapter = await makeTerminalPlatformAdapter({ platform: computer.platform,
  managedWorkspace: workspace, protectedReadRoots: [stateDir, dirname(sourceConnectionFile),
    join(homedir(), 'Library', 'Keychains')] });
const access = makeConsoleModelAccess({ connectionFile, stateDir,
  secretStore: makePlatformSecretStore({ platform: process.platform }) });
const fileOcrProbe = helper ? makeLocalImageOcr({ platform: 'darwin', helper }) : null;
const server = makeConsoleServer({ stateDir, workspace, computerFileRoots: [workspace],
  restrictFileRealityToComputerRoots: true, computerEnvironment: computer,
  terminalEnvironment, terminalPlatformAdapter, capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1', learningReviewMode: 'off', memoryFlushMode: 'off', fileOcrProbe,
  modelFactory: (input) => access.model(input), modelStatus: () => access.status(),
  workspaceConnectionInspectors: [], workspaceConnectionServices: [],
  onError: (error) => process.stderr.write(`[nx1-human-console] ${error?.message ?? error}\n`),
});
await new Promise((done, reject) => { server.once('error', reject);
  server.listen(Number(option('--port') ?? 0), '127.0.0.1', done); });
const url = `http://127.0.0.1:${server.address().port}`;
await writeFile(join(control, 'run-manifest.json'), JSON.stringify({
  schema: 't5.nx1.product-human-console.v1', scenarioId, prompt: scenario.userPrompt,
  sourceCommit: process.env.T5_NX1_SOURCE_COMMIT ?? null, root, stateDir, workspace,
  model: { provider: selected.provider, modelId: selected.modelId },
  boundaries: { actualUserData: false, externalWrites: 0, computerRoots: [workspace],
    solarPro4: 'not_used', windows: 'not_claimed' }, url,
}, null, 2), { mode: 0o600 });
process.stdout.write(`${JSON.stringify({ state: 'ready', scenarioId, url, root,
  workspace, stateDir, prompt: scenario.userPrompt, ocr: helper ? 'available' : 'unavailable' })}\n`);

let stopping = false;
const stop = async () => { if (stopping) return; stopping = true;
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('nx1_human_console_shutdown').catch(() => {});
  await new Promise((done) => server.close(done));
  process.exit(0);
};
process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.resume();
