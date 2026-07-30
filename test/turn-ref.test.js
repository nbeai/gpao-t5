// S0 · TurnRef — 전 표면 공통 불변 turn 신분. 계획 §4.1.
//
// 왜: T-cell 관찰 워커가 "이 턴을 이미 처리했는가"를 물을 대상이 없었다(P7). 세션 JSON은
// 제자리 투영이고 EventLog 의 turnId 는 스트림 경로에만 있어서, 웹 일반 턴·채널 턴을 정확히
// 한 번 처리했다는 사실도, 크래시 뒤 어디서 재개할지도 증명할 수 없었다.
//
// 이 검사는 사용자 경험을 바꾸지 않는다(S0 는 기반 슬라이스다). 대신 다음을 고정한다:
//   ① 웹 일반·SSE·채널의 저장 항목이 같은 TurnRef 계약을 갖는다
//   ② 같은 세션에서 seq 가 단조 증가하고 중복되지 않는다(동시 턴 포함)
//   ③ 한 턴의 user·assistant·ledger 항목이 같은 seq 를 공유한다
//   ④ 두 세션이 교차 저장돼도 각자 자기 순서를 갖는다(전역 순서는 요구하지 않는다)
//   ⑤ 재시작(스토어 재생성) 뒤에도 이어서 발급된다
//   ⑥ 기존 세션 migration 은 소급 표시를 남기고 반복해도 결과가 같다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeModelConnection, ModelConnectionStore } from '../src/surface/model-connection.js';
import { migrateTurnRefs, nextTurnSeq } from '../src/kernel/l0-evidence/turn-ref.js';

/** 스트리밍되는 가짜 provider 본문. */
function bodyOf(chunks) {
  const enc = new TextEncoder();
  let i = 0;
  return {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true }),
    }),
  };
}

const REPLY_LINES = [
  'data: {"choices":[{"delta":{"content":"네"}}]}\n',
  'data: [DONE]\n',
];

async function standUp() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-turnref-'));
  const nonStream = JSON.stringify({ choices: [{ message: { content: '네' } }] });
  const fetchImpl = async (url) => {
    if (String(url).includes('/models')) return { status: 200, json: async () => ({ data: [{ id: 'llama3.3' }] }) };
    // 스트림 경로는 SSE 조각을, 비스트림 경로(채널·일반 /turn)는 완성 JSON을 준다.
    return {
      status: 200,
      body: bodyOf(REPLY_LINES),
      json: async () => JSON.parse(nonStream),
      text: async () => nonStream,
    };
  };
  const env = {};
  const mc = makeModelConnection({ env, processEnv: {}, store: new ModelConnectionStore(dir), fetchImpl });
  await mc.connect({ provider: 'openai_compatible', key: 'k', modelId: 'llama3.3', baseUrl: 'http://localhost:11434/v1' });
  const store = new SessionStore(dir);
  const eventLog = new EventLog(dir);
  const server = makeServer({ store, eventLog, env, model: mc.model, modelConnection: mc });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { dir, store, eventLog, server, base, mc, env };
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

// 세션 파일 이름은 UUID 형식만 허용된다(session-store SAFE_ID).
const LEGACY_ID = '11111111-2222-4333-8444-555555555555';

/** 저장된 세션에서 턴 신분만 뽑는다. */
const refsOf = (session) => (session.transcript ?? []).map((e) => e.turnRef);

test('S0: 웹 일반 턴의 user·assistant 항목이 같은 TurnRef 를 공유한다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    const saved = await store.load(s.id);
    const refs = refsOf(saved);
    assert.equal(refs.length, 2, 'user·assistant 두 항목');
    for (const r of refs) {
      assert.equal(r?.sessionId, s.id, 'TurnRef 에 sessionId 가 있다');
      assert.equal(typeof r?.turnSeq, 'number', 'TurnRef 에 turnSeq 가 있다');
    }
    assert.equal(refs[0].turnSeq, refs[1].turnSeq, '한 턴의 두 항목은 같은 seq');
    assert.equal(refs[0].turnSeq, 1, '첫 턴은 1');
  } finally { server.close(); }
});

