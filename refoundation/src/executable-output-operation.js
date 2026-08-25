import { createHash, randomUUID } from 'node:crypto';
import {
  appendFile, chmod, lstat, mkdir, open, readFile, readdir, realpath, rm, writeFile,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

import { zipSync } from 'fflate';

import { qualifyGeneratedExecutableOutput } from './executable-output-qualification.js';

const SCHEMA = 't5.executable-output-operation-event.v1';
const MAX_EXPECTED_JSON_BYTES = 64 * 1024;
const MAX_SOURCE_FILES = 256;
const MAX_SOURCE_FILE_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_EXPECTED_LITERALS = 16;
const GUIDE_EXTENSIONS = new Set(['.md', '.txt']);

function clone(value) { return value == null ? value : structuredClone(value); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function fingerprint(value) { return digest(Buffer.from(JSON.stringify(value))); }
function bounded(value, maximum = 200) {
  const text = String(value ?? '').normalize('NFC').trim();
  if (!text || Buffer.byteLength(text, 'utf8') > maximum || text.includes('\0')) return null;
  return text;
}
function safeOutputName(value) {
  const name = bounded(value, 180);
  if (!name || name.includes('/') || name.includes('\\') || extname(name).toLowerCase() !== '.zip') return null;
  return name;
}
function safeRelativePath(value) {
  const path = bounded(value, 1_024);
  if (!path || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:/u.test(path)) return null;
  if (path.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return path;
}
function boundedFailure(code, stage, requiredReality, nextAction, candidates = null) {
  return {
    state: 'executable_output_incomplete', code, stage, requiredReality, nextAction,
    ...(candidates ? { candidates } : {}), verificationMissing: true,
  };
}
function interpreterFromShebang(bytes) {
  const line = Buffer.from(bytes).toString('utf8').split('\n', 1)[0].trim();
  if (['#!/bin/zsh', '#!/bin/bash', '#!/bin/sh'].includes(line)) {
    return { interpreter: line.slice(2), interpreterArgs: [] };
  }
  for (const program of ['zsh', 'bash', 'sh']) {
    if (line === `#!/usr/bin/env ${program}`) {
      return { interpreter: '/usr/bin/env', interpreterArgs: [program] };
    }
  }
  return null;
}
function currentLauncher(file) {
  if (process.platform !== 'darwin' || extname(file.path).toLowerCase() !== '.command') return null;
  const runtime = interpreterFromShebang(file.bytes);
  if (!runtime) return null;
  const cwd = dirname(file.path).split(sep).join('/');
  return { path: file.path, cwd: cwd === '.' ? '.' : cwd, ...runtime };
}

async function scanSource(root) {
  const files = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name); const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return { failure: boundedFailure(
        'source_symlink_not_allowed', 'source_scan', 'regular source files', 'remove unsafe source entry',
      ) };
      if (stat.isDirectory()) {
        const failure = await visit(path, rel); if (failure) return failure;
        continue;
      }
      if (!stat.isFile() || stat.nlink !== 1) return { failure: boundedFailure(
        'source_file_not_regular', 'source_scan', 'single-link regular source files', 'replace unsafe source entry',
      ) };
      if (stat.size > MAX_SOURCE_FILE_BYTES) return { failure: boundedFailure(
        'source_file_too_large', 'source_scan', 'bounded source files', 'reduce the source file size',
      ) };
      const bytes = await readFile(path); files.push({ path: rel, bytes });
      if (files.length > MAX_SOURCE_FILES || files.reduce((sum, item) => sum + item.bytes.length, 0) > MAX_SOURCE_TOTAL_BYTES) {
        return { failure: boundedFailure(
          'source_tree_too_large', 'source_scan', 'a bounded source tree', 'reduce the source tree',
        ) };
      }
    }
    return null;
  }
  const failure = await visit(root); return failure ?? { files };
}

function selectLauncherAndGuide(files) {
  const launchers = files.map((file) => ({ file, launcher: currentLauncher(file) }))
    .filter((item) => item.launcher);
  if (launchers.length !== 1) return { failure: boundedFailure(
    launchers.length ? 'multiple_launchers_observed' : 'launcher_not_observed',
    'source_scan', 'exactly one current-OS launcher', 'leave one documented launcher in the source',
    launchers.length ? launchers.slice(0, 8).map((item) => ({ name: basename(item.file.path) })) : null,
  ) };
  const selected = launchers[0];
  const guides = files.filter((file) => GUIDE_EXTENSIONS.has(extname(file.path).toLowerCase())
    && file.bytes.length <= 256 * 1024).filter((file) => {
    const text = file.bytes.toString('utf8').normalize('NFC');
    return text.includes(selected.file.path) || text.includes(basename(selected.file.path));
  });
  if (guides.length !== 1) return { failure: boundedFailure(
    guides.length ? 'multiple_guides_observed' : 'launcher_guide_not_observed',
    'source_scan', 'exactly one guide that names the launcher',
    'leave one guide that names the launcher',
    guides.length ? guides.slice(0, 8).map((file) => ({ name: basename(file.path) })) : null,
  ) };
  return { launcher: selected.launcher, guidePath: guides[0].path };
}

