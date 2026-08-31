#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { discoverComputerEnvironment } from '../src/computer-environment.js';
import { makeLocalImageOcr } from '../src/local-image-ocr.js';
import { makePlatformSecretStore } from '../src/platform-secret-store.js';
import {
  buildNx1ScenarioReality, evaluateNx1Answer, makeNx1IntegralTool, qualifyNx1DirectHumanAnswer,
  NX1_HUMAN_CLOSURE_INSTRUCTIONS, NX1_REALITY_CLOSURE_INSTRUCTIONS,
  nx1CandidateRuntimeContext, nx1HumanClosureRuntimeContext,
} from '../test/helpers/nx-integral-flagship-qualification.js';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRoot = join(repository, 'refoundation', 'fixtures', 's6-ng5-dr0');
const oracle = JSON.parse(await readFile(join(repository, 'refoundation', 'evidence',
  's6-ng5-dr0-hidden-oracle-2026-08-31.json'), 'utf8'));
const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const sourceConnections = JSON.parse(await readFile(sourceConnectionFile, 'utf8'));
const selected = sourceConnections.connections?.find((item) => item.id === 'chatgpt_oauth:gpt-5.5')
  ?? sourceConnections.connections?.find((item) => item.id === sourceConnections.activeId && item.kind === 'chatgpt_oauth');
if (!selected?.secretRef || selected.modelId !== 'gpt-5.5') throw new Error('exact gpt-5.5 ChatGPT OAuth connection is required');

const argument = (name, fallback = null) => {
  const exact = process.argv.find((item) => item.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback;
};
const order = String(argument('--order', 'AB')).toUpperCase();
if (!['AB', 'BA'].includes(order)) throw new Error('--order must be AB or BA');
const requestedArms = String(argument('--arms', 'AB')).toUpperCase();
if (!/^(?:A|B|AB|BA)$/u.test(requestedArms)) throw new Error('--arms must be A, B, AB, or BA');
const humanConnectionIds = [...new Set(String(argument('--human-connections', selected.id))
  .split(',').map((item) => item.trim()).filter(Boolean))];
const humanConnections = humanConnectionIds.map((id) => sourceConnections.connections?.find((item) => item.id === id));
if (!humanConnections.length || humanConnections.some((item) => !item)) {
  throw new Error('every --human-connections id must be an available exact connection');
}
const SOLAR_CONNECTION_ID = 'api_key:upstage:solar-pro4';
const humanConnectionPolicy = humanConnections.map((connection) => ({ id: connection.id,
  modelId: connection.modelId, provider: connection.provider,
  gating: connection.id !== SOLAR_CONNECTION_ID,
  role: connection.id === SOLAR_CONNECTION_ID ? 'NON_GATING_OPTIONAL_OBSERVATION' : 'GATING_COMPARISON' }));
const selectedIds = new Set(String(argument('--scenarios', oracle.scenarios.map((item) => item.id).join(',')))
  .split(',').map((item) => item.trim()).filter(Boolean));
const scenarios = oracle.scenarios.filter((item) => selectedIds.has(item.id));
if (!scenarios.length) throw new Error('at least one known scenario is required');
const outputPath = argument('--output', null);
const helperPath = resolve(process.env.T5_NX1_IMAGE_OCR_HELPER
  ?? '/Applications/GPAO-T5.app/Contents/Resources/runtime/bin/t5-docx-page-renderer');
const ocrProbe = makeLocalImageOcr({ platform: 'darwin', helper: helperPath });

function childBaseline(definition, output) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [join(repository, 'refoundation', 'scripts',
      'run-s6-ng5-dr0-mixed-document-baseline.mjs')], {
      cwd: repository, stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env,
        T5_NG5_SCENARIOS: definition.id, T5_NG5_OUTPUT: output },
    });
    child.once('error', reject); child.once('exit', (code) => code === 0 ? done() : reject(new Error(`baseline arm exited ${code}`)));
  });
}

async function runBaseline(definition, room) {
  const output = join(room, `${definition.id}-baseline.json`); const started = performance.now();
  await childBaseline(definition, output); const payload = JSON.parse(await readFile(output, 'utf8'));
  const result = payload.results[0]; return { arm: 'A', kind: 'current_product',
    wallMs: Number((performance.now() - started).toFixed(3)), answer: result.answer,
    machine: evaluateNx1Answer(definition.id, result.answer),
    performance: result.performance, sourceBefore: result.sourceBefore, sourceAfter: result.sourceAfter,
    toolPath: result.tools };
}

