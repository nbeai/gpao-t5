import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const evidenceUrl = new URL('../evidence/s6-perf0-current-head-timeline-2026-08-31.json', import.meta.url);

test('PERF-0은 기존 원장을 content-free timeline으로 재계산하고 새 성능 Store를 만들지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.equal(value.status, 'COMPLETE_PERF2A_QUALIFICATION_OPEN');
  assert.equal(value.productBehaviorChanges, 0);
  assert.equal(value.newStores, 0);
  assert.equal(value.projection.contentFree, true);
  assert.equal(value.projection.newCanonicalEvents, 0);
  assert.ok(value.projection.explicitUnknowns.includes('Tool preflight duration'));
});

test('PERF-0은 현재 all-or-nothing과 정적 Tool granularity를 최초 후보로만 연다', async () => {
  const [value, agentLoop, factory, openai] = await Promise.all([
    readFile(evidenceUrl, 'utf8').then(JSON.parse),
    readFile(new URL('../src/agent-loop.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/console-model-factory.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/openai-responses-model.js', import.meta.url), 'utf8'),
  ]);
  assert.match(agentLoop, /response\.toolCalls\.every[\s\S]*executionMode === 'parallel'/u);
  assert.doesNotMatch(factory, /parallelToolCalls/u);
  assert.doesNotMatch(openai, /parallel_tool_calls/u);
  assert.equal(value.currentSourceAudit.mixedSequentialParallelSegmentation, false);
  assert.equal(value.currentSourceAudit.providerParallelCapability, 'unknown');
  assert.equal(value.firstOpenedDefectFamily.qualificationNeeded, true);
  assert.equal(value.firstOpenedDefectFamily.productImplementationAuthorized, false);
});

test('PERF-0은 과거 aggregate를 호출 독립성 증명으로 과장하지 않는다', async () => {
  const value = JSON.parse(await readFile(evidenceUrl, 'utf8'));
  assert.ok(value.reusedEvidence.length >= 3);
  assert.ok(value.forbiddenClaims.includes('model calls are independent from aggregate counts alone'));
  assert.ok(value.forbiddenClaims.includes('provider parallel Tool support is qualified'));
});
