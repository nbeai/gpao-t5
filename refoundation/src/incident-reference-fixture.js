import { createHash } from 'node:crypto';

const SCHEMA = 't5.s2-incident-reference-fixture.v1';
const CONTENT_KEYS = new Set([
  'request', 'prompt', 'content', 'text', 'stdout', 'stderr', 'args', 'url', 'path',
  'secret', 'email', 'recipient', 'sessionId', 'runId',
]);

function clone(value) { return structuredClone(value); }
function finiteInteger(value) { return Number.isInteger(value) && value >= 0; }

function inspectPrivacy(value, path = '$', failures = []) {
  if (typeof value === 'string') {
    if (/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/iu.test(value)) {
      failures.push(`${path}: raw UUID`);
    }
    if (/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u.test(value)) failures.push(`${path}: email-like value`);
    return failures;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPrivacy(item, `${path}[${index}]`, failures));
    return failures;
  }
  if (!value || typeof value !== 'object') return failures;
  for (const [key, item] of Object.entries(value)) {
    if (CONTENT_KEYS.has(key)) failures.push(`${path}.${key}: content-bearing key`);
    inspectPrivacy(item, `${path}.${key}`, failures);
  }
  return failures;
}

export function summarizeIncidentResource(fixture) {
  const runs = fixture?.resourceRunaway?.runs ?? [];
  const summary = {
    runs: runs.length, originRuns: 0, automationRuns: 0, modelCalls: 0,
    providerTokens: 0, requestBytes: 0, toolCalls: 0, browserCalls: 0,
    browserCallingRunTokens: 0, failedRuns: 0,
  };
  for (const run of runs) {
    if (run.relation === 'origin_conversation') summary.originRuns += 1;
    if (run.relation === 'automation_occurrence') summary.automationRuns += 1;
    if (run.status === 'failed') summary.failedRuns += 1;
    let runTokens = 0;
    let runBrowserCalls = 0;
    for (const call of run.calls ?? []) {
      const [tokens, requestBytes, toolReceipts, browserReceipts] = call;
      summary.modelCalls += 1;
      summary.providerTokens += Number(tokens) || 0;
      summary.requestBytes += Number(requestBytes) || 0;
      summary.toolCalls += Number(toolReceipts) || 0;
      summary.browserCalls += Number(browserReceipts) || 0;
      runTokens += Number(tokens) || 0;
      runBrowserCalls += Number(browserReceipts) || 0;
    }
    summary.toolCalls += Number(run.terminalToolReceipts) || 0;
    summary.browserCalls += Number(run.terminalBrowserReceipts) || 0;
    runBrowserCalls += Number(run.terminalBrowserReceipts) || 0;
    if (runBrowserCalls > 0) summary.browserCallingRunTokens += runTokens;
  }
  return summary;
}

export function assessIncidentReplay(fixture) {
  const failures = [];
  if (fixture?.schema !== SCHEMA) failures.push('schema');
  if (fixture?.source?.contentFree !== true) failures.push('source_not_content_free');
  if (!finiteInteger(fixture?.source?.rawFiles) || !finiteInteger(fixture?.source?.rawBytes)
    || !/^[0-9a-f]{64}$/u.test(fixture?.source?.rawDigestSetSha256 ?? '')) failures.push('source_identity');
  const privacy = inspectPrivacy(fixture);
  if (privacy.length) failures.push('privacy');

  const refs = new Set();
  let rawBytes = 0;
  const rawDigests = [];
  for (const run of fixture?.resourceRunaway?.runs ?? []) {
    if (!/^run-[0-9]{2}$/u.test(run.runRef ?? '') || refs.has(run.runRef)) failures.push('run_identity');
    refs.add(run.runRef);
    if (!finiteInteger(run.sourceBytes) || !/^[0-9a-f]{64}$/u.test(run.sourceSha256 ?? '')) {
      failures.push('run_source_identity');
    } else {
      rawBytes += run.sourceBytes;
      rawDigests.push(run.sourceSha256);
    }
    if (!['origin_conversation', 'automation_occurrence'].includes(run.relation)
      || !['completed', 'failed', 'cancelled'].includes(run.status)
      || !Array.isArray(run.calls) || !run.calls.length) failures.push('run_shape');
    if (!finiteInteger(run.terminalToolReceipts ?? 0)
      || !finiteInteger(run.terminalBrowserReceipts ?? 0)
      || (run.terminalBrowserReceipts ?? 0) > (run.terminalToolReceipts ?? 0)) failures.push('run_shape');
    for (const call of run.calls ?? []) {
      if (!Array.isArray(call) || call.length !== 4 || !call.every(finiteInteger)
        || call[3] > call[2]) failures.push('call_shape');
    }
  }
  const digestSet = createHash('sha256').update(rawDigests.join('\n')).digest('hex');
  if (fixture?.source?.rawFiles !== refs.size || fixture?.source?.rawBytes !== rawBytes
    || fixture?.source?.rawDigestSetSha256 !== digestSet) failures.push('source_set_identity');

  const summary = summarizeIncidentResource(fixture);
  for (const [key, expected] of Object.entries(fixture?.resourceRunaway?.totals ?? {})) {
    if (summary[key] !== expected) failures.push(`total:${key}`);
  }
  const attribution = fixture?.resourceRunaway?.browserAttribution ?? {};
  if (attribution.directInputTokensApprox >= summary.providerTokens
    || attribution.repeatedReinjectionTokensApprox <= attribution.firstObservationTokensApprox
    || attribution.browserHistoryInputCallTokens > summary.providerTokens
    || attribution.causalIncrement !== null) failures.push('browser_attribution');

  const falseSuccess = fixture?.incidentFamilies?.automationFalseSuccess;
  if (falseSuccess?.schedulerStatus !== 'succeeded' || falseSuccess?.objectiveReceiptPresent !== false
    || falseSuccess?.purposeAchieved !== false) failures.push('automation_false_success');
  const admission = fixture?.incidentFamilies?.messageAdmissionLoss;
  if (admission?.offeredWhileRunActive !== true || admission?.persistedBeforeRejection !== false
    || admission?.durableFollowupCreated !== false) failures.push('message_admission_loss');
  const residual = fixture?.incidentFamilies?.processResidual;
  if (residual?.productEntryRetired !== true || residual?.residualObserved !== true
    || residual?.exactCount !== null) failures.push('process_residual');
  const scope = fixture?.source?.scopeResolution;
  if (scope?.measuredTargetRuns !== summary.runs || scope?.historyNarrativeRuns !== 20
    || scope?.authority !== 'exact_identity_set') failures.push('scope_resolution');

  return { passed: failures.length === 0, failures: [...new Set(failures)], summary, privacy };
}

export function assertIncidentFixture(fixture) {
  const result = assessIncidentReplay(fixture);
  if (!result.passed) throw new Error(`invalid incident fixture: ${result.failures.join(', ')}`);
  return clone(result);
}
