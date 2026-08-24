import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkStore } from '../src/work-store.js';
import { makeWorkCompletionTool } from '../src/work-completion-tool.js';

async function fixture() {
  const store = new WorkStore(await mkdtemp(join(tmpdir(), 't5-work-completion-')));
  const work = await store.create({ sessionId: 'session', sourceMessageId: 'message' });
  await store.claimExecution({ workId: work.workId, revision: 1, runId: 'run' });
  return { store, work, tool: makeWorkCompletionTool({ store, runId: 'run' }) };
}

test('모델이 명시적 achieved를 제안하고 blocker Receipt가 없을 때만 achieved 후보가 된다', async () => {
  const { store, tool } = await fixture();
  const result = await tool.execute({ outcome: 'achieved' }, { priorReceipts: [] });
  assert.equal(result.verifiedOutcome, 'achieved');
  assert.equal((await store.proposalForRun('run')).verifiedOutcome, 'achieved');
});

test('effect unknown·failed Receipt가 있으면 모델 achieved 제안도 unresolved로 정산한다', async () => {
  for (const receipt of [
    { outcome: 'unknown', result: {} },
    { outcome: 'succeeded', result: { effectUnknown: true } },
    { outcome: 'failed', result: {} },
  ]) {
    const { tool } = await fixture();
    const result = await tool.execute({ outcome: 'achieved' }, { priorReceipts: [receipt] });
    assert.equal(result.verifiedOutcome, 'unresolved');
  }
});
