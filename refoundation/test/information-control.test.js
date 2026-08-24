import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleServer } from '../src/console-server.js';
import { runAgent } from '../src/agent-loop.js';

async function runSurface({ informationControl, respond }) {
  const room = await mkdtemp(join(tmpdir(), 't5-information-surface-'));
  const stateDir = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace);
  const calls = [];
  const server = makeConsoleServer({
    stateDir, workspace, informationControl,
    webSearchProviders: [{
      id: 'fixture', label: 'Fixture', async available() { return { available: true }; },
      async search() { return [{ title: 'One', url: 'https://example.test/', snippet: 'Observed' }]; },
    }],
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      return respond(input, calls.length);
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: '공개 Web 근거를 찾아줘' }),
    }).then((response) => response.json());
    return { result, calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
}

test('A2 기본 Web 표면은 bounded research와 exact read를 보존하고 partial search schema만 지연한다', async () => {
  const controlled = await runSurface({
    informationControl: 'research-first-v1',
    respond(input) {
      assert.equal(input.tools.some((tool) => tool.name === 'web_research'), true);
      assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
      assert.equal(input.tools.some((tool) => tool.name === 'web_search'), false);
      return { text: '연구 손을 바로 사용할 수 있습니다.', toolCalls: [] };
    },
  });
  const baseline = await runSurface({
    informationControl: 'wide-web-v0', respond: () => ({ text: '기준선', toolCalls: [] }),
  });
  const bytes = (call) => Buffer.byteLength(JSON.stringify(call.tools));
  assert.ok(bytes(controlled.calls[0]) < bytes(baseline.calls[0]));
  assert.equal(baseline.calls[0].tools.some((tool) => tool.name === 'web_search'), true);
});

test('모델이 후보 검색을 원하면 tool_search 한 번으로 web_search를 다시 연다', async () => {
  const observed = await runSurface({
    informationControl: 'research-first-v1',
    respond(input, turn) {
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'find-search', name: 'tool_search', args: { query: 'public web search candidates' },
      }] };
      assert.equal(input.tools.some((tool) => tool.name === 'web_search'), true);
      return { text: '후보 검색 손을 열었습니다.', toolCalls: [] };
    },
  });
  assert.equal(observed.result.reply, '후보 검색 손을 열었습니다.');
  assert.equal(observed.calls.length, 2);
});

test('A2 information surface는 OS path·PID·signal로 선택하지 않는다', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => (
    readFile(new URL('../src/console-server.js', import.meta.url), 'utf8')
  ));
  const selection = source.slice(source.indexOf('const coreToolNames'), source.indexOf('const deferredTools'));
  assert.doesNotMatch(selection, /darwin|win32|WSL|SIGTERM|SIGKILL|process\.platform|\/Users\//u);
});

test('동일한 읽기 Evidence는 최신 원문만 남기고 과거 payload만 projection한다', async () => {
  let turn = 0; const events = [];
  const model = { async respond(input) {
    turn += 1;
    if (turn <= 2) {
      if (turn === 2) assert.match(input.messages.at(-1).content, /SAME-NEEDLE/u);
      return { text: '', toolCalls: [{ id: `read-${turn}`, name: 'web_read', args: { url: 'https://example.test/' } }] };
    }
    const older = JSON.parse(input.messages.find((message) => message.toolCallId === 'read-1').content);
    const latest = JSON.parse(input.messages.find((message) => message.toolCallId === 'read-2').content);
    assert.equal(older.schema, 't5.duplicate-evidence-projection.v1');
    assert.equal(older.duplicateEvidenceOf, 'read-2');
    assert.equal(older.executionFacts.coverage.state, 'complete');
    assert.match(latest.result.content, /SAME-NEEDLE/u);
    return { text: '최신 동일 관측을 확인했습니다.', toolCalls: [] };
  } };
  const result = await runAgent({
    request: '같은 출처를 재확인해', model, onEvent: (event) => events.push(event),
    tools: [{ name: 'web_read', description: 'read', parameters: { type: 'object' }, async execute() {
      return {
        state: 'read', content: `SAME-NEEDLE-${'x'.repeat(12_000)}`,
        coverage: { state: 'complete' }, effectObservation: { changed: false },
      };
    } }],
  });
  assert.equal(result.modelTurns, 3);
  assert.equal(result.receipts.length, 2);
  assert.match(result.receipts[0].result.content, /SAME-NEEDLE/u);
  const projected = events.find((event) => event.type === 'information_projection');
  assert.ok(projected.netSavedBytes > 10_000);
  const canonical = events.filter((event) => event.type === 'tool_end');
  assert.equal(canonical.length, 2);
  assert.match(canonical[0].receipt.result.content, /SAME-NEEDLE/u);
});

test('서로 다른 Evidence와 외부 효과 Receipt는 같은 도구여도 projection하지 않는다', async () => {
  let turn = 0; const events = [];
  const tool = { name: 'message', description: 'send', parameters: { type: 'object' }, async execute() {
    return { state: 'sent', messageId: `message-${turn}`, content: 'same visible text' };
  } };
  const model = { async respond(input) {
    turn += 1;
    if (turn <= 2) return { text: '', toolCalls: [{ id: `send-${turn}`, name: 'message', args: {} }] };
    assert.equal(input.messages.filter((message) => message.role === 'tool').every((message) => (
      !/duplicate-evidence-projection/u.test(message.content)
    )), true);
    return { text: '서로 다른 전송 효과를 보존했습니다.', toolCalls: [] };
  } };
  await runAgent({ request: '두 번 보내', model, tools: [tool], onEvent: (event) => events.push(event) });
  assert.equal(events.some((event) => event.type === 'information_projection'), false);
});
