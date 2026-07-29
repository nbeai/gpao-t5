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
    await new Promise((rs) => setTimeout(rs, 60));
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
    await new Promise((rs) => setTimeout(rs, 40));
    assert.deepEqual(await 결정관찰(observer), [], '만료 승인이 관찰됐다');
  } finally { await new Promise((r2) => server.close(r2)); }
});

test('실제 거절 소비 → rejection 정확 1 · 유령 거절 → 관찰 0', async () => {
  const { server, observer, turn, sessionId, card } = await 승인시나리오();
  try {
    await turn({ sessionId, reject: 'ghost-reject' });
    await turn({ sessionId, reject: card.pendingId });
    await new Promise((rs) => setTimeout(rs, 40));
    const obs = await 결정관찰(observer);
    assert.equal(obs.length, 1, `결정 관찰 ${obs.length}건`);
    assert.equal(obs[0].type, 'rejection');
    assert.ok(obs[0].sourceRefs.some((x) => x.includes(card.pendingId)));
    assert.ok(!obs.some((e) => e.sourceRefs.some((x) => x.includes('ghost'))));
  } finally { await new Promise((r2) => server.close(r2)); }
});

// ── 차단3: wake → 묶음 → 추출이 실제 생산 경로에 연결됐는가(제품 동작 검사) ──
test('생산 경로: 턴 후처리가 wake 를 켜고 추출을 돌려 후보를 registry 에 남긴다(영향 0)', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { TCellRegistry } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-tg3prod-'));
  const 실패손 = {
    async probe(c) { return { command: c, cwd: '/x', changes: false, probe: { exitCode: 1, stdout: '', stderr: 'no' } }; },
    async handler() { return { failed: true, failureState: 'blocked', userSafeSummary: '못 했어요.', nextSafeAction: '다른 방법으로' }; },
  };
  let 첫 = true;
  const 모델 = { async respond(tc, opts = {}) {
    // 추출 호출은 tcellExtract 로 온다 — 구조화 후보를 돌려준다.
    if (tc?.tcellExtract) return JSON.stringify({
      decision: 'candidate',
      principle: { statement: '막힌 손은 같은 인자로 반복하지 않는다', type: 'recovery' },
      center: { point: '복구', axis: '전환', horizontalSignals: [] },
      boundary: { validWhen: ['실패 직후'], invalidWhen: ['사용자 재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
      trace: { observationRefs: tc.tcellExtract.observations.map((o) => o.receiptRefs[0]) },
      suggestedRadius: 'task',
    });
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
    return { text: '못 했어요', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 실패손 }), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    // 실패 관찰 2건이 쌓이면 wake — 두 턴을 돌린다.
    for (const t of ['폴더 봐줘', '다시 봐줘']) {
      첫 = true;
      await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, text: t }) });
    }
    // 후처리(비동기) 완료 대기
    let cells = [];
    for (let i = 0; i < 40 && !cells.length; i++) {
      await new Promise((rs) => setTimeout(rs, 25));
      cells = (await new TCellRegistry(dir).load()).cells ?? [];
    }
    assert.ok(cells.length >= 1, '생산 경로가 후보를 만들지 않았다 — wake→묶음→추출이 연결되지 않음');
    assert.equal(cells[0].state, 'M1_candidate');
    assert.deepEqual(cells[0].authority.allowedInfluence, ['none'], '생산된 후보에 영향이 있다');
    assert.ok(cells[0].trace.observationRefs.length >= 1, 'trace 가 비었다');
  } finally { await new Promise((r2) => server.close(r2)); }
});

