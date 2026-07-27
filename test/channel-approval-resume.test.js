// P5 · **방에서 시작한 일의 결과는 방으로 돌아간다** (오너 결정 A).
//
// 라이브 실측(56a6ae67 · 2026-07-27 16:57~16:58):
//   방  → "메모3.md 만들어서 '세번째'라고 적어줘"
//   방  ← "로컬 파일 — … T5 화면에서 확인해 주시면 이어서 할게요."
//   화면 → 승인
//   원장 ← local.file write 성공 · 화면 ← "만들었어."
//   방  ← **아무것도 안 옴**
// 승인 재개는 웹 경로로 들어오고 채널 발송은 수신 경로에만 있었다. 방에서 한 약속을
// 방에서 안 지킨 것이다. 세션 origin 에 보낼 자리가 살아 있는데도 안 보냈다.
//
// 반대쪽도 함께 막는다: 채널에 묶인 세션이라고 **화면에서 하는 대화까지** 방으로 밀면
// 폰이 계속 울린다. 요청이 온 자리로만 돌아간다.
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
import { makeLocalFileTool } from '../src/runtime/local-file.js';

/** 승인이 필요한 일을 고르고, 승인 뒤에는 했다고 말한다. */
const 파일쓰기모델 = {
  async respond(_tc, opts = {}) {
    if (opts.tools?.length) {
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: '메모3.md', text: '세번째' } }] };
    }
    return '만들었어. 메모3.md 에 세번째 라고 적혀 있어.';
  },
};

async function 판() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-재개-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u1' });
  const deliveryStore = new DeliveryStore(dir);
  const 보낸것 = [];
  const tools = demoTools({
    senders: { 'telegram.send': { async handler({ text, target }) { 보낸것.push({ text, target }); return { result: { sent: true, target } }; } } },
    localFile: makeLocalFileTool({ roots: [dir], dataDir: dir }),
  });
  const server = makeServer({
    store, allowlistStore, deliveryStore, tools,
    channels: demoChannels(), connectors: demoConnectors(), model: 파일쓰기모델,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = async (body) => (await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })).json();
  return { server, store, deliveryStore, 보낸것, turn };
}

test('방에서 시킨 일을 화면에서 승인하면, 결과가 방으로 돌아간다', async () => {
  const { server, store, deliveryStore, 보낸것, turn } = await 판();
  try {
    const 방에서 = await server.handleChannelMessage({
      channel: 'telegram', chatId: '방-1', userId: 'u1',
      text: "메모3.md 만들어서 '세번째'라고 적어줘", isDirectMessage: true, isMention: true,
    });
    assert.equal(방에서.kind, 'approval', `승인에서 안 멈췄다: ${방에서.kind}`);
    const 승인알림 = 보낸것.length;
    assert.ok(승인알림 > 0, '승인 알림조차 방으로 안 갔다');

    // 화면에서 승인한다(웹 경로) — 방이 아니라 화면이다.
    const r = await turn({ sessionId: 방에서.sessionId, approve: 방에서.pendingId });
    assert.equal(r.kind, 'reply');

    assert.ok(보낸것.length > 승인알림,
      '화면에서 승인했더니 방은 조용했다 — 방에서 한 약속을 방에서 안 지킨 것이다');
    const 마지막 = 보낸것.at(-1);
    assert.equal(마지막.target, '방-1', '엉뚱한 자리로 보냈다');
    assert.match(마지막.text, /만들었어/, '결과가 아니라 다른 말이 갔다');

    // 보낸 사실은 원장에 남아야 사후에 확인할 수 있다.
    const { deliveries } = await deliveryStore.load();
    assert.ok(deliveries.some((d) => d.target === '방-1' && d.state === 'delivered' && /만들었어/.test(d.artifact?.text ?? '')),
      `결과 전달이 원장에 안 남았다: ${JSON.stringify(deliveries.map((d) => d.state))}`);
    await store.load(방에서.sessionId);
  } finally { await new Promise((r) => server.close(r)); }
});

test('화면에서 시작한 일은 방으로 밀지 않는다(채널에 묶인 세션이라도)', async () => {
  const { server, 보낸것, turn } = await 판();
  try {
    // 먼저 방을 만들어 세션을 채널에 묶는다.
    const 방에서 = await server.handleChannelMessage({
      channel: 'telegram', chatId: '방-2', userId: 'u1', text: '안녕', isDirectMessage: true, isMention: true,
    });
    const 묶인세션 = 방에서.sessionId;
    const 방으로간것 = 보낸것.length;

    // 같은 세션을 **화면에서** 이어 쓴다 → 승인 카드 → 화면에서 승인.
    const a = await turn({ sessionId: 묶인세션, text: "메모3.md 만들어서 '세번째'라고 적어줘" });
    assert.equal(a.kind, 'approval');
    await turn({ sessionId: 묶인세션, approve: a.pendingId });

    assert.equal(보낸것.length, 방으로간것,
      '화면에서 하는 대화까지 방으로 밀면 폰이 계속 울린다 — 요청이 온 자리로만 돌아간다');
  } finally { await new Promise((r) => server.close(r)); }
});
