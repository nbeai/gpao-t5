// P-OP C · **낯선 서비스도 커넥터가 된다.**
//
// 실측(오너 라이브 2026-07-28): "카페24 주문 가져와줘" 에 T5 는 이 컴퓨터 안을 뒤지고
// 못 찾자 "관리자에서 CSV 로 내려받아 주세요"라고 답했다. 그때는 그게 정직한 최선이었다 —
// 커넥터는 소스에 적힌 것만 존재했고, 비밀 입력면은 이미 선언된 id 만 받았기 때문이다.
//
// 목표는 주문을 무조건 가져오는 게 아니라 **사용자 권한이 진짜 필요한 경계만 남기는 것**이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeConnectorDeclareTool, checkDeclaration, toConnectorDeclaration, declaredId,
} from '../src/runtime/connector-declare.js';
import { checkDeclaredTarget } from '../src/runtime/declared-target.js';
import { DeclaredConnectorStore } from '../src/surface/declared-connector-store.js';

const 선언 = (over = {}) => ({
  service: '어떤상점',
  fields: [{ name: 'client_id', label: 'Client ID' }, { name: 'client_secret', label: 'Client Secret', secret: true }],
  issue: { url: 'https://developers.example.com/apps', steps: ['앱을 만들고 두 값을 받아 주세요'] },
  verify: { url: 'https://api.example.com/v1/me', headers: { Authorization: 'Bearer {client_secret}' } },
  tools: [{
    name: 'orders', label: '주문 목록', description: '주문을 가져온다',
    parameters: { type: 'object', properties: { limit: { type: 'number' } } },
    defaults: { limit: 10 },
    request: { url: 'https://api.example.com/v1/orders?limit={limit}', headers: { Authorization: 'Bearer {client_secret}' } },
    probeArgs: { limit: 1 },
  }],
  ...over,
});

// ── 주소 경계 ────────────────────────────────────────────────────────────
// 소스에 적힌 주소는 우리가 읽고 넣은 것이다. 런타임 선언은 **모델이 만든 주소**가 그대로
// 손이 된다. 바깥으로 나가는 척하며 안을 두드리는 것을 여기서 자른다.
test('안쪽을 가리키는 주소는 손이 되지 않는다', () => {
  for (const bad of [
    'http://api.example.com/v1',            // 평문 — 비밀값이 그대로 나간다
    'https://localhost/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.5/v1',
    'https://192.168.0.10/v1',
    'https://169.254.169.254/latest/meta-data/', // 클라우드 메타데이터
    'https://[::1]/v1',
    'https://box.local/v1',
    'https://user:pw@api.example.com/v1',
  ]) {
    assert.equal(checkDeclaredTarget(bad).ok, false, `통과하면 안 된다: ${bad}`);
  }
  assert.equal(checkDeclaredTarget('https://api.example.com/v1').ok, true);
});

test('확인 주소만 바깥이고 실제 호출이 안쪽인 선언은 통째로 막는다', () => {
  const r = checkDeclaration(선언({
    tools: [{ name: 'x', label: 'x', request: { url: 'https://127.0.0.1/steal' } }],
  }));
  assert.equal(r.ok, false);
  assert.match(r.why, /이 컴퓨터나 집 안 장비/);
});

// ── 못 지킬 선언을 받지 않는다 ──────────────────────────────────────────
test('채울 수 없는 값이 들어 있으면 선언을 받지 않는다', () => {
  const r = checkDeclaration(선언({
    verify: { url: 'https://api.example.com/me', headers: { Authorization: 'Bearer {없는값}' } },
  }));
  assert.equal(r.ok, false);
  assert.match(r.why, /채울 수 없는 값/);
});

test('무엇을 할지 없는 선언은 받지 않는다', () => {
  assert.equal(checkDeclaration(선언({ tools: [] })).ok, false);
  assert.equal(checkDeclaration(선언({ fields: [] })).ok, false);
  assert.equal(checkDeclaration(선언({ service: '' })).ok, false);
});

test('제대로 된 선언은 통과하고 커넥터 모양이 된다', () => {
  assert.equal(checkDeclaration(선언()).ok, true);
  const c = toConnectorDeclaration(선언());
  assert.equal(c.authState, 'api_key');
  assert.equal(c.connected, false, '선언은 연결이 아니다');
  assert.equal(c.declared, true);
  assert.ok(c.aliases.includes('어떤상점'), '사용자가 부른 말로 다시 찾을 수 있어야 한다');
  assert.equal(c.authMethods[0].tools.length, 1);
});

test('한글 이름도 도구 id 로 쓸 수 있는 이름이 된다', () => {
  const id = declaredId('어떤상점');
  assert.match(id, /^[a-zA-Z0-9_.-]+$/, `모델 스키마가 못 받는 id: ${id}`);
  assert.equal(declaredId('Cafe Shop'), 'd-cafe-shop');
});

// ── 승인 카드 ────────────────────────────────────────────────────────────
// 이 카드의 핵심은 **사용자가 넘을 문턱**이다. "제가 붙일게요, 이것 하나만 해 주세요"까지가
// 한 화면에 있어야 한다. 그게 "실제 권한이 필요한 경계만 남긴다"의 화면 형태다.
test('승인 카드가 사용자가 할 일과 T5가 할 일을 함께 보여준다', () => {
  const tool = makeConnectorDeclareTool({ connectors: () => [] });
  const p = tool.previewOf(선언());
  assert.match(p.impact, /어떤상점/);
  assert.match(p.what, /Client ID · Client Secret/, '무엇을 받아 와야 하는지가 없다');
  assert.match(p.what, /developers\.example\.com/, '어디서 받는지가 없다');
  assert.match(p.what, /주문 목록/, '연결되면 뭐가 되는지가 없다');
  assert.match(p.scope, /api\.example\.com/);
  assert.match(p.cancel, /아무 값도 저장되지 않아요/);
});

// ── 선언 → 같은 길 ──────────────────────────────────────────────────────
test('선언하면 커넥터 배열에 서고, 곧바로 같은 연결 길로 넘어간다', async () => {
  const connectors = [];
  let 넘어간것 = null;
  const tool = makeConnectorDeclareTool({
    connectors: () => connectors,
    connect: { handler: async (a) => { 넘어간것 = a; return { result: { needsSecret: true } }; } },
  });
  const r = await tool.handler(선언());
  assert.equal(connectors.length, 1, '커넥터 배열에 안 섰다');
  assert.equal(connectors[0].label, '어떤상점');
  assert.equal(넘어간것?.connector, connectors[0].id, '선언만 하고 길이 끊겼다');
  assert.ok(r, '이어받은 결과를 그대로 돌려줘야 한다');
});

test('못 만드는 선언은 커넥터 배열을 더럽히지 않는다', async () => {
  const connectors = [];
  const tool = makeConnectorDeclareTool({ connectors: () => connectors });
  const r = await tool.handler(선언({ tools: [{ name: 'x', label: 'x', request: { url: 'https://localhost/x' } }] }));
  assert.equal(r.blocked, true);
  assert.equal(connectors.length, 0);
  assert.ok(r.nextSafeAction, '막다른 답이 아니라 다음 길을 준다');
});

// ── 껐다 켜도 남는다 ────────────────────────────────────────────────────
// 승인도 값도 이미 받았는데 다시 묻는 것은, 사용자에게는 연결이 안 된 것과 같다.
test('올린 서비스는 껐다 켜도 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-decl-'));
  const store = new DeclaredConnectorStore(dir);
  const 첫판 = [];
  await makeConnectorDeclareTool({ connectors: () => 첫판, store }).handler(선언());
  assert.equal(첫판.length, 1);

  // 다시 켠 것처럼 — 빈 배열에서 시작한다
  const 둘째판 = [];
  const 되살림 = await makeConnectorDeclareTool({ connectors: () => 둘째판, store }).restoreDeclared();
  assert.deepEqual(되살림, ['어떤상점']);
  assert.equal(둘째판[0].authMethods[0].tools.length, 1, '무엇을 할 수 있는지까지 살아나야 한다');
});

