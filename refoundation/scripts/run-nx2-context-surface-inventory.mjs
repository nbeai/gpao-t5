#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { consoleInstructions } from '../src/console-model-factory.js';
import { interactionCore } from '../src/interaction-core.js';
import { loadSkillSnapshot } from '../src/skill-runtime.js';
import { auditNxContextSurfaces } from '../test/helpers/nx-context-surface-audit.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const repository = resolve(new URL('../..', import.meta.url).pathname);
const manifest = JSON.parse(await readFile(join(repository, 'refoundation/config/instruction-family-manifest.json'), 'utf8'));
const fixture = manifest.fixture;
const instructions = consoleInstructions(fixture.workspace, fixture.computer,
  { interactionCoreMode: fixture.interactionCoreMode });
const core = interactionCore(fixture.interactionCoreMode);
const skillSnapshot = await loadSkillSnapshot({ directory: join(repository, 'refoundation/skills') });
const providerEvidence = JSON.parse(await readFile(join(repository,
  'refoundation/evidence/nx2-first-turn-reality-affordance-audit-2026-09-01.json'), 'utf8'));
const sourcePaths = [
  'refoundation/src/information-context.js', 'refoundation/src/conversation-projection.js',
  'refoundation/src/workspace-runtime-context.js', 'refoundation/src/context-receipt.js',
  'refoundation/src/transmission-receipt.js', 'refoundation/src/integral-method-runtime.js',
  'refoundation/src/skill-runtime.js', 'refoundation/config/instruction-family-manifest.json',
];
const sourceModules = await Promise.all(sourcePaths.map(async (name) => {
  const content = await readFile(join(repository, name)); return { name, bytes: content.length, sha256: sha256(content) };
}));

const room = await mkdtemp(join(tmpdir(), 't5-cx0-surface-')); const stateDir = join(room, 'state');
const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
let firstCall = null;
const server = makeConsoleServer({ stateDir, workspace,
  capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
  learningReviewMode: 'off', memoryFlushMode: 'off',
  modelFactory: async () => ({ async respond(request) {
    firstCall ??= { tools: structuredClone(request.tools ?? []),
      runtimeContext: String(request.runtimeContext ?? ''), messages: structuredClone(request.messages ?? []) };
    return { text: '안녕하세요.', toolCalls: [] };
  } }), modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'cx0-fixture' }),
  workspaceConnectionInspectors: [], workspaceConnectionServices: [],
});
await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
  await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text: '안녕.' }) });
  const report = auditNxContextSurfaces({ instructions, interactionCore: core, manifest,
    activeTools: firstCall?.tools ?? [], skills: skillSnapshot.skills,
    skillBodies: skillSnapshot.contentByName, runtimeContext: firstCall?.runtimeContext ?? '',
    providerBaseline: {
      provider: providerEvidence.provider, model: providerEvidence.model,
      requestBytes: 41566,
      instructionsBytes: providerEvidence.firstProviderCall.instructionsBytes,
      activeToolBytes: providerEvidence.firstProviderCall.toolContractBytes,
      activeToolCount: providerEvidence.firstProviderCall.toolNames.length,
      currentUserOnlyMaterialPairDifference: providerEvidence.decision.userRequestOnlyMaterialDifference,
    }, sourceModules });
  report.recordedOn = '2026-09-01'; report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository, encoding: 'utf8' }).trim();
  report.surfaceState = {
    direct: { Work: 0, ToolCalls: 0, memoryItems: 0, conversationHistoryMessages: 0 },
    toolDisclosure: 'directory-first-v1', skillDisclosure: 'on-demand',
    finalEpoch: 'conditional Integral Human Closure; not present in Direct',
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  server.closeWakeStreams(); server.closeModelConnections();
  await server.managedProcesses.stopAll('cx0_shutdown'); await new Promise((done) => server.close(done));
  await rm(room, { recursive: true, force: true });
}
