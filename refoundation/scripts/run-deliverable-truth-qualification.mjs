#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { renderAttachmentPreview } from '../src/artifact-preview.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { DOCX_REQUIRED_ANCHORS, assessDeliverableTruthSuite, assessDocxDeliverableTruth } from '../src/deliverable-truth-qualification.js';
import { createWorkbookFromSpec, inspectBusinessDocument } from '../src/document-data-inspector.js';
import { renderDocxFirstPage } from '../src/docx-visual-renderer.js';
import { inspectQualifiedDocument } from '../src/qualified-document-parser.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const keep = process.argv.includes('--keep');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-d7-deliverable-truth-'));

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
  await server.managedProcesses.stopAll('d7_deliverable_truth');
  await new Promise((resolveClose) => server.close(resolveClose));
}
async function privateConnection(modelId, suffix) {
  const stored = JSON.parse(await readFile(connectionFile, 'utf8')); stored.activeId = modelId;
  const path = join(room, `${modelId.replace(/[^a-z0-9.-]+/giu, '-')}-${suffix}.json`);
  await writeFile(path, JSON.stringify(stored), { mode: 0o600 }); return path;
}
async function upload(base, sessionId, path, name) {
  const response = await fetch(`${base}/attachments?sessionId=${sessionId}&filename=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: await readFile(path),
  });
  const record = await response.json(); if (!response.ok) throw new Error(`upload failed: ${record.error ?? response.status}`);
  return record;
}
function receipts(run) {
  return run.events.filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt);
}
function usage(run) {
  return run.events.filter((event) => event.type === 'model_completed').reduce((sum, event) => (
    sum + Number(event.payload?.response?.usage?.total_tokens ?? 0)
  ), 0);
}
function modelTurns(run) { return run.events.filter((event) => event.type === 'model_completed').length; }
function pngDimensions(bytes) {
  return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.length >= 24
    ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: 0, height: 0 };
}

async function renderAndObserve({ outputPath, modelId, stateDir }) {
  process.stderr.write(`[d7] ${modelId} Quick Look render\n`);
  const rendered = await renderDocxFirstPage(outputPath);
  if (rendered.state !== 'rendered') throw new Error(`DOCX visual render failed: ${rendered.reason}`);
  const firstBytes = Buffer.from(rendered.bytes);
  const pages = [{ name: 'page-1.png', bytes: firstBytes.length, ...pngDimensions(firstBytes) }];
  const privateFile = await privateConnection(modelId, 'visual');
  const access = makeConsoleModelAccess({ connectionFile: privateFile, stateDir: join(stateDir, 'visual-model') });
  const visualModel = await access.model({
    sessionId: `visual-${modelId.split(':').at(-1)}`, workspace: stateDir, computer: { platform: process.platform },
    instructionsOverride: 'Transcribe only visibly readable text in order. Report clipping, overlap, missing glyphs, mirrored text, or unreadable areas. Do not infer absent text.',
  });
  const response = await visualModel.respond({
    messages: [{
      role: 'user', content: 'Transcribe the visible Korean document exactly and report any readability defect.',
      modelAttachments: [{ type: 'input_image', detail: 'high', image_url: `data:image/png;base64,${firstBytes.toString('base64')}` }],
    }], tools: [], signal: AbortSignal.timeout(120_000),
  });
  return { pages, transcript: String(response.text ?? ''), usage: response.usage ?? null, engine: rendered.engine };
}

async function runDocx(modelId) {
  const modelName = modelId.split(':').at(-1); const stateDir = join(room, modelName); const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true }); const sourcePath = join(workspace, '상담_후속_메모.txt');
  const outputPath = join(workspace, '상담_후속_조치.docx');
  await writeFile(sourcePath, [
    '상담일: 2026-08-23', '담당자: 홍길동', '합의: 매주 화요일 15:00',
    '미정: 최종 비용', '다음 상태: 확인 필요',
  ].join('\n'), { mode: 0o600 });
  const sourceSha256Before = digest(await readFile(sourcePath)); const privateFile = await privateConnection(modelId, 'task');
  const modelAccess = makeConsoleModelAccess({ connectionFile: privateFile, stateDir: join(stateDir, 'model') });
  const server = makeConsoleServer({
    stateDir: join(stateDir, 'console'), workspace,
    modelFactory: (context) => modelAccess.model(context), modelStatus: () => modelAccess.status(),
  });
  const base = await listen(server); const turns = []; const startedAt = Date.now();
  process.stderr.write(`[d7] ${modelName} task start\n`);
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const source = await upload(base, session.id, sourcePath, '상담_후속_메모.txt');
    const prompts = [
      '첨부한 상담 메모를 읽고 확인된 일정·담당자·미정 항목을 구분해줘. 아직 파일을 만들지 마.',
      `좋아. 고객이 읽을 한 페이지 Word 문서를 ${outputPath} 에 만들어줘. 제목은 '상담 후속 조치'로 하고 2026-08-23, 매주 화요일 15:00, 최종 비용, 홍길동, 확인 필요를 정확히 넣어줘. 구분·내용·상태 열이 있는 표를 포함하고, 원본은 바꾸지 마. 만든 DOCX를 다시 열어 본문·표와 실제 화면에서 한글이 읽히는지 확인하고 이 콘솔에서 다운로드할 수 있게 등록해줘.`,
      '방금 만든 Word 파일을 다시 열어 제목·날짜·일정·담당자·미정 비용·표 상태가 실제로 있는지와 실제 화면에서 한글이 읽히는지 확인해줘. 만든 사실과 재확인한 사실을 구분하고, 최종 비용은 미정이라고 말해줘.',
    ];
    for (const [index, prompt] of prompts.entries()) {
      process.stderr.write(`[d7] ${modelName} turn ${index + 1}/3\n`);
      const response = await fetch(`${base}/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, text: prompt, attachmentIds: index === 0 ? [source.attachmentId] : [] }),
        signal: AbortSignal.timeout(120_000),
      });
      const surface = await response.json(); const run = await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json());
      turns.push({
        id: ['understand', 'create', 'verify'][index], answer: surface.reply ?? '', runStatus: run.status,
        receipts: receipts(run), usage: usage(run), modelTurns: modelTurns(run),
      });
    }
  } finally { await close(server); }
  const outputBytes = await readFile(outputPath); const outputSha256 = digest(outputBytes);
  const observation = await inspectQualifiedDocument({ bytes: outputBytes, format: 'docx', sourceSha256: outputSha256, maxChars: 100_000, maxCells: 10_000 });
  const preview = await renderAttachmentPreview({
    record: { originalName: '상담_후속_조치.docx', kind: 'document' }, bytes: outputBytes,
  });
  const rendered = await renderAndObserve({ outputPath, modelId, stateDir });
  const allReceipts = turns.flatMap((turn) => turn.receipts);
  const outputRegistered = allReceipts.some((receipt) => receipt.requestedCall?.name === 'attachment'
    && receipt.requestedCall?.args?.action === 'register_output' && receipt.outcome === 'succeeded');
  const structurallyInspected = allReceipts.some((receipt) => receipt.requestedCall?.name === 'attachment'
    && receipt.requestedCall?.args?.action === 'inspect' && receipt.result?.observation?.format === 'docx');
  const visuallyInspected = allReceipts.some((receipt) => receipt.requestedCall?.name === 'attachment'
    && receipt.requestedCall?.args?.action === 'inspect' && receipt.result?.observation?.kind === 'docx_render'
    && receipt.result.observation.pixelsSuppliedToModel === true);
  const outputInspected = structurallyInspected && visuallyInspected;
  const boundedCreatorUsed = allReceipts.some((receipt) => receipt.requestedCall?.name === 'exec'
    && /(?:^|\s)create-docx(?:\s|$)/u.test(String(receipt.requestedCall?.args?.command ?? ''))
    && receipt.outcome === 'succeeded');
  const sourceSha256After = digest(await readFile(sourcePath));
  const verdict = assessDocxDeliverableTruth({
    turns, observation, previewHtml: preview.body, renderedPages: rendered.pages,
    visualTranscript: rendered.transcript, sourceSha256Before, sourceSha256After,
    outputRegistered, outputInspected, boundedCreatorUsed,
  });
  return {
    model: modelName, turns: turns.length, wallMs: Date.now() - startedAt,
    taskTokens: turns.reduce((sum, turn) => sum + turn.usage, 0),
    modelTurns: turns.reduce((sum, turn) => sum + turn.modelTurns, 0), toolCalls: allReceipts.length,
    visualUsage: rendered.usage,
    output: { bytes: outputBytes.length, sha256: outputSha256, pages: rendered.pages, anchors: DOCX_REQUIRED_ANCHORS },
    visualTranscript: rendered.transcript, visualEngine: rendered.engine,
    outputRegistered, structurallyInspected, visuallyInspected, outputInspected, boundedCreatorUsed, verdict,
  };
}