test('규칙이 엄해지면 옛 선언은 되살아나지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-decl2-'));
  const store = new DeclaredConnectorStore(dir);
  await store.add({ ...선언(), id: 'd-old', tools: [{ name: 'x', label: 'x', request: { url: 'http://api.example.com/x' } }] });
  const list = [];
  assert.deepEqual(await makeConnectorDeclareTool({ connectors: () => list, store }).restoreDeclared(), []);
  assert.equal(list.length, 0);
});

// 실측(오너 라이브 2026-07-28): 오픈웨더맵 연결 카드에 **"메시지를 실제로 밖으로 보내는
// 일이라 보내기 전에 한 번 확인받아요"** 가 떴다. 보내는 일이 아니었다.
// 원인은 위층이 아니라 선언이었다 — 커넥터 손이 `unknown_kind` 로 선언돼 있어서,
// 승인을 강제하려고 계획 층이 종류를 `send` 로 바꿔 달았고(action-plan.js) 그 이름의
// 문구가 그대로 카드에 실렸다. `connect_account` 는 이미 안전 바닥이라 승인은 그대로
// 강제되고, 사용자가 읽는 이유만 사실이 된다.
test('연결 카드는 전송이 아니라 연결이라고 말한다', async () => {
  const { explainAuthority } = await import('../src/kernel/l2-plan/authority.js');
  const tool = makeConnectorDeclareTool({ connectors: () => [] });
  assert.equal(tool.toolKind, 'connect_account', '손이 자기 종류를 잘못 부르면 위층이 고칠 수 없다');

  // 자동성 헌장(2026-08-03): 붙일 준비는 아무 것도 바꾸지 않으므로 자동이다. 사람의 관문은
  // 승인 카드가 아니라 **비밀값 입력면**(헌장 ①)이다 — 팀원 실측에서 "새 서비스 붙이기 꼭 확인"
  // 카드가 오너가 든 마찰 6장 중 하나였다.
  // **재는 계약은 그대로다** — 이 손이 하는 일을 사용자에게 정확히 말하는가.
  // 없는 전송을 말하면 안 되고, 무엇을 했는지가 사실이어야 한다.
  const r = explainAuthority({ kind: 'connect_account', preview: tool.previewOf(선언()) });
  assert.equal(r.needsApproval, false, '연결 준비는 헌장 넷이 아니다');
  assert.ok(!/보내는 일/.test(r.why), `없는 전송을 말했다: ${r.why}`);
  assert.ok(!/가벼운 정리/.test(r.why), `연결을 가벼운 정리로 뭉갰다: ${r.why}`);
  assert.match(r.why, /붙일 준비|연결/, `무엇을 했는지 말하지 않았다: ${r.why}`);
  assert.match(r.why, /비밀값|입력창/, '사람이 넘을 문턱이 어디인지 말해야 한다');
});

// ── 원격 MCP 길 ──────────────────────────────────────────────────────────
// **사용자 문턱이 다르다.** API 키는 그 서비스 개발자 화면에서 값을 받아 와야 하지만,
// 원격 MCP 는 T5 가 클라이언트 등록까지 스스로 해서 사용자가 하는 일은 동의 한 번이다
// (노션이 그렇게 붙었다 — 오너 라이브 2026-07-28). 문턱을 낮추는 게 이 제품의 목표라
// 이 길이 열려 있으면 이게 먼저다.
const mcp선언 = (over = {}) => ({ service: '어떤협업툴', authKind: 'mcp', url: 'https://mcp.example.com/mcp', ...over });

test('원격 MCP 는 받아 올 값 없이도 선언이 선다', () => {
  assert.equal(checkDeclaration(mcp선언()).ok, true);
  const c = toConnectorDeclaration(mcp선언());
  assert.equal(c.authState, 'oauth');
  assert.deepEqual(c.authMethods, [{ kind: 'mcp', url: 'https://mcp.example.com/mcp' }]);
  assert.equal(c.connected, false, '선언은 연결이 아니다');
});

test('MCP 선언도 주소 경계를 그대로 받는다', () => {
  assert.equal(checkDeclaration(mcp선언({ url: 'http://mcp.example.com/mcp' })).ok, false);
  assert.equal(checkDeclaration(mcp선언({ url: 'https://127.0.0.1/mcp' })).ok, false);
  assert.equal(checkDeclaration(mcp선언({ url: undefined })).ok, false);
});

test('MCP 카드는 없는 값을 받아 오라고 하지 않는다', () => {
  const p = makeConnectorDeclareTool({ connectors: () => [] }).previewOf(mcp선언());
  assert.match(p.what, /허용 한 번/);
  assert.match(p.what, /받아 오실 값은 없어요/);
  // 무엇을 할 수 있게 되는지는 붙어야 안다 — 지어내지 않는다
  assert.ok(!/할 수 있는 것:/.test(p.what), `안 붙었는데 능력을 약속했다: ${p.what}`);
  assert.match(p.scope, /mcp\.example\.com/);
});

// 실측(오너 라이브 2026-07-28): 주소로 붙인 원격 MCP 의 도구를 쓰려 하자 승인 카드에
//   `ask_question 실행 — undefined` · `어디에: undefined 서버에서`
// 가 떴다. 설정에 등록된 서버는 이름이 있지만 주소로 붙은 것은 이름이 없다.
// 무엇을 허락하는지 모르는 승인은 승인이 아니다.
test('주소로 붙은 MCP 도구도 어디에 붙었는지 사람 말로 말한다', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  admitMcpTools({
    server: undefined, connectorLabel: '딥위키', connector: 'd-deepwiki',
    tools: [{ name: 'ask_question', description: '묻는다', inputSchema: { type: 'object', properties: {} } }],
    session: { callTool: async () => ({ content: [] }) },
  }, ctx);
  const 손 = Object.values(ctx.tools.tools)[0];
  const p = 손.previewOf({ q: 1 });
  assert.ok(!/undefined/.test(`${p.impact} ${p.scope}`), `카드에 undefined 가 샜다: ${p.impact} · ${p.scope}`);
  assert.match(p.impact, /딥위키/);
  assert.match(p.scope, /딥위키/);
});

// 같은 카드에서 "메시지를 실제로 밖으로 보내는 일이라"도 떴다 — 조회였다.
// 계획 층이 승인을 강제하려고 종류를 `send` 로 바꿔 달았고, 그 이름의 문구가 실렸다.
test('승인을 강제하려고 바꾼 종류가 사용자에게 전송으로 보이지 않는다', async () => {
  const { buildActionPlan } = await import('../src/kernel/l2-plan/action-plan.js');
  const selfState = {
    connectedTools: [{ id: 'x.read', label: '조회', connected: true, executable: true, toolKind: 'read', needsApproval: true }],
    currentModel: { id: 'm' }, limits: [],
  };
  const plan = buildActionPlan({ intent: { neededTools: ['x.read'], toolArgs: { 'x.read': {} } }, selfState, mode: 'smart' });
  const g = (plan.needsApproval ?? [])[0];
  assert.ok(g, '승인 강제가 풀리면 안 된다');
  assert.ok(!/보내는 일/.test(g.reason?.why ?? ''), `없는 전송을 말했다: ${g.reason?.why}`);
});

