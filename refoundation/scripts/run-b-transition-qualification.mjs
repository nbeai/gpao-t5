#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeConsoleServer } from '../src/console-server.js';
import {
  assessBQualificationCase, selectBQualificationCases, validateBHoldout,
} from '../src/b-transition-qualification.js';

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? null : process.argv[index + 1]; }
const holdoutPath = option('--holdout');
if (!holdoutPath) throw new Error('--holdout is required; qualification expressions must not live in this source');
const repeats = Number(option('--repeats') ?? 2); const requestedModel = option('--model-id');
const onePerState = process.argv.includes('--one-per-state');
const keep = process.argv.includes('--keep'); const requestedCaseId = option('--case-id');
const caseTimeoutMs = Number(option('--case-timeout-ms') ?? 120_000);
const holdoutBytes = await readFile(resolve(holdoutPath)); const holdout = JSON.parse(holdoutBytes);
if (!Number.isInteger(repeats) || repeats < 1) {
  throw new Error('valid holdout cases and repeats are required');
}
validateBHoldout(holdout);

const sourceConnectionFile = resolve(process.env.T5_REFOUNDATION_MODEL_CONNECTION_FILE
  ?? join(homedir(), '.local', 'state', 'gpao-t5', 'sessions', 'model-connection.json'));
const models = requestedModel ? [requestedModel]
  : ['api_key:openai:gpt-5.6-terra', 'chatgpt_oauth:gpt-5.5'];
let cases = selectBQualificationCases(holdout.cases, { onePerState });
if (requestedCaseId) cases = cases.filter((item) => item.id === requestedCaseId);
const room = await mkdtemp(join(tmpdir(), 't5-b-semantic-live-')); const results = [];
async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen);
  }); return `http://127.0.0.1:${server.address().port}`;
}

