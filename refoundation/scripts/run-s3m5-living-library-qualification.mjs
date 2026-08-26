import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { generateLivingLibrary } from '../src/living-library.js';

const room = await mkdtemp(join(tmpdir(), 't5-s3m5-library-cost-'));
const generatedAt = '2026-08-27T05:00:00.000Z';
const source = { availability: 'available' };
const state = {
  events: [{ schema: 't5.memory-event.v1', sequence: 1, type: 'memory_started',
    recordedAt: '2026-08-27T04:59:00.000Z' }],
  tombstones: [],
  claims: [
    { memoryId: 'qualification-preference', kind: 'preference', subjectKey: 'internal.preference',
      value: '결과를 먼저 보여주기', status: 'active', sourceOrder: 1,
      recordedAt: '2026-08-27T04:59:00.000Z', validFrom: null, validTo: null,
      sensitivity: 'personal', scope: { global: true, workId: null, projectId: null }, sources: [source] },
    { memoryId: 'qualification-decision', kind: 'decision', subjectKey: 'internal.decision',
      value: '표준 Markdown으로 기록하기', status: 'active', sourceOrder: 2,
      recordedAt: '2026-08-27T04:59:10.000Z', validFrom: null, validTo: null,
      sensitivity: 'normal', scope: { global: false, workId: null, projectId: 'project-fixture' }, sources: [source] },
  ],
  knowledgeClaims: [{ statement: '검증된 근거를 기준으로 비교한다.', status: 'current', sources: [source] }],
};

try {
  const started = process.hrtime.bigint();
  const first = await generateLivingLibrary({ state, outputRoot: room, generatedAt });
  const generationNs = process.hrtime.bigint() - started;
  const verifyStarted = process.hrtime.bigint();
  const second = await generateLivingLibrary({ state, outputRoot: room, generatedAt });
  const existingVerificationNs = process.hrtime.bigint() - verifyStarted;
  const bytes = {}; const renderedContents = [];
  for (const [name, descriptor] of Object.entries(first.manifest.files)) {
    const content = await readFile(join(first.directory, name));
    renderedContents.push(content.toString('utf8'));
    bytes[name] = { bytes: content.byteLength, manifestBytes: descriptor.bytes,
      exact: content.byteLength === descriptor.bytes };
  }
  const rendered = renderedContents.join('\n');
  const result = {
    schema: 't5.s3-m5-living-library-qualification.v1',
    isolatedState: true, syntheticData: true, userData: false, externalWrites: 0,
    productHotPathCalls: 0, modelCalls: 0, providerRequests: 0, contextBytesAdded: 0,
    qualification: {
      generationNs: String(generationNs), existingVerificationNs: String(existingVerificationNs),
      generationIdStable: first.manifest.generationId === second.manifest.generationId,
      files: Object.keys(first.manifest.files).length,
      totalBytes: Object.values(first.manifest.files).reduce((sum, file) => sum + file.bytes, 0),
      allFileBytesExact: Object.values(bytes).every((file) => file.exact),
      activeClaims: first.manifest.activeClaims,
      knowledgeClaimsProjected: first.manifest.knowledgeClaimsProjected,
      internalIdLeak: /internal\.|qualification-(?:preference|decision)|rr_/u.test(rendered),
      requiresObsidian: first.manifest.requiresObsidian,
    },
  };
  result.pass = result.qualification.generationIdStable && result.qualification.files === 10
    && result.qualification.allFileBytesExact && !result.qualification.internalIdLeak
    && result.qualification.requiresObsidian === false;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.pass) process.exitCode = 1;
} finally { await rm(room, { recursive: true, force: true }); }
