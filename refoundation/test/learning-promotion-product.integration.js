import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('baseline→proposal→near-miss→trial replay→field promotion→regression rollback을 관통한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-promotion-')); const errors = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    learningReviewIdleMs: 0, onError: (error) => errors.push(error), modelFactory: ({ purpose }) => {
      let turn = 0; let mode = null;
      return { async respond(input) {
        turn += 1; const last = input.messages.at(-1);
        if (purpose === 'learning_review') {
          if (last.role === 'tool') return { text: 'proposal', toolCalls: [] };
          const ids = input.tools[0].parameters.properties.sourceRunIds.items.enum;
          return { text: '', toolCalls: [{ id: 'proposal', name: 'learning_candidate', args: {
            action: 'propose', name: 'recover-durable-work', sourceRunIds: ids,
            content: '---\nname: recover-durable-work\ndescription: Recover durable work without repeating uncertain effects.\n---\n\n# Recover durable work\n\nRead the durable result, avoid uncertain effect replay, and verify the final artifact.',
          } }] };
        }
        if (purpose === 'learning_evaluation') {
          if (last.role === 'tool') return { text: 'evaluated', toolCalls: [] };
          return { text: '', toolCalls: [{ id: 'evaluation', name: 'learning_evaluation', args: {
            pairs: [1, 2].map(() => ({ samePurpose: true, baselineCorrect: true,
              candidateCorrect: true, baselineComplete: true, candidateComplete: true,
              userCorrectionPreserved: true })), nearMissShouldTrigger: false,
            sourceExpressionsReused: false, recommendAfterIndependentFieldSuccess: true,
          } }] };
        }
        mode ??= input.messages.some((message) => /FIELD|REGRESSION/u.test(String(message.content)))
          ? (/REGRESSION/u.test(input.messages.map((message) => message.content).join('\n')) ? 'regression' : 'field')
          : 'baseline';
        if (last.role === 'tool') {
          const receipt = JSON.parse(last.content);
          if (receipt.requestedCall.name === 'tool_search') {
            const tool = input.tools.some((item) => item.name === 'learning_trial') ? 'learning_trial' : 'skill';
            return { text: '', toolCalls: [{ id: 'list', name: tool,
              args: tool === 'learning_trial' ? { action: 'list', proposalId: null }
                : { action: 'search', name: 'recover durable work' } }] };
          }
          if (receipt.requestedCall.name === 'learning_trial' && receipt.requestedCall.args.action === 'list') {
            return { text: '', toolCalls: [{ id: 'view', name: 'learning_trial', args: {
              action: 'view', proposalId: receipt.result.candidates[0].proposalId } }] };
          }
          if (receipt.requestedCall.name === 'skill' && receipt.requestedCall.args.action === 'search') {
            return { text: '', toolCalls: [{ id: 'view-active', name: 'skill', args: {
              action: 'view', name: receipt.result.skills[0].name } }] };
          }
          if (['learning_trial', 'skill'].includes(receipt.requestedCall.name)) {
            return { text: '', toolCalls: [{ id: 'complete', name: 'work_completion',
              args: { outcome: mode === 'regression' ? 'unresolved' : 'achieved' } }] };
          }
          if (receipt.requestedCall.name === 'work_completion') return { text: '완료', toolCalls: [] };
          if (mode === 'baseline' && turn < 5) return { text: '', toolCalls: [{ id: `observe-${turn}`,
            name: 'exec', args: { command: `printf 'observed-${turn}'`, cwd: null, effect: { kind: 'observe',
              summary: '결과 확인', targets: [], reversible: true, backupAvailable: true,
              recipientNew: false, approvalToken: null } } }] };
          return { text: '', toolCalls: [{ id: 'complete-base', name: 'work_completion',
            args: { outcome: 'achieved' } }] };
        }
        if (mode === 'field' || mode === 'regression') return { text: '', toolCalls: [{
          id: 'search-method', name: 'tool_search', args: { query: 'recover durable work learned procedure' } }] };
        return { text: '', toolCalls: [{ id: 'observe-1', name: 'exec', args: { command: "printf 'observed-1'",
          cwd: null, effect: { kind: 'observe', summary: '결과 확인', targets: [], reversible: true,
            backupAvailable: true, recipientNew: false, approvalToken: null } } }] };
      } };
    } });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (sessionId, text) => fetch(`${base}/turn`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, text }) }).then((r) => r.json());
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
    await turn(session.id, 'BASELINE 보고서 복구'); await turn(session.id, 'BASELINE 문서 복구');
    for (let i = 0; i < 100 && !(await server.capabilityLifecycleLedger.list()).some((p) => p.state === 'candidate'); i += 1) await new Promise((r) => setTimeout(r, 10));
    const afterReview = await server.capabilityLifecycleLedger.list();
    const candidate = afterReview.find((p) => p.state === 'candidate');
    assert.ok(candidate, JSON.stringify({ proposals: afterReview,
      sources: await server.learningSourceEligibility() }));
    const proposalId = candidate.proposalId;
    await turn(session.id, 'NEAR MISS 새 일정의 제목만 정리');
    await turn(session.id, 'FIELD 보고서 복구'); await turn(session.id, 'FIELD 문서 복구');
    for (let i = 0; i < 100 && (await server.capabilityLifecycleLedger.current(proposalId)).state === 'candidate'; i += 1) await new Promise((r) => setTimeout(r, 10));
    const replayed = await server.capabilityLifecycleLedger.current(proposalId);
    assert.equal(replayed.state, 'replay_qualified', JSON.stringify({ events: replayed.events,
      errors: errors.map((error) => error?.message ?? String(error)) }));
    await turn(session.id, 'FIELD 다른 결과 복구');
    for (let i = 0; i < 100 && (await server.capabilityLifecycleLedger.current(proposalId)).state !== 'active'; i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal((await server.capabilityLifecycleLedger.current(proposalId)).state, 'active',
      errors.map((error) => error?.message ?? String(error)).join('\n'));
    assert.equal((await (await server.managedSkillStore).activeRevision('recover-durable-work')).active, true);
    await turn(session.id, 'REGRESSION 복구 결과가 부족하면 미완료로 남겨');
    const rolled = await server.capabilityLifecycleLedger.current(proposalId);
    const latestRun = (await server.runLedger.list({ sessionId: session.id }))[0];
    assert.equal(rolled.state, 'archived', JSON.stringify({ errors: errors.map((e) => e?.message ?? String(e)),
      capabilities: (await import('../src/capability-outcome-evidence.js')).capabilityObservationsForRun(latestRun),
      events: rolled.events }));
    assert.equal((await (await server.managedSkillStore).activeRevision('recover-durable-work')).active, false);
  } finally {
    await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
