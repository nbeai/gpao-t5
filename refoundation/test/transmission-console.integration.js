import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { runAgent } from '../src/agent-loop.js';
import { makeConsoleServer } from '../src/console-server.js';
import { RunLedger } from '../src/run-ledger.js';

const receipt = { schema: 't5.transmission-receipt.v1', provider: 'fixture', model: 'fixture-model',
  endpointOrigin: 'https://provider.example', transportState: 'dispatch_attempted', requestBytes: 321,
  wireSha256: 'a'.repeat(64), categories: { user_message: { items: 1, payloadBytes: 40 } },
  credentialFieldsInBody: 0, credentialHeadersExcluded: true,
  originalLocalSourceScope: 'unknown', wholeSourceNotSent: 'unknown' };

test('AgentLoop는 dispatch callback과 response transmission을 서로 다른 실제 사건으로 보존한다', async () => {
  const events = [];
  const result = await runAgent({ request: '전송 확인', model: { async respond({ onTransmissionReceipt }) {
    await onTransmissionReceipt(receipt); return { text: '완료', toolCalls: [],
      transmissionReceipt: { ...receipt, transportState: 'response_received' } };
  } }, onEvent: (event) => events.push(event) });
  assert.equal(events.find((event) => event.type === 'model_transmission').transmissionReceipt.transportState, 'dispatch_attempted');
  assert.equal(events.find((event) => event.type === 'model_end').response.transmissionReceipt.transportState, 'response_received');
  assert.equal(result.modelCalls[0].transmissionReceipt.requestBytes, 321);
});

test('transport가 끊겨도 dispatch_attempted는 남고 response_received로 승격하지 않는다', async () => {
  const events = [];
  await assert.rejects(() => runAgent({ request: '전송 실패', model: { async respond({ onTransmissionReceipt }) {
    await onTransmissionReceipt(receipt); throw new Error('transport disconnected');
  } }, onEvent: (event) => events.push(event) }), /transport disconnected/u);
  assert.equal(events.filter((event) => event.type === 'model_transmission').length, 1);
  assert.equal(events.some((event) => event.type === 'model_end'), false);
});

test('설정의 최근 모델 전송은 content·wire hash 없이 실제 범주와 unknown 범위를 보여준다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-transmission-console-')); const state = join(room, 'state'); const workspace = join(room, 'workspace');
  await mkdir(workspace); const runs = new RunLedger(join(state, 'runs'));
  const run = await runs.start({ sessionId: 'fixture-session', request: 'PRIVATE-TRANSMISSION-CONTENT' });
  await run.append({ type: 'model_transmission_attempted', payload: { turn: 1, transmissionReceipt: receipt } });
  await run.append({ type: 'model_completed', payload: { turn: 1,
    response: { transmissionReceipt: { ...receipt, transportState: 'response_received' } } } }); await run.finish('completed');
  const server = makeConsoleServer({ stateDir: state, workspace,
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/transmission/recent`).then((value) => value.json());
    assert.equal(response.items[0].transportState, 'response_received');
    assert.equal(response.items[0].categories[0].label, '사용자 요청');
    assert.equal(response.items[0].wholeSourceNotSent, 'unknown');
    assert.doesNotMatch(JSON.stringify(response), /PRIVATE-TRANSMISSION-CONTENT|aaaaaaaaaaaaaaaa/u);
    const ui = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
    assert.match(ui, /최근 모델 전송/u); assert.match(ui, /원본 전체 중 무엇이 전송되지 않았는지는/u);
  } finally {
    await server.closeAutomations(); await server.closeMessengers(); await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
});
