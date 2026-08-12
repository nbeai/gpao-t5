// S5-5 · 성장 표면 — **이미 있는 상태를 사용자가 보고 고치고 되돌리는 자리.**
//
// 새 학습 기능이 아니다. 기억·원리·lane 이 지금 어떤 상태인지 보이고, 붙들어 두거나
// 치워 두거나 되돌릴 수 있으면 된다. 보이지 않으면 사용자는 왜 안 되는지 알 수 없고,
// 되돌릴 수 없으면 그건 조용히 죽이는 것과 같다.
//
// 지키는 것:
//   · 목록은 **하나**다 — 두 군데서 상태를 말하면 언젠가 다르게 말한다
//   · 카드·승인 0 · 사용자 답변과 모델 입력에 내부 신분 0
//   · 내려간 것·치운 것은 입장하지 않고, 붙든 것은 자동 감쇠에서 면제된다
//   · 모든 변경은 원장에 남고 되돌릴 수 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, MemoryLedger } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { demoTools } from '../src/surface/demo-context.js';

const 원리문장 = '월별 수치는 표로 정리한다';
const 선호문장 = '보고서는 짧은 목록으로 정리한다';
const 관련요청 = '월별 수치 정리해줘';

async function 서버세우기() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-surface-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [
    {
      candidateId: 'p-원리', kind: 'operating_principle', statement: 원리문장,
      principleId: 'p-원리', principleVersion: 2,
      admitted: true, userConfirmed: true, replayPassed: true,
      scopeSignals: { appliesWhen: [관련요청, '7월 수치 정리해줘'], notWhen: [] },
    },
    {
      candidateId: 'pref-1', kind: 'preference', statement: 선호문장,
      admitted: true, userConfirmed: true,
    },
  ];
  await mem.save(m);

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '알겠어요.'; } },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());
  const 입장 = async (텍스트 = 관련요청) => {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 텍스트 });
    return 받은것.at(-1).admittedContext ?? [];
  };
  return { dir, mem, server, post, get, 입장, 받은것, ledger: new MemoryLedger(dir) };
}

// ── 보인다 ────────────────────────────────────────────────────────────────
test('S5-5: 기억·원리·lane 을 구분해 보여준다', async () => {
  const { server, get } = await 서버세우기();
  try {
    const s = await get('/memory/state');
    const 종류 = s.items.map((x) => x.kind);
    assert.ok(종류.includes('operating_principle'), '원리를 구분해 보여준다');
    assert.ok(종류.includes('preference'), '선호도');
    assert.ok(Array.isArray(s.items.filter((x) => x.kind === 'lane')), 'lane 자리도 있다');
    for (const it of s.items) {
      assert.ok(it.statement, '사람이 아는 문장으로 보인다');
      assert.ok(it.state, '상태가 함께 온다');
    }
  } finally { server.close(); }
});

test('S5-5: 상태가 active·pinned·archived·decayed 로 갈린다', async () => {
  const { server, post, get } = await 서버세우기();
  try {
    const 상태 = async (id) => (await get('/memory/state')).items.find((x) => x.id === id)?.state;
    const [a] = (await get('/memory/state')).items;
    assert.equal(await 상태(a.id), 'active');

    await post('/memory/pin', { id: a.id, pinned: true });
    assert.equal(await 상태(a.id), 'pinned');
    await post('/memory/pin', { id: a.id, pinned: false });
    assert.equal(await 상태(a.id), 'active');

    await post('/memory/archive', { id: a.id });
    assert.equal(await 상태(a.id), 'archived');
    await post('/memory/restore', { id: a.id });
    assert.equal(await 상태(a.id), 'active');
  } finally { server.close(); }
});

