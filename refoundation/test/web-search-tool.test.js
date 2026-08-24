import test from 'node:test';
import assert from 'node:assert/strict';

import { makeWebSearchTool } from '../src/web-search-tool.js';

test('web_search는 후보만 돌려주고 어느 주소도 대신 읽지 않는다', async () => {
  const calls = [];
  const provider = {
    id: 'fixture', label: 'Fixture Search',
    async available() { return { available: true }; },
    async search(query, options) {
      calls.push({ query, options });
      return [
        { title: '첫 자료', url: 'https://example.com/a?utm_source=test', snippet: '첫 설명' },
        { title: '첫 자료 중복', url: 'https://example.com/a?utm_source=other', snippet: '중복' },
        { title: '둘째 자료', url: 'https://other.example.com/b', snippet: '둘째 설명', imageUrl: 'https://img.example.org/b.jpg' },
      ];
    },
  };
  const tool = makeWebSearchTool({ providers: [provider] });
  const result = await tool.execute({ query: '사장님 검색', provider: null, limit: 5, domains: ['example.com'] });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].query, '사장님 검색');
  assert.deepEqual(calls[0].options.domains, ['example.com']);
  assert.equal(result.state, 'candidates');
  assert.equal(result.readState, 'candidates_only');
  assert.equal(result.provider.id, 'fixture');
  assert.equal(result.candidates.length, 2);
  assert.equal(result.candidates[0].rank, 1);
  assert.equal(result.candidates[0].url, 'https://example.com/a');
  assert.equal(result.candidates[0].instructionAuthority, 'none');
  assert.equal(result.candidates[1].previewImageUrl, 'https://img.example.org/b.jpg');
  assert.equal(result.observedPageContent, false);
});

test('web_search 실패는 시도한 provider와 아직 가능한 대안을 사실로 남긴다', async () => {
  const broken = {
    id: 'broken', label: 'Broken',
    async available() { return { available: true }; },
    async search() { throw new Error('provider timeout'); },
  };
  const ready = {
    id: 'ready', label: 'Ready',
    async available() { return { available: true }; },
    async search() { throw new Error('should not auto-run'); },
  };
  const tool = makeWebSearchTool({ providers: [broken, ready] });
  const result = await tool.execute({ query: '다른 길', provider: 'broken', limit: 5, domains: null });

  assert.equal(result.state, 'failed');
  assert.equal(result.attemptedProvider.id, 'broken');
  assert.match(result.error, /provider timeout/);
  assert.deepEqual(result.availableAlternatives.map((item) => item.id), ['ready']);
});

test('첫 검색 공급자가 막히면 같은 질의를 다음 실제 공급자로 한 번 전환한다', async () => {
  const first = { id: 'first', label: 'First', async available() { return { available: true }; }, async search() { throw new Error('challenge'); } };
  const second = { id: 'second', label: 'Second', async available() { return { available: true }; }, async search() { return [{ title: 'B', url: 'https://b.example/', snippet: 'ok' }]; } };
  const result = await makeWebSearchTool({ providers: [first, second] }).execute({
    query: '시장', provider: null, limit: 3, domains: null,
  });
  assert.equal(result.state, 'candidates'); assert.equal(result.provider.id, 'second');
  assert.equal(result.attempts[0].provider.id, 'first');
});

test('web_search는 사용할 수 없는 provider를 실행한 척하지 않는다', async () => {
  let ran = false;
  const provider = {
    id: 'needs-key', label: 'Needs Key',
    async available() { return { available: false, reason: 'credential_missing' }; },
    async search() { ran = true; return []; },
  };
  const tool = makeWebSearchTool({ providers: [provider] });
  const result = await tool.execute({ query: '확인', provider: null, limit: 5, domains: null });

  assert.equal(ran, false);
  assert.equal(result.state, 'unavailable');
  assert.deepEqual(result.providers, [{ id: 'needs-key', label: 'Needs Key', available: false, reason: 'credential_missing' }]);
});

test('web_search는 tool 내부 provider model call을 같은 ResourceRun child scope에 연결한다', async () => {
  const observer = { async reserve() {} };
  let observedOptions;
  const provider = {
    id: 'internal-model', label: 'Internal Model',
    async available() { return { available: true }; },
    async search(_query, options) {
      observedOptions = options;
      return [{ title: '결과', url: 'https://example.com/', snippet: '설명' }];
    },
  };
  const resourceCalls = [];
  const result = await makeWebSearchTool({ providers: [provider] }).execute({
    query: '검색', provider: null, limit: 3, domains: null,
  }, {
    toolCallId: 'tool-call-1',
    resourceRun: { modelObserver(facts) { resourceCalls.push(facts); return observer; } },
  });
  assert.equal(result.state, 'candidates');
  assert.equal(observedOptions.resourceObserver, observer);
  assert.deepEqual(resourceCalls, [{
    logicalCallId: 'tool:tool-call-1:web-search:internal-model',
    purpose: 'tool_internal_web_search',
  }]);
});
