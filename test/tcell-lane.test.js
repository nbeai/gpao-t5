// S3 · 대화 경계 승계. 계획 §4.7 + S3 완료 조건.
//
// 봉인 실측: 새 대화에서 "아까 그 최종본 이어서 정리해줘" 는 3/3 실패했다. 세 제품 모두
// 못 한 지점이라 T5 의 차별 목표다.
//
// 고정하는 것:
//   ① lane 의 사실 필드는 **성공한 receipt 에서만** 나온다(activeGoal 은 추정 라벨로만 부기)
//   ② scope 는 principal·workspace·artifact 신분으로 갈린다 — 파생 불가면 기본 미공급
//   ③ 같은 오너의 다른 표면은 이어받고, 다른 사용자는 절대 못 받는다(payload 위조 무효)
//   ④ 후보가 둘 이상이면 사실을 나열한다 — OS 가 임의로 하나 고르지 않는다
//   ⑤ artifact 는 경로+내용 digest 로 특정한다(같은 이름 다른 파일 구분)
//   ⑥ 새 대화에는 lane 이 **사실 블록**으로만 공급되고, 무엇을 이어받을지는 모델이 정한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import {
  deriveLanes, carryableLanes, laneFacts, LANE_CAPS,
} from '../src/kernel/l5-growth/tcell-lane.js';

const OWNER = 'local-owner';
const ref = (sessionId, turnSeq) => ({ sessionId, turnSeq });

/**
 * 성공한 파일 receipt 하나 — **제품이 실제로 남기는 형태 그대로**(`local-file.js` 는 해석된
 * 절대경로를 `result.path` 에 남긴다). 지어낸 필드로 픽스처를 만들면 검사만 통과하고 제품에서는
 * 아무것도 안 잡힌다 — S3 라이브가 그것을 잡았다.
 */
const fileReceipt = (path, digest, turnRef) => ({
  intended: '견적서 정리',
  actualCall: { tool: 'local.file', args: { action: 'write', path } },
  lifecycle: 'delivered',
  failureState: 'none',
  userSafeSummary: '정리본을 만들었어요.',
  result: { path, digest },
  turnRef,
});

const 지금 = Date.now();

function session(id, { turns = [], principalRef = OWNER, activeGoal = null, updatedAt = 지금 } = {}) {
  const transcript = [];
  const ledgerEntries = [];
  turns.forEach((t, i) => {
    const turnRef = ref(id, i + 1);
    transcript.push({ role: 'user', text: t.user, turnRef });
    transcript.push({ role: 'assistant', result: { kind: 'reply', reply: t.reply ?? '했어요' }, turnRef });
    if (t.receipt) ledgerEntries.push({ ...t.receipt, turnRef });
  });
  return { id, transcript, ledgerEntries, principalRef, activeGoal, createdAt: 1, updatedAt };
}

// ── ① 사실의 출처: receipt ────────────────────────────────────────────────
test('S3: lane 의 산출물은 성공한 receipt 에서만 나온다', () => {
  const s = session('s1', {
    turns: [{
      user: '견적서 최종본 정리해줘',
      receipt: fileReceipt('/root/견적서_최종_정리본.md', 'digest-A', ref('s1', 1)),
    }],
  });
  const [lane] = deriveLanes([s], { roots: ['/root'] });
  assert.equal(lane.scopeRef.principalRef, OWNER);
  assert.equal(lane.artifactRefs.length, 1);
  assert.equal(lane.artifactRefs[0].kind, 'file');
  assert.equal(lane.artifactRefs[0].digest, 'digest-A', '내용 digest 로 특정한다');
  assert.ok(lane.scopeRef.workspaceRef, 'workspace 신분이 파생된다');
});

test('S3: 실패한 receipt 는 산출물이 아니다', () => {
  const bad = { ...fileReceipt('/root/x.md', 'd', ref('s1', 1)), failureState: 'blocked', lifecycle: 'failed' };
  const [lane] = deriveLanes([session('s1', { turns: [{ user: '만들어줘', receipt: bad }] })], { roots: ['/root'] });
  assert.equal(lane, undefined, '성공 사실이 없으면 lane 도 없다');
});

