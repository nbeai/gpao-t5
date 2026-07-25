import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { searchTranscripts, makeSearchCandidate, projectSearchCandidates, RECALLED_KIND } from '../src/kernel/l5-growth/session-search.js';
import { isInfluenceEligible, admittedContext, promote } from '../src/kernel/l1-intent/context-mesh.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// P6-17 Slice-1 Session Search — 과거 대화 회수. 핵심 안전 불변식:
//   검색 결과는 raw로 라우터·answer에 섞이지 않는다. candidate로만 나오고 admission(userConfirmed) 통과해야 영향.

const sessions = [
  { id: 's1', title: '부오상회 견적', transcript: [
    { role: 'user', text: '부오상회 견적서 초안 정리해줘' },
    { role: 'assistant', result: { kind: 'reply', reply: '견적서 초안을 정리했어요.' } },
  ] },
  { id: 's2', title: '휴가 계획', transcript: [
    { role: 'user', text: '다음 주 휴가 일정 잡아줘' },
  ] },
];

// ── 검색: 결정적 키워드 매치 ──
test('searchTranscripts: 질의어가 걸린 대화 조각을 찾는다', () => {
  const hits = searchTranscripts(sessions, '부오상회');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].sessionId, 's1');
  assert.match(hits[0].snippet, /부오상회 견적서/);
});

test('searchTranscripts: 관련 없는 질의는 히트 없음, 빈 질의는 빈 결과', () => {
  assert.deepEqual(searchTranscripts(sessions, '주식투자'), []);
  assert.deepEqual(searchTranscripts(sessions, '   '), []);
  assert.deepEqual(searchTranscripts(sessions, ''), []);
});

test('searchTranscripts: user 발화와 assistant reply 모두 검색 대상', () => {
  const hits = searchTranscripts(sessions, '초안');
  // user '초안 정리해줘' + assistant '초안을 정리했어요' 둘 다 걸린다.
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => h.role === 'user'));
  assert.ok(hits.some((h) => h.role === 'assistant'));
});

// ── 안전 불변식: 검색 결과는 raw로 영향 0, admission 통과해야 영향 ──
test('검색 후보는 raw 상태에서 영향 0 — 라우터 admittedContext에 안 들어간다', () => {
  const [hit] = searchTranscripts(sessions, '부오상회');
  const cand = makeSearchCandidate(hit, 'c1');
  assert.equal(cand.kind, RECALLED_KIND);
  assert.equal(cand.admitted, false);
  assert.equal(cand.userConfirmed, false);
  assert.equal(cand.source.sessionId, 's1', '출처 세션 보존');
  // 핵심: 승격 전 후보는 영향 자격 없음 → 이번 요청에 관련돼도 admittedContext에서 제외.
  assert.equal(isInfluenceEligible(cand), false);
  assert.deepEqual(admittedContext({ promoted: [cand] }, '부오상회 견적서'), [], 'raw 검색결과는 answer 맥락에 안 섞인다');
});

test('admission(userConfirmed) 통과해야 검색 맥락이 영향 — 관련될 때만 좁게 입장', () => {
  const [hit] = searchTranscripts(sessions, '부오상회');
  const cand = makeSearchCandidate(hit, 'c1');
  const promoted = promote(cand, { userConfirmed: true });
  assert.equal(promoted.ok, true, '사용자 확인으로 승격');
  assert.equal(isInfluenceEligible(promoted.entry), true);
  // 승격돼도 "이번 요청에 관련"될 때만 입장(좁게).
  assert.deepEqual(admittedContext({ promoted: [promoted.entry] }, '부오상회 견적서 다시'), [hit.snippet]);
  assert.deepEqual(admittedContext({ promoted: [promoted.entry] }, '오늘 날씨'), [], '무관하면 입장 안 함');
});

test('projectSearchCandidates: 모든 결과가 admitted:false', () => {
  const cands = projectSearchCandidates(searchTranscripts(sessions, '초안'), (i) => `id${i}`);
  assert.ok(cands.length >= 1);
  assert.ok(cands.every((c) => c.admitted === false && c.userConfirmed === false), '모두 미승격');
});

// ── 서버 /search: 후보만 반환, turn을 돌리지 않는다 ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-search-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools() });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

test('POST /search: 과거 대화를 후보로만 반환(모델 안 돌리고, admitted:false)', async () => {
  await withServer(async (base) => {
    // 세션 A에 대화를 남긴다(turn).
    const a = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: a.id, text: '부오상회 견적서 정리해줘' });
    // 다른 세션에서 검색.
    const r = await (await post(base, '/search', { query: '부오상회' })).json();
    assert.ok(Array.isArray(r.results) && r.results.length >= 1, '히트 반환');
    assert.equal(r.admittedIntoContext, false, '검색은 맥락에 반영 아님');
    assert.ok(r.results.every((c) => c.admitted === false), '모든 결과 admitted:false');
    assert.equal(r.results[0].source.sessionId, a.id, '출처 세션 표기');
    // turn 응답이 아니다 — reply/kind 같은 실행 결과가 섞이지 않는다.
    assert.equal(r.reply, undefined);
    assert.equal(r.kind, undefined);
  });
});

test('POST /search: 빈 검색어는 400', async () => {
  await withServer(async (base) => {
    assert.equal((await post(base, '/search', {})).status, 400);
    assert.equal((await post(base, '/search', { query: '   ' })).status, 400);
  });
});
