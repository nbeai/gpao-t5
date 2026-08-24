import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveResourceAnomalyCandidate } from '../src/resource-anomaly-shadow.js';
import { ResourceController } from '../src/resource-controller.js';
import { evidenceFingerprint } from '../src/resource-evidence.js';
import { ResourceLedger } from '../src/resource-ledger.js';
import { deriveResourceReport } from '../src/resource-report.js';

const room = () => mkdtemp(join(tmpdir(), 't5-resource-anomaly-'));

function context(requestBytes, functionOutputBytes = 0, functionOutputItems = 0) {
  return {
    requestBytes, input: {
      bytes: requestBytes - 10,
      byKind: { function_call_output: { bytes: functionOutputBytes, items: functionOutputItems } },
    },
    instructionsBytes: 5, tools: { bytes: 5 }, source: { bytes: requestBytes - 20, messages: 2 },
  };
}

async function modelCall(run, index, receipt) {
  const observer = run.modelObserver({ logicalCallId: `main:${index}`, purpose: 'main' });
  const handle = await observer.reserve({
    provider: 'fixture', model: 'model', attempt: 1, contextReceipt: receipt,
  });
  await observer.commit(handle, {
    usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 }, responseId: `response-${index}`,
  });
}

test('anomaly shadow는 고정 상한 없이 병적·효율·신뢰성 후보의 관측 근거만 분리한다', () => {
  const pathology = deriveResourceAnomalyCandidate({
    modelCalls: 3, toolCalls: 2, novelEvidence: 1, repeatedEvidence: 1,
    intervalsWithoutNewEvidence: 1, repeatedEvidenceOnlyIntervals: 1,
    contextGrowthWithoutNewEvidenceBytes: 100, requestProjectionGrowthBytes: 100,
    priorFunctionOutputBytesAtNondecreasingProjection: 50,
  });
  assert.equal(pathology.category, 'pathology_candidate');
  assert.equal(pathology.intervention, false);
  assert.deepEqual(pathology.signals, [
    'model_interval_without_new_evidence', 'repeated_evidence_only',
    'context_growth_without_new_evidence', 'request_projection_growth',
    'function_output_projection_nondecreasing',
  ]);

  const efficiency = deriveResourceAnomalyCandidate({
    modelCalls: 11, toolCalls: 10, novelEvidence: 10,
    requestProjectionGrowthBytes: 100_000,
    priorFunctionOutputBytesAtNondecreasingProjection: 250_000,
  });
  assert.equal(efficiency.category, 'efficiency_candidate');
  assert.deepEqual(efficiency.signals, [
    'request_projection_growth', 'function_output_projection_nondecreasing',
  ]);

  const reliability = deriveResourceAnomalyCandidate({
    modelCalls: 1, retryAttempts: 1, unknownSettlements: 1,
  });
  assert.equal(reliability.category, 'reliability_candidate');
  assert.equal(reliability.signals.includes('provider_retry_observed'), true);
  assert.equal(reliability.signals.includes('usage_unknown'), true);
});

test('의도된 cancel unknown은 pathology가 아니라 reliability 후보로만 남는다', async () => {
  const ledger = new ResourceLedger(await room());
  const run = await new ResourceController(ledger).startRun({ sessionId: 'cancel', runId: 'cancel-run' });
  const observer = run.modelObserver({ logicalCallId: 'main:1', purpose: 'main' });
  const handle = await observer.reserve({
    provider: 'fixture', model: 'model', attempt: 1, contextReceipt: context(100),
  });
  await observer.unknown(handle, { reason: 'provider_transport_unknown', facts: { aborted: true } });
  await run.close('cancelled');
  const report = deriveResourceReport(await ledger.read());
  assert.equal(report.pathologyCandidates, 0);
  assert.equal(report.reliabilityCandidates, 1);
});

test('Evidence fingerprint는 volatile receipt identity를 무시하고 원문 digest를 ledger에 남기지 않는다', () => {
  const first = evidenceFingerprint({
    outcome: 'succeeded', actualCall: { name: 'web_read' },
    result: { state: 'observed', title: '같은 사실', messageId: 'one', recordedAt: 'first' },
  });
  const second = evidenceFingerprint({
    outcome: 'succeeded', actualCall: { name: 'web_read' },
    result: { title: '같은 사실', state: 'observed', messageId: 'two', recordedAt: 'second' },
  });
  assert.equal(first, second);
  assert.equal(evidenceFingerprint({ outcome: 'failed', actualCall: { name: 'web_read' } }), null);
});