// 실측(오너 라이브 2026-07-28): 주소로 붙은 MCP 의 손이 원장에 `mcp.undefined.ask_question`
// 으로 남았다. 보기 흉한 것으로 끝나지 않는다 — 주소로 붙은 서비스가 **둘**이 되면 id 가
// 겹쳐서 나중에 붙은 것이 앞의 손을 조용히 덮어쓴다. 사용자는 A 서비스를 불렀는데 B 가 돈다.
test('주소로 붙은 서비스가 둘이어도 손이 서로 덮어쓰지 않는다', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  const 붙이기 = (connector, label) => admitMcpTools({
    server: undefined, connector, connectorLabel: label,
    tools: [{ name: 'ask_question', description: '묻는다', inputSchema: { type: 'object', properties: {} } }],
    session: { callTool: async () => ({ content: [{ type: 'text', text: label }] }) },
  }, ctx);
  붙이기('d-first', '첫째');
  붙이기('d-second', '둘째');

  const ids = Object.keys(ctx.tools.tools);
  assert.equal(ids.length, 2, `손이 덮어써졌다: ${ids.join(' · ')}`);
  assert.ok(!ids.some((id) => id.includes('undefined')), `id 에 undefined 가 샜다: ${ids.join(' · ')}`);
});

// 실측(오너 라이브 2026-07-28, D 시나리오 — "내 노션에서 이번 주 회의록 찾아줘"):
// 원장에 `{"results":[],"type":"workspace_search"}` 가 **확인한 사실**로 남았다.
// 많은 MCP 서버가 JSON 을 text 로 담아 준다 — 그건 모델이 읽을 것이지 사용자가 읽을 것이
// 아니다. 구조는 이미 result 로 모델에게 간다. 둘을 섞으면 원장이 로그가 된다.
test('MCP 결과가 JSON 이면 사람 말 자리에 넣지 않는다', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const 붙여서실행 = async (text) => {
    const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
    admitMcpTools({
      server: undefined, connector: 'd-x', connectorLabel: '어떤서비스',
      tools: [{ name: 'search', description: '찾는다', inputSchema: { type: 'object', properties: {} } }],
      session: { callTool: async () => ({ content: [{ type: 'text', text }] }) },
    }, ctx);
    return Object.values(ctx.tools.tools)[0].handler({});
  };

  const 기계말 = await 붙여서실행('{"results":[],"type":"workspace_search"}');
  assert.ok(!/results/.test(기계말.userSafeSummary), `원장에 기계 말이 샜다: ${기계말.userSafeSummary}`);
  assert.ok(기계말.result, '구조는 모델에게 그대로 가야 한다');

  const 사람말결과 = await 붙여서실행('회의록 3건을 찾았어요.');
  assert.equal(사람말결과.userSafeSummary, '회의록 3건을 찾았어요.', '사람 말까지 버리면 안 된다');
});

// 같은 카드에 `어디에: notion 에서` 도 떴다 — 내부 이름이다. 사용자가 아는 이름은 "노션"이다.
test('승인 카드는 내부 서버 이름 대신 사용자가 부르는 이름을 쓴다', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  admitMcpTools({
    server: 'notion', connector: 'notion', connectorLabel: '노션',
    tools: [{ name: 'search', description: '찾는다', inputSchema: { type: 'object', properties: {} } }],
    session: { callTool: async () => ({ content: [] }) },
  }, ctx);
  const p = Object.values(ctx.tools.tools)[0].previewOf({});
  assert.match(p.scope, /노션/);
  assert.ok(!/\bnotion\b/.test(p.scope), `내부 이름이 보인다: ${p.scope}`);
});

// 실측(오너 라이브 2026-07-28, D): "내 노션에서 이번 주 회의록 찾아줘" 한 마디에 승인
// 카드가 **네 번** 떴다. 같은 손이 인자만 바꿔 다시 물었기 때문이다. 두 번째 카드는 첫
// 번째와 같은 질문이라 사용자가 새로 판단할 것이 없다 — 그렇게 묻는 것은 확인이 아니라
// 절차가 되고, 사용자는 읽지 않고 누르게 된다. 그 순간 승인은 안전장치이길 그만둔다.
//
// 면제 범위는 **이 요청 안, 같은 손**뿐이다. 손이 다르면 다른 결정이고, 요청이 바뀌면
// 맥락도 바뀐다.
test('빈 결과도 사실로 남는다 — 0건을 사람 말로', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const 실행 = async (text) => {
    const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
    admitMcpTools({
      server: 'svc', connector: 'svc', connectorLabel: '어떤서비스',
      tools: [{ name: 'search', description: '찾는다', inputSchema: { type: 'object', properties: {} } }],
      session: { callTool: async () => ({ content: [{ type: 'text', text }] }) },
    }, ctx);
    return Object.values(ctx.tools.tools)[0].handler({});
  };
  // 없음도 사실이다. 이걸 버리면 모델은 못 찾은 줄도 모르고 같은 손을 다시 시도한다.
  assert.match((await 실행('{"results":[],"type":"workspace_search"}')).userSafeSummary, /찾은 게 없어요/);
  assert.match((await 실행('{"results":[{"a":1},{"b":2}]}')).userSafeSummary, /2건/);
});