for (const modelId of models) {
  const modelRoom = join(room, modelId.replaceAll(/[^a-z0-9.-]+/giu, '_'));
  const stateDir = join(modelRoom, 'state'); const workspace = join(modelRoom, 'workspace');
  await Promise.all([mkdir(stateDir, { recursive: true }), mkdir(workspace, { recursive: true })]);
  const stored = JSON.parse(await readFile(sourceConnectionFile, 'utf8')); stored.activeId = modelId;
  const connectionFile = join(modelRoom, 'model-connection.json');
  await writeFile(connectionFile, JSON.stringify(stored), { mode: 0o600 });
  const access = makeConsoleModelAccess({ connectionFile, stateDir }); const scenarios = new Map();
  const server = makeConsoleServer({ stateDir, workspace, modelStatus: () => access.status(),
    modelFactory: async (context) => {
      const actual = await access.model(context); const scenario = scenarios.get(context.sessionId);
      if (!scenario || scenario.initialModelCreated) return actual;
      scenario.initialModelCreated = true; let first = true;
      return { async respond(input) {
        if (first) { first = false; scenario.started(); }
        return actual.respond(input);
      }, supersedeLastResponse: () => actual.supersedeLastResponse?.() };
    } });
  const base = await listen(server);
  try {
    qualification: for (const item of cases) for (let repeat = 1; repeat <= repeats; repeat += 1) {
      const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
      let started; const startedPromise = new Promise((resolveStarted) => { started = resolveStarted; });
      scenarios.set(session.id, { started, initialModelCreated: false }); const began = performance.now();
      const first = await fetch(`${base}/turn/stream-start`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          sessionId: session.id, text: item.initialRequest,
        }) }).then((response) => response.json());
      const streamController = new AbortController(); let monitoring = true;
      const firstStream = fetch(`${base}/turn/stream?streamId=${first.streamId}`, {
        signal: streamController.signal,
      }).then((response) => response.text());
      await startedPromise;
      const admittedResponse = await fetch(`${base}/turn/stream-start`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({
          sessionId: session.id, text: item.admittedText,
        }) });
      const admitted = await admittedResponse.json();
      const expectedRuns = item.expectedRuns;
      const monitor = (async () => {
        while (monitoring) {
          for (const run of await server.runLedger.list({ sessionId: session.id })) {
            if (run.status === 'failed') throw new Error('run_failed');
            if (run.events.some((event) => event.type === 'tool_completed'
              && event.payload?.receipt?.outcome === 'failed')) throw new Error('tool_failed');
            if (run.status !== 'running') {
              const state = await server.workStore.read(); const observed = state.inputs
                .find((candidate) => candidate.inputId === admitted.inputId);
              if (observed && !['executed', 'scheduled', 'classified', 'executing'].includes(observed.state)) {
                throw new Error('input_no_progress_after_terminal_run');
              }
            }
          }
          await new Promise((resolveWait) => setTimeout(resolveWait, 25));
        }
        return null;
      })();
      let earlyFailure = null;
      try {
        const streamWire = await Promise.race([firstStream, monitor, new Promise((_, reject) => setTimeout(
          () => reject(new Error('case_timeout')), caseTimeoutMs,
        ))]);
        if (typeof streamWire === 'string' && (/event: recoverable_error/u.test(streamWire)
          || /"kind":"error"/u.test(streamWire))) throw new Error('stream_error');
      } catch (error) { earlyFailure = error; streamController.abort(); }
      finally { monitoring = false; }
      let input = null;
      while (!earlyFailure && performance.now() - began < caseTimeoutMs) {
        input = (await server.workStore.read()).inputs.find((candidate) => candidate.inputId === admitted.inputId);
        const observedRuns = await server.runLedger.list({ sessionId: session.id });
        const observedWork = await server.workStore.read();
        const deliveredRuns = observedWork.results.filter((result) => observedRuns.some((run) => run.runId === result.runId)
          && result.state === 'delivery_terminal').length;
        if (input?.state === 'executed' && observedRuns.length === expectedRuns
          && deliveredRuns === expectedRuns) break;
        if (observedRuns.some((run) => run.status === 'failed'
          || run.events.some((event) => event.type === 'tool_completed'
            && event.payload?.receipt?.outcome === 'failed'))) {
          earlyFailure = new Error('followup_run_failed'); break;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      if (!earlyFailure && input?.state !== 'executed') earlyFailure = new Error('input_not_terminal');
      const sessionState = await fetch(`${base}/sessions/${session.id}`).then((response) => response.json());
      const surfaces = (sessionState.transcript ?? []).filter((entry) => entry.role === 'assistant')
        .map((entry) => entry.result?.reply ?? '');
      const workState = await server.workStore.read(); const sessionWorks = workState.works
        .filter((work) => work.sessionId === session.id);
      const runs = await server.runLedger.list({ sessionId: session.id });
      const sessionWorkIds = new Set(sessionWorks.map((work) => work.workId));
      const sessionRunIds = new Set(runs.map((run) => run.runId));
      const scopedWorkState = {
        works: sessionWorks,
        results: workState.results.filter((result) => sessionRunIds.has(result.runId)),
        events: workState.events.filter((event) => sessionWorkIds.has(event.workId)
          || sessionRunIds.has(event.runId) || event.inputId === admitted.inputId),
      };
      const modelEvents = runs.flatMap((run) => run.events.filter((event) => event.type === 'model_completed'));
      const toolEvents = runs.flatMap((run) => run.events.filter((event) => event.type === 'tool_completed'));
      const usage = modelEvents.reduce((sum, event) => ({
        inputTokens: sum.inputTokens + Number(event.payload?.response?.usage?.input_tokens ?? 0),
        outputTokens: sum.outputTokens + Number(event.payload?.response?.usage?.output_tokens ?? 0),
        totalTokens: sum.totalTokens + Number(event.payload?.response?.usage?.total_tokens ?? 0),
      }), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
      const controlCalls = toolEvents.filter((event) => (
        event.payload?.receipt?.requestedCall?.name === 'work_control'
      ));
      const actualControl = controlCalls.at(-1)?.payload?.receipt?.requestedCall?.args?.action ?? null;
      const assessment = assessBQualificationCase(item, {
        admittedStatus: admittedResponse.status, actualControl, input,
        surfaces, workState: scopedWorkState, runs,
      });
      const passed = !earlyFailure && assessment.passed;
      const toolTrace = toolEvents.map((event) => ({
        name: event.payload?.receipt?.requestedCall?.name ?? null,
        action: event.payload?.receipt?.requestedCall?.args?.action ?? null,
        outcome: event.payload?.receipt?.outcome ?? null,
        resultState: event.payload?.receipt?.result?.state ?? null,
      }));
      const runTrace = [...runs].toSorted((left, right) => left.startedAt.localeCompare(right.startedAt)).map((run) => ({
        runId: run.runId, trigger: run.metadata?.trigger ?? null, status: run.status,
        modelCalls: run.events.filter((event) => event.type === 'model_completed').length,
        toolCalls: run.events.filter((event) => event.type === 'tool_completed').length,
      }));
      results.push({ modelId, caseId: item.id, state: item.state, repeat, expectedControl: item.expectedControl,
        actualControl, inputDisposition: input?.disposition ?? null, inputState: input?.state ?? null,
        works: sessionWorks.length, runs: runs.length, modelCalls: modelEvents.length,
        toolCalls: toolEvents.length, usage, wallMs: Number((performance.now() - began).toFixed(3)),
        checks: assessment.checks, diagnostics: { ...assessment.diagnostics,
          surfaceChars: surfaces.map((surface) => surface.length), toolTrace, runTrace },
        failure: earlyFailure?.message ?? null, passed });
      process.stderr.write(`${JSON.stringify({ progress: true, modelId, state: item.state,
        repeat, passed, wallMs: Number((performance.now() - began).toFixed(3)) })}\n`);
      if (earlyFailure) break qualification;
    }
  } finally {
    await server.closeMessengers(); server.closeWakeStreams(); server.closeModelConnections(); await server.closeBrowsers();
    await server.managedProcesses.stopAll('qualification_finished');
    await new Promise((resolveClose) => server.close(resolveClose));
  }
}
const report = { schema: 't5.s2-b-semantic-holdout-live.v1', recordedAt: new Date().toISOString(),
  holdoutSha256: createHash('sha256').update(holdoutBytes).digest('hex'), expressionsPrinted: false,
  results, passed: results.every((item) => item.passed), total: results.length,
  ...(keep ? { room } : {}), byModel: Object.fromEntries(models.map((modelId) => [modelId, {
    passed: results.filter((item) => item.modelId === modelId && item.passed).length,
    total: results.filter((item) => item.modelId === modelId).length,
  }])) };
await new Promise((resolveWrite) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, resolveWrite));
if (!keep) await rm(room, { recursive: true, force: true });
process.exit(report.passed ? 0 : 1);
