import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CapabilityLifecycleLedger } from '../src/capability-lifecycle.js';
import { LearningCandidateStore } from '../src/learning-candidate.js';
import { runLearningReview } from '../src/learning-review.js';

const sources = [1, 2].map((index) => ({ eligible: true, pointer: {
  workId: `work-${index}`, revision: 1, runId: `run-${index}`, sessionId: `session-${index}`,
  sourceMessageId: `message-${index}`, resultDigest: `result-${index}` } }));

test('격리 reviewer는 Episode evidence와 proposal 도구 하나만 받고 active 행동 없이 끝난다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-review-')); let turn = 0;
  try {
    const store = new LearningCandidateStore({ ledger: new CapabilityLifecycleLedger(room),
      makeId: () => 'review-proposal' });
    const model = { async respond(input) {
      turn += 1; assert.deepEqual(input.tools.map((tool) => tool.name), ['learning_candidate']);
      if (turn === 1) return { text: '', toolCalls: [{ id: 'proposal', name: 'learning_candidate', args: {
        action: 'propose', name: 'recover-interrupted-results',
        content: '---\nname: recover-interrupted-results\ndescription: Recover interrupted results without replaying uncertain effects.\n---\n\n# Recover interrupted results\n\nRead the durable result first, avoid uncertain effect replay, and verify the final artifact.',
        sourceRunIds: ['run-1', 'run-2'],
      } }] };
      return { text: 'Proposal prepared.', toolCalls: [] };
    } };
    const result = await runLearningReview({ episodes: [
      { source: sources[0], methodTrace: [{ tool: 'exec', template: 'ledger-inspect inspect <target.ledgerpack>' }],
        evidence: 'A durable result existed; it was reopened without repeating the write.' },
      { source: sources[1], methodTrace: [{ tool: 'exec', template: 'ledger-inspect inspect <target.ledgerpack>' }],
        evidence: 'The result pointer was reused and the artifact was verified before completion.' },
    ], model, candidateStore: store, reviewRunId: 'review-run' });
    assert.equal(result.status, 'completed'); assert.equal(result.proposal.state, 'candidate');
    assert.deepEqual((await store.inspect('review-proposal')).methodTrace,
      [{ tool: 'exec', template: 'ledger-inspect inspect <target.ledgerpack>' }]);
    assert.equal((await store.ledger.current('review-proposal')).events.length, 1);
  } finally { await rm(room, { recursive: true, force: true }); }
});
