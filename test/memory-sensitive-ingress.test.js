import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { containsSensitiveValue } from '../src/kernel/l0-evidence/sensitive-text.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { defineChannel } from '../src/kernel/l2-plan/channel-registry.js';
import { defineConnector } from '../src/kernel/l2-plan/connector-profile.js';
import { AllowlistStore } from '../src/surface/allowlist-store.js';

const SECRET = 'sk-proj-1234567890abcdefghijklmnop';

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
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn({ base, memoryStore }); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

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
    '토큰: abc123',
    '인증키는 abc123',
    '주민번호는 900101-1234567',
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

test('모델 제출과 정규식 후보 모두 비밀값을 장기 기억에 쓰지 않는다', async () => {
  const modelProposal = {
    async respond(_tc, opts = {}) {
      return opts.tools?.length
        ? { text: '기억할게요.', toolCalls: [{ name: 'memory.propose', args: { statement: `API 키는 ${SECRET}` } }] }
        : '기억할게요.';
    },
  };
  await withServer(modelProposal, async ({ base, memoryStore }) => {
    const session = await (await post(base, '/sessions')).json();
    const result = await (await post(base, '/turn', { sessionId: session.id, text: '이 키를 기억해둬' })).json();
    assert.match(result.reply, /장기 기억에는 남기지 않았어요/);
    assert.equal(result.memorySuggestion, undefined);
    assert.deepEqual((await memoryStore.load()).candidates, []);
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
  await new Promise((resolve) => server.listen(0, resolve));
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
