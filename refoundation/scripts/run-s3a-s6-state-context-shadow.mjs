import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { createS6Fixture, ORACLE_MARKERS } from '../test/helpers/s3a-s6-state-context.js';

const run = promisify(execFile);
const worker = new URL('./run-s3a-s6-probe-worker.mjs', import.meta.url).pathname;
const conditions = [
  ['short_session', 'cold_process'],
  ['short_session', 'warm_resident'],
  ['long_session', 'cold_process'],
  ['long_session', 'warm_resident'],
];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const ms = (nanoseconds) => Number(nanoseconds) / 1e6;

const room = await mkdtemp(join(tmpdir(), 't5-s3a-s6-shadow-'));
try {
  const roots = {
    short_session: join(room, 'short'),
    long_session: join(room, 'long'),
  };
  await createS6Fixture(roots.short_session, 'short_session');
  await createS6Fixture(roots.long_session, 'long_session');
  const fixtureBytes = {
    shortConversationJsonl: (await stat(join(roots.short_session, 'conversation', '11111111-1111-4111-8111-111111111111.jsonl'))).size,
    longConversationJsonl: (await stat(join(roots.long_session, 'conversation', '22222222-2222-4222-8222-222222222222.jsonl'))).size,
  };
  const samples = [];
  for (let block = 0; block < 3; block += 1) {
    const order = [...conditions.slice(block), ...conditions.slice(0, block)];
    for (const [sessionClass, condition] of order) {
      const processStarted = process.hrtime.bigint();
      const { stdout } = await run(process.execPath, [
        worker, roots[sessionClass], sessionClass, condition,
      ], { maxBuffer: 10 * 1024 * 1024 });
      const processWallMs = Number(process.hrtime.bigint() - processStarted) / 1e6;
      const result = JSON.parse(stdout);
      samples.push({
        block, sessionClass, condition,
        stateReadReplayMs: ms(result.phases.state_read_replay.durationNs),
        contextCompilationMs: ms(result.phases.context_compilation.durationNs),
        subprocessTotalWallMs: processWallMs,
        requestBytes: result.context.requestBytes,
        inputItems: result.context.inputItems,
        tailEntries: result.context.tailEntries,
        checkpointPresent: result.context.checkpointPresent,
        bodyDigest: result.context.bodyDigest,
        oraclePassed: ORACLE_MARKERS.every((marker) => result.context.oracle[marker] === true),
        stateFacts: result.stateFacts,
      });
    }
  }
  const groups = Object.fromEntries(conditions.map(([sessionClass, condition]) => {
    const selected = samples.filter((sample) => (
      sample.sessionClass === sessionClass && sample.condition === condition
    ));
    return [`${sessionClass}:${condition}`, {
      n: selected.length,
      stateReadReplayMedianMs: median(selected.map((sample) => sample.stateReadReplayMs)),
      contextCompilationMedianMs: median(selected.map((sample) => sample.contextCompilationMs)),
      subprocessTotalWallMedianMs: median(selected.map((sample) => sample.subprocessTotalWallMs)),
      requestBytes: [...new Set(selected.map((sample) => sample.requestBytes))],
      inputItems: [...new Set(selected.map((sample) => sample.inputItems))],
      tailEntries: [...new Set(selected.map((sample) => sample.tailEntries))],
      bodyDigests: [...new Set(selected.map((sample) => sample.bodyDigest))].length,
      oraclePassed: selected.every((sample) => sample.oraclePassed),
    }];
  }));
  const delta = (phase, left, right) => groups[left][phase] - groups[right][phase];
  const result = {
    schema: 't5.s3a.s6-state-context-shadow-result.v1',
    blocks: 3,
    samples: samples.length,
    processColdDefinition: 'fresh Node process and new store instances; operating-system page cache not purged',
    warmResidentDefinition: 'same process and store instances after one unmeasured state+context pass',
    subprocessWallComparability: 'not comparable across cold/warm because warm includes the unmeasured preparation pass; phase spans exclude it',
    fixtureBytes,
    groups,
    deltasMs: {
      longMinusShortColdState: delta('stateReadReplayMedianMs', 'long_session:cold_process', 'short_session:cold_process'),
      longMinusShortWarmState: delta('stateReadReplayMedianMs', 'long_session:warm_resident', 'short_session:warm_resident'),
      longMinusShortColdContext: delta('contextCompilationMedianMs', 'long_session:cold_process', 'short_session:cold_process'),
      longMinusShortWarmContext: delta('contextCompilationMedianMs', 'long_session:warm_resident', 'short_session:warm_resident'),
      longWarmMinusColdState: delta('stateReadReplayMedianMs', 'long_session:warm_resident', 'long_session:cold_process'),
      longWarmMinusColdContext: delta('contextCompilationMedianMs', 'long_session:warm_resident', 'long_session:cold_process'),
    },
    rawSamples: samples,
    pass: Object.values(groups).every((group) => (
      group.n === 3 && group.bodyDigests === 1 && group.oraclePassed
    )),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await rm(room, { recursive: true, force: true });
}
