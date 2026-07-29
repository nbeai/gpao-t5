import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

// 서버를 임의 포트로 띄우고 실제 HTTP 로 검사한다(절대원칙 1: 산출물 레벨 검증).
// 세션 저장소는 temp dir 로 격리해 실제 홈을 오염시키지 않는다.
async function withServer(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-srv-'));
  const server = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => server.listen(0, r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base); }
  finally { await new Promise((r) => server.close(r)); }
}
const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const getj = async (base, path) => (await fetch(`${base}${path}`)).json();

test('GET / 는 Work Chat 화면을 준다', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Work Chat/);
  });
});

test('Work Chat 승인 상태 모듈을 실제 서버가 제공한다', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/approval-state.js`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/javascript/);
    assert.match(await res.text(), /approvalIsActive/);
  });
});

test('세션 생성 → 목록에 나타남', async () => {
  await withServer(async (base) => {
    assert.deepEqual((await getj(base, '/sessions')).sessions, []);
    const s = await (await post(base, '/sessions')).json();
    assert.match(s.id, /^[a-f0-9-]{36}$/);
    const { sessions } = await getj(base, '/sessions');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, s.id);
  });
});

test('빈 상태/첫 사용: 저장된 대화가 없어도 새 대화를 만들고 바로 시작할 수 있다', async () => {
  await withServer(async (base) => {
    const first = await getj(base, '/sessions');
    assert.deepEqual(first.sessions, [], '첫 실행은 빈 목록으로 시작');
    const s = await (await post(base, '/sessions')).json();
    assert.equal(s.title, '새 대화');
    assert.match(s.id, /^[a-f0-9-]{36}$/);
    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.deepEqual(reloaded.transcript, [], '새 대화는 기록 없이 바로 입력 가능한 상태');
  });
});

test('sessionId 없는 turn은 400', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/turn', { text: '안녕' });
    assert.equal(res.status, 400);
  });
});

// 지속성: 발화가 transcript에 남고 재접속(GET)으로 복원된다.
test('turn 결과가 세션 transcript에 지속되고 복원된다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    const reloaded = await getj(base, `/sessions/${s.id}`);
    // [user 안녕, assistant reply]
    assert.equal(reloaded.transcript.length, 2);
    assert.equal(reloaded.transcript[0].role, 'user');
    assert.equal(reloaded.transcript[1].role, 'assistant');
    assert.equal(reloaded.transcript[1].result.kind, 'reply');
    assert.match(reloaded.title, /안녕/, '첫 발화로 제목이 지어진다');
  });
});

test('같은 세션 동시 turn은 transcript를 유실하지 않는다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await Promise.all([
      post(base, '/turn', { sessionId: s.id, text: '첫 번째 요청' }),
      post(base, '/turn', { sessionId: s.id, text: '두 번째 요청' }),
    ]);
    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.equal(reloaded.transcript.length, 4, '두 turn 모두 user+assistant 쌍으로 남아야 한다');
    assert.deepEqual(
      reloaded.transcript.filter((e) => e.role === 'user').map((e) => e.text).sort(),
      ['두 번째 요청', '첫 번째 요청'].sort(),
    );
    assert.equal(reloaded.transcript.filter((e) => e.role === 'assistant').length, 2);
  });
});

// 격리: 두 세션의 대화가 서로 새지 않는다.
test('세션 간 대화 격리 — 한 세션 발화가 다른 세션에 안 보인다', async () => {
  await withServer(async (base) => {
    const a = await (await post(base, '/sessions')).json();
    const b = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: a.id, text: 'A 프로젝트 얘기' });
    await post(base, '/turn', { sessionId: b.id, text: 'B 프로젝트 얘기' });
    const ra = await getj(base, `/sessions/${a.id}`);
    const rb = await getj(base, `/sessions/${b.id}`);
    assert.ok(ra.transcript.some((e) => e.text === 'A 프로젝트 얘기'));
    assert.ok(!ra.transcript.some((e) => e.text === 'B 프로젝트 얘기'), '격리');
    assert.ok(rb.transcript.some((e) => e.text === 'B 프로젝트 얘기'));
  });
});

// 승인 재개: 세션 안에서 approve가 text 없이도 동작한다(회귀 지점 + 세션 배선).
test('세션 안 승인 재개(approve)는 text 없이도 200, 계획 이어받음', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r1 = await (await post(base, '/turn', { sessionId: s.id, text: '이 소식 슬랙 #공지에 올려줘' })).json();
    assert.equal(r1.kind, 'approval');
    const res2 = await post(base, '/turn', { sessionId: s.id, approve: r1.pendingId });
    assert.equal(res2.status, 200);
    assert.equal((await res2.json()).kind, 'reply');
  });
});

// Approval Lifecycle: 승인 대기가 서버 재시작(같은 저장소, 새 서버) 후에도 지속돼 이어실행된다.
test('승인 대기가 재시작 후에도 지속돼 이어실행된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-persist-'));
  const srv1 = makeServer({ store: new SessionStore(dir) });
  await new Promise((r) => srv1.listen(0, r));
  const b1 = `http://127.0.0.1:${srv1.address().port}`;
  const s = await (await post(b1, '/sessions')).json();
  const r1 = await (await post(b1, '/turn', { sessionId: s.id, text: '이 소식 슬랙 #공지에 올려줘' })).json();
  assert.equal(r1.kind, 'approval');
  await new Promise((r) => srv1.close(r)); // 재시작

  const srv2 = makeServer({ store: new SessionStore(dir) }); // 같은 저장소, 새 프로세스
  await new Promise((r) => srv2.listen(0, r));
  const b2 = `http://127.0.0.1:${srv2.address().port}`;
  try {
    const reloaded = await getj(b2, `/sessions/${s.id}`);
    assert.ok(reloaded.activePendingIds.includes(r1.pendingId), '재시작 후 승인 대기 유효');
    const r2 = await (await post(b2, '/turn', { sessionId: s.id, approve: r1.pendingId })).json();
    assert.equal(r2.kind, 'reply', '재시작 후에도 이어실행');
  } finally {
    await new Promise((r) => srv2.close(r));
  }
});

