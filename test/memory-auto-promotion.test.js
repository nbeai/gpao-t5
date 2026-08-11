// §5-5 「기억을 새 대화까지 완결한다」 — 명시 지속 의도 자동 승격(§7 오너 결정 집행) 검사.
// 선빨강 1(명시 "기억해줘"인데 카드가 뜨던 결함) + 검증 6(새 대화·재시작·일회성·새 지시 우선·철회·모델 제안)
// + 민감정보 자동 승격 금지. 저장소는 전부 temp dir — 오너 실사용 자리(~/.local/state)는 건드리지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// 캡처 모델 — 모델이 실제로 무엇을 봤는지(admittedContext)를 기계 사실로 잡는다.
// "저장됐다"가 아니라 "다음 대화의 모델 입력에 들어갔다"를 재는 판정 자.
function captureModel(seen) {
  return { respond: async (tc) => { seen.push(tc); return '알겠어요.'; } };
}

async function startServer(dir, seen) {
  const server = makeServer({ store: new SessionStore(dir), ...(seen ? { model: captureModel(seen) } : {}) });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();
const newSession = async (base) => (await post(base, '/sessions')).json();
const close = (server) => new Promise((r) => server.close(r));

// ── 선빨강: 명시 "기억해줘" 원문 + 자격 충족 → 카드 없이 자동 승격 ──
// 수리 전에는 detect/카드 경로만 있어 promoted가 0이었다(승격 통로는 있는데 확정 카드를 또 물었다).
test('선빨강: 명시 "기억해줘"는 카드 없이 자동 승격되고 즉시 가시·철회 정보가 실린다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const { server, base } = await startServer(dir);
  try {
    const s = await newSession(base);
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '나 커피 안 마셔. 앞으로 기억해줘.' })).json();
    // 확정 카드가 아니라 이미 승격된 사실이 온다(즉시 가시 + 한 번 철회의 근거 포함).
    assert.equal(r.memorySuggestion?.promoted, true, '명시 지속 의도는 묻지 않고 승격한다(§7)');
    assert.equal(r.memorySuggestion?.rollbackable, true, '되돌리기 한 번이 함께 선다');
    assert.ok(r.memorySuggestion?.candidateId, '철회에 쓸 id가 즉시 온다');
    const m = await getj(base, '/memory');
    assert.equal(m.promoted.length, 1, '승격됨');
    assert.equal(m.candidates.length, 0, '확정 카드 후보를 남기지 않는다');
    assert.equal(m.promoted[0].statement, '나 커피 안 마셔. 앞으로 기억해줘.');
  } finally { await close(server); }
});

// ── 검증 1: 새 대화에 적용 ── 저장됐다가 아니라, 새 세션의 모델 입력에 실제로 들어간다.
test('검증1: 자동 승격된 기억이 새 대화의 admittedContext에 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const seen = [];
  const { server, base } = await startServer(dir, seen);
  try {
    const a = await newSession(base);
    await post(base, '/turn', { sessionId: a.id, text: '나 커피 안 마셔. 앞으로 기억해줘.' });
    const b = await newSession(base); // 새 대화
    await post(base, '/turn', { sessionId: b.id, text: '내가 커피 마셔?' });
    const tc = seen.at(-1);
    assert.ok(tc.admittedContext.includes('나 커피 안 마셔. 앞으로 기억해줘.'), '새 대화의 모델 입력에 기억이 입장한다');
  } finally { await close(server); }
});

// ── 검증 2: 서버 재시작 뒤에도 적용 ── 저장소 재로드가 진실이다.
test('검증2: 서버를 다시 띄워도(저장소 재로드) 자동 승격 기억이 적용된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const first = await startServer(dir);
  try {
    const s = await newSession(first.base);
    await post(first.base, '/turn', { sessionId: s.id, text: '나 커피 안 마셔. 앞으로 기억해줘.' });
  } finally { await close(first.server); }
  const seen = [];
  const second = await startServer(dir, seen); // 같은 방을 다시 연다 = 재시작
  try {
    const s2 = await newSession(second.base);
    await post(second.base, '/turn', { sessionId: s2.id, text: '내가 커피 마셔?' });
    assert.ok(seen.at(-1).admittedContext.includes('나 커피 안 마셔. 앞으로 기억해줘.'), '재시작 뒤에도 적용');
  } finally { await close(second.server); }
});

