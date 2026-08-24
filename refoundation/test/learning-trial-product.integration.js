import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { capabilityObservationsForRun } from '../src/capability-outcome-evidence.js';

const source = (index) => ({ eligible: true, pointer: { workId: `w${index}`, revision: 1,
  runId: `r${index}`, sessionId: `s${index}`, sourceMessageId: `m${index}`, resultDigest: `d${index}` } });
const content = '---\nname: recover-results\ndescription: Recover durable results without repeating uncertain effects.\n---\n\n# Recover results\n\nRead the durable result, avoid uncertain effect replay, and verify the artifact.';

test('pending candidate는 관련 Work의 on-demand trial로만 열리고 Run receipt에 exact revision을 남긴다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-trial-product-')); let step = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    learningReviewMode: 'off', modelFactory: () => ({ async respond(input) {
      step += 1; const last = input.messages.at(-1);
      if (last.role === 'tool') {
        const receipt = JSON.parse(last.content);
        if (receipt.requestedCall.name === 'tool_search') return { text: '', toolCalls: [{
          id: 'list', name: 'learning_trial', args: { action: 'list', proposalId: null },
        }] };
        if (receipt.requestedCall.name === 'learning_trial' && receipt.requestedCall.args.action === 'list') {
          return { text: '', toolCalls: [{ id: 'view', name: 'learning_trial', args: {
            action: 'view', proposalId: receipt.result.candidates[0].proposalId,
          } }] };
        }
        if (receipt.requestedCall.name === 'learning_trial') return { text: '', toolCalls: [{
          id: 'complete', name: 'work_completion', args: { outcome: 'achieved' },
        }] };
        return { text: '결과를 확인했습니다.', toolCalls: [] };
      }
      const candidate = input.tools.find((tool) => tool.name === 'learning_trial');
      assert.ok(candidate); const proposalId = candidate.parameters.properties.proposalId.enum.find(Boolean);
      return { text: '', toolCalls: [{ id: 'view', name: 'learning_trial', args: {
        action: 'view', proposalId,
      } }] };
    } }) });
  await server.learningCandidateStore.stage({ name: 'recover-results',
    description: 'Recover durable results without repeating uncertain effects.', content,
    sourcePointers: [source(1), source(2)], createdRunId: 'review' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '중단된 결과를 안전하게 복구해줘' }) }).then((response) => response.json());
    const run = await server.runLedger.read(result.runId); const used = capabilityObservationsForRun(run)
      .find((item) => item.id === 'recover-results' && item.relation === 'used');
    const calls = run.events.filter((event) => event.type === 'tool_completed')
      .map((event) => event.payload.receipt.requestedCall);
    assert.equal(calls.some((call) => call.name === 'tool_search'), false);
    assert.equal(calls.some((call) => call.name === 'learning_trial' && call.args.action === 'list'), false);
    assert.equal(calls.some((call) => call.name === 'learning_trial' && call.args.action === 'view'), true);
    assert.equal(used.digest, (await server.learningCandidateStore.inspect(
      (await server.capabilityLifecycleLedger.list())[0].proposalId)).revisionDigest);
    assert.equal((await server.capabilityLifecycleLedger.list())[0].state, 'candidate');
    const proposal = (await server.capabilityLifecycleLedger.list())[0];
    const field = proposal.events.find((event) => event.type === 'learning_field_observed');
    assert.equal(field.achieved, true); assert.equal(field.candidateRevision.digest, used.digest);
    assert.equal(field.workPointer.runId, result.runId);
  } finally {
    await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
