import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';

import { inspectZipArchive } from './archive-safety.js';
import { makeExecutableArtifactQualifier } from './executable-artifact-qualification.js';

const CONTRACT_SUFFIX = '.t5-deliverable.json';
const MAX_CONTRACT_BYTES = 64 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const PRODUCER_KIND = 'post_execution_file';
const PRODUCER_ID = 't5.new-json-result.v1';
const OBSERVATION_SCHEMA = 't5.new-json-result-observation.v1';
const EXECUTABLE_EXTENSIONS = new Set(['.command', '.bat', '.cmd', '.ps1', '.exe']);

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function executableEntries(manifest) {
  return manifest.entries.filter((entry) => !entry.directory
    && EXECUTABLE_EXTENSIONS.has(extname(entry.path).toLowerCase()));
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
        if (!required.has('resultPath') || !required.has('resultSha256')
          || [...required.keys()].filter((name) => !['resultPath', 'resultSha256'].includes(name)).length === 0) {
          return outcomeReceipt(context, { state: 'failed', reason: 'purpose_facts_missing' });
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
        const bytes = await readFile(target); let parsed;
        try { parsed = JSON.parse(bytes.toString('utf8')); }
        catch { return outcomeReceipt(context, { state: 'failed', reason: 'result_json_invalid' }); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return outcomeReceipt(context, { state: 'failed', reason: 'result_json_invalid' });
        }
        const facts = context.requiredObservation.requiredFacts.map((fact) => ({
          name: fact.name,
          type: fact.type,
          value: fact.name === 'resultPath' ? resultPath
            : fact.name === 'resultSha256' ? digest(bytes)
              : parsed[fact.name],
        }));
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
    } catch {
      return {
        applicable: true, qualified: false, state: 'executable_artifact_unqualified',
        reason: 'deliverable_contract_invalid', verificationMissing: true,
      };
    }
  };
}

export const EXECUTABLE_OUTPUT_CONTRACT = Object.freeze({
  suffix: CONTRACT_SUFFIX,
  producerKind: PRODUCER_KIND,
  producerId: PRODUCER_ID,
  observationSchema: OBSERVATION_SCHEMA,
  requiredFacts: Object.freeze(['resultPath', 'resultSha256', '<typed purpose fact>']),
});
