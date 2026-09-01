import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { summarizeExistingPathTrace } from './helpers/nx-existing-path-trace.js';

test('existing-path trace는 source entry·bind·Integral 경계를 원문 없이 분리한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 't5-nx2-trace-')); const sessionId = 'session-test';
  const prompt = join(root, 'diagnostics', sessionId, '1', 'connection-0', 'prompt'); await mkdir(prompt, { recursive: true });
  await writeFile(join(prompt, '0001.json'), JSON.stringify({ body: { input: '재고가 안 맞는데 원인 찾아줘.',
    tools: [{ type: 'function', name: 'tool_search' }, { type: 'function', name: 'exec' }] } }));
  const receipt = (name, action, result = {}) => ({ actualCall: { name, args: { action,
    sourceUses: action === 'bind_sources' ? [{ handle: 'opaque' }] : null,
    unknowns: action === 'bind_sources' ? ['관계 미확인'] : null } }, outcome: 'succeeded', result });
  try {
    const trace = await summarizeExistingPathTrace({ stateDir: root, sessionId,
      userRequest: '재고가 안 맞는데 원인 찾아줘.', purposePassed: false,
      run: { events: [
        { type: 'tool_completed', payload: { receipt: receipt('file_reality', 'search', {
          candidates: [{ displayName: '재고현황.csv' }], coverage: { filenameScope: 'complete',
            contentScope: 'complete', visualScope: 'unavailable', truncated: false } }) } },
        { type: 'tool_completed', payload: { receipt: receipt('file_reality', 'inspect', {
          file: { displayName: '재고현황.csv', contentTruncated: false } }) } },
        { type: 'tool_completed', payload: { receipt: receipt('file_reality', 'bind_sources', {
          state: 'bound', integralMethod: { state: 'ready' } }) } },
      ] } });
    assert.deepEqual(trace.promptCalls[0].toolNames, ['tool_search', 'exec']);
    assert.equal(trace.promptCalls[0].requestPresent, true);
    assert.equal(trace.boundary.sourceEntered, true);
    assert.equal(trace.boundary.sourceBound, true);
    assert.equal(trace.boundary.integralEntered, false);
    assert.equal(trace.boundary.failureStage, 'after_bind_before_integral');
    assert.doesNotMatch(JSON.stringify(trace), /opaque|관계 미확인/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('File Reality 호출 전 종료는 before_source_entry로 분리한다', async () => {
  const trace = await summarizeExistingPathTrace({ stateDir: '/unavailable', sessionId: 'none',
    userRequest: '매출을 봐줘', purposePassed: false, run: { events: [] } });
  assert.equal(trace.boundary.failureStage, 'before_source_entry');
});
