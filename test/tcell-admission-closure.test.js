// TG-5A 종료 행렬 반대시험 — 행렬 1·4·5·9.
//
// 이 파일은 `tcell-admission.test.js`(계약 20건 + 관통)와 **다른 것을 증명한다**:
// 여기 있는 것은 전부 "그 계약이 **실제 제품 경로에서** 지켜지는가"의 반대시험이다.
// 각 시험은 보강 전 코드에서 실패해야 한다 — 그 사실을 증거 문서에 건수로 적는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTurnFacts, grantKey } from '../src/kernel/l1-intent/turn-facts.js';
import {
  buildAdmissionSnapshot, admitFromSnapshot, ADMISSION_REASONS,
} from '../src/kernel/l1-intent/tcell-admission.js';
import {
  TCellRegistry, TCellObserver,
  grantFromConsumedApproval, grantSnapshotFromLedger, grantLedgerKey,
} from '../src/surface/tcell-store.js';
import { makeTCellCandidate } from '../src/kernel/l5-growth/tcell-core.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 영수증 = (over = {}) => ({ userSafeSummary: '했어요.', failureState: 'none', action: 'local.terminal 실행', ...over });

// ── 행렬 1 · 고정 시간창 — 오래된 실패는 감쇠한다 ──

test('행렬 1: 직전 턴 밖의 영수증은 이번 턴 사실이 되지 않는다(오래된 실패 감쇠)', () => {
  // 원장에 네 건: 0·1 은 옛 턴(실패), 2·3 은 직전 턴(성공).
  const 원장 = [
    영수증({ failureState: 'tool_error' }), 영수증({ failureState: 'tool_error' }),
    영수증(), 영수증(),
  ];
  const 창 = { previousTurn: 원장.slice(2, 4), previousTurnStart: 2 };
  const { requestFacts } = buildTurnFacts({ stage: 'pre_model', sessionId: 's', ledgerWindow: 창 });
  const 문구 = requestFacts.facts.map((f) => f.fact);

  assert.ok(문구.includes('실행 성공 직후'), '직전 턴 성공이 사실이 되지 않았다');
  assert.ok(!문구.includes('실패 직후'),
    `두 턴 전 실패가 아직 "실패 직후" 로 살아 있다: ${JSON.stringify(문구)}`);
  // 참조도 창 안의 위치를 가리킨다 — 옛 위치를 가리키면 근거 하강이 엉뚱한 곳으로 간다.
  assert.ok(requestFacts.facts.every((f) => !f.ref || /:(2|3)$/.test(f.ref) || !f.ref.startsWith('ledger:')),
    `창 밖 원장 위치를 참조한다: ${JSON.stringify(requestFacts.facts.map((f) => f.ref))}`);

  // 창이 비면(첫 턴) 영수증 사실도 없다 — 없는 것을 지어내지 않는다.
  const 첫턴 = buildTurnFacts({ stage: 'pre_model', sessionId: 's', ledgerWindow: { previousTurn: [], previousTurnStart: 0 } });
  assert.ok(!첫턴.requestFacts.facts.some((f) => f.fact.includes('직후')));
});

test('행렬 1: 실패 창이면 실패 사실만, 성공 창이면 성공 사실만 만든다', () => {
  const 실패창 = buildTurnFacts({
    stage: 'pre_model', sessionId: 's',
    ledgerWindow: { previousTurn: [영수증({ failureState: 'tool_error' })], previousTurnStart: 0 },
  }).requestFacts.facts.map((f) => f.fact);
  assert.ok(실패창.includes('실패 직후') && 실패창.includes('직전 턴 실패'));
  assert.ok(!실패창.includes('실행 성공 직후'), '실패 턴이 성공 사실을 만들었다');
  assert.ok(실패창.includes('실패 종류:tool_error'));
});

// ── 행렬 3 · 정규식 추정치를 확정 권한으로 쓰지 않는다 ──