async function runCandidate(definition, room) {
  const stateDir = join(room, `${definition.id}-candidate-state`); const workspace = join(room, `${definition.id}-candidate-workspace`);
  const home = join(room, `${definition.id}-candidate-home`); await Promise.all([stateDir, workspace, home].map(
    (path) => mkdir(path, { recursive: true })));
  const connectionFile = join(stateDir, 'model-connection.json'); await writeFile(connectionFile, JSON.stringify({
    version: sourceConnections.version, activeId: selected.id, roleBindings: {}, connections: [selected],
  }), { mode: 0o600 });
  for (const source of definition.sources) await copyFile(join(fixtureRoot, source.path), join(workspace, source.path.split('/').at(-1)));
  const reality = await buildNx1ScenarioReality({ definition, fixtureRoot, ocrProbe });
  const access = makeConsoleModelAccess({ connectionFile, stateDir,
    secretStore: makePlatformSecretStore({ platform: process.platform }) });
  const modelInput = { sessionId: `nx1-${definition.id}`, workspace,
    computer: discoverComputerEnvironment({ userHome: home }) };
  const firstModel = await access.model({ ...modelInput,
    instructionsOverride: NX1_REALITY_CLOSURE_INSTRUCTIONS });
  const integral = makeNx1IntegralTool({ reality, scenarioId: definition.id });
  const started = performance.now(); const toolPath = [];
  const toolDefinition = (tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters });
  const usageFor = (responses) => responses.reduce((sum, response) => ({
    inputTokens: sum.inputTokens + Number(response.usage?.input_tokens ?? 0),
    outputTokens: sum.outputTokens + Number(response.usage?.output_tokens ?? 0),
    cachedInputTokens: sum.cachedInputTokens + Number(response.usage?.input_tokens_details?.cached_tokens ?? 0),
    requestBytes: sum.requestBytes + Number(response.contextReceipt?.requestBytes ?? 0),
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, requestBytes: 0 });
  try {
    const realityResponse = await firstModel.respond({ messages: [{ role: 'user', content: definition.userPrompt }],
      tools: [toolDefinition(integral.tool)], runtimeContext: nx1CandidateRuntimeContext(reality),
      toolChoice: { requiredToolName: 'integral_method' } });
    const realityCalls = Array.isArray(realityResponse.toolCalls) ? realityResponse.toolCalls : [];
    const realityCall = realityCalls.length === 1 && realityCalls[0].name === 'integral_method' ? realityCalls[0] : null;
    const realityResult = realityCall ? await integral.tool.execute(realityCall.args) : {
      state: 'candidate_invalid', reason: 'integral_method_call_missing',
    };
    toolPath.push({ name: 'integral_method', outcome: realityCall ? 'succeeded' : 'not_executed', state: realityResult.state });
    if (realityResult.state !== 'verified') return { arm: 'B', kind: 'qualification_integral_method',
      wallMs: Number((performance.now() - started).toFixed(3)), firstUsefulMs: null, answer: null,
      machine: { passed: false, reason: 'reality_closure_failed' }, qualification: {
        reality: integral.qualification(), human: null }, performance: { modelCalls: 1,
        toolCalls: toolPath.length, ...usageFor([realityResponse]) }, toolPath };

    const verifiedReality = integral.verifiedReality();
    const humanComparisons = [];
    for (const [index, connection] of humanConnections.entries()) {
      const safeConnection = connection.id.replace(/[^a-z0-9-]+/giu, '-');
      const closureStateDir = join(room, `${definition.id}-human-${safeConnection}`);
      await mkdir(closureStateDir, { recursive: true });
      const closureConnectionFile = join(closureStateDir, 'model-connection.json');
      await writeFile(closureConnectionFile, JSON.stringify({ version: sourceConnections.version,
        activeId: connection.id, roleBindings: {}, connections: [connection] }), { mode: 0o600 });
      const closureAccess = makeConsoleModelAccess({ connectionFile: closureConnectionFile,
        stateDir: closureStateDir, secretStore: makePlatformSecretStore({ platform: process.platform }) });
      const closureModel = await closureAccess.model({ ...modelInput,
        sessionId: `${modelInput.sessionId}-human-${safeConnection}`,
        instructionsOverride: NX1_HUMAN_CLOSURE_INSTRUCTIONS });
      const closureStarted = performance.now();
      try {
        const closureResponse = await closureModel.respond({ messages: [{ role: 'user', content: definition.userPrompt }],
          tools: [], runtimeContext: nx1HumanClosureRuntimeContext(verifiedReality) });
        const closureCalls = Array.isArray(closureResponse.toolCalls) ? closureResponse.toolCalls : [];
        const qualification = closureCalls.length === 0
          ? qualifyNx1DirectHumanAnswer({ scenarioId: definition.id, answer: closureResponse.text })
          : { passed: false, reason: 'unexpected_human_closure_tool_call' };
        const policy = humanConnectionPolicy.find((item) => item.id === connection.id);
        humanComparisons.push({ connectionId: connection.id, modelId: connection.modelId,
          provider: connection.provider, gating: policy.gating, role: policy.role,
          passed: qualification.passed, state: qualification.passed ? 'verified' : 'closure_failed',
          wallMs: Number((performance.now() - closureStarted).toFixed(3)),
          answer: qualification.passed ? String(closureResponse.text ?? '').trim() : null,
          qualification, performance: { modelCalls: 1, toolCalls: 0,
            ...usageFor([closureResponse]) } });
      } finally { await closureModel.close?.(); }
    }
    const primaryHuman = humanComparisons[0]; const answer = primaryHuman.answer;
    const firstUsefulMs = answer ? Number((performance.now() - started).toFixed(3)) : null;
    return { arm: 'B', kind: 'qualification_integral_method_human_closure',
      wallMs: Number((performance.now() - started).toFixed(3)), firstUsefulMs, answer,
      machine: primaryHuman.passed
        ? primaryHuman.qualification?.answerQuality ?? { passed: false }
        : { passed: false, reason: 'human_closure_failed' },
      qualification: { reality: integral.qualification(), human: primaryHuman.qualification,
        humanComparisons },
      performance: { modelCalls: 2, toolCalls: 1,
        ...usageFor([realityResponse, { usage: {
          input_tokens: primaryHuman.performance.inputTokens,
          output_tokens: primaryHuman.performance.outputTokens,
          input_tokens_details: { cached_tokens: primaryHuman.performance.cachedInputTokens },
        }, contextReceipt: { requestBytes: primaryHuman.performance.requestBytes } }]) }, toolPath };
  } finally { await firstModel.close?.(); }
}

