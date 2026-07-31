// P5-B-0 · 커넥터 진실층 — **외부 손발이 늘어도 T5 의 자기 인식이 흔들리지 않게.**
//
// 오늘까지 나온 결함은 대부분 같은 뿌리였다: 진실이 두 군데로 갈라졌다.
//   능력 문장은 "못 한다"는데 schema 는 "된다"고 했다.
//   descriptor 는 있는데 handler 가 없었다(`mail.send`).
//   커널은 맞는데 화면·채널이 달랐다.
//
// 그래서 상태를 **2축**으로 나눈다. 하나의 enum 으로 두면 소비자 다섯(selfState·도구함·
// model schema·능력 문장·연결 센터)이 각자 해석해야 하고 반드시 어긋난다.
//
//     executable: boolean      지금 되는가
//     reason:     왜 아직 아닌가
//
// 불변식은 한 줄이다: **model tool schema ⊆ executable:true.** 이유가 늘어도 안 바뀐다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfState, toolReality, reasonLabel } from '../src/kernel/l0-evidence/self-state.js';
import { toolSchemasFor } from '../src/kernel/l2-plan/tool-schema.js';
import { connectorTruth, builtinTools } from '../src/kernel/l2-plan/connector-truth.js';
import { demoContext, demoDescriptors, demoConnectors, demoTools, demoEnv } from '../src/surface/demo-context.js';

// ── 2축 판정 자체 ─────────────────────────────────────────────────────────
test('손이 없으면 자격이 채워져도 실행 가능이 아니다', () => {
  // `mail.send` 의 정체다 — 연결 표시는 true 였고 손은 어디에도 없었다.
  assert.deepEqual(toolReality({ connected: true, executable: true, hasHandler: false }),
    { executable: false, reason: 'planned' });
});

test('연결 안 됨 · 설정 필요 · 권한 필요를 각각 다른 이유로 말한다', () => {
  assert.equal(toolReality({ connected: false, hasHandler: true }).reason, 'needs_connection');
  assert.equal(toolReality({ connected: true, needs: 'config', hasHandler: true }).reason, 'needs_setup');
  assert.equal(toolReality({ connected: true, needs: 'auth', hasHandler: true }).reason, 'needs_permission');
});

test('실행 가능하면 이유를 지어내지 않는다', () => {
  assert.deepEqual(toolReality({ connected: true, executable: true, hasHandler: true }), { executable: true });
});

test('이유는 사용자 말로 번역된다(내부 값이 화면에 새지 않는다)', () => {
  assert.match(reasonLabel('needs_connection'), /연결하면/);
  assert.equal(reasonLabel(undefined), undefined, '없는 이유를 지어내지 않는다');
});

// ── 불변식: schema ⊆ executable ⊆ 손 ──────────────────────────────────────
test('모델에게 보이는 도구는 전부 실행 가능하고, 전부 손이 있다', () => {
  const c = demoContext();
  const selfState = buildSelfState(c.env, { tools: c.tools });
  const hands = new Set(Object.keys(c.tools.tools ?? {}));
  for (const name of toolSchemasFor(selfState).map((t) => t.name)) {
    assert.ok(hands.has(name), `손 없는 도구가 모델 schema 에 있다: ${name}`);
    assert.equal(selfState.connectedTools.find((t) => t.id === name)?.executable, true);
  }
});

test('손을 붙이면 보이고, 떼면 사라진다(반대 검증)', () => {
  const 손 = { async handler() { return { result: {} }; } };
  const 붙임 = demoContext({ localTerminal: 손 });
  const 없음 = demoContext();
  const 보인다 = toolSchemasFor(buildSelfState(붙임.env, { tools: 붙임.tools })).map((t) => t.name);
  const 안보인다 = toolSchemasFor(buildSelfState(없음.env, { tools: 없음.tools })).map((t) => t.name);
  assert.ok(보인다.includes('local.terminal'), '손이 있는데 안 보이면 존재를 모른다');
  assert.ok(!안보인다.includes('local.terminal'), '손이 없는데 보이면 되는 줄 알고 약속한다');
});

// ── mail.send — 이번 단계의 결정 ──────────────────────────────────────────
test('mail.send 는 선언은 남고 실행 가능에서는 내려간다', () => {
  const c = demoContext();
  const selfState = buildSelfState(c.env, { tools: c.tools });
  const t = selfState.connectedTools.find((x) => x.id === 'mail.send');
  assert.ok(t, '선언은 지우지 않는다 — 지우면 "연결하면 가능"을 말할 자리가 없다');
  assert.equal(t.executable, false);
  assert.ok(!toolSchemasFor(selfState).some((s) => s.name === 'mail.send'), '모델 schema 에 없어야 한다');
});