test('S3: activeGoal 은 추정 라벨로만 부기되고 scope 판정에 쓰이지 않는다', () => {
  const s = session('s1', {
    activeGoal: { understoodTask: '모델이 짐작한 목표' },
    turns: [{ user: '정리해줘', receipt: fileReceipt('/root/a.md', 'd', ref('s1', 1)) }],
  });
  const [lane] = deriveLanes([s], { roots: ['/root'] });
  assert.equal(lane.assumedLabel, '모델이 짐작한 목표', '추정은 라벨로만');
  assert.ok(!JSON.stringify(lane.scopeRef).includes('짐작'), 'scope 는 추정에서 오지 않는다');
});

// ── ② scope 파생 불가 → 미공급 ────────────────────────────────────────────
test('S3: 허용 루트 밖 경로는 workspace 신분을 만들지 않는다(미공급)', () => {
  const s = session('s1', {
    turns: [{ user: '정리', receipt: fileReceipt('/다른곳/비밀.md', 'd', ref('s1', 1)) }],
  });
  const [lane] = deriveLanes([s], { roots: ['/root'] });
  assert.equal(lane, undefined, 'scope 를 못 만들면 lane 을 만들지 않는다');
});

// ── ③ 사용자 경계 ─────────────────────────────────────────────────────────
test('S3: 같은 오너의 다른 표면은 이어받는다', () => {
  const 웹 = session('web-1', {
    turns: [{ user: '견적서 정리', receipt: fileReceipt('/root/견적서.md', 'd', ref('web-1', 1)) }],
  });
  const lanes = deriveLanes([웹], { roots: ['/root'] });
  const 받을것 = carryableLanes(lanes, { principalRef: OWNER, sessionId: 'chat-2' });
  assert.equal(받을것.length, 1, '같은 principal 이면 표면이 달라도 공급');
});

test('S3: 다른 사용자에게는 공급하지 않는다', () => {
  const 남 = session('ch-1', {
    principalRef: 'channel-user-999',
    turns: [{ user: '정리', receipt: fileReceipt('/root/남의것.md', 'd', ref('ch-1', 1)) }],
  });
  const lanes = deriveLanes([남], { roots: ['/root'] });
  assert.deepEqual(carryableLanes(lanes, { principalRef: OWNER, sessionId: 'web-2' }), []);
});

test('S3: principalRef 가 없는 세션은 오너 lane 으로 취급하지 않는다', () => {
  const 미상 = session('x-1', {
    principalRef: null, // 구조분해 기본값이 살아나지 않도록 명시(undefined 면 OWNER 로 채워진다)
    turns: [{ user: '정리', receipt: fileReceipt('/root/a.md', 'd', ref('x-1', 1)) }],
  });
  const lanes = deriveLanes([미상], { roots: ['/root'] });
  assert.deepEqual(carryableLanes(lanes, { principalRef: OWNER, sessionId: 'web-2' }), [],
    '신분 미상은 기본 거부');
});

// ── ④ 다중 후보: 나열하되 고르지 않는다 ───────────────────────────────────
test('S3: 후보가 둘 이상이면 둘 다 사실로 나열한다', () => {
  const a = session('s1', {
    turns: [{ user: 'A 정리', receipt: fileReceipt('/root/A_최종.md', 'da', ref('s1', 1)) }],
    updatedAt: 지금 - 2000,
  });
  const b = session('s2', {
    turns: [{ user: 'B 정리', receipt: fileReceipt('/root/B_최종.md', 'db', ref('s2', 1)) }],
    updatedAt: 지금 - 1000,
  });
  const lanes = deriveLanes([a, b], { roots: ['/root'] });
  const 받을것 = carryableLanes(lanes, { principalRef: OWNER, sessionId: 'new' });
  assert.equal(받을것.length, 2, '둘 다 남는다');
  const facts = laneFacts(받을것);
  assert.equal(facts.length, 2, '모델 앞에 둘 다 사실로 놓는다');
  assert.ok(facts.every((f) => typeof f === 'string' && f.length > 0));
});

