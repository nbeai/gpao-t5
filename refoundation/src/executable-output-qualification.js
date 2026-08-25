import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, relative, resolve, sep } from 'node:path';

import { unzipSync } from 'fflate';

import { inspectZipArchive } from './archive-safety.js';
import { makeExecutableArtifactQualifier } from './executable-artifact-qualification.js';

const CONTRACT_SUFFIX = '.t5-deliverable.json';
const MAX_CONTRACT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const PRODUCER_KIND = 'post_execution_file';
const PRODUCER_ID = 't5.new-json-result.v1';
const OBSERVATION_SCHEMA = 't5.new-json-result-observation.v1';
const FILE_EFFECT_FACTS = Object.freeze({
  resultPath: 'string', resultSha256: 'string', resultBytes: 'integer', resultMime: 'string',
});
const EXECUTABLE_EXTENSIONS = new Set(['.command', '.bat', '.cmd', '.ps1', '.exe']);
const GUIDE_EXTENSIONS = new Set(['.md', '.txt']);
const MAX_EXPECTED_LITERALS = 16;

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function shortDigest(value) { return digest(Buffer.from(String(value))).slice(0, 20); }

function executableEntries(manifest) {
  return manifest.entries.filter((entry) => !entry.directory
    && EXECUTABLE_EXTENSIONS.has(extname(entry.path).toLowerCase()));
}

function contractDiagnostic(error) {
  return {
    stage: String(error?.stage ?? 'contract_validation').slice(0, 80),
    field: String(error?.field ?? 'contract').slice(0, 240),
    code: String(error?.code ?? 'invalid_contract').slice(0, 120),
  };
}

function within(root, path) {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && resolve(root, rel) === path;
}

