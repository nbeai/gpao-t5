import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeSkillCandidate, detectSkillCandidate, surfaceCandidate, markReplayRequired,
  replaySkill, approveSkill, admitSkill, rejectSkill, canInfluence, canAutoExecute, SKILL_STATES,
} from '../src/kernel/l5-growth/skill-learning.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// P6-17 Slice-2 SkillCandidate lifecycle — 추천 ≠ 실행/승격. replay+확인 전 영향 0. 스킬은 자동 실행 권한 없음.

// ── 감지: 반복 신호에서 detected(관찰만) ──
test('detectSkillCandidate: 같은 도구 2회 이상이면 후보(detected), 미만이면 null', () => {
  const traces = [
    { id: 't1', tool: 'slack.post', requestText: '슬랙에 보고 올려줘' },
    { id: 't2', tool: 'slack.post', requestText: '슬랙에 요약 올려줘' },
    { id: 't3', tool: 'web.collect', requestText: '자료 찾아줘' },
  ];
  const sk = detectSkillCandidate(traces, { id: 'sk1', now: 1 });
  assert.equal(sk.state, 'detected');
  assert.equal(sk.tool, 'slack.post');
  assert.equal(sk.steps.length, 2, '반복 발화가 단계로');
  assert.equal(canInfluence(sk), false, 'detected는 영향 0');
  // 1회짜리는 후보 아님
  assert.equal(detectSkillCandidate([{ id: 't1', tool: 'slack.post', requestText: 'x' }]), null);
});

// ── lifecycle happy path: detected→candidate→replay_required→approved→admitted ──
test('lifecycle: admitted 되기 전에는 어느 상태도 영향 0, admitted만 영향', () => {
  let sk = makeSkillCandidate({ id: 's', tool: 'slack.post', trigger: '보고 올려줘', steps: ['보고 올려줘'], now: 0 });
  assert.equal(sk.state, 'detected'); assert.equal(canInfluence(sk), false);
  sk = surfaceCandidate(sk);
  assert.equal(sk.state, 'candidate'); assert.equal(canInfluence(sk), false, '추천은 영향 0');
  sk = markReplayRequired(sk);
  assert.equal(sk.state, 'replay_required'); assert.equal(canInfluence(sk), false);
  const appr = approveSkill(sk, { userConfirmed: true, replayResult: replaySkill(sk) });
  assert.equal(appr.ok, true); assert.equal(appr.sk.state, 'approved');
  assert.equal(canInfluence(appr.sk), false, 'approved도 아직 영향 0(admit 전)');
  const adm = admitSkill(appr.sk);
  assert.equal(adm.ok, true); assert.equal(adm.sk.state, 'admitted');
  assert.equal(canInfluence(adm.sk), true, 'admitted만 영향');
  assert.ok(SKILL_STATES.includes(adm.sk.state));
});

// ── 절대 불변식 1: 스킬은 자동 실행 권한 없음(어느 상태에서도) ──
test('canAutoExecute는 언제나 false — 외부 행동은 스킬이라도 A2', () => {
  const sk = makeSkillCandidate({ id: 's', tool: 'slack.post', trigger: 'x', steps: ['x'] });
  assert.equal(canAutoExecute(), false);
  // admitted 여도 자동 실행 아님
  const admitted = { ...sk, state: 'admitted', userConfirmed: true, replayPassed: true };
  assert.equal(canInfluence(admitted), true);
  assert.equal(canAutoExecute(admitted), false, 'admitted 스킬도 자동 실행 금지');
});

// ── 절대 불변식 2: replay 통과 전 승격 불가 → replay 실패는 rejected(영향 0) ──
test('replay 실패면 승격 못 하고 rejected로 떨어진다(영향 0)', () => {
  let sk = makeSkillCandidate({ id: 's', tool: 'slack.post', trigger: '', steps: [] }); // 트리거·단계 비어 replay 실패
  sk = markReplayRequired(surfaceCandidate(sk));
  const replay = replaySkill(sk);
  assert.equal(replay.ok, false, 'replay 실패');
  const appr = approveSkill(sk, { userConfirmed: true, replayResult: replay });
  assert.equal(appr.ok, false);
  assert.equal(appr.reason, 'replay_failed');
  assert.equal(appr.sk.state, 'rejected', 'replay 실패 → rejected');
  assert.equal(canInfluence(appr.sk), false);
});