test('S3: 사실 블록에 내부 ID·원시 경로를 노출하지 않는다', () => {
  const s = session('s1', {
    turns: [{ user: '정리', receipt: fileReceipt('/root/보고/견적서_최종.md', 'd', ref('s1', 1)) }],
  });
  const facts = laneFacts(carryableLanes(deriveLanes([s], { roots: ['/root'] }), { principalRef: OWNER, sessionId: 'new' }));
  const 문장 = facts.join(' ');
  assert.ok(문장.includes('견적서_최종.md'), '사람이 아는 이름은 보인다');
  assert.ok(!문장.includes('/root/'), '원시 절대경로는 안 보인다');
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(문장), '내부 ID 는 안 보인다');
  assert.ok(!문장.includes('digest'), 'digest 원문도 안 보인다');
});

// ── ⑤ artifact 신분 ───────────────────────────────────────────────────────
test('S3: 같은 이름이라도 내용이 다르면 다른 산출물이다', () => {
  const a = session('s1', { turns: [{ user: 'v1', receipt: fileReceipt('/root/견적서.md', 'd1', ref('s1', 1)) }], updatedAt: 지금 - 2000 });
  const b = session('s2', { turns: [{ user: 'v2', receipt: fileReceipt('/root/견적서.md', 'd2', ref('s2', 1)) }], updatedAt: 지금 - 1000 });
  const lanes = deriveLanes([a, b], { roots: ['/root'] });
  const digests = lanes.flatMap((l) => l.artifactRefs.map((x) => x.digest));
  assert.deepEqual([...new Set(digests)].sort(), ['d1', 'd2'], '내용으로 갈린다');
});

test('S3: 대화 산출물(response)도 승계 대상이 된다', () => {
  const s = session('s1', { turns: [{ user: '정리해줘', reply: '정리한 최종본입니다 …' }] });
  const [lane] = deriveLanes([s], { roots: ['/root'], includeResponses: true });
  assert.ok(lane, '파일이 없어도 저장된 assistant 턴은 산출물이다');
  assert.equal(lane.artifactRefs[0].kind, 'response');
  assert.ok(lane.artifactRefs[0].turnRef, '어느 턴인지 남는다');
});

// ── ⑥ TTL·상한·현재 대화 제외 ─────────────────────────────────────────────
test('S3: 지금 이 대화의 lane 은 자기 자신에게 공급하지 않는다', () => {
  const s = session('s1', { turns: [{ user: '정리', receipt: fileReceipt('/root/a.md', 'd', ref('s1', 1)) }] });
  const lanes = deriveLanes([s], { roots: ['/root'] });
  assert.deepEqual(carryableLanes(lanes, { principalRef: OWNER, sessionId: 's1' }), [],
    '같은 대화는 recentTurns 가 이미 잇는다');
});

test('S3: TTL 이 지난 lane 은 공급하지 않는다', () => {
  const s = session('s1', {
    turns: [{ user: '정리', receipt: fileReceipt('/root/a.md', 'd', ref('s1', 1)) }],
    updatedAt: 0,
  });
  const lanes = deriveLanes([s], { roots: ['/root'] });
  const 늦게 = carryableLanes(lanes, { principalRef: OWNER, sessionId: 'new', now: LANE_CAPS.ttlMs + 1000 });
  assert.deepEqual(늦게, [], 'TTL 경과분은 조용히 빠진다');
});

test('S3: lane 상한을 넘기지 않는다', () => {
  const many = Array.from({ length: LANE_CAPS.total + 20 }, (_, i) => session(`s${i}`, {
    turns: [{ user: `정리 ${i}`, receipt: fileReceipt(`/root/${i}.md`, `d${i}`, ref(`s${i}`, 1)) }],
    updatedAt: 지금 - i,
  }));
  const lanes = deriveLanes(many, { roots: ['/root'] });
  assert.ok(lanes.length <= LANE_CAPS.total, `상한 ${LANE_CAPS.total} 이하`);
});

// ── 제품 경로: 새 대화에 사실이 실제로 공급되는가 ──────────────────────────
import { makeServer } from '../src/surface/server.js';
import { EventLog } from '../src/surface/event-log.js';
import { demoTools } from '../src/surface/demo-context.js';

