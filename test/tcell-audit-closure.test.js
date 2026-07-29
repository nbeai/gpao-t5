// TG-5A §0-C 감사 종료 4건 검증 — 실제 project 신분 · 의미 결합 · bounded grant · 원장 정직성.
//
// 오너 고정 조건에 따른 관통이다:
//  · 의미 결합은 **실제 OpenAI·Anthropic 어댑터 코드**를 지난다 — 로컬 서버가 실제 wire 형식
//    (chat/completions · /v1/messages)으로 응답한다(OAuth 가짜 서버와 같은 격리 계약).
//  · 서로 다른 프로젝트 **2개**의 생산 관통으로 범위 격리를 증명한다.
//  · 승인·재사용·철회는 실제 버튼이 부르는 HTTP 경로 그대로 관통한다.
//  · 저장 장애는 실제로 주입한다(읽기 불능·손상 줄).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeProviderModelClient } from '../src/runtime/model-provider.js';
import { buildEvidenceBundle, extractCandidate } from '../src/runtime/tcell-extractor.js';
import { makeObservationEvent } from '../src/kernel/l0-evidence/tcell-observation.js';
import { buildTurnFacts } from '../src/kernel/l1-intent/turn-facts.js';
import { admitPrinciples, ADMISSION_REASONS } from '../src/kernel/l1-intent/tcell-admission.js';
import { ConfirmationStore, TCellRegistry } from '../src/surface/tcell-store.js';
import { currentPlaceOf } from '../src/kernel/l0-evidence/working-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

// ── 공용: 실제 wire 형식으로 답하는 로컬 모델 서버 ──────────────────────────

/** OpenAI chat/completions 형식 서버 — 요청 본문을 기록하고 준비된 JSON 을 content 로 돌려준다. */
function openaiWireServer(replyFor) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(replyFor(seen.at(-1))) } }],
    }));
  });
  return { server, seen };
}

/** Anthropic /v1/messages 형식 서버. */
function anthropicWireServer(replyFor) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(replyFor(seen.at(-1))) }],
    }));
  });
  return { server, seen };
}

const 관찰 = (over = {}) => makeObservationEvent({
  type: 'tool_result', sessionId: 's', turnId: '1', occurredAt: 1,
  anchor: { workspace: '/w', project: '/tmp/실제자리', surface: 'web', subject: null },
  signal: { summary: '파일 읽기에 실패했어요', valence: 'failure' },
  sourceRefs: ['session:s'], receiptRefs: ['ledger:s:0'],
  ...over,
});

// ── §0-C-2 · 의미 결합: 실제 어댑터 코드로 같은 뜻·반대 뜻·무관한 뜻 관통 ──

async function 어댑터추출({ provider, wire, reply }) {
  const { server, seen } = wire(reply);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const model = makeProviderModelClient({
      provider, modelId: 'test-model', maxTokens: 1000, token: 'test-key',
      baseUrl: provider === 'anthropic' ? base : `${base}/v1`,
    });
    const bundle = buildEvidenceBundle({
      id: 'b1', activeTarget: '',
      observations: [관찰()],
      existingCandidates: [{
        id: 'cell-기존', principle: { statement: '보낼 때는 대상을 확인하고 보낸다' },
        center: { point: '전송 전 확인', axis: '' },
        boundary: { validWhen: ['보내기 직전'], invalidWhen: [] },
        anchor: { project: '/tmp/실제자리', subject: null },
      }],
    });
    const r = await extractCandidate({ model, bundle, now: 1 });
    return { r, seen };
  } finally { await new Promise((r2) => server.close(r2)); }
}

