import { createHash } from 'node:crypto';

import { validateRecordReference } from './record-reference.js';

const CONTRACTS = new WeakSet();
const LANGUAGES = new Set(['javascript', 'python']);
const CATEGORIES = new Set(['publishable', 'internal_intermediate', 'diagnostic', 'temporary']);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new TypeError(`${label} fields invalid`);
  }
  return value;
}

function text(value, label, maximum) {
  if (typeof value !== 'string' || !value || value.length > maximum || value.trim() !== value) {
    throw new TypeError(`${label} invalid`);
  }
  return value;
}

function sourceText(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1024 * 1024) {
    throw new TypeError('program source invalid');
  }
  return value;
}

function relativePath(value, label = 'program path') {
  const path = text(value, label, 1000).replaceAll('\\', '/');
  if (path.startsWith('/') || /^[A-Za-z]:\//u.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new TypeError(`${label} escaped`);
  }
  return path;
}

function inputBindings(values, workId) {
  if (!Array.isArray(values) || !values.length || values.length > 64) {
    throw new TypeError('program inputs invalid');
  }
  const bindings = values.map((value) => {
    exact(value, ['relativePath', 'recordRef'], 'program input');
    return { relativePath: relativePath(value.relativePath, 'program input path'),
      recordRef: validateRecordReference(value.recordRef) };
  });
  for (const { recordRef } of bindings) {
    if (recordRef.availability !== 'available' || recordRef.sha256 == null
      || recordRef.sourceRevision == null || ['secret_ref', 'never_store'].includes(recordRef.sensitivity)
      || recordRef.scope.workId !== workId) {
      throw new TypeError('program input is not exact current Work evidence');
    }
  }
  if (new Set(bindings.map(({ recordRef }) => recordRef.recordId)).size !== bindings.length
    || new Set(bindings.map(({ relativePath: path }) => path)).size !== bindings.length) {
    throw new TypeError('program inputs duplicated');
  }
  return bindings;
}

function outputs(values) {
  if (!Array.isArray(values) || !values.length || values.length > 32) {
    throw new TypeError('program outputs invalid');
  }
  const result = values.map((value) => {
    exact(value, ['relativePath', 'kind', 'category'], 'program output');
    const category = text(value.category, 'program output category', 128);
    if (!CATEGORIES.has(category)) throw new TypeError('program output category invalid');
    return { relativePath: relativePath(value.relativePath, 'program output path'),
      kind: text(value.kind, 'program output kind', 128), category };
  });
  if (new Set(result.map(({ relativePath: path }) => path)).size !== result.length) {
    throw new TypeError('program outputs duplicated');
  }
  return result;
}

export function admitExecProgramContract(input) {
  exact(input, ['workId', 'revision', 'temporary', 'sourceLanguage', 'source', 'inputs',
    'outputs', 'requirements', 'interpreter'], 'exec program contract');
  const workId = text(input.workId, 'workId', 256);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.temporary !== true) {
    throw new TypeError('temporary program identity invalid');
  }
  if (!LANGUAGES.has(input.sourceLanguage)) throw new TypeError('program language unsupported');
  const source = sourceText(input.source);
  const inputs = inputBindings(input.inputs, workId);
  const declaredOutputs = outputs(input.outputs);
  const occupied = ['program.py', ...inputs.map((item) => item.relativePath),
    ...declaredOutputs.map((item) => item.relativePath)];
  if (new Set(occupied).size !== occupied.length) {
    throw new TypeError('program source, input and output paths overlap');
  }
  exact(input.requirements, ['filesystem', 'network', 'childProcess', 'packages'], 'program requirements');
  for (const value of Object.values(input.requirements)) {
    if (typeof value !== 'boolean') throw new TypeError('program requirement must be boolean');
  }
  const interpreter = input.interpreter == null ? null : text(input.interpreter, 'program interpreter', 512);
  if (input.sourceLanguage === 'python' && !interpreter) {
    throw new TypeError('Python interpreter identity required');
  }
  const contract = Object.freeze({ schema: 't5.exec-program-contract.v2', workId,
    revision: input.revision, temporary: true, sourceLanguage: input.sourceLanguage,
    source, sourceSha256: sha256(source), inputs, outputs: declaredOutputs,
    requirements: { ...input.requirements }, interpreter, state: 'admitted' });
  CONTRACTS.add(contract);
  return contract;
}

export function selectExecProgramBackend(value, { quickJsQualified = true } = {}) {
  if (!CONTRACTS.has(value)) throw new TypeError('admitted exec program contract required');
  const pure = Object.values(value.requirements).every((item) => item === false);
  if (value.sourceLanguage === 'javascript' && pure && quickJsQualified) {
    return { backend: 'quickjs', sourceLanguage: 'javascript', translated: false };
  }
  return { backend: 'terminal_same_language', sourceLanguage: value.sourceLanguage,
    interpreter: value.interpreter, translated: false };
}

export function assertExecProgramContract(value) {
  if (!CONTRACTS.has(value)) throw new TypeError('admitted exec program contract required');
  return value;
}