// ── 검증 3: "이번만"·"오늘은" 류 일회성은 승격하지 않는다(다음 대화에 안 남음) ──
test('검증3: 일회성 발화는 자동 승격되지 않고 후보 카드로만 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const { server, base } = await startServer(dir);
  try {
    const s = await newSession(base);
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '오늘은 보고서 글로 받고 싶어' })).json();
    assert.notEqual(r.memorySuggestion?.promoted, true, '일회성은 자동 승격 금지');
    const m = await getj(base, '/memory');
    assert.equal(m.promoted.length, 0, '다음 대화에 남을 것이 없다');
    assert.equal(m.candidates.length, 1, '기존 카드 경로는 그대로(사용자가 원하면 명시 확정 가능)');
  } finally { await close(server); }
});

// ── 검증 4: 새 지시가 과거 기억을 이긴다 ── 같은 주제의 과거 승격 기억은 새 명시 지시로 대체된다.
test('검증4: 같은 주제의 새 명시 지시가 과거 승격 기억을 대체한다(무관한 기억은 산다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const { server, base } = await startServer(dir);
  try {
    const s = await newSession(base);
    await post(base, '/turn', { sessionId: s.id, text: '나 커피 안 마셔. 앞으로 기억해줘.' });
    await post(base, '/turn', { sessionId: s.id, text: '앞으로 보고서는 글로 받을래. 기억해줘' });
    await post(base, '/turn', { sessionId: s.id, text: '앞으로 보고서는 표로 받을래. 기억해줘' });
    const m = await getj(base, '/memory');
    const stmts = m.promoted.map((e) => e.statement);
    assert.ok(stmts.includes('앞으로 보고서는 표로 받을래. 기억해줘'), '새 지시가 남는다');
    assert.ok(!stmts.includes('앞으로 보고서는 글로 받을래. 기억해줘'), '같은 주제의 과거 기억은 진 것 — 대체된다');
    assert.ok(stmts.includes('나 커피 안 마셔. 앞으로 기억해줘.'), '무관한 기억은 건드리지 않는다(좁게)');
    assert.equal(m.promoted.length, 2);
  } finally { await close(server); }
});

// ── 검증 5: 철회한 기억은 다시 개입하지 않는다 ──
test('검증5: 되돌리기 한 번이면 다음 대화 모델 입력에 다시 안 들어간다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const seen = [];
  const { server, base } = await startServer(dir, seen);
  try {
    const s = await newSession(base);
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '나 커피 안 마셔. 앞으로 기억해줘.' })).json();
    const g = await (await post(base, '/memory/rollback', { candidateId: r.memorySuggestion.candidateId })).json();
    assert.equal(g.rolledBack, true, '한 번에 철회');
    const b = await newSession(base);
    await post(base, '/turn', { sessionId: b.id, text: '내가 커피 마셔?' });
    assert.deepEqual(seen.at(-1).admittedContext, [], '철회한 기억은 다시 개입하지 않는다');
    assert.equal((await getj(base, '/memory')).promoted.length, 0);
  } finally { await close(server); }
});

// ── 검증 6: 모델 제안은 사용자 확정 없이 승격되지 않는다 ── 4등(기억)의 방어선.
test('검증6: 모델 제안 레인(/user-model/preferences)은 지속 의도 낱말이 있어도 pending에 머문다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const { server, base } = await startServer(dir);
  try {
    // 모델이 지어낸 제안 — 문장에 "항상"이 있어도 출처가 사용자 원문 턴이 아니므로 자동 승격 문을 못 지난다.
    const r = await (await post(base, '/user-model/preferences', { statement: '항상 요약은 세 줄로 받기' })).json();
    assert.equal(r.preference.status, 'pending_confirm', '모델 제안은 확정 대기');
    const m = await getj(base, '/memory');
    assert.equal(m.promoted.length, 0, '사용자 확정 전 승격 0');
    assert.equal(m.candidates.length, 1);
  } finally { await close(server); }
});

// ── 민감정보: 자동 승격 절대 금지 ── "기억해줘"가 있어도 비밀번호 류는 묻는 길만 남는다.
test('민감정보는 명시 "기억해줘"가 있어도 자동 승격되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-autoprom-'));
  const { server, base } = await startServer(dir);
  try {
    const s = await newSession(base);
    const r = await (await post(base, '/turn', { sessionId: s.id, text: '내 비밀번호는 abc123이야. 앞으로 기억해줘.' })).json();
    assert.notEqual(r.memorySuggestion?.promoted, true, '민감정보 자동 승격 금지');
    const m = await getj(base, '/memory');
    assert.equal(m.promoted.length, 0);
    assert.equal(m.candidates.length, 1, '사용자가 직접 확정하는 카드 길만 남는다');
  } finally { await close(server); }
});
