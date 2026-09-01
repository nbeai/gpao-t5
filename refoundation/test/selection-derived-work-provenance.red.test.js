import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { WorkStore } from '../src/work-store.js';

test('RED: completed Work 선택 적용은 과거 settlement를 보존한 새 derived Work가 된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-selection-derived-red-'));
  try {
    const store = new WorkStore(room);
    const source = await store.create({ sessionId: 'session-a', sourceMessageId: 'message-source' });
    await store.claimExecution({ workId: source.workId, revision: 1, runId: 'run-source' });
    await store.settle({ workId: source.workId, revision: 1, outcome: 'achieved', runId: 'run-source' });
    const derived = await store.createDerivedFromSelection({
      sessionId: 'session-a', sourceMessageId: 'message-apply', sourceInputId: 'input-apply',
      derivedFromWorkId: source.workId, derivedFromRevision: 1,
      selectionAnchorId: 'selection_anchor_exact_0001', requestId: 'request-apply-0001',
    });
    assert.notEqual(derived.workId, source.workId);
    assert.equal(derived.revision, 1);
    assert.equal(derived.status, 'active');
    assert.deepEqual(derived.provenance, {
      derivedFromWorkId: source.workId, derivedFromRevision: 1,
      selectionAnchorId: 'selection_anchor_exact_0001', sourceInputId: 'input-apply',
      sourceMessageId: 'message-apply', reason: 'explicit_selection_apply',
    });
    const state = await store.read();
    assert.equal(state.works.find((work) => work.workId === source.workId).status, 'completed');
    assert.equal(state.events.filter((event) => event.type === 'work_derived_from_selection').length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
