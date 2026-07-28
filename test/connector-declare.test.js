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

  const r = explainAuthority({ kind: 'connect_account', preview: tool.previewOf(선언()) });
  assert.equal(r.needsApproval, true, '승인이 풀리면 안 된다');
  assert.ok(!/보내는 일/.test(r.why), `없는 전송을 말했다: ${r.why}`);
  assert.match(r.why, /연결하는 일/);
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