// 실측(오너 라이브 2026-07-28, D): 노션 조회 승인 카드에 이렇게 떴다.
//   `인자 {"filter":{"operator":"and","filters":[{"property":"created_time",…}]}}`
// 비개발자가 읽고 무엇을 허락하는지 판단할 방법이 없다. 그런데 이게 **밖으로 나가는 값**이라
// 가장 봐야 할 자리다 — 쓰기 도구면 여기에 실제로 적힐 내용이 실린다.
// 값을 바꾸거나 모델에게 다시 쓰게 하지 않는다(카드와 실제가 갈라진다). 모양만 바꾼다.
test('MCP 승인 카드는 나가는 값을 사람이 읽을 모양으로 보여준다', async () => {
  const { 읽는인자 } = await import('../src/runtime/tool-admission.js');
  const schema = {
    type: 'object',
    properties: { query: { type: 'string', title: '검색어' }, page_size: { type: 'number' } },
  };
  const 줄 = 읽는인자({ query: '회의', page_size: 10, filters: { created_date_range: { start_date: '2026-07-27' } } }, schema);
  assert.ok(!/[{}[\]"]/.test(줄), `아직 기계 말이다: ${줄}`);
  assert.match(줄, /검색어: 회의/, '스키마가 준 이름을 안 쓴다');
  assert.match(줄, /page_size: 10/, '이름이 없으면 키 그대로 쓴다');
  assert.match(줄, /created_date_range/, '무엇이 나가는지가 사라지면 안 된다');

  // 긴 값은 접되 접었다고 말한다 — 승인한 것과 실제가 갈라지지 않게
  const 긴것 = 읽는인자({ body: 'ㄱ'.repeat(500) }, {});
  assert.ok(긴것.length < 300);
  assert.match(긴것, /…/);

  assert.equal(읽는인자({}, {}), undefined, '빈 인자에 빈 줄을 만들지 않는다');
});

test('MCP 카드가 나가는 값을 "무엇을" 자리에 싣는다', async () => {
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  admitMcpTools({
    server: 'notion', connector: 'notion', connectorLabel: '노션',
    tools: [{
      name: 'search', title: 'Search', description: '찾는다',
      inputSchema: { type: 'object', properties: { query: { type: 'string', title: '검색어' } } },
    }],
    session: { callTool: async () => ({ content: [] }) },
  }, ctx);
  const p = Object.values(ctx.tools.tools)[0].previewOf({ query: '회의' });
  assert.match(p.what, /검색어: 회의/);
  assert.ok(!/[{}]/.test(`${p.impact} ${p.scope} ${p.what}`), '카드에 기계 말이 남았다');
});

// ── 병합 검토(오너, 2026-07-28)가 요구한 네 계약 ──────────────────────────
//
// ① **동적 선언의 진실 원천.** 붙일 수 있는 이름 목록은 부팅 시점의 사진이라 금세 낡는다.
// 판단은 매 호출 시점의 커넥터 배열이 해야 한다 — 선언 직후 **재시작 없이** 붙어야 한다.
test('선언한 서비스는 재시작 없이 그 자리에서 연결 대상이 된다', async () => {
  const { makeConnectorConnectTool, findConnector } = await import('../src/runtime/connector-connect.js');
  const connectors = [];
  const connect = makeConnectorConnectTool({ connectors: () => connectors });

  // 선언 전에는 없다 — 없는 연결을 승인으로 보내지 않는다
  assert.equal(findConnector(connectors, '어떤상점'), undefined);
  assert.equal((await connect.approvalEligibility({ connector: '어떤상점' })).allowed, false);

  await makeConnectorDeclareTool({ connectors: () => connectors }).handler(선언());

  // 선언 직후, 같은 프로세스에서 바로 찾을 수 있어야 한다(부팅 목록에 없어도)
  assert.ok(findConnector(connectors, '어떤상점'), '선언했는데 그 자리에서 못 찾는다');
  assert.equal((await connect.approvalEligibility({ connector: '어떤상점' })).allowed, true,
    '선언했는데 승인으로 못 간다 — 부팅 시점 목록에 갇혔다');
});

// ② **`declared` 는 잘린 후보 목록이 아니라 커넥터 원장에서 센다.**
// 후보는 다섯 개로 자르는 보여주기 목록이고, 선언 여부는 "비밀 입력면을 열 수 있나"를 정하는
// 사실이다. 후보에서 세면 다른 단서가 다섯 칸을 먼저 채웠을 때 붙일 수 있는 서비스인데도
// `declared:false` 가 나가고, T5 는 붙일 수 있는 것을 못 붙인다고 말한다.
test('다른 단서가 후보 칸을 다 채워도 선언 여부는 정확하다', async () => {
  const { makeLocalDiscoveryTool } = await import('../src/runtime/local-discovery.js');
  const tool = makeLocalDiscoveryTool({
    mcpNames: async () => ['카페24하나', '카페24둘', '카페24셋', '카페24넷', '카페24다섯', '카페24여섯'].map((n) => ({ name: n })),
    pathDirs: [], appDirs: [], syncDirs: [], settingsDirs: [], fileRoots: [],
    connectors: () => [{ id: 'cafe24', label: '카페24', connected: true }],
  });
  const r = await tool.handler({ subject: '카페24' });
  assert.equal(r.connectionDiscovery.candidates.length, 5, '보여주기 목록은 잘린다');
  assert.equal(r.connectionDiscovery.declared, true, '잘린 목록에서 세는 바람에 사실이 뒤집혔다');
});

// ③ **붙이는 일과 끊는 일은 조건이 다르다.** 둘 다 "실행 가능한 인증 방식"을 요구하면,
// 인증 방식이 사라지거나 만료된 서비스를 사용자가 끊지도 못한다 — 붙은 것은 계정에 닿아
// 있는데 T5 가 손을 뗄 방법을 막는 셈이다. 정리는 언제나 열려 있어야 한다.
test('만료된 연결도 끊을 수 있다 — 붙이는 조건으로 끊기를 막지 않는다', async () => {
  const { makeConnectorConnectTool } = await import('../src/runtime/connector-connect.js');
  const 붙어있음 = makeConnectorConnectTool({
    connectors: () => [{ id: 'svc', label: '어떤서비스', connected: true, authMethods: [] }],
  });
  assert.equal((await 붙어있음.approvalEligibility({ connector: '어떤서비스', action: 'disconnect' })).allowed, true);
  assert.equal((await 붙어있음.approvalEligibility({ connector: '어떤서비스' })).allowed, false,
    '연결은 여전히 실행 가능한 방식을 요구한다');

  // 자격만 남아 있어도(재시작 뒤 connected:false) 정리는 열려 있다
  const 자격만 = makeConnectorConnectTool({
    connectors: () => [{ id: 'svc', label: '어떤서비스', connected: false, authMethods: [] }],
    credentialStore: { get: async () => ({ kind: 'api_key' }) },
  });
  assert.equal((await 자격만.approvalEligibility({ connector: '어떤서비스', action: 'disconnect' })).allowed, true);

  // 정말 아무것도 없으면 정직하게 "연결돼 있지 않아요"
  const 없음 = makeConnectorConnectTool({
    connectors: () => [{ id: 'svc', label: '어떤서비스', connected: false, authMethods: [] }],
  });
  const r = await 없음.approvalEligibility({ connector: '어떤서비스', action: 'disconnect' });
  assert.equal(r.allowed, false);
  assert.match(r.userSafeSummary, /연결돼 있지 않아요/);
  assert.ok(!/승인받아 만들지는/.test(r.userSafeSummary), '끊기인데 붙이기 문구를 쓴다');
});

// ④ **실패해도 정확히 한 번.** 모델이 도구를 돌린 뒤에 죽으면, 이미 한 일(영수증)은 남아야
// 하고 두 번 남으면 안 된다. 원장이 두 번 세면 사용자는 안 한 일을 했다고 듣고, 다음 턴은
// 그 위에서 판단한다(나비: 원장은 다음 턴의 입력이다). 하나도 안 남아도 같은 크기의 거짓이다.
test('도구 실행 뒤 모델이 죽어도 영수증은 정확히 한 번 남는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');

  let 돌았나 = false;
  const ledger = new TruthLedger();
  const tools = demoTools({});
  tools.tools['web.collect'] = {
    async handler() { 돌았나 = true; return { result: { ok: true }, userSafeSummary: '읽었어요' }; },
  };
  const ctx = {
    env: demoEnv(), tools, ledger,
    // 도구를 한 번 고르고, 그것이 **실제로 돈 뒤** 다음 호출에서 죽는다
    model: { async respond(_tc, opts = {}) {
      if (돌았나) throw new Error('model exploded');
      if (opts.tools?.length) return { text: '', toolCalls: [{ name: 'web.collect', args: { request: '확인' } }] };
      return '';
    } },
  };

  await runTurn({ text: '이 페이지 좀 봐줘' }, ctx).catch(() => {});
  assert.equal(돌았나, true, '시험 자체가 성립하지 않았다 — 도구가 안 돌았다');
  const 웹영수증 = ledger.entries.filter((e) => e.actualCall?.tool === 'web.collect');
  assert.equal(웹영수증.length, 1, `영수증이 ${웹영수증.length}번 — 한 일은 한 번만, 그리고 반드시 남는다`);
  assert.equal(웹영수증[0].failureState, 'none', '성공한 일이 실패로 뒤집혔다');
});

// 실측(오너 라이브 2026-07-28, 병합 검증): 승인 카드가 `"연결 끊어줘"라고 하시면 지워요` 라고
// 약속했는데, 재시작 뒤에는 선언만 살아나고 세션은 없어서 "연결돼 있지 않아요"로 끝났다.
// 사용자가 올린 서비스를 **되돌릴 방법이 없었다** — 오늘 여섯 번째 못 지킬 약속이다.
// 소스 선언은 우리 것이라 남기고, 사용자가 올린 것만 걷는다.
test('올린 서비스는 "연결 끊어줘"로 실제로 지워진다 — 붙어 있지 않아도', async () => {
  const { makeConnectorConnectTool } = await import('../src/runtime/connector-connect.js');
  const connectors = [{ id: 'd-x', label: '올린서비스', declared: true, connected: false, authMethods: [{ kind: 'mcp', url: 'https://mcp.example.com/mcp' }] }];
  const 지운것 = [];
  const connect = makeConnectorConnectTool({
    ctx: () => ({ tools: { tools: {} }, descriptors: [], env: { connections: [] } }),
    connectors: () => connectors,
    declaredStore: { remove: async (id) => { 지운것.push(id); } },
  });

  assert.equal((await connect.approvalEligibility({ connector: '올린서비스', action: 'disconnect' })).allowed, true,
    '올린 서비스를 끊을 수 없으면 영영 못 지운다');
  const r = await connect.handler({ connector: '올린서비스', action: 'disconnect' });
  assert.deepEqual(지운것, ['d-x'], '선언이 저장소에 남았다');
  assert.equal(connectors.length, 0, '선언이 이번 실행의 커넥터 목록에 남았다');
  assert.match(r.userSafeSummary, /지웠어요/);
});

