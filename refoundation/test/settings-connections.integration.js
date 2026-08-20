import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';
import { makeConsoleServer } from '../src/console-server.js';
import { makeModelConnectionService } from '../src/model-connection-service.js';

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

const post = (base, path, body = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('설정 API는 모델 4종·Telegram 연결을 검증·저장·활성하고 비밀값을 응답에 내지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-settings-connections-'));
  const connectionFile = join(room, 'model-connections.json');
  const catalog = makeStoredModelCredentialCatalog({ file: connectionFile });
  const modelConnections = makeModelConnectionService({
    file: connectionFile,
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      json: async () => String(url).includes('generativelanguage')
        ? ({ name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] })
        : ({ id: String(url).split('/').at(-1) }),
    }),
  });
  let status = { connected: false, provider: null, modelId: null, activeId: null, connections: [] };
  const secret = 'secret-model-key-never-return';
  const provider = {
    id: 'telegram', inboundMode: 'long_polling',
    async validate() { return { id: '77', username: 't5_test_bot' }; },
    async poll({ signal }) {
      await new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));
      return [];
    },
    async sendReply() { return { sent: true }; },
  };
  const server = makeConsoleServer({
    stateDir: room, workspace: room,
    modelFactory: async () => ({ respond: async () => ({ text: '네', toolCalls: [] }) }),
    modelStatus: async () => status,
    modelConnections: {
      ...modelConnections,
      async connect(input) {
        const result = await modelConnections.connect(input);
        const connections = await catalog.list();
        const active = connections.find((item) => item.active);
        status = {
          connected: true, provider: active.provider, modelId: active.modelId,
          activeId: active.id, connections,
        };
        return result;
      },
    },
    messengerProviderFactory: () => provider,
  });
  const base = await listen(server);
  try {
    const modelProviders = await fetch(`${base}/model/providers`).then((response) => response.json());
    assert.deepEqual(
      modelProviders.providers.map((item) => item.id),
      ['openai', 'anthropic', 'gemini', 'upstage'],
    );
    const connected = await post(base, '/model/connect', { provider: 'openai', key: secret });
    assert.equal(connected.status, 200);
    assert.doesNotMatch(await connected.text(), new RegExp(secret));
    const listed = await fetch(`${base}/model/connections`).then((response) => response.text());
    assert.doesNotMatch(listed, new RegExp(secret));
    assert.match(listed, /OpenAI/u);
    assert.equal((await stat(connectionFile)).mode & 0o777, 0o600);

    const channelProviders = await fetch(`${base}/channels/providers`).then((response) => response.json());
    assert.deepEqual(channelProviders.providers.map((item) => item.id), ['telegram']);
    const token = 'telegram-token-never-return';
    const telegram = await post(base, '/channels/connect', { provider: 'telegram', token });
    assert.equal(telegram.status, 200);
    assert.doesNotMatch(await telegram.text(), new RegExp(token));
    const channels = await fetch(`${base}/channels`).then((response) => response.text());
    assert.match(channels, /t5_test_bot/u);
    assert.doesNotMatch(channels, new RegExp(token));
    assert.equal((await stat(server.messengerCredentialStore.file)).mode & 0o777, 0o600);
    const disconnected = await post(base, '/channels/disconnect', { provider: 'telegram' });
    assert.equal(disconnected.status, 200);
  } finally {
    modelConnections.close();
    await server.closeMessengers();
    await new Promise((resolve) => server.close(resolve));
  }
});
