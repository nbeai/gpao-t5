// **F2 · 미분류 MCP 도구가 전부 승인으로 떨어졌다** (상태 지도 §12 F2 · `tool-admission.js:65`).
//
// 편입은 붙는 손 **전부**를 `toolKind:'unknown_kind'` + `needsApproval:true` 로 만들었다.
// 그러면 단순 조회 하나도 매 호출 카드다 — 자동성 헌장(`authority.js:4`)이 물을 수 있다고
// 정한 것은 넷뿐인데(비밀값·되돌릴 수 없는 파괴·새 상대 첫 전송·돈), 조회가 그 넷에
// 닿지 않는데도 카드가 섰다. 팀원 실사용에서 카드 6장 중 5장이 읽기·연결 준비였던
// 그 모양(`authority.js:8-10`)이 MCP 로 그대로 재발한 것이다.
//
// **그런데 지어내서 낮추지는 않는다.** 낮추는 근거는 **도구가 스스로 밝힌 사실**뿐이다 —
// MCP 규약의 tool annotations(`readOnlyHint`). 오픈클로도 종류를 **도구/플러그인 선언**에서
// 얻지, 이름으로 짐작하지 않는다:
//   `docs/tools/index.md:121` *"Tool policy is enforced before the model call."*
//   `docs/tools/index.md:103` *"Plugin authors wire tools through `api.registerTool(...)`
//     and the manifest's `contracts.tools`"*
// 이 저장소도 같은 규율을 이미 적어 뒀다 — `search-slot.js:21`:
//   *"고르는 쪽이 `p.id === 'tavily'` 처럼 **이름으로 짐작하면** 새 드라이버가 붙을 때마다
//     그 짐작을 늘려야 하고, 그게 곧 코어를 고치는 일이다."*
// 그래서 **이름(동사)으로는 안 낮춘다.** 밝힌 것만 본다. 안 밝히면 지금 그대로 카드다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpToolDescriptor, admitMcpTools } from '../src/runtime/tool-admission.js';
import { decideAutoGrant } from '../src/kernel/l2-plan/authority.js';

const 편입판 = () => ({ tools: { tools: {} }, descriptors: [], env: { connections: [] } });
const 붙이기 = (tools, ctx = 편입판()) => {
  const r = admitMcpTools({ server: 'svc', connector: 'svc', tools, session: { callTool: async () => ({}) } }, ctx);
  return { ...r, ctx };
};

// ── 밝힌 것은 낮춘다 ────────────────────────────────────────────────────────
test('F2 · readOnlyHint 를 밝힌 MCP 조회 도구는 read 로 내려가 카드가 안 선다', () => {
  const d = mcpToolDescriptor({
    server: 'svc', connector: 'svc',
    tools: undefined,
    tool: { name: 'search_pages', description: '페이지를 찾는다', annotations: { readOnlyHint: true } },
  });
  assert.equal(d.toolKind, 'read', '스스로 밝힌 읽기 전용은 read 다');
  assert.equal(d.needsApproval, false, '읽기에는 카드가 안 선다');
  assert.equal(decideAutoGrant({ kind: d.toolKind, needsApproval: d.needsApproval }), true,
    '헌장 판정이 자동으로 통과시킨다 — 조회는 헌장 넷에 안 닿는다');
});

test('F2 · 손 레지스트리의 toolKind 도 같이 내려간다(선언과 손이 갈라지지 않는다)', () => {
  const { ctx } = 붙이기([{ name: 'get_item', annotations: { readOnlyHint: true } }]);
  assert.equal(ctx.tools.tools['mcp.svc.get_item'].toolKind, 'read');
  assert.equal(ctx.descriptors[0].toolKind, 'read');
  assert.equal(ctx.env.connections[0].toolKind, 'read', 'selfState 가 읽는 자리까지 같은 값');
});

// ── 안 밝힌 것은 그대로 미상(카드) ─────────────────────────────────────────
test('F2 반대시험 · 아무것도 안 밝힌 도구는 지금 그대로 unknown_kind + 승인', () => {
  const d = mcpToolDescriptor({ server: 'svc', connector: 'svc', tool: { name: 'ask_question' } });
  assert.equal(d.toolKind, 'unknown_kind');
  assert.equal(d.needsApproval, true);
  assert.equal(decideAutoGrant({ kind: d.toolKind, needsApproval: d.needsApproval }), false, '미상은 카드다');
});

test('F2 반대시험 · readOnlyHint:false 를 밝힌 도구도 미상(카드) — 「아니다」는 「읽기」가 아니다', () => {
  const d = mcpToolDescriptor({
    server: 'svc', connector: 'svc',
    tool: { name: 'create_page', annotations: { readOnlyHint: false } },
  });
  assert.equal(d.toolKind, 'unknown_kind');
  assert.equal(d.needsApproval, true);
});

test('F2 반대시험 · 이름이 조회처럼 생겨도 밝히지 않으면 안 낮춘다(이름으로 짐작 금지)', () => {
  for (const name of ['search_everything', 'get_all', 'list_users', 'read_file']) {
    const d = mcpToolDescriptor({ server: 'svc', connector: 'svc', tool: { name } });
    assert.equal(d.toolKind, 'unknown_kind', `${name} 은 이름일 뿐 선언이 아니다`);
    assert.equal(d.needsApproval, true);
  }
});

test('F2 반대시험 · 힌트가 불리언이 아니면(문자열 "true" 등) 안 낮춘다', () => {
  for (const hint of ['true', 1, {}, 'yes']) {
    const d = mcpToolDescriptor({ server: 'svc', connector: 'svc', tool: { name: 'x', annotations: { readOnlyHint: hint } } });
    assert.equal(d.toolKind, 'unknown_kind', `${JSON.stringify(hint)} 는 밝힌 것이 아니다`);
  }
});

// ── 무엇을 근거로 낮췄는지 영수증에 남는다 ────────────────────────────────
test('F2 · 편입 영수증이 무엇을 무슨 근거로 낮췄는지 적는다', () => {
  const { 종류판정 } = 붙이기([
    { name: 'get_item', annotations: { readOnlyHint: true } },
    { name: 'ask_question' },
  ]);
  const 표 = new Map((종류판정 ?? []).map((x) => [x.id, x]));
  assert.equal(표.size, 2, '편입한 손마다 한 줄씩 남는다');
  assert.deepEqual(
    { toolKind: 표.get('mcp.svc.get_item').toolKind, 근거: 표.get('mcp.svc.get_item').근거 },
    { toolKind: 'read', 근거: 'annotations.readOnlyHint' },
    '낮춘 것은 근거를 밝힌다',
  );
  assert.equal(표.get('mcp.svc.ask_question').toolKind, 'unknown_kind');
  assert.equal(표.get('mcp.svc.ask_question').근거, null, '못 밝힌 것은 근거가 없다고 적는다(지어내지 않는다)');
});
