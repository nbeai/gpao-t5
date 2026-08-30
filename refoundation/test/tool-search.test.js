import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../src/agent-loop.js';
import { deferTools, makeToolSearchTool } from '../src/tool-search.js';

test('capability directory 조회 자체는 Work completion proposal을 요구하지 않는다', () => {
  assert.equal(makeToolSearchTool({ tools: [] }).completionProposalOptional, true);
});

test('주변 도구 schema는 검색 전 숨고 선택된 도구만 다음 모델 턴에 열린다', async () => {
  const calls = []; let turn = 0;
  const visual = { name: 'visual_reference', description: 'Find visual design reference preview images.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    async execute(args) { calls.push(args); return { previews: 3 }; } };
  const tools = deferTools([
    { name: 'exec', description: 'Run a terminal command.', parameters: { type: 'object' }, async execute() { return {}; } },
    visual,
  ], { coreNames: ['exec'] });
  tools.unshift(makeToolSearchTool({ tools: [visual] }));
  const model = { async respond({ tools: visible }) {
    turn += 1;
    if (turn === 1) {
      assert.deepEqual(visible.map((tool) => tool.name), ['tool_search', 'exec']);
      return { text: '', toolCalls: [{ id: 'find', name: 'tool_search', args: { query: 'visual design preview' } }] };
    }
    if (turn === 2) {
      assert.deepEqual(visible.map((tool) => tool.name), ['tool_search', 'exec', 'visual_reference']);
      return { text: '', toolCalls: [{ id: 'use', name: 'visual_reference', args: { query: 'beige cafe' } }] };
    }
    return { text: '미리보기 3개', toolCalls: [] };
  } };
  const result = await runAgent({ request: '참고 이미지 보여줘', model, tools });
  assert.equal(result.answer, '미리보기 3개'); assert.deepEqual(calls, [{ query: 'beige cafe' }]);
});

test('선택된 도구가 필요한 보조 도구는 이름을 사용자가 몰라도 함께 열린다', async () => {
  const cli = { name: 'cli_prepare', description: 'Prepare a managed command capability.' };
  const video = { name: 'video_text', description: 'Read a public video caption.', relatedTools: ['cli_prepare'] };
  const result = await makeToolSearchTool({ tools: [cli, video] }).execute({ query: 'video caption' });
  assert.deepEqual(result.activatedTools, ['video_text', 'cli_prepare']);
});

test('한 번의 검색은 가장 관련 있는 도구 하나와 그 명시적 의존성만 연다', async () => {
  const tools = [
    { name: 'web_research', description: 'Research several public web sources.' },
    { name: 'web_search', description: 'Search public web source candidates.' },
    { name: 'web_read', description: 'Read one public web source.' },
  ];
  const result = await makeToolSearchTool({ tools }).execute({ query: 'multi source web research' });
  assert.deepEqual(result.activatedTools, ['web_research']);
});

test('서로 섞인 후순위 능력군에서도 단일 목적은 정확한 도구 하나만 연다', async () => {
  const tools = [
    { name: 'automation', description: 'Create, inspect, pause, resume, cancel, or run a durable scheduled task.',
      searchTerms: ['schedule recurring daily weekly monthly future cron reminder', '예약 반복 매일 매주 매월 나중 알림'] },
    { name: 'session_search', description: 'Search or read the user’s canonical past T5 conversations for exact words, decisions, or prior work.',
      searchTerms: ['past conversation history prior decision transcript', '과거 대화 원문 이전 결정 기록'] },
    { name: 'web_research', description: 'Research a public-web question through focused searches and parallel reading of distinct source domains.',
      searchTerms: ['multi source research', 'current trends evidence', '웹 리서치', '시장 조사', '여러 출처'] },
    { name: 'cli_prepare', description: 'Find and prepare a trusted T5-managed command capability from pinned official releases.' },
    { name: 'capability_catalog', description: 'Search the trusted bundled catalog when current tools and connections lack a needed capability.',
      searchTerms: ['official connection capability candidate blocker missing integration'] },
    { name: 'capability_evidence', description: 'Read observed use of prepared methods and managed commands when the user asks whether they are actually being used or remain useful. Reports use, completion, failure, cancellation, recent use, time, and retries.' },
    { name: 'conversation_recall', description: 'Recover an exact range or find text inside omitted historical terminal output.' },
    { name: 'visual_reference', description: 'Find visual or design references and return managed preview images.',
      searchTerms: ['visual references', 'design examples', 'reference images'] },
  ];
  const search = makeToolSearchTool({ tools });
  assert.match(search.description, /official candidates for a missing connection/u);
  assert.match(search.description, /evidence of whether a prepared skill or managed command was actually used/u);
  const cases = [
    ['future recurring automation schedule', 'automation'],
    ['past conversation decision search', 'session_search'],
    ['multi source web research', 'web_research'],
    ['prepare trusted managed cli command', 'cli_prepare'],
    ['find unavailable official connection capability candidate', 'capability_catalog'],
    ['inspect whether managed skills are actually used', 'capability_evidence'],
    ['recover omitted historical terminal output', 'conversation_recall'],
    ['design reference preview images', 'visual_reference'],
  ];
  for (const [query, expected] of cases) {
    const result = await search.execute({ query });
    assert.deepEqual(result.activatedTools, [expected], query);
  }
});

test('대화 중 목적이 바뀌면 이미 연 도구가 다른 후순위 능력 발견을 가로막지 않는다', async () => {
  let turn = 0;
  const automation = { name: 'automation', description: 'future recurring automation schedule', deferred: true,
    parameters: { type: 'object' }, async execute() { return { state: 'listed' }; } };
  const sessionSearch = { name: 'session_search', description: 'past conversation decision search', deferred: true,
    parameters: { type: 'object' }, async execute() { return { state: 'searched' }; } };
  const search = makeToolSearchTool({ tools: [automation, sessionSearch] });
  const result = await runAgent({ request: '지난 결정을 찾은 뒤 예약 작업도 확인해줘', tools: [search, automation, sessionSearch],
    model: { async respond({ tools }) {
      turn += 1;
      if (turn === 1) return { text: '', toolCalls: [{ id: 's1', name: 'tool_search', args: { query: 'past conversation decision search' } }] };
      if (turn === 2) return { text: '', toolCalls: [{ id: 'history', name: 'session_search', args: {} }] };
      if (turn === 3) return { text: '', toolCalls: [{ id: 's2', name: 'tool_search', args: { query: 'future recurring automation schedule' } }] };
      if (turn === 4) {
        assert.deepEqual(tools.map((tool) => tool.name), ['tool_search', 'session_search', 'automation']);
        return { text: '', toolCalls: [{ id: 'jobs', name: 'automation', args: {} }] };
      }
      return { text: '과거 결정과 예약 작업을 함께 확인했어요.', toolCalls: [] };
    } },
  });
  assert.deepEqual(result.receipts.map((receipt) => receipt.actualCall?.name), [
    'tool_search', 'session_search', 'tool_search', 'automation',
  ]);
  assert.equal(result.answer, '과거 결정과 예약 작업을 함께 확인했어요.');
});

test('화면 관측을 정확히 찾으면 일반 search 단어가 과거 대화 검색을 잘못 열지 않는다', async () => {
  const tools = [
    { name: 'browser', description: 'Render and interact with a public web page.',
      searchTerms: ['browser rendered page dynamic website'] },
    { name: 'session_search', description: 'Search canonical past user conversations.' },
  ];
  const result = await makeToolSearchTool({ tools }).execute({
    query: 'browser navigate public search results and inspect business profile',
  });
  assert.deepEqual(result.activatedTools, ['browser']);
});

test('일반 web search 한 단어만 겹치면 과거 대화 검색을 후순위 대체제로 열지 않는다', async () => {
  const result = await makeToolSearchTool({ tools: [
    { name: 'session_search', description: 'Search canonical past user conversations for exact words and prior decisions.' },
    { name: 'automation', description: 'Inspect scheduled recurring work.' },
    { name: 'capability_catalog', description: 'The catalog contains pre-install candidates and exact blockers.' },
  ] }).execute({ query: 'public web search for current official statistics sources' });
  assert.equal(result.state, 'no_match');
  assert.deepEqual(result.activatedTools, []);
});

test('data 같은 내부 문자열이 candidates에 들어 있다는 이유만으로 capability catalog를 열지 않는다', async () => {
  const result = await makeToolSearchTool({ tools: [
    { name: 'capability_catalog', description: 'Search the catalog when current tools do not provide a needed capability. The catalog contains pre-install candidates and exact blockers.',
      searchTerms: ['official connection capability candidate blocker missing integration'] },
  ] }).execute({ query: 'current public data about consumer spending' });
  assert.equal(result.state, 'no_match');
});

test('현재 후순위 손을 미리 찾으면 비슷한 도구 대신 정확한 선행 관측을 돌려준다', async () => {
  const search = makeToolSearchTool({
    tools: [{ name: 'automation', description: 'Automate future interaction work.' }],
    prerequisites: { browser: { tool: 'web_read', condition: 'exact URL boundary first' } },
  });
  const result = await search.execute({
    query: 'browser interaction to inspect a public business profile',
  });
  assert.equal(result.state, 'prerequisite_required');
  assert.equal(result.requestedTool, 'browser');
  assert.deepEqual(result.activatedTools, []);
  assert.deepEqual(result.tools, []);
  assert.deepEqual(result.prerequisite, { tool: 'web_read', condition: 'exact URL boundary first' });
});

test('URL 읽기가 정적 관측 소진을 증명하면 다음 모델 턴에 화면 관측만 자동으로 열린다', async () => {
  let turn = 0;
  const read = { name: 'web_read', description: 'Read an exact public URL.', parameters: { type: 'object' },
    async execute() { return { state: 'dynamic_required', activatedTools: ['browser'], capabilityBoundary: {
      required: 'browser_render', available: false, staticObservationExhausted: true,
    } }; } };
  const browser = { name: 'browser', description: 'Render an exact dynamic page.', deferred: true,
    parameters: { type: 'object' }, async execute() { return { state: 'observed' }; } };
  const result = await runAgent({ request: '이 주소 내용을 확인해줘', tools: [read, browser],
    model: { async respond({ tools }) {
      turn += 1;
      if (turn === 1) {
        assert.deepEqual(tools.map((tool) => tool.name), ['web_read']);
        return { text: '', toolCalls: [{ id: 'read', name: 'web_read', args: {} }] };
      }
      if (turn === 2) {
        assert.deepEqual(tools.map((tool) => tool.name), ['web_read', 'browser']);
        return { text: '', toolCalls: [{ id: 'render', name: 'browser', args: {} }] };
      }
      return { text: '동적 페이지를 확인했어요.', toolCalls: [] };
    } } });
  assert.equal(result.answer, '동적 페이지를 확인했어요.');
  assert.deepEqual(result.receipts.map((receipt) => receipt.actualCall.name), ['web_read', 'browser']);
});

test('모델이 수단을 섞어 검색해도 사용자 결과에 맞는 시각 참고자료 손을 우선한다', async () => {
  const tools = [
    { name: 'web_read', description: 'Read one exact public URL.' },
    { name: 'browser', description: 'Render a browser page and screenshot.' },
    { name: 'visual_reference', description: 'Return managed previews.', searchTerms: ['visual references', 'design examples', 'reference images', 'browser screenshot'] },
  ];
  const result = await makeToolSearchTool({ tools }).execute({ query: 'web search read browser screenshot visual references' });
  assert.deepEqual(result.activatedTools, ['visual_reference']);
});

test('검색하지 않은 숨은 도구 호출은 실제 실행되지 않는다', async () => {
  let executed = false; let turn = 0;
  const hidden = { name: 'automation', description: 'Schedule future work.', parameters: { type: 'object' },
    async execute() { executed = true; return {}; } };
  const result = await runAgent({ request: '예약', tools: [{ ...hidden, deferred: true }], model: { async respond() {
    turn += 1; return turn === 1 ? { text: '', toolCalls: [{ id: 'bad', name: 'automation', args: {} }] }
      : { text: '도구를 먼저 찾아야 해요.', toolCalls: [] };
  } } });
  assert.equal(executed, false); assert.equal(result.receipts[0].actualCall, null);
  assert.equal(result.receipts[0].result.state, 'deferred_tool_not_active');
});

test('완료된 bounded 도구가 닫은 우회 수단은 다음 모델 턴에서 다시 노출되지 않는다', async () => {
  let turn = 0;
  const tools = [
    { name: 'exec', description: 'terminal', parameters: { type: 'object' }, async execute() { return {}; } },
    { name: 'visual_reference', description: 'visual', parameters: { type: 'object' }, async execute() {
      return { state: 'previewed', previews: [1, 2, 3], deactivatedTools: ['exec'] };
    } },
  ];
  const result = await runAgent({ request: '이미지', tools, model: { async respond({ tools: visible }) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 'v', name: 'visual_reference', args: {} }] };
    assert.deepEqual(visible.map((tool) => tool.name), ['visual_reference']);
    return { text: '세 장을 보여드렸어요.', toolCalls: [] };
  } } });
  assert.equal(result.answer, '세 장을 보여드렸어요.');
});

