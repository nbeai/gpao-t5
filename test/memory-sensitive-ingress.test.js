import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containsSensitiveValue } from '../src/kernel/l0-evidence/sensitive-text.js';
import { makeServer, redactSensitiveResult } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { defineChannel } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';

const SECRET = 'sk-proj-1234567890abcdefghijklmnop';

test('민감값은 답 필드뿐 아니라 저장되는 턴 결과 전체에서 제거한다', () => {
  const card = '4111 1111 1111 1111';
  const result = {
    kind: 'reply',
    reply: '카드번호는 기억할 수 없어요.',
    goal: {
      understoodTask: `카드번호 ${card} 기억하기`,
      successCriteria: `요청 달성: ${card} 저장`,
    },
    nested: [{ rationale: `사용자가 ${card}를 제공함` }],
  };
  redactSensitiveResult(result);
  assert.doesNotMatch(JSON.stringify(result), /4111[ -]?1111[ -]?1111[ -]?1111/);
  assert.equal(result.reply, '카드번호는 기억할 수 없어요.', '정상적인 거절 답까지 지우면 안 된다');
  assert.match(result.goal.understoodTask, /민감/);
});

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

async function withServer(model, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sensitive-memory-'));
  const store = new SessionStore(dir);
  const memoryStore = new MemoryStore(dir);
  const server = makeServer({ store, memoryStore, env: demoEnv(), tools: demoTools(), model });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ base, memoryStore, store }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('로컬 웹도 민감 발화·제목·모델 재출력을 durable 대화에 원문 저장하지 않는다', async () => {
  const card = '4111 1111 1111 1111';
  const model = {
    async respond(_tc, opts = {}) {
      opts.onDelta?.(`카드번호는 ${card}예요.`);
      return `카드번호는 ${card}예요.`;
    },
  };
  await withServer(model, async ({ base, store }) => {
    const session = await (await post(base, '/sessions')).json();
    const start = await (await post(base, '/turn/stream-start', {
      sessionId: session.id, text: `내 카드번호는 ${card}이야. 기억해둬.`,
    })).json();
    const sse = await fetch(`${base}/turn/stream?sessionId=${session.id}&streamId=${start.streamId}`).then((r) => r.text());
    const saved = await store.load(session.id);
    assert.doesNotMatch(sse, /4111[ -]?1111[ -]?1111[ -]?1111/, '스트림으로 민감값이 먼저 나갔다');
    assert.doesNotMatch(JSON.stringify(saved), /4111[ -]?1111[ -]?1111[ -]?1111/, '대화·제목에 민감 원문이 남았다');
    assert.match(saved.title, /민감/, '제목을 빈칸이나 원문으로 두지 않는다');
    assert.match(saved.transcript[0].text, /민감/, '사용자 발화 자리에는 가림 사실이 남아야 한다');
  });
});

test('비밀 모양만 잡고 보통의 기억 문장은 통과시킨다', () => {
  for (const value of [
    SECRET,
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz1234',
    'client_secret: abcdefgh12345678',
    'password: "correct horse battery staple"',
    'password: "abc123"',
    '비밀번호: abc123',
    '비밀번호는 abc123',
    '비밀번호는 1234',
    '비밀번호 abc123!',
    '비밀번호 huntertwo',
    '토큰: abc123',
    '인증키는 abc123',
    '주민번호는 900101-1234567',
    '4111-1111-1111-1111',
    '카드번호 4111 1111 1111 1111',
    '-----BEGIN PRIVATE KEY-----',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature12345678',
    'https://owner:secret-password@example.com/private',
    'https://u:p@example.com/private',
    `API 키는 sk-\u200Bproj-1234567890abcdefghijklmnop`,
  ]) assert.equal(containsSensitiveValue(value), true, value);

  for (const value of [
    '보고서는 표보다 짧은 목록으로 정리한다',
    '비밀번호는 길게 정한다',
    '비밀번호는 12자 이상으로 만든다',
    '토큰은 3개로 제한한다',
    '인증키는 90일마다 교체한다',
    '토큰 사용법을 설명해 달라',
    '문서 식별자는 123e4567-e89b-12d3-a456-426614174000이다',
  ]) assert.equal(containsSensitiveValue(value), false, value);
});

