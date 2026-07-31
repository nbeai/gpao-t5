// P2-7 0순위 · 같은 세션의 동시 턴 — **되돌릴 수 없는 유실**을 막는다.
//
// 왜 지금인가: 채널(P5)이 열리면서 같은 세션을 만지는 입구가 셋이 됐다 — 웹 UI, 채널 수신기,
// 자동화 tick. 턴 하나의 변경 구간은 **모델 호출 전체를 가로지른다**(로드 → 30초+ → 저장).
// 그래서 "저장만 직렬화"로는 안 닫힌다. 뒤 턴이 앞 턴의 저장 **전에** 세션을 읽으면,
// 앞 턴의 transcript·원장·workingState 를 통째로 덮는다.
//
// 실측(수정 전): 웹 큐는 있었지만 **채널 수신 경로만 큐 밖**이었다. 그래서 채널로 두 마디가
// 연달아 오면 앞 마디가 사라졌고, 웹과 채널이 겹치면 큐 자체가 무의미해졌다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';
import { defineChannel } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';

/** 모델이 생각하는 동안 다른 턴이 끼어들 틈을 만든다 — 실제 모델은 30초씩 걸린다. */
const slowModel = (ms = 40) => ({
  async respond() {
    await new Promise((r) => setTimeout(r, ms));
    return '네, 봤어요.';
  },
});

const telegram = () => {
  const connector = defineConnector({ id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true });
  return {
    connectors: [connector],
    channels: [defineChannel({ id: 'telegram', connector, inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send' })],
  };
};

async function withServer(fn, deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-conc-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u-allowed', label: '오너' });
  const server = makeServer({ store, allowlistStore, model: slowModel(), ...telegram(), ...deps });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json());
  const inbound = (text) => post('/channel/inbound', {
    sessionId: session.id, channel: 'telegram', userId: 'u-allowed', isDirectMessage: true, text,
  });
  const said = async () => (await store.load(session.id)).transcript
    .filter((e) => e.role === 'user').map((e) => e.text);
  try { return await fn({ inbound, post, said, session, store, dir }); }
  finally { await new Promise((r) => server.close(r)); }
}

test('채널로 연달아 온 두 마디가 둘 다 남는다(앞 마디가 덮이지 않는다)', async () => {
  await withServer(async ({ inbound, said }) => {
    // 사용자가 생각을 두 번에 나눠 보낸다 — 메신저에서 아주 흔한 일이다.
    await Promise.all([inbound('팔식당 좀 봐줘'), inbound('아 리뷰 위주로')]);
    assert.deepEqual((await said()).sort(), ['아 리뷰 위주로', '팔식당 좀 봐줘'],
      '뒤 턴이 앞 턴의 저장 전에 세션을 읽으면 앞 마디가 통째로 사라진다');
  });
});

test('웹 턴과 채널 턴이 겹쳐도 서로를 덮지 않는다(큐가 한쪽만 감싸면 무의미하다)', async () => {
  await withServer(async ({ inbound, post, said, session }) => {
    await Promise.all([
      post('/turn', { sessionId: session.id, text: '웹에서 물어본 것' }),
      inbound('텔레그램에서 물어본 것'),
    ]);
    assert.deepEqual((await said()).sort(), ['웹에서 물어본 것', '텔레그램에서 물어본 것'].sort(),
      '입구가 다르다고 큐를 안 거치면, 큐가 있는 쪽도 함께 무너진다');
  });
});

test('앞 턴이 도는 중에 온 뒤 턴은 거절되지 않고 기다렸다 처리된다(큐지 거절이 아니다)', async () => {
  await withServer(async ({ inbound }) => {
    const [a, b] = await Promise.all([inbound('첫 마디'), inbound('둘째 마디')]);
    for (const r of [a, b]) {
      assert.ok(['reply', 'clarify', 'approval'].includes(r.kind),
        `대기는 거절이 아니다 — 받은 응답: ${JSON.stringify(r).slice(0, 120)}`);
    }
  });
});

test('저장이 원자적이다 — 쓰는 도중에 읽어도 깨진 JSON 이 보이지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-atomic-'));
  const store = new SessionStore(dir);
  const session = await store.create('원자성');
  const path = join(dir, `${session.id}.json`);
  // 큰 세션 = 한 번의 write 로 안 끝나는 크기. 비원자적 쓰기라면 이 틈에 잘린 파일이 보인다.
  // 검사력은 **파일 크기**(쓰기 창이 길어야 그 틈에 읽힌다)에서 나오지 반복 횟수에서 나오지 않는다.
  // 그래서 파일은 키우고 저장 횟수는 줄였다(§17 시간 기준선 5s — 예전엔 이 테스트 하나가 5.2s 였다).
  // 반대 검증으로 확인함: 비원자적 쓰기로 되돌리면 이 설정에서도 깨진 JSON 이 잡힌다.
  session.transcript = Array.from({ length: 900 }, (_, i) => ({ role: 'user', text: `${i}`.padEnd(4000, '가') }));

  let broken = 0;
  let saving = true;
  // 읽기는 **저장이 끝날 때까지** 돈다 — 고정 횟수보다 빠르고, 창을 놓치지 않는다.
  const readLoop = (async () => {
    while (saving) {
      try { JSON.parse(await readFile(path, 'utf8')); }
      catch { broken += 1; }
      await new Promise((r) => setImmediate(r));
    }
  })();
  const saveLoop = (async () => {
    for (let i = 0; i < 6; i += 1) { session.title = `저장 ${i}`; await store.save(session); }
    saving = false;
  })();
  await Promise.all([readLoop, saveLoop]);
  assert.equal(broken, 0, '쓰는 도중 크래시하면 세션 파일이 통째로 못 읽는 상태로 남는다');
});

test('임시 파일은 세션 목록에 섞이지 않는다(원자적 쓰기의 부산물이 대화로 보이면 안 된다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-atomic2-'));
  const store = new SessionStore(dir);
  const s = await store.create('보이는 대화');
  // 쓰다 만 임시 파일이 남은 상황을 만든다(크래시 잔재).
  await writeFile(join(dir, `${s.id}.json.tmp-abc`), '{"id":"부서진', 'utf8');
  const list = await store.list();
  assert.equal(list.length, 1, '잔재가 대화로 세어지면 목록에 유령이 생긴다');
  assert.equal((await store.loadAll()).length, 1);
});

test('같은 방의 첫 두 마디가 대화를 둘로 쪼개지 않는다(방↔대화 연결도 경합한다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-bind-'));
  const store = new SessionStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'u-allowed', label: '오너' });
  const server = makeServer({ store, allowlistStore, model: slowModel(), ...telegram() });
  const msg = (text) => ({ channel: 'telegram', chatId: 'room-1', userId: 'u-allowed', isDirectMessage: true, text });
  // 처음 말을 거는 방에 두 마디가 거의 동시에 도착한다.
  await Promise.all([server.handleChannelMessage(msg('안녕')), server.handleChannelMessage(msg('바쁘니?'))]);
  const sessions = await store.list();
  assert.equal(sessions.length, 1, '방 하나가 대화 둘로 쪼개지면 앞 마디의 맥락이 미아가 된다');
});