test('행렬 3: intent 의 등급 추정은 pre_model 에서 확정 권한이 되지 않는다', () => {
  const intent = { authorityBoundary: 'A2', goal: '보내기' };   // intent.js 의 정규식이 만든 추정
  const pre = buildTurnFacts({ stage: 'pre_model', intent, sessionId: 's' });
  assert.equal(pre.authorityFacts.tierKnown, false, '정규식 추정이 확정 권한으로 쓰였다');
  assert.equal(pre.authorityFacts.actionTier, null);
  assert.equal(pre.authorityFacts.tierSource, 'intent_estimate');
  assert.equal(pre.authorityFacts.estimatedTier, 'A2', '추정치 자체는 참고로 남아야 한다');

  // 계획이 실제로 서면 그때 커널 판정이 사실이 된다.
  const post = buildTurnFacts({
    stage: 'post_plan', intent, sessionId: 's',
    plan: { toolsToUse: [], needsApproval: [{ action: 'slack.post', tier: 'A2' }] },
  });
  assert.equal(post.authorityFacts.tierKnown, true);
  assert.equal(post.authorityFacts.actionTier, 'A2');
  assert.equal(post.authorityFacts.tierSource, 'plan');

  // 계획이 있고 승인 경계가 없으면 그것도 커널 판정이다(A0) — "모른다"가 아니다.
  const 승인없음 = buildTurnFacts({ stage: 'post_plan', intent, sessionId: 's', plan: { toolsToUse: ['web.collect'], needsApproval: [] } });
  assert.equal(승인없음.authorityFacts.actionTier, 'A0');
  assert.equal(승인없음.authorityFacts.tierKnown, true);
});

// ── 행렬 4 · pending 은 grant 가 아니다 ──

test('행렬 4: once 승인은 소비돼도 권한 원장에 들어가지 않는다', () => {
  const 계획 = { toolsToUse: ['slack.post'], needsApproval: [{ action: 'slack.post', tier: 'A2' }] };
  const args = { 'slack.post': { target: '#general' } };
  // 제품의 일반 턴 승인은 전부 `once` 다(turn.js). 그건 재사용 불가이므로 권한이 아니다.
  assert.equal(
    grantFromConsumedApproval({ grantScope: { kind: 'once', expiresAt: 9999 }, plan: 계획, sendArgs: args }, { scope: 'project:p', now: 1 }),
    null, 'once 승인이 권한 원장에 들어갔다',
  );
  // 재사용 범위를 가진 승인만 bounded 로 승격한다.
  const g = grantFromConsumedApproval({ grantScope: { kind: 'session', expiresAt: 9999 }, plan: 계획, sendArgs: args }, { scope: 'project:p', now: 1 });
  assert.equal(g.kind, 'bounded');
  assert.equal(g.action, 'slack.post');
  assert.equal(g.target, '#general');
  assert.equal(g.scope, 'project:p');
  // 대상·범위 중 하나라도 모르면 남기지 않는다 — 무엇을 허락했는지 말할 수 없다.
  assert.equal(grantFromConsumedApproval({ grantScope: { kind: 'session' }, plan: 계획, sendArgs: {} }, { scope: 'project:p' }), null);
  assert.equal(grantFromConsumedApproval({ grantScope: { kind: 'persist' }, plan: 계획, sendArgs: args }, { scope: null }), null);
});

test('행렬 4: 조회 키는 admission 과 원장이 같은 규칙으로 만든다', () => {
  const 요소 = { action: 'slack.post', target: '#general', scope: 'project:p' };
  assert.equal(grantKey(요소), grantLedgerKey(요소), '두 층이 서로 다른 키를 만든다(조회가 영영 실패한다)');
  assert.equal(grantKey({ action: 'x', target: null, scope: 'y' }), null);
  assert.equal(grantLedgerKey({}), null);
});

