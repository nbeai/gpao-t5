import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  makeStoredModelCredentialCatalog, saveApiKeyConnection, validateApiKeyConnection,
} from '../src/chatgpt-oauth-credential.js';

const KEYS = {
  openai: 'sk-openai-super-secret',
  anthropic: 'sk-ant-super-secret',
  gemini: 'AIza-gemini-super-secret',
  upstage: 'up_upstage-super-secret',
};

function validatingFetch(calls) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init: structuredClone(init) });
    const provider = String(url).includes('anthropic') ? 'anthropic'
      : String(url).includes('googleapis') ? 'gemini'
        : String(url).includes('upstage') ? 'upstage' : 'openai';
    return new Response(JSON.stringify(provider === 'gemini'
      ? { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] }
      : provider === 'upstage'
        ? { model: 'solar-pro4', choices: [{ message: { role: 'assistant', content: 'OK' } }] }
        : { id: provider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-5.6-terra' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
}

test('공식 API 키 네 종류는 검증 뒤 0600 저장되고 공개 목록에는 비밀이 없다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-api-key-connections-'));
  const file = join(room, 'credentials', 'model-connection.json');
  const calls = [];
  try {
    for (const provider of ['openai', 'anthropic', 'gemini', 'upstage']) {
      await saveApiKeyConnection({
        file, provider, apiKey: KEYS[provider], fetchImpl: validatingFetch(calls),
      });
    }
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(join(room, 'credentials'))).mode & 0o777, 0o700);

    const catalog = makeStoredModelCredentialCatalog({ file });
    const listed = await catalog.list();
    assert.deepEqual(listed.map((item) => item.provider), ['openai', 'anthropic', 'gemini', 'upstage']);
    for (const key of Object.values(KEYS)) assert.doesNotMatch(JSON.stringify(listed), new RegExp(key));

    await catalog.activate(listed[1].id);
    assert.equal((await catalog.select()).provider, 'anthropic');
    assert.equal((await catalog.select()).apiKey, KEYS.anthropic);
    await catalog.remove(listed[1].id);
    assert.equal((await catalog.list()).some((item) => item.provider === 'anthropic'), false);

    assert.match(calls[0].init.headers.authorization, /^Bearer /);
    assert.equal(calls[1].init.headers['x-api-key'], KEYS.anthropic);
    assert.equal(calls[2].init.headers['x-goog-api-key'], KEYS.gemini);
    assert.equal(calls[3].init.headers.authorization, `Bearer ${KEYS.upstage}`);
    assert.equal(calls[3].url, 'https://api.upstage.ai/v1/chat/completions');
    assert.equal(calls[3].init.method, 'POST');
    assert.doesNotMatch(calls[3].init.body, new RegExp(KEYS.upstage));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});

test('검증 실패는 공급자 원문에 키가 메아리쳐도 공개 오류와 파일에 비밀을 남기지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-api-key-validation-'));
  const file = join(room, 'credentials', 'model-connection.json');
  const secret = 'sk-ant-reflected-secret';
  try {
    const validation = await validateApiKeyConnection({
      provider: 'anthropic', apiKey: secret, modelId: 'claude-sonnet-5',
      fetchImpl: async () => new Response(JSON.stringify({ error: { message: `bad ${secret}` } }), { status: 401 }),
    });
    assert.deepEqual(validation, { valid: false, provider: 'anthropic', modelId: 'claude-sonnet-5', reason: 'authentication_failed', status: 401 });
    assert.doesNotMatch(JSON.stringify(validation), new RegExp(secret));
    await assert.rejects(saveApiKeyConnection({
      file, provider: 'anthropic', apiKey: secret, modelId: 'claude-sonnet-5',
      fetchImpl: async () => new Response(`bad ${secret}`, { status: 401 }),
    }), (error) => !String(error).includes(secret));
    await assert.rejects(readFile(file, 'utf8'), { code: 'ENOENT' });
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
