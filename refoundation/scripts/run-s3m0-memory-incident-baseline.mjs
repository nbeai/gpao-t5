import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runS3M0MemoryIncidentBaseline } from '../test/helpers/s3m0-memory-incident-baseline.js';

const room = await mkdtemp(join(tmpdir(), 't5-s3m0-memory-baseline-'));
try {
  const results = await runS3M0MemoryIncidentBaseline(room);
  const counts = Object.fromEntries(['pass', 'gap', 'partial', 'not_open'].map((status) => [
    status, results.filter((item) => item.status === status).length,
  ]));
  process.stdout.write(`${JSON.stringify({
    schema: 't5.s3m.memory-incident-baseline-result.v1',
    sourceCommit: '9c96d9fbc2db9e950ebc4cb73ff5653fa55d35fb',
    productChanged: false,
    counts,
    results,
  }, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
