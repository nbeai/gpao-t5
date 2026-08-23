#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { renderAttachmentPreview } from '../src/artifact-preview.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import { inspectQualifiedDocument } from '../src/qualified-document-parser.js';
import {
  assessStructuralDocumentQualification, createMergedQuoteFixture,
  createRecipeLayoutFixture,
} from '../src/structural-document-qualification.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const keep = process.argv.includes('--keep');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const recipePath = option('--recipe') ? resolve(option('--recipe')) : null;
if (!recipePath) throw new TypeError('--recipe is required for the redacted tester qualification');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-d6-structural-document-'));

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function listen(server) {
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
  await server.managedProcesses.stopAll('d6_structural_document');
  await new Promise((resolveClose) => server.close(resolveClose));
}
async function privateConnection(modelId, taskId) {
  const stored = JSON.parse(await readFile(connectionFile, 'utf8')); stored.activeId = modelId;
  const path = join(room, `${modelId.replace(/[^a-z0-9.-]+/giu, '-')}-${taskId}.json`);
  await writeFile(path, JSON.stringify(stored), { mode: 0o600 }); return path;
}
async function upload(base, sessionId, path, name) {
  const response = await fetch(`${base}/attachments?sessionId=${sessionId}&filename=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await readFile(path),
  });
  const record = await response.json(); if (!response.ok) throw new Error(`upload failed: ${record.error ?? response.status}`);
  return record;
}
function runFacts(run) {
  const receipts = run.events.filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt)
    .filter((receipt) => receipt.requestedCall?.name === 'attachment' && receipt.requestedCall?.args?.action === 'inspect');
  const usage = run.events.filter((event) => event.type === 'model_completed').reduce((sum, event) => (
    sum + Number(event.payload?.response?.usage?.total_tokens ?? 0)
  ), 0);
  return { receipts: receipts.length, observedKinds: receipts.map((receipt) => receipt.result?.observation?.kind), usage };
}
async function modelTask({ modelId, id, path, name, prompt, pass }) {
  const stateDir = join(room, `${modelId.split(':').at(-1)}-${id}`); const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true }); const privateFile = await privateConnection(modelId, id);
  const modelAccess = makeConsoleModelAccess({ connectionFile: privateFile, stateDir: join(stateDir, 'model') });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory: (context) => modelAccess.model(context), modelStatus: () => modelAccess.status(),
  });
  const base = await listen(server); const startedAt = Date.now();
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const record = await upload(base, session.id, path, name);
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: prompt, attachmentIds: [record.attachmentId] }),
    });
    const surface = await response.json(); const run = await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json());
    const facts = runFacts(run); const answer = String(surface.reply ?? '');
    return {
      modelId: modelId.split(':').at(-1), id, answer, wallMs: Date.now() - startedAt,
      httpStatus: response.status, runStatus: run.status, ...facts,
      passed: response.status === 200 && run.status === 'completed' && pass(answer, facts),
    };
  } finally { await close(server); }
}

try {
  const fixtureDirectory = join(room, 'fixture');
  const fixture = await createMergedQuoteFixture(fixtureDirectory); const recipeFixture = await createRecipeLayoutFixture(fixtureDirectory);
  const quoteBytes = await readFile(fixture.path);
  const recipeBytes = await readFile(recipePath); const before = { quote: digest(quoteBytes), recipe: digest(recipeBytes) };
  const quoteObserved = await inspectBusinessDocument({ file: fixture.path, maxCells: 1_000 });
  const quoteSheet = quoteObserved.workbook.sheets[0];
  const quotePreview = await renderAttachmentPreview({
    record: { originalName: '병합_행사견적_비식별.xlsx', kind: 'spreadsheet', storedPath: fixture.path }, bytes: quoteBytes,
  });
  const recipeObserved = await inspectQualifiedDocument({
    bytes: recipeBytes, format: 'xls', sourceSha256: before.recipe, maxChars: 200_000, maxCells: 100_000,
  });
  const recipePreview = await renderAttachmentPreview({
    record: { originalName: '소스_및_드레싱_테스터.xls', kind: 'binary' }, bytes: recipeBytes,
  });
  const recipeTable = recipeObserved.structure.tables.find((table) => table.sheetName === fixture.expected.recipeSheet);
  const targetRow = recipeTable?.cells.find((row) => row.some((cell) => cell.text === fixture.expected.recipeRow[0]));
  const recipeTarget = {
    sheetName: recipeTable?.sheetName ?? null,
    addresses: targetRow?.slice(0, 4).map((cell) => cell.address) ?? [],
    values: targetRow?.slice(0, 4).map((cell) => cell.text) ?? [],
    semanticRoles: targetRow?.slice(0, 4).map(() => 'parallel_source_item') ?? [],
  };
  const quotePrompt = [
    '이 병합 견적서를 실제 구조대로 읽어 고객·행사일·도착시간·배송지·요청사항·메뉴를 구분해줘.',
    '수량·단가·금액과 금액 수식을 확인하고 담당자·배송비·부가세처럼 비어 있거나 미확인인 값은 채우지 마.',
    '핵심 값마다 원본 시트와 셀 주소를 붙이고 원문 표기를 임의로 교정하지 마.',
  ].join(' ');
  const recipePrompt = [
    '이 24시트 구형 레시피에서 끼니강성미샘 시트의 불린녹말이 있는 행을 실제 표 구조로 확인해줘.',
    '그 행의 A9:D9를 각각 무엇으로 읽었는지 원문 그대로 나열하고, 서로 나란한 재료인지 수량·단위 열인지 판단해줘.',
    '수량이나 단위가 확인되지 않으면 미확인이라고 말하고 시트명과 셀 주소를 붙여줘.',
  ].join(' ');
  const tasks = [
    {
      id: 'merged-quote', path: fixture.path, name: '병합_행사견적_비식별.xlsx', prompt: quotePrompt,
      pass: (answer, facts) => /한빛상회/u.test(answer) && /2026-09-01/u.test(answer) && /12시\s*30분/u.test(answer)
        && /85/u.test(answer) && /27,?000/u.test(answer) && /2,?295,?000/u.test(answer)
        && /C24\*D24/u.test(answer) && /Sheet1/u.test(answer) && /B3/u.test(answer)
        && /C24/u.test(answer) && /D24/u.test(answer) && /E24/u.test(answer)
        && /배송비/u.test(answer) && /부가세/u.test(answer) && /(미확인|비어)/u.test(answer)
        && facts.receipts === 1 && facts.observedKinds.includes('xlsx'),
    },
    {
      id: 'horizontal-recipe-row', path: recipeFixture.path, name: '24시트_레시피_비식별.xlsx', prompt: recipePrompt,
      pass: (answer, facts) => /끼니강성미샘/u.test(answer)
        && ['불린녹말', '마는녹말', '밀가루', '계란흰자1개'].every((value) => answer.includes(value))
        && ['A9', 'B9', 'C9', 'D9'].every((value) => answer.includes(value))
        && /(나란|각각|독립).*(재료|항목)|(재료|항목).*(나란|각각|독립)/u.test(answer)
        && /(수량|단위).*(미확인|아님|없)/u.test(answer)
        && !/수량\s*[=:]\s*마는녹말/u.test(answer) && !/단위\s*[=:]\s*밀가루/u.test(answer)
        && facts.receipts === 1 && facts.observedKinds.includes('xlsx'),
    },
  ];
  const modelTasks = [];
  for (const modelId of ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']) {
    for (const task of tasks) modelTasks.push(await modelTask({ modelId, ...task }));
  }
  const after = { quote: digest(await readFile(fixture.path)), recipe: digest(await readFile(recipePath)) };
  const sourceFilesUnchanged = JSON.stringify(before) === JSON.stringify(after);
  const verdict = assessStructuralDocumentQualification({
    fixture, quoteSheet, quotePreview: quotePreview.body, recipePreview: recipePreview.body,
    recipeTarget, modelTasks, sourceFilesUnchanged,
  });
  const evidence = {
    schema: 't5.d6-structural-visual-document-qualification.v1', recordedAt: new Date().toISOString(), actualUserData: true,
    sources: {
      quote: { kind: 'generated_redacted_fixture', sha256: before.quote, merges: quoteSheet.merges.length },
      recipe: {
        kind: 'local_tester_source', sha256: before.recipe, persistedInEvidence: false,
        transmittedToExternalModel: false, sheets: recipeObserved.structure.pageCount,
      },
      modelRecipeFixture: { kind: 'generated_redacted_fixture', sha256: recipeFixture.sha256, sheets: recipeFixture.sheets },
    },
    observations: {
      quote: {
        sheetName: quoteSheet.name, merges: quoteSheet.merges.length,
        formula: quoteSheet.cells.find((cell) => cell.address === 'E24')?.formula,
        previewMergeAttributes: (quotePreview.body.match(/(?:rowspan|colspan)="\d+"/gu) ?? []).length,
      },
      recipe: {
        ...recipeTarget, totalChars: recipeObserved.coverage.totalChars, tables: recipeObserved.coverage.totalTables,
        previewShowsTarget: ['끼니강성미샘', 'A9', 'B9', 'C9', 'D9'].every((value) => recipePreview.body.includes(value)),
      },
    },
    modelTasks, sourceFilesUnchanged, verdict,
    unverified: {
      fullRecipeStandardizationRows: 'not_generated', visualPixelsSuppliedToModel: false,
      reason: 'both fixed counterexamples passed from explicit structure; merge-aware preview was rendered for the human surface',
    },
    room: keep ? room : null, passed: verdict.passed,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally {
  if (!keep) await rm(room, { recursive: true, force: true });
}
