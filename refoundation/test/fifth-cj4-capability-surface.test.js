import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';

const source = (path) => import('node:fs/promises').then(({ readFile }) => (
  readFile(new URL(path, import.meta.url), 'utf8')
));

async function run({ mode, request = '간단히 답해줘', respond, ...serverOptions }) {
  const room = await mkdtemp(join(tmpdir(), 't5-cj4-surface-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace, { recursive: true });
  const calls = [];
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace,
    capabilitySurfaceMode: mode,
    workAdmissionMode: 'action-v1',
    ...serverOptions,
    modelFactory: () => ({ async respond(input) {
      calls.push({ messages: structuredClone(input.messages), tools: structuredClone(input.tools) });
      return respond(input, calls.length);
    } }),
    modelStatus: () => ({ connected: true, provider: 'fixture', modelId: 'fixture' }),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((response) => response.json());
    const result = await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text: request }),
    }).then((response) => response.json());
    return { result, calls };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(room, { recursive: true, force: true });
  }
}

const toolBytes = (call) => Buffer.byteLength(JSON.stringify(call.tools));

test('directory-first 후보는 Direct의 schema를 최소 손과 capability directory로 제한한다', async () => {
  const respond = () => ({ text: '직접 답변', toolCalls: [] });
  const baseline = await run({ mode: 'current-core-v1', respond });
  const candidate = await run({ mode: 'directory-first-v1', respond });
  assert.equal(baseline.result.reply, '직접 답변'); assert.equal(candidate.result.reply, '직접 답변');
  assert.deepEqual(candidate.calls[0].tools.map((tool) => tool.name).toSorted(), [
    'attachment', 'connection', 'exec', 'memory_claim', 'memory_control', 'skill', 'tool_search', 'web_read',
  ]);
  assert.ok(candidate.calls[0].tools.length < baseline.calls[0].tools.length);
  assert.ok(toolBytes(candidate.calls[0]) < toolBytes(baseline.calls[0]));
});

test('directory-first Web 손은 현재 exact URL 사실에 따라 search와 read를 겹치지 않는다', async () => {
  const searched = await run({ mode: 'directory-first-v1', request: '공개 자료를 찾아줘',
    respond(input, turn) {
      if (turn === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'web_search'), true);
        assert.equal(input.tools.some((tool) => tool.name === 'web_read'), false);
        return { text: '', toolCalls: [{ id: 'search', name: 'web_search', args: {
          query: '공개 자료', provider: null, limit: 3, domains: null,
        } }] };
      }
      assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
      return { text: '검색 후보를 읽을 준비가 됐습니다.', toolCalls: [] };
    },
    webSearchProviders: [{ id: 'fixture', label: 'Fixture',
      async available() { return { available: true }; },
      async search() { return [{ title: '자료', url: 'https://example.test/', snippet: '근거' }]; } }],
  });
  assert.equal(searched.calls.length, 2);

  const exact = await run({ mode: 'directory-first-v1', request: 'https://example.test/report 를 읽고 비슷한 자료도 찾아줘',
    webSearchProviders: [{ id: 'fixture', label: 'Fixture',
      async available() { return { available: true }; }, async search() { return []; } }],
    webReadOptions: { resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => new Response('<html><body><article>정확한 원문</article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }) },
    respond(input, turn) {
      if (turn === 1) {
        assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
        assert.equal(input.tools.some((tool) => tool.name === 'web_search'), false);
        return { text: '', toolCalls: [{ id: 'read', name: 'web_read', args: {
          url: 'https://example.test/report', maxChars: 2_000, visibleBrowser: 'never',
        } }] };
      }
      assert.equal(input.tools.some((tool) => tool.name === 'web_search'), true);
      assert.equal(input.tools.some((tool) => tool.name === 'tool_search'), true);
      return { text: '원문을 읽었고 필요하면 관련 자료를 바로 검색할 수 있습니다.', toolCalls: [] };
    } });
  assert.equal(exact.calls.length, 2);
});

test('directory-first는 새 기억과 forget을 약속 문장으로 끝내지 않도록 기존 쓰기·삭제 손을 항상 연다', async () => {
  const observed = await run({ mode: 'directory-first-v1', request: '이 기준을 기억했다가 나중에 잊어줘',
    respond(input) {
      const names = input.tools.map((tool) => tool.name);
      assert.ok(names.includes('memory_claim'));
      assert.ok(names.includes('memory_control'));
      assert.equal(names.includes('memory'), false);
      return { text: '기억과 삭제를 실제 도구로 처리할 수 있습니다.', toolCalls: [] };
    } });
  assert.equal(observed.result.reply, '기억과 삭제를 실제 도구로 처리할 수 있습니다.');
});

