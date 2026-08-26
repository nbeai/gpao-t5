import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runS3M0MemoryIncidentBaseline } from './helpers/s3m0-memory-incident-baseline.js';

const root = new URL('../../', import.meta.url);
const configPath = new URL('refoundation/config/s3-memory-incidents.json', root);

test('S3-M0 실제 current source baseline은 incident manifest의 pass·gap·partial·not_open을 재현한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3m0-memory-baseline-'));
  try {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    const results = await runS3M0MemoryIncidentBaseline(room);
    assert.equal(results.length, 15);
    assert.deepEqual(results.map((item) => item.id), config.incidents.map((item) => item.id));
    assert.deepEqual(results.map((item) => item.status),
      config.incidents.map((item) => item.expectedBaseline));
    assert.deepEqual(Object.fromEntries(['pass', 'gap', 'partial', 'not_open'].map((status) => [
      status, results.filter((item) => item.status === status).length,
    ])), { pass: 4, gap: 7, partial: 2, not_open: 2 });
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('S3-M0 gap은 현재 product behavior를 지우지 않고 정확한 결함 가족을 드러낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s3m0-memory-gaps-'));
  try {
    const byId = new Map((await runS3M0MemoryIncidentBaseline(room))
      .map((item) => [item.id, item]));
    assert.equal(byId.get('M0-01').observed.foregroundAcceptedUnsupportedContent, true);
    assert.equal(byId.get('M0-04').observed.distinctPeopleSupplied, 2);
    assert.equal(byId.get('M0-04').observed.currentCandidates.length, 1);
    assert.equal(byId.get('M0-06').observed.sourceDigestPresent, false);
    assert.equal(byId.get('M0-09').observed.writeAccepted, true);
    assert.deepEqual(byId.get('M0-14').observed.foreignChannelProjected, ['private-memory']);
    assert.equal(byId.get('M0-15').observed.rawCanaryStored, true);
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
