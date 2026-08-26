import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function post(base, path, value) {
  const response = await fetch(`${base}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  return { status: response.status, cacheControl: response.headers.get('cache-control'),
    body: await response.json() };
}

test('Reflection 검토 API는 설정에서만 sanitized 상태와 retain·reject·later를 연결한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-reflection-review-server-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const calls = [];
  const item = { reviewHandle: 'review_safe', revisionHandle: 'revision_safe',
    title: '검토할 배운 점', hypothesis: '현재 결과를 먼저 확인하는 잠정적 방법',
    status: 'needs_review', statusLabel: '검토 필요', actions: { retain: true, reject: true },
    counts: { supportingExperiences: 2, supportingSources: 8, counterexamples: 1,
      uncertainties: 1, currentCorrections: 1 }, applied: false };
  const reflectionReviewCoordinator = {
    async list() { calls.push(['list']); return { schema: 't5.reflection-review-surface.v1',
      appliedCount: 0, items: [item], sideEffects: { writes: 0 } }; },
    async detail(input) { calls.push(['detail', input]); return { item: { ...item,
      notices: ['아직 어떤 작업에도 적용되지 않았어요.'], support: [], counterexamples: [],
      uncertainties: ['추가 검증 필요'], currentCorrections: [] }, sideEffects: { writes: 0 } }; },
    async source(input) { calls.push(['source', input]);
      if (input.sourceHandle !== 'source_safe') throw Object.assign(new Error('not found'), {
        code: 'reflection_source_not_found' });
      return { source: {
      state: 'available', stateLabel: '현재 원본을 확인했어요.', content: '안전한 출처 내용',
    }, sideEffects: { writes: 0 } }; },
    async retain(input) { calls.push(['retain', input]); return { decision: 'kept_for_review',
      item: { ...item, status: 'kept_for_review', applied: false }, sideEffects: { memoryWrites: 0,
        principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 } }; },
    async reject(input) { calls.push(['reject', input]); return { decision: 'not_used',
      item: { ...item, status: 'not_used', applied: false }, sideEffects: { memoryWrites: 0,
        principleWrites: 0, managedCapabilityChanges: 0, externalWrites: 0 } }; },
    async later(input) { calls.push(['later', input]); return { decision: 'unchanged', item,
      sideEffects: { writes: 0 } }; },
  };
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }),
    reflectionReviewCoordinator });
  const base = await listen(server);
  try {
    await fetch(`${base}/memory/state`); await fetch(`${base}/overview`);
    assert.deepEqual(calls, []);
    const stateResponse = await fetch(`${base}/reflection/review/state`);
    assert.equal(stateResponse.headers.get('cache-control'), 'no-store');
    const state = await stateResponse.json();
    assert.equal(state.items[0].applied, false); assert.deepEqual(calls, [['list']]);
    const detail = await post(base, '/reflection/review/detail', { reviewHandle: 'review_safe' });
    assert.equal(detail.status, 200); assert.equal(detail.cacheControl, 'no-store');
    assert.equal(detail.body.item.applied, false);
    const source = await post(base, '/reflection/review/source', {
      reviewHandle: 'review_safe', sourceHandle: 'source_safe' });
    assert.equal(source.cacheControl, 'no-store');
    assert.equal(source.body.source.content, '안전한 출처 내용');
    for (const decision of ['retain', 'reject', 'later']) {
      const action = await post(base, '/reflection/review/action', { requestId: `request-${decision}`,
        reviewHandle: 'review_safe', revisionHandle: 'revision_safe', decision });
      assert.equal(action.status, 200); assert.equal(action.body.item.applied, false);
    }
    const unknown = await post(base, '/reflection/review/action', { requestId: 'request-forged',
      reviewHandle: 'review_safe', revisionHandle: 'revision_safe', decision: 'retain',
      reflectionId: 'forged' });
    assert.equal(unknown.status, 400);
    const foreign = await post(base, '/reflection/review/source', {
      reviewHandle: 'review_safe', sourceHandle: 'source_foreign' });
    assert.equal(foreign.status, 404); assert.equal(foreign.cacheControl, 'no-store');
    const serialized = JSON.stringify({ state, detail: detail.body, source: source.body });
    assert.doesNotMatch(serialized, /reflectionId|recordId|sourceFence|candidateDigest|materializationDigest/u);
  } finally {
    await server.closeBrowsers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});

test('Reflection coordinator가 없으면 빈 설정 상태만 보이고 action은 쓰지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-reflection-review-empty-'));
  const server = makeConsoleServer({ stateDir: room, workspace: room,
    modelFactory: () => ({ async respond() { return { text: 'ok', toolCalls: [] }; } }) });
  const base = await listen(server);
  try {
    const state = await fetch(`${base}/reflection/review/state`).then((response) => response.json());
    assert.equal(state.available, false); assert.deepEqual(state.items, []);
    const action = await post(base, '/reflection/review/action', { decision: 'retain' });
    assert.equal(action.status, 409);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});
