import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

import { publishAtomicFile } from './atomic-file-publication.js';
import { validateRecordReference } from './record-reference.js';

const ADMISSIONS = new WeakSet();
const PREPARED = new WeakSet();
const ORACLE_PROVENANCE = new Set([
  'user_declared_fact', 'runtime_deterministic_fact', 'independent_observer_contract',
]);
const OUTPUT_CATEGORIES = new Set([
  'publishable', 'internal_intermediate', 'diagnostic', 'temporary',
]);
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_FIXTURE_BYTES = 1024 * 1024;
const MAX_ORACLE_BYTES = 1024 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function exactObject(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const keys = Object.keys(value); if (keys.length !== fields.length
    || keys.some((key) => !fields.includes(key))) throw new TypeError(`${label} fields are invalid`);
  return value;
}

function text(value, label, maximum = 256) {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0 || value.length > maximum
    || /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${label} must be bounded text`);
  return value;
}

function bytes(value, label, maximum) {
  const result = Buffer.isBuffer(value) ? Buffer.from(value)
    : value instanceof Uint8Array ? Buffer.from(value) : typeof value === 'string' ? Buffer.from(value) : null;
  if (!result || result.length === 0 || result.length > maximum) {
    throw new TypeError(`${label} must be bounded non-empty bytes`);
  }
  return result;
}

function safeRelativePath(value, label) {
  const path = text(value, label, 1000).replaceAll('\\', '/');
  if (path.startsWith('/') || /^[A-Za-z]:\//u.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} must stay inside the declared output root`);
  }
  return path;
}

function sourceFileName(value) {
  const name = text(value, 'source.fileName', 160);
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new TypeError('source.fileName must be one filename');
  }
  const extension = extname(name);
  return extension && /^\.[A-Za-z0-9]{1,12}$/u.test(extension) ? `program${extension.toLowerCase()}` : 'program.source';
}

function generationId(value) {
  const generation = String(value ?? '').replaceAll('-', '_');
  if (!/^[A-Za-z0-9_]{8,200}$/u.test(generation)) throw new TypeError('preparation generation is invalid');
  return generation;
}

function inputs(values, workId) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 64) {
    throw new TypeError('capsule inputs must be a bounded non-empty array');
  }
  const references = values.map(validateRecordReference);
  if (new Set(references.map((item) => item.recordId)).size !== references.length) {
    throw new TypeError('capsule inputs must be unique');
  }
  for (const reference of references) {
    if (reference.availability !== 'available' || reference.sha256 == null || reference.sourceRevision == null) {
      throw new TypeError('capsule input must have an available exact revision and digest');
    }
    if (['secret_ref', 'never_store'].includes(reference.sensitivity)) {
      throw new TypeError('capsule input cannot be a secret or never-store source');
    }
    if (reference.scope.workId != null && reference.scope.workId !== workId) {
      throw new TypeError('capsule input belongs to another Work');
    }
  }
  return references;
}

function outputs(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 32) {
    throw new TypeError('capsule outputs must be a bounded non-empty array');
  }
  const normalized = values.map((value) => {
    exactObject(value, ['relativePath', 'kind', 'category'], 'capsule output');
    const category = text(value.category, 'output.category', 64);
    if (!OUTPUT_CATEGORIES.has(category)) throw new TypeError('output category is unsupported');
    return { relativePath: safeRelativePath(value.relativePath, 'output.relativePath'),
      kind: text(value.kind, 'output.kind', 128), category,
      cleanupRequired: category !== 'publishable' };
  });
  if (new Set(normalized.map((item) => item.relativePath)).size !== normalized.length) {
    throw new TypeError('capsule output paths must be unique');
  }
  return normalized;
}

export function admitEphemeralProgramPreparation(input) {
  exactObject(input, ['capsuleId', 'workId', 'revision', 'source', 'fixture', 'oracle', 'inputs', 'outputs'],
    'capsule preparation');
  exactObject(input.source, ['fileName', 'bytes'], 'capsule source');
  exactObject(input.fixture, ['bytes'], 'capsule fixture');
  exactObject(input.oracle, ['bytes', 'provenance'], 'capsule oracle');
  const capsuleId = text(input.capsuleId, 'capsuleId'); const workId = text(input.workId, 'workId');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new TypeError('capsule revision is invalid');
  const provenance = text(input.oracle.provenance, 'oracle.provenance', 64);
  if (!ORACLE_PROVENANCE.has(provenance)) throw new TypeError('capsule oracle provenance is not independent');
  const admission = {
    schema: 't5.ephemeral-program-preparation-admission.v1', capsuleId, workId, revision: input.revision,
    source: { fileName: sourceFileName(input.source.fileName),
      bytes: bytes(input.source.bytes, 'source.bytes', MAX_SOURCE_BYTES) },
    fixture: { bytes: bytes(input.fixture.bytes, 'fixture.bytes', MAX_FIXTURE_BYTES) },
    oracle: { bytes: bytes(input.oracle.bytes, 'oracle.bytes', MAX_ORACLE_BYTES), provenance },
    inputs: inputs(input.inputs, workId), outputs: outputs(input.outputs), state: 'admitted',
  };
  ADMISSIONS.add(admission); return admission;
}