export class ExecutableOutputOperationStore {
  constructor({ attachmentStore, workspace, now = () => new Date().toISOString(), makeId = randomUUID,
    afterArtifactRegistered = null } = {}) {
    if (!attachmentStore || !workspace) throw new TypeError('attachment store and workspace are required');
    this.attachmentStore = attachmentStore; this.workspace = resolve(workspace);
    this.directory = join(attachmentStore.directory, 'executable-operations');
    this.ledger = join(this.directory, 'events.jsonl'); this.now = now; this.makeId = makeId;
    this.afterArtifactRegistered = afterArtifactRegistered;
    this.queue = Promise.resolve();
  }
  serialize(work) { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async ensure() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
    try { await lstat(this.ledger); } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const handle = await open(this.ledger, 'ax', 0o600); await handle.close();
    }
    await chmod(this.ledger, 0o600);
  }
  async events() {
    await this.ensure(); const text = await readFile(this.ledger, 'utf8');
    const events = text.split('\n').filter(Boolean).map(JSON.parse);
    events.forEach((event, index) => {
      if (event.schema !== SCHEMA || event.sequence !== index + 1 || !event.operationHandle || !event.type) {
        throw new Error('invalid executable operation ledger');
      }
    });
    return events;
  }
  async append(operationHandle, type, payload) {
    return this.serialize(async () => {
      const events = await this.events(); const event = {
        schema: SCHEMA, sequence: events.length + 1, recordedAt: this.now(),
        operationHandle, type, payload: clone(payload),
      };
      await appendFile(this.ledger, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
      return event;
    });
  }
  operationFrom(events, operationHandle) {
    const own = events.filter((event) => event.operationHandle === operationHandle);
    if (!own.length) return null;
    const begun = own.find((event) => event.type === 'begun')?.payload;
    const qualified = own.findLast((event) => event.type === 'qualified')?.payload ?? null;
    const finalized = own.findLast((event) => event.type === 'finalized')?.payload ?? null;
    return begun ? { ...clone(begun), qualified, finalized } : null;
  }
  async begin({ sessionId, runId, outputName, resultRelativePath, expectedResultJson, expectedStdoutIncludes } = {}) {
    const name = safeOutputName(outputName); const resultPath = safeRelativePath(resultRelativePath);
    if (!sessionId || !runId || !name || !resultPath || extname(resultPath).toLowerCase() !== '.json') return boundedFailure(
      'begin_input_invalid', 'begin', 'a ZIP name and archive-relative JSON result path', 'retry begin with valid values',
    );
    const expected = String(expectedResultJson ?? '');
    if (!expected || Buffer.byteLength(expected, 'utf8') > MAX_EXPECTED_JSON_BYTES) return boundedFailure(
      'expected_result_invalid', 'begin', 'a bounded exact JSON result', 'retry begin with valid JSON',
    );
    try { JSON.parse(expected); } catch { return boundedFailure(
      'expected_result_invalid', 'begin', 'parseable exact JSON result', 'fix the expected JSON and retry begin',
    ); }
    if (!Array.isArray(expectedStdoutIncludes) || expectedStdoutIncludes.length < 1
      || expectedStdoutIncludes.length > MAX_EXPECTED_LITERALS
      || expectedStdoutIncludes.some((item) => !bounded(item, 2_000))
      || new Set(expectedStdoutIncludes).size !== expectedStdoutIncludes.length) return boundedFailure(
      'expected_stdout_invalid', 'begin', 'one or more exact stdout literals', 'retry begin with exact stdout literals',
    );
    const workspace = await realpath(this.workspace);
    const semantic = { sessionId: String(sessionId), runId: String(runId), workspace,
      outputName: name, resultRelativePath: resultPath, expectedResultJson: expected,
      expectedStdoutIncludes: [...expectedStdoutIncludes] };
    const events = await this.events();
    const existing = events.filter((event) => event.type === 'begun')
      .map((event) => ({ handle: event.operationHandle,
        operation: this.operationFrom(events, event.operationHandle) }))
      .find((item) => item.operation?.semanticFingerprint === fingerprint(semantic));
    if (existing) return existing.operation.finalized ? {
      state: 'executable_output_already_finalized', effect: 'local_change', changed: false,
      operationHandle: existing.handle, nextAction: 'finalize this operation handle to recover the artifact',
    } : {
      state: 'executable_output_started', effect: 'local_change', changed: false,
      operationHandle: existing.handle, sourceDirectory: existing.operation.sourceDirectory,
      allowedPaths: [{ kind: 'source_root', path: existing.operation.sourceDirectory }],
      nextAction: 'write only the source tree, then finalize this operation handle',
    };
    const operationHandle = this.makeId();
    const operationRoot = join(workspace, '.t5-runtime', 'executable', operationHandle);
    const sourceDirectory = join(operationRoot, 'source'); const outputDirectory = join(operationRoot, 'output');
    await Promise.all([sourceDirectory, outputDirectory].map((path) => mkdir(path, { recursive: true, mode: 0o700 })));
    await this.append(operationHandle, 'begun', {
      ...semantic, semanticFingerprint: fingerprint(semantic), operationRoot, sourceDirectory, outputDirectory,
    });
    return { state: 'executable_output_started', effect: 'local_change', changed: true, operationHandle,
      sourceDirectory, allowedPaths: [{ kind: 'source_root', path: sourceDirectory }],
      nextAction: 'write only the source tree, then finalize this operation handle' };
  }
  async readOwned(operationHandle, sessionId, runId) {
    const handle = bounded(operationHandle, 100);
    const operation = handle ? this.operationFrom(await this.events(), handle) : null;
    if (!operation || operation.sessionId !== String(sessionId) || operation.runId !== String(runId)) return null;
    return { operationHandle: handle, ...operation };
  }
  async recordFailure(operationHandle, result) {
    const withRecovery = { ...result, receiptRecovery: {
      kind: 'exact_operation', operationHandle, status: 'open',
    } };
    await this.append(operationHandle, 'finalize_failed', {
      code: result.code, stage: result.stage, requiredReality: result.requiredReality,
      nextAction: result.nextAction,
      ...(result.candidates ? { candidates: result.candidates } : {}),
    });
    return withRecovery;
  }
  async finalize({ operationHandle, sessionId, runId } = {}) {
    const operation = await this.readOwned(operationHandle, sessionId, runId);
    if (!operation) return boundedFailure(
      'operation_not_owned', 'finalize', 'a current-Run operation handle', 'begin a new executable output',
    );
    if (operation.finalized?.attachmentId) {
      const artifact = await this.attachmentStore.get({ sessionId, attachmentId: operation.finalized.attachmentId });
      return { state: 'registered', effect: 'local_change', changed: false, operationHandle, artifact,
        qualification: clone(operation.finalized.qualification), receiptRecovery: {
          kind: 'exact_operation', operationHandle, status: 'resolved', artifactSha256: artifact.sha256,
        }, nextAction: 'finish the user result' };
    }
    const existing = operation.qualified && (await this.attachmentStore.list({ sessionId })).find((item) => (
      item.providerIdentity?.kind === 'executable_output_operation'
      && item.providerIdentity?.operationHandle === operationHandle
      && item.providerIdentity?.runId === runId
      && item.sha256 === operation.qualified.artifactSha256
    ));
    if (existing) {
      const qualification = { state: 'executable_artifact_qualified', passed: true };
      await this.append(operationHandle, 'finalized', { attachmentId: existing.attachmentId, qualification });
      await rm(operation.operationRoot, { recursive: true, force: true }).catch(() => {});
      return { state: 'registered', effect: 'local_change', changed: false, operationHandle,
        artifact: existing, qualification, receiptRecovery: {
          kind: 'exact_operation', operationHandle, status: 'resolved', artifactSha256: existing.sha256,
        }, nextAction: 'finish the user result' };
    }
    const sourceRoot = await realpath(operation.sourceDirectory).catch(() => null);
    if (!sourceRoot) return this.recordFailure(operationHandle, boundedFailure(
      'source_tree_missing', 'source_scan', 'the managed source tree', 'write source files into the returned source directory',
    ));
    const scanned = await scanSource(sourceRoot);
    if (scanned.failure) return this.recordFailure(operationHandle, scanned.failure);
    if (!scanned.files.length) return this.recordFailure(operationHandle, boundedFailure(
      'source_tree_empty', 'source_scan', 'application, launcher, guide, and data files',
      'write the source tree into the returned source directory',
    ));
    const sourceFiles = scanned.files.filter((file) => file.path !== operation.resultRelativePath);
    if (!sourceFiles.length) return this.recordFailure(operationHandle, boundedFailure(
      'source_tree_empty', 'source_scan', 'application, launcher, guide, and data files',
      'write the source tree into the returned source directory',
    ));
    const selected = selectLauncherAndGuide(sourceFiles);
    if (selected.failure) return this.recordFailure(operationHandle, selected.failure);
    const zipEntries = Object.fromEntries(sourceFiles.map((file) => [file.path,
      extname(file.path).toLowerCase() === '.command'
        ? [new Uint8Array(file.bytes), { os: 3, attrs: (0o100755 << 16) >>> 0 }]
        : [new Uint8Array(file.bytes), { os: 3, attrs: (0o100644 << 16) >>> 0 }]]));
    const archiveBytes = Buffer.from(zipSync(zipEntries, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
    const artifactSha256 = digest(archiveBytes); const expectedBytes = Buffer.from(operation.expectedResultJson);
    const entrypointId = `entry-${digest(Buffer.from(selected.launcher.path)).slice(0, 16)}`;
    const contract = {
      schema: 't5.deliverable-contract.v1', id: `operation-${operationHandle}-contract`,
      artifact: { id: `operation-${operationHandle}`, sha256: artifactSha256 },
      expectedFiles: sourceFiles.map((file) => file.path),
      guideReferences: [{ guidePath: selected.guidePath, targetPath: selected.launcher.path }],
      advertisedEntrypoints: [{ id: entrypointId, platform: process.platform,
        interpreter: selected.launcher.interpreter, interpreterArgs: selected.launcher.interpreterArgs,
        path: selected.launcher.path, cwd: selected.launcher.cwd,
        requiresExecutablePermission: true, stdin: '\n', expectedExitCode: 0,
        expectedStdoutIncludes: operation.expectedStdoutIncludes, expectedStderrIncludes: [] }],
      requiredOutcomeObservations: [{ id: `outcome-${operationHandle}`,
        observationSchema: 't5.new-json-result-observation.v1', entrypointId,
        producerKind: 'post_execution_file', producerId: 't5.new-json-result.v1', requiredFacts: [
          { name: 'resultPath', type: 'string', equals: operation.resultRelativePath },
          { name: 'resultSha256', type: 'string', equals: digest(expectedBytes) },
          { name: 'resultBytes', type: 'integer', equals: expectedBytes.length },
          { name: 'resultMime', type: 'string', equals: 'application/json' },
        ] }],
      platforms: [{ platform: process.platform, advertisedSupport: true,
        claimedQualification: 'actually_executed' }],
    };
    const qualified = await qualifyGeneratedExecutableOutput({ archiveBytes, contract });
    if (!qualified.passed) {
      const entrypoint = qualified.entrypoints?.[0];
      return this.recordFailure(operationHandle, boundedFailure(
        entrypoint?.execution?.reason === 'timed_out' ? 'launcher_timeout'
          : entrypoint?.execution?.processResidual ? 'launcher_process_residual'
            : entrypoint?.executionQualification !== 'actually_executed' ? 'launcher_failed'
              : 'result_effect_mismatch',
        'execution', 'a clean launcher exit and exact new JSON result',
        'fix the source tree and finalize the same operation again',
      ));
    }
    const outputPath = join(operation.outputDirectory, operation.outputName);
    try { await writeFile(outputPath, archiveBytes, { mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const current = await readFile(outputPath);
      if (digest(current) !== artifactSha256) return this.recordFailure(operationHandle, boundedFailure(
        'output_identity_conflict', 'registration', 'the exact qualified archive',
        'begin a new executable output operation',
      ));
    }
    const qualification = { state: 'executable_artifact_qualified', passed: true,
      scope: 'wrapper_and_new_json_file_effect' };
    if (operation.qualified?.artifactSha256 && operation.qualified.artifactSha256 !== artifactSha256) {
      return this.recordFailure(operationHandle, boundedFailure(
        'qualified_identity_changed', 'registration', 'the exact previously qualified archive',
        'begin a new executable output operation',
      ));
    }
    if (!operation.qualified) await this.append(operationHandle, 'qualified', {
      artifactSha256, qualification,
    });
    const artifact = await this.attachmentStore.registerOutput({
      sessionId, workspace: operation.workspace, filePath: outputPath, expectedSha256: artifactSha256,
      providerIdentity: { kind: 'executable_output_operation', operationHandle, runId },
    });
    await this.attachmentStore.link({ sessionId, attachmentIds: [artifact.attachmentId],
      messageId: `${runId}:output:${artifact.attachmentId}`, runId });
    await this.afterArtifactRegistered?.({ operationHandle, artifact: clone(artifact) });
    await this.append(operationHandle, 'finalized', { attachmentId: artifact.attachmentId, qualification });
    await rm(operation.operationRoot, { recursive: true, force: true }).catch(() => {});
    return { state: 'registered', effect: 'local_change', changed: true, operationHandle,
      artifact, qualification, receiptRecovery: {
        kind: 'exact_operation', operationHandle, status: 'resolved', artifactSha256: artifact.sha256,
      }, nextAction: 'finish the user result' };
  }
}