const room = await mkdtemp(join(tmpdir(), `t5-nx1-${order.toLowerCase()}-`));
try {
  const results = [];
  for (const definition of scenarios) {
    const arms = [];
    const executionOrder = [...order].filter((arm) => requestedArms.includes(arm));
    for (const arm of executionOrder) {
      try {
        arms.push(arm === 'A' ? await runBaseline(definition, room) : await runCandidate(definition, room));
      } catch (error) {
        arms.push({ arm, kind: arm === 'A' ? 'current_product' : 'qualification_integral_method',
          wallMs: null, firstUsefulMs: null, answer: null,
          machine: { passed: false, reason: arm === 'A'
            ? 'baseline_execution_failed' : 'candidate_execution_failed' },
          performance: { modelCalls: null, toolCalls: null, inputTokens: null,
            outputTokens: null, cachedInputTokens: null, requestBytes: null },
          toolPath: [], executionFailure: { state: 'failed',
            category: arm === 'A' ? 'baseline_process_failed' : 'candidate_process_failed',
            code: typeof error?.code === 'string' ? error.code : null } });
      }
    }
    results.push({ scenarioId: definition.id, executionOrder: executionOrder.join(''), arms });
  }
  const payload = { schema: 't5.nx1.integral-flagship-comparison.v1', recordedOn: '2026-09-01', order,
    model: 'gpt-5.5', provider: 'chatgpt_oauth', actualUserData: false, externalWrites: 0,
    oracleProjectedToModel: 0, productChanges: 0,
    humanClosureConnectionPolicy: humanConnectionPolicy, results,
    allBaselineExecutionsCompleted: results.every((item) => {
      const arm = item.arms.find((candidate) => candidate.arm === 'A');
      return arm ? arm.executionFailure == null : true;
    }),
    allCandidateMachinePassed: results.every((item) => { const arm = item.arms.find((candidate) => candidate.arm === 'B');
      return arm ? arm.machine.passed && arm.qualification?.reality?.passed
        && arm.qualification?.human?.passed : true; }),
    gatingHumanClosuresPassed: results.every((item) => { const arm = item.arms.find((candidate) => candidate.arm === 'B');
      if (!arm) return true; const comparisons = arm.qualification?.humanComparisons ?? [];
      const gating = comparisons.filter((comparison) => comparison.gating);
      return arm.qualification?.reality?.passed === true && gating.length > 0
        && gating.every((comparison) => comparison.passed); }),
    humanBlindEvaluation: 'PENDING', productPromotion: 'NOT_EVALUATED' };
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(payload, null, 2));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