for (const [이름, provider, wire] of [
  ['OpenAI', 'openai', openaiWireServer],
  ['Anthropic', 'anthropic', anthropicWireServer],
]) {
  test(`§0-C-2 [${이름} 어댑터]: 같은 뜻의 자유문 경계가 원자에 결합돼 admission 에서 매칭된다`, async () => {
    const { r, seen } = await 어댑터추출({
      provider, wire,
      // 모델이 자유문("파일 읽기에 실패했을 때")을 OS 원자 after_failure 에 결합해 답한다.
      reply: () => ({
        decision: 'candidate',
        principle: { statement: '파일 읽기에 실패하면 다른 방법을 먼저 찾는다', type: 'recovery' },
        center: { point: '실패 후 대체 경로', axis: '복구' },
        boundary: {
          validWhen: [{ text: '파일 읽기에 실패했을 때', atom: 'after_failure' }],
          invalidWhen: [{ text: '사용자가 같은 방법 재시도를 지시했을 때' }],
          needsReviewWhen: [], mustNotOverride: ['현재 요청'],
        },
        trace: { observationRefs: ['ledger:s:0'] },
        suggestedRadius: 'task',
      }),
    });
    // ① 실제 어댑터가 wire 를 실제로 지났고, 어휘가 모델 입력에 실렸다.
    assert.equal(seen.length, 1, '어댑터가 서버를 부르지 않았다');
    const 본문 = JSON.stringify(seen[0].body);
    assert.ok(본문.includes('after_failure'), '원자 어휘가 모델 입력에 실리지 않았다');
    // ② 결합이 세포에 지속됐다.
    const cell = r.candidate ?? r.quarantined;
    assert.ok(cell, `후보가 없다: ${JSON.stringify(r)}`);
    assert.equal(cell.binding?.['파일 읽기에 실패했을 때'], 'after_failure', '결합이 세포에 남지 않았다');
    // ③ **글자가 다른데 뜻이 같은** 경계가 admission 에서 매칭된다(§0-C 재현의 역방향).
    cell.state = 'M2_replayed';
    cell.authority = { ...cell.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
    const 재료 = buildTurnFacts({
      stage: 'pre_model', sessionId: 's', projectId: '/tmp/실제자리',
      ledgerWindow: { previousTurn: [{ userSafeSummary: '실패', failureState: 'tool_error', action: 'local.file 실행' }], previousTurnStart: 0 },
    });
    const out = admitPrinciples({
      candidateIds: [cell.id], principleStore: { get: (k) => (k === cell.id ? cell : null) },
      evidenceStore: { get: () => ({ type: 'tool_result' }) },
      confirmationStore: { get: () => null }, grantStore: { get: () => null },
      stage: 'pre_model', requestFacts: 재료.requestFacts, authorityFacts: 재료.authorityFacts, now: 1000,
    });
    assert.equal(out.admissions.length, 1,
      `의미가 같은 경계가 글자 불일치로 거절됐다: ${JSON.stringify(out.trace.rejected)}`);
    assert.ok(out.admissions[0].boundaryChecks.some((b) => b.via === 'atom'), '원자 결합 경로로 매칭되지 않았다');
  });

  test(`§0-C-2 [${이름} 어댑터]: 반대 뜻 지시는 contradiction 관계로 돌아오고, 무관한 뜻은 결합되지 않는다`, async () => {
    // 반대 뜻: 모델이 기존 원리의 반대라고 판정한다.
    const 반대 = await 어댑터추출({
      provider, wire,
      reply: () => ({
        decision: 'contradiction',
        relation: { kind: 'contradicts', targetId: 'cell-기존' },
      }),
    });
    assert.equal(반대.r.decision, 'contradiction');
    assert.deepEqual(반대.r.relation, { kind: 'contradicts', id: 'cell-기존', evidence: ['model'] },
      '반대 관계가 소비 가능한 형태로 돌아오지 않았다');
    // 지어낸 대상 id 는 관계로 인정되지 않는다(§7.2).
    const 위조 = await 어댑터추출({
      provider, wire,
      reply: () => ({ decision: 'contradiction', relation: { kind: 'contradicts', targetId: '없는-세포' } }),
    });
    assert.equal(위조.r.relation, null, '모델이 지어낸 대상 id 가 관계로 인정됐다');
    // 무관한 뜻: 모르는 원자 id 는 결합되지 않는다(주장이지 결합이 아니다).
    const 무관 = await 어댑터추출({
      provider, wire,
      reply: () => ({
        decision: 'candidate',
        principle: { statement: '보고서는 목록으로 만든다', type: 'communication' },
        center: { point: '보고 형식', axis: '' },
        boundary: {
          validWhen: [{ text: '보고서를 만들 때', atom: '없는_원자' }],
          invalidWhen: [{ text: '사용자가 산문을 지시했을 때' }],
          needsReviewWhen: [], mustNotOverride: ['현재 요청'],
        },
        trace: { observationRefs: ['ledger:s:0'] },
        suggestedRadius: 'task',
      }),
    });
    const cell = 무관.r.candidate ?? 무관.r.quarantined;
    assert.ok(cell);
    assert.equal(cell.binding, undefined, '모르는 원자 id 가 결합으로 저장됐다');
  });
}

test('§0-C-2: 지속된 반대 지시 correction 이 다음 턴 admission 을 정확히 막는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-contra-'));
  const reg = new TCellRegistry(dir);
  const { makeTCellCandidate } = await import('../src/kernel/l5-growth/tcell-core.js');
  const cell = makeTCellCandidate({
    principle: { statement: '보낼 때는 대상을 확인하고 보낸다', type: 'execution' },
    boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
    anchor: { project: '/tmp/자리', subject: null },
    geometry: { radius: 'task', depth: 0, sphereStability: 0 },
  });
  cell.id = 'cell-확인원리';
  cell.state = 'M3_limited';
  cell.authority = { ...cell.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
  await reg.upsert(cell, null);

  // 추출기의 의미 판정 결과가 correction 으로 지속된다(서버 경로가 하는 일 그대로).
  const rec = await reg.recordCorrection('cell-확인원리', {
    kind: 'user_directive_contradicts', ref: 'request:s:5', at: 10,
  });
  assert.equal(rec.ok, true);
  // 같은 참조는 한 번만(멱등) — 재추출이 반복돼도 correction 이 쌓이지 않는다.
  assert.equal((await reg.recordCorrection('cell-확인원리', { kind: 'user_directive_contradicts', ref: 'request:s:5', at: 11 })).already, true);

  const 저장된 = (await reg.load()).cells.find((c) => c.id === 'cell-확인원리');
  assert.equal(저장된.trace.corrections.length, 1);
  assert.equal(저장된.effect.userCorrectionCount, 1);

  // 다음 턴: 이 세포는 **정확히 conflict 사유**로 거절된다 — unknown 이 아니다(§0-C 재현의 역).
  const 재료 = buildTurnFacts({
    stage: 'pre_model', sessionId: 's', projectId: '/tmp/자리',
    ledgerWindow: { previousTurn: [{ userSafeSummary: '성공', failureState: 'none' }], previousTurnStart: 0 },
  });
  const out = admitPrinciples({
    candidateIds: ['cell-확인원리'], principleStore: { get: (k) => (k === 'cell-확인원리' ? 저장된 : null) },
    evidenceStore: { get: () => ({ type: 'tool_result' }) },
    confirmationStore: { get: () => null }, grantStore: { get: () => null },
    stage: 'pre_model', requestFacts: 재료.requestFacts, authorityFacts: 재료.authorityFacts, now: 1000,
  });
  assert.equal(out.admissions.length, 0, '반대 지시가 지속됐는데 원리가 입장했다');
  assert.equal(out.trace.rejected[0].reason, ADMISSION_REASONS.conflict,
    `사유가 conflict 가 아니다: ${out.trace.rejected[0].reason}`);
});