test('UUID 기계 신분은 카드번호로 오인하지 않고 함께 있는 실제 카드번호는 잡는다', () => {
  const sessionId = '3179e769-e714-46ef-a615-359554688546';
  assert.equal(containsSensitiveValue(sessionId), false, 'UUID 내부 숫자 조각을 카드번호로 오인했다');
  assert.equal(containsSensitiveValue(`${sessionId} 카드 4111 1111 1111 1111`), true,
    'UUID를 제외하면서 실제 카드번호까지 놓쳤다');
});

test('모델 제출과 정규식 후보 모두 비밀값을 장기 기억에 쓰지 않는다', async () => {
  const modelProposal = {
    async respond(_tc, opts = {}) {
      return opts.tools?.length
        ? { text: '기억할게요.', toolCalls: [{ name: 'memory.propose', args: { statement: `API 키는 ${SECRET}` } }] }
        : '기억할게요.';
    },
  };
  await withServer(modelProposal, async ({ base, memoryStore, store }) => {
    const session = await (await post(base, '/sessions')).json();
    const card = '4111 1111 1111 1111';
    const result = await (await post(base, '/turn', {
      sessionId: session.id, text: `내 카드번호는 ${card}야. 기억해둬`,
    })).json();
    assert.match(result.reply, /장기 기억에는 남기지 않았어요/);
    assert.equal(result.memorySuggestion, undefined);
    assert.deepEqual((await memoryStore.load()).candidates, []);
    assert.doesNotMatch(JSON.stringify(await store.load(session.id)), new RegExp(SECRET),
      '거절 답만 가리고 goal·successCriteria 같은 턴 결과 메타데이터에 원문을 남겼다');
    assert.doesNotMatch(JSON.stringify(await store.load(session.id)), /4111[ -]?1111[ -]?1111[ -]?1111/,
      '민감한 사용자 원문이 턴 결과 메타데이터에 남았다');
  });

  const noProposal = { async respond() { return { text: '알겠어요.', toolCalls: [] }; } };
  await withServer(noProposal, async ({ base, memoryStore }) => {
    const session = await (await post(base, '/sessions')).json();
    const result = await (await post(base, '/turn', {
      sessionId: session.id,
      text: `앞으로 API 키는 ${SECRET}로 기억해줘`,
    })).json();
    assert.match(result.reply, /장기 기억에는 남기지 않았어요/);
    assert.equal(result.memorySuggestion, undefined);
    assert.deepEqual((await memoryStore.load()).candidates, []);
  });
});

test('모든 명시적 기억 저장 API가 같은 비밀 경계를 쓴다', async () => {
  const model = { async respond() { return '네'; } };
  await withServer(model, async ({ base, memoryStore }) => {
    for (const [path, body] of [
      ['/search/admit', { statement: `지난 대화의 키 ${SECRET}`, source: { sessionId: 's1' } }],
      ['/user-model/traits', { statement: `내 토큰은 ${SECRET}`, evidence: [] }],
      ['/user-model/preferences', { statement: `항상 ${SECRET}를 사용한다` }],
    ]) {
      const response = await post(base, path, body);
      assert.equal(response.status, 422, path);
      const result = await response.json();
      assert.equal(result.reason, 'sensitive_value');
      assert.equal(result.stored, false);
    }
    const memory = await memoryStore.load();
    assert.deepEqual(memory.candidates, []);
    assert.deepEqual(memory.promoted, []);
    assert.deepEqual(memory.observed, []);

    const normal = await post(base, '/user-model/preferences', { statement: '보고서는 목록으로 정리한다' });
    assert.equal(normal.status, 200, '정상 기억까지 막으면 안 된다');
    assert.equal((await memoryStore.load()).candidates.length, 1);
  });
});

