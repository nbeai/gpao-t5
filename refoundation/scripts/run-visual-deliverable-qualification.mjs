#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { runAgent } from '../src/agent-loop.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { consoleInstructions, makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeTerminalHand } from '../src/exec-tool.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import { makeSkillTool } from '../src/skill-runtime.js';
import { loadSkillSnapshot } from '../src/skill-snapshot.js';
import { renderVisualDeliverable } from '../src/visual-deliverable-renderer.js';

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const helperPath = resolve(option('--helper') ?? process.env.T5_VISUAL_RENDERER_HELPER ?? 'runtime/bin/t5-docx-page-renderer');
const evidencePath = resolve(option('--evidence')
  ?? 'refoundation/evidence/s3-vd-actual-model-candidate.json');
const keep = process.argv.includes('--keep');
const connectionFile = process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json');
const room = await mkdtemp(join(tmpdir(), 't5-s3-vd-live-'));
const home = join(room, 'home'); const workspace = join(room, 'workspace'); const stateDir = join(room, 'state');
await Promise.all([home, workspace, stateDir].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
await writeFile(join(workspace, '운영자료.json'), `${JSON.stringify({
  title: '8월 운영 현황', confirmedOrders: 128, inventoryRisks: 3,
  note: '주문과 현재 재고를 실제 자료로 대조했습니다.',
}, null, 2)}\n`, { mode: 0o600 });

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const runtimeFiles = [
  'refoundation/native/docx-page-renderer.swift',
  'refoundation/src/visual-deliverable-renderer.js', 'refoundation/src/attachment-hand.js',
  'refoundation/skills/visual-deliverables/SKILL.md',
  'refoundation/scripts/run-visual-deliverable-qualification.mjs',
];
let runtimeDirty = false;
try { execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...runtimeFiles]); }
catch { runtimeDirty = true; }
const runtimeDigest = createHash('sha256');
for (const file of runtimeFiles) runtimeDigest.update(file).update('\0').update(await readFile(file)).update('\0');

const secretStore = makePlatformSecretStore({ platform: process.platform });
const isolatedConnectionFile = join(stateDir, 'model-connection.json');
await writeFile(isolatedConnectionFile, await readFile(connectionFile), { mode: 0o600 });
const credentialCatalog = makeStoredModelCredentialCatalog({
  file: isolatedConnectionFile, secretStore,
});
const requestedModel = option('--model');
if (requestedModel) {
  const selected = (await credentialCatalog.list()).find((item) => item.modelId === requestedModel);
  if (!selected) throw new Error(`model is not configured: ${requestedModel}`);
  await credentialCatalog.activate(selected.id);
}
const access = makeConsoleModelAccess({ connectionFile: isolatedConnectionFile, stateDir, secretStore });
const connection = await access.status();
if (!connection.connected) throw new Error('verified model connection is required');
const computer = { platform: process.platform, architecture: process.arch, commandFamily: 'posix', commandProgram: 'zsh' };
const sessionId = randomUUID(); const runId = randomUUID();
const terminal = makeTerminalHand({ workingDirectory: workspace, ownerId: sessionId });
const attachments = new AttachmentStore(join(stateDir, 'attachments'));
const attachment = makeAttachmentTool({
  store: attachments, sessionId, workspace, runId,
  authorizeOutputPath: (candidate) => resolve(candidate).startsWith(`${resolve(workspace)}/`),
  renderVisualPreview: (file) => renderVisualDeliverable(file, { helperPath }),
});
const skill = makeSkillTool({
  snapshot: await loadSkillSnapshot({ directory: resolve('refoundation/skills') }),
});
const output = join(workspace, '운영현황.html');
const request = [
  '운영자료.json의 실제 내용만 사용해서 사장님이 한눈에 보는 한 페이지 한국어 HTML 운영 현황을 만들어줘.',
  '이미지는 쓰지 말고 정보 위계와 여백이 분명한 화면 보고서로 만들어.',
  `결과 파일의 exact 절대경로는 ${output} 이야.`,
  'HTML에는 data-vd-artboard와 독립 배치 블록의 data-vd-block을 넣어.',
  '파일을 만든 뒤 attachment inspect로 실제 렌더와 DesignReceipt를 확인하고 결함이 있으면 고쳐서 다시 확인해.',
  '최종 파일은 attachment register_output으로 등록한 뒤에만 완료해.',
].join(' ');
const instructions = [
  consoleInstructions(workspace, computer),
  'You are T5 in an isolated visual-deliverable qualification workspace.',
  'Use exec for local file work and attachment inspect for visual render observation.',
  'Read the actual JSON source. Do not invent business facts.',
  'A saved source file is not visual verification. Read DesignReceipt and rendered pixels.',
  'Do not use external network, images, scripts, forms, or external fonts.',
  'Do not claim completion before attachment register_output succeeds.',
].join(' ');
const model = await access.model({ sessionId, workspace, computer,
  instructionsOverride: instructions });