// ── 고치면 실제로 달라진다 ────────────────────────────────────────────────
test('S5-5: 치워 둔 것은 모델 입력에 들지 않고, 되돌리면 다시 든다', async () => {
  const { server, post, get, 입장 } = await 서버세우기();
  try {
    assert.ok((await 입장()).includes(원리문장), '치우기 전에는 든다');
    const id = (await get('/memory/state')).items.find((x) => x.statement === 원리문장).id;

    await post('/memory/archive', { id });
    assert.equal((await 입장()).includes(원리문장), false, '치운 것은 안 든다');

    await post('/memory/restore', { id });
    assert.ok((await 입장()).includes(원리문장), '되돌리면 다시 든다');
  } finally { server.close(); }
});

test('S5-5: 붙들어 둔 것은 자동 감쇠에서 면제된다', async () => {
  const { mem, server, post, get } = await 서버세우기();
  try {
    const id = (await get('/memory/state')).items.find((x) => x.statement === 원리문장).id;
    await post('/memory/pin', { id, pinned: true });

    const m = await mem.load();
    m.correctionCorrelation = [{ ref: 'p-원리', kind: 'operating_principle', turns: [
      { sessionId: 's', turnSeq: 1, at: 10 }, { sessionId: 's', turnSeq: 3, at: 12 },
    ] }];
    await mem.save(m);
    await server.runtimeTick();

    assert.equal((await get('/memory/state')).items.find((x) => x.id === id).state, 'pinned',
      '상관이 쌓여도 붙든 것은 안 내려간다');
  } finally { server.close(); }
});

test('S5-5: 치워 둔 lane 은 다음 대화에 공급되지 않는다', async () => {
  const { server, post, get, 받은것 } = await 서버세우기();
  try {
    const s1 = await post('/sessions');
    await post('/turn', { sessionId: s1.id, text: '7월 수치 정리해줘' });
    const s2 = await post('/sessions');
    await post('/turn', { sessionId: s2.id, text: 관련요청 });
    assert.ok((받은것.at(-1).carryableWork ?? []).length > 0, '치우기 전에는 공급된다');

    // **공급된 그 lane** 을 치운다 — 대화가 여럿이면 lane 도 여럿이라, 아무거나 치우면
    // 아무 것도 증명하지 못한다.
    const 공급된 = 받은것.at(-1).carryableWork;
    const lanes = (await get('/memory/state')).items.filter((x) => x.kind === 'lane');
    assert.ok(lanes.length, 'lane 이 표면에 보인다');
    for (const l of lanes.filter((x) => 공급된.includes(x.statement))) {
      assert.equal((await post('/memory/archive', { id: l.id })).ok, true);
    }

    const s3 = await post('/sessions');
    await post('/turn', { sessionId: s3.id, text: 관련요청 });
    assert.deepEqual(받은것.at(-1).carryableWork ?? [], [], '치운 lane 은 공급되지 않는다');
  } finally { server.close(); }
});

// ── 경계 ──────────────────────────────────────────────────────────────────
test('S5-5: 모든 변경이 원장에 남는다', async () => {
  const { server, post, get, ledger } = await 서버세우기();
  try {
    const id = (await get('/memory/state')).items.find((x) => x.statement === 선호문장).id;
    await post('/memory/pin', { id, pinned: true });
    await post('/memory/pin', { id, pinned: false });
    await post('/memory/archive', { id });
    await post('/memory/restore', { id });

    const 이벤트 = (await ledger.load()).entries.map((e) => e.event);
    for (const ev of ['pinned', 'unpinned', 'archived', 'restored']) {
      assert.ok(이벤트.includes(ev), `${ev} 가 원장에 남는다`);
    }
    // 원장에는 여전히 원문이 없다(지문만) — 기존 계약 그대로.
    assert.equal(JSON.stringify(await ledger.load()).includes(선호문장), false);
  } finally { server.close(); }
});

test('S5-5: 표면 조작은 카드도 승인도 만들지 않는다', async () => {
  const { server, post, get } = await 서버세우기();
  try {
    const id = (await get('/memory/state')).items[0].id;
    await post('/memory/pin', { id, pinned: true });
    await post('/memory/archive', { id });
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: 관련요청 });
    assert.equal((답.approvals ?? []).length, 0);
  } finally { server.close(); }
});

