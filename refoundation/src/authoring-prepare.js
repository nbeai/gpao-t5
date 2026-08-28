import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import YAML from 'yaml';
import { assertAuthoringPlan } from './authoring-plan.js';
import { publishAtomicFile } from './atomic-file-publication.js';

const PREPARED = new WeakSet();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateAuthoringFormat(operation, bytes) {
  const extension = extname(operation.path).toLowerCase();
  const text = bytes.toString('utf8').replace(/^\uFEFF/u, '');
  if (extension === '.json') {
    JSON.parse(text); return { format: 'json', state: 'valid' };
  }
  if (['.yaml', '.yml'].includes(extension)) {
    YAML.parse(text); return { format: 'yaml', state: 'valid' };
  }
  if (extension === '.toml') throw new Error('TOML validator is unavailable');
  return { format: extension ? extension.slice(1) : 'extensionless', state: 'not_structurally_validated' };
}

export async function prepareAuthoringPlan({ plan: rawPlan, scratchRoot: rootValue,
  makeId = randomUUID, validate = validateAuthoringFormat } = {}) {
  const plan = assertAuthoringPlan(rawPlan);
  if (plan.state !== 'previewed') throw new Error('authoring plan is not previewed');
  const scratchRoot = resolve(rootValue); await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
  const canonicalRoot = await realpath(scratchRoot); const directory = join(canonicalRoot, `prepare-${makeId()}`);
  await mkdir(directory, { mode: 0o700 }); const candidates = [];
  try {
    for (let index = 0; index < plan.operations.length; index += 1) {
      const operation = plan.operations[index];
      if (!operation.bytes) continue;
      const validation = await validate(operation, operation.bytes);
      const path = join(directory, `${String(index).padStart(4, '0')}.candidate`);
      const published = await publishAtomicFile({ target: path, bytes: operation.bytes,
        expectedPreimage: null, mode: 0o600 });
      if (published.state !== 'published' || published.sha256 !== operation.candidate.sha256) {
        throw new Error('authoring candidate scratch publication failed');
      }
      const reopened = await readFile(path);
      if (sha256(reopened) !== operation.candidate.sha256) throw new Error('authoring candidate digest mismatch');
      candidates.push({ operationIndex: index, path, sha256: published.sha256,
        bytes: reopened.length, validation });
    }
    const prepared = { schema: 't5.authoring-prepared.v1', plan, scratchRoot: canonicalRoot,
      directory, candidates, state: 'prepared', preparedAt: new Date().toISOString() };
    PREPARED.add(prepared); plan.state = 'prepared';
    return { prepared, receipt: { state: 'prepared', planId: plan.planId,
      candidateCount: candidates.length, targetWrites: 0,
      candidates: candidates.map((item) => ({ operationIndex: item.operationIndex,
        sha256: item.sha256, bytes: item.bytes, validation: item.validation })) } };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {}); throw error;
  }
}

export function assertPreparedAuthoring(value) {
  if (!PREPARED.has(value) || value.state !== 'prepared') throw new TypeError('fresh prepared authoring required');
  return value;
}
