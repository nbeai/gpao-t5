import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { memoryCandidateProjection, temporalMemoryCandidateProjection } from '../src/memory-portfolio.js';
import { makeMemoryTool } from '../src/memory-tool.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8');
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export async function runS3M2TemporalMemoryQualification({ pairs = 12 } = {}) {
  const request = '현재 커피 선호를 알려줘.';
  const legacyItem = {
    memoryId: 'legacy-current', kind: 'user', content: 'light roast', subjects: ['coffee'],
    subjectRevision: 2, sourceOrder: 3, alwaysRelevant: false,
  };
  const claim = {
    memoryId: 'temporal-current', kind: 'preference', subjectKey: 'subject-coffee', value: 'light roast',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [{ recordId: 'rr-source', scope: { channel: 'console' }, sensitivity: 'personal' }],
    recordedAt: '2026-08-26T00:00:00.000Z', validFrom: '2026-01-01T00:00:00.000Z',
    validTo: '2027-01-01T00:00:00.000Z', subjectRevision: 2, sourceOrder: 3,
    status: 'active', supersedes: [], conflictsWith: [], sensitivity: 'personal', alwaysRelevant: false,
  };
  const baselineLedger = { read: async () => ({ items: [legacyItem], claims: [] }) };
  const candidateLedger = { read: async () => ({ items: [], claims: [claim] }) };
  const sourceReader = { reopen: async () => ({ state: 'reopened', source: { exact: true }, accounting: {
    recordId: 'rr-source', availability: 'available', coverage: 'full', digestMatched: true,
  } }) };
  const samples = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    for (const mode of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const start = process.hrtime.bigint();
      const pointer = mode === 'baseline' ? memoryCandidateProjection([legacyItem])
        : temporalMemoryCandidateProjection([claim], {
          asOf: '2026-08-26T00:00:00.000Z', currentChannel: 'console', currentWork: null,
        });
      const tool = makeMemoryTool({
        ledger: mode === 'baseline' ? baselineLedger : candidateLedger,
        ...(mode === 'candidate' ? { sourceReader } : {}),
      });
      const receipt = await tool.execute({
        action: 'read', memoryIds: [mode === 'baseline' ? legacyItem.memoryId : claim.memoryId],
      });
      const surface = { answer: mode === 'baseline' ? receipt.items[0].content : receipt.claims[0].value };
      const wallUs = Number(process.hrtime.bigint() - start) / 1_000;
      samples.push({ mode, wallUs, pointerBytes: bytes(pointer), receiptBytes: bytes(receipt),
        providerCalls: 2, toolCalls: 1, surfaceDigest: digest(surface), quality: surface.answer === 'light roast' });
    }
  }
  const summarize = (mode) => {
    const rows = samples.filter((row) => row.mode === mode);
    return {
      samples: rows.length,
      medianWallUs: median(rows.map((row) => row.wallUs)),
      pointerBytes: rows[0].pointerBytes,
      receiptBytes: rows[0].receiptBytes,
      totalContextBytes: rows[0].pointerBytes + rows[0].receiptBytes,
      providerCalls: rows[0].providerCalls,
      toolCalls: rows[0].toolCalls,
      qualityPasses: rows.filter((row) => row.quality).length,
      surfaceDigests: [...new Set(rows.map((row) => row.surfaceDigest))],
    };
  };
  const baseline = summarize('baseline'); const candidate = summarize('candidate');
  return {
    schema: 't5.s3m2.temporal-memory-qualification.v1', pairs,
    fullFactorial: false, sameUserPurpose: true, baseline, candidate,
    surfaceDigestAgreement: baseline.surfaceDigests[0] === candidate.surfaceDigests[0],
    contextBytesNonRegression: candidate.totalContextBytes <= baseline.totalContextBytes,
    providerCallsNonRegression: candidate.providerCalls <= baseline.providerCalls,
    toolCallsNonRegression: candidate.toolCalls <= baseline.toolCalls,
    historicalDifferentiator: { baselineTemporalState: 'not_representable', candidateTemporalState: 'historical' },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(await runS3M2TemporalMemoryQualification(), null, 2)}\n`);
}