test('행렬 4: 부여된 권한만 A2 계획 역할을 연다 — 철회·만료는 즉시 닫힌다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-grant-'));
  const cell = makeTCellCandidate({
    principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' },
    boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
    anchor: { project: dir, subject: null },
    geometry: { radius: 'task', depth: 0, sphereStability: 0 },
  });
  cell.id = 'cell-grant';
  cell.state = 'M3_limited';
  cell.authority = { ...cell.authority, allowedInfluence: ['none', 'plan_hint'], requiresUserConfirmation: false };
  await new TCellRegistry(dir).upsert(cell, null);
  const ob = new TCellObserver(dir);
  await ob.observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [영수증()] });

  const 계획 = { toolsToUse: ['slack.post'], needsApproval: [{ action: 'slack.post', tier: 'A2' }] };
  const args = { 'slack.post': { target: '#general' } };
  const 창 = { previousTurn: [영수증()], previousTurnStart: 0 };
  const 판정 = async (grants) => {
    const snap = await buildAdmissionSnapshot({
      registry: new TCellRegistry(dir), observer: ob,
      grantStore: () => grantSnapshotFromLedger(grants),
      scope: { project: dir },
    });
    const 재료 = buildTurnFacts({
      stage: 'post_plan', plan: 계획, sendArgs: args, sessionId: 's',
      projectId: dir, ledgerWindow: 창,
    });
    return admitFromSnapshot(snap, { ...재료, stage: 'post_plan', now: 1000 }).trace;
  };

  // ① 원장이 비면 A2 계획 역할은 못 들어온다. 사유는 **정확히 권한**이다.
  const 없음 = await 판정([]);
  assert.equal(없음.admitted.length, 0, 'grant 없이 A2 계획 역할이 열렸다');
  assert.equal(없음.rejected[0].reason, ADMISSION_REASONS.authority);

  // ② 실제로 부여된 bounded grant 가 있으면 참고 가능해진다(실행 승인은 여전히 아니다).
  const g = grantFromConsumedApproval(
    { grantScope: { kind: 'session', expiresAt: 9999 }, plan: 계획, sendArgs: args },
    { scope: `project:${dir}`, now: 1 },
  );
  const 있음 = await 판정([g]);
  assert.equal(있음.admitted.length, 1, `부여된 권한인데도 막혔다: ${JSON.stringify(있음.rejected)}`);
  assert.equal(있음.admitted[0].role, 'plan_hint');

  // ③ 철회하면 즉시 닫힌다.
  assert.equal((await 판정([{ ...g, revoked: true }])).admitted.length, 0, '철회한 권한이 아직 열려 있다');
  // ④ 만료도 마찬가지 — 원장에 남아 있다고 유효한 것이 아니다.
  assert.equal((await 판정([{ ...g, expiresAt: 10 }])).admitted.length, 0, '만료한 권한이 아직 열려 있다');
  // ⑤ 다른 대상에 부여된 권한은 이번 대상을 열지 않는다.
  assert.equal((await 판정([{ ...g, key: grantLedgerKey({ action: 'slack.post', target: '#other', scope: `project:${dir}` }), target: '#other' }])).admitted.length, 0,
    '다른 대상의 권한이 이번 대상을 열었다');
});

// ── 행렬 5 · 승인·거절·채널이 같은 준비 경계를 지난다 ──

async function 승인관통() {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-approve-'));
  const cell = makeTCellCandidate({
    principle: { statement: '승인 뒤에는 결과를 확인한다', type: 'execution' },
    boundary: { validWhen: ['승인 결정:approved'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
    anchor: { project: dir, subject: null },
    geometry: { radius: 'task', depth: 0, sphereStability: 0 },
  });
  cell.id = 'cell-approve';
  cell.state = 'M2_replayed';
  cell.authority = { ...cell.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
  await new TCellRegistry(dir).upsert(cell, null);
  await new TCellObserver(dir).observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [영수증()] });

  let 첫 = true;
  const 모델 = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'slack.post', args: { target: '#general', text: '보고' } }] }; }
    return { text: '했어요', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const 턴 = async (body, sid) => (await (await fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: sid, ...body }),
  })).json());
  try {
    const sess = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    첫 = true;
    const 카드 = await 턴({ text: '이 내용 슬랙에 올려줘' }, sess.id);
    const pendingId = 카드.pendingId ?? 카드.approval?.pendingId ?? 카드.needsApproval?.[0]?.pendingId;
    첫 = true;
    const 승인 = pendingId ? await 턴({ approve: pendingId }, sess.id) : null;
    첫 = true;
    const 거절 = await 턴({ reject: '없는-id' }, sess.id);
    return { 카드, 승인, 거절, dir };
  } finally { await new Promise((r) => server.close(r)); }
}