// 감사 보정: 만료된 승인 대기는 activePendingIds에 포함되지 않고, 파일에서도 정리된다(죽은 버튼 금지).
test('만료된 pending은 activePendingIds에서 제외되고 정리된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-expire-'));
  const store = new SessionStore(dir);
  const server = makeServer({ store });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await post(base, '/sessions')).json();
    // 유효 1 + 만료 1 을 직접 주입.
    const session = await store.load(s.id);
    session.pendingApprovals = {
      'active-1': { intent: {}, plan: {}, grantScope: { kind: 'once', expiresAt: Date.now() + 60000 } },
      'expired-1': { intent: {}, plan: {}, grantScope: { kind: 'once', expiresAt: Date.now() - 1000 } },
    };
    await store.save(session);

    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.deepEqual(reloaded.activePendingIds, ['active-1'], '만료는 active 아님');
    // 파일에서도 만료 정리(유효만 남음).
    const after = await store.load(s.id);
    assert.deepEqual(Object.keys(after.pendingApprovals), ['active-1'], '만료 pending 정리');
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// P6-1 기억: 선호 발화 → 후보(자동 승격 아님) → confirm → 승격.
// §12 · **사용자가 직접 말한 가역 선호는 묻지 않고 반영한다.**
// 예전 계약은 이 자리에서 카드를 띄우고 클릭을 요구했다. 그 확인이 지키는 경계를 따져보면
// 없었다 — 로컬 저장이고, 되돌리기·영수증·"반영 중 기억" 표면이 이미 있고, 기억은 권한이 아니다.
// 절대원칙 §0-A-2: 어느 경계를 지키는지 설명할 수 없는 확인은 마찰 회귀다.
// **보장은 사라지지 않았다.** 자리가 바뀌었을 뿐이다: 사전 승인 → 사후 교정(되돌리기).
test('명시한 가역 선호는 카드 없이 바로 반영되고, 되돌릴 수 있다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const t = await (await post(base, '/turn', { sessionId: s.id, text: '보고서는 항상 글로 받는 게 좋아' })).json();
    // ① 카드가 없다 — 같은 내용을 다시 묻지 않는다.
    assert.equal(t.memorySuggestion, undefined, '직접 말한 선호를 카드로 다시 물었다');
    // ② 무엇이 반영됐는지는 숨기지 않는다.
    assert.ok(t.memoryAutoApplied?.statement, '무엇을 기억했는지 사용자에게 말하지 않았다');
    assert.equal(t.memoryAutoApplied.rollbackable, true, '되돌릴 수 없는 것을 자동 반영했다');
    // ③ 실제로 반영돼 있고 후보로 남아 있지 않다.
    const m1 = await getj(base, '/memory');
    assert.equal(m1.promoted.length, 1, '말한 대로 반영되지 않았다');
    assert.equal(m1.candidates.length, 0);
    // ④ **사후 교정** — 사용자가 언제든 되돌린다. 자동성을 지키는 것은 승인이 아니라 이것이다.
    const back = await (await post(base, '/memory/rollback', { candidateId: m1.promoted[0].candidateId })).json();
    assert.equal(back.ok, true, `되돌리기가 실패했다: ${JSON.stringify(back)}`);
    const m2 = await getj(base, '/memory');
    assert.equal(m2.promoted.length, 0, '되돌렸는데 반영이 남아 있다');
  });
});