async function brandPositiveControl() {
  const file = join(room, '브랜드_콘텐츠_비식별.xlsx');
  await createWorkbookFromSpec({
    output: file, spec: { sheets: [{
      name: '콘텐츠', title: '브랜드 콘텐츠',
      columns: [
        { key: 'title', header: '제목' }, { key: 'source', header: '출처 URL' }, { key: 'status', header: '상태' },
      ],
      rows: [
        { title: '공지 A', source: 'https://example.com/a', status: '확인' },
        { title: '공지 B', source: 'https://example.org/b', status: '확인' },
        { title: '공지 C', source: 'https://example.net/c', status: '확인' },
      ], formulas: [],
    }] },
  });
  const observation = await inspectBusinessDocument({ file, maxCells: 100 });
  const sheet = observation.workbook.sheets[0];
  const sources = sheet.cells.filter((cell) => cell.column === 2 && cell.row > 2).map((cell) => cell.text);
  return {
    rows: sources.length, uniqueSources: new Set(sources).size,
    duplicateSources: sources.length - new Set(sources).size,
    formulaErrors: observation.workbook.totals.formulaErrors, sha256: observation.file.sha256,
  };
}

try {
  const [documentEvidence, textEvidence, structureEvidence] = await Promise.all([
    readFile(resolve('refoundation/evidence/d3-t0-result-truth-reconciliation-2026-08-23.json'), 'utf8').then(JSON.parse),
    readFile(resolve('refoundation/evidence/d4-text-tabular-encoding-depth-2026-08-23.json'), 'utf8').then(JSON.parse),
    readFile(resolve('refoundation/evidence/d6-structural-visual-document-qualification-2026-08-23.json'), 'utf8').then(JSON.parse),
  ]);
  const docxRuns = [];
  for (const modelId of ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']) docxRuns.push(await runDocx(modelId));
  const brandControl = await brandPositiveControl();
  const suite = assessDeliverableTruthSuite({
    documentEvidence, pdfEvidence: documentEvidence, textEvidence, structureEvidence, docxRuns, brandControl,
  });
  const evidence = {
    schema: 't5.d7-deliverable-truth-qualification.v1', recordedAt: new Date().toISOString(), actualUserData: false,
    baselineBeforeBoundedCreator: [
      { model: 'gpt-5.6-terra', wallMs: 101_660, taskTokens: 696_387, result: 'DOCX structurally correct; bundled LibreOffice renderer lost Korean glyphs' },
      { model: 'gpt-5.5', wallMs: 156_311, taskTokens: 255_478, result: 'DOCX structurally correct; bundled LibreOffice renderer lost Korean glyphs' },
    ],
    reusedEvidence: {
      document: 'refoundation/evidence/d3-t0-result-truth-reconciliation-2026-08-23.json',
      text: 'refoundation/evidence/d4-text-tabular-encoding-depth-2026-08-23.json',
      structure: 'refoundation/evidence/d6-structural-visual-document-qualification-2026-08-23.json',
    },
    docxRuns, brandControl, suite, passed: suite.passed, room: keep ? room : null,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally {
  if (!keep) await rm(room, { recursive: true, force: true });
}
