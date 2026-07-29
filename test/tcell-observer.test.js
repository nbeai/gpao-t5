// TG-1 관찰층 shadow mode — 보강 종료 조건 9개(감사 2026-07-29 고정 범위) 반대시험.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, appendFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TCellObserver } from '../src/surface/tcell-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeSendPreview } from '../src/runtime/channel-sender.js';

const 영수증 = (over = {}) => ({ action: '폴더 봄', userSafeSummary: '봤어요.', failureState: 'none', ...over });

test('조건1: 원장 위치가 신분 — 실패 후 재시도 가능, 재시작 후에도 중복 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1a-'));
  // ① 기록 불능(growth 자리를 파일로 봉쇄) → 실패 → 완료 키 미등록
  await writeFile(join(dir, 'growth'), '봉쇄', 'utf8');
  const ob = new TCellObserver(dir);
  const 턴 = { sessionId: 's1', ledgerStart: 3, turnReceipts: [영수증()], now: 1 };
  assert.equal((await ob.observeTurn(턴)).recorded, 0);
  // ② 저장소 복구 → 같은 턴 재시도 → duplicate 가 아니라 기록된다(영구 소실 방지)
  await rm(join(dir, 'growth'));
  assert.equal((await ob.observeTurn(턴)).recorded, 1, '실패 후 재시도가 duplicate 로 막혔다');
  // ③ 같은 프로세스 재관찰 → 중복 0
  assert.equal((await ob.observeTurn(턴)).recorded, 0);
  // ④ 재시작(새 관찰자) → 로그에서 완료 키 복원 → 중복 0
  const ob2 = new TCellObserver(dir);
  assert.equal((await ob2.observeTurn(턴)).recorded, 0, '재시작 후 같은 receipt 가 다시 기록됐다');
  const { events } = await ob2.load({ sessionId: 's1' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].receiptRefs, ['ledger:s1:3'], '원장 위치 신분이 아니다');
});

test('조건4·5: 비밀 표식 원문 0 + 파생 관찰 비가독 + 파일 0600', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1b-'));
  const ob = new TCellObserver(dir);
  await ob.observeTurn({ sessionId: 's', ledgerStart: 0, now: 1,
    turnReceipts: [영수증({ containsSecret: true, userSafeSummary: '토큰 sk-비밀값 을 읽음', failureState: 'blocked', nextSafeAction: 'sk-비밀값 으로 재시도' })] });
  const raw = await readFile(join(dir, 'growth', 'observations.jsonl'), 'utf8');
  assert.ok(!raw.includes('sk-비밀값'), '비밀 표식 원문이 파일에 남았다');
  const events = raw.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(events.length, 2); // tool_result + recovery
  assert.ok(events.every((e) => e.privacy.containsSecret && e.privacy.modelReadable === false), '파생 관찰이 모델 가독이다');
  const mode = (await stat(join(dir, 'growth', 'observations.jsonl'))).mode & 0o777;
  assert.equal(mode, 0o600, `파일 권한이 0600 이 아니다: ${mode.toString(8)}`);
});

test('조건6·7: 잘못된 schema 격리 + scope 없는 조회 차단 + 읽기 오류 정직', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1c-'));
  const ob = new TCellObserver(dir);
  await ob.observeTurn({ sessionId: 'sA', ledgerStart: 0, turnReceipts: [영수증()], now: 1 });
  await ob.observeTurn({ sessionId: 'sB', ledgerStart: 0, turnReceipts: [영수증()], now: 2 });
  await appendFile(join(dir, 'growth', 'observations.jsonl'), '{"type":"tool_result","schemaVersion":99}\n', 'utf8');
  const 무범위 = await ob.load();
  assert.equal(무범위.events.length, 0);
  assert.ok(무범위.error?.includes('scope'), 'scope 없는 조회가 열렸다');
  const a = await ob.load({ sessionId: 'sA' });
  assert.equal(a.events.length, 1, '범위 횡단이 막히지 않았다');
  assert.equal(a.corrupted, 1, 'schema 불량이 정상 이벤트로 읽혔다');
  const 전체 = await ob.loadAllForAudit();
  assert.equal(전체.events.length, 2);
});

test('조건3: 정정(되돌리기)·자동화 결과가 실제 생산 경로 모양으로 관찰된다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1d-'));
  const ob = new TCellObserver(dir);
  assert.equal((await ob.observeCorrection({ what: '사용자가 기억 반영을 되돌렸어요', ref: 'memory:rollback:c1', now: 1 })).recorded, true);
  assert.equal((await ob.observeCorrection({ what: '중복', ref: 'memory:rollback:c1', now: 2 })).recorded, false);
  assert.equal((await ob.observeAutomationResult({ jobId: 'j1', executionIndex: 0, receipt: 영수증(), now: 3 })).recorded, true);
  assert.equal((await ob.observeAutomationResult({ jobId: 'j1', executionIndex: 0, receipt: 영수증(), now: 4 })).recorded, false, '같은 실행이 중복 관찰됐다');
  assert.equal((await ob.observeAutomationResult({ jobId: 'j1', executionIndex: 1, receipt: 영수증(), now: 5 })).recorded, true, '다음 실행이 막혔다');
  const { events } = await ob.loadAllForAudit();
  assert.deepEqual(events.map((e) => e.type).sort(), ['automation_result', 'automation_result', 'user_correction']);
});

