// S5-4 · **가역 감쇠 회로 전체.** 감쇠 실행 하나만 만드는 슬라이스가 아니다.
//
// 오너 경고(2026-07-31): "기억을 내리는 기능은 잘못 만들면 T5 의 말귀를 좋아지게 하는 게
// 아니라, 멀쩡한 기억을 조용히 죽이는 독이 된다." 그래서 이 파일은 **내리는 것**보다
// **잘못 내리지 않는 것**과 **되돌릴 수 있는 것**을 훨씬 많이 검사한다.
//
// 회로는 다섯 조각이 한 묶음이다: 후보 → 감쇠 → 원장 → 복원 → 표면. 하나라도 빠지면
// 사용자는 자기 기억이 왜 사라졌는지 모른 채 되돌릴 수도 없다.
//
// 절대 지키는 것:
//   · 독립 정정 2회 문턱 — `cite` 확신이 붙어도 낮아지지 않는다
//   · 미사용만으로는 감쇠 0(§4.10) · pin 은 자동 감쇠 면제
//   · 감쇠는 삭제가 아니다 — 문장·신분이 남고 복원하면 그대로 돌아온다
//   · 정정을 안 부른 턴은 "문제 없음"이 아니라 **아무 것도 모르는 상태**다
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
import { admittedContext, isInfluenceEligible } from '../src/kernel/l1-intent/context-mesh.js';
import { applyDecay, restoreDecayed, DECAY_CAPS } from '../src/kernel/l5-growth/tcell-decay.js';

const 원리문장 = '월별 수치는 표로 정리한다';
const 관련요청 = '월별 수치 정리해줘';
const 원리 = (over = {}) => ({
  candidateId: 'p-원리', kind: 'operating_principle', statement: 원리문장,
  principleId: 'p-원리', principleVersion: 2,
  admitted: true, userConfirmed: true, replayPassed: true,
  ...over,
});
// 실제 기록은 `at` 을 갖는다(correlateCorrection 이 넣는다) — 픽스처도 같은 모양이어야 한다.
const 상관 = (n, conf = 'claimed', at0 = 10) => ({
  ref: 'p-원리', kind: 'operating_principle',
  turns: Array.from({ length: n }, (_, i) => ({
    sessionId: 's-1', turnSeq: i * 2, at: at0 + i, confidence: conf,
  })),
});
const 기억 = (over = {}) => ({ promoted: [원리()], candidates: [], correctionCorrelation: [], ...over });

// ── 잘못 내리지 않는다 ────────────────────────────────────────────────────
test('S5-4: 독립 정정 1회로는 내리지 않는다', () => {
  const m = 기억({ correctionCorrelation: [상관(1)] });
  const r = applyDecay(m, { now: 100 });
  assert.deepEqual(r.decayed, []);
  assert.equal(isInfluenceEligible(m.promoted[0]), true, '그대로 입장한다');
});

test('S5-4: cite 확신이 붙어도 문턱은 그대로다(뒷문 금지)', () => {
  const m = 기억({ correctionCorrelation: [상관(1, 'cited')] });
  assert.deepEqual(applyDecay(m, { now: 100 }).decayed, []);
});

test('S5-4: 미사용만으로는 절대 내리지 않는다(§4.10)', () => {
  // 상관이 0인데 오래됐다는 이유로 내리면 안 된다 — 안 쓴 기억과 틀린 기억은 다르다.
  const m = 기억({ promoted: [원리({ createdAt: 0, lastUsedAt: 0 })], correctionCorrelation: [] });
  assert.deepEqual(applyDecay(m, { now: 10 ** 12 }).decayed, []);
});

test('S5-4: pin 은 자동 감쇠에서 면제된다', () => {
  const m = 기억({ promoted: [원리({ pinned: true })], correctionCorrelation: [상관(2)] });
  assert.deepEqual(applyDecay(m, { now: 100 }).decayed, [], 'pin 은 상관이 쌓여도 안 내린다');
  assert.equal(isInfluenceEligible(m.promoted[0]), true);
});