test('S0: 같은 세션의 연속 턴은 seq 가 단조 증가한다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '첫째' });
    await post(base, '/turn', { sessionId: s.id, text: '둘째' });
    const seqs = [...new Set(refsOf(await store.load(s.id)).map((r) => r.turnSeq))];
    assert.deepEqual(seqs, [1, 2], 'seq 1,2 로 단조 증가');
  } finally { server.close(); }
});

test('S0: 동시에 들어온 두 턴도 seq 를 중복 발급하지 않는다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    await Promise.all([
      post(base, '/turn', { sessionId: s.id, text: 'A' }),
      post(base, '/turn', { sessionId: s.id, text: 'B' }),
    ]);
    const seqs = refsOf(await store.load(s.id)).map((r) => r.turnSeq);
    const uniq = [...new Set(seqs)].sort((a, b) => a - b);
    assert.deepEqual(uniq, [1, 2], '두 턴이 각각 1,2 를 갖는다(중복·건너뜀 0)');
  } finally { server.close(); }
});

test('S0: SSE 스트림 턴도 같은 TurnRef 계약을 갖는다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    const start = await post(base, '/turn/stream-start', { sessionId: s.id, text: '스트림' });
    await (await fetch(`${base}/turn/stream?sessionId=${s.id}&streamId=${start.streamId}`)).text();
    const refs = refsOf(await store.load(s.id));
    assert.equal(refs.length, 2);
    assert.equal(refs[0]?.turnSeq, 1);
    assert.equal(refs[0].turnSeq, refs[1].turnSeq, '스트림 턴도 한 seq 를 공유');
  } finally { server.close(); }
});

test('S0: 채널 턴도 같은 TurnRef 계약을 갖는다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/channel/inbound', {
      sessionId: s.id, channel: 'telegram', text: '채널에서 왔다', isDirectMessage: true,
    });
    const refs = refsOf(await store.load(s.id)).filter(Boolean);
    assert.ok(refs.length >= 2, '채널 저장 항목에도 TurnRef 가 있다');
    assert.equal(refs[0].sessionId, s.id);
    assert.equal(refs[0].turnSeq, 1, '채널 턴도 같은 세션 순서를 쓴다');
    assert.equal(refs[0].turnSeq, refs[1].turnSeq, '한 턴의 두 항목은 같은 seq');
  } finally { server.close(); }
});

test('S0: 웹 턴과 채널 턴이 한 세션에서 seq 를 이어 쓴다', async () => {
  const { store, server, base } = await standUp();
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '웹에서' });
    await post(base, '/channel/inbound', {
      sessionId: s.id, channel: 'telegram', text: '채널에서', isDirectMessage: true,
    });
    const seqs = [...new Set(refsOf(await store.load(s.id)).map((r) => r.turnSeq))];
    assert.deepEqual(seqs, [1, 2], '표면이 달라도 한 세션의 순서는 하나다');
  } finally { server.close(); }
});

test('S0: 두 세션이 교차 저장돼도 각자 자기 순서를 갖는다(전역 순서 비요구)', async () => {
  const { store, server, base } = await standUp();
  try {
    const a = await post(base, '/sessions');
    const b = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: a.id, text: 'a1' });
    await post(base, '/turn', { sessionId: b.id, text: 'b1' });
    await post(base, '/turn', { sessionId: a.id, text: 'a2' });
    const seqA = [...new Set(refsOf(await store.load(a.id)).map((r) => r.turnSeq))];
    const seqB = [...new Set(refsOf(await store.load(b.id)).map((r) => r.turnSeq))];
    assert.deepEqual(seqA, [1, 2], 'A 는 1,2');
    assert.deepEqual(seqB, [1], 'B 는 1 — 다른 세션의 저장이 순서를 밀지 않는다');
  } finally { server.close(); }
});