function interpreterFromShebang(bytes) {
  const line = Buffer.from(bytes ?? []).toString('utf8').split('\n', 1)[0].trim();
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

function currentPlatformLaunchers(manifest, expanded) {
  if (process.platform !== 'darwin') return [];
  return executableEntries(manifest).flatMap((entry) => {
    if (extname(entry.path).toLowerCase() !== '.command') return [];
    const runtime = interpreterFromShebang(expanded[entry.path]);
    if (!runtime) return [];
    const cwd = dirname(entry.path).split(sep).join('/');
    return [{
      candidateId: `launcher-${shortDigest(`${entry.path}\0${runtime.interpreter}\0${runtime.interpreterArgs.join('\0')}`)}`,
      path: entry.path, cwd: cwd === '.' ? '.' : cwd,
      interpreter: runtime.interpreter, interpreterArgs: runtime.interpreterArgs,
      executablePermissionPresent: entry.unixMode != null && (entry.unixMode & 0o111) !== 0,
    }];
  });
}

function guideCandidates(manifest, expanded, launchers) {
  const guides = manifest.entries.filter((entry) => !entry.directory
    && GUIDE_EXTENSIONS.has(extname(entry.path).toLowerCase()));
  return guides.flatMap((guide) => {
    if (guide.uncompressedBytes > 256 * 1024) return [];
    const text = Buffer.from(expanded[guide.path] ?? []).toString('utf8').normalize('NFC');
    return launchers.flatMap((launcher) => {
      if (!text.includes(launcher.path) && !text.includes(basename(launcher.path))) return [];
      return [{
        candidateId: `guide-${shortDigest(`${guide.path}\0${launcher.candidateId}`)}`,
        path: guide.path, launcherCandidateId: launcher.candidateId,
        targetPath: launcher.path,
      }];
    });
  });
}

function publicCandidates(launchers, guides) {
  return {
    launchers: launchers.map((item) => ({
      candidateId: item.candidateId, path: item.path, cwd: item.cwd,
      executablePermissionPresent: item.executablePermissionPresent,
    })),
    guides: guides.map((item) => ({
      candidateId: item.candidateId, path: item.path,
      launcherCandidateId: item.launcherCandidateId, targetPath: item.targetPath,
    })),
  };
}

async function readContractSidecar(filePath) {
  const path = `${resolve(filePath)}${CONTRACT_SUFFIX}`;
  let stat;
  try { stat = await lstat(path); }
  catch (error) {
    if (error?.code === 'ENOENT') return { state: 'missing', path };
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1) {
    return { state: 'invalid', reason: 'contract_sidecar_not_regular', path };
  }
  if (stat.size > MAX_CONTRACT_BYTES) {
    return { state: 'invalid', reason: 'contract_sidecar_too_large', path };
  }
  try { return { state: 'loaded', contract: JSON.parse(await readFile(path, 'utf8')), path }; }
  catch { return { state: 'invalid', reason: 'contract_sidecar_invalid_json', path }; }
}

function outcomeReceipt(context, { state = 'observed', reason = null, facts = [] } = {}) {
  return {
    schema: 't5.outcome-observation-receipt.v1',
    state,
    ...(state === 'observed' ? {} : { reason }),
    contract: {
      id: context.contract.id,
      schema: context.contract.schema,
      artifactId: context.artifact.id,
      artifactSha256: context.artifact.sha256,
    },
    artifact: { ...context.artifact },
    entrypointId: context.entrypoint.id,
    observationSchema: context.requiredObservation.observationSchema,
    producer: { kind: PRODUCER_KIND, id: PRODUCER_ID },
    facts,
  };
}

function safeResultPath(value) {
  const path = String(value ?? '').normalize('NFC');
  if (!path || path.includes('\0') || path.includes('\\') || path.startsWith('/')
    || /^[A-Za-z]:/u.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('result path is unsafe');
  }
  return path;
}

export function makeExecutableOutputQualifier() {
  const qualify = makeExecutableArtifactQualifier({
    outcomeProducers: [{
      kind: PRODUCER_KIND,
      id: PRODUCER_ID,
      async observe(context) {
        if (context.requiredObservation.observationSchema !== OBSERVATION_SCHEMA) {
          return outcomeReceipt(context, { state: 'failed', reason: 'unsupported_observation_schema' });
        }
        const required = new Map(context.requiredObservation.requiredFacts.map((fact) => [fact.name, fact]));
        if (required.size !== Object.keys(FILE_EFFECT_FACTS).length
          || Object.entries(FILE_EFFECT_FACTS).some(([name, type]) => required.get(name)?.type !== type)) {
          return outcomeReceipt(context, { state: 'failed', reason: 'unsupported_file_effect_facts' });
        }
        let resultPath;
        try { resultPath = safeResultPath(required.get('resultPath').equals); }
        catch { return outcomeReceipt(context, { state: 'failed', reason: 'result_path_invalid' }); }
        if (context.preExecutionFiles.some((file) => file.path === resultPath)) {
          return outcomeReceipt(context, { state: 'failed', reason: 'result_existed_before_execution' });
        }
        const target = resolve(context.artifactRoot, resultPath);
        const rel = relative(context.artifactRoot, target);
        if (rel === '..' || rel.startsWith(`..${sep}`)) {
          return outcomeReceipt(context, { state: 'failed', reason: 'result_path_outside_artifact' });
        }
        let stat;
        try { stat = await lstat(target); }
        catch { return outcomeReceipt(context, { state: 'unknown', reason: 'result_file_missing' }); }
        if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink !== 1 || stat.size > MAX_RESULT_BYTES) {
          return outcomeReceipt(context, { state: 'failed', reason: 'result_file_invalid' });
        }
        const bytes = await readFile(target);
        try { JSON.parse(bytes.toString('utf8')); }
        catch { return outcomeReceipt(context, { state: 'failed', reason: 'result_json_invalid' }); }
        const facts = [
          { name: 'resultPath', type: 'string', value: resultPath },
          { name: 'resultSha256', type: 'string', value: digest(bytes) },
          { name: 'resultBytes', type: 'integer', value: bytes.length },
          { name: 'resultMime', type: 'string', value: 'application/json' },
        ];
        return outcomeReceipt(context, { facts });
      },
    }],
  });
  return async function qualifyExecutableOutput({ filePath, workspace, bytes: input } = {}) {
    const sourceStat = await lstat(resolve(filePath));
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile() || sourceStat.nlink !== 1) {
      throw new Error('executable output must be one regular file');
    }
    const root = await realpath(workspace);
    const path = await realpath(filePath);
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(root, rel) !== path) {
      throw new Error('executable output path is outside workspace');
    }
    const bytes = input == null ? await readFile(path) : Buffer.from(input);
    const sidecar = await readContractSidecar(path);
    let manifest;
    try { manifest = inspectZipArchive(bytes); }
    catch {
      return sidecar.state === 'missing' ? { applicable: false } : {
        applicable: true, qualified: false, state: 'executable_artifact_unqualified',
        reason: 'invalid_executable_archive', verificationMissing: true,
      };
    }
    if (executableEntries(manifest).length === 0 && sidecar.state === 'missing') return { applicable: false };
    if (manifest.state !== 'safe_manifest') return {
      applicable: true, qualified: false, state: 'executable_artifact_unqualified',
      reason: 'unsafe_executable_archive', verificationMissing: true,
    };
    if (sidecar.state !== 'loaded') {
      return {
        applicable: true, qualified: false, state: 'executable_artifact_unqualified',
        reason: sidecar.reason ?? 'deliverable_contract_missing', verificationMissing: true,
      };
    }
    try {
      const receipt = await qualify({ archiveBytes: bytes, contract: sidecar.contract });
      return {
        applicable: true,
        qualified: receipt.passed === true,
        state: receipt.passed ? 'executable_artifact_qualified' : 'executable_artifact_unqualified',
        ...(receipt.passed ? {} : { reason: 'executable_qualification_failed', verificationMissing: true }),
        receipt,
      };
    } catch (error) {
      return {
        applicable: true, qualified: false, state: 'executable_artifact_unqualified',
        reason: 'deliverable_contract_invalid', verificationMissing: true,
        diagnostic: contractDiagnostic(error),
      };
    }
  };
}

