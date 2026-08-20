import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeModelConnectionService, modelConnectionProviders,
} from '../src/model-connection-service.js';

test('설정은 실제 adapter가 선 API 3종과 ChatGPT OAuth만 연결 후보로 낸다', () => {
  const providers = modelConnectionProviders();
  assert.deepEqual(providers.providers.map((provider) => provider.id), ['openai', 'anthropic', 'gemini']);
  assert.deepEqual(providers.oauth.map((provider) => provider.id), ['chatgpt_oauth']);
});

test('API 연결·활성·해제는 원키를 공개 상태에 내보내지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-model-service-'));
  const key = 'sk-secret-never-return';
  const service = makeModelConnectionService({
    file: join(room, 'model.json'),
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ id: 'gpt-5.6-terra' }) }),
  });
  const connected = await service.connect({ provider: 'openai', key });
  assert.equal(connected.connected, true);
  assert.doesNotMatch(JSON.stringify(connected), new RegExp(key));
  const list = await service.list();
  assert.equal(list.length, 1);
  assert.doesNotMatch(JSON.stringify(list), new RegExp(key));
  await service.activate(list[0].id);
  assert.equal((await service.disconnect()).removed, true);
  assert.deepEqual(await service.list(), []);
});