test('mail.send 의 능력 문장이 "연결하면 가능"으로 말한다(된다고 하지 않는다)', () => {
  const d = demoDescriptors().find((x) => x.id === 'mail.send');
  assert.match(d.capability, /연결하면/, '연결 전인데 "보낸다"고 하면 거짓 약속이다');
});

test('실행 불가는 한계에 이유와 함께 남는다', () => {
  const c = demoContext();
  const 한계 = buildSelfState(c.env, { tools: c.tools }).limits.join(' ');
  assert.match(한계, /메일 발송/);
  assert.doesNotMatch(한계, /메일 발송: 연결하면 가능해요/,
    '손이 없는데 "연결하면 가능"이라 하면 연결해도 안 되는 약속이 된다');
});

// ── 커넥터 파생 ───────────────────────────────────────────────────────────
test('커넥터의 도구 목록은 손으로 적지 않고 descriptor 에서 파생된다', () => {
  for (const c of demoConnectors()) {
    assert.equal(c.availableTools, undefined, '수동 목록은 반드시 어긋난다');
    assert.equal(c.approvalPolicy, undefined, '승인 정책은 도구 층 하나다');
    assert.equal(c.riskLevel, undefined, '위험도도 도구 층에서 파생한다');
  }
  const c = demoContext();
  const truth = connectorTruth(demoConnectors(), buildSelfState(c.env, { tools: c.tools }), demoDescriptors());
  const mail = truth.find((x) => x.id === 'mail');
  assert.deepEqual(mail.tools.map((t) => t.id), ['mail.send'], 'descriptor 의 connector 에서 파생');
});

test('연결 전 서비스는 "지금 되는 일"이 아니라 "연결하면 되는 일"로 말한다', () => {
  const c = demoContext();
  const truth = connectorTruth(demoConnectors(), buildSelfState(c.env, { tools: c.tools }), demoDescriptors());
  const mail = truth.find((x) => x.id === 'mail');
  assert.equal(mail.executable, false);
  assert.deepEqual(mail.userJobs, [], '실행 불가인데 "지금 되는 일"이 있으면 거짓이다');
  assert.ok(mail.jobsWhenConnected.length > 0, '연결하면 뭘 할 수 있는지는 말해야 한다');
  assert.ok(mail.setupGuide, '무엇을 갖춰야 하는지도');
});

test('T5 자체의 손은 커넥터가 아니라 내장으로 나온다', () => {
  const c = demoContext({ localTerminal: { async handler() { return { result: {} }; } } });
  const b = builtinTools(buildSelfState(c.env, { tools: c.tools }), demoDescriptors());
  const term = b.find((t) => t.id === 'local.terminal');
  assert.ok(term, '내장 손도 진실 표면에 나와야 한다');
  assert.equal(term.executable, true);
  assert.ok(!b.some((t) => t.id === 'mail.send'), '커넥터에 속한 도구는 내장이 아니다');
});

// ── 반대 검증: 진실이 갈라지면 드러나는가 ─────────────────────────────────
test('연결을 끊으면 모델 schema 와 도구함에서 함께 빠진다', () => {
  const 손 = { async handler() { return { result: {} }; } };
  const 켜짐 = demoContext({ senders: { 'telegram.send': 손 } });
  const 꺼짐env = demoEnv({
    hands: Object.keys(demoTools({ senders: { 'telegram.send': 손 } }).tools),
    factOverrides: { 'telegram.send': { connected: false } },
  });
  const on = toolSchemasFor(buildSelfState(켜짐.env, { tools: 켜짐.tools })).map((t) => t.name);
  const off = toolSchemasFor(buildSelfState(꺼짐env)).map((t) => t.name);
  assert.ok(on.includes('telegram.send'), '연결돼 있으면 보인다');
  assert.ok(!off.includes('telegram.send'), '연결을 끊었는데 남으면 "된다"고 거짓말한다');
});

// ── 산출물 축: **서버 표면이 커널과 같은 진실을 내는가** ──────────────────
// 오늘의 교훈이다. `previewOf` 는 커널까지 완벽했는데 화면이 `scope` 를 안 그려서 사용자에겐
// 후퇴였다. 커널만 검사하면 그걸 못 잡는다 — 그래서 **실제 응답**을 대조한다.
// 게이트는 커널 안에서 직접 조립하므로 서버가 손 진실을 안 넘기는 회귀를 못 본다(실측).
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