test('완료된 도구는 다시 검색해도 같은 Run에서 재활성화되지 않는다', async () => {
  let turn = 0;
  const bounded = { name: 'web_research', description: 'multi source research', parameters: { type: 'object' }, deferred: true,
    async execute() { return { stopFurtherResearch: true, deactivatedTools: ['web_research'] }; } };
  const search = makeToolSearchTool({ tools: [bounded] });
  const result = await runAgent({ request: '조사', tools: [search, bounded], model: { async respond({ tools }) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 's1', name: 'tool_search', args: { query: 'multi source research' } }] };
    if (turn === 2) return { text: '', toolCalls: [{ id: 'r1', name: 'web_research', args: {} }] };
    assert.deepEqual(tools.map((tool) => tool.name), ['tool_search']);
    return { text: '조사 완료', toolCalls: [] };
  } } });
  assert.equal(result.answer, '조사 완료');
});

test('다중 출처 수만으로 웹 목적 완료를 대신하지 않고 exact URL 읽기를 계속 제공한다', async () => {
  let turn = 0;
  const research = { name: 'web_research', description: 'multi source research', capabilityGroup: 'web_observation', deferred: true,
    parameters: { type: 'object' }, async execute() { return { stopFurtherResearch: true, deactivatedTools: ['web_research', 'web_search'] }; } };
  const broadSearch = { name: 'web_search', description: 'search public web candidates', capabilityGroup: 'web_observation',
    parameters: { type: 'object' }, async execute() { throw new Error('broad search must stay closed'); } };
  let exactReads = 0;
  const read = { name: 'web_read', description: 'read public URL', capabilityGroup: 'web_observation',
    parameters: { type: 'object' }, async execute() { exactReads += 1; return { state: 'read', content: { text: '필수 사실' } }; } };
  const search = makeToolSearchTool({ tools: [research, read] });
  const result = await runAgent({ request: '조사', tools: [search, research, broadSearch, read], model: { async respond({ tools }) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 's1', name: 'tool_search', args: { query: 'multi source research' } }] };
    if (turn === 2) return { text: '', toolCalls: [{ id: 'r1', name: 'web_research', args: {} }] };
    if (turn === 3) {
      assert.deepEqual(tools.map((tool) => tool.name), ['tool_search', 'web_read']);
      return { text: '', toolCalls: [{ id: 'read', name: 'web_read', args: {} }] };
    }
    return { text: '근거를 정리했어요.', toolCalls: [] };
  } } });
  assert.equal(exactReads, 1);
  assert.equal(result.receipts.at(-1).result.state, 'read');
  assert.equal(result.answer, '근거를 정리했어요.');
});