// ── §0-C-1 · 실제 project 신분: 서로 다른 프로젝트 2개의 생산 관통 ──────────

async function 자리서버(자리) {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-proj-'));
  let 첫 = true;
  const 손 = {
    subjectOf(rec) {
      const command = rec?.result?.command;
      if (!command) return null;
      return { key: `cmd:${command}`, kind: 'command', label: String(command), detail: rec.result?.cwd };
    },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  const 모델 = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
    return { text: '봤어요', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sess = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const 턴 = async (body) => {
    첫 = true;
    return (await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sess.id, ...body }),
    })).json());
  };
  return { dir, base, 세션: sess.id, 턴, 닫기: () => new Promise((r) => server.close(r)) };
}

test('§0-C-1: project 는 실제 자리다 — 서로 다른 두 프로젝트가 생산 경로에서 격리된다', async () => {
  const { TCellRegistry: Reg, TCellObserver } = await import('../src/surface/tcell-store.js');
  const { makeTCellCandidate } = await import('../src/kernel/l5-growth/tcell-core.js');
  const 자리A = join(await mkdtemp(join(tmpdir(), 'projA-')), '정산');
  const 자리B = join(await mkdtemp(join(tmpdir(), 'projB-')), '블로그');

  const sA = await 자리서버(자리A);
  try {
    // 자리 A 의 원리를 심는다(자리 A 근거 포함).
    const ob = new TCellObserver(sA.dir);
    await ob.observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [{ userSafeSummary: '했어요.', failureState: 'none' }] });
    const 만들 = (id, project) => {
      const c = makeTCellCandidate({
        principle: { statement: `${id}의 원리`, type: 'workflow' },
        boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
        trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
        anchor: { project, subject: null }, geometry: { radius: 'task', depth: 0, sphereStability: 0 },
      });
      c.id = id; c.state = 'M2_replayed';
      c.authority = { ...c.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
      return c;
    };
    const reg = new Reg(sA.dir);
    await reg.upsert(만들('원리A', 자리A), null);
    await reg.upsert(만들('원리B', 자리B), null);

    // 턴 1: 자리 A 확정(터미널 실행). 턴 2: admission 이 자리 A 범위로 돈다.
    await sA.턴({ text: '폴더 봐줘' });
    const r = await sA.턴({ text: '한 번 더 봐줘' });

    // ① 자리 A 세션은 원리A 만 본다 — 원리B 는 **읽지도 않는다**(scopeFiltered).
    assert.ok(r.principleTrace, 'trace 없음');
    assert.ok(r.principleTrace.retrievedIds.includes('원리A'), '자기 자리의 원리를 읽지 못했다');
    assert.ok(!r.principleTrace.retrievedIds.includes('원리B'), '다른 프로젝트의 원리를 읽었다(격리 실패)');
    assert.equal(r.principleTrace.scopeFiltered, 1);
    assert.ok(r.principleTrace.admitted.some((a) => a.id === '원리A'),
      `자기 자리의 원리가 입장하지 못했다: ${JSON.stringify(r.principleTrace.rejected)}`);

    // ② 세션 파일이 아는 자리(지금 자리)가 실제 자리 A 다 — 세션 저장 폴더가 아니다.
    const 세션파일 = JSON.parse(await readFile(join(sA.dir, 'sessions', `${sA.세션}.json`), 'utf8').catch(async () => {
      // 저장 구조가 다르면 저장소 전체에서 세션을 찾는다.
      const { SessionStore } = await import('../src/surface/session-store.js');
      return JSON.stringify(await new SessionStore(sA.dir).load(sA.세션));
    }));
    assert.equal(currentPlaceOf(세션파일.workingState), 자리A);
    assert.notEqual(currentPlaceOf(세션파일.workingState), sA.dir, 'project 가 아직 세션 저장 폴더다');
  } finally { await sA.닫기(); }

  // ③ 자리를 아직 모르는 첫 턴은 **추측하지 않는다** — project=null, 자리 있는 원리는 scope_unknown.
  const sB = await 자리서버(자리B);
  try {
    const ob = new (await import('../src/surface/tcell-store.js')).TCellObserver(sB.dir);
    await ob.observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [{ userSafeSummary: '했어요.', failureState: 'none' }] });
    const { makeTCellCandidate: mk } = await import('../src/kernel/l5-growth/tcell-core.js');
    const c = mk({
      principle: { statement: '자리 있는 원리', type: 'workflow' },
      boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
      trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
      anchor: { project: 자리B, subject: null }, geometry: { radius: 'task', depth: 0, sphereStability: 0 },
    });
    c.id = '자리원리'; c.state = 'M2_replayed';
    c.authority = { ...c.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
    await new (await import('../src/surface/tcell-store.js')).TCellRegistry(sB.dir).upsert(c, null);

    const 첫턴 = await sB.턴({ text: '안녕' }); // 도구 없음 → 자리 미확정
    const pre = 첫턴.principleTrace?.passes?.find((p) => p.stage === 'pre_model');
    assert.ok(pre, 'trace 없음');
    const 거절 = pre.rejected.find((x) => x.id === '자리원리');
    assert.equal(거절?.reason, ADMISSION_REASONS.scopeUnknown,
      `자리를 모르는 턴이 추측으로 판정했다: ${JSON.stringify(pre.admitted)} ${JSON.stringify(pre.rejected)}`);
  } finally { await sB.닫기(); }
});

