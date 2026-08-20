import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeConsoleModelAccess } from '../src/console-model-factory.js';
import { makeStoredModelCredentialCatalog } from '../src/chatgpt-oauth-credential.js';

test('저장된 OpenAI·Claude·Gemini·Upstage 연결은 각 공식 wire adapter로 선택된다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-provider-routing-'));
  const file = join(room, 'model-connection.json');
  const keys = {
    openai: 'openai-secret', anthropic: 'anthropic-secret', gemini: 'gemini-secret',
    upstage: 'upstage-secret',
  };
  const connections = [
    { id: 'o', kind: 'api_key', provider: 'openai', modelId: 'gpt-5.6-terra', key: keys.openai, baseUrl: 'https://evil.invalid' },
    { id: 'a', kind: 'api_key', provider: 'anthropic', modelId: 'claude-sonnet-5', key: keys.anthropic, baseUrl: 'https://evil.invalid' },
    { id: 'g', kind: 'api_key', provider: 'gemini', modelId: 'gemini-3.6-flash', key: keys.gemini, baseUrl: 'https://evil.invalid' },
    { id: 'u', kind: 'api_key', provider: 'upstage', modelId: 'solar-pro4', key: keys.upstage, baseUrl: 'https://evil.invalid' },
  ];
  await writeFile(file, JSON.stringify({ version: 2, activeId: 'o', roleBindings: {}, connections }), { mode: 0o600 });
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: String(init.body) });
    if (String(url).includes('anthropic')) return new Response(JSON.stringify({
      id: 'a1', model: 'claude-sonnet-5', content: [{ type: 'text', text: 'claude' }], usage: {},
    }), { status: 200 });
    if (String(url).includes('googleapis')) return new Response(JSON.stringify({
      responseId: 'g1', modelVersion: 'gemini-3.6-flash',
      candidates: [{ content: { role: 'model', parts: [{ text: 'gemini' }] } }], usageMetadata: {},
    }), { status: 200 });
    if (String(url).includes('upstage')) return new Response(JSON.stringify({
      id: 'u1', model: 'solar-pro4', choices: [{ message: { role: 'assistant', content: 'upstage' } }],
      usage: {},
    }), { status: 200 });
    return new Response(JSON.stringify({
      id: 'o1', model: 'gpt-5.6-terra',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'openai' }] }], usage: {},
    }), { status: 200 });
  };
  try {
    const access = makeConsoleModelAccess({ connectionFile: file, stateDir: join(room, 'state'), fetchImpl });
    const catalog = makeStoredModelCredentialCatalog({ file });
    const answers = [];
    for (const id of ['o', 'a', 'g', 'u']) {
      await catalog.activate(id);
      const model = await access.model({ sessionId: id, workspace: room, computer: {} });
      answers.push((await model.respond({ messages: [{ role: 'user', content: '안녕' }] })).text);
    }
    assert.deepEqual(answers, ['openai', 'claude', 'gemini', 'upstage']);
    assert.match(calls[0].headers.authorization, /^Bearer /);
    assert.equal(calls[1].headers['x-api-key'], keys.anthropic);
    assert.equal(calls[2].headers['x-goog-api-key'], keys.gemini);
    assert.equal(calls[3].headers.authorization, `Bearer ${keys.upstage}`);
    assert.equal(calls[3].url, 'https://api.upstage.ai/v1/chat/completions');
    for (const call of calls) for (const key of Object.values(keys)) assert.doesNotMatch(call.body, new RegExp(key));
  } finally {
    await rm(room, { recursive: true, force: true });
  }
});
