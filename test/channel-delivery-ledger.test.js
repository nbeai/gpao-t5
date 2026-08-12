// P5-1 · 채널 자동 답장의 전달 사실은 **원장에 남아야 한다.**
//
// 실측(56a6ae67 · 텔레그램 26턴, 2026-07-26): transcript 의 `channelDelivery` 가 13턴 전부 null 이고
// 전달 원장(`deliveries.json`)에 그 세션 건은 **0건**이었다. 코드 주석은 "보냈으면 보냈다고,
// 못 보냈으면 못 보냈다고 원장에 남긴다(보낸 척 금지)"라고 말하는데 **남기지 않았다** —
// `channelDelivery` 를 쓰는 대상이 `ok({...result})` 로 만들어진 복사본이고 그 뒤에 저장이 없었다.
//
// 그래서 "정말 갔는가"를 사후에 확인할 방법이 없었다. 원장이 없으면 "보낸 척 금지"는
// 검사할 수 없는 약속이다. 이 파일은 그 약속을 검사 가능하게 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';
import { DeliveryStore } from '../src/surface/delivery-store.js';
import { demoTools, demoChannels, demoConnectors } from '../src/surface/demo-context.js';

const 말하는모델 = { async respond() { return '네, 확인했어요.'; } };

async function 방에서한마디(발신) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-전달-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u1', label: '오너' });
  const deliveryStore = new DeliveryStore(dir);
  const server = makeServer({
    store, allowlistStore, deliveryStore,
    channels: demoChannels(), connectors: demoConnectors(),
    model: 말하는모델,
    tools: demoTools({ senders: { 'telegram.send': 발신 } }),
  });
  const out = await server.handleChannelMessage({
    channel: 'telegram', chatId: '방-1', userId: 'u1',
    text: '안녕', isDirectMessage: true, isMention: true,
  });
  return { 전달들: (await deliveryStore.load()).deliveries, out };
}

test('방에 답장하면 전달 사실이 원장에 남는다(정말 갔는지 나중에 확인할 수 있어야 한다)', async () => {
  const { 전달들, out } = await 방에서한마디({
    async handler({ text, target }) { return { result: { sent: true, target }, userSafeSummary: '보냈어요.' }; },
  });
  assert.equal(out?.channelDelivery?.sent, true, '보냈다고 답에 표시되지 않았다');
  assert.equal(전달들.length, 1, `전달 원장에 안 남았다 — 이게 비어 있으면 "보낸 척"을 못 잡는다: ${JSON.stringify(전달들)}`);
  const [d] = 전달들;
  assert.equal(d.state, 'delivered');
  assert.equal(d.target, '방-1', '어디로 보냈는지가 없으면 원장이 아니다');
  assert.equal(d.tool, 'telegram.send');
  assert.match(d.artifact?.text ?? '', /확인했어요/, '무엇을 보냈는지가 남아야 재전달·대조가 된다');
});

test('못 보냈으면 못 보냈다고 원장에 남는다(보낸 척 금지)', async () => {
  const { 전달들, out } = await 방에서한마디({
    async handler() { return { blocked: true, sendState: 'blocked', userSafeSummary: '방에서 나갔어요.' }; },
  });
  assert.equal(out?.channelDelivery?.sent, false);
  assert.equal(전달들.length, 1, '실패도 남아야 한다 — 실패가 안 남으면 "안 보냈다"와 구분이 안 된다');
  assert.equal(전달들[0].state, 'failed');
  assert.equal(전달들[0].retriable, true, '산출물이 남았으면 재전달은 가능해야 한다');
  assert.match(전달들[0].lastError?.userSafeSummary ?? '', /나갔어요/);
});

test('보낼 손이 아예 없어도 그 사실이 남는다(조용히 사라지지 않는다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-전달없음-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u1' });
  const deliveryStore = new DeliveryStore(dir);
  // 발신 손을 아예 안 배선한다.
  const tools = demoTools({});
  delete tools.tools['telegram.send'];
  const server = makeServer({
    store, allowlistStore, deliveryStore, tools,
    channels: demoChannels(), connectors: demoConnectors(), model: 말하는모델,
  });
  await server.handleChannelMessage({
    channel: 'telegram', chatId: '방-2', userId: 'u1', text: '안녕', isDirectMessage: true, isMention: true,
  });
  const { deliveries } = await deliveryStore.load();
  assert.equal(deliveries.length, 1, '손이 없어서 못 보낸 것도 사실이다 — 안 남기면 아무 일 없던 게 된다');
  assert.equal(deliveries[0].state, 'failed');
});