// P6-1 핵심 안전: 운영원리는 confirm 시 replay 게이트를 거쳐야 승격된다(replay 전 행동 영향 0).
test('운영원리는 replay 게이트를 통과해야 승격된다', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    await post(base, '/turn', { sessionId: s.id, text: '외부에 보낼 땐 무조건 나한테 확인받아' });
    const m1 = await getj(base, '/memory');
    assert.equal(m1.candidates[0].kind, 'operating_principle');
    assert.equal(m1.promoted.length, 0, 'confirm 전 승격 없음(영향 0)');
    const r = await (await post(base, '/memory/confirm', { candidateId: m1.candidates[0].candidateId })).json();
    assert.equal(r.ok, true, 'replay 통과 시 승격');
    const m2 = await getj(base, '/memory');
    assert.equal(m2.promoted.length, 1);
  });
});

// P6-2 Slice-3: 채널 인바운드는 같은 커널을 타되 자동 신뢰가 아니다 — mention-gating 통과해야 응답.
test('채널 인바운드: mention 없으면 gated, 있으면 응답(같은 흐름·자동신뢰 아님)', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r1 = await (await post(base, '/channel/inbound', { sessionId: s.id, channel: 'telegram', text: '그룹 잡담' })).json();
    assert.equal(r1.kind, 'gated', '트리거 없는 외부 메시지는 응답 안 함');
    const r2 = await (await post(base, '/channel/inbound', { sessionId: s.id, channel: 'telegram', text: '이거 봐줘', isMention: true })).json();
    assert.notEqual(r2.kind, 'gated', 'mention 있으면 같은 커널로 응답');
    // gated는 대화에 안 남고(조용), 응답만 남는다.
    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.ok(reloaded.transcript.some((e) => e.text === '이거 봐줘'));
    assert.ok(!reloaded.transcript.some((e) => e.text === '그룹 잡담'), 'gated 이벤트는 미기록');
  });
});

// 감사 보정 1: 등록 안 된 채널은 mention이 있어도 커널로 안 넘긴다(blocked, 미기록).
test('unknown 채널은 mention 있어도 응답·기록 안 함', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/channel/inbound', { sessionId: s.id, channel: 'unknown', text: '이거 봐줘', isMention: true })).json();
    assert.equal(r.kind, 'blocked');
    assert.equal(r.reason, 'unknown_channel');
    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.equal(reloaded.transcript.length, 0, 'unknown 채널은 transcript 미기록');
  });
});

// 감사 보정 2: 연결 끊긴 커넥터는 inbound를 열지 않는다(slack.channel=disconnected).
test('disconnected 채널은 mention 있어도 응답·기록 안 함', async () => {
  await withServer(async (base) => {
    const s = await (await post(base, '/sessions')).json();
    const r = await (await post(base, '/channel/inbound', { sessionId: s.id, channel: 'slack.channel', text: '이거 봐줘', isMention: true })).json();
    assert.equal(r.kind, 'blocked');
    assert.equal(r.reason, 'channel_not_ready');
    const reloaded = await getj(base, `/sessions/${s.id}`);
    assert.equal(reloaded.transcript.length, 0, 'disconnected 채널은 transcript 미기록');
  });
});

test('GET /connectors: auth(자격)와 approval(전송)을 두 축으로 — 전송은 항상 승인', async () => {
  await withServer(async (base) => {
    const { connectors } = await getj(base, '/connectors');
    assert.ok(connectors.length >= 1);
    assert.ok(connectors.every((c) => c.sendNeedsApproval === true), '연결돼도 전송은 승인');
    assert.ok(connectors.some((c) => c.readiness === 'ok'));
    assert.ok(connectors.some((c) => c.readiness === 'disconnected'));
  });
});

test('존재하지 않는 세션의 turn은 404', async () => {
  await withServer(async (base) => {
    const res = await post(base, '/turn', { sessionId: '00000000-0000-0000-0000-000000000000', text: '안녕' });
    assert.equal(res.status, 404);
  });
});