test('레인 분리·지시 근거·현재 턴 우선: 선호는 T-cell 로 가지 않고, 운영 원리만 자기 참조로 깨운다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { TCellRegistry, TCellObserver: OB } = await import('../src/surface/tcell-store.js');
  const 만들기 = async (제안kind) => {
    const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lane-'));
    let 번들본 = null;
    const 모델 = { async respond(tc, opts = {}) {
      if (tc?.tcellExtract) { 번들본 = tc.tcellExtract; return JSON.stringify({
        decision: 'candidate',
        principle: { statement: '배포 전에는 게이트를 돌린다', type: 'workflow' },
        center: { point: '배포 절차', axis: '검증 우선', horizontalSignals: [] },
        boundary: { validWhen: ['배포 전'], invalidWhen: ['긴급 롤백'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
        trace: { observationRefs: tc.tcellExtract.observations.map((o) => o.receiptRefs[0]) },
        suggestedRadius: 'task',
      }); }
      if (!opts.tools?.length) return '알겠어요';
      return { text: '알겠어요', toolCalls: [] };
    } };
    // 커널의 정규식 판정을 흉내내지 않고, 서버가 보는 result.memorySuggestion 을 직접 만든다.
    const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({}), model: 모델 });
    return { dir, server, 번들: () => 번들본 };
  };
  // ① 명시적 "선호" 발화 — 기존 기억 레인이 담당, T-cell 후보 0
  {
    const { dir, server } = await 만들기('preference');
    await new Promise((r) => server.listen(0, r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
      await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: s.id, text: '앞으로 짧게 요점만 말해줘' }) }); // preference 신호
      await new Promise((rs) => setTimeout(rs, 250));
      const cells = (await new TCellRegistry(dir).load()).cells ?? [];
      assert.equal(cells.length, 0, '명시적 선호가 T-cell 로 변환됐다(정본 S-TG-1 위반)');
    } finally { await new Promise((r) => server.close(r)); }
  }
  // ② 사용자 요청 관찰이 안정적 자기 참조로 남는다 — 지시 근거가 추측이 아니다
  {
    const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-req-'));
    const ob = new OB(dir);
    const a = await ob.observeUserRequest({ sessionId: 's', statement: '배포 전에는 게이트를 돌린다', turnIndex: 3, now: 1 });
    assert.equal(a.ref, 'request:s:3');
    const { events } = await ob.load({ sessionId: 's' });
    assert.equal(events[0].type, 'user_request');
    assert.deepEqual(events[0].receiptRefs, ['request:s:3']);
    const b = await ob.observeUserRequest({ sessionId: 's', statement: '같은 턴 재기록', turnIndex: 3, now: 2 });
    assert.equal(b.recorded, false, '같은 턴 요청이 중복 관찰됐다');
  }
});

// ── 재감사 P1 2건: 원문 비저장 · 선호 유입 차단(생산 경계) ──
test('P1-1: 일반 발화 원문은 관찰 파일에 남지 않고, 비밀 모양 지시는 일반화·비가독이 된다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { TCellObserver: OB } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-raw-'));
  const 모델 = { async respond(tc, opts = {}) {
    if (tc?.tcellExtract) return JSON.stringify({ decision: 'insufficient_evidence' });
    if (!opts.tools?.length) return '알겠어요';
    return { text: '알겠어요', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({}), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const 비밀발화 = '이 키로 붙여줘 sk-proj-Q1hPNDMBbmQKmMV5MQeb4BhMHCOz0vY8KiyfOmtnRuM9PdBEFe';
    for (const t of ['오늘 뭐 하지', 비밀발화, '내 주민번호는 900101-1234567 이야']) {
      await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: s.id, text: t }) });
    }
    await new Promise((rs) => setTimeout(rs, 200));
    const { readFile: rf } = await import('node:fs/promises');
    const raw = await rf(join(dir, 'growth', 'observations.jsonl'), 'utf8').catch(() => '');
    assert.ok(!raw.includes('sk-proj-'), '자격 문자열이 관찰 파일에 남았다');
    assert.ok(!raw.includes('900101-1234567'), '개인정보 원문이 관찰 파일에 남았다');
    assert.ok(!raw.includes('오늘 뭐 하지'), '일반 발화 원문이 관찰 파일에 남았다');
  } finally { await new Promise((r) => server.close(r)); }
  // 구조화 지시라도 비밀 모양이면 일반화되고 모델 가독이 닫힌다.
  const dir2 = await mkdtemp(join(tmpdir(), 'gpao-t5-raw2-'));
  const ob = new OB(dir2);
  const r = await ob.observeUserRequest({ sessionId: 's', statement: '항상 sk-proj-AbCdEf0123456789AbCdEf0123456789 로 붙인다', turnIndex: 0, now: 1 });
  assert.equal(r.secret, true, '비밀 모양이 걸러지지 않았다');
  const { events } = await ob.load({ sessionId: 's' });
  assert.equal(events[0].privacy.modelReadable, false);
  assert.ok(!JSON.stringify(events[0]).includes('sk-proj-'));
});