test('S5-5: 사용자 답변과 모델 입력에 내부 신분이 나가지 않는다', async () => {
  const { server, post, get, 받은것 } = await 서버세우기();
  try {
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: 관련요청 });
    for (const 내부 of ['p-원리', 'pref-1']) {
      assert.equal(String(답.reply ?? '').includes(내부), false, `답변에 ${내부} 노출`);
      assert.equal(JSON.stringify(받은것.at(-1)).includes(내부), false, `모델 입력에 ${내부} 노출`);
    }
  } finally { server.close(); }
});

test('S5-5: 기존 확인·거절·되돌리기 경로와 부딪히지 않는다', async () => {
  const { mem, server, post, get } = await 서버세우기();
  try {
    const m = await mem.load();
    m.candidates = [{ candidateId: 'c-1', kind: 'preference', statement: '새 후보', admitted: false, userConfirmed: false }];
    await mem.save(m);

    assert.equal((await post('/memory/confirm', { candidateId: 'c-1' })).ok, true, '확인 경로 그대로');
    assert.equal((await post('/memory/rollback', { candidateId: 'c-1' })).ok, true, '되돌리기 그대로');
    const 남은 = (await get('/memory/state')).items.map((x) => x.statement);
    assert.equal(남은.includes('새 후보'), false, '되돌린 것은 목록에서 빠진다');
    assert.ok(남은.includes(원리문장), '나머지는 그대로');
  } finally { server.close(); }
});

// 읽는 자리가 여럿이면 언젠가 서로 다른 말을 한다. `/overview` 도 `/memory` 도 상태 칸이
// 없어 "반영 중"이라고만 말할 수 있으니, 물러난 항목이 거기 남으면 그건 거짓말이다.
// **모든 읽기 표면이 같은 판정(`물러남`)을 봐야 한다** — 하나라도 따로 재면 갈라진다.
test('S5-5: 내려간 것·치운 것은 어떤 읽기 표면에서도 "반영 중"이 아니다', async () => {
  const { mem, server, post, get } = await 서버세우기();
  try {
    const 반영중 = async () => {
      const o = await get('/overview');
      const mm = await get('/memory');
      return [
        ...o.preferences.reflected, ...o.memories.reflected, ...mm.promoted,
      ].map((x) => x.statement);
    };
    assert.ok((await 반영중()).includes(원리문장), '기본은 반영 중으로 보인다');

    assert.equal((await post('/memory/archive', { id: 'pref-1' })).ok, true);
    const m = await mem.load();
    m.promoted.find((e) => e.candidateId === 'p-원리').decayedAt = 1;
    await mem.save(m);

    const 남은 = await 반영중();
    assert.equal(남은.includes(선호문장), false, '치운 것이 반영 중으로 보인다');
    assert.equal(남은.includes(원리문장), false, '내려간 것이 반영 중으로 보인다');
    // 사라진 것이 아니라 상태를 아는 목록으로 옮겨 갔을 뿐이다 — 되돌릴 자리가 있어야 한다.
    const 상태 = (await get('/memory/state')).items;
    assert.equal(상태.find((x) => x.statement === 선호문장)?.state, 'archived');
    assert.equal(상태.find((x) => x.statement === 원리문장)?.state, 'decayed');
  } finally { server.close(); }
});

test('S5-5: 없는 것을 조작해도 조용히 실패한다', async () => {
  const { server, post } = await 서버세우기();
  try {
    assert.equal((await post('/memory/pin', { id: '없음', pinned: true })).ok, false);
    assert.equal((await post('/memory/archive', { id: '없음' })).ok, false);
    assert.equal((await post('/memory/restore', { id: '없음' })).ok, false);
  } finally { server.close(); }
});
