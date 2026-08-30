import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

test('S6-C 사용자는 package 이름 없이 text Skill을 준비하고 같은 Run에서 원래 분류 목적을 끝낸다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-s6-natural-skill-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const calls = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    managedSkillsRoot: join(room, 'managed-skills'), capabilitySurfaceMode: 'directory-first-v1',
    workAdmissionMode: 'action-v1',
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      if (calls.length === 1) return { text: '', toolCalls: [{ id: 'find-method', name: 'tool_search',
        args: { query: 'managed procedural method for customer inquiry triage installation' } }] };
      if (calls.length === 2) {
        assert.ok(input.tools.some((tool) => tool.name === 'capability_prepare'));
        return { text: '', toolCalls: [{ id: 'search-method', name: 'capability_prepare',
          args: { action: 'search', name: 'customer-inquiry-triage', effect: null } }] };
      }
      if (calls.length === 3) {
        assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
        const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'capability_prepare').content);
        assert.equal(receipt.result.skills[0].name, 'customer-inquiry-triage');
        return { text: '', toolCalls: [{ id: 'install-method', name: 'capability_prepare', args: {
          action: 'install', name: 'customer-inquiry-triage', effect: { kind: 'local_change',
            targets: ['managed-skill:customer-inquiry-triage'], confirmation: 'not_applicable',
            rollbackOfToolCallId: null },
        } }] };
      }
      if (calls.length === 4) {
        const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'capability_prepare').content);
        assert.equal(receipt.result.state, 'installed'); assert.match(receipt.result.content, /바로 답변 가능/u);
        assert.ok(input.tools.some((tool) => tool.name === 'work_completion'));
        return { text: '', toolCalls: [{ id: 'settle', name: 'work_completion',
          args: { outcome: 'achieved', inputSettlements: [] } }] };
      }
      return { text: [
        '긴급: 결제가 두 번 됐어요 — 즉시 확인',
        '일반: 배송 일정을 알려주세요 — 안내',
        '정보 부족: 제품이 이상해요 — 주문번호 확인 필요',
      ].join('\n'), toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: [
        '다음 고객 문의를 긴급·일반·정보 부족으로 나눠줘.',
        '결제가 두 번 됐어요 / 배송 일정을 알려주세요 / 제품이 이상해요',
      ].join('\n') }),
    }).then((response) => response.json());
    assert.match(result.reply, /긴급:[\s\S]*일반:[\s\S]*정보 부족:/u,
      JSON.stringify({ result, tools: calls.map((call) => call.tools.map((tool) => tool.name)) }));
    assert.equal(calls.length, 5);
    const managed = await server.managedSkillStore;
    assert.deepEqual(await managed.installedNames(), ['customer-inquiry-triage']);
    const run = await server.runLedger.read(result.runId);
    assert.equal(run.events.filter((event) => event.type === 'tool_completed'
      && event.payload?.receipt?.requestedCall?.name === 'capability_prepare').length, 2);
  } finally {
    await server.closeWorkspaceConnections(); await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true });
  }
});