const startedAt = Date.now();
let result;
let error = null;
try {
  result = await runAgent({ request, model, tools: [...terminal.tools, attachment, skill], maxModelTurns: 20,
  });
} catch (caught) {
  error = caught?.message ?? String(caught);
  result = { status: 'failed', answer: null, receipts: [], modelCalls: [], modelTurns: 0 };
}
const html = await readFile(output, 'utf8').catch(() => '');
const visualReceipts = result.receipts.filter((receipt) => (
  receipt.requestedCall?.name === 'attachment'
  && receipt.requestedCall?.args?.action === 'inspect'
  && receipt.result?.observation?.designReceipt
));
const registrations = result.receipts.filter((receipt) => (
  receipt.requestedCall?.name === 'attachment'
  && receipt.requestedCall?.args?.action === 'register_output'
  && receipt.result?.state === 'registered'
));
const skillViews = result.receipts.filter((receipt) => (
  receipt.requestedCall?.name === 'skill'
  && receipt.requestedCall?.args?.action === 'view'
  && receipt.requestedCall?.args?.name === 'visual-deliverables'
  && receipt.outcome === 'succeeded'
));
const finalVisualReceipt = visualReceipts.at(-1)?.result?.observation?.designReceipt ?? null;
const checks = {
  agentCompleted: result.status === 'completed',
  exactFacts: ['8월 운영 현황', '128', '3', '주문과 현재 재고를 실제 자료로 대조했습니다.']
    .every((value) => html.includes(value)),
  noRawSourceKeysVisible: !/confirmedOrders|inventoryRisks/u.test(html),
  noExternalOrActiveContent: !/<script|<form|https?:\/\//iu.test(html),
  visualSkillUsed: skillViews.length === 1,
  visualInspectionUsed: visualReceipts.length > 0,
  finalDesignReceiptNotFailed: ['qualified', 'unmeasured'].includes(finalVisualReceipt?.state),
  renderedPixelsSupplied: visualReceipts.some((receipt) => (
    receipt.result.observation.pixelsSuppliedToModel === true
  )),
  registeredOutput: registrations.length === 1,
};
const evidence = {
  schema: 't5.s3.visual-deliverable-actual-model.v1',
  observedAt: new Date().toISOString(), sourceCommit, runtimeDirty,
  runtimeDigest: runtimeDigest.digest('hex'),
  model: { provider: connection.provider, modelId: connection.modelId },
  request, durationMs: Date.now() - startedAt, status: result.status,
  modelTurns: result.modelTurns, modelCalls: result.modelCalls.length,
  finalDesignState: finalVisualReceipt?.state ?? null,
  finalDesignUnmeasured: finalVisualReceipt?.unmeasured ?? [],
  toolCalls: result.receipts.map((receipt) => ({
    name: receipt.requestedCall?.name, action: receipt.requestedCall?.args?.action ?? null,
    outcome: receipt.outcome, designState: receipt.result?.observation?.designReceipt?.state ?? null,
    filePath: receipt.requestedCall?.args?.filePath ?? null,
    reason: receipt.result?.reason ?? receipt.result?.error ?? null,
  })),
  checks, error,
  passed: !runtimeDirty && Object.values(checks).every(Boolean) && error == null,
  candidatePassedIgnoringDirtySource: Object.values(checks).every(Boolean) && error == null,
  ...(keep ? { room } : {}),
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ evidence: evidencePath, passed: evidence.passed,
  candidatePassedIgnoringDirtySource: evidence.candidatePassedIgnoringDirtySource,
  model: evidence.model, durationMs: evidence.durationMs, checks, error,
  ...(keep ? { room } : {}) }, null, 2));
if (!keep) await rm(room, { recursive: true, force: true });
if (!evidence.candidatePassedIgnoringDirtySource) process.exitCode = 1;
