import test from 'node:test';
import assert from 'node:assert/strict';

import { makeChannelTalkConnection } from '../src/channel-talk-connection.js';

function memorySecretStore() {
  const values = new Map();
  return { async get(key) { return structuredClone(values.get(key) ?? null); },
    async set(key, value) { values.set(key, structuredClone(value)); }, async clear(key) { values.delete(key); }, values };
}

test('Channel Talk key-pair는 공식 managers probe로 channel identity를 확인한 뒤에만 ready다', async () => {
  const calls = []; const secrets = memorySecretStore();
  const connection = makeChannelTalkConnection({ secretStore: secrets,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), headers: structuredClone(init.headers) });
      return new Response(JSON.stringify({ managers: [{ id: 'manager-1', channelId: 'channel-42', name: '고객상담' }] }));
    } });
  const before = await connection.inspect(); assert.equal(before.state, 'needs_connection');
  assert.deepEqual(before.credentialRequest.fields.map((field) => field.id), ['accessKey', 'accessSecret']);
  const connected = await connection.connectCredentials({ accessKey: 'CHANNEL-ACCESS', accessSecret: 'CHANNEL-SECRET' });
  assert.equal(connected.ready, true); assert.equal(connected.account.id, 'channel-42');
  const after = await connection.inspect(); assert.equal(after.state, 'ready');
  assert.equal(after.identity.accountId, 'channel-42'); assert.equal(after.identity.accountLabel, '고객상담 채널');
  assert.deepEqual(after.capabilities, { read: true, reply: false });
  assert.equal(calls[0].url, 'https://api.channel.io/open/v5/managers?limit=1');
  assert.equal(calls[0].headers['x-access-key'], 'CHANNEL-ACCESS');
  assert.equal(calls[0].headers['x-access-secret'], 'CHANNEL-SECRET');
  assert.doesNotMatch(JSON.stringify(after), /CHANNEL-ACCESS|CHANNEL-SECRET/u);
});

test('Channel Talk probe가 401이거나 channelId를 관측하지 못하면 credential을 저장하지 않는다', async () => {
  for (const response of [
    new Response(JSON.stringify({ error: `bad CHANNEL-SECRET` }), { status: 401 }),
    new Response(JSON.stringify({ managers: [] }), { status: 200 }),
  ]) {
    const secrets = memorySecretStore(); const connection = makeChannelTalkConnection({ secretStore: secrets,
      fetchImpl: async () => response.clone() });
    await assert.rejects(connection.connectCredentials({ accessKey: 'CHANNEL-ACCESS', accessSecret: 'CHANNEL-SECRET' }),
      (error) => error.reason === 'credential_verification_failed' && !String(error).includes('CHANNEL-SECRET'));
    assert.equal(secrets.values.size, 0); assert.equal((await connection.inspect()).state, 'needs_connection');
  }
});

test('연결된 Channel Talk Hand는 상담 목록과 exact chat 메시지를 읽기 전용으로 제공한다', async () => {
  const secrets = memorySecretStore(); const calls = [];
  const connection = makeChannelTalkConnection({ secretStore: secrets,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method ?? 'GET' });
      if (String(url).includes('/managers')) return new Response(JSON.stringify({ managers: [{ channelId: 'channel-42', name: '상담' }] }));
      if (String(url).includes('/user-chats/chat-1/messages')) return new Response(JSON.stringify({
        messages: [{ id: 'message-1', channelId: 'channel-42', plainText: '배송이 늦어요' }], next: null,
      }));
      if (String(url).includes('/user-chats')) return new Response(JSON.stringify({
        userChats: [{ id: 'chat-1', channelId: 'channel-42', state: 'opened', name: '고객 문의' }], next: null,
      }));
      throw new Error(`unexpected ${url}`);
    } });
  await connection.connectCredentials({ accessKey: 'CHANNEL-ACCESS', accessSecret: 'CHANNEL-SECRET' });
  const tool = await connection.makeTool({});
  assert.equal(tool.name, 'channel_talk');
  const observe = { kind: 'observe', summary: 'Channel Talk 상담 확인', targets: ['channel-42'],
    reversible: true, backupAvailable: true, recipientNew: false, approvalToken: null };
  assert.equal((await tool.preflight({ action: 'list_chats', chatId: null, state: 'opened', limit: 20, effect: observe })).allowed, true);
  const chats = await tool.execute({ action: 'list_chats', chatId: null, state: 'opened', limit: 20, effect: observe });
  assert.equal(chats.userChats[0].id, 'chat-1');
  const messages = await tool.execute({ action: 'read_messages', chatId: 'chat-1', state: null, limit: 20, effect: observe });
  assert.equal(messages.messages[0].plainText, '배송이 늦어요');
  assert.equal(calls.some((call) => call.url.includes('state=opened') && call.url.includes('limit=20')), true);
  assert.equal(calls.some((call) => call.url.includes('/user-chats/chat-1/messages')), true);
  assert.equal((await tool.preflight({ action: 'list_chats', chatId: null, state: 'opened', limit: 20,
    effect: { ...observe, kind: 'external_change' } })).allowed, false);
});