export function makeExecutableOutputPreparer() {
  return async function prepareExecutableOutput({
    filePath, workspace, archiveResultPath, expectedResultFilePath,
    expectedStdoutIncludes, launcherCandidateId = null, guideCandidateId = null,
  } = {}) {
    const root = await realpath(workspace);
    const source = await realpath(filePath);
    const expected = await realpath(expectedResultFilePath);
    if (!within(root, source) || !within(root, expected)) {
      return { state: 'executable_preparation_unavailable', reason: 'path_outside_workspace' };
    }
    const [sourceStat, expectedStat] = await Promise.all([lstat(source), lstat(expected)]);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1) {
      return { state: 'executable_preparation_unavailable', reason: 'archive_not_regular' };
    }
    if (!expectedStat.isFile() || expectedStat.isSymbolicLink() || expectedStat.nlink !== 1
      || expectedStat.size > MAX_RESULT_BYTES) {
      return { state: 'executable_preparation_unavailable', reason: 'expected_result_not_regular_json' };
    }
    const [bytes, expectedBytes] = await Promise.all([readFile(source), readFile(expected)]);
    try { JSON.parse(expectedBytes.toString('utf8')); }
    catch {
      return { state: 'executable_preparation_unavailable', reason: 'expected_result_not_json' };
    }
    let resultPath;
    try { resultPath = safeResultPath(archiveResultPath); }
    catch { return { state: 'executable_preparation_unavailable', reason: 'archive_result_path_invalid' }; }
    if (extname(resultPath).toLowerCase() !== '.json') {
      return { state: 'executable_preparation_unavailable', reason: 'archive_result_must_be_json' };
    }
    if (!Array.isArray(expectedStdoutIncludes) || expectedStdoutIncludes.length < 1
      || expectedStdoutIncludes.length > MAX_EXPECTED_LITERALS
      || expectedStdoutIncludes.some((item) => typeof item !== 'string' || !item.trim()
        || Buffer.byteLength(item, 'utf8') > 2_000)
      || new Set(expectedStdoutIncludes).size !== expectedStdoutIncludes.length) {
      return { state: 'executable_preparation_unavailable', reason: 'expected_stdout_invalid' };
    }
    let manifest; let expanded;
    try {
      manifest = inspectZipArchive(bytes);
      if (manifest.state !== 'safe_manifest') throw new Error('unsafe');
      expanded = unzipSync(bytes);
    } catch {
      return { state: 'executable_preparation_unavailable', reason: 'archive_not_safe' };
    }
    if (manifest.entries.some((entry) => !entry.directory && entry.path === resultPath)) {
      return { state: 'executable_preparation_unavailable', reason: 'result_already_in_archive' };
    }
    const launchers = currentPlatformLaunchers(manifest, expanded);
    const guides = guideCandidates(manifest, expanded, launchers);
    const candidates = publicCandidates(launchers, guides);
    if (!launchers.length) {
      return { state: 'executable_preparation_unavailable', reason: 'current_platform_launcher_not_observed', candidates };
    }
    if (!guides.length) {
      return { state: 'executable_preparation_unavailable', reason: 'launcher_guide_reference_not_observed', candidates };
    }
    const selectedLauncher = launcherCandidateId == null && launchers.length === 1
      ? launchers[0] : launchers.find((item) => item.candidateId === launcherCandidateId);
    const compatibleGuides = selectedLauncher
      ? guides.filter((item) => item.launcherCandidateId === selectedLauncher.candidateId) : [];
    const selectedGuide = guideCandidateId == null && compatibleGuides.length === 1
      ? compatibleGuides[0] : compatibleGuides.find((item) => item.candidateId === guideCandidateId);
    if (!selectedLauncher || !selectedGuide || launchers.length > 1 && launcherCandidateId == null
      || compatibleGuides.length > 1 && guideCandidateId == null) {
      return { state: 'executable_preparation_selection_required', candidates };
    }
    if (!selectedLauncher.executablePermissionPresent) {
      return {
        state: 'executable_preparation_unavailable',
        reason: 'launcher_executable_permission_missing', candidates,
      };
    }
    const artifactSha256 = digest(bytes);
    const entrypointId = `entry-${shortDigest(selectedLauncher.path)}`;
    const artifactId = `executable-${artifactSha256.slice(0, 20)}`;
    const contract = {
      schema: 't5.deliverable-contract.v1', id: `${artifactId}-contract`,
      artifact: { id: artifactId, sha256: artifactSha256 },
      expectedFiles: manifest.entries.filter((entry) => !entry.directory).map((entry) => entry.path),
      guideReferences: [{ guidePath: selectedGuide.path, targetPath: selectedLauncher.path }],
      advertisedEntrypoints: [{
        id: entrypointId, platform: process.platform,
        interpreter: selectedLauncher.interpreter,
        interpreterArgs: selectedLauncher.interpreterArgs,
        path: selectedLauncher.path, cwd: selectedLauncher.cwd,
        requiresExecutablePermission: true, stdin: '\n',
        expectedExitCode: 0, expectedStdoutIncludes: [...expectedStdoutIncludes],
        expectedStderrIncludes: [],
      }],
      requiredOutcomeObservations: [{
        id: `outcome-${shortDigest(`${selectedLauncher.path}\0${resultPath}`)}`,
        observationSchema: OBSERVATION_SCHEMA, entrypointId,
        producerKind: PRODUCER_KIND, producerId: PRODUCER_ID,
        requiredFacts: [
          { name: 'resultPath', type: 'string', equals: resultPath },
          { name: 'resultSha256', type: 'string', equals: digest(expectedBytes) },
          { name: 'resultBytes', type: 'integer', equals: expectedBytes.length },
          { name: 'resultMime', type: 'string', equals: 'application/json' },
        ],
      }],
      platforms: [{
        platform: process.platform, advertisedSupport: true,
        claimedQualification: 'actually_executed',
      }],
    };
    const serialized = `${JSON.stringify(contract)}\n`;
    const sidecarPath = `${source}${CONTRACT_SUFFIX}`;
    let changed = true;
    try { await writeFile(sidecarPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = await readFile(sidecarPath, 'utf8');
      if (existing !== serialized) {
        return { state: 'executable_preparation_unavailable', reason: 'existing_preparation_conflict' };
      }
      changed = false;
    }
    return {
      state: 'executable_output_prepared', effect: 'local_change', changed,
      artifact: { sha256: artifactSha256 },
      selected: {
        launcherCandidateId: selectedLauncher.candidateId,
        guideCandidateId: selectedGuide.candidateId,
      },
      expectedEffect: { resultPath, resultSha256: digest(expectedBytes), resultBytes: expectedBytes.length },
    };
  };
}

export const EXECUTABLE_OUTPUT_CONTRACT = Object.freeze({
  suffix: CONTRACT_SUFFIX,
  producerKind: PRODUCER_KIND,
  producerId: PRODUCER_ID,
  observationSchema: OBSERVATION_SCHEMA,
  requiredFacts: Object.freeze(Object.keys(FILE_EFFECT_FACTS)),
  qualificationScope: 'executable_wrapper_and_declared_external_file_effect',
});
