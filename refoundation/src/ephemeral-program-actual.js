import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { publishAtomicFile } from './atomic-file-publication.js';
import { assertQualifiedEphemeralProgramFixture,
  evaluateQuickJsInManagedHelper } from './ephemeral-program-quickjs.js';

const ATTEMPTED = new WeakSet();
const EXECUTED = new WeakSet();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function strictUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
  catch { return null; }
}

async function exactSource(qualification) {
  const prepared = qualification.prepared;
  const bytes = await readFile(join(prepared.directory, prepared.manifest.source.file));
  if (bytes.length !== prepared.manifest.source.bytes || sha256(bytes) !== qualification.sourceSha256) {
    throw new Error('qualified capsule source changed');
  }
  return strictUtf8(bytes);
}

async function reopenInputs({ qualification, sourceReader }) {
  if (!sourceReader?.reopen) throw new TypeError('record source reader required');
  const values = [];
  for (const reference of qualification.prepared.manifest.inputs) {
    const observed = await sourceReader.reopen(reference, {
      expectedSessionId: reference.scope.sessionId,
      ...(reference.scope.workId == null ? {} : { expectedWorkId: qualification.prepared.manifest.workId }),
    });
    if (observed.state !== 'reopened' || observed.accounting?.digestMatched !== true
      || !Buffer.isBuffer(observed.source)) return { state: observed.state, values: null };
    const text = strictUtf8(observed.source); if (text == null) return { state: 'unsupported_encoding', values: null };
    values.push({ recordId: reference.recordId, sourceRevision: reference.sourceRevision,
      sha256: reference.sha256, text });
  }
  return { state: 'reopened', values };
}

export async function executeEphemeralProgramActual({ qualification: rawQualification,
  sourceReader, processRegistry, signal = null, publish = publishAtomicFile,
  makeId = randomUUID } = {}) {
  const qualification = assertQualifiedEphemeralProgramFixture(rawQualification);
  if (ATTEMPTED.has(qualification)) throw new TypeError('actual execution already attempted');
  ATTEMPTED.add(qualification);
  const source = await exactSource(qualification);
  if (source == null) return { execution: null, receipt: { state: 'actual_failed_no_effect',
    reason: 'source_not_utf8', actualExecutions: 0, userTargetWrites: 0 } };
  const before = await reopenInputs({ qualification, sourceReader });
  if (before.state !== 'reopened') return { execution: null, receipt: { state: 'actual_failed_no_effect',
    reason: `input_${before.state}`, actualExecutions: 0, userTargetWrites: 0 } };
  const input = JSON.stringify({ schema: 't5.ephemeral-program-input.v1', inputs: before.values });
  if (Buffer.byteLength(input) > 1024 * 1024) return { execution: null, receipt: {
    state: 'actual_failed_no_effect', reason: 'input_limit', actualExecutions: 0, userTargetWrites: 0 } };
  const evaluated = await evaluateQuickJsInManagedHelper({ processRegistry,
    ownerId: qualification.prepared.manifest.workId, source, input, limits: qualification.limits,
    signal, makeId });
  if (evaluated.state !== 'completed') return { execution: null, receipt: {
    state: 'actual_failed_no_effect', reason: evaluated.reason,
    helperBoundary: evaluated.boundary, actualExecutions: 1, userTargetWrites: 0 } };
  await exactSource(qualification);
  const after = await reopenInputs({ qualification, sourceReader });
  if (after.state !== 'reopened' || JSON.stringify(after.values.map((item) => item.sha256))
    !== JSON.stringify(before.values.map((item) => item.sha256))) return { execution: null, receipt: {
    state: 'actual_failed_no_effect', reason: 'input_changed_after_execution',
    helperBoundary: evaluated.boundary, actualExecutions: 1, userTargetWrites: 0 } };
  const outputBytes = Buffer.from(evaluated.value); const directory = join(qualification.prepared.directory, 'actual');
  await mkdir(directory, { mode: 0o700 });
  const published = await publish({ target: join(directory, 'output.candidate.json'), bytes: outputBytes,
    expectedPreimage: null, mode: 0o600 });
  if (published.state !== 'published') return { execution: null, receipt: {
    state: 'actual_effect_unknown', reason: 'candidate_durability_unknown',
    outputSha256: sha256(outputBytes), helperBoundary: evaluated.boundary,
    actualExecutions: 1, userTargetWrites: 0 } };
  const execution = Object.freeze({ schema: 't5.ephemeral-program-actual-output.v1', qualification,
    outputPath: published.target, outputSha256: published.sha256, outputBytes: published.bytes,
    inputFacts: before.values.map(({ recordId, sourceRevision, sha256: digest }) => (
      { recordId, sourceRevision, sha256: digest })), state: 'actual_output_unverified' });
  EXECUTED.add(execution);
  return { execution, receipt: { state: 'actual_output_unverified', capsuleId: qualification.prepared.manifest.capsuleId,
    workId: qualification.prepared.manifest.workId, revision: qualification.prepared.manifest.revision,
    sourceSha256: qualification.sourceSha256, interpreter: qualification.interpreter,
    inputCount: before.values.length, outputSha256: published.sha256, outputBytes: published.bytes,
    helperBoundary: evaluated.boundary, actualExecutions: 1, userTargetWrites: 0 } };
}

export function assertExecutedEphemeralProgram(value) {
  if (!EXECUTED.has(value) || value.state !== 'actual_output_unverified') {
    throw new TypeError('fresh unverified ephemeral program output required');
  }
  return value;
}
