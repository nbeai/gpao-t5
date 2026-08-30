import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

test('3차 제품 기본값은 M6 background learning을 시작하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-default-off-')); let reviewerCalls = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    learningReviewIdleMs: 0, modelFactory: ({ purpose }) => ({ async respond(input) {
      if (purpose === 'learning_review') { reviewerCalls += 1; return { text: 'unexpected', toolCalls: [] }; }
      if (input.messages.at(-1)?.role === 'tool') return { text: '완료', toolCalls: [] };
      return { text: '', toolCalls: [{ id: `complete-${Date.now()}`, name: 'work_completion',
        args: { outcome: 'achieved', inputSettlements: [] } }] };
    } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    for (const text of ['첫 작업을 끝내줘', '둘째 작업을 끝내줘']) {
      const response = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, text }) });
      assert.equal(response.status, 200);
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(reviewerCalls, 0);
    assert.equal((await server.capabilityLifecycleLedger.events())
      .some((event) => event.type === 'learning_review_completed'), false);
  } finally {
    await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});

test('두 achieved Work 뒤 reviewer는 foreground를 막지 않고 proposal 하나만 background admission한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-learning-background-')); let reviewerCalls = 0;
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    learningReviewMode: 'proposal', learningReviewIdleMs: 0, modelFactory: ({ purpose }) => ({ async respond(input) {
      const last = input.messages.at(-1);
      if (purpose === 'learning_review') {
        reviewerCalls += 1;
        if (last.role === 'tool') return { text: 'proposal prepared', toolCalls: [] };
        const candidate = input.tools.find((tool) => tool.name === 'learning_candidate');
        const ids = candidate.parameters.properties.sourceRunIds.items.enum;
        return { text: '', toolCalls: [{ id: 'learn', name: 'learning_candidate', args: {
          action: 'propose', name: 'verify-durable-results', sourceRunIds: ids,
          content: '---\nname: verify-durable-results\ndescription: Verify durable results before repeating uncertain work.\n---\n\n# Verify durable results\n\nRead the durable result, avoid uncertain effect replay, and verify the final artifact.',
        } }] };
      }
      if (last.role === 'tool') return { text: '작업 결과를 확인했습니다.', toolCalls: [] };
      return { text: '', toolCalls: [{ id: `complete-${Date.now()}`, name: 'work_completion',
        args: { outcome: 'achieved', inputSettlements: [] } }] };
    } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    for (const text of ['중단된 보고서 결과를 재실행 없이 확인해줘', '중단된 문서 결과도 같은 방식으로 확인해줘']) {
      const began = performance.now(); const response = await fetch(`${base}/turn`, { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: session.id, text }) });
      assert.equal(response.status, 200); assert.ok(performance.now() - began < 500);
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((await server.capabilityLifecycleLedger.events())
        .some((item) => item.type === 'learning_review_completed')) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const candidates = (await server.capabilityLifecycleLedger.list()).filter((item) => item.state === 'candidate');
    assert.equal(candidates.length, 1); assert.equal(candidates[0].sourcePointers.length, 2);
    assert.equal(reviewerCalls, 2);
    const visible = await fetch(`${base}/skills`).then((response) => response.json());
    const pending = visible.skills.find((skill) => skill.id === 'verify-durable-results');
    assert.deepEqual({ state: pending.state, active: pending.active, candidate: pending.candidate,
      contentDigest: pending.contentDigest }, {
      state: 'candidate', active: false, candidate: true, contentDigest: null,
    });
  } finally {
    await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