test('S5-4: 정정을 안 부른 턴은 "문제 없음"이 아니다 — 아무 것도 하지 않는다', () => {
  // 신호가 없다는 것은 좋다는 뜻도 나쁘다는 뜻도 아니다. 어느 쪽으로도 움직이지 않는다.
  const m = 기억({ correctionCorrelation: [] });
  const r = applyDecay(m, { now: 100 });
  assert.deepEqual(r.decayed, []);
  assert.deepEqual(r.restored ?? [], [], '없는 신호로 되살리지도 않는다');
});

test('S5-4: 한 번에 몰아서 내리지 않는다(상한)', () => {
  const 여럿 = Array.from({ length: DECAY_CAPS.perRun + 3 }, (_, i) => ({
    candidateId: `p-${i}`, kind: 'preference', statement: `기억 ${i}`,
    admitted: true, userConfirmed: true,
  }));
  const 상관들 = 여럿.map((e) => ({ ref: e.candidateId, kind: e.kind, turns: [
    { sessionId: 's', turnSeq: 1, at: 10 }, { sessionId: 's', turnSeq: 3, at: 12 },
  ] }));
  const m = { promoted: 여럿, correctionCorrelation: 상관들 };
  assert.equal(applyDecay(m, { now: 100 }).decayed.length, DECAY_CAPS.perRun);
});

// ── 내릴 때는 제대로 내린다 ───────────────────────────────────────────────
test('S5-4: 독립 2회면 내려가고, 그 순간부터 입장 0', () => {
  const m = 기억({ correctionCorrelation: [상관(2)] });
  const r = applyDecay(m, { now: 100 });
  assert.deepEqual(r.decayed.map((x) => x.ref), ['p-원리']);
  assert.equal(isInfluenceEligible(m.promoted[0]), false, '내려간 기억은 행동에 안 든다');
  assert.deepEqual(admittedContext(m, 관련요청), [], '모델 앞에도 놓이지 않는다');
});

test('S5-4: 감쇠는 삭제가 아니다 — 문장도 신분도 남는다', () => {
  const m = 기억({ correctionCorrelation: [상관(2)] });
  applyDecay(m, { now: 100 });
  const e = m.promoted.find((x) => x.candidateId === 'p-원리');
  assert.ok(e, '목록에서 사라지지 않는다');
  assert.equal(e.statement, 원리문장, '문장이 그대로다');
  assert.equal(e.decayedAt, 100);
  assert.ok(e.decayReason, '왜 내렸는지가 남는다');
});

test('S5-4: 복원하면 그대로 돌아온다', () => {
  const m = 기억({ correctionCorrelation: [상관(2)] });
  applyDecay(m, { now: 100 });
  const r = restoreDecayed(m, 'p-원리', { now: 200 });
  assert.equal(r.ok, true);
  const e = m.promoted.find((x) => x.candidateId === 'p-원리');
  assert.equal(e.decayedAt ?? null, null, '표식이 걷힌다');
  assert.equal(isInfluenceEligible(e), true);
  assert.deepEqual(admittedContext(m, 관련요청), [원리문장], '다시 모델 앞에 놓인다');
});

test('S5-4: 복원한 것을 같은 상관으로 다시 내리지 않는다(무한 왕복 금지)', () => {
  const m = 기억({ correctionCorrelation: [상관(2)] });
  applyDecay(m, { now: 100 });
  restoreDecayed(m, 'p-원리', { now: 200 });
  assert.deepEqual(applyDecay(m, { now: 300 }).decayed, [], '이미 판단이 끝난 상관으로는 다시 안 내린다');
  // 복원 뒤 **새로운** 정정이 두 번 더 쌓이면 그때는 다시 내려간다.
  m.correctionCorrelation = [{ ref: 'p-원리', kind: 'operating_principle', turns: [
    { sessionId: 's-1', turnSeq: 100, at: 250 }, { sessionId: 's-1', turnSeq: 102, at: 260 },
  ] }];
  assert.deepEqual(applyDecay(m, { now: 400 }).decayed.map((x) => x.ref), ['p-원리']);
});

test('S5-4: 없는 것을 복원해도 조용히 실패한다(지어내지 않는다)', () => {
  const m = 기억();
  assert.equal(restoreDecayed(m, '없는-신분', { now: 100 }).ok, false);
  assert.equal(m.promoted.length, 1);
});