test('행렬 5: 승인·거절 경로도 admission 준비 경계를 지난다', async () => {
  const r = await 승인관통();
  assert.ok(r.카드.principleTrace, '일반 발화 턴에 trace 가 없다');

  // 승인 턴 — 예전에는 이 분기가 admission 앞에서 return 해서 trace 가 아예 없었다.
  assert.ok(r.승인, `승인 카드가 만들어지지 않았다: ${JSON.stringify(r.카드).slice(0, 300)}`);
  assert.ok(r.승인.principleTrace, '승인 턴이 admission 을 지나지 않았다');
  assert.deepEqual(r.승인.principleTrace.passes.map((p) => p.stage), ['pre_model', 'post_plan'],
    '승인 턴이 두 단계를 지나지 않았다');
  assert.equal(r.승인.principleTrace.retrievedIds.length, 1, '승인 턴이 실제 registry 를 읽지 않았다');
  // shadow: 승인 턴에서도 영향은 0이다.
  assert.deepEqual(r.승인.principleTrace.influencedPlan, []);
  assert.deepEqual(r.승인.principleTrace.influencedAnswer, []);

  // 거절 턴 — 유령 ID 라 소비는 없지만 **준비 경계는 지난다**(pre_model 만).
  assert.ok(r.거절.principleTrace, '거절 턴이 admission 을 지나지 않았다');
  assert.deepEqual(r.거절.principleTrace.passes.map((p) => p.stage), ['pre_model'],
    '소비하지 않은 거절이 계획 단계까지 돌았다');
});

// ── 행렬 9 · 과거 세션 근거와 범위 격리 ──

test('행렬 9: 다른 작업 공간의 원리는 거절이 아니라 조회 자체를 하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-scope-'));
  const 만들기 = (id, project) => {
    const c = makeTCellCandidate({
      principle: { statement: `${id} 원리`, type: 'workflow' },
      boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
      trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
      anchor: { project, subject: null },
      geometry: { radius: 'task', depth: 0, sphereStability: 0 },
    });
    c.id = id; c.state = 'M2_replayed';
    c.authority = { ...c.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
    return c;
  };
  const reg = new TCellRegistry(dir);
  await reg.upsert(만들기('여기', dir), null);
  await reg.upsert(만들기('저기', '/다른/작업공간'), null);
  await reg.upsert(만들기('범위미상', null), null);
  const ob = new TCellObserver(dir);
  await ob.observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [영수증()] });

  const snap = await buildAdmissionSnapshot({ registry: reg, observer: ob, scope: { project: dir } });
  assert.ok(snap.candidateIds.includes('여기'));
  assert.ok(!snap.candidateIds.includes('저기'), '다른 작업 공간의 원리를 읽었다(범위 횡단 열람)');
  assert.equal(snap.scopeFiltered, 1, '읽지 않은 수가 사실로 남지 않았다');
  // 범위 미상(anchor 없음)은 거르지 않는다 — 범위판정이 `scope_unknown` 으로 정직하게 막는다.
  assert.ok(snap.candidateIds.includes('범위미상'));

  const 재료 = buildTurnFacts({
    stage: 'pre_model', sessionId: 's', projectId: dir,
    ledgerWindow: { previousTurn: [영수증()], previousTurnStart: 0 },
  });
  const trace = admitFromSnapshot(snap, { ...재료, stage: 'pre_model', now: 1000 }).trace;
  assert.equal(trace.scopeFiltered, 1);
  assert.ok(trace.admitted.some((a) => a.id === '여기'));
  assert.ok(!trace.retrievedIds.includes('저기'), '다른 작업 공간의 원리가 판정 대상에 올랐다');

  // **범위 미상(anchor 없음)은 막지 않는다** — 의도된 계약이다.
  //   `경계 판정 unknown 은 입장 근거도 단독 거절 근거도 아니다`(과잉 차단 금지)와 같은 정신이고,
  //   명세 §6 이 막는 것은 "경계를 **넘는** 조회"이지 "경계가 없는 것"이 아니다.
  //   anchor 를 안 채우던 시절에 만들어진 세포와 legacy 이관분이 여기 속한다.
  //   이 줄이 뒤집히면 그건 과잉 차단이 들어온 것이다.
  assert.ok(trace.admitted.some((a) => a.id === '범위미상'),
    '범위를 모르는 원리를 막았다 — 과잉 차단이다');
  // 반대 방향: 현재 범위를 **모르면** 범위 있는 세포는 입장하지 못한다(확인 못 한 것은 근거가 아니다).
  const 범위없는요청 = buildTurnFacts({
    stage: 'pre_model', sessionId: 's',
    ledgerWindow: { previousTurn: [영수증()], previousTurnStart: 0 },
  });
  const t2 = admitFromSnapshot(snap, { ...범위없는요청, stage: 'pre_model', now: 1000 }).trace;
  assert.equal(t2.rejected.find((x) => x.id === '여기')?.reason, ADMISSION_REASONS.scopeUnknown);
});

