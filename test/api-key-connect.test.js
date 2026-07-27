// P5-B-1B · API 키 연결 — "채팅창으로 키를 받으면 실패다"
//
// 오너 기준(2026-07-27): "사람을 개발자로 만들지 않는다는 건, 비밀값까지 대화창에
// 던지게 하지 않는다는 뜻이기도 해." 한국형 외부 도구(스마트스토어·카페24·카카오·
// 토스페이먼츠)는 OAuth 만큼 API 키류가 많아서, 여기가 무너지면 확장 전체가 무너진다.
//
// 불변식(문구 매칭 아님):
//   ① 대화 턴은 **값을 받지 않는다** — 입력창을 열어 달라는 요청까지만
//   ② 값은 결과·원장·화면 어디에도 없다. **마스킹조차 없다**(끝 4자리도 단서다)
//   ③ 저장했다고 연결이 아니다 — T5 가 직접 확인해야 연결이다
//   ④ 확인 실패면 값을 지운다. 안 되는 값을 들고 연결된 척하지 않는다
//   ⑤ 실패해도 값을 되읽어 주지 않는다 — 이유만 사람 말로
//   ⑥ 끊으면 값이 사라진다
//   ⑦ 서비스를 모른다 — 필요한 칸도 확인 방법도 커넥터 선언에서 온다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeConnectorConnectTool } from '../src/runtime/connector-connect.js';
import { ConnectorCredentialStore } from '../src/surface/connector-credential-store.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { verifyApiKey, secretFields, missingFields } from '../src/runtime/api-key.js';

const 비밀 = 'sk_LIVE_SECRET_9f3a2b1c';
const 아이디 = 'client_12345';

/** 지어낸 서비스 — 러너가 서비스 지식 없이 도는지 이걸로 본다(불변식 ⑦). */
function 커넥터() {
  return defineConnector({
    id: 'gagagg', label: '가가상점', kind: 'provider',
    userJobs: ['주문 내역을 가져와요'],
    authMethods: [{
      kind: 'api_key',
      fields: [
        { name: 'client_id', label: '클라이언트 ID', secret: false },
        { name: 'client_secret', label: '클라이언트 시크릿', secret: true },
      ],
      verify: {
        url: 'https://gaga.test/token', method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'client_id={client_id}&client_secret={client_secret}',
        okWhen: { status: 200 },
      },
    }],
  });
}

function 가짜서비스({ 맞는키 = 비밀, 죽음 = false } = {}) {
  const 기록 = { 호출: 0, 받은본문: [] };
  const fetchImpl = async (url, init = {}) => {
    기록.호출 += 1;
    기록.받은본문.push(String(init.body ?? ''));
    if (죽음) throw new Error('network');
    const p = new URLSearchParams(String(init.body ?? ''));
    const ok = p.get('client_secret') === 맞는키;
    return { status: ok ? 200 : 401, ok, json: async () => ({}), text: async () => '' };
  };
  return { fetchImpl, 기록 };
}

async function 손만들기(가짜, { dir, c } = {}) {
  const store = new ConnectorCredentialStore(dir ?? await mkdtemp(join(tmpdir(), 't5-key-')));
  const 커 = c ?? 커넥터();
  const ctx = { tools: { tools: {} }, descriptors: [], env: { connections: [] } };
  const tool = makeConnectorConnectTool({
    ctx: () => ctx, connectors: () => [커], credentialStore: store, fetchImpl: 가짜.fetchImpl,
  });
  return { tool, ctx, c: 커, store };
}

/** 값이 **어디에도** 없어야 한다. 문자열로 만들어 통째로 훑는다. */
function 값이샜나(무엇) {
  const s = JSON.stringify(무엇 ?? {});
  return s.includes(비밀) || s.includes(아이디)
    || /\*{2,}[0-9a-z]{2,}/i.test(s); // 마스킹도 금지 — 끝 네 자리는 단서다
}

test('대화 턴은 키를 받지 않는다 — 입력창을 열어 달라는 요청까지만', async () => {
  const 가짜 = 가짜서비스();
  const { tool, ctx } = await 손만들기(가짜);

  const r = await tool.handler({ connector: 'gagagg' });

  assert.ok(r.surfaceRequest, '입력창 요청이 없다 — 그러면 모델이 채팅으로 키를 달라고 하게 된다');
  assert.equal(r.surfaceRequest.kind, 'secret_input', '커널이 알아볼 종류가 없다');
  assert.equal(r.surfaceRequest.connector, 'gagagg');
  assert.deepEqual(r.surfaceRequest.fields.map((f) => f.name), ['client_id', 'client_secret']);
  assert.equal(r.surfaceRequest.fields[1].secret, true, '시크릿 칸이 가려지지 않는다');
  assert.equal(r.blocked, true, '아직 못 했는데 못 했다고 하지 않았다');
  assert.ok(r.nextSafeAction, '막다른 답으로 끝났다');
  assert.notEqual(r.result?.connected, true, '값도 없는데 연결됐다고 했다');
  assert.equal(가짜.기록.호출, 0, '값도 없이 서비스를 불렀다');
  assert.equal(Object.keys(ctx.tools.tools).length, 0);
  // 사람 말로, 그리고 **대화에 안 남는다는 사실**을 알려 준다
  assert.match(r.userSafeSummary, /대화에 남지 않/);
});