test('Console admission의 canonical message ID가 memory_claim source로 그대로 결속된다', async () => {
  const observed = await run({ mode: 'directory-first-v1', request: '우리 기준은 HQ-PRICE-7391이니 기억해줘',
    respond(input, turn) {
      if (turn === 1) return { text: '', toolCalls: [{
        id: 'remember', name: 'memory_claim', args: {
          action: 'remember', kind: 'fact', value: '기준은 HQ-PRICE-7391이다.',
          subjectHandle: null,
          validTimeMeaning: { from: '2026-08-31', to: null, certainty: 'explicit' },
          scopeMeaning: 'organization',
        },
      }] };
      if (turn === 2) {
        const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'memory_claim').content);
        assert.equal(receipt.outcome, 'succeeded');
        assert.equal(receipt.result.state, 'committed');
        return { text: '', toolCalls: [{ id: 'done', name: 'work_completion', args: {
          outcome: 'achieved', inputSettlements: [],
        } }] };
      }
      return { text: '실제 기억 원장에 반영했습니다.', toolCalls: [] };
    } });
  assert.ok(observed.calls.length >= 2);
});

test('좁은 현재 정보는 capability 발견·완료 의식 없이 한 Web 관측 뒤 바로 답한다', async () => {
  const provider = {
    id: 'weather-fixture', label: 'Weather Fixture',
    async available() { return { available: true }; },
    async search() { return [{ rank: 1, title: '오늘 서울 예보',
      url: 'https://weather.example/seoul', snippet: '서울 26도, 저녁 비' }]; },
  };
  const observed = await run({ mode: 'directory-first-v1', request: '오늘 서울 날씨 알려줘',
    webSearchProviders: [provider],
    webReadOptions: {
      resolveHost: async () => ['93.184.216.34'],
      fetchImpl: async () => new Response('<html><body><article><h1>서울 오늘 예보</h1><p>현재 26도, 저녁에는 비가 옵니다.</p></article></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } }),
    },
    respond(input, modelTurn) {
      if (modelTurn === 1) {
        assert.ok(input.tools.some((tool) => tool.name === 'web_research'));
        assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
        return { text: '', toolCalls: [{ id: 'weather', name: 'web_research', args: {
          query: '서울 오늘 날씨', queries: null, sourceLimit: 1, domains: ['weather.example'],
        } }] };
      }
      assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
      assert.equal(input.tools.some((tool) => tool.name === 'web_read'), true);
      const receipt = JSON.parse(input.messages.findLast((message) => message.name === 'web_research').content);
      assert.equal(receipt.result.sources.length, 1);
      assert.match(receipt.result.sources[0].content.text, /현재 26도/u);
      return { text: '서울은 현재 26도이고 저녁에는 비가 옵니다.', toolCalls: [] };
    } });
  assert.equal(observed.result.reply, '서울은 현재 26도이고 저녁에는 비가 옵니다.');
  assert.equal(observed.calls.length, 2);
});

test('설치 제품 entry는 자격된 directory-first surface를 사용한다', async () => {
  assert.match(await source('../scripts/start-console.mjs'),
    /makeConsoleServer\(\{[\s\S]*capabilitySurfaceMode: 'directory-first-v1'/u);
});

test('현재 설치 제품 버전은 Interaction Core·모델과 분리된 Runtime 사실로 공급된다', async () => {
  const observed = await run({ mode: 'directory-first-v1', request: '현재 T5 버전이 뭐야?',
    productVersion: '0.5.0', respond(input) {
      assert.match(input.messages.at(-1).content, /T5 CURRENT PRODUCT IDENTITY/u);
      assert.match(input.messages.at(-1).content, /productVersion=0\.5\.0/u);
      return { text: '현재 설치된 T5 제품 버전은 0.5.0입니다.', toolCalls: [] };
    } });
  assert.equal(observed.result.reply, '현재 설치된 T5 제품 버전은 0.5.0입니다.');
  assert.equal(observed.result.selfStateSummary.productVersion, '0.5.0');
  const launcher = await source('../scripts/macos-launcher.m');
  assert.match(launcher, /CFBundleShortVersionString[\s\S]*T5_PRODUCT_VERSION/u);
});

test('directory-first 후보는 account reality를 Tool Search 없이 바로 확인한다', async () => {
  const observed = await run({ mode: 'directory-first-v1', request: '현재 연결 상태를 확인해줘',
    respond(input, modelTurn) {
      if (modelTurn === 1) {
        assert.ok(input.tools.some((tool) => tool.name === 'connection'));
        assert.equal(input.tools.some((tool) => tool.name === 'work_completion'), false);
        return { text: '', toolCalls: [{ id: 'list', name: 'connection',
          args: { action: 'list', id: null, actionId: null } }] };
      }
      return { text: '연결 상태를 확인했습니다.', toolCalls: [] };
    } });
  assert.equal(observed.result.reply, '연결 상태를 확인했습니다.');
  assert.equal(observed.calls.length, 2);
  assert.equal(observed.calls[0].tools.some((tool) => tool.name === 'connection'), true);
  assert.equal(observed.calls.some((call) => call.messages.some((message) => message.name === 'tool_search')), false);
});