// ── §0-C-3 · bounded grant: 버튼 부여 → 소비 → 재사용 → 철회 관통 ──────────

async function grant서버() {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-gr-'));
  const 자리 = join(dir, '작업자리');
  const 발송기록 = [];
  let 대본 = 'terminal';
  const 터미널 = {
    subjectOf(rec) {
      const command = rec?.result?.command;
      return command ? { key: `cmd:${command}`, kind: 'command', label: String(command), detail: rec.result?.cwd } : null;
    },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  const 슬랙 = {
    previewOf: (args) => ({ where: args?.target ?? '기본', what: args?.text ?? '', impact: '슬랙에 실제로 게시돼요' }),
    async handler(args) { 발송기록.push(args); return { result: { posted: true }, userSafeSummary: '슬랙에 게시했어요.' }; },
  };
  let 첫 = true;
  const 모델 = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) {
      첫 = false;
      if (대본 === 'terminal') return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] };
      return { text: '', toolCalls: [{ name: 'slack.post', args: { target: '#general', text: '보고' } }] };
    }
    return { text: '했어요', toolCalls: [] };
  } };
  const server = makeServer({
    store: new SessionStore(dir), env: demoEnv(),
    tools: demoTools({ localTerminal: 터미널, senders: { 'slack.post': 슬랙 } }),
    model: 모델,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sess = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const 턴 = async (body, kind = 'slack') => {
    첫 = true; 대본 = kind;
    return (await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sess.id, ...body }),
    })).json());
  };
  return { dir, base, 자리, 세션: sess.id, 턴, 발송기록, 닫기: () => new Promise((r) => server.close(r)) };
}