test('값은 비밀 통로로만 들어가고, 결과·원장 어디에도 남지 않는다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, store } = await 손만들기(가짜);

  const r = await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 비밀 });

  assert.equal(r.ok, true, `연결 실패: ${r.userSafeSummary}`);
  assert.equal(r.result.connected, true);
  assert.equal(r.result.verified, true, '확인했다는 사실이 원장에 없다');
  assert.deepEqual(r.result.filled, ['client_id', 'client_secret'], '무엇을 채웠는지가 없다');
  assert.ok(!값이샜나(r), '결과에 값이 남았다(마스킹 포함 금지)');

  // 화면·원장에 보여주는 형태에도 없다
  const 보여줄것 = await store.describe();
  assert.equal(보여줄것.gagagg.connected, true);
  assert.deepEqual(보여줄것.gagagg.filled, ['client_id', 'client_secret']);
  assert.ok(보여줄것.gagagg.verifiedAt > 0, '언제 확인됐는지가 없다');
  assert.ok(!값이샜나(보여줄것), 'describe 가 값을 흘렸다');
});

test('저장했다고 연결이 아니다 — T5 가 직접 확인한다', async () => {
  const 가짜 = 가짜서비스();
  const { tool } = await 손만들기(가짜);
  await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 비밀 });
  assert.equal(가짜.기록.호출, 1, '저장만 하고 확인을 안 했다');
  assert.ok(가짜.기록.받은본문[0].includes(비밀), '선언한 방법대로 부르지 않았다');
});

test('틀린 값이면 연결이 아니고, 저장해 둔 값도 지운다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, c, store } = await 손만들기(가짜);

  const r = await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 'sk_WRONG' });

  assert.notEqual(r.ok, true);
  assert.equal(c.connected, false, '확인 실패인데 연결됐다고 했다');
  assert.equal(await store.get('gagagg'), null, '안 되는 값을 그대로 들고 있다');
  assert.ok(!값이샜나(r), '실패 응답에 값이 되비쳤다');
  assert.ok(r.nextSafeAction, '막다른 답으로 끝났다');
});

test('서비스에 못 닿은 것과 값이 틀린 것을 섞지 않는다', async () => {
  const { tool } = await 손만들기(가짜서비스({ 죽음: true }));
  const r = await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 비밀 });
  assert.notEqual(r.ok, true);
  assert.match(r.userSafeSummary, /닿지 못했/, '네트워크 실패를 키 오류로 말하면 사용자가 헤맨다');
});

test('선언되지 않은 칸은 받지 않는다 — 저장소가 남의 값을 담는 통이 되지 않는다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, store } = await 손만들기(가짜);
  await tool.submitSecret('gagagg', {
    client_id: 아이디, client_secret: 비밀, 몰래: 'ANOTHER_SECRET_ZZZ',
  });
  const 저장 = await store.get('gagagg');
  assert.deepEqual(Object.keys(저장.values), ['client_id', 'client_secret']);
  assert.ok(!JSON.stringify(저장).includes('ANOTHER_SECRET_ZZZ'));
});

test('칸이 덜 찼으면 무엇이 비었는지만 말한다', async () => {
  const { tool, store } = await 손만들기(가짜서비스());
  const r = await tool.submitSecret('gagagg', { client_id: 아이디 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['client_secret']);
  assert.equal(await store.get('gagagg'), null, '반쪽 값을 저장했다');
});

test('끊으면 값이 사라진다', async () => {
  const 가짜 = 가짜서비스();
  const { tool, store } = await 손만들기(가짜);
  await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 비밀 });
  const r = await tool.handler({ connector: 'gagagg', action: 'disconnect' });
  assert.equal(r.result?.connected, false);
  assert.equal(await store.get('gagagg'), null, '끊었다고 말하고 값은 남겼다');
});

test('확인 방법을 선언하지 않은 커넥터는 확인 없이도 거짓 성공이 아니다', async () => {
  const c = 커넥터();
  delete c.authMethods[0].verify;
  const 가짜 = 가짜서비스();
  const { tool } = await 손만들기(가짜, { c });
  const r = await tool.submitSecret('gagagg', { client_id: 아이디, client_secret: 비밀 });
  assert.equal(r.ok, true);
  assert.equal(가짜.기록.호출, 0, '선언에 없는 확인을 지어냈다');
  assert.equal(r.result.verified, true); // 확인할 것이 없었다는 뜻 — 값 없이 사실만
});

// ── 순수 함수 계약 ────────────────────────────────────────────────────
test('secretFields 는 값을 담지 않고, 기본이 가림이다', () => {
  const f = secretFields(커넥터().authMethods[0]);
  assert.equal(f.length, 2);
  assert.equal(secretFields({ fields: [{ name: 'k' }] })[0].secret, true, '기본이 드러냄이면 위험하다');
  assert.ok(!JSON.stringify(f).includes('value'));
});

test('missingFields 는 공백만 있는 값을 채운 것으로 보지 않는다', () => {
  const m = 커넥터().authMethods[0];
  assert.deepEqual(missingFields(m, { client_id: '  ', client_secret: 비밀 }), ['client_id']);
  assert.deepEqual(missingFields(m, { client_id: 아이디, client_secret: 비밀 }), []);
});

test('verifyApiKey 는 응답 본문을 사용자에게 옮기지 않는다', async () => {
  const 되비침 = async () => ({ status: 401, ok: false,
    json: async () => ({ echoed: 비밀 }), text: async () => 비밀 });
  const r = await verifyApiKey(커넥터().authMethods[0], { client_secret: 비밀 }, { fetchImpl: 되비침 });
  assert.equal(r.ok, false);
  assert.ok(!r.reason.includes(비밀), '서비스가 되비친 키를 그대로 사용자에게 옮겼다');
});
