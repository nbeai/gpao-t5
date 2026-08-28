import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import variant from '@jitl/quickjs-wasmfile-release-sync';
import { newQuickJSWASMModuleFromVariant, shouldInterruptAfterDeadline } from 'quickjs-emscripten-core';

import { publishAtomicFile } from './atomic-file-publication.js';
import { assertPreparedEphemeralProgram } from './ephemeral-program-preparation.js';

const INTERPRETERS = new WeakSet();
const ATTEMPTED = new WeakSet();
const QUALIFIED = new WeakSet();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const modulePromise = newQuickJSWASMModuleFromVariant(variant);
const packageRoot = new URL('../node_modules/@jitl/quickjs-wasmfile-release-sync/', import.meta.url);
const DEFAULT_HELPER = fileURLToPath(new URL('../scripts/quickjs-capsule-child.mjs', import.meta.url));

function positiveInteger(value, label, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new TypeError(`${label} is invalid`);
  return value;
}

async function exactFile(path, expected) {
  const bytes = await readFile(path); if (bytes.length !== expected.bytes || sha256(bytes) !== expected.sha256) {
    throw new Error('prepared capsule source changed');
  }
  return bytes;
}

function strictUtf8(bytes, label) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/u, ''); }
  catch { throw new Error(`${label} is not strict UTF-8`); }
}

export async function evaluateQuickJsTransform({ source, input, memoryLimitBytes,
  maxStackSizeBytes, timeoutMs, maxOutputBytes } = {}) {
  const wrapped = `"use strict";
globalThis.process = undefined;
globalThis.require = undefined;
globalThis.fetch = undefined;
globalThis.Worker = undefined;
globalThis.Date = undefined;
Math.random = () => { throw new Error("nondeterministic random is unavailable"); };
${source}
if (typeof transform !== "function") throw new TypeError("transform(input) is required");
JSON.stringify(transform(${JSON.stringify(input)}));`;
  let value;
  try {
    const QuickJS = await modulePromise;
    value = QuickJS.evalCode(wrapped, { memoryLimitBytes, maxStackSizeBytes,
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + timeoutMs) });
  } catch (error) {
    throw Object.assign(new Error(/out of memory/iu.test(error?.message ?? '') ? 'memory_limit'
      : /interrupted/iu.test(error?.message ?? '') ? 'timeout' : 'program_error'), {
      code: 'T5_QUICKJS_FIXTURE_FAILED',
    });
  }
  if (typeof value !== 'string') throw Object.assign(new Error('output_not_json_serializable'), {
    code: 'T5_QUICKJS_FIXTURE_FAILED',
  });
  const outputBytes = Buffer.byteLength(value);
  if (outputBytes > maxOutputBytes) throw Object.assign(new Error('output_limit'), {
    code: 'T5_QUICKJS_FIXTURE_FAILED', outputBytes,
  });
  return value;
}

async function evaluateInManagedHelper({ processRegistry, helperPath, ownerId, source, input,
  limits, signal, makeId }) {
  if (!processRegistry?.start || !processRegistry?.write || !processRegistry?.poll || !processRegistry?.stop) {
    throw new TypeError('managed process registry required for QuickJS fixture');
  }
  const id = makeId(); const request = { id, source, input,
    memoryLimitBytes: limits.memoryLimitBytes, maxStackSizeBytes: limits.maxStackSizeBytes,
    timeoutMs: limits.timeoutMs, maxOutputBytes: limits.maxOutputBytes };
  const started = await processRegistry.start({ program: process.execPath, args: [helperPath],
    cwd: process.cwd(), env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' },
    ownerId, waitMs: 0, spoolLimit: 128 * 1024,
    metadata: { kind: 'quickjs_fixture_helper', requestId: id } });
  if (started.state !== 'running') throw new Error('QuickJS helper did not start');
  processRegistry.write({ processId: started.processId, ownerId,
    input: `${JSON.stringify(request)}\n`, end: true });
  let current = started; let cursor = started.cursor; let stdout = started.stdout; let stderr = started.stderr;
  const deadline = Date.now() + limits.timeoutMs + 2_000;
  while (current.state === 'running') {
    if (signal?.aborted) {
      current = await processRegistry.stop({ processId: current.processId, ownerId,
        reason: 'fixture_cancelled', cursor });
      return { state: 'fixture_failed', reason: 'cancelled', boundary: current.processBoundary ?? null };
    }
    if (Date.now() >= deadline) {
      current = await processRegistry.stop({ processId: current.processId, ownerId,
        reason: 'helper_timeout', cursor });
      return { state: 'fixture_failed', reason: 'helper_timeout', boundary: current.processBoundary ?? null };
    }
    current = await processRegistry.poll({ processId: current.processId, ownerId,
      cursor, waitMs: 25 });
    stdout += current.stdout; stderr += current.stderr; cursor = current.cursor;
  }
  const line = stdout.trim().split('\n').filter(Boolean).at(-1); let response;
  try { response = JSON.parse(line); } catch { response = null; }
  if (current.state !== 'completed' || !response || response.id !== id || typeof response.ok !== 'boolean') {
    return { state: 'fixture_failed', reason: 'helper_failed', boundary: current.processBoundary ?? null };
  }
  if (!response.ok || typeof response.value !== 'string') return { state: 'fixture_failed',
    reason: response.reason ?? 'program_error', boundary: current.processBoundary ?? null };
  return { state: 'completed', value: response.value, boundary: current.processBoundary ?? null };
}