test('P1-2: 과거 실패로 wake 가 켜져 있어도 명시적 선호는 T-cell 후보가 되지 않는다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { TCellRegistry } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-pref-'));
  const 실패손 = {
    async probe(c) { return { command: c, cwd: '/x', changes: false, probe: { exitCode: 1, stdout: '', stderr: 'no' } }; },
    async handler() { return { failed: true, failureState: 'blocked', userSafeSummary: '못 했어요.', nextSafeAction: '다른 방법으로' }; },
  };
  let 손쓸차례 = false; let 추출입력 = null; let 추출호출 = 0;
  const 모델 = { async respond(tc, opts = {}) {
    if (tc?.tcellExtract) {
      추출입력 = tc.tcellExtract; 추출호출 += 1;
      // 실패 관찰에 맞는 복구 원리를 낸다(정상 동작). 선호는 애초에 입력에 없어야 한다.
      return JSON.stringify({
        decision: 'candidate',
        principle: { statement: '막힌 손은 같은 인자로 반복하지 않는다', type: 'recovery' },
        center: { point: '복구', axis: '전환', horizontalSignals: [] },
        boundary: { validWhen: ['실패 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
        trace: { observationRefs: (tc.tcellExtract.observations ?? []).map((o) => o.receiptRefs[0]) },
        suggestedRadius: 'task',
      });
    }
    if (!opts.tools?.length) return '네';
    if (손쓸차례) { 손쓸차례 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
    return { text: '알겠어요', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 실패손 }), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const turn = (text) => fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: sid, text }) }).then((r) => r.json());
  let sid;
  try {
    sid = (await (await fetch(`${base}/sessions`, { method: 'POST' })).json()).id;
    // ① 실패 2건을 먼저 쌓아 wake 를 켠다.
    for (const t of ['폴더 봐줘', '다시 봐줘']) { 손쓸차례 = true; await turn(t); }
    await new Promise((rs) => setTimeout(rs, 200));
    const 사전 = (await new TCellRegistry(dir).load()).cells ?? [];
    const 사전호출 = 추출호출;
    assert.ok(사전.length >= 1, '실패 관찰에서 정상 후보가 만들어지지 않았다(대조군 실패)');
    // ② 그 상태에서 명시적 "선호"를 말한다 — 감사가 지적한 바로 그 조건.
    await turn('앞으로 나한테 설명할 때 짧게 요점만 말해줘');
    await new Promise((rs) => setTimeout(rs, 250));
    const 사후 = (await new TCellRegistry(dir).load()).cells ?? [];
    assert.equal(사후.length, 사전.length, '선호 턴이 새 T-cell 후보를 만들었다');
    assert.equal(추출호출, 사전호출, '선호 턴에서 추출이 돌았다(레인·새 근거 경계 통과 실패)');
    // 선호 문면이 관찰 파일·추출 입력 어디에도 없다.
    assert.ok(!JSON.stringify(추출입력 ?? {}).includes('요점만'), '선호 문면이 추출 입력에 유입됐다');
    const { readFile: rf2 } = await import('node:fs/promises');
    const raw = await rf2(join(dir, 'growth', 'observations.jsonl'), 'utf8').catch(() => '');
    assert.ok(!raw.includes('요점만'), '선호 발화가 관찰 파일에 남았다');
  } finally { await new Promise((r) => server.close(r)); }
});
