import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeTaskTrace, proposeDefaultTarget, replayDefaultTarget, promoteDefaultTarget, projectDefaultTarget,
  defaultTargetFor,
} from '../src/kernel/l5-growth/task-trace.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { TaskTraceStore } from '../src/surface/task-trace-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// ── 계약: 기록은 영향 0, 승격(승인+replay)만 영향. ──
test('DefaultTarget 계약: 제안 dedup · replay 검증 · 조회', () => {
  const prop = proposeDefaultTarget({ tool: 'slack.post', target: '#general', targetLabel: '공지방' });
  assert.equal(prop.kind, 'default_target');
  assert.equal(prop.target, '#general');
  assert.equal(prop.targetLabel, '공지방');
  assert.equal(prop.scope, 'global', '숨은 전역 영향 금지 — scope 명시');
  assert.equal(proposeDefaultTarget({ tool: 'slack.post', target: '#g', promoted: [{ kind: 'default_target', tool: 'slack.post' }] }), null, '이미 기본 있으면 제안 안 함');
  assert.equal(proposeDefaultTarget({ tool: 'slack.post', target: null }), null);
  assert.equal(replayDefaultTarget({ target: '#general' }).ok, true);
  assert.equal(replayDefaultTarget({ target: '8601204821', targetLabel: '오너' }).ok, true,
    '실행 식별자가 아니라 검증된 라벨로 replay한다');
  assert.equal(replayDefaultTarget({ target: '' }).ok, false);
  const prom = promoteDefaultTarget({ kind: 'default_target', tool: 'slack.post', target: '#general', targetLabel: '공지방' }, 5);
  assert.equal(defaultTargetFor([prom], 'slack.post'), '#general');
  assert.equal(prom.targetLabel, '공지방');
  assert.equal(defaultTargetFor([prom], 'mail.send'), null);
});

test('DefaultTarget 표면은 실행 식별자 대신 검증된 라벨만 보인다', () => {
  const visible = projectDefaultTarget({
    patternId: 'p1',
    kind: 'default_target',
    tool: 'telegram.send',
    target: '8601204821',
    targetLabel: '오너',
    scope: 'global',
  });
  assert.equal(visible.targetLabel, '오너');
  assert.equal(visible.target, undefined);
  assert.ok(!JSON.stringify(visible).includes('8601204821'));

  const legacy = projectDefaultTarget({
    kind: 'default_target', tool: 'telegram.send', target: '8601204821', scope: 'global',
  });
  assert.equal(legacy.targetLabel, '확인된 대상');
  assert.ok(!JSON.stringify(legacy).includes('8601204821'), '라벨 없는 과거 숫자 식별자도 노출하지 않는다');

  const humanTarget = projectDefaultTarget({
    kind: 'default_target', tool: 'slack.post', target: '#general', scope: 'global',
  });
  assert.equal(humanTarget.target, '#general', '기존 사람말 대상 응답 호환은 유지한다');
});

// ── 서버 학습 루프: 1회 대상 명시 → 후보 → 승격 → 2회째 질문 축소 → 되돌리기. A2 우회 없음. ──
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

async function withLearnServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-learn-'));
  const calls = [];
  const sender = { toolKind: 'send', async handler(args) { calls.push(args); return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  const traceStore = new TaskTraceStore(dir);
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ senders: { 'slack.post': sender } }), traceStore });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  try { return await fn(`http://127.0.0.1:${port}`, calls); }
  finally { await new Promise((r) => server.close(r)); }
}
async function send(base, sid, text) {
  const r1 = await (await post(base, '/turn', { sessionId: sid, text })).json();
  if (r1.kind !== 'approval') return r1; // clarify 등은 그대로 반환
  return (await post(base, '/turn', { sessionId: sid, approve: r1.pendingId })).json();
}

test('학습 루프: 1회 명시 → 후보 → 승격 → 2회째 clarify 없이 진행(질문 축소)', async () => {
  await withLearnServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    // 1) 채널 명시 전송 → 승인 → 실행 → 학습 후보 제안
    const done1 = await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    assert.equal(done1.kind, 'reply');
    assert.ok(done1.patternCandidate?.patternId, '반복 가능성 후보 제안');
    assert.equal(done1.patternCandidate.tool, 'slack.post');
    assert.equal(done1.patternCandidate.target, '#general');

    // 2) 승격 전(broad memory, narrow influence): 채널 없는 전송은 여전히 clarify(기록만으론 영향 0)
    const beforeClar = await (await post(base, '/turn', { sessionId: s.id, text: '슬랙에 배포 완료 올려줘' })).json();
    assert.equal(beforeClar.kind, 'clarify', '승격 전엔 기본 대상 영향 없음');

    // 3) 승인 + replay 게이트 통과 → 승격
    const conf = await (await post(base, '/patterns/confirm', { patternId: done1.patternCandidate.patternId })).json();
    assert.equal(conf.ok, true);
    assert.equal(conf.target, '#general');
    assert.equal(conf.scope, 'global', '승격에도 scope 보존(정직한 범위)');

    // 4) 2회째: 채널 없이 보내도 clarify 없이 승인 경로로(질문 축소). preview 대상은 학습된 기본.
    const s2 = await (await post(base, '/sessions')).json();
    const appr2 = await (await post(base, '/turn', { sessionId: s2.id, text: '슬랙에 배포 완료 올려줘' })).json();
    assert.equal(appr2.kind, 'approval', '기본 대상이 있어 clarify 없이 승인');
    const g = appr2.pending.find((p) => p.action === 'slack.post');
    assert.equal(g.preview.where, '#general', '학습된 기본 대상 사용');

    // 5) 되돌리기 → 다시 clarify(잘못 배운 건 되돌릴 수 있다)
    await post(base, '/patterns/rollback', { tool: 'slack.post' });
    const s3 = await (await post(base, '/sessions')).json();
    const afterRb = await (await post(base, '/turn', { sessionId: s3.id, text: '슬랙에 배포 완료 올려줘' })).json();
    assert.equal(afterRb.kind, 'clarify', '되돌린 뒤엔 다시 대상 확인');
  });
});

test('학습 루프: A2 우회 없음 — 기본 대상이 있어도 자동 전송하지 않고 승인을 거친다', async () => {
  await withLearnServer(async (base, calls) => {
    const s = await (await post(base, '/sessions')).json();
    const done1 = await send(base, s.id, '슬랙 #general에 회의 시작이라고 올려줘');
    await post(base, '/patterns/confirm', { patternId: done1.patternCandidate.patternId });
    const before = calls.length;
    // 채널 없이 요청 → 승인(approval)까지만. 승인 전엔 실제 전송 0(A2 유지).
    const s2 = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/turn', { sessionId: s2.id, text: '슬랙에 배포 완료 올려줘' })).json();
    assert.equal(r.kind, 'approval');
    assert.equal(calls.length, before, '승인 전엔 전송 0(기본 대상이어도 A2 우회 없음)');
  });
});

test('학습 루프: replay 실패면 승격하지 않는다(잘못된 대상 학습 방지)', async () => {
  await withLearnServer(async (base) => {
    const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-rp-'));
    const ts = new TaskTraceStore(dir);
    await ts.save({ traces: [], proposed: [{ patternId: 'bad', kind: 'default_target', tool: 'slack.post', target: '' }], promoted: [] });
    const srv = makeServer({ store: new SessionStore(dir), traceStore: ts });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    try {
      const r = await (await post(`http://127.0.0.1:${port}`, '/patterns/confirm', { patternId: 'bad' })).json();
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'replay_failed');
    } finally { await new Promise((r) => srv.close(r)); }
  });
});