export async function observeBundledQuickJsInterpreter() {
  const [packageBytes, wasmBytes] = await Promise.all([
    readFile(new URL('package.json', packageRoot)),
    readFile(new URL('dist/emscripten-module.wasm', packageRoot)),
  ]);
  const packageValue = JSON.parse(packageBytes.toString('utf8'));
  if (packageValue.name !== '@jitl/quickjs-wasmfile-release-sync' || packageValue.version !== '0.32.0') {
    throw new Error('bundled QuickJS identity is unavailable');
  }
  const interpreter = Object.freeze({
    kind: 'quickjs_wasm_release_sync', version: packageValue.version,
    quickJsVersion: '2025-09-13+f1139494', wasmSha256: sha256(wasmBytes),
    hostApis: 0, filesystem: false, network: false, process: false, environment: false,
  });
  INTERPRETERS.add(interpreter); return interpreter;
}

export async function qualifyEphemeralProgramFixture({ prepared: rawPrepared, interpreter,
  memoryLimitBytes = 8 * 1024 * 1024, maxStackSizeBytes = 512 * 1024,
  timeoutMs = 500, maxOutputBytes = 32 * 1024, publish = publishAtomicFile,
  processRegistry, helperPath = DEFAULT_HELPER, signal = null, makeId = randomUUID } = {}) {
  const prepared = assertPreparedEphemeralProgram(rawPrepared);
  if (!INTERPRETERS.has(interpreter)) throw new TypeError('observed bundled QuickJS interpreter required');
  if (ATTEMPTED.has(prepared)) throw new TypeError('fixture qualification already attempted');
  ATTEMPTED.add(prepared);
  const limits = {
    memoryLimitBytes: positiveInteger(memoryLimitBytes, 'fixture memory limit', 64 * 1024 * 1024),
    maxStackSizeBytes: positiveInteger(maxStackSizeBytes, 'fixture stack limit', 4 * 1024 * 1024),
    timeoutMs: positiveInteger(timeoutMs, 'fixture timeout', 10_000),
    maxOutputBytes: positiveInteger(maxOutputBytes, 'fixture output limit', 8 * 1024 * 1024),
  };
  const sourcePath = join(prepared.directory, prepared.manifest.source.file);
  const fixturePath = join(prepared.directory, prepared.manifest.fixture.input.file);
  const oraclePath = join(prepared.directory, prepared.manifest.fixture.oracle.file);
  const [sourceBytes, fixtureBytes, oracleBytes] = await Promise.all([
    exactFile(sourcePath, prepared.manifest.source),
    exactFile(fixturePath, prepared.manifest.fixture.input),
    exactFile(oraclePath, prepared.manifest.fixture.oracle),
  ]);
  const source = strictUtf8(sourceBytes, 'capsule source'); const fixtureInput = strictUtf8(fixtureBytes, 'fixture input');
  const evaluated = await evaluateInManagedHelper({ processRegistry, helperPath,
    ownerId: prepared.manifest.workId, source, input: fixtureInput, limits, signal, makeId });
  if (evaluated.state !== 'completed') return { qualification: null, receipt: {
    state: 'fixture_failed', reason: evaluated.reason,
    sourceSha256: prepared.manifest.source.sha256, interpreter,
    helperBoundary: evaluated.boundary, actualExecutions: 0, userTargetWrites: 0 } };
  const value = evaluated.value;
  const outputBytes = Buffer.from(value);
  if (outputBytes.length > limits.maxOutputBytes) return { qualification: null, receipt: {
    state: 'fixture_failed', reason: 'output_limit', outputBytes: outputBytes.length,
    sourceSha256: prepared.manifest.source.sha256, interpreter,
    actualExecutions: 0, userTargetWrites: 0 } };
  const target = join(prepared.directory, 'fixture', 'observed.output');
  const published = await publish({ target, bytes: outputBytes, expectedPreimage: null, mode: 0o600 });
  if (published.state !== 'published') throw new Error('fixture output publication is not durable');
  const observed = await readFile(target); const outputSha256 = sha256(observed);
  const sourceAfter = await exactFile(sourcePath, prepared.manifest.source);
  const fixtureAfter = await exactFile(fixturePath, prepared.manifest.fixture.input);
  const oracleAfter = await exactFile(oraclePath, prepared.manifest.fixture.oracle);
  const verified = outputSha256 === sha256(oracleBytes) && observed.equals(oracleBytes);
  if (!verified) return { qualification: null, receipt: { state: 'fixture_failed', reason: 'oracle_mismatch',
    sourceSha256: sha256(sourceAfter), fixtureSha256: sha256(fixtureAfter),
    oracleSha256: sha256(oracleAfter), outputSha256, outputBytes: observed.length,
    interpreter, limits, helperBoundary: evaluated.boundary,
    actualExecutions: 0, userTargetWrites: 0 } };
  const qualification = Object.freeze({ schema: 't5.ephemeral-program-fixture-qualified.v1',
    prepared, interpreter, sourceSha256: sha256(sourceAfter), fixtureSha256: sha256(fixtureAfter),
    oracleSha256: sha256(oracleAfter), outputSha256, outputBytes: observed.length,
    limits, state: 'fixture_verified' });
  QUALIFIED.add(qualification);
  return { qualification, receipt: { state: 'fixture_verified', capsuleId: prepared.manifest.capsuleId,
    workId: prepared.manifest.workId, revision: prepared.manifest.revision,
    sourceSha256: qualification.sourceSha256, fixtureSha256: qualification.fixtureSha256,
    oracleSha256: qualification.oracleSha256, outputSha256, outputBytes: observed.length,
    interpreter, limits, guestHostApis: 0, helperBoundary: evaluated.boundary,
    actualExecutions: 0, userTargetWrites: 0 } };
}

export function assertQualifiedEphemeralProgramFixture(value) {
  if (!QUALIFIED.has(value) || value.state !== 'fixture_verified') {
    throw new TypeError('fresh qualified ephemeral program fixture required');
  }
  return value;
}
