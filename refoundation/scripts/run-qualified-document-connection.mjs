#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import {
  assessDocumentCompatibilityBaseline, createGeneratedCompatibilityFixtures,
  fetchPinnedCompatibilityFixtures, hashCompatibilityFiles, summarizeCompatibilityObservation,
} from '../src/document-compatibility-baseline.js';
import { fetchD5PinnedFixtures } from '../src/document-candidate-qualification.js';
import { QUALIFIED_DOCUMENT_PARSER } from '../src/qualified-document-parser.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const keep = process.argv.includes('--keep');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-qualified-document-connection-'));
const corpus = join(room, 'corpus'); await mkdir(corpus);

async function absent(path) { try { await access(path); return false; } catch (error) { if (error?.code === 'ENOENT') return true; throw error; } }

async function inspectCases(cases, stateName) {
  const sessionId = randomUUID(); const store = new AttachmentStore(join(room, stateName));
  const tool = makeAttachmentTool({ store, sessionId, workspace: join(room, `${stateName}-workspace`) });
  const rows = [];
  for (const definition of cases) {
    const record = await store.receive({ sessionId, originalName: definition.fileName, bytes: await readFile(definition.path) });
    const result = await tool.execute({
      action: 'inspect', attachmentId: record.attachmentId, filePath: null,
      maxChars: 80_000, maxCells: 20_000, maxPages: 20,
    });
    rows.push({ definition, record, result });
  }
  return rows;
}

async function baselineMeasurement() {
  const directory = join(corpus, 'baseline');
  const generated = await createGeneratedCompatibilityFixtures(directory);
  const pinned = await fetchPinnedCompatibilityFixtures(directory);
  const cases = [...generated, ...pinned]; const before = await hashCompatibilityFiles(cases);
  const rows = await inspectCases(cases, 'baseline-state');
  const observations = rows.map(({ definition, record, result }) => summarizeCompatibilityObservation(definition, record, result));
  const after = await hashCompatibilityFiles(cases);
  return {
    cases, observations, sourceFilesUnchanged: JSON.stringify(before) === JSON.stringify(after),
    verdict: assessDocumentCompatibilityBaseline(cases, observations),
  };
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeWakeStreams(); await server.closeMessengers(); await server.closeBrowsers();
  await server.managedProcesses.stopAll('qualified_document_connection');
  await new Promise((resolveClose) => server.close(resolveClose));
}