test('소스에 선언된 서비스는 끊어도 목록에서 사라지지 않는다', async () => {
  const { makeConnectorConnectTool } = await import('../src/runtime/connector-connect.js');
  const connectors = [{ id: 'notion', label: '노션', connected: true, authMethods: [{ kind: 'mcp', url: 'https://mcp.notion.com/mcp' }] }];
  const connect = makeConnectorConnectTool({
    ctx: () => ({ tools: { tools: {} }, descriptors: [], env: { connections: [] } }),
    connectors: () => connectors,
    declaredStore: { remove: async () => { throw new Error('소스 선언을 지우면 안 된다'); } },
  });
  const r = await connect.handler({ connector: '노션', action: 'disconnect' });
  assert.equal(connectors.length, 1, '소스 선언이 사라졌다 — 다시 붙일 자리가 없어진다');
  assert.ok(!/지웠어요/.test(r.userSafeSummary));
});

// ── 운영 현실 갱신 (G-1A) ────────────────────────────────────────────────
//
// 실측(오너 라이브 2026-07-28): `컨텍스트세븐에서 리액트 훅 문서 찾아줘. MCP 주소는 …`
// T5 는 선언·연결까지 정확히 해냈고(손 2개 편입) **그 손을 쓰지 않고 web.collect 로 답했다.**
// 모델이 익숙한 손을 고른 게 아니라 — **새 손이 모델에게 보이지 않았다.**
// `selfState` 는 턴 시작 때 한 번 만든 사진인데 편입은 레지스트리를 제자리에서 갱신한다.
//
// 개수 비교로 막지 않는다: **교체를 놓친다.** 아래 넷이 그 이유다.
const 편입 = (ctx, connector, label, name, 답, 계약) => {
  const { admitMcpTools } = ctx.__admit;
  admitMcpTools({
    server: undefined, connector, connectorLabel: label,
    tools: [{
      name,
      description: 계약?.description ?? '묻는다',
      inputSchema: 계약?.inputSchema ?? { type: 'object', properties: {} },
    }],
    session: { callTool: async () => ({ content: [{ type: 'text', text: 답 ?? label }] }) },
  }, ctx);
};

async function 현실틀() {
  const [{ buildSelfState }, { toolSchemasFor }, { demoEnv, demoTools }, { admitMcpTools }, { revokeAdmitted }] =
    await Promise.all([
      import('../src/kernel/l0-evidence/self-state.js'),
      import('../src/kernel/l2-plan/tool-schema.js'),
      import('../src/surface/demo-context.js'),
      import('../src/runtime/tool-admission.js'),
      import('../src/runtime/tool-admission.js'),
    ]);
  const env = demoEnv();
  const tools = demoTools({});
  const ctx = { tools, descriptors: [], env, __admit: { admitMcpTools } };
  const 손이름들 = () => toolSchemasFor(buildSelfState(env, { tools }))
    .map((t) => t.name ?? t.function?.name);
  return { ctx, 손이름들, revokeAdmitted };
}

test('현실 갱신 ① 손 하나가 늘면 모델 목록에 나타난다', async () => {
  const { ctx, 손이름들 } = await 현실틀();
  const 전 = 손이름들();
  편입(ctx, 'd-a', '가서비스', 'ask');
  const 후 = 손이름들();
  assert.equal(후.length, 전.length + 1);
  assert.ok(후.some((n) => String(n).includes('d-a')), `새 손이 안 보인다: ${후.join(', ')}`);
});

test('현실 갱신 ② 손 하나가 내려가면 모델 목록에서 사라진다', async () => {
  const { ctx, 손이름들, revokeAdmitted } = await 현실틀();
  편입(ctx, 'd-a', '가서비스', 'ask');
  const id = 손이름들().find((n) => String(n).includes('d-a'));
  assert.ok(id, '시험이 성립하지 않았다');
  revokeAdmitted([id], ctx);
  assert.ok(!손이름들().some((n) => String(n).includes('d-a')), '내린 손이 아직 보인다');
});

test('현실 갱신 ③ 하나 내리고 하나 올리면 — 개수는 같지만 목록은 달라야 한다', async () => {
  const { ctx, 손이름들, revokeAdmitted } = await 현실틀();
  편입(ctx, 'd-a', '가서비스', 'ask');
  const 개수전 = 손이름들().length;
  const 가id = 손이름들().find((n) => String(n).includes('d-a'));
  revokeAdmitted([가id], ctx);
  편입(ctx, 'd-b', '나서비스', 'ask');
  const 후 = 손이름들();
  assert.equal(후.length, 개수전, '이 시험의 전제 — 개수는 같다');
  assert.ok(!후.some((n) => String(n).includes('d-a')), '내린 손이 남았다');
  assert.ok(후.some((n) => String(n).includes('d-b')), '올린 손이 안 보인다 — 개수 비교로는 못 잡는 자리다');
});

test('현실 갱신 ④ 같은 id 로 세션도 스키마도 갈리면 둘 다 새 것이 쓰인다', async () => {
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { toolSchemasFor } = await import('../src/kernel/l2-plan/tool-schema.js');
  const { ctx, 손이름들 } = await 현실틀();
  const 모델스키마 = (id) => toolSchemasFor(buildSelfState(ctx.env, { tools: ctx.tools }))
    .find((t) => (t.name ?? t.function?.name) === id);

  편입(ctx, 'd-a', '가서비스', 'ask', '옛 세션',
    { description: '옛 설명', inputSchema: { type: 'object', properties: { 옛칸: { type: 'string' } } } });
  const id = 손이름들().find((n) => String(n).includes('d-a'));
  assert.match(JSON.stringify(모델스키마(id)), /옛칸/, '첫 계약이 모델 입력에 없다');

  // 같은 id 로 재연결 — 세션도 스키마도 갈린다(재인증·서버 업데이트에서 실제로 일어난다)
  편입(ctx, 'd-a', '가서비스', 'ask', '새 세션',
    { description: '새 설명', inputSchema: { type: 'object', properties: { 새칸: { type: 'number' } } } });

  assert.equal(손이름들().filter((n) => n === id).length, 1, '같은 손이 두 번 실린다');
  const r = await ctx.tools.tools[id].handler({});
  assert.match(r.userSafeSummary, /새 세션/, '옛 세션이 그대로 남아 있다 — 재연결이 반영 안 됐다');

  // **스키마까지 갈려야 한다.** 옛 칸이 남아 있으면 모델은 없는 인자를 계속 보낸다.
  const 지금 = JSON.stringify(모델스키마(id));
  assert.match(지금, /새칸/, '바뀐 스키마가 모델 입력에 없다');
  assert.ok(!/옛칸/.test(지금), `옛 스키마가 남아 있다: ${지금}`);
  assert.match(지금, /새 설명/, '바뀐 설명이 모델 입력에 없다');
});

