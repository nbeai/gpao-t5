#!/usr/bin/env node
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { CapabilityLifecycleLedger } from '../src/capability-lifecycle.js';
import { LearningCandidateStore } from '../src/learning-candidate.js';
import { runLearningReview } from '../src/learning-review.js';
import { runLearningEvaluation } from '../src/learning-evaluator.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const selected = option('--model-id');
const models = selected ? [selected] : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const room = await mkdtemp(join(tmpdir(), 't5-e-review-live-')); const results = [];
const sources = [1, 2].map((index) => ({ eligible: true, pointer: {
  workId: `work-${index}`, revision: 1, runId: `run-${index}`, sessionId: `session-${index}`,
  sourceMessageId: `message-${index}`, resultDigest: `result-${index}` } }));
const episodes = [
  { source: sources[0], evidence: 'A report run stopped after its result was durable. The successful recovery read that exact result, did not repeat the uncertain write, reopened the artifact, and then delivered it.' },
  { source: sources[1], evidence: 'A separate document run also recovered from the durable result pointer, skipped replay of an effect with unknown acknowledgement, reopened the exact artifact, and verified it before completion.' },
];

for (const modelId of models) {
  const modelRoom = join(room, modelId.replaceAll(/[^a-z0-9.-]+/giu, '_'));
  const stateDir = join(modelRoom, 'state'); await mkdir(stateDir, { recursive: true });
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(modelRoom, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile, stateDir });
  const ledger = new CapabilityLifecycleLedger(join(stateDir, 'learning'));
  const candidateStore = new LearningCandidateStore({ ledger }); const began = performance.now();
  try {
    const model = await access.model({ sessionId: `learning-${modelId}`, workspace: modelRoom,
      computer: { platform: process.platform, architecture: process.arch }, instructionsOverride: [
      'You are T5 isolated procedural learning reviewer.',
      'Use only the supplied proposal tool. Never perform the work or contact anyone.',
      'Propose one general Skill only when repeated achieved evidence proves the same reusable method.',
      'The Skill must explain a reusable procedure, not quote source wording or identifiers.',
    ].join('\n') });
    const reviewed = await runLearningReview({ episodes, model, candidateStore,
      reviewRunId: `review-${modelId}` });
    const proposals = await ledger.list(); const proposal = proposals[0] ?? null;
    const activeAbsent = await stat(join(stateDir, 'managed-skills', 'active'))
      .then(() => false).catch(() => true);
    const evaluatorModel = await access.model({ sessionId: `evaluation-${modelId}`, workspace: modelRoom,
      computer: { platform: process.platform, architecture: process.arch }, instructionsOverride: [
        'You are T5 isolated learning evaluator. Use only the evaluation tool.',
        'Preserve correctness and completeness; do not prefer a faster wrong candidate.',
      ].join('\n') });
    const evaluated = await runLearningEvaluation({ model: evaluatorModel, pairs: [1, 2].map((index) => ({
      baseline: { objective: `Recover durable result case ${index}`, result: 'Recovered and verified artifact',
        modelTurns: 6, toolCalls: 5 },
      candidate: { objective: `Recover durable result holdout ${index}`, result: 'Recovered and verified artifact',
        modelTurns: 4, toolCalls: 3 },
    })), nearMiss: { objective: 'Rename a calendar title', candidateProcedureRelevant: false } });
    const evaluationPassed = evaluated.evaluation.pairs.every((pair) => pair.samePurpose
      && pair.baselineCorrect && pair.candidateCorrect && pair.baselineComplete
      && pair.candidateComplete && pair.userCorrectionPreserved)
      && evaluated.evaluation.nearMissShouldTrigger === false
      && evaluated.evaluation.sourceExpressionsReused === false
      && evaluated.evaluation.recommendAfterIndependentFieldSuccess === true;
    const passed = reviewed.status === 'completed' && proposals.length === 1
      && proposal.state === 'candidate' && proposal.sourcePointers?.length === 2
      && activeAbsent && evaluationPassed;
    results.push({ modelId, passed, wallMs: Math.round(performance.now() - began),
      modelTurns: reviewed.modelTurns, toolCalls: reviewed.toolCalls,
      proposals: proposals.length, state: proposal?.state ?? null,
      sourcePointers: proposal?.sourcePointers?.length ?? 0, activeWrites: 0,
      evaluatorModelTurns: evaluated.modelTurns, evaluatorToolCalls: evaluated.toolCalls,
      evaluationPassed,
      ...(!passed ? { toolOutcomes: reviewed.toolOutcomes } : {}) });
  } catch (error) {
    results.push({ modelId, passed: false, wallMs: Math.round(performance.now() - began),
      failure: error?.message ?? String(error) });
  }
}
const report = { schema: 't5.s2-e-learning-review-live.v1', recordedAt: new Date().toISOString(),
  results, passed: results.every((result) => result.passed) };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
await rm(room, { recursive: true, force: true });
if (!report.passed) process.exitCode = 1;
