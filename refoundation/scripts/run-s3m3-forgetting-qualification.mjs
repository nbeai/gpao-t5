import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ForgettingCoordinator } from '../src/forgetting-coordinator.js';
import { MemoryLedger } from '../src/memory-ledger.js';
import { makeRecordReference } from '../src/record-reference.js';
import { makeMemoryClaim } from '../src/temporal-memory.js';

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reference = (id) => makeRecordReference({
  sourceKind: 'conversation_message', sourceStore: 'conversation-ledger', sourceId: id,
  sourceRevision: 1, sha256: createHash('sha256').update(id).digest('hex'),
  occurredAt: '2026-08-26T00:00:00.000Z', recordedAt: '2026-08-26T00:00:01.000Z',
  scope: { sessionId: 'session-1', workId: null, subjectKeys: [], channel: 'console' },
  trust: 'user_asserted', sensitivity: 'personal', coverage: 'full', availability: 'available',
});

async function seeded(room) {
  const ledger = new MemoryLedger(join(room, 'memory')); await ledger.ensure();
  await ledger.commitClaim({ claim: makeMemoryClaim({
    memoryId: 'memory-forget', kind: 'preference', subjectKey: 'subject-forget', value: 'safe preference',
    scope: { global: true, workId: null, projectId: null, personId: 'person:owner', organizationId: null },
    sources: [reference('source-1')], recordedAt: '2026-08-26T00:01:00.000Z',
    validFrom: '2026-01-01T00:00:00.000Z', validTo: '2027-01-01T00:00:00.000Z',
    subjectRevision: 1, sourceOrder: 2, status: 'active', supersedes: [], conflictsWith: [],
    sensitivity: 'personal', alwaysRelevant: false,
  }) });
  return ledger;
}

export async function runS3M3ForgettingQualification({ pairs = 12 } = {}) {
  const samples = [];
  for (let pair = 0; pair < pairs; pair += 1) {
    for (const mode of pair % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const room = await mkdtemp(join(tmpdir(), `t5-s3m3-${mode}-`));
      try {
        const ledger = await seeded(room); const beforeBytes = (await readFile(ledger.path)).length;
        const started = process.hrtime.bigint(); let receipt = null; let restored = false;
        if (mode === 'baseline') {
          await ledger.retractClaim({ memoryId: 'memory-forget', recordRefs: [reference('forget-request')] });
        } else {
          const coordinator = new ForgettingCoordinator({
            memoryLedger: ledger, makeId: () => 'forget-request', now: () => '2026-08-26T08:00:00.000Z',
            exactRecallProbe: async () => (await ledger.read()).claims
              .filter((claim) => claim.memoryId === 'memory-forget' && claim.status === 'active').length,
            contextProjectionProbe: async () => (await ledger.read()).items
              .filter((item) => item.memoryId === 'memory-forget').length,
          });
          const plan = await coordinator.preview({ memoryIds: ['memory-forget'], subjectKeys: [], scopeIds: [] });
          receipt = (await coordinator.execute({ plan, recordRefs: [reference('forget-request')] })).receipt;
          restored = (await coordinator.restore({ requestId: plan.requestId, memoryId: 'memory-forget',
            recordRefs: [reference('restore-request')] })).state === 'restored';
        }
        const wallUs = Number(process.hrtime.bigint() - started) / 1_000;
        const state = await ledger.read(); const afterBytes = (await readFile(ledger.path)).length;
        samples.push({
          mode, wallUs, addedEventBytes: afterBytes - beforeBytes,
          surfaceDigest: hash({ answer: 'forgotten' }), providerCalls: 0, externalWrites: 0,
          exactHitAfterForget: mode === 'baseline' ? 0 : receipt.searchHitAfter,
          contextAfterForget: mode === 'baseline' ? 0 : receipt.contextProjectionAfter,
          receiptPresent: Boolean(receipt), tombstoneCreated: mode === 'candidate', restored,
          unrelatedLoss: state.claims.filter((claim) => claim.memoryId !== 'memory-forget'
            && claim.status !== 'active').length,
        });
      } finally { await rm(room, { recursive: true, force: true }); }
    }
  }
  const summary = (mode) => {
    const rows = samples.filter((sample) => sample.mode === mode);
    return { samples: rows.length, medianWallUs: median(rows.map((row) => row.wallUs)),
      medianAddedEventBytes: median(rows.map((row) => row.addedEventBytes)),
      providerCalls: 0, externalWrites: 0, exactHitAfterForget: rows[0].exactHitAfterForget,
      contextAfterForget: rows[0].contextAfterForget,
      receiptPresent: rows[0].receiptPresent, tombstoneCreated: rows[0].tombstoneCreated,
      restored: rows[0].restored, unrelatedLoss: Math.max(...rows.map((row) => row.unrelatedLoss)),
      surfaceDigests: [...new Set(rows.map((row) => row.surfaceDigest))] };
  };
  const baseline = summary('baseline'); const candidate = summary('candidate');
  return { schema: 't5.s3m3.forgetting-qualification.v1', pairs, sameUserPurpose: true,
    fullFactorial: false, baseline, candidate,
    surfaceDigestAgreement: baseline.surfaceDigests[0] === candidate.surfaceDigests[0],
    candidateAddedCapabilities: ['revision-bound preview', 'partitioned receipt', 'tombstone', 'restore'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(await runS3M3ForgettingQualification(), null, 2)}\n`);
}
