import assert from 'node:assert/strict';
import test from 'node:test';

import { makeToolSearchTool } from '../src/tool-search.js';
import { NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION,
  wrapNxRealityAffordanceModel } from './helpers/nx-reality-affordance-contract-candidate.js';

test('후보는 업무 단어·새 Tool 없이 기존 tool_search description 하나만 교체한다', async () => {
  const baseline = makeToolSearchTool({ tools: [] }); let observed = null;
  const wrapped = wrapNxRealityAffordanceModel({ async respond(request) {
    observed = request; return { text: '직접 답', toolCalls: [] };
  } });
  await wrapped.respond({ tools: [baseline, { name: 'exec', description: 'Run command.' }] });
  assert.equal(observed.tools[0].name, 'tool_search');
  assert.equal(observed.tools[0].description, NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION);
  assert.equal(observed.tools[1].description, 'Run command.');
  assert.doesNotMatch(NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION, /매출|미수금|재고|계약/u);
  assert.match(NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION, /computer or external reality/u);
  assert.match(NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION, /definitions, opinions, brainstorming, creative work/u);
  const delta = Buffer.byteLength(NX_REALITY_AFFORDANCE_TOOL_SEARCH_DESCRIPTION, 'utf8')
    - Buffer.byteLength(baseline.description, 'utf8');
  assert.ok(Math.abs(delta) <= 256);
});

test('후보는 모델 호출·Tool 선택을 강제하지 않는다', async () => {
  let calls = 0;
  const wrapped = wrapNxRealityAffordanceModel({ async respond({ toolChoice }) {
    calls += 1; assert.equal(toolChoice, undefined); return { text: '매출은 판매로 얻은 총수입입니다.', toolCalls: [] };
  } });
  const response = await wrapped.respond({ tools: [] });
  assert.equal(calls, 1); assert.equal(response.toolCalls.length, 0);
});