const post = (base, p, b) => fetch(`${base}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
}).then((r) => r.json());

/** 모델이 무엇을 받았는지 들여다보는 스텁. */
function 엿보는모델(받은것) {
  return { async respond(tc) { 받은것.push(tc); return '알겠어요.'; } };
}

async function 서버(deps = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lane-srv-'));
  const store = new SessionStore(dir);
  const 받은것 = [];
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools: demoTools(), model: 엿보는모델(받은것), ...deps,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir, store, server, 받은것, base: `http://127.0.0.1:${server.address().port}` };
}

test('S3/제품: 새 대화가 다른 대화의 산출물을 사실로 받는다', async () => {
  const { store, server, base, 받은것 } = await 서버();
  try {
    const a = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: a.id, text: '견적서 최종본 정리해줘' });

    // 앞 대화가 산출물을 남긴 상태로 만든다(성공한 receipt — lane 의 유일한 출처).
    const s = await store.load(a.id);
    s.title = '견적서 정리';
    s.ledgerEntries.push({
      intended: '정리본 작성', lifecycle: 'delivered', failureState: 'none',
      userSafeSummary: '정리본을 만들었어요.', turnRef: ref(a.id, 1),
      actualCall: { tool: 'local.file', args: { action: 'write' } },
      result: { path: join(process.env.HOME ?? '', 'GPAO-T5', '견적서_최종_정리본.md'), digest: 'dg' },
    });
    await store.save(s);

    받은것.length = 0;
    const b = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: b.id, text: '아까 그 최종본 이어서 정리해줘' });

    const 본것 = JSON.stringify(받은것);
    assert.ok(본것.includes('견적서_최종_정리본.md'), '새 대화의 모델 입력에 산출물 이름이 있다');
    assert.ok(!본것.includes(process.env.HOME ?? '/Users'), '원시 절대경로는 넣지 않는다');
  } finally { server.close(); }
});

test('S3/제품: 같은 대화에는 자기 lane 을 공급하지 않는다', async () => {
  const { store, server, base, 받은것 } = await 서버();
  try {
    const a = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: a.id, text: '정리해줘' });
    const s = await store.load(a.id);
    s.ledgerEntries.push({
      intended: '작성', lifecycle: 'delivered', failureState: 'none', userSafeSummary: '했어요',
      turnRef: ref(a.id, 1), actualCall: { tool: 'local.file', args: { action: 'write' } },
      result: { path: join(process.env.HOME ?? '', 'GPAO-T5', '내것.md'), digest: 'd' },
    });
    await store.save(s);

    받은것.length = 0;
    await post(base, '/turn', { sessionId: a.id, text: '이어서 해줘' });
    assert.ok(!JSON.stringify(받은것).includes('이어받을 수 있는 작업'), '같은 대화는 공급 0');
  } finally { server.close(); }
});

test('S3/제품: 신분이 다른 대화의 작업은 넘어가지 않는다', async () => {
  const { store, server, base, 받은것 } = await 서버();
  try {
    // 다른 사용자(채널 미연결)의 대화를 직접 심는다.
    const 남 = await store.create('남의 대화', { principalRef: 'channel-user-999' });
    남.ledgerEntries.push({
      intended: '작성', lifecycle: 'delivered', failureState: 'none', userSafeSummary: '했어요',
      turnRef: ref(남.id, 1), actualCall: { tool: 'local.file', args: { action: 'write' } },
      result: { path: join(process.env.HOME ?? '', 'GPAO-T5', '남의비밀.md'), digest: 'd' },
    });
    남.transcript.push({ role: 'user', text: '비밀 작업', turnRef: ref(남.id, 1) });
    await store.save(남);

    받은것.length = 0;
    const 내대화 = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: 내대화.id, text: '아까 그거 이어서' });
    assert.ok(!JSON.stringify(받은것).includes('남의비밀'), '다른 사용자 작업은 절대 안 보인다');
  } finally { server.close(); }
});

test('S3/제품: 승계 계산이 실패해도 대화는 막히지 않는다', async () => {
  const { server, base } = await 서버({
    store: Object.assign(Object.create(SessionStore.prototype), {
      dir: await mkdtemp(join(tmpdir(), 'lane-bad-')),
      loadAll: async () => { throw new Error('목록 실패'); },
    }),
  });
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: '안녕' });
    assert.equal(r.kind, 'reply', '승계는 편의다 — 실패해도 대화는 돈다');
  } finally { server.close(); }
});