// ── 절대 불변식 3: 사용자 확인 없이는 승격 불가(추천 ≠ 승격) ──
test('사용자 확인 없으면 승격 불가 — 추천만으로 admitted 되지 않는다', () => {
  let sk = markReplayRequired(surfaceCandidate(makeSkillCandidate({ id: 's', tool: 'x', trigger: 't', steps: ['t'] })));
  const appr = approveSkill(sk, { userConfirmed: false, replayResult: replaySkill(sk) });
  assert.equal(appr.ok, false);
  assert.equal(appr.reason, 'needs_user_confirm');
  assert.equal(canInfluence(appr.sk), false);
});

test('rejectSkill: 거절은 영향 0 영구', () => {
  const sk = surfaceCandidate(makeSkillCandidate({ id: 's', tool: 'x', trigger: 't', steps: ['t'] }));
  const r = rejectSkill(sk, 'user_rejected');
  assert.equal(r.state, 'rejected');
  assert.equal(canInfluence(r), false);
});

// ── 서버 lifecycle(최소 표면) ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

function memStore(initial) { let d = initial; return { async load() { return d; }, async save(a) { d = a; return a; } }; }

async function withServer(traces, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-skill-'));
  const traceStore = memStore({ traces, proposed: [], promoted: [] });
  const skillStore = memStore({ skills: [] });
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), traceStore, skillStore });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`); }
  finally { await new Promise((r) => server.close(r)); }
}

const twoSlackTraces = [
  { id: 't1', tool: 'slack.post', requestText: '슬랙에 보고 올려줘' },
  { id: 't2', tool: 'slack.post', requestText: '슬랙에 요약 올려줘' },
];

test('서버: detect→candidate(영향 0)→approve→admitted(영향 가능, 자동실행 아님)', async () => {
  await withServer(twoSlackTraces, async (base) => {
    const det = await (await post(base, '/skills/detect')).json();
    assert.equal(det.detected, true);
    assert.equal(det.skill.state, 'candidate', '추천으로 표면화');
    assert.equal(det.skill.canInfluence, false, '추천은 영향 0');
    assert.equal(det.skill.canAutoExecute, false);
    const id = det.skill.id;
    // 중복 감지는 새로 제안하지 않는다
    assert.equal((await (await post(base, '/skills/detect')).json()).detected, false);
    // 승인 → admitted
    const appr = await (await post(base, `/skills/${id}/approve`)).json();
    assert.equal(appr.ok, true);
    assert.equal(appr.state, 'admitted');
    assert.equal(appr.skill.canInfluence, true, 'admitted만 영향');
    assert.equal(appr.skill.canAutoExecute, false, 'admitted 스킬도 자동 실행 금지');
    const list = await getj(base, '/skills');
    assert.equal(list.skills.find((s) => s.id === id).state, 'admitted');
  });
});

test('서버: reject하면 rejected(영향 0), 승인 안 된 후보는 GET에서 canInfluence:false', async () => {
  await withServer(twoSlackTraces, async (base) => {
    const det = await (await post(base, '/skills/detect')).json();
    const id = det.skill.id;
    const list1 = await getj(base, '/skills');
    assert.equal(list1.skills[0].canInfluence, false, '승인 전 영향 0');
    const rej = await (await post(base, `/skills/${id}/reject`)).json();
    assert.equal(rej.state, 'rejected');
    const list2 = await getj(base, '/skills');
    assert.equal(list2.skills.find((s) => s.id === id).state, 'rejected');
    assert.equal(list2.skills.find((s) => s.id === id).canInfluence, false);
  });
});

test('서버: 반복 신호 없으면 detect는 detected:false(후보 없음)', async () => {
  await withServer([{ id: 't1', tool: 'slack.post', requestText: '한 번만' }], async (base) => {
    assert.equal((await (await post(base, '/skills/detect')).json()).detected, false);
    assert.deepEqual((await getj(base, '/skills')).skills, []);
  });
});