// 관통 검사 — 노출까지만 보지 않는다. 실제로 골라 실행되고, 영수증이 정확히 한 번인지까지.
test('현실 갱신 ⑤ 기존 손 실행 → 새 손 편입 → 같은 턴에 새 손 실행 → 영수증 각 1건', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');

  const env = demoEnv();
  const tools = demoTools({});
  const ledger = new TruthLedger();
  const ctx = { env, tools, ledger, descriptors: [] };

  let 붙였나 = false;
  tools.tools['web.collect'] = {
    async handler() {
      붙였나 = true;
      admitMcpTools({
        server: undefined, connector: 'd-new', connectorLabel: '새서비스',
        tools: [{ name: 'ask', description: '묻는다', inputSchema: { type: 'object', properties: {} } }],
        session: { callTool: async () => ({ content: [{ type: 'text', text: '새 손이 답했다' }] }) },
      }, { tools, descriptors: ctx.descriptors, env });
      return { result: { ok: true }, userSafeSummary: '붙였어요' };
    },
  };

  let 마지막목록 = [];
  ctx.model = { async respond(_tc, opts = {}) {
    const 이름들 = (opts.tools ?? []).map((t) => t.name ?? t.function?.name);
    if (이름들.length) 마지막목록 = 이름들;
    if (!붙였나 && 이름들.length) return { text: '', toolCalls: [{ name: 'web.collect', args: { request: 'x' } }] };
    const 새손 = 이름들.find((n) => String(n).includes('d-new'));
    if (새손) return { text: '', toolCalls: [{ name: 새손, args: {} }] };
    return '';
  } };

  const r1 = await runTurn({ text: '붙이고 나서 그걸로 해줘' }, ctx).catch(() => ({}));
  assert.equal(붙였나, true, '시험이 성립하지 않았다 — 편입이 안 일어났다');
  assert.ok(마지막목록.some((n) => String(n).includes('d-new')),
    `편입 뒤에도 모델이 새 손을 못 본다: ${마지막목록.join(', ')}`);

  // 새 손은 승인 경계다(MCP 는 종류를 안 주므로 "모르면 승인"). 카드가 **그 손**을 가리키는지
  // 보고, 승인 뒤에 실제로 도는지까지 본다 — 노출까지만 보면 절반이다.
  assert.equal(r1.kind, 'approval', `새 손이 승인 없이 지나갔거나 안 골라졌다: ${r1.kind}`);
  assert.ok((r1.pending ?? []).some((p) => String(p.action).includes('d-new')),
    '승인 카드가 새 손을 가리키지 않는다');
  await runTurn({ approve: r1.pendingId }, ctx).catch(() => {});

  const 영수증 = ledger.entries.map((e) => e.actualCall?.tool);
  const 새손영수증 = 영수증.filter((t) => String(t).includes('d-new'));
  assert.equal(새손영수증.length, 1, `새 손 영수증이 ${새손영수증.length}건 — 실행됐고 한 번만이어야 한다`);
  assert.equal(영수증.filter((t) => t === 'web.collect').length, 1, '기존 손이 중복 실행됐다');
});

// 오너 검토(2026-07-28): `있는손` 목록이 한 번만 만들어져, 뒤 걸음에서 손이 늘거나 줄어도
// **복구 안내가 옛 목록으로 말한다.** 단일 현실 갱신을 끝까지 적용하는 문제다.
//
// 왜 사용자에게 중요한가: `다음길` 은 **다른 손이 하나라도 있으면** "직접 옮겨 주세요" 같은
// 시키는 문장을 다음 길로 쓰지 않는다(한 도구의 한계를 T5 전체의 한계로 말하지 않는다).
// 손 목록이 낡으면, 방금 붙인 손을 두고도 사용자에게 일을 시킨다.
test('복구 안내도 지금 손을 본다 — 손이 늘면 사용자를 시키지 않는다', async () => {
  const { 다음길 } = await import('../src/kernel/turn.js');
  const 막힌영수증 = [{
    actualCall: { tool: 'local.file', args: {} },
    failureState: 'blocked',
    userSafeSummary: '그 파일은 제가 다루는 폴더 밖이에요.',
    nextSafeAction: '그 폴더로 옮겨 주세요.',
  }];

  // 막힌 손 하나뿐 — 도구가 남긴 말이 그대로 다음 길이 된다
  const 손없을때 = 다음길(막힌영수증, ['local.file']);
  assert.match(손없을때, /옮겨/, '이 시험의 전제가 깨졌다');

  // 손이 하나 늘면 — 사용자를 시키는 문장은 다음 길이 될 수 없다
  const 손생겼을때 = 다음길(막힌영수증, ['local.file', 'mcp.d-new.ask']);
  assert.ok(!/옮겨 주세요/.test(손생겼을때),
    `손이 늘었는데도 사용자에게 시킨다: ${손생겼을때}`);
});

// 위 검사는 `다음길` 계약만 본다 — 턴 안에서 목록이 낡는 것은 못 잡는다. 관통으로 확인한다.
// 손이 **하나뿐인** 자리에서만 낡음이 드러난다(다른 손이 이미 많으면 경계가 어차피 걸린다).
test('턴 안에서 손이 늘면 그 턴의 복구 안내도 따라 바뀐다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { demoEnv, demoTools } = await import('../src/surface/demo-context.js');
  const { admitMcpTools } = await import('../src/runtime/tool-admission.js');

  const 돌려보기 = async (손을붙일까) => {
    // 손이 **그것 하나뿐인** 자리를 만든다 — 다른 손이 많으면 경계가 어차피 걸려 낡음이 안 드러난다.
    const env = demoEnv({ include: ['local.file'], hands: ['local.file'] });
    const tools = demoTools({});
    const ctx = { env, tools, ledger: new TruthLedger(), descriptors: [] };
    let 돌았나 = false;
    Object.assign(tools.tools, {
      'local.file': {
        async handler() {
          돌았나 = true;
          if (손을붙일까) {
            admitMcpTools({
              server: undefined, connector: 'd-new', connectorLabel: '새서비스',
              tools: [{ name: 'ask', description: '묻는다', inputSchema: { type: 'object', properties: {} } }],
              session: { callTool: async () => ({ content: [] }) },
            }, { tools, descriptors: ctx.descriptors, env });
          }
          return {
            blocked: true,
            userSafeSummary: '그 파일은 제가 다루는 폴더 밖이에요.',
            nextSafeAction: '그 폴더로 옮겨 주세요.',
          };
        },
      },
    });
    ctx.model = { async respond(_tc, opts = {}) {
      if (!돌았나 && opts.tools?.length) {
        return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: 'x' } }] };
      }
      return '';
    } };
    return runTurn({ text: '그 파일 좀 봐줘' }, ctx).catch(() => ({}));
  };

  // 손이 그것 하나뿐이면 — 도구가 남긴 말이 그대로 다음 길이다(다른 길이 정말 없다)
  const 안붙였을때 = await 돌려보기(false);
  assert.match(String(안붙였을때.nextSafeAction ?? ''), /옮겨/, '이 시험의 전제가 깨졌다');

  // 같은 턴에 손이 하나 늘면 — 그 턴의 안내부터 사용자를 시키지 않는다
  const 붙였을때 = await 돌려보기(true);
  assert.ok(!/옮겨 주세요/.test(String(붙였을때.nextSafeAction ?? '')),
    `손이 늘었는데 그 턴의 안내가 아직 사용자를 시킨다: ${붙였을때.nextSafeAction}`);
});

