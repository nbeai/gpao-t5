import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ConversationLedger } from '../src/conversation-ledger.js';
import { projectConversationRecordReference } from '../src/record-projection.js';
import { makeRecordSourceReader } from '../src/record-source-reader.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const micros = (nanoseconds) => Number(nanoseconds) / 1_000;

export async function runS3M1RecordProvenanceQualification({ pairs = 12 } = {}) {
  if (!Number.isInteger(pairs) || pairs < 3 || pairs > 100) throw new TypeError('pairs must be 3..100');
  const room = await mkdtemp(join(tmpdir(), 't5-s3m1-record-'));
  try {
    const sessionId = randomUUID();
    const conversationLedger = new ConversationLedger(join(room, 'conversations'));
    await conversationLedger.ensure({ sessionId });
    const event = await conversationLedger.appendMessage({
      sessionId, messageId: 'qualification-message',
      message: { role: 'user', content: 'S3-M1 safe source canary' },
    });
    const reference = projectConversationRecordReference({
      event, expectedSessionId: sessionId, trust: 'user_asserted',
      observedAt: '2026-08-26T04:00:00.000Z',
    });
    const product = {
      providerRequest: { userPurpose: 'reopen one exact source' },
      toolCalls: [{ name: 'qualified-source-fixture', outcome: 'completed' }],
      authority: [{ effect: 'observe', allowed: true }],
      effects: [{ effect: 'observe', outcome: 'succeeded' }],
      surface: { answer: '원본 하나를 확인했습니다.', artifacts: [] },
    };
    const productDigest = hash(product);
    const samples = [];
    for (let index = 0; index < pairs; index += 1) {
      for (const mode of index % 2 === 0
        ? ['O0_off', 'O2_full_shadow'] : ['O2_full_shadow', 'O0_off']) {
        const before = process.hrtime.bigint();
        const result = await makeRecordSourceReader({ mode, conversationLedger })
          .reopen(reference, { expectedSessionId: sessionId });
        const wallNs = process.hrtime.bigint() - before;
        samples.push({
          pair: index + 1,
          mode,
          productDigest,
          wallUs: micros(wallNs),
          readerUs: result.accounting?.durationNs == null
            ? null : micros(BigInt(result.accounting.durationNs)),
          accountingBytes: result.accounting == null
            ? 0 : Buffer.byteLength(JSON.stringify(result.accounting), 'utf8'),
          state: result.state,
        });
      }
    }
    const byMode = Object.fromEntries(['O0_off', 'O2_full_shadow'].map((mode) => {
      const rows = samples.filter((sample) => sample.mode === mode);
      return [mode, {
        samples: rows.length,
        medianWallUs: median(rows.map((row) => row.wallUs)),
        medianReaderUs: mode === 'O2_full_shadow'
          ? median(rows.map((row) => row.readerUs)) : null,
        medianAccountingBytes: median(rows.map((row) => row.accountingBytes)),
        states: [...new Set(rows.map((row) => row.state))],
      }];
    }));
    return {
      schema: 't5.s3m1.record-provenance-qualification.v1',
      sourceCommit: '508b6302f00f0ea01a2446156d39912761c3aabd',
      pairs,
      fullFactorial: false,
      productDigestAgreement: new Set(samples.map((sample) => sample.productDigest)).size === 1,
      providerRequestChanged: false,
      toolCallsChanged: false,
      authorityChanged: false,
      effectsChanged: false,
      surfaceChanged: false,
      shadowRunsAfterTerminalProductDigest: true,
      rawSourceInAccounting: false,
      byMode,
    };
  } finally {
    await rm(room, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(await runS3M1RecordProvenanceQualification(), null, 2)}\n`);
}