test('§0-C-3: [계속 허용] 버튼 → 소비 → 다음 턴 재확인 0 → 철회 → 재확인 부활', async () => {
  const s = await grant서버();
  try {
    // 0) 자리 확정(터미널 한 번) — grant 범위(project)가 실제 자리에 묶인다.
    await s.턴({ text: '폴더 봐줘' }, 'terminal');
    // 1) 전송 요청 → 승인 카드.
    const 카드 = await s.턴({ text: '이 내용 슬랙에 올려줘' });
    assert.ok(카드.pendingId, `승인 카드가 없다: ${JSON.stringify(카드).slice(0, 200)}`);
    assert.equal(s.발송기록.length, 0, '승인 전에 발송됐다');
    // 2) **[승인하고 24시간 계속 허용]** — 실제 버튼이 보내는 것과 같은 요청.
    const 승인 = await s.턴({ approve: 카드.pendingId, grantKind: 'session' });
    assert.equal(s.발송기록.length, 1, '승인 후 정확히 1회 발송돼야 한다');
    assert.ok(승인.approvalConsumed?.approved);
    // 원장에 bounded 로 남았다.
    const g1 = await (await fetch(`${s.base}/grants?sessionId=${s.세션}`)).json();
    assert.equal(g1.grants.length, 1, `grant 가 기록되지 않았다: ${JSON.stringify(g1)}`);
    assert.equal(g1.grants[0].action, 'slack.post');
    assert.equal(g1.grants[0].target, '#general');
    assert.ok(g1.grants[0].scope.includes(s.자리), `범위가 실제 자리가 아니다: ${g1.grants[0].scope}`);
    assert.equal(g1.grants[0].active, true);

    // 3) **다음 턴 같은 행동·같은 대상 — 다시 묻지 않고 실행된다.**
    const 재사용 = await s.턴({ text: '방금 그 내용 슬랙에 다시 올려줘' });
    assert.ok(!재사용.pendingId, `허용 범위 안인데 다시 물었다: ${JSON.stringify(재사용).slice(0, 200)}`);
    assert.equal(s.발송기록.length, 2, '허용 범위 안의 실행이 일어나지 않았다');
    assert.ok(재사용.grantsReused?.length, '허용 범위로 진행한 사실이 결과에 없다(몰래 실행처럼 보인다)');

    // 4) **철회 버튼** → 즉시 다시 묻는다.
    const rv = await (await fetch(`${s.base}/grants/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.세션, key: g1.grants[0].key }),
    })).json();
    assert.equal(rv.revoked, true);
    const 철회후 = await s.턴({ text: '한 번 더 슬랙에 올려줘' });
    assert.ok(철회후.pendingId, '철회했는데 다시 묻지 않았다');
    assert.equal(s.발송기록.length, 2, '철회 후 승인 없이 발송됐다');
  } finally { await s.닫기(); }
});

test('§0-C-3: [이번만 승인]은 권한이 되지 않는다 — 다음 턴에 다시 묻는다', async () => {
  const s = await grant서버();
  try {
    await s.턴({ text: '폴더 봐줘' }, 'terminal');
    const 카드 = await s.턴({ text: '이 내용 슬랙에 올려줘' });
    await s.턴({ approve: 카드.pendingId });               // grantKind 없음 = 이번만(once)
    assert.equal(s.발송기록.length, 1);
    const g = await (await fetch(`${s.base}/grants?sessionId=${s.세션}`)).json();
    assert.equal(g.grants.length, 0, 'once 승인이 권한 원장에 들어갔다');
    const 다음 = await s.턴({ text: '같은 내용 슬랙에 다시 올려줘' });
    assert.ok(다음.pendingId, 'once 였는데 다시 묻지 않았다');
    assert.equal(s.발송기록.length, 1, 'once 인데 승인 없이 발송됐다');
  } finally { await s.닫기(); }
});

test('§0-C-3: 자리를 모르면 계속 허용을 눌러도 권한이 만들어지지 않는다(추측 금지)', async () => {
  const s = await grant서버();
  try {
    // 자리 확정 없이 바로 전송 — project null → grant key 불가.
    const 카드 = await s.턴({ text: '이 내용 슬랙에 올려줘' });
    await s.턴({ approve: 카드.pendingId, grantKind: 'session' });
    assert.equal(s.발송기록.length, 1, '승인 실행 자체는 된다');
    const g = await (await fetch(`${s.base}/grants?sessionId=${s.세션}`)).json();
    assert.equal(g.grants.length, 0, '자리를 모르는데 권한이 만들어졌다(추측)');
    const 다음 = await s.턴({ text: '같은 내용 다시 올려줘' });
    assert.ok(다음.pendingId, '권한이 없는데 다시 묻지 않았다');
  } finally { await s.닫기(); }
});

// ── §0-C-4 · 확인 원장 실패의 정직한 승계 ──────────────────────────────────

test('§0-C-4: 확인 원장 읽기 불능은 빈 원장이 아니라 degraded 다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-conf-'));
  // 주입: 원장 자리에 **디렉터리**를 만든다 — readFile 이 EISDIR 로 실패한다(ENOENT 아님).
  await mkdir(join(dir, 'growth', 'confirmations.jsonl'), { recursive: true });
  const store = new ConfirmationStore(dir);
  await assert.rejects(() => store.snapshot(), /확인 원장을 읽지 못했어요/,
    '읽기 불능이 빈 원장으로 위장했다');

  // 스냅샷 경계가 이 실패를 degraded 로 승계한다 — 세포가 있어야 원장을 읽으므로 세포를 둔다.
  const { buildAdmissionSnapshot } = await import('../src/kernel/l1-intent/tcell-admission.js');
  const { makeTCellCandidate } = await import('../src/kernel/l5-growth/tcell-core.js');
  const { TCellRegistry: Reg2, TCellObserver: Ob2 } = await import('../src/surface/tcell-store.js');
  const c = makeTCellCandidate({
    principle: { statement: '확인 원장 시험', type: 'workflow' },
    boundary: { validWhen: ['x'], invalidWhen: ['y'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    trace: { observationRefs: ['ledger:과거:0'], corrections: [] },
    anchor: { project: null, subject: null }, geometry: { radius: 'task', depth: 0, sphereStability: 0 },
  });
  c.id = 'c-conf';
  await new Reg2(dir).upsert(c, null);
  const ob = new Ob2(dir);
  await ob.observeTurn({ sessionId: '과거', ledgerStart: 0, turnId: '1', now: 1, turnReceipts: [{ userSafeSummary: 'x', failureState: 'none' }] });
  const snap = await buildAdmissionSnapshot({
    registry: new Reg2(dir), observer: ob,
    confirmationStore: () => store.snapshot(),
  });
  assert.equal(snap.status, 'degraded', '읽기 불능인데 스냅샷이 ok 다(§0-C 재현)');
});

test('§0-C-4: 손상 줄은 정상 줄을 막지 않되 degraded 로 표시된다 · ENOENT 만 정상 부재다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-conf2-'));
  // ENOENT: 아직 확인이 없다 — 정상(ok).
  const 빈것 = await new ConfirmationStore(dir).snapshot();
  assert.equal(빈것.degraded, false);
  assert.equal(빈것.get('없음'), null);

  // 손상 줄 + 정상 줄 주입.
  await mkdir(join(dir, 'growth'), { recursive: true });
  await writeFile(join(dir, 'growth', 'confirmations.jsonl'),
    '{"부서진 json\n'
    + `${JSON.stringify({ kind: 'user_confirmation', id: 'ok-1', tcellId: 'c1', at: 1, sourceRefs: ['r'], confirmed: true })}\n`,
    'utf8');
  const store = new ConfirmationStore(dir);
  const snap = await store.snapshot();
  assert.ok(snap.get('ok-1'), '정상 줄이 손상 줄에 막혔다');
  assert.equal(snap.degraded, true, '손상이 있는데 degraded 표시가 없다');
  // 바이트 보존: 저장소가 파일을 재작성하지 않는다.
  const raw = await readFile(join(dir, 'growth', 'confirmations.jsonl'), 'utf8');
  assert.ok(raw.startsWith('{"부서진'), '손상 바이트가 사라졌다(재작성 금지 위반)');

  // 손상은 캐시되지 않는다 — 정리(복구) 후 다음 읽기가 곧바로 깨끗해진다.
  await writeFile(join(dir, 'growth', 'confirmations.jsonl'),
    `${JSON.stringify({ kind: 'user_confirmation', id: 'ok-1', tcellId: 'c1', at: 1, sourceRefs: ['r'], confirmed: true })}\n`, 'utf8');
  assert.equal((await store.snapshot()).degraded, false, '복구했는데 손상 캐시가 남았다');

  // 추가 기록은 append 이고 캐시를 비운다.
  await store.record({ id: 'ok-2', tcellId: 'c2', sourceRefs: ['r2'], now: 2 });
  assert.ok((await store.snapshot()).get('ok-2'));
  void appendFile; // (직접 조작은 위에서 writeFile 로 충분하다)
});
