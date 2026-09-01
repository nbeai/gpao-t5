import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import { makeWebCollectionPublisher } from '../src/web-collection-publication.js';

const SESSION = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

test('verified Web records는 기존 XLSX writer와 AttachmentStore로 즉시 Preview 가능한 결과가 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-web-collection-publication-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  try {
    const publish = makeWebCollectionPublisher({ attachmentStore: store, sessionId: SESSION, runId: RUN,
      scratchRoot: join(room, 'scratch') });
    const result = { state: 'verified_collection', verified: true,
      records: [1, 2, 3, 4].map((index) => ({ title: `Book ${index}`, price: `£${index}`,
        source: { page: index <= 2 ? 1 : 2, url: `https://catalog.example/page-${index <= 2 ? 1 : 2}`, item: index } })),
      coverage: { observedRecords: 4, requestedPages: 2, observedPages: 2, complete: true },
      validation: { requiredMissing: 0, duplicateCount: 0 },
      network: { origin: 'https://catalog.example', requestCount: 2 } };
    const published = await publish({ result, fields: ['title', 'price'], outputName: 'catalog.xlsx',
      structureDigest: 'a'.repeat(64) });
    assert.equal(published.artifact.originalName, 'catalog.xlsx'); assert.equal(published.cleanup, 'verified');
    assert.equal(published.reopened.kind, 'xlsx'); assert.equal(published.reopened.sheetCount, 2);
    assert.equal(published.reopened.recordRows, 5);
    const stored = await store.get({ sessionId: SESSION, attachmentId: published.artifact.attachmentId });
    const observation = await inspectBusinessDocument({ file: stored.storedPath, maxCells: 200 });
    assert.equal(observation.workbook.sheets.find((sheet) => sheet.name === 'records').rowCount, 5);
    assert.equal(observation.workbook.sheets.find((sheet) => sheet.name === 'summary').rowCount, 9);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('partial collection은 파일과 Artifact를 만들지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-web-collection-publication-reject-'));
  const store = new AttachmentStore(join(room, 'attachments'));
  try {
    const publish = makeWebCollectionPublisher({ attachmentStore: store, sessionId: SESSION, runId: RUN,
      scratchRoot: join(room, 'scratch') });
    await assert.rejects(() => publish({ result: { state: 'partial_collection', verified: false, records: [] },
      fields: ['title'], outputName: 'partial.xlsx', structureDigest: 'a'.repeat(64) }), /only a verified collection/u);
    assert.equal((await store.list({ sessionId: SESSION })).length, 0);
  } finally { await rm(room, { recursive: true, force: true }); }
});