test('같은 Evidence만 반복되며 Context가 자라면 Run 종료에 content-free pathology 후보를 남긴다', async () => {
  const directory = await room();
  const ledger = new ResourceLedger(directory);
  const run = await new ResourceController(ledger).startRun({ sessionId: 'session', runId: 'run' });
  await modelCall(run, 1, context(100));
  await run.observeTool({
    turn: 1, toolCallId: 'tool-1', name: 'web_read', outcome: 'succeeded',
    startedAt: Date.now(), evidenceFingerprint: 'same-evidence',
  });
  await modelCall(run, 2, context(200, 50, 1));
  await run.observeTool({
    turn: 2, toolCallId: 'tool-2', name: 'web_read', outcome: 'succeeded',
    startedAt: Date.now(), evidenceFingerprint: 'same-evidence',
  });
  await modelCall(run, 3, context(300, 50, 1));
  await run.close('completed');

  const events = await ledger.read();
  const anomaly = events.find((event) => event.type === 'AnomalyRecorded');
  assert.equal(anomaly.payload.category, 'pathology_candidate');
  assert.equal(anomaly.payload.shadow, true);
  assert.equal(anomaly.payload.intervention, false);
  assert.equal(anomaly.payload.metrics.novelEvidence, 1);
  assert.equal(anomaly.payload.metrics.repeatedEvidence, 1);
  assert.equal(anomaly.payload.metrics.contextGrowthWithoutNewEvidenceBytes, 100);
  assert.equal(anomaly.payload.metrics.priorFunctionOutputBytesAtNondecreasingProjection, 50);
  assert.doesNotMatch(JSON.stringify(events), /same-evidence|같은 사실/u);
  assert.equal(deriveResourceReport(events).pathologyCandidates, 1);
});

test('11 model·10 tool의 긴 연구도 매 구간 새 Evidence가 있으면 병적으로 판정하지 않는다', async () => {
  const ledger = new ResourceLedger(await room());
  const run = await new ResourceController(ledger).startRun({ sessionId: 'long', runId: 'research' });
  for (let index = 1; index <= 11; index += 1) {
    await modelCall(run, index, context(100 * index, 40 * (index - 1), index - 1));
    if (index <= 10) await run.observeTool({
      turn: index, toolCallId: `tool-${index}`, name: 'web_read', outcome: 'succeeded',
      startedAt: Date.now(), evidenceFingerprint: `new-evidence-${index}`,
    });
  }
  await run.close('completed');
  const events = await ledger.read();
  const anomaly = events.find((event) => event.type === 'AnomalyRecorded');
  assert.equal(anomaly.payload.category, 'efficiency_candidate');
  assert.deepEqual(anomaly.payload.signals, [
    'request_projection_growth', 'function_output_projection_nondecreasing',
  ]);
  assert.equal(anomaly.payload.metrics.modelCalls, 11);
  assert.equal(anomaly.payload.metrics.novelEvidence, 10);
  assert.equal(deriveResourceReport(events).pathologyCandidates, 0);
});

test('A0 19-Run·107-call exact curve는 일찍 효율 후보가 되지만 원본 없이 runaway로 단정하지 않는다', async () => {
  const fixture = JSON.parse(await readFile(new URL(
    '../config/s2-incident-reference-fixtures.json', import.meta.url,
  ), 'utf8'));
  const ledger = new ResourceLedger(await room());
  const controller = new ResourceController(ledger);
  let evidenceIndex = 0;
  for (const source of fixture.resourceRunaway.runs) {
    const run = await controller.startRun({ sessionId: 'a0', runId: source.runRef });
    for (const [index, call] of source.calls.entries()) {
      for (let item = 0; item < call[2]; item += 1) {
        evidenceIndex += 1;
        await run.observeTool({
          turn: index, toolCallId: `a0-tool-${evidenceIndex}`, name: 'observed_tool',
          outcome: 'succeeded', startedAt: Date.now(), evidenceFingerprint: `a0-evidence-${evidenceIndex}`,
        });
      }
      await modelCall(run, index + 1, context(call[1]));
    }
    await run.close(source.status);
  }
  const events = await ledger.read();
  const anomalies = events.filter((event) => event.type === 'AnomalyRecorded');
  const multiCallRuns = fixture.resourceRunaway.runs.filter((run) => run.calls.length > 1).length;
  assert.equal(fixture.resourceRunaway.runs.reduce((sum, run) => sum + run.calls.length, 0), 107);
  assert.equal(anomalies.length, multiCallRuns);
  assert.equal(anomalies.every((event) => event.payload.category === 'efficiency_candidate'), true);
  assert.equal(anomalies.every((event) => event.payload.metrics.firstEfficiencyCandidateModelCall === 2), true);
  assert.equal(anomalies.every((event) => event.payload.metrics.firstPathologyCandidateModelCall === 0), true);
  assert.equal(deriveResourceReport(events).pathologyCandidates, 0);
});

test('A1-2 Core는 macOS·Windows·WSL process 사실을 anomaly identity로 사용하지 않는다', async () => {
  const [shadow, controller] = await Promise.all([
    readFile(new URL('../src/resource-anomaly-shadow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/resource-controller.js', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(`${shadow}\n${controller}`, /darwin|win32|WSL|SIGTERM|SIGKILL|\/Users\//u);
  assert.doesNotMatch(shadow, /warningThreshold|criticalThreshold|circuitBreaker|stop|abort/u);
});
