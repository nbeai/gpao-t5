import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { publishAtomicFile } from './atomic-file-publication.js';
import { assertExecutedEphemeralProgram } from './ephemeral-program-actual.js';
import { inspectDelimitedText } from './text-document-observer.js';

const VERIFIED = new WeakSet();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function decode(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'content,encoding,relativePath'
    || typeof value.relativePath !== 'string' || typeof value.content !== 'string') return null;
  try { return value.encoding === 'utf8' ? Buffer.from(value.content)
    : value.encoding === 'base64' ? Buffer.from(value.content, 'base64') : null; } catch { return null; }
}

function format(kind, bytes) {
  if (kind === 'application/json') {
    try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''));
      return { state: 'valid', kind }; } catch { return { state: 'invalid', kind }; }
  }
  if (kind === 'text/csv') {
    try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, '');
      const table = inspectDelimitedText(text); return { state: table.malformedQuotedField || table.irregularRows
        ? 'invalid' : 'valid', kind, rows: table.rowCount, columns: table.columnCount }; }
    catch { return { state: 'invalid', kind }; }
  }
  if (kind.startsWith('text/')) {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return { state: 'valid', kind }; }
    catch { return { state: 'invalid', kind }; }
  }
  return { state: 'not_structurally_validated', kind };
}

export async function observeEphemeralProgramOutput({ execution: rawExecution, relationVerifier,
  processRegistry = null, publish = publishAtomicFile } = {}) {
  const execution = assertExecutedEphemeralProgram(rawExecution); const declaration = execution.qualification.prepared.manifest.outputs;
  let candidate;
  try { candidate = JSON.parse(await readFile(execution.outputPath, 'utf8')); } catch { candidate = null; }
  if (!candidate || Object.keys(candidate).join(',') !== 'outputs' || !Array.isArray(candidate.outputs)
    || candidate.outputs.length > 32) return { verification: null, receipt: {
      state: 'output_unverified', reason: 'candidate_schema_invalid', userTargetWrites: 0 } };
  const decoded = candidate.outputs.map((item) => ({ item, bytes: decode(item) }));
  if (decoded.some((item) => item.bytes == null)) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'candidate_output_invalid', userTargetWrites: 0 } };
  const paths = decoded.map(({ item }) => item.relativePath);
  if (new Set(paths).size !== paths.length) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'duplicate_output', userTargetWrites: 0 } };
  const expected = declaration.map((item) => item.relativePath);
  const missing = expected.filter((path) => !paths.includes(path)); const unexpected = paths.filter((path) => !expected.includes(path));
  if (missing.length || unexpected.length) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'output_set_mismatch', missing: missing.length,
    unexpected: unexpected.length, userTargetWrites: 0 } };
  if (processRegistry?.list?.(execution.qualification.prepared.manifest.workId)
    .some((item) => !['completed', 'failed', 'stopped'].includes(item.state))) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'residual_process', userTargetWrites: 0 } };
  const observations = decoded.map(({ item, bytes }) => {
    const declared = declaration.find((entry) => entry.relativePath === item.relativePath);
    return { relativePath: item.relativePath, bytes, sha256: sha256(bytes), size: bytes.length,
      kind: declared.kind, category: declared.category, cleanupRequired: declared.cleanupRequired,
      format: format(declared.kind, bytes) };
  });
  if (observations.some((item) => item.format.state === 'invalid')) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'output_format_invalid', userTargetWrites: 0 } };
  if (typeof relationVerifier !== 'function') return { verification: null, receipt: {
    state: 'output_unverified', reason: 'relation_unverified', userTargetWrites: 0 } };
  const relation = await relationVerifier({ inputs: execution.inputFacts.map((item) => ({ ...item })),
    outputs: observations.map((item) => ({ relativePath: item.relativePath, bytes: Buffer.from(item.bytes),
      sha256: item.sha256, kind: item.kind, category: item.category })) });
  const inputDigests = execution.inputFacts.map((item) => item.sha256);
  const outputDigests = observations.map((item) => item.sha256);
  if (relation?.passed !== true || !same(relation.inputSha256s, inputDigests)
    || !same(relation.outputSha256s, outputDigests)) return { verification: null, receipt: {
    state: 'output_unverified', reason: 'relation_failed', userTargetWrites: 0 } };
  const directory = join(execution.qualification.prepared.directory, 'observed'); await mkdir(directory, { mode: 0o700 });
  for (const item of observations) {
    const target = join(directory, item.relativePath); await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const published = await publish({ target, bytes: item.bytes, expectedPreimage: null, mode: 0o600 });
    if (published.state !== 'published' || published.sha256 !== item.sha256
      || sha256(await readFile(target)) !== item.sha256) throw new Error('observed output publication failed');
    item.path = target; delete item.bytes;
  }
  const verification = Object.freeze({ schema: 't5.ephemeral-program-output-verified.v1', execution,
    outputs: observations, inputFacts: execution.inputFacts, relation: { passed: true }, state: 'output_verified' });
  VERIFIED.add(verification);
  return { verification, receipt: { state: 'output_verified', outputCount: observations.length,
    publishableCount: observations.filter((item) => item.category === 'publishable').length,
    cleanupRequiredCount: observations.filter((item) => item.cleanupRequired).length,
    inputCount: execution.inputFacts.length, userTargetWrites: 0 } };
}

export function assertVerifiedEphemeralProgramOutput(value) {
  if (!VERIFIED.has(value) || value.state !== 'output_verified') {
    throw new TypeError('fresh verified ephemeral program output required');
  }
  return value;
}