test('S0: 서버 재시작 뒤에도 seq 가 이어서 발급된다', async () => {
  const { dir, store, server, base, env, mc } = await standUp();
  let s;
  try {
    s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: '재시작 전' });
  } finally { server.close(); }

  const store2 = new SessionStore(dir);
  const server2 = makeServer({
    store: store2, eventLog: new EventLog(dir), env, model: mc.model, modelConnection: mc,
  });
  await new Promise((r) => server2.listen(0, r));
  const base2 = `http://127.0.0.1:${server2.address().port}`;
  try {
    await post(base2, '/turn', { sessionId: s.id, text: '재시작 후' });
    const seqs = [...new Set(refsOf(await store2.load(s.id)).map((r) => r.turnSeq))];
    assert.deepEqual(seqs, [1, 2], '재시작 뒤 2 로 이어진다(1 을 다시 쓰지 않는다)');
  } finally { server2.close(); }
});

// ── migration: 사실을 지어내지 않는다 ─────────────────────────────────────
test('S0: 기존 세션 migration 은 소급 표시를 남기고 멱등이다', () => {
  const legacy = {
    id: 'legacy-1',
    transcript: [
      { role: 'user', text: '옛 발화' },
      { role: 'assistant', result: { kind: 'reply', reply: '옛 답' } },
      { role: 'user', text: '옛 발화 2' },
      { role: 'assistant', result: { kind: 'reply', reply: '옛 답 2' } },
    ],
    ledgerEntries: [{ intended: '옛 실행' }],
  };
  const once = migrateTurnRefs(legacy);
  const refs = once.transcript.map((e) => e.turnRef);
  assert.deepEqual(refs.map((r) => r.turnSeq), [1, 1, 2, 2], '저장 순서로 소급 부여');
  assert.ok(refs.every((r) => r.migrated === true), '소급임을 표시한다');
  // 과거 ledger 는 어느 턴 것인지 알 수 없다 — seq 를 지어내지 않는다.
  assert.equal(once.ledgerEntries[0].turnRef?.turnSeq, undefined, '귀속 불가 항목에 seq 를 만들지 않는다');
  assert.equal(once.ledgerEntries[0].turnRef?.migrated, true, '대신 소급 표시만 남긴다');

  const twice = migrateTurnRefs(structuredClone(once));
  assert.deepEqual(twice.transcript.map((e) => e.turnRef), refs, 'migration 반복은 결과가 같다');
  assert.equal(nextTurnSeq(twice), 3, '다음 발급은 3 부터');
});

test('S0: migration 된 세션에 새 턴이 붙어도 seq 가 겹치지 않는다', async () => {
  const { dir, store, server, base } = await standUp();
  try {
    // 구버전 형식의 세션 파일을 직접 심는다(현장 업그레이드 재현).
    await mkdir(dir, { recursive: true });
    const legacy = {
      id: LEGACY_ID, title: '옛 대화', createdAt: 1, updatedAt: 1,
      transcript: [
        { role: 'user', text: '옛 발화' },
        { role: 'assistant', result: { kind: 'reply', reply: '옛 답' } },
      ],
      ledgerEntries: [], pendingApprovals: {},
    };
    await writeFile(join(dir, `${LEGACY_ID}.json`), JSON.stringify(legacy), 'utf8');

    await post(base, '/turn', { sessionId: LEGACY_ID, text: '새 발화' });
    const saved = await store.load(LEGACY_ID);
    const refs = refsOf(saved);
    assert.equal(refs.filter((r) => r?.migrated).length, 2, '옛 항목 2개는 소급 표시');
    const fresh = refs.filter((r) => r && !r.migrated).map((r) => r.turnSeq);
    assert.deepEqual([...new Set(fresh)], [2], '새 턴은 2 — 옛 seq 1 과 겹치지 않는다');
  } finally { server.close(); }
});