// ── 회로의 나머지 절반: 원장 · 복원 · 표면 ────────────────────────────────
async function 서버세우기(상관목록) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-decay-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [원리({
    scopeSignals: { appliesWhen: ['월별 수치 정리해줘', '7월 수치 정리해줘'], notWhen: [] },
  })];
  m.correctionCorrelation = 상관목록 ?? [];
  await mem.save(m);

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '알겠어요.'; } },
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  const get = (p) => fetch(`${base}${p}`).then((r) => r.json());
  return { dir, mem, server, post, get, 받은것, ledger: new MemoryLedger(dir) };
}

test('S5-4/제품: tick 이 내리고, 원장에 남고, 다음 턴부터 모델 입력에서 빠진다', async () => {
  const { mem, server, post, get, 받은것, ledger } = await 서버세우기([상관(2)]);
  try {
    const s0 = await post('/sessions');
    await post('/turn', { sessionId: s0.id, text: 관련요청 });
    assert.deepEqual(받은것.at(-1).admittedContext, [원리문장], '내리기 전에는 든다');

    const r = await server.runtimeTick();
    assert.equal(r.decay?.decayed?.length, 1, 'tick 이 내린다');

    const s1 = await post('/sessions');
    await post('/turn', { sessionId: s1.id, text: 관련요청 });
    assert.deepEqual(받은것.at(-1).admittedContext, [], '내린 뒤에는 안 든다');

    const 원장 = await ledger.load();
    assert.ok(원장.entries.some((e) => e.event === 'decayed'), '왜 내려갔는지가 원장에 남는다');
    // 사용자면에 원문이 남지 않는다(기존 원장 계약 그대로 — 지문만).
    assert.equal(JSON.stringify(원장).includes(원리문장), false);

    const m = await mem.load();
    assert.equal(m.promoted.length, 1, '삭제가 아니다');
    assert.equal(m.promoted[0].statement, 원리문장);
  } finally { server.close(); }
});

test('S5-4/제품: 표면에서 내려간 것이 보이고, 복원하면 다시 든다', async () => {
  const { mem, server, post, get, 받은것, ledger } = await 서버세우기([상관(2)]);
  try {
    await server.runtimeTick();
    const 목록 = await get('/memory');
    assert.equal(목록.decayed?.length, 1, '내려간 것이 표면에 보인다');
    assert.equal(목록.decayed[0].statement, 원리문장, '무엇이 내려갔는지 사람 말로 보인다');
    assert.ok(목록.decayed[0].reason, '왜 내려갔는지도 보인다');
    assert.equal(목록.promoted.some((p) => p.statement === 원리문장), false, '반영 목록에서는 빠진다');

    const 복원 = await post('/memory/restore', { candidateId: 'p-원리' });
    assert.equal(복원.ok, true);

    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 관련요청 });
    assert.deepEqual(받은것.at(-1).admittedContext, [원리문장], '복원하면 다시 든다');

    const 원장 = await ledger.load();
    assert.ok(원장.entries.some((e) => e.event === 'restored'), '복원도 원장에 남는다');
    assert.equal((await get('/memory')).decayed.length, 0);
  } finally { server.close(); }
});

test('S5-4/제품: 상관이 1회면 tick 이 아무 것도 내리지 않는다', async () => {
  const { server, get } = await 서버세우기([상관(1)]);
  try {
    const r = await server.runtimeTick();
    assert.deepEqual(r.decay?.decayed ?? [], []);
    assert.deepEqual((await get('/memory')).decayed ?? [], []);
  } finally { server.close(); }
});

test('S5-4/제품: 감쇠·복원에 카드도 승인도 늘지 않는다', async () => {
  const { server, post, get } = await 서버세우기([상관(2)]);
  try {
    await server.runtimeTick();
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: 관련요청 });
    assert.equal((답.approvals ?? []).length, 0, '감쇠는 카드를 만들지 않는다');
    await post('/memory/restore', { candidateId: 'p-원리' });
    const 답2 = await post('/turn', { sessionId: s.id, text: 관련요청 });
    assert.equal((답2.approvals ?? []).length, 0, '복원도 카드를 만들지 않는다');
  } finally { server.close(); }
});
