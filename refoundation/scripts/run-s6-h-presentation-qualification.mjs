#!/usr/bin/env node
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';

const sourceFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'GPAO-T5', 'credentials', 'model-connection.json');
const source = JSON.parse(await readFile(sourceFile, 'utf8'));
const requestedId = process.env.T5_SIXTH_MODEL_CONNECTION_ID ?? source.activeId;
const selected = source.connections.find((item) => item.id === requestedId);
if (!selected?.secretRef) throw new Error('exact secret-backed model connection is required');

const room = await mkdtemp(join(tmpdir(), 't5-s6-h-presentation-'));
const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
await Promise.all([stateDir, workspace].map((path) => mkdir(path, { recursive: true })));
const connectionFile = join(stateDir, 'model-connection.json');
await writeFile(connectionFile, JSON.stringify({ version: source.version,
  connections: [selected], activeId: selected.id, roleBindings: {} }), { mode: 0o600 });
await chmod(connectionFile, 0o600);
const secretStore = makePlatformSecretStore({ platform: process.platform });
const access = makeConsoleModelAccess({ connectionFile, stateDir, secretStore });
const server = makeConsoleServer({ stateDir, workspace, capabilitySurfaceMode: 'directory-first-v1',
  workAdmissionMode: 'action-v1', learningReviewMode: 'off', memoryFlushMode: 'off',
  modelFactory: (input) => access.model(input), modelStatus: () => access.status() });

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${value.error ?? 'request failed'}`);
  return value;
}

await new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
});
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const session = await post(base, '/sessions', {}); const started = performance.now();
  const turn = await post(base, '/turn', { sessionId: session.id,
    text: '경영진에게 보여줄 편집 가능한 3쪽짜리 2026 운영 계획 발표자료를 만들어줘. 1쪽은 핵심 목표, 2쪽은 실행 로드맵, 3쪽은 결정 요청으로 하고, 확인되지 않은 수치는 단정하지 마.' });
  const run = await fetch(`${base}/runs/${turn.runId}`).then((response) => response.json());
  const listed = await fetch(`${base}/attachments?sessionId=${session.id}`).then((response) => response.json());
  const artifact = listed.attachments.find((item) => item.direction === 'output'
    && item.originalName.toLowerCase().endsWith('.pptx'));
  const preview = artifact ? await fetch(`${base}${artifact.previewUrl}`) : null;
  const previewBody = preview?.ok ? await preview.text() : '';
  const downloaded = artifact ? await fetch(`${base}${artifact.downloadUrl}`) : null;
  const downloadedBytes = downloaded?.ok ? Buffer.from(await downloaded.arrayBuffer()) : Buffer.alloc(0);
  const modelEvents = run.events.filter((event) => event.type === 'model_completed');
  const toolEvents = run.events.filter((event) => event.type === 'tool_completed');
  const tools = toolEvents.map((event) => event.payload?.receipt?.actualCall?.name).filter(Boolean);
  const answerContainsInternalPath = /(?:\/private\/|\/Users\/|outputHandle|attachmentId)/u.test(turn.reply ?? '');
  const passed = Boolean(artifact) && artifact.previewKind === 'presentation'
    && preview?.ok && downloaded?.ok && downloadedBytes.subarray(0, 2).toString('ascii') === 'PK'
    && /핵심 목표/u.test(previewBody) && /실행 로드맵/u.test(previewBody) && /결정 요청/u.test(previewBody)
    && tools.includes('exec') && tools.includes('attachment') && !answerContainsInternalPath;
  process.stdout.write(`${JSON.stringify({ schema: 't5.s6-h-presentation-qualification.v1', passed,
    model: selected.modelId, actualUserData: false, externalWrites: 0,
    wallMs: Number((performance.now() - started).toFixed(3)), modelCalls: modelEvents.length,
    toolCalls: toolEvents.length, tools, providerTokens: modelEvents.reduce((sum, event) => sum
      + Number(event.payload?.response?.usage?.total_tokens ?? 0), 0),
    answerContainsInternalPath,
    artifact: artifact ? { name: artifact.originalName, bytes: artifact.bytes,
      previewKind: artifact.previewKind, version: artifact.artifactVersion,
      previewAllSlides: /핵심 목표/u.test(previewBody) && /실행 로드맵/u.test(previewBody)
        && /결정 요청/u.test(previewBody), downloadPptx: downloadedBytes.subarray(0, 2).toString('ascii') === 'PK' } : null,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
} finally {
  server.closeWakeStreams(); await server.managedProcesses.stopAll('s6_h_shutdown');
  await new Promise((resolve) => server.close(resolve));
  await rm(room, { recursive: true, force: true });
}