test('기억 메타데이터 우회와 과거 민감 후보의 승격을 막되 삭제는 허용한다', async () => {
  const model = { async respond() { return '네'; } };
  await withServer(model, async ({ base, memoryStore }) => {
    assert.equal((await post(base, '/user-model/traits', {
      statement: '아침에 활동적일 수도',
      evidence: [`관찰 토큰 ${SECRET}`],
    })).status, 422);
    assert.equal((await post(base, '/search/admit', {
      statement: '지난 대화의 결정',
      source: { sessionId: 's1', title: `비밀 ${SECRET}` },
    })).status, 422);
    assert.equal((await post(base, '/search/admit', {
      statement: '지난 대화의 결정',
      source: { sessionId: `access_token:${SECRET}`, title: '결정' },
    })).status, 422);

    await memoryStore.save({
      candidates: [{
        candidateId: 'legacy-secret',
        kind: 'preference',
        statement: `API 키는 ${SECRET}`,
        rollbackable: true,
      }],
      promoted: [],
      observed: [],
    });
    assert.equal((await post(base, '/memory/confirm', { candidateId: 'legacy-secret' })).status, 422);
    assert.equal((await post(base, '/user-model/preferences/legacy-secret/confirm')).status, 422);
    assert.equal((await memoryStore.load()).promoted.length, 0);

    const removed = await (await post(base, '/memory/reject', { candidateId: 'legacy-secret' })).json();
    assert.equal(removed.rejected, true, '오염 후보를 사용자가 지울 길은 열려 있어야 한다');
    assert.equal((await memoryStore.load()).candidates.length, 0);

    await memoryStore.save({
      candidates: [{
        candidateId: 'legacy-search-secret',
        kind: 'recalled_context',
        statement: '지난 대화의 결정',
        source: { sessionId: `access_token:${SECRET}` },
        rollbackable: true,
      }],
      promoted: [],
      observed: [],
    });
    assert.equal((await post(base, '/memory/confirm', { candidateId: 'legacy-search-secret' })).status, 422);
    assert.equal((await memoryStore.load()).promoted.length, 0);
  });
});

test('채널 턴도 transcript 저장 전에 민감한 모델 기억 제안을 걷는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-sensitive-channel-'));
  const store = new SessionStore(dir);
  const memoryStore = new MemoryStore(dir);
  const allowlistStore = new AllowlistStore(dir);
  await allowlistStore.allow('telegram', { userId: 'owner' });
  const connector = defineConnector({
    id: 'telegram', label: '텔레그램', kind: 'channel', authState: 'oauth', connected: true,
  });
  const model = {
    async respond(_tc, opts = {}) {
      return opts.tools?.length
        ? { text: '기억할게요.', toolCalls: [{ name: 'memory.propose', args: { statement: `숨은 키 ${SECRET}` } }] }
        : '기억할게요.';
    },
  };
  const server = makeServer({
    store,
    memoryStore,
    allowlistStore,
    model,
    env: demoEnv(),
    tools: demoTools(),
    connectors: [connector],
    channels: [defineChannel({
      id: 'telegram', connector, inboundPolicy: 'allowlist_only', outboundTool: 'telegram.send',
    })],
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await post(base, '/sessions')).json();
    const response = await post(base, '/channel/inbound', {
      sessionId: session.id,
      channel: 'telegram',
      chatId: 'room',
      userId: 'owner',
      text: '그 값을 기억해줘',
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.match(result.reply, /장기 기억에는 남기지 않았어요/);
    const transcript = (await store.load(session.id)).transcript;
    assert.doesNotMatch(JSON.stringify(transcript), new RegExp(SECRET));
    assert.deepEqual((await memoryStore.load()).candidates, []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
