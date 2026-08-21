import test from 'node:test';
import assert from 'node:assert/strict';

import { runAgent } from '../src/agent-loop.js';
import { deferTools, makeToolSearchTool } from '../src/tool-search.js';

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

test('충분한 다중 출처 관측 뒤에는 같은 웹 그룹의 다른 도구도 다시 열리지 않는다', async () => {
  let turn = 0;
  const research = { name: 'web_research', description: 'multi source research', capabilityGroup: 'web_observation', deferred: true,
    parameters: { type: 'object' }, async execute() { return { stopFurtherResearch: true, completedCapabilityGroups: ['web_observation'] }; } };
  const read = { name: 'web_read', description: 'read public URL', capabilityGroup: 'web_observation', deferred: true,
    parameters: { type: 'object' }, async execute() { throw new Error('must stay closed'); } };
  const search = makeToolSearchTool({ tools: [research, read] });
  const result = await runAgent({ request: '조사', tools: [search, research, read], model: { async respond({ tools }) {
    turn += 1;
    if (turn === 1) return { text: '', toolCalls: [{ id: 's1', name: 'tool_search', args: { query: 'multi source research' } }] };
    if (turn === 2) return { text: '', toolCalls: [{ id: 'r1', name: 'web_research', args: {} }] };
    if (turn === 3) return { text: '', toolCalls: [{ id: 's2', name: 'tool_search', args: { query: 'read public URL' } }] };
    assert.deepEqual(tools.map((tool) => tool.name), ['tool_search']);
    return { text: '근거를 정리했어요.', toolCalls: [] };
  } } });
  assert.equal(result.receipts.at(-1).result.state, 'no_match');
  assert.equal(result.answer, '근거를 정리했어요.');
});