async function upload(base, sessionId, definition) {
  const response = await fetch(`${base}/attachments?sessionId=${sessionId}&filename=${encodeURIComponent(definition.fileName)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: await readFile(definition.path),
  });
  const record = await response.json(); if (!response.ok) throw new Error(`attachment upload failed: ${record.error ?? response.status}`);
  return record;
}

function receiptFacts(run) {
  const receipts = run.events.filter((event) => event.type === 'tool_completed').map((event) => event.payload.receipt);
  const attachmentInspects = receipts.filter((receipt) => receipt.requestedCall?.name === 'attachment'
    && receipt.requestedCall?.args?.action === 'inspect' && receipt.outcome === 'succeeded');
  const usage = run.events.filter((event) => event.type === 'model_completed').reduce((totals, event) => {
    const item = event.payload?.response?.usage ?? {}; totals.inputTokens += item.input_tokens ?? 0;
    totals.outputTokens += item.output_tokens ?? 0; totals.totalTokens += item.total_tokens ?? 0; return totals;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  return {
    receipts: attachmentInspects.length,
    formats: attachmentInspects.map((receipt) => receipt.result?.observation?.format).filter(Boolean), usage,
  };
}

async function privateConnection(modelId, name) {
  const path = join(room, `${name}-${modelId.replace(/[^a-z0-9.-]+/giu, '-')}.json`);
  const stored = JSON.parse(await readFile(connectionFile, 'utf8')); stored.activeId = modelId;
  await writeFile(path, JSON.stringify(stored), { mode: 0o600 }); return path;
}

async function modelTask({ modelId, id, definitions, prompt, pass }) {
  const stateDir = join(room, `model-${modelId.split(':').at(-1)}-${id}`); const workspace = join(stateDir, 'workspace');
  await mkdir(workspace, { recursive: true });
  const privateFile = await privateConnection(modelId, id);
  const accessModel = makeConsoleModelAccess({ connectionFile: privateFile, stateDir: join(stateDir, 'model') });
  const server = makeConsoleServer({
    stateDir, workspace, modelFactory: (context) => accessModel.model(context), modelStatus: () => accessModel.status(),
  });
  const base = await listen(server); const startedAt = Date.now();
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const records = [];
    for (const definition of definitions) records.push(await upload(base, session.id, definition));
    const response = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: prompt, attachmentIds: records.map((record) => record.attachmentId) }),
    });
    const surface = await response.json(); const run = await fetch(`${base}/runs/${surface.runId}`).then((item) => item.json());
    const facts = receiptFacts(run); const answer = String(surface.reply ?? '');
    return {
      modelId: modelId.split(':').at(-1), id, answer, httpStatus: response.status, runStatus: run.status,
      wallMs: Date.now() - startedAt, ...facts,
      passed: response.status === 200 && run.status === 'completed' && pass(answer, facts),
    };
  } finally { await close(server); }
}

try {
  const d5 = await fetchD5PinnedFixtures(join(corpus, 'd5'));
  const generated = await createGeneratedCompatibilityFixtures(join(corpus, 'generated'));
  const docx = generated.find((row) => row.caseId === 'modern-docx');
  const pdf = generated.find((row) => row.caseId === 'text-pdf');
  const selected = [
    ...d5.filter((row) => row.caseId !== 'encrypted-hwp3'), docx, pdf,
  ];
  const before = await hashCompatibilityFiles([...selected, d5.find((row) => row.caseId === 'encrypted-hwp3')]);
  const directRows = await inspectCases(selected, 'direct-state');
  const direct = directRows.map(({ definition, record, result }) => ({
    caseId: definition.caseId, recordSha256: record.sha256, state: result.state,
    kind: result.observation?.kind ?? null, format: result.observation?.format ?? null,
    sourceSha256: result.observation?.sourceSha256 ?? null,
    textAnchors: (definition.expectedText ?? []).map((anchor) => ({ anchor, matched: String(result.observation?.text ?? '').includes(anchor) })),
    tables: result.observation?.structure?.tables?.length ?? null,
    tableCells: result.observation?.structure?.tables?.reduce((sum, table) => sum + table.shownCells, 0) ?? null,
    pageCount: result.observation?.structure?.pageCount ?? result.observation?.pdf?.pageCount ?? null,
    coverage: result.observation?.coverage ?? null, parser: result.observation?.parser ?? null,
  }));
  const encryptedDefinition = d5.find((row) => row.caseId === 'encrypted-hwp3');
  const [encryptedRow] = await inspectCases([encryptedDefinition], 'encrypted-state');
  const hwp3 = d5.find((row) => row.caseId === 'paired-hwp3'); const hwp3Bytes = await readFile(hwp3.path);
  const corruptDefinition = { ...hwp3, caseId: 'corrupt-hwp3', fileName: '손상_HWP3.hwp', path: join(corpus, '손상_HWP3.hwp') };
  await writeFile(corruptDefinition.path, hwp3Bytes.subarray(0, Math.floor(hwp3Bytes.length / 3)));
  const [corruptRow] = await inspectCases([corruptDefinition], 'corrupt-state');
  const baseline = await baselineMeasurement();

  const paired = ['paired-hwp3', 'paired-hwp5', 'paired-hwpx'].map((id) => d5.find((row) => row.caseId === id));
  const xls = d5.find((row) => row.caseId === 'legacy-xls-biff8-korean');
  const taskDefinitions = [
    {
      id: 'same-document-purpose', definitions: paired,
      prompt: '첨부한 세 문서를 각각 실제로 읽고 같은 원문의 서로 다른 한글 형식인지 판단한 뒤, 공통 주제를 두 문장 안으로 설명해줘.',
      pass: (answer, facts) => /(같|동일)/u.test(answer) && /(가상 서버|virtual server)/iu.test(answer)
        && /(클러스터|여러 실제 서버|부하 분산)/u.test(answer)
        && ['hwp3', 'hwp5', 'hwpx'].every((format) => facts.formats.includes(format)),
    },
    {
      id: 'business-values', definitions: [xls, docx],
      prompt: '첨부한 두 문서를 각각 읽고 예산 제목, 기획조정실 본예산, 전체 본예산 합계, 거래처, 계약 금액을 정확히 뽑아줘.',
      pass: (answer, facts) => /2025/u.test(answer) && /기획조정실/u.test(answer)
        && /12,?500,?000,?000/u.test(answer) && /38,?100,?000,?000/u.test(answer)
        && /한빛상회/u.test(answer) && /40,?300/u.test(answer)
        && ['xls', 'docx'].every((format) => facts.formats.includes(format)),
    },
  ];
  const modelTasks = [];
  for (const modelId of ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']) {
    for (const definition of taskDefinitions) modelTasks.push(await modelTask({ modelId, ...definition }));
  }
  const after = await hashCompatibilityFiles([...selected, encryptedDefinition]);
  const byId = new Map(direct.map((row) => [row.caseId, row]));
  const checks = {
    exactDependency: JSON.parse(await readFile(join(resolve('refoundation'), 'package.json'), 'utf8')).dependencies?.kordoc === '4.9.1',
    optionalPdfStackAbsent: await absent(join(resolve('refoundation'), 'node_modules', 'pdfjs-dist')),
    cliAndMcpBinsAbsent: await absent(join(resolve('refoundation'), 'node_modules', '.bin', 'kordoc'))
      && await absent(join(resolve('refoundation'), 'node_modules', '.bin', 'kordoc-mcp')),
    sourceFilesUnchanged: JSON.stringify(before) === JSON.stringify(after),
    hwp3TextObservedButTableUnqualified: byId.get('paired-hwp3')?.state === 'observed'
      && byId.get('paired-hwp3')?.format === 'hwp3' && byId.get('paired-hwp3')?.tables === 0,
    hwp5Ready: byId.get('paired-hwp5')?.tables > 0 && byId.get('paired-hwp5')?.pageCount > 0,
    hwpxReady: byId.get('paired-hwpx')?.tables > 0 && byId.get('paired-hwpx')?.pageCount > 0,
    xlsReady: byId.get('legacy-xls-biff8-korean')?.textAnchors?.every((item) => item.matched)
      && byId.get('legacy-xls-biff8-korean')?.tables > 0,
    docxReady: byId.get('modern-docx')?.textAnchors?.every((item) => item.matched)
      && byId.get('modern-docx')?.tables > 0,
    existingPdfUnchanged: byId.get('text-pdf')?.kind === 'pdf' && byId.get('text-pdf')?.parser == null,
    encryptedFailsClosed: encryptedRow.result.state === 'capability_boundary'
      && encryptedRow.result.observation?.errorCode === 'ENCRYPTED',
    corruptHwp3Classified: corruptRow.result.state === 'capability_boundary'
      && corruptRow.result.observation?.errorCode === 'CORRUPTED',
    baselineImprovedToTenOfSeventeen: baseline.verdict.targetReadyCases === 10,
    modelTasksPassed: modelTasks.length === 4 && modelTasks.every((task) => task.passed),
  };
  const evidence = {
    schema: 't5.d5-qualified-document-split-connection.v1', recordedAt: new Date().toISOString(), actualUserData: false,
    parser: QUALIFIED_DOCUMENT_PARSER, direct, boundaries: {
      encrypted: encryptedRow.result, corruptHwp3: corruptRow.result,
      windowsActualDevice: 'not_measured', hwp3Tables: 'not_observed', macrosOleExternalObjects: 'explicit warning not qualified',
    },
    baseline: {
      cases: baseline.verdict.cases, targetReadyCases: baseline.verdict.targetReadyCases,
      missingCapabilityCounts: baseline.verdict.missingCapabilityCounts,
      rows: baseline.verdict.rows.map(({ caseId, targetReady, missing }) => ({ caseId, targetReady, missing })),
      sourceFilesUnchanged: baseline.sourceFilesUnchanged,
    },
    modelTasks, checks, passed: Object.values(checks).every(Boolean), room: keep ? room : null,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally {
  if (!keep) await rm(room, { recursive: true, force: true });
}