// 실측(오너 라이브 2026-07-28, G-1B): 승인하지 않고 서버를 재시작한 뒤 `아까 하던 거 이어줘`
// 라고 했더니 T5 는 원래 업무를 정확히 이어받았지만 **새 승인 카드를 하나 더** 만들었다.
// 화면에 같은 일을 묻는 카드가 둘 남았고, 둘 다 누르자 그 행동이 **두 번** 실행됐다.
// 이번엔 선언이 같은 id 를 덮어써서 피해가 없었지만, 전송·생성이면 그대로 두 번 나간다.
test('한 대화에 살아 있는 승인 요청은 하나다 — 이어달라고 해도 둘이 되지 않는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');

  const 보낸것 = [];
  const ctx = {
    env: {
      model: { id: 'x', authSignal: 'ok' },
      connections: [{ id: 'mail.send', label: '메일 발송', connected: true, executable: true }],
    },
    tools: new ToolRunner({ 'mail.send': { async handler(a) { 보낸것.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
    ledger: new TruthLedger(),
    model: new (await import('../src/runtime/model-client.js')).StubModelClient(),
  };

  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  assert.equal(r1.kind, 'approval');
  // 승인하지 않고 다시 부탁한다(중단·재개에서 실제로 일어나는 일)
  const r2 = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  assert.equal(r2.kind, 'approval');

  assert.equal(ctx.pending.size, 1, `대기가 ${ctx.pending.size}건 — 같은 일을 묻는 카드가 둘이면 두 번 실행된다`);

  // 옛 카드를 눌러도 다시 실행되지 않는다(죽은 버튼이 아니라 지난 요청으로 정직하게 답한다)
  const 옛것 = await runTurn({ approve: r1.pendingId }, ctx);
  assert.equal(보낸것.length, 0, '지난 승인으로 실제 발송이 일어났다');
  assert.match(옛것.reply, /찾지 못했어요/);

  // 살아 있는 카드는 정상 동작한다
  await runTurn({ approve: r2.pendingId }, ctx);
  assert.equal(보낸것.length, 1, '살아 있는 승인이 실행되지 않았다');
});

// ── G 잔여 행렬 (2026-07-29) ─────────────────────────────────────────────
//
// 실측(오너 라이브): `정산 파일 정리해줘` 에 런타임은 `5곳이 후보예요` 를 사실로 냈는데
// T5 는 말없이 하나를 골라 그 달 숫자로 답을 끝냈다. 다른 달 자료였다면 숫자가 통째로 틀린 채
// 끝난다.
//
// 원인은 모델 습관이 아니라 **런타임 투영끼리의 충돌**이었다(오너 감사). 같은 모델 입력에
// 두 사실이 함께 갔다: "후보는 5곳이다" · "지금 자리는 첫째이고 여기서 이어서 보면 된다".
// 첫 후보를 확정된 `place` 로 올렸기 때문이다.
//
// 여기서 "물어봐라"라고 시키지 않는다 — **아직 고르지 않았다는 사실**만 정확히 준다(§24).
test('여러 곳이면 아직 자리가 아니다 — 고른 척하지 않는다', async () => {
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const tool = makeLocalLocateTool();
  const s = tool.subjectOf({
    result: {
      candidates: [
        { path: '/a/2026-06 정산', confidence: 'high' },
        { path: '/a/2026-05 정산', confidence: 'medium' },
        { path: '/b/지난달 정산 파일', confidence: 'medium' },
      ],
    },
  });
  assert.equal(s.kind, 'place_candidates', '복수 후보를 확정된 자리로 올렸다');
  assert.ok(!s.detail.startsWith('/'), `detail 이 경로로 시작하면 "지금 자리" 로 승격된다: ${s.detail}`);
  assert.match(s.detail, /아직 고른 자리 없음/);
  assert.match(s.detail, /2026-05 정산/, '나머지 후보가 사라졌다');
  assert.equal(s.candidates.length, 3);

  // 하나뿐이면 예전처럼 자리다(없는 선택을 만들지 않는다)
  const 하나 = tool.subjectOf({ result: { candidates: [{ path: '/a/유일', confidence: 'high' }] } });
  assert.equal(하나.kind, 'place');
  assert.equal(하나.detail, '/a/유일');

  // 확신이 낮으면 여전히 자리라고 말하지 않는다(기존 계약 불변)
  assert.equal(tool.subjectOf({ result: { candidates: [{ path: '/a/흐릿', confidence: 'low' }] } }), null);
});

test('복수 후보는 모델 현실에서도 "지금 자리" 가 되지 않는다', async () => {
  const { workingStateFacts } = await import('../src/kernel/l0-evidence/working-state.js');
  const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
  const s = makeLocalLocateTool().subjectOf({
    result: { candidates: [{ path: '/a/하나', confidence: 'high' }, { path: '/b/둘', confidence: 'medium' }] },
  });
  const 글 = workingStateFacts({ turnNo: 1, subjects: [{ ...s, lastTurn: 1 }] }) ?? '';
  assert.ok(!/지금 자리:/.test(글), `아직 안 골랐는데 지금 자리로 말한다: ${글}`);
  assert.ok(!/여기서 이어서 보면 돼요/.test(글), `고른 척한다: ${글}`);
  assert.match(글, /아직 고르지 않음/);
  assert.match(글, /\/b\/둘/, '나머지 후보가 모델에게 안 간다');
});

// 실측(같은 행렬): 승인 대기 중 `아, 잠깐. 그건 됐고 지금 몇 시야?` 에 시간은 정확히 답했는데
// **이전 승인 카드가 그대로 살아 있었다.** 사용자는 그만두라고 했는데 누르면 실행되는 버튼이
// 남은 것이다. 예전에는 새 승인을 만들 때만 지난 것으로 바꿨기 때문이다.
test('새 발화는 이전 승인을 지난 것으로 만든다 — 승인 작업을 만들지 않는 발화라도', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');
  const { StubModelClient } = await import('../src/runtime/model-client.js');

  const 보낸것 = [];
  const ctx = {
    env: {
      model: { id: 'x', authSignal: 'ok' },
      connections: [{ id: 'mail.send', label: '메일 발송', connected: true, executable: true }],
    },
    tools: new ToolRunner({ 'mail.send': { async handler(a) { 보낸것.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
    ledger: new TruthLedger(),
    model: new StubModelClient(),
  };

  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  assert.equal(r1.kind, 'approval');

  // 승인 작업을 만들지 않는 무관한 발화
  const r2 = await runTurn({ text: '아, 잠깐. 그건 됐고 지금 몇 시야?' }, ctx);
  assert.notEqual(r2.kind, 'approval');
  assert.equal(ctx.pending.size, 0, '새 발화 뒤에도 옛 승인이 살아 있다 — 누르면 실행된다');

  // 옛 id 로 승인해도 실행되지 않는다
  const 옛것 = await runTurn({ approve: r1.pendingId }, ctx);
  assert.equal(보낸것.length, 0, '지난 승인으로 실제 발송이 일어났다');
  assert.match(옛것.reply, /찾지 못했어요/);
});

// 오너 감사(2026-07-29): `취소 → 다시 해줘 → 새 승인` 은 **재요청** 시험이지
// **완료된 일을 되살리지 않는가** 시험이 아니다. 실제로 승인·완료한 뒤에 걸어야 한다.
test('완료된 일은 "아까 그거 이어줘" 로 다시 실행되지 않는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');
  const { StubModelClient } = await import('../src/runtime/model-client.js');

  const 보낸것 = [];
  const ctx = {
    env: {
      model: { id: 'x', authSignal: 'ok' },
      connections: [{ id: 'mail.send', label: '메일 발송', connected: true, executable: true }],
    },
    tools: new ToolRunner({ 'mail.send': { async handler(a) { 보낸것.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
    ledger: new TruthLedger(),
    model: new StubModelClient(),
  };

  // 승인하고 **실제로 완료**한다
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  assert.equal(r1.kind, 'approval');
  await runTurn({ approve: r1.pendingId }, ctx);
  assert.equal(보낸것.length, 1, '시험이 성립하지 않았다 — 완료되지 않았다');
  const 완료뒤영수증 = ctx.ledger.entries.length;

  // 그 뒤 "이어줘" — 끝난 일을 되살리면 안 된다
  await runTurn({ text: '아까 그거 이어줘.' }, ctx);
  assert.equal(보낸것.length, 1, `완료된 일이 다시 실행됐다(${보낸것.length}회)`);
  assert.equal(ctx.ledger.entries.length, 완료뒤영수증, '완료된 일로 영수증이 또 남았다');
  assert.equal(ctx.pending.size, 0, '끝난 일이 다시 승인 대기로 되살아났다');
});

// ── 완료 상태 (오너 감사 2026-07-29) ─────────────────────────────────────
//
// 실측: 저장까지 실제로 끝낸 뒤 `아까 그거 이어줘` 하자 같은 파일을 다시 쓰는 승인 카드가 떴다.
// T5 는 저장된 파일을 읽어 존재를 확인하고도 그랬다 — 현재 상태에 "방금 다룬 파일"은 있어도
// **"그 요청은 완료됨"이 없었기 때문**이다. activeGoal 은 새 발화로 덮여 오히려 "진행 중"처럼
// 말했다. 장기 학습층이 아니라 이 대화의 운용 상태라 `workingState` 에 얇게 둔다.
//
// 두 반대 방향을 **함께** 지킨다: 끝난 일은 되살아나지 않고, 정말 다시 하라면 막히지 않는다.
const 완료틀 = async () => {
  const [{ runTurn }, { TruthLedger }, { ToolRunner }, { StubModelClient }] = await Promise.all([
    import('../src/kernel/turn.js'),
    import('../src/kernel/l0-evidence/ledger.js'),
    import('../src/runtime/tool-runner.js'),
    import('../src/runtime/model-client.js'),
  ]);
  const 보낸것 = [];
  const ctx = {
    env: {
      model: { id: 'x', authSignal: 'ok' },
      connections: [{ id: 'mail.send', label: '메일 발송', connected: true, executable: true }],
    },
    tools: new ToolRunner({ 'mail.send': { async handler(a) { 보낸것.push(a); return { result: {}, userSafeSummary: '보냈어요' }; } } }),
    ledger: new TruthLedger(),
    model: new StubModelClient(),
  };
  const r1 = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  const done = await runTurn({ approve: r1.pendingId }, ctx);
  return { runTurn, ctx, 보낸것, done };
};

test('완료 ① 끝난 일은 완료로 남고 현재 목표는 해제된다', async () => {
  const { ctx, done, 보낸것 } = await 완료틀();
  assert.equal(보낸것.length, 1, '시험이 성립하지 않았다 — 완료되지 않았다');
  assert.equal(done.workingState?.recentOutcome?.status, 'completed', '끝났는데 완료로 안 남는다');
  assert.equal(done.goal, null, '끝난 목표가 현재 목표로 남아 다음 턴을 붙든다');
  assert.ok(ctx.pending.size === 0);
});

test('완료 ② 완료 사실이 모델 현실에 사람 말로 간다', async () => {
  const { workingStateFacts } = await import('../src/kernel/l0-evidence/working-state.js');
  const { done } = await 완료틀();
  const 글 = workingStateFacts(done.workingState) ?? '';
  assert.match(글, /최근 완료한 일/);
  assert.match(글, /이 초안 메일로 보내줘/);
  assert.match(글, /완료됨/);
});

test('완료 ③ 실패·차단된 작업은 완료로 기록되지 않는다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');
  const { StubModelClient } = await import('../src/runtime/model-client.js');
  const ctx = {
    env: { model: { id: 'x', authSignal: 'ok' }, connections: [{ id: 'web.collect', label: '웹 자료 수집', connected: true, executable: true }] },
    tools: new ToolRunner({ 'web.collect': { async handler() { return { blocked: true, userSafeSummary: '그 사이트가 접근을 막고 있어요.' }; } } }),
    ledger: new TruthLedger(), model: new StubModelClient(),
  };
  const r = await runTurn({ text: '이 페이지 조사해서 가져와줘' }, ctx);
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed', '막힌 일을 완료로 기록했다');
  assert.notEqual(r.goal, null, '막혔는데 목표를 해제했다 — 이어갈 자리를 잃는다');
});

test('완료 ④ 승인 대기 중에는 완료가 아니다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TruthLedger } = await import('../src/kernel/l0-evidence/ledger.js');
  const { ToolRunner } = await import('../src/runtime/tool-runner.js');
  const { StubModelClient } = await import('../src/runtime/model-client.js');
  const ctx = {
    env: { model: { id: 'x', authSignal: 'ok' }, connections: [{ id: 'mail.send', label: '메일 발송', connected: true, executable: true }] },
    tools: new ToolRunner({ 'mail.send': { async handler() { return { result: {} }; } } }),
    ledger: new TruthLedger(), model: new StubModelClient(),
  };
  const r = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);
  assert.equal(r.kind, 'approval');
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed');
});

test('완료 ⑤ 완료 뒤에도 명시적 재작업은 막히지 않는다', async () => {
  const { runTurn, ctx, 보낸것 } = await 완료틀();
  // 사용자가 정말 다시 하라고 하면 정당한 새 승인이 생겨야 한다(끝났다고 능력을 닫지 않는다)
  const r = await runTurn({ text: '이 초안 메일로 보내줘' }, ctx);   // 같은 일을 명시적으로 다시
  assert.equal(r.kind, 'approval', '정당한 재작업 요청이 막혔다 — 능력 축소다');
  await runTurn({ approve: r.pendingId }, ctx);
  assert.equal(보낸것.length, 2, '승인했는데 실행되지 않았다');
});

test('완료 ⑥ 완료 사실은 오래 붙들지 않는다(감쇠)', async () => {
  const { deriveWorkingState } = await import('../src/kernel/l0-evidence/working-state.js');
  let ws = { turnNo: 1, subjects: [], recentOutcome: { status: 'completed', request: '옛 일', completedTurn: 1 } };
  for (let i = 0; i < 40; i += 1) ws = deriveWorkingState(ws, { receipts: [] });
  assert.equal(ws.recentOutcome, undefined, '오래된 완료가 계속 남아 다음 요청을 붙든다');
});

// 오너 감사(2026-07-29): 완료 판정에 `멈춘이유` 가 빠져 있었다. 일부 도구가 성공했어도
// **중단한 것은 끝난 것이 아니다** — 다음 턴이 이어갈 자리를 잃는다.
// 런타임은 왜 멈췄는지 이미 안다. 그 사실을 판정에 잇기만 한다(새 엔진이 아니다).
const 중단틀 = async (도구수) => {
  const [{ runTurn }, { TruthLedger }, { demoEnv, demoTools }] = await Promise.all([
    import('../src/kernel/turn.js'),
    import('../src/kernel/l0-evidence/ledger.js'),
    import('../src/surface/demo-context.js'),
  ]);
  const env = demoEnv({ include: ['web.collect'], hands: ['web.collect'] });
  const tools = demoTools({});
  let 부른횟수 = 0;
  tools.tools['web.collect'] = {
    async handler() { 부른횟수 += 1; return { result: { ok: true }, userSafeSummary: '읽었어요' }; },
  };
  const ctx = { env, tools, ledger: new TruthLedger(), descriptors: [] };
  ctx.model = { async respond(_tc, opts = {}) {
    // 도구를 계속 고른다 — 같은 인자면 되풀이 감지, 다른 인자면 상한에 닿는다
    if (opts.tools?.length) {
      return { text: '', toolCalls: [{ name: 'web.collect', args: { request: 도구수 === 'same' ? '같은 것' : `건 ${부른횟수}` } }] };
    }
    return '';
  } };
  return { r: await runTurn({ text: '이 페이지 조사해줘' }, ctx).catch(() => ({})), 부른횟수 };
};

test('중단 ① 같은 일을 되풀이해 멈추면 완료가 아니다', async () => {
  const { r } = await 중단틀('same');
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed', '중단한 일을 완료로 기록했다');
  assert.notEqual(r.goal, null, '중단했는데 목표를 해제했다 — 이어갈 자리를 잃는다');
});

test('중단 ② 도구 실행 상한에 닿아 멈추면 완료가 아니다', async () => {
  const { r, 부른횟수 } = await 중단틀('vary');
  assert.ok(부른횟수 > 1, '시험이 성립하지 않았다');
  assert.notEqual(r.workingState?.recentOutcome?.status, 'completed', '상한에 닿아 멈춘 일을 완료로 기록했다');
  assert.notEqual(r.goal, null);
});