async function publishCandidate({ target, bytes: content, publish }) {
  const result = await publish({ target, bytes: content, expectedPreimage: null, mode: 0o600 });
  if (result.state !== 'published') throw new Error('capsule scratch publication is not durable');
  const reopened = await readFile(target); const digest = sha256(reopened);
  if (digest !== sha256(content) || result.sha256 !== digest) throw new Error('capsule scratch digest mismatch');
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.mode & 0o077) throw new Error('capsule scratch file mode is unsafe');
  return { sha256: digest, bytes: reopened.length };
}

export async function prepareEphemeralProgram({ admission, scratchRoot: rootValue,
  makeId = randomUUID, publish = publishAtomicFile } = {}) {
  if (!ADMISSIONS.has(admission) || admission.state !== 'admitted') {
    throw new TypeError('fresh capsule preparation admission required');
  }
  const scratchRoot = resolve(rootValue); await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const scratchIdentity = await lstat(scratchRoot);
  if (!scratchIdentity.isDirectory() || scratchIdentity.isSymbolicLink()) {
    throw new Error('capsule scratch root is not a managed directory');
  }
  await chmod(scratchRoot, 0o700); const canonicalRoot = await realpath(scratchRoot);
  const generation = generationId(makeId());
  const directory = join(canonicalRoot, `capsule_${generation}`);
  await mkdir(directory, { mode: 0o700 });
  try {
    await mkdir(join(directory, 'source'), { mode: 0o700 });
    await mkdir(join(directory, 'fixture'), { mode: 0o700 });
    const sourcePath = join(directory, 'source', admission.source.fileName);
    const fixturePath = join(directory, 'fixture', 'input.fixture');
    const oraclePath = join(directory, 'fixture', 'expected.oracle');
    const outputsPath = join(directory, 'outputs.json');
    const source = await publishCandidate({ target: sourcePath, bytes: admission.source.bytes, publish });
    const fixture = await publishCandidate({ target: fixturePath, bytes: admission.fixture.bytes, publish });
    const oracle = await publishCandidate({ target: oraclePath, bytes: admission.oracle.bytes, publish });
    const outputBytes = Buffer.from(JSON.stringify(admission.outputs));
    const outputDeclaration = await publishCandidate({ target: outputsPath, bytes: outputBytes, publish });
    const manifest = {
      schema: 't5.ephemeral-program-prepared.v1', capsuleId: admission.capsuleId,
      workId: admission.workId, revision: admission.revision,
      source: { file: `source/${admission.source.fileName}`, ...source },
      fixture: { input: { file: 'fixture/input.fixture', ...fixture },
        oracle: { file: 'fixture/expected.oracle', provenance: admission.oracle.provenance, ...oracle } },
      inputs: admission.inputs, outputs: admission.outputs,
      outputDeclaration: { file: 'outputs.json', ...outputDeclaration }, state: 'prepared',
    };
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    const manifestFile = await publishCandidate({ target: join(directory, 'manifest.json'),
      bytes: manifestBytes, publish });
    const prepared = { schema: 't5.ephemeral-program-prepared-runtime.v1', directory,
      manifest: { ...manifest, manifestFile }, state: 'prepared' };
    PREPARED.add(prepared); admission.state = 'prepared';
    return { prepared, receipt: { state: 'prepared', capsuleId: admission.capsuleId,
      workId: admission.workId, revision: admission.revision,
      source: { sha256: source.sha256, bytes: source.bytes },
      fixture: { inputSha256: fixture.sha256, oracleSha256: oracle.sha256,
        oracleProvenance: admission.oracle.provenance },
      inputCount: admission.inputs.length, outputCount: admission.outputs.length,
      outputCategories: Object.fromEntries([...OUTPUT_CATEGORIES].map((category) => [category,
        admission.outputs.filter((item) => item.category === category).length])),
      targetWrites: 0, fixtureExecutions: 0, actualExecutions: 0,
      networkCalls: 0, packageInstalls: 0, credentialReads: 0 } };
  } catch (error) {
    admission.state = 'preparation_failed';
    let cleaned = false;
    try { await rm(directory, { recursive: true, force: true });
      await stat(directory); }
    catch (cleanupError) { cleaned = cleanupError?.code === 'ENOENT'; }
    if (!cleaned) {
      admission.state = 'cleanup_unknown';
      throw Object.assign(new Error('capsule preparation cleanup is unknown'), {
        code: 'capsule_preparation_cleanup_unknown', cause: error,
      });
    }
    throw error;
  }
}

export function assertPreparedEphemeralProgram(value) {
  if (!PREPARED.has(value) || value.state !== 'prepared') {
    throw new TypeError('fresh prepared ephemeral program required');
  }
  return value;
}