test('조건2·8: 옛 승인 ID 는 관찰 0, 실제 승인은 정확히 1 — 답변은 항상 성공(영향 0)', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1e-'));
  const hand = { toolKind: 'send', previewOf: makeSendPreview({ channel: 'telegram' }),
    async handler() { return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  let 첫 = true;
  const 모델 = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'telegram.send', args: { text: '시험', target: '111' } }] }; }
    return { text: '보냈어요', toolCalls: [] };
  } };
  const observer = new TCellObserver(dir);
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(),
    tools: demoTools({ senders: { 'telegram.send': hand } }), model: 모델, tcellObserver: observer,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = (body) => fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    // 옛/가짜 승인 ID → 답변은 성공, approval 관찰 0
    const r0 = await turn({ sessionId: s.id, approve: 'ghost-approval-id' });
    assert.ok(r0.kind, '가짜 승인이 답변을 죽였다');
    // 실제 카드 → 승인 → approval 관찰 정확히 1
    const r1 = await turn({ sessionId: s.id, text: '오너한테 시험 보내줘', channelTargets: undefined });
    if (r1.kind === 'approval') {
      await turn({ sessionId: s.id, approve: r1.pendingId });
    }
    await new Promise((rs) => setTimeout(rs, 200));
    const { events } = await observer.loadAllForAudit();
    const approvals = events.filter((e) => e.type === 'approval');
    assert.equal(approvals.filter((e) => e.sourceRefs.some((x) => x.includes('ghost'))).length, 0, '가짜 승인이 관찰됐다');
    if (r1.kind === 'approval') {
      assert.equal(approvals.length, 1, `실제 승인 관찰이 ${approvals.length}건`);
    }
  } finally { await new Promise((r2) => server.close(r2)); }
});

test('영향 0 유지: 커널은 관찰 저장소를 참조하지 않는다', async () => {
  for (const f of ['turn.js', 'l2-plan/model-control.js', 'l1-intent/context-mesh.js', 'l1-intent/user-model.js']) {
    const src = await readFile(join('src/kernel', f), 'utf8').catch(() => '');
    assert.ok(!src.includes('observations.jsonl') && !src.includes('TCellObserver'), `커널(${f})이 관찰을 읽는다`);
  }
});

// ── TG-1 재감사(만료 승인) — 커널의 실제 소비 결과만 관찰한다 ──
async function 승인시나리오() {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg1f-'));
  const hand = { toolKind: 'send', previewOf: makeSendPreview({ channel: 'telegram' }),
    async handler() { return { result: { sent: true }, userSafeSummary: '보냈어요.' }; } };
  let 첫 = true;
  const 모델 = { async respond(_tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'telegram.send', args: { text: '시험', target: '111' } }] }; }
    return { text: '끝', toolCalls: [] };
  } };
  const observer = new TCellObserver(dir);
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ senders: { 'telegram.send': hand } }), model: 모델, tcellObserver: observer });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = (body) => fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const card = await turn({ sessionId: s.id, text: '오너한테 시험 보내줘' });
  return { dir, server, observer, turn, sessionId: s.id, card };
}
const 결정관찰 = async (observer) => (await observer.loadAllForAudit()).events.filter((e) => e.type === 'approval' || e.type === 'rejection');

test('만료된 승인 클릭 → 실행 거부 + 관찰 0 (커널 소비 결과만 관찰)', async () => {
  const { dir, server, observer, turn, sessionId, card } = await 승인시나리오();
  try {
    assert.equal(card.kind, 'approval');
    const sessPath = join(dir, `${sessionId}.json`);
    const sess = JSON.parse(await readFile(sessPath, 'utf8'));
    sess.pendingApprovals[card.pendingId].grantScope = { kind: 'once', expiresAt: 1 };
    await writeFile(sessPath, JSON.stringify(sess), 'utf8');
    const r = await turn({ sessionId, approve: card.pendingId });
    assert.match(r.reply ?? '', /만료/, `만료 거부가 아니다: ${r.reply}`);
    await new Promise((rs) => setTimeout(rs, 150));
    assert.deepEqual(await 결정관찰(observer), [], '만료 승인이 관찰됐다');
  } finally { await new Promise((r2) => server.close(r2)); }
});

test('실제 거절 소비 → rejection 정확 1 · 유령 거절 → 관찰 0', async () => {
  const { server, observer, turn, sessionId, card } = await 승인시나리오();
  try {
    await turn({ sessionId, reject: 'ghost-reject' });
    await turn({ sessionId, reject: card.pendingId });
    await new Promise((rs) => setTimeout(rs, 150));
    const obs = await 결정관찰(observer);
    assert.equal(obs.length, 1, `결정 관찰 ${obs.length}건`);
    assert.equal(obs[0].type, 'rejection');
    assert.ok(obs[0].sourceRefs.some((x) => x.includes(card.pendingId)));
    assert.ok(!obs.some((e) => e.sourceRefs.some((x) => x.includes('ghost'))));
  } finally { await new Promise((r2) => server.close(r2)); }
});
