#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import {
  createGeneratedCompatibilityFixtures, hashCompatibilityFiles, summarizeCompatibilityObservation,
} from '../src/document-compatibility-baseline.js';
import {
  KORDOC_CANDIDATE, assessDocumentCandidateQualification, fetchD5PinnedFixtures,
  summarizeKordocObservation,
} from '../src/document-candidate-qualification.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const keep = process.argv.includes('--keep');
const evidencePath = option('--evidence') ? resolve(option('--evidence')) : null;
const candidateCli = resolve(option('--candidate-cli') ?? '/tmp/t5-d5-kordoc-runtime/node_modules/kordoc/dist/cli.js');
const connectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-d5-document-candidate-'));
const corpusDirectory = join(room, 'corpus'); const outputDirectory = join(room, 'candidate-output');
await Promise.all([mkdir(corpusDirectory), mkdir(outputDirectory)]);

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function safeJson(text) {
  const source = String(text ?? ''); const start = source.indexOf('{'); const end = source.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(source.slice(start, end + 1)); } catch { return null; }
}
function timeFacts(stderr, startedAt) {
  const resident = String(stderr).match(/([0-9]+)\s+maximum resident set size/u);
  const real = String(stderr).match(/([0-9.]+)\s+real/u);
  return {
    wallMs: real ? Math.round(Number(real[1]) * 1000) : Date.now() - startedAt,
    peakResidentBytes: resident ? Number(resident[1]) : null,
  };
}

async function runCandidate(definition, suffix) {
  const outputPath = join(outputDirectory, `${definition.caseId}-${suffix}.json`);
  const startedAt = Date.now();
  const child = spawn('/usr/bin/time', [
    '-l', process.execPath, candidateCli, definition.path, '--format', 'json', '--silent', '-o', outputPath,
  ], { cwd: room, env: { ...process.env, NO_PROXY: '*', no_proxy: '*' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject); child.once('close', resolveExit);
  });
  let output = null;
  try { output = JSON.parse(await readFile(outputPath, 'utf8')); } catch { output = safeJson(stdout) ?? safeJson(stderr); }
  if (!output) output = { success: false, code: 'NO_JSON_RESULT', error: stderr.trim() || `exit ${exitCode}` };
  return { output, performance: { ...timeFacts(stderr, startedAt), processExitCode: exitCode } };
}

function publicObservation(row) {
  const { markdown, ...safe } = row;
  return { ...safe, markdownSha256: sha256(Buffer.from(markdown)), projection: markdown.slice(0, 2_000) };
}

async function currentT5Observations(definitions) {
  const sessionId = randomUUID(); const store = new AttachmentStore(join(room, 'current-state'));
  const tool = makeAttachmentTool({ store, sessionId, workspace: join(room, 'current-workspace') });
  const rows = [];
  for (const definition of definitions) {
    const record = await store.receive({
      sessionId, originalName: definition.fileName, bytes: await readFile(definition.path),
    });
    let inspected;
    try {
      inspected = await tool.execute({ action: 'inspect', attachmentId: record.attachmentId, filePath: null, maxChars: 30_000, maxCells: 5_000, maxPages: 20 });
    } catch (error) { inspected = { state: 'failed', error: String(error?.message ?? error) }; }
    const baselineDefinition = {
      ...definition,
      required: definition.format === 'pdf' ? ['format_identity', 'text_content', 'page_structure']
        : definition.format === 'docx' ? ['format_identity', 'text_content', 'tabular_structure']
          : ['format_identity', 'text_content'],
    };
    rows.push(summarizeCompatibilityObservation(baselineDefinition, record, inspected));
  }
  return rows;
}

async function modelFor(modelId, taskId) {
  const identity = `${modelId}-${taskId}`.replace(/[^a-z0-9._-]+/giu, '-');
  const privateCopy = join(room, `model-${identity}.json`);
  await copyFile(connectionFile, privateCopy); await writeFile(privateCopy, JSON.stringify({
    ...JSON.parse(await readFile(privateCopy, 'utf8')), activeId: modelId,
  }), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile: privateCopy, stateDir: join(room, `model-state-${identity}`) });
  return access.model({
    sessionId: `d5-${identity}`, workspace: room, computer: { platform: process.platform },
    instructionsOverride: '후보 문서 관측 결과에만 근거해 한국어로 간결하게 답한다. 보이지 않는 사실은 추측하지 않는다.',
  });
}