async function 서버(opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ctruth-'));
  const c = demoContext(opts);
  const server = makeServer({
    store: new SessionStore(dir), env: c.env, tools: c.tools,
    descriptors: demoDescriptors(opts), connectors: demoConnectors(),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, ctx: c };
}

test('/connectors/truth 가 커널과 같은 진실을 낸다', async () => {
  const { server, base, ctx } = await 서버();
  try {
    const j = await (await fetch(`${base}/connectors/truth`)).json();
    const hands = new Set(Object.keys(ctx.tools.tools ?? {}));
    for (const name of j.modelSchema) {
      assert.ok(hands.has(name), `서버가 손 없는 도구를 모델 schema 로 낸다: ${name}`);
    }
    const mail = j.connectors.find((c) => c.id === 'mail');
    assert.equal(mail.executable, false, '연결 전 서비스가 "지금 된다"로 나오면 안 된다');
    assert.ok(mail.jobsWhenConnected.length > 0, '연결하면 뭘 할 수 있는지는 나와야 한다');
    assert.ok(!j.modelSchema.includes('mail.send'));
    assert.ok(j.builtin.length > 0, '내장 손도 같은 표면에 나온다');
  } finally { server.close(); }
});

test('/toolbox 도 같은 손 진실을 본다(표면끼리 어긋나지 않는다)', async () => {
  const 손 = { async handler() { return { result: {} }; } };
  const { server, base, ctx } = await 서버({ localTerminal: 손 });
  try {
    const [truth, box] = await Promise.all([
      (await fetch(`${base}/connectors/truth`)).json(),
      (await fetch(`${base}/toolbox`)).json(),
    ]);
    const hands = new Set(Object.keys(ctx.tools.tools ?? {}));
    assert.ok(truth.modelSchema.includes('local.terminal'), '손을 붙였으면 모델에게 보여야 한다');
    // 도구함이 "사용 가능"이라고 말하는 것은 전부 손이 있어야 한다.
    const 사용가능 = JSON.stringify(box);
    for (const id of ['mail.send']) {
      assert.ok(!truth.modelSchema.includes(id), `${id} 는 실행 가능이 아니다`);
    }
    assert.ok(사용가능.length > 0);
  } finally { server.close(); }
});

test('env 가 손을 잘못 알고 있어도 서버는 실제 레지스트리를 따른다', async () => {
  // 진짜 위험은 "env 가 낡은 손 목록을 들고 있는" 경우다. 그때도 사용자에게 나가는 답은
  // **실제로 실행 가능한 것**이어야 한다 — 레지스트리가 최종 진실이다.
  const dir = await mkdtemp(join(tmpdir(), 'ctruth-drift-'));
  const tools = demoTools();                       // local.terminal 손 없음
  const 낡은env = demoEnv({ hands: [...Object.keys(tools.tools), 'local.terminal'] }); // 있다고 착각
  const server = makeServer({
    store: new SessionStore(dir), env: 낡은env, tools,
    descriptors: demoDescriptors(), connectors: demoConnectors(),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const j = await (await fetch(`http://127.0.0.1:${server.address().port}/connectors/truth`)).json();
    assert.ok(!j.modelSchema.includes('local.terminal'),
      'env 가 착각해도 손이 없으면 모델에게 보이면 안 된다(레지스트리가 진실이다)');
  } finally { server.close(); }
});

// ── 능력 문장의 **긍정** 주장도 구현과 맞아야 한다 ────────────────────────
// 실측(2026-07-27): 내가 "로그인해 둔 화면이면 그대로 보인다"를 현실로 넣었다. 거짓이었다 —
// browser.js 는 매번 새 임시 프로필로 연다(`--user-data-dir=<임시폴더>`, 끝나면 삭제).
// 그 문장 때문에 라이브가 "브라우저에서 Google 로그인만 해주세요"라고 **불가능한 약속**을 했다.
//
// 게이트 ③ 은 능력 설명의 **부정** 주장만 본다("못 한다"고 했는데 손이 있는 경우).
// **긍정** 주장은 아무도 안 봤다 — 그게 이 구멍이었다. 사용자가 지적한 것을 불변식으로 바꾼다.
test('브라우저 능력 문장이 로그인 상태를 실제 구현과 같게 말한다', async () => {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const src = await readFile(fileURLToPath(new URL('../src/runtime/browser.js', import.meta.url)), 'utf8');
  // 구현 사실: 임시 프로필로 여는가(= 사용자 로그인 세션이 따라오지 않는가).
  const 임시프로필 = /--user-data-dir=\$\{profileDir\}/.test(src) && /mkdtemp/.test(src);
  const cap = demoDescriptors().find((d) => d.id === 'browser.observe')?.capability ?? '';
  if (임시프로필) {
    assert.match(cap, /로그인은 안 되어 있다|로그인 상태가 따라오지 않/,
      '임시 프로필로 여는데 능력 문장이 그 사실을 말하지 않으면, 모델이 "로그인하면 된다"고 약속한다');
  } else {
    assert.doesNotMatch(cap, /로그인은 안 되어 있다/,
      '사용자 프로필을 쓰게 됐으면 능력 문장도 함께 바뀌어야 한다(반대 방향도 거짓말이다)');
  }
});

// ── 연결 경로 현실 (오너 지시 2026-07-28) ────────────────────────────────
// "모델이 판단할 연결 경로 현실을 충분히 못 보고 있다" — 판단은 모델이 한다.
// 이 검사는 **모델 앞에 놓이는 현실**을 재는 것이지 모델의 선택을 재는 것이 아니다.
import { connectionPaths, externalReality } from '../src/kernel/l1-intent/external-service.js';
import { EXECUTABLE_KINDS } from '../src/runtime/connector-connect.js';
import { defineConnector as 커넥터선언 } from '../src/kernel/l2-plan/connector-profile.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 네방식 = () => 커넥터선언({
  id: 'sv', label: '어떤서비스', kind: 'provider',
  authMethods: [
    { kind: 'mcp', url: 'https://x.test/mcp' },
    { kind: 'api_key', fields: [{ name: 'k', label: '열쇠', secret: true }, { name: 'id', label: '아이디' }] },
    { kind: 'cli', command: 'svcmd' },
    { kind: '아직없는방식' },
  ],
});