// ── 감사 P1: 채널 경로에도 lane 이 공급되는가 ──────────────────────────────
// 웹 /turn 만 배선하고 채널 입구를 빠뜨리면, 허용된 채널 사용자는 웹에서 만든 산출물을
// 새 채널 대화에서 이어받지 못한다(계획 §4.7 "같은 오너 웹↔binding 채널 승계" 미충족).
import { AllowlistStore } from '../src/surface/allowlist-store.js';

async function 채널서버() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lane-ch-'));
  const store = new SessionStore(dir);
  const allow = new AllowlistStore(dir);
  await allow.allow('telegram', { userId: 'owner-1', label: '오너' });
  const 받은것 = [];
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools: demoTools(),
    allowlistStore: allow, model: 엿보는모델(받은것),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir, store, allow, server, 받은것, base: `http://127.0.0.1:${server.address().port}` };
}

/** 웹에서 산출물을 남긴 대화 하나를 심는다(성공한 receipt — lane 의 유일한 출처). */
async function 웹산출물(store, name = '웹정리본.md') {
  const s = await store.create('웹에서 만든 정리', { principalRef: 'local-owner' });
  s.transcript.push({ role: 'user', text: '정리해줘', turnRef: ref(s.id, 1) });
  s.transcript.push({ role: 'assistant', result: { kind: 'reply', reply: '했어요' }, turnRef: ref(s.id, 1) });
  s.ledgerEntries.push({
    intended: '정리본 작성', lifecycle: 'delivered', failureState: 'none',
    userSafeSummary: '만들었어요.', turnRef: ref(s.id, 1),
    actualCall: { tool: 'local.file', args: { action: 'write' } },
    result: { path: join(process.env.HOME ?? '', 'GPAO-T5', name), digest: 'dg' },
  });
  await store.save(s);
  return s;
}

test('S3/P1: 허용된 채널 사용자는 웹에서 만든 산출물을 채널 대화에서 이어받는다', async () => {
  const { store, server, 받은것 } = await 채널서버();
  try {
    await 웹산출물(store);
    받은것.length = 0;
    const r = await server.handleChannelMessage({
      channel: 'telegram', chatId: 'room-1', userId: 'owner-1',
      text: '아까 그 최종본 이어서 정리해줘', isDirectMessage: true,
    });
    assert.ok(r, '채널 턴이 돌았다');
    const 본것 = JSON.stringify(받은것);
    assert.ok(본것.includes('웹정리본.md'), '채널 대화의 모델 입력에 웹 산출물이 사실로 온다');
    assert.ok(!본것.includes(join(process.env.HOME ?? '', 'GPAO-T5')), '원시 절대경로는 없다');
  } finally { server.close(); }
});

test('S3/P1: 허용목록에 없는 채널 사용자에게는 공급 0', async () => {
  const { store, server, 받은것 } = await 채널서버();
  try {
    await 웹산출물(store, '오너만의정리본.md');
    받은것.length = 0;
    await server.handleChannelMessage({
      channel: 'telegram', chatId: 'room-9', userId: '낯선사람',
      text: '아까 그거 이어서', isDirectMessage: true,
    });
    assert.ok(!JSON.stringify(받은것).includes('오너만의정리본'), '남에게는 절대 안 간다');
  } finally { server.close(); }
});

test('S3/P1: payload 가 principalRef 를 주장해도 서버 저장 신분만 쓴다', async () => {
  const { store, server, 받은것 } = await 채널서버();
  try {
    await 웹산출물(store, '위조표적.md');
    받은것.length = 0;
    await server.handleChannelMessage({
      channel: 'telegram', chatId: 'room-8', userId: '낯선사람',
      principalRef: 'local-owner', // 위조 시도
      text: '아까 그거 이어서', isDirectMessage: true,
    });
    assert.ok(!JSON.stringify(받은것).includes('위조표적'), 'payload 주장은 무효다');
  } finally { server.close(); }
});