async function runModelTasks(observations) {
  const byId = new Map(observations.map((row) => [row.caseId, row]));
  const similarityProjection = ['paired-hwp3', 'paired-hwp5', 'paired-hwpx'].map((id) => {
    const row = byId.get(id); return `[${id}]\n${row.markdown.slice(0, 4_000)}`;
  }).join('\n\n');
  const businessProjection = ['legacy-xls-biff8-korean', 'modern-docx'].map((id) => {
    const row = byId.get(id); return `[${id}]\n${row.markdown.slice(0, 6_000)}`;
  }).join('\n\n');
  const definitions = [
    {
      id: 'paired-hwp-purpose', prompt: `세 관측이 같은 문서인지 판단하고 문서 주제를 두 문장 안으로 말해줘.\n${similarityProjection}`,
      pass: (answer) => /(같|동일)/u.test(answer) && /(가상 서버|virtual server)/iu.test(answer) && /클러스터/u.test(answer),
    },
    {
      id: 'korean-business-values', prompt: `두 문서에서 예산 제목, 기획조정실의 본예산, 전체 본예산 합계, 거래처, 계약 금액을 정확히 뽑아줘.\n${businessProjection}`,
      pass: (answer) => /기획조정실/u.test(answer) && /2025/u.test(answer) && /12,?500,?000,?000/u.test(answer)
        && /38,?100,?000,?000/u.test(answer) && /한빛상회/u.test(answer) && /40,?300/u.test(answer),
    },
  ];
  const modelIds = ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5']; const tasks = [];
  for (const modelId of modelIds) {
    for (const definition of definitions) {
      const model = await modelFor(modelId, definition.id);
      const startedAt = Date.now(); const response = await model.respond({ messages: [{ role: 'user', content: definition.prompt }], tools: [] });
      const answer = String(response.text ?? ''); tasks.push({
        modelId: modelId.split(':').at(-1), taskId: definition.id, wallMs: Date.now() - startedAt,
        answer, passed: definition.pass(answer), usage: response.usage ?? null,
      });
    }
  }
  return tasks;
}

try {
  await stat(candidateCli);
  const pinned = await fetchD5PinnedFixtures(corpusDirectory);
  const generated = await createGeneratedCompatibilityFixtures(corpusDirectory);
  const generatedSelected = generated.filter((row) => ['modern-docx', 'text-pdf'].includes(row.caseId)).map((row) => ({
    ...row,
    required: row.caseId === 'modern-docx' ? ['content', 'table_structure'] : ['content', 'page_structure'],
  }));
  const definitions = [...pinned, ...generatedSelected]; const before = await hashCompatibilityFiles(definitions);
  const current = await currentT5Observations(definitions.filter((row) => row.caseId !== 'encrypted-hwp3'));
  const candidateObservations = [];
  for (const definition of definitions) {
    const cold = await runCandidate(definition, 'cold'); const warm = await runCandidate(definition, 'warm');
    candidateObservations.push(summarizeKordocObservation(definition, cold.output, { cold: cold.performance, warm: warm.performance }));
  }
  const corruptDefinitions = [];
  for (const id of ['paired-hwp3', 'paired-hwp5', 'paired-hwpx']) {
    const original = definitions.find((row) => row.caseId === id); const bytes = await readFile(original.path);
    const path = join(corpusDirectory, `손상_${original.fileName}`); await writeFile(path, bytes.subarray(0, Math.max(64, Math.floor(bytes.length / 3))));
    corruptDefinitions.push({ ...original, caseId: `corrupt-${original.format}`, path, sha256: sha256(await readFile(path)), required: ['corrupted_boundary'] });
  }
  const corruptObservations = [];
  for (const definition of corruptDefinitions) {
    const result = await runCandidate(definition, 'boundary');
    corruptObservations.push(summarizeKordocObservation(definition, result.output, result.performance));
  }
  const after = await hashCompatibilityFiles(definitions); const sourceFilesUnchanged = JSON.stringify(before) === JSON.stringify(after);
  const modelTasks = await runModelTasks(candidateObservations);
  const verdict = assessDocumentCandidateQualification({
    current, candidateObservations, corruptObservations, sourceFilesUnchanged, modelTasks,
  });
  const performanceRows = candidateObservations.map((row) => ({ caseId: row.caseId, ...row.performance }));
  const evidence = {
    schema: 't5.d5-korean-legacy-document-candidate-qualification.v1', recordedAt: new Date().toISOString(),
    actualUserData: false, candidate: KORDOC_CANDIDATE,
    corpus: definitions.map(({ path, ...definition }) => definition), sourceFilesUnchanged,
    currentT5: current, candidateObservations: candidateObservations.map(publicObservation),
    corruptObservations: corruptObservations.map(publicObservation), modelTasks, performanceRows,
    unqualifiedBoundaries: {
      windowsActualDevice: 'not_measured', macrosOleExternalObjects: 'read-only parser did not execute objects, but explicit detection/warning was not qualified',
      optionalPdfOcrImageStack: 'not installed or measured', docPptOdtOds: 'out of D5 candidate scope',
      hwp3TruncationClassification: corruptObservations.find((row) => row.caseId === 'corrupt-hwp3')?.errorCode === 'DECOMPRESSION_BOMB'
        ? 'fails closed but labels ordinary truncation as DECOMPRESSION_BOMB' : 'no observed misclassification',
    },
    verdict, room: keep ? room : null, passed: verdict.passed,
  };
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (evidencePath) { await mkdir(dirname(evidencePath), { recursive: true }); await writeFile(evidencePath, serialized, 'utf8'); }
  process.stdout.write(serialized); if (!evidence.passed) process.exitCode = 1;
} finally {
  if (!keep) await rm(room, { recursive: true, force: true });
}