test('행렬 9: 세포가 0건이면 확인·권한 원장을 만들지도 않는다(없는 것을 확인하는 비용도 비용이다)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-empty-'));
  let 확인호출 = 0; let 권한호출 = 0;
  const snap = await buildAdmissionSnapshot({
    registry: new TCellRegistry(dir),
    observer: new TCellObserver(dir),
    confirmationStore: () => { 확인호출 += 1; return { get: () => null }; },
    grantStore: () => { 권한호출 += 1; return { get: () => null }; },
    scope: { project: dir },
  });
  assert.deepEqual(snap.candidateIds, []);
  assert.equal(확인호출, 0, '세포가 0건인데 확인 원장을 만들었다');
  assert.equal(권한호출, 0, '세포가 0건인데 권한 원장을 만들었다');
  assert.equal(snap.status, 'ok', '빈 저장소를 degraded 로 읽었다');
});

test('행렬 9: registry 읽기 캐시는 파일이 바뀌면 반드시 다시 읽는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-cache-'));
  const reg = new TCellRegistry(dir);
  const c = makeTCellCandidate({
    principle: { statement: '캐시 시험', type: 'workflow' },
    boundary: { validWhen: ['x'], invalidWhen: ['y'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['r'], corrections: [] },
    anchor: { project: dir, subject: null },
    geometry: { radius: 'task', depth: 0, sphereStability: 0 },
  });
  c.id = 'c1';
  await reg.upsert(c, null);
  assert.equal((await reg.load()).cells.length, 1);
  assert.equal((await reg.load()).cells.length, 1, '두 번째 읽기가 달라졌다');

  // 같은 인스턴스의 변경은 자기 캐시를 버린다.
  const c2 = { ...c, id: 'c2' };
  await reg.upsert(c2, null);
  assert.equal((await reg.load()).cells.length, 2, '변경 뒤에도 옛 캐시를 돌려줬다');

  // 다른 인스턴스(다른 프로세스 흉내)가 쓴 것도 mtime+크기로 잡힌다.
  const 밖 = new TCellRegistry(dir);
  await 밖.upsert({ ...c, id: 'c3' }, null);
  assert.equal((await reg.load()).cells.length, 3, '밖에서 바뀐 파일을 캐시가 가렸다');

  // 캐시를 돌려줄 때도 **복사본**이다 — 호출자가 만져도 다음 읽기가 오염되지 않는다.
  const a = await reg.load();
  a.cells.pop();
  assert.equal((await reg.load()).cells.length, 3, '캐시된 목록이 호출자에게 오염됐다');
});
