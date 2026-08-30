import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

test('S6-A는 capability reality를 필요할 때만 발견하고 read-only 사실 뒤 바로 답한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s6-capability-reality-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const calls = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    capabilitySurfaceMode: 'directory-first-v1', workAdmissionMode: 'action-v1',
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      if (calls.length === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'capability_reality'), false);
        return { text: '', toolCalls: [{ id: 'find-reality', name: 'tool_search',
          args: { query: 'current usable missing degraded preparable capability reality' } }] };
      }
      if (calls.length === 2) {
        assert.ok(input.tools.some((tool) => tool.name === 'capability_reality'));
        assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
        return { text: '', toolCalls: [{ id: 'inspect-reality', name: 'capability_reality',
          args: { action: 'list', id: null } }] };
      }
      const receipt = JSON.parse(input.messages.findLast((message) => (
        message.name === 'capability_reality'
      )).content);
      assert.equal(receipt.result.schema, 't5.capability-reality.v1');
      assert.deepEqual(receipt.result.coverage, {
        currentConnections: 'complete', bundledCatalog: 'complete', managedSkills: 'complete',
        managedCli: 'complete', hostPlatform: 'complete',
      });
      assert.ok(receipt.result.facts.length > 0);
      assert.ok(receipt.result.facts.some((fact) => fact.kind === 'procedural_skill'));
      assert.ok(receipt.result.facts.some((fact) => fact.kind === 'managed_cli'));
      assert.ok(receipt.result.facts.some((fact) => fact.kind === 'host_platform'));
      assert.ok(receipt.result.facts.every((fact) => [
        'usable_now', 'available_inactive', 'needs_auth', 'preparable',
        'degraded', 'incompatible', 'unknown',
      ].includes(fact.reality)));
      return { text: '현재 확인된 능력과 준비 후보를 구분했습니다.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '지금 쓸 수 있는 능력과 준비 가능한 대안을 확인해줘' }),
    }).then((response) => response.json());
    assert.equal(result.reply, '현재 확인된 능력과 준비 후보를 구분했습니다.', JSON.stringify({
      result, tools: calls.map((call) => call.tools.map((tool) => tool.name)),
    }));
    assert.equal(calls.length, 3);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