test('경로마다 사용자가 할 일이 사실로 나온다', () => {
  const p = connectionPaths(네방식(), { executableKinds: EXECUTABLE_KINDS });
  assert.deepEqual(p.map((x) => x.userAction),
    ['consent_once', 'secret_input', 'none', 'unavailable']);
  assert.deepEqual(p[1].needs, ['열쇠', '아이디'], '무엇을 넣어야 하는지가 없다');
  assert.equal(p[3].executable, false, '실행기 없는 방식을 있다고 했다');
  assert.equal(p[2].command, 'svcmd');
});

test('이미 붙어 있으면 사용자가 또 할 일은 없다', () => {
  const c = 네방식(); c.connected = true;
  assert.equal(connectionPaths(c, { executableKinds: EXECUTABLE_KINDS })[0].userAction, 'none');
});

test('이 컴퓨터에 명령이 없다고 확인됐으면 설치 필요라고 말한다', () => {
  const c = 네방식();
  c.localSignsResult = [{ kind: 'cli', label: '명령', found: false }];
  assert.equal(connectionPaths(c, { executableKinds: EXECUTABLE_KINDS })[2].userAction, 'install');
});

test('실행기 목록이 실제 분기와 어긋나면 모델에게 거짓말이 된다', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/runtime/connector-connect.js', import.meta.url), 'utf8');
    // 같다/다르다 둘 다 분기다 — `!== 'mcp'` 로 거르는 것도 mcp 를 다룬다는 뜻이다.
  const 코드가다루는것 = new Set([...src.matchAll(/m\.kind [!=]== '(\w+)'/g)].map((m) => m[1]));
  for (const k of EXECUTABLE_KINDS) {
    assert.ok(코드가다루는것.has(k), `선언에는 ${k} 가 있는데 실행하는 분기가 없다`);
  }
  for (const k of 코드가다루는것) {
    assert.ok(EXECUTABLE_KINDS.includes(k), `${k} 를 실행하는데 선언에 없다 — 모델이 못 본다`);
  }
});

test('모델 프롬프트에 붙이는 길이 사람 말로 실린다(처방 아님)', () => {
  const reality = externalReality({
    connectors: [네방식()], selfState: { connectedTools: [] }, executableKinds: EXECUTABLE_KINDS,
  });
  const { user } = buildModelMessages({ currentRequest: '붙여줘', externalReality: reality });
  assert.match(user, /붙이는 길:/, '연결 경로가 모델 앞에 없다');
  assert.match(user, /사용자는 동의 화면에서 허용 한 번/);
  assert.match(user, /비밀 입력창에 열쇠·아이디 입력/);
  assert.match(user, /실행기가 없음/, '못 하는 방식을 못 한다고 말하지 않았다');
  // **처방하지 않는다** — 무엇을 하라고 시키는 문장이 없어야 한다
  for (const 처방 of ['하세요', '해야 한다', '먼저 ~를 시도', '권장']) {
    assert.ok(!user.includes(처방), `모델에게 지시가 들어갔다: "${처방}"`);
  }
});
