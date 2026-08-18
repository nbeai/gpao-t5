import test from 'node:test';
import assert from 'node:assert/strict';

import { makeStoredOpenAIWebSearchProvider } from '../src/openai-web-search-provider.js';

test('OpenAI search provider는 저장된 API 연결로 hosted search sources만 후보화한다', async () => {
  const requests = [];
  const catalog = {
    async list() {
      return [
        { id: 'chatgpt_oauth:gpt-5.5', kind: 'chatgpt_oauth', active: true },
        { id: 'openai:gpt-5.1', kind: 'api_key', provider: 'openai', modelId: 'gpt-5.1', active: false },
      ];
    },
    async select(id) {
      assert.equal(id, 'openai:gpt-5.1');
      return { kind: 'api_key', provider: 'openai', apiKey: 'sk-secret', modelId: 'gpt-5.1', baseUrl: 'https://api.openai.com/v1' };
    },
  };
  const provider = makeStoredOpenAIWebSearchProvider({
    credentialCatalog: catalog,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({
        output: [
          { type: 'web_search_call', results: [
            { type: 'url', url: 'https://example.com/one', title: '첫 소식', snippet: '첫 설명' },
            { type: 'url', url: 'https://example.org/two', title: '둘째 소식', snippet: '둘째 설명' },
          ], action: { type: 'search', query: '가게 소식', sources: [
            { type: 'url', url: 'https://example.com/one' },
            { type: 'url', url: 'https://example.org/two' },
            { type: 'url', url: 'https://consulted.example.net/not-ranked' },
          ] } },
          { type: 'message', content: [{ type: 'output_text', text: '찾음', annotations: [
            { type: 'url_citation', url: 'https://example.com/one', title: '첫 소식' },
          ] }] },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.deepEqual(await provider.available(), { available: true });
  const rows = await provider.search('가게 소식', { limit: 5, domains: ['naver.com'] });
  assert.equal(requests[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(requests[0].init.headers.authorization, 'Bearer sk-secret');
  assert.equal(requests[0].body.model, 'gpt-5.1');
  assert.deepEqual(requests[0].body.tools, [{ type: 'web_search', filters: { allowed_domains: ['naver.com'] } }]);
  assert.deepEqual(requests[0].body.include, ['web_search_call.results', 'web_search_call.action.sources']);
  assert.deepEqual(rows, [
    { title: '첫 소식', url: 'https://example.com/one', snippet: '첫 설명', sourceType: 'url' },
    { title: '둘째 소식', url: 'https://example.org/two', snippet: '둘째 설명', sourceType: 'url' },
  ]);
});

test('API 연결이 없으면 provider는 네트워크를 시도하지 않고 이유를 밝힌다', async () => {
  let fetched = false;
  const provider = makeStoredOpenAIWebSearchProvider({
    credentialCatalog: { async list() { return []; } },
    fetchImpl: async () => { fetched = true; },
  });
  assert.deepEqual(await provider.available(), { available: false, reason: 'openai_api_connection_missing' });
  assert.equal(fetched, false);
});

test('검색 API 오류에는 API key가 노출되지 않는다', async () => {
  const provider = makeStoredOpenAIWebSearchProvider({
    credentialCatalog: {
      async list() { return [{ id: 'openai:test', kind: 'api_key', provider: 'openai' }]; },
      async select() { return { kind: 'api_key', provider: 'openai', apiKey: 'sk-secret', modelId: 'gpt-5.1' }; },
    },
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: 'bad sk-secret' } }), { status: 401 }),
  });
  await assert.rejects(() => provider.search('확인', { limit: 5 }), (error) => {
    assert.doesNotMatch(error.message, /sk-secret/);
    assert.match(error.message, /\[REDACTED\]/);
    return true;
  });
});
