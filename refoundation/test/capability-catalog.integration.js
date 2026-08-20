import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';

async function post(base, path, input = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

test('등록되지 않은 외부 능력은 connection 진실 뒤 trusted candidate를 찾아 blocker만 답하고 실행하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-capability-catalog-console-'));
  const capabilitiesRoot = join(room, 'capabilities');
  const asanaRoot = join(capabilitiesRoot, 'asana'); await mkdir(asanaRoot, { recursive: true });
  await writeFile(join(asanaRoot, 'capability.json'), JSON.stringify({
    schema: 't5.capability-manifest.v1', id: 'asana', label: 'Asana', category: 'project_management',
    description: 'Asana 프로젝트와 오늘 할 일을 읽는 공식 MCP 후보',
    terms: ['아사나', 'asana', 'app.asana.com', '프로젝트', '오늘 할 일'],
    capabilities: { search: true, read: true },
    route: {
      kind: 'remote_mcp', endpoint: 'https://mcp.asana.com/v2/mcp',
      sourceUrl: 'https://developers.asana.com/docs/integrating-with-asanas-mcp-server',
      preparation: 'product_registration_required', canStart: false,
      userSafeSummary: 'T5 제품용 MCP 앱 등록이 먼저 필요해요.',
    },
  }), 'utf8');
  let turn = 0;
  const server = makeConsoleServer({
    stateDir: join(room, 'state'), workspace: room, capabilitiesRoot,
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
    modelFactory: () => ({ async respond(input) {
      turn += 1;
      assert.ok(input.tools.some((tool) => tool.name === 'capability_catalog'));
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'connections', name: 'connection', args: { action: 'list', id: null, actionId: null },
      }] };
      if (turn === 2) return { text: '', toolCalls: [{
        id: 'candidate', name: 'capability_catalog',
        args: { action: 'search', query: 'Asana 오늘 할 일', id: null },
      }] };
      if (turn === 3) return { text: '', toolCalls: [{
        id: 'inspect', name: 'capability_catalog',
        args: { action: 'inspect', query: null, id: 'asana' },
      }] };
      const receipt = JSON.parse(input.messages.at(-1).content);
      assert.equal(receipt.result.candidate.canStart, false);
      assert.equal(receipt.result.candidate.preparation, 'product_registration_required');
      return { text: 'Asana 공식 후보는 찾았지만 T5 제품 준비가 먼저라 지금 연결을 시작하지 않았어요.', toolCalls: [] };
    } }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = (await post(base, '/sessions')).body;
    const result = await post(base, '/turn', {
      sessionId: session.id, text: 'Asana를 연결해서 오늘 할 일을 읽어줘.',
    });
    assert.equal(result.status, 200);
    assert.match(result.body.reply, /공식 후보.*제품 준비/u);
    assert.equal(result.body.connectionHandoff, undefined);
    const runs = await server.runLedger.list({ sessionId: session.id });
    const detail = await server.runLedger.read(runs[0].runId);
    const receipts = detail.events.flatMap((event) => event.type === 'tool_completed'
      ? [event.payload.receipt] : []);
    assert.deepEqual(receipts.map((receipt) => receipt.actualCall?.name), [
      'connection', 'capability_catalog', 'capability_catalog',
    ]);
  } finally {
    server.closeWakeStreams(); await server.closeMessengers(); await server.closeWorkspaceConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
