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
import { currentPlaceOf, workingStateFacts } from '../src/kernel/l0-evidence/working-state.js';
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

test('§0-C-2 + 감사 P1: 반대 지시는 그 지시가 다시 올 때만 막고, 무관한 턴은 막지 않는다', async () => {
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

  // 추출기의 의미 판정 결과가 **그 지시 문장을 열쇠로** 지속된다(서버 경로가 하는 일 그대로).
  const 반대지시 = '보낼 땐 확인하지 마';
  const rec = await reg.recordDirectiveRelation('cell-확인원리', {
    statement: 반대지시, relation: 'contradicts', ref: 'request:s:5', at: 10,
  });
  assert.equal(rec.ok, true);
  // 같은 (지시·관계)는 한 번만(멱등) — 재추출이 반복돼도 쌓이지 않는다.
  assert.equal((await reg.recordDirectiveRelation('cell-확인원리', { statement: 반대지시, relation: 'contradicts', ref: 'request:s:5', at: 11 })).already, true);

  const 저장된 = (await reg.load()).cells.find((c) => c.id === 'cell-확인원리');
  assert.equal(저장된.trace.corrections.length, 1);
  assert.equal(저장된.effect.userCorrectionCount, 1);

  const 판정 = (memorySuggestion) => {
    const 재료 = buildTurnFacts({
      stage: 'pre_model', sessionId: 's', projectId: '/tmp/자리', memorySuggestion,
      ledgerWindow: { previousTurn: [{ userSafeSummary: '성공', failureState: 'none' }], previousTurnStart: 0 },
    });
    return admitPrinciples({
      candidateIds: ['cell-확인원리'], principleStore: { get: (k) => (k === 'cell-확인원리' ? 저장된 : null) },
      evidenceStore: { get: () => ({ type: 'tool_result' }) },
      confirmationStore: { get: () => null }, grantStore: { get: () => null },
      stage: 'pre_model', requestFacts: 재료.requestFacts, authorityFacts: 재료.authorityFacts, now: 1000,
    });
  };

  // ① **그 지시가 다시 온 턴**: 정확히 conflict 로 거절된다(§0-C 재현의 역).
  const 지시턴 = 판정({ kind: 'operating_principle', statement: 반대지시 }).trace;
  assert.equal(지시턴.admitted.length, 0, '반대 지시가 온 턴인데 원리가 입장했다');
  assert.equal(지시턴.rejected[0].reason, ADMISSION_REASONS.conflict,
    `사유가 conflict 가 아니다: ${지시턴.rejected[0].reason}`);
  // **표현 변형은 검사로 정답을 고정하지 않는다**(감사 #4).
  //   이전 판은 `…마세요` 변형에서 원리가 **입장하는 것**을 단언했다. 그건 알려진 공백을
  //   "정답"으로 굳히는 일이다 — 사용자가 같은 뜻을 다르게 말했는데 원리가 살아나는 것은
  //   바람직한 동작이 아니다. 열쇠 맞춤은 문자열 재주로 메울 일도 아니다(어미 목록 확대 금지).
  //   실제 메커니즘은 **그 표현으로 지시가 다시 올 때 추출기(모델)가 다시 판정해
  //   그 표현의 열쇠로도 남기는 것**이며, 그 경로는 아래 「생산 경로 관통」이 검증한다.
  //   여기서는 어느 쪽도 단언하지 않는다 — 모르는 것을 아는 척하지 않는다.
  {
    // 다른 표현으로 **관계가 실제로 지속되면** 그때는 막힌다 — 메커니즘 자체는 여기서 확인한다.
    const 변형 = '보낼 땐 확인하지 마세요';
    await reg.recordDirectiveRelation('cell-확인원리', {
      statement: 변형, relation: 'contradicts', ref: 'request:s:9', at: 12,
    });
    const 다시 = (await reg.load()).cells.find((c) => c.id === 'cell-확인원리');
    const 재료 = buildTurnFacts({
      stage: 'pre_model', sessionId: 's', projectId: '/tmp/자리',
      memorySuggestion: { kind: 'operating_principle', statement: 변형 },
      ledgerWindow: { previousTurn: [{ userSafeSummary: '성공', failureState: 'none' }], previousTurnStart: 0 },
    });
    const t = admitPrinciples({
      candidateIds: ['cell-확인원리'], principleStore: { get: (k) => (k === 'cell-확인원리' ? 다시 : null) },
      evidenceStore: { get: () => ({ type: 'tool_result' }) },
      confirmationStore: { get: () => null }, grantStore: { get: () => null },
      stage: 'pre_model', requestFacts: 재료.requestFacts, authorityFacts: 재료.authorityFacts, now: 1000,
    }).trace;
    assert.equal(t.rejected[0]?.reason, ADMISSION_REASONS.conflict,
      '그 표현으로 관계가 지속됐는데도 막지 못했다');
  }

  // ② **무관한 미래 턴**(현재 지시 없음): 막지 않는다 — 감사 P1 의 핵심.
  //    모델의 관계 판정 한 번이 원리를 영구히 죽이면 자동화·맥락 활용이 조용히 위축된다.
  const { admissions: 무관입장, trace: 무관턴 } = 판정(null);
  assert.equal(무관턴.admitted.length, 1,
    `무관한 턴인데 과거 반대 지시가 원리를 막았다: ${JSON.stringify(무관턴.rejected)}`);
  assert.equal(무관입장[0].directiveRelation, 'unknown', '관계가 unknown 으로 기록되지 않았다');

  // ③ **다른 지시**가 온 턴도 막지 않는다(그 지시와의 관계는 아직 모른다).
  const 다른지시턴 = 판정({ kind: 'operating_principle', statement: '보고서는 목록으로' }).trace;
  assert.equal(다른지시턴.admitted.length, 1, '무관한 다른 지시가 원리를 막았다(과잉 차단)');
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
  // 게시 저장소를 시험이 들고 넘긴다 — 상태 주입이 아니라 **제어면이 실제로 게시한 결과**를
  // 같은 객체로 관찰하기 위해서다(§10.2 부팅 게시는 자리 확정 뒤 뒤에서 걸린다).
  const { makePrincipleSnapshotStore, scopeKeyOf } = await import('../src/kernel/l1-intent/principle-snapshot.js');
  const 게시본저장소 = makePrincipleSnapshotStore();
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 모델, principleSnapshotStore: 게시본저장소 });
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
  const 게시대기 = async () => {
    const key = scopeKeyOf({ project: 자리 });
    for (let n = 0; n < 300 && !게시본저장소.read(key); n += 1) {
      await new Promise((done) => setTimeout(done, 10));
    }
    return 게시본저장소.read(key);
  };
  return { dir, base, 세션: sess.id, 턴, 게시본저장소, 게시대기, 닫기: () => new Promise((r) => server.close(r)) };
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

    // 턴 1: 자리 A 확정(터미널 실행) → **뒤에서** 게시가 걸린다(전경은 기다리지 않는다).
    // 턴 2: 게시가 끝난 뒤 그 게시본을 동기 조회한다.
    await sA.턴({ text: '폴더 봐줘' });
    await sA.턴({ text: '한 번 더 봐줘' });
    await sA.게시대기();
    const r = await sA.턴({ text: '이어서 봐줘' });

    // ① 자리 A 세션은 원리A 만 본다 — 원리B 는 **읽지도 않는다**(scopeFiltered).
    assert.ok(r.principleTrace, 'trace 없음');
    assert.ok(r.principleTrace.retrievedIds.includes('원리A'), '자기 자리의 원리를 읽지 못했다');
    assert.ok(!r.principleTrace.retrievedIds.includes('원리B'), '다른 프로젝트의 원리를 읽었다(격리 실패)');
    // 범위 밖 세포는 **게시본에 실리지 않는다** — 전경이 거르는 게 아니라 애초에 오지 않는다.
    const 게시본 = sA.게시본저장소.read((await import('../src/kernel/l1-intent/principle-snapshot.js')).scopeKeyOf({ project: 자리A }));
    assert.deepEqual((게시본?.principles ?? []).map((x) => x.cellId), ['원리A'],
      '게시본이 자기 자리 원리만 담지 않았다');
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
    // 보장은 그대로다: **자리를 모르면 원리를 쓰지 않는다.** 다만 그 일이 일어나는 자리가 바뀌었다 —
    // 예전엔 전경이 저장소를 읽어 `scope_unknown` 으로 거절했고, 이제는 **애초에 조회하지 않는다**.
    // 미상을 `project:unknown` 이라는 공용 칸으로 보내면 서로 다른 프로젝트가 그 칸에서 섞이므로,
    // 미상은 게시도 조회도 하지 않는 것이 계약이다(§0-C-1 · 명세 §6).
    assert.deepEqual(pre.admitted, [], '자리를 모르는 턴이 추측으로 원리를 썼다');
    assert.deepEqual(pre.retrievedIds, [], '자리를 모르는 턴이 원리를 조회했다');
    assert.equal(pre.scopeKey, null, '미상 자리에 열쇠가 생겼다(공용 칸으로 새는 경로)');
    assert.equal(pre.reason, 'snapshot_miss',
      `자리를 모르는 턴의 사유가 미스가 아니다: ${JSON.stringify(pre)}`);
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
    // 감사 P1: 화면에 나가는 것은 **사람말**이다 — 도구 id·원시 대상 식별자가 아니다.
    assert.equal(g1.grants[0].label, '슬랙 게시');
    assert.equal(g1.grants[0].operation, 'send', '실제 행동 종류가 화면 사실에 없다');
    assert.equal(g1.grants[0].targetLabel, '#general');
    assert.equal(g1.grants[0].active, true);
    const 원문 = JSON.stringify(g1);
    assert.ok(!원문.includes('slack.post'), `원시 도구 id 가 화면 응답에 남았다: ${원문}`);

    // 3) **다음 턴 같은 행동·같은 대상 — 다시 묻지 않고 실행된다.**
    const 재사용 = await s.턴({ text: '방금 그 내용 슬랙에 다시 올려줘' });
    assert.ok(!재사용.pendingId, `허용 범위 안인데 다시 물었다: ${JSON.stringify(재사용).slice(0, 200)}`);
    assert.equal(s.발송기록.length, 2, '허용 범위 안의 실행이 일어나지 않았다');
    assert.ok(재사용.grantsReused?.length, '허용 범위로 진행한 사실이 결과에 없다(몰래 실행처럼 보인다)');

    // 4) **철회 버튼** → 즉시 다시 묻는다.
    const rv = await (await fetch(`${s.base}/grants/revoke`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.세션, id: g1.grants[0].id }),
    })).json();
    assert.equal(rv.revoked, true);
    const 철회후 = await s.턴({ text: '한 번 더 슬랙에 올려줘' });
    assert.ok(철회후.pendingId, '철회했는데 다시 묻지 않았다');
    assert.equal(s.발송기록.length, 2, '철회 후 승인 없이 발송됐다');
  } finally { await s.닫기(); }
});

// ── 감사 P0 · 같은 손이라도 **다른 행동은 다른 권한**이다 ────────────────────

test('감사 P0: 파일 쓰기 허용이 같은 파일의 삭제를 열지 않는다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-p0-'));
  const 자리 = join(dir, '작업자리');
  const 파일경로 = join(자리, 'a.txt');   // **작업 자리 안의 파일** — 실제 사용의 모양이다
  const 실행 = [];
  const 터미널 = {
    subjectOf(rec) {
      const c = rec?.result?.command;
      return c ? { key: `cmd:${c}`, kind: 'command', label: String(c), detail: rec.result?.cwd } : null;
    },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  // 같은 손(`local.file`)이 쓰기도 삭제도 한다 — 실제 제품과 같은 모양이다.
  const 파일 = {
    subjectOf(rec) {
      const p = rec?.result?.path ?? rec?.actualCall?.args?.path;
      return p ? { key: `file:${p}`, kind: 'file', label: String(p) } : null;
    },
    previewOf: (args) => ({ where: args?.path, what: args?.action, impact: `${args?.path} 을(를) ${args?.action}` }),
    async handler(args) { 실행.push({ ...args }); return { result: { path: args?.path, action: args?.action }, userSafeSummary: '했어요.' }; },
  };
  let 대본 = 'terminal';
  let 첫 = true;
  const 모델 = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (첫) {
      첫 = false;
      if (대본 === 'terminal') return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] };
      return { text: '', toolCalls: [{ name: 'local.file', args: { action: 대본, path: 파일경로, text: 'x' } }] };
    }
    return { text: '했어요', toolCalls: [] };
  } };
  const server = makeServer({
    store: new SessionStore(dir), env: demoEnv(),
    tools: demoTools({ localTerminal: 터미널, localFile: 파일 }), model: 모델,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sess = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const 턴 = async (body, kind) => {
      첫 = true; if (kind) 대본 = kind;
      return (await (await fetch(`${base}/turn`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: sess.id, ...body }),
      })).json());
    };
    await 턴({ text: '폴더 봐줘' }, 'terminal');           // 자리 확정
    // ① 쓰기를 24시간 허용한다.
    const 쓰기카드 = await 턴({ text: `${파일경로} 에 저장해줘` }, 'write');
    assert.ok(쓰기카드.pendingId, `쓰기 승인 카드가 없다: ${JSON.stringify(쓰기카드).slice(0, 200)}`);
    await 턴({ approve: 쓰기카드.pendingId, grantKind: 'session' });
    const 실행수 = 실행.length;

    // ② **같은 손·같은 파일이지만 삭제** — 감사 재현 입력 그대로.
    const 삭제 = await 턴({ text: `${파일경로} 지워줘` }, 'delete');
    assert.ok(삭제.pendingId,
      `파일 쓰기 허용이 같은 파일의 삭제를 열었다(A2 승인이 A3 를 통과시켰다): ${JSON.stringify(삭제).slice(0, 300)}`);
    assert.equal(삭제.grantsReused, undefined, '삭제가 쓰기 권한을 재사용했다');
    assert.equal(실행.length, 실행수, '승인 없이 삭제가 실행됐다');

    // ③ 같은 쓰기는 여전히 다시 묻지 않는다 — 과잉 차단으로 뒤집지 않았다.
    const 같은쓰기 = await 턴({ text: `${파일경로} 에 다시 저장해줘` }, 'write');
    assert.ok(!같은쓰기.pendingId, `허용한 쓰기인데 다시 물었다: ${JSON.stringify(같은쓰기).slice(0, 200)}`);
    assert.ok(같은쓰기.grantsReused?.length, '재사용 사실이 결과에 없다');
  } finally { await new Promise((r) => server.close(r)); }
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
  const { buildAdmissionSnapshot } = await import('../src/kernel/l5-growth/principle-publish.js');
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

// ── 감사 P1 · 「지금 자리」는 현재 대상과 무관한 옛 경로를 집지 않는다 ────────

test('감사 P1: 새 대상이 옛 경로와 무관하면 자리는 옛 경로가 아니다(모르면 null)', () => {
  // 감사 재현 그대로: 현재 대상은 새로 찾은 지난 대화, 두 턴 전 대상이 옛 프로젝트 경로.
  const 상태 = {
    turnNo: 5,
    subjects: [
      { key: 'search:배포', kind: 'session', label: '지난 대화', lastTurn: 5 },
      { key: 'cmd:ls', kind: 'command', label: 'ls', detail: '/Users/jyp/Developer/old-project', lastTurn: 3 },
    ],
  };
  assert.equal(currentPlaceOf(상태), null,
    '현재 대상과 무관한 옛 프로젝트 경로가 "지금 자리"로 올라왔다');
  // 화면·모델 입력도 같은 사실을 본다(한 계산 자리) — 옛 경로를 지금 자리라고 말하지 않는다.
  const 사실 = JSON.stringify(workingStateFacts(상태));
  assert.ok(!사실.includes('지금 자리'), `옛 경로를 지금 자리로 말했다: ${사실}`);

  // 반대 방향(과잉 차단 금지): 현재 대상이 그 자리 **안**이면 자리는 이어진다.
  assert.equal(currentPlaceOf({
    turnNo: 5,
    subjects: [
      { key: 'file:/Users/jyp/Developer/proj/a.txt', kind: 'file', label: '/Users/jyp/Developer/proj/a.txt', lastTurn: 5 },
      { key: 'cmd:ls', kind: 'command', label: 'ls', detail: '/Users/jyp/Developer/proj', lastTurn: 3 },
    ],
  }), '/Users/jyp/Developer/proj', '같은 자리 안의 파일을 다루는데 자리가 끊겼다');

  // 현재 대상이 자리를 직접 말하면 그것이 자리다(가장 강한 사실).
  assert.equal(currentPlaceOf({
    turnNo: 5,
    subjects: [{ key: 'cmd:ls', kind: 'command', label: 'ls', detail: '/now/here', lastTurn: 5 }],
  }), '/now/here');
  assert.equal(currentPlaceOf(null), null);
});

// ── 감사 P2 · 확인 원장의 **구조 손상**도 손상이다 ──────────────────────────

test('감사 P2: 계약이 틀린 확인 기록은 정상 항목으로 조회되지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-conf3-'));
  await mkdir(join(dir, 'growth'), { recursive: true });
  // 감사 주입 그대로 — 문법은 맞지만 **확인 기록 계약이 틀렸다**.
  await writeFile(join(dir, 'growth', 'confirmations.jsonl'),
    `${JSON.stringify({ id: 'x', kind: 'wrong', confirmed: 'yes', sourceRefs: 'not-array' })}\n`
    + `${JSON.stringify({ kind: 'user_confirmation', id: 'ok-1', tcellId: 'c1', at: 1, sourceRefs: ['r'], confirmed: true })}\n`,
    'utf8');
  const snap = await new ConfirmationStore(dir).snapshot();
  assert.equal(snap.get('x'), null, '계약이 틀린 줄이 정상 원장 항목으로 조회됐다');
  assert.equal(snap.degraded, true, '구조 손상이 degraded 로 보고되지 않았다');
  assert.ok(snap.get('ok-1'), '정상 줄이 함께 버려졌다');
});

// ── 감사 2회차 #1·#7 · 같은 요청 안에서도 **다른 행동은 다시 묻는다** ────────

async function 파일서버() {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-step-'));
  const 자리 = join(dir, '작업자리');
  const 파일경로 = join(자리, 'a.txt');
  const 실행 = [];
  const 터미널 = {
    subjectOf(r) { const c = r?.result?.command; return c ? { key: `cmd:${c}`, kind: 'command', label: String(c), detail: r.result?.cwd } : null; },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  const 파일 = {
    subjectOf(r) { const p = r?.result?.path; return p ? { key: `file:${p}`, kind: 'file', label: String(p) } : null; },
    previewOf: (a) => ({ where: a?.path, what: a?.action, impact: `${a?.path} ${a?.action}` }),
    async handler(a) { 실행.push({ action: a?.action, path: a?.path }); return { result: { path: a?.path, action: a?.action }, userSafeSummary: '했어요.' }; },
  };
  let 대본 = 'terminal'; let 단계 = 0; let 재개 = false;
  const 모델 = { async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '네';
    if (대본 === 'terminal') { if (단계 === 0) { 단계 = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; } return { text: '봤어요', toolCalls: [] }; }
    if (재개) { if (단계 === 0) { 단계 = 1; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'delete', path: 파일경로 } }] }; } return { text: '끝', toolCalls: [] }; }
    if (단계 === 0) { 단계 = 1; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'write', path: 파일경로, text: 'x' } }] }; }
    return { text: '끝', toolCalls: [] };
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 터미널, localFile: 파일 }), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const 턴 = async (b, k) => { 단계 = 0; if (k) 대본 = k; return (await (await fetch(`${base}/turn`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: s.id, ...b }) })).json()); };
  return { dir, base, 자리, 파일경로, 세션: s.id, 턴, 실행, 재개on: () => { 재개 = true; }, 닫기: () => new Promise((r) => server.close(r)) };
}

test('감사 #1: 같은 요청 안에서 write 승인 뒤 delete 는 새 승인으로 올라온다(조용한 종료 0)', async () => {
  const s = await 파일서버();
  try {
    await s.턴({ text: '폴더 봐줘' }, 'terminal');
    const 카드 = await s.턴({ text: '파일 저장하고 정리해줘' }, 'file');
    assert.ok(카드.pendingId, '쓰기 승인 카드가 없다');
    s.재개on();
    const 승인 = await s.턴({ approve: 카드.pendingId });
    // ① 쓰기는 실제로 실행됐다. ② **삭제는 실행되지 않았다.** ③ 새 승인으로 올라왔다.
    assert.deepEqual(s.실행.map((x) => x.action), ['write'], `삭제가 승인 없이 실행됐거나 쓰기가 빠졌다: ${JSON.stringify(s.실행)}`);
    assert.equal(승인.kind, 'approval',
      `삭제가 실행도 승인도 없이 조용히 끝났다: ${JSON.stringify(승인).slice(0, 300)}`);
    assert.ok(승인.pendingId);
    // ④ #7: 걸음 승인도 계획 승인과 **같은 범위 허용 계약**을 낸다.
    assert.ok(승인.grantOffer, '걸음 승인에 범위 허용 계약이 없다(계획 승인과 표면이 다르다)');
    assert.equal(승인.grantOffer.available, true);
    // ⑤ 그 삭제 승인을 누르면 그때 실행된다(과잉 차단이 아니다).
    const 삭제승인 = await s.턴({ approve: 승인.pendingId });
    assert.deepEqual(s.실행.map((x) => x.action), ['write', 'delete'], '승인했는데 삭제가 실행되지 않았다');
    assert.ok(삭제승인);
  } finally { await s.닫기(); }
});

test('감사 #1 반대 방향: 같은 손·같은 행동·같은 인자의 반복은 여전히 한 번만 묻는다', async () => {
  // 되풀이 방지와 재확인 면제가 함께 살아 있어야 한다 — 한쪽을 고치며 다른 쪽을 깨지 않았는지.
  const { buildTurnFacts } = await import('../src/kernel/l1-intent/turn-facts.js');
  void buildTurnFacts;
  const s = await 파일서버();
  try {
    await s.턴({ text: '폴더 봐줘' }, 'terminal');
    const 카드 = await s.턴({ text: '파일 저장해줘' }, 'file');
    assert.ok(카드.pendingId);
    // 승인 재개 뒤 모델이 **같은 쓰기**를 또 고르면(재개 플래그 없음) 되풀이로 막힌다 —
    // 카드가 두 번 뜨지 않고, 같은 일이 두 번 실행되지도 않는다.
    const 승인 = await s.턴({ approve: 카드.pendingId });
    assert.deepEqual(s.실행.map((x) => x.action), ['write'], '같은 쓰기가 두 번 실행됐다');
    assert.notEqual(승인.kind, 'approval', '같은 질문으로 카드가 두 번 떴다');
  } finally { await s.닫기(); }
});

test('감사 #5·#6: 재사용 고지와 허용 범위 목록에 원시 ID·내부 키가 없고, 서로 다른 파일이 구별된다', async () => {
  const s = await 파일서버();
  try {
    await s.턴({ text: '폴더 봐줘' }, 'terminal');
    const 카드 = await s.턴({ text: '파일 저장해줘' }, 'file');
    await s.턴({ approve: 카드.pendingId, grantKind: 'session' });
    // 같은 쓰기를 다시 요청하면 재사용된다 — 그 고지에 원시 ID·키가 없어야 한다.
    const 재사용 = await s.턴({ text: '파일 다시 저장해줘' }, 'file');
    assert.ok(재사용.grantsReused?.length, '재사용이 일어나지 않아 이 검사가 무의미해졌다');
    const 원문 = JSON.stringify(재사용.grantsReused);
    assert.ok(!원문.includes('local.file'), `재사용 고지에 도구 id 가 남았다: ${원문}`);
    assert.ok(!원문.includes('grant:'), `재사용 고지에 내부 키가 남았다: ${원문}`);
    assert.ok(!원문.includes(s.파일경로), `재사용 고지에 원시 대상이 남았다: ${원문}`);
    assert.ok(원문.includes('a.txt'), `무엇에 대한 허용인지 사람이 알 수 없다: ${원문}`);

    // #6: 서로 다른 파일 두 개가 **구별되어** 보인다.
    const { grantLedgerKey } = await import('../src/surface/tcell-store.js');
    const { SessionStore } = await import('../src/surface/session-store.js');
    const store = new SessionStore(s.dir);
    const sess = await store.load(s.세션);
    const scope = `project:${s.자리}`;
    for (const p of [join(s.자리, 'b.txt'), join(s.자리, '보고서', 'c.txt')]) {
      sess.grants.push({
        key: grantLedgerKey({ action: 'local.file', kind: 'write', target: p, scope }),
        kind: 'bounded', action: 'local.file', operation: 'write', target: p, scope,
        grantedAt: Date.now(), expiresAt: Date.now() + 3600_000, revoked: false,
      });
    }
    await store.save(sess);
    const g = await (await fetch(`${s.base}/grants?sessionId=${s.세션}`)).json();
    const 라벨들 = g.grants.map((x) => x.targetLabel);
    assert.equal(new Set(라벨들).size, 라벨들.length,
      `서로 다른 대상이 같은 이름으로 뭉개져 무엇을 철회할지 알 수 없다: ${JSON.stringify(라벨들)}`);
    assert.ok(!라벨들.includes('확인된 대상'), `대상을 구별할 수 없는 이름이 남았다: ${JSON.stringify(라벨들)}`);
  } finally { await s.닫기(); }
});

// ── 감사 5회차 P1 · **일반 회귀가 사용자 실계정으로 외부 호출을 하면 안 된다** ─────────────
// 실모델 검증선 파일이 `test/` 아래에 있고 제품의 연결 저장소(키가 든 파일)를 읽는다. 그것이
// 기본 `npm test` 에서 돌면, 아무 생각 없이 회귀를 돌린 사람의 자격으로 유료 호출·rate limit·
// 네트워크 실패가 일어난다. 그리고 연결이 없는 기계에서는 계열 0건이 되어 **조용히 초록**이 된다.
// 그래서 경계를 사실로 못 박는다: 저장소를 읽는 시험 파일은 하나뿐이고, 그 파일은 명시적
// 환경 스위치로만 켜진다.
test('연결 저장소를 읽는 시험은 명시적으로 켤 때만 돈다(일반 회귀는 외부 호출 0)', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const dir = new URL('../test/', import.meta.url).pathname;
  const 읽는파일 = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.js')) continue;
    const src = await readFile(join(dir, name), 'utf8');
    // **사용자의 실제 자리**를 여는 시험만 고른다 — 임시 폴더를 주는 단위 시험은 대상이 아니다.
    // 조각을 붙여 만든다: 이 파일 자신이 그 문자열을 품어 스스로 걸리지 않게.
    const 실자리 = ['.local', 'state', 'gpao-t5'].join('/');
    const 연결층 = /ModelConnectionStore|makeModelConnection/.test(src);
    if (연결층 && (src.includes(실자리) || /new ModelConnectionStore\(\s*\)/.test(src))) 읽는파일.push({ name, src });
  }
  // 지금은 **하나도 없다**(실모델 계약 하네스는 방향 전환으로 제외됐다). 목록이 비어 있다는 것이
  // 곧 일반 회귀가 사용자 자격을 건드리지 않는다는 뜻이다. 나중에 다시 생기면 아래 게이트 검사가
  // 그 파일마다 환경 스위치를 요구한다 — 파일 이름을 정답으로 고정하지 않는다.
  assert.deepEqual(읽는파일.map((f) => f.name), [],
    `제품 연결 저장소를 읽는 시험이 생겼다 — 일반 회귀가 실계정 호출을 하게 된다: ${
      JSON.stringify(읽는파일.map((f) => f.name))}`);
  for (const f of 읽는파일) {
    assert.match(f.src, /process\.env\.GPAO_T5_LIVE_MODELS === '1'/,
      `${f.name} 이 환경 스위치 없이 실계정 저장소를 읽는다`);
    // 스위치가 꺼졌을 때 저장소를 아예 열지 않아야 한다 — 열고 나서 건너뛰면 이미 늦다.
    const 게이트 = f.src.indexOf('라이브허용');
    assert.ok(게이트 >= 0 && f.src.search(/new ModelConnectionStore\(/) > 게이트,
      `${f.name} 이 스위치 판정보다 먼저 저장소를 연다`);
  }
});

// ── 감사 6회차 P0 · **원문·비밀이 추출 경로로 외부 모델에 도달하면 안 된다** ─────────────
// 관찰은 두 겹(modelReadable 플래그 + containsSecret 표식)으로 막혀 있었는데, 사람 발화와
// 지시 문면은 그 경계를 지나지 않고 곧장 모델 메시지로 갔다 — 저장은 막히고 송신은 안 막혔다.
// 다른 근거(반복 실패)로 추출이 이미 깨어난 턴에, 그 턴의 발화에 자격 문자열이 섞인 경우를 본다.
test('비밀이 섞인 발화는 추출 입력에도 모델 메시지에도 실리지 않는다', async () => {
  const { buildExtractionMessages } = await import('../src/runtime/model-provider.js');
  const 비밀 = 'sk-live-9f2Ka83Bx7Qw1Ee55Tz0Rr4Yy8Uu2Ii6';
  const 발화 = `또 막혔네. 앞으로 이런 건 ${비밀} 키로 대신 해줘`;
  const bundle = buildEvidenceBundle({
    id: 'b-secret', activeTarget: 발화,
    observations: [관찰(), 관찰({ receiptRefs: ['ledger:s:1'] })],
    explicitInstruction: { scope: 'session:s', text: 발화, observationRef: 'ledger:s:0' },
  });
  assert.equal(bundle.activeTarget, '', '비밀이 섞인 발화가 추출 입력에 남았다');
  assert.equal(bundle.explicitInstruction.text, '', '비밀이 섞인 지시 문면이 추출 입력에 남았다');
  // 범위·근거 참조(내부 열쇠)는 남는다 — 사라지면 근거 결합이 거짓으로 끊긴다.
  assert.equal(bundle.explicitInstruction.scope, 'session:s');
  const m = buildExtractionMessages(bundle);
  assert.ok(!`${m.system}\n${m.user}`.includes(비밀), '모델 메시지에 비밀이 실렸다');
  // 그리고 비밀이 없는 같은 모양의 발화는 **그대로 간다**(반대 방향 — 과차단이 아니다).
  const 정상 = buildEvidenceBundle({
    id: 'b-plain', activeTarget: '또 막혔네. 앞으로 이런 건 다른 방법부터 찾아줘',
    observations: [관찰()],
    explicitInstruction: { scope: 'session:s', text: '앞으로 이런 건 다른 방법부터 찾아줘', observationRef: 'ledger:s:0' },
  });
  assert.match(정상.activeTarget, /다른 방법부터/);
  assert.match(buildExtractionMessages(정상).user, /다른 방법부터/);
});

// ── 감사 6회차 P0/P1 · **두 세션이 겹쳐도 근거가 조용히 사라지지 않는다** ──────────────
// 추출 진행 상태가 서버 전역 한 칸이면, 뒤에 온 세션이 앞 세션의 대기를 덮어써서 앞 세션의
// 근거가 영영 모델에게 가지 않는다(격리 위반 + 조용한 손실). 세션마다 칸을 갖는지 본다.
test('두 세션이 동시에 추출을 깨워도 서로의 근거를 덮어쓰지 않는다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'tcell-2sess-'));
  const 자리 = join(dir, '자리');
  /** 추출 호출을 세션별로 관측한다(주입이 아니라 지나가며 본다). */
  const 추출본 = [];
  let 첫추출풀기 = null;
  const 첫추출대기 = new Promise((r) => { 첫추출풀기 = r; });
  let 단계 = 0;
  const 모델 = {
    async respond(tc, opts = {}) {
      if (tc?.tcellExtract) {
        추출본.push(tc.tcellExtract.observations.map((o) => o.sessionId));
        // 첫 추출을 붙들어 **비행 중**에 두 번째 세션이 들어오게 만든다(경합 재현).
        if (추출본.length === 1) await 첫추출대기;
        return JSON.stringify({ decision: 'insufficient_evidence' });
      }
      if (!opts.tools?.length) return '알겠어요';
      if (단계 === 0) { 단계 = 1; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: join(자리, 'x.csv') } }] }; }
      return { text: '봤어요', toolCalls: [] };
    },
  };
  const 던지는손 = {
    subjectOf: () => null,
    async handler(a) { throw new Error(`EACCES: permission denied, open '${a?.path}'`); },
  };
  const server = makeServer({
    store: new SessionStore(dir), env: demoEnv(),
    tools: demoTools({ localFile: 던지는손 }), model: 모델,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const 새세션 = async () => (await (await fetch(`${base}/sessions`, { method: 'POST' })).json()).id;
    const 턴 = async (id, text) => { 단계 = 0; return (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: id, text }),
    })).json(); };
    const 소유 = (묶음) => [...new Set(묶음)];
    const 셈 = (id) => 추출본.filter((묶음) => 소유(묶음).includes(id)).length;
    const 기다림 = async (조건, ms = 20_000) => {
      const 마감 = Date.now() + ms;
      while (Date.now() < 마감 && !조건()) await new Promise((r) => setTimeout(r, 25));
      return 조건();
    };

    const A = await 새세션(); const B = await 새세션();
    await 턴(A, '정산 파일 읽어줘');       // A 의 추출이 시작되고 **붙들린다**
    await 턴(A, '다시 해볼래?');            // A 의 새 근거 → A 칸에 대기
    await 턴(B, '정산 파일 읽어줘');       // B 는 A 의 혼잡과 무관해야 한다

    // ① **격리**: A 가 비행 중이어도 B 의 추출은 지금 시작된다. 전역 한 칸이면 여기서 막힌다.
    assert.ok(await 기다림(() => 셈(B) >= 1, 5_000),
      'A 의 추출이 비행 중이라는 이유로 B 세션의 추출이 시작되지 못했다(세션 격리 위반)');
    첫추출풀기();

    // ② **조용한 손실 0**: A 가 비행 중에 만든 새 근거는 잊히지 않고 이어서 돌아야 한다.
    //    전역 한 칸이면 B 의 요청이 A 의 대기를 덮어써서 A 는 영영 1회에 머문다.
    assert.ok(await 기다림(() => 셈(A) >= 2),
      `비행 중 도착한 A 의 새 근거가 조용히 사라졌다(A ${셈(A)}회 · B ${셈(B)}회)`);

    // ③ **교차 오염 0**: 한 번의 추출 입력에 두 세션의 관찰이 섞이면 안 된다.
    for (const 묶음 of 추출본) {
      assert.equal(소유(묶음).length, 1,
        `한 추출 입력에 서로 다른 세션의 관찰이 섞였다: ${JSON.stringify(소유(묶음))}`);
    }
  } finally { await new Promise((r) => server.close(r)); }
});

// ── §12 · 가역 학습 자동 반영의 **경계** — 자동이 아무 데나 번지지 않는다 ──────────────
// 자동성을 늘렸으니 그 반대 방향을 같은 힘으로 못 박는다. 하나라도 어긋나면 자동으로 하지 않고,
// **카드도 띄우지 않는다**(§12: 금지된 항목은 학습 순간에 승인 카드로 올리지 않는다).
test('§12: 자동 반영은 명시·가역·비밀 아님·선호일 때만이다(그 밖은 조용히 후보로 남는다)', async () => {
  const { autoApplicable } = await import('../src/kernel/l5-growth/reversible-autoapply.js');
  const 후보 = (over = {}) => ({
    candidateId: 'c', kind: 'preference', statement: '보고서는 목록으로',
    rollbackable: true, source: 'user_declared', ...over,
  });
  const 기본 = { rollbackable: true };

  assert.equal(autoApplicable(후보(), 기본).ok, true, '명시·가역 선호가 자동 반영되지 않았다');

  // ① **모델이 제안한 것은 사용자가 말한 것이 아니다**(감사 TG5-CX-01의 뿌리).
  //    호출자가 "명시했다"고 주장할 수 있으면 그 주장이 곧 사실이 된다 — 그래서 출처만 본다.
  assert.deepEqual(autoApplicable(후보({ source: 'model_proposal' }), 기본),
    { ok: false, reason: 'not_user_declared' });
  // 출처를 모르는 것도 명시가 아니다(모름은 허락이 아니다).
  assert.deepEqual(autoApplicable(후보({ source: 'unknown' }), 기본),
    { ok: false, reason: 'not_user_declared' });
  // **사용자 발화이기만 하면 안 된다** — 질문·인용은 발화이지 선언이 아니다(감사 TG5-CX-01).
  assert.deepEqual(autoApplicable(후보({ source: 'user_utterance' }), 기본),
    { ok: false, reason: 'not_user_declared' });
  // ② 운영 원리는 자동이 아니다 — 행동에 닿으므로 replay 게이트가 있다.
  assert.equal(autoApplicable(후보({ kind: 'operating_principle' }), 기본).reason, 'kind_needs_verification');
  // ③ 되돌릴 수 없으면 자동이 아니다 — 자동성은 되돌림으로 사는 것이지 그 반대가 아니다.
  assert.deepEqual(autoApplicable(후보(), { ...기본, rollbackable: false }),
    { ok: false, reason: 'not_reversible' });
  // ④ 비밀 모양은 자동도 아니고 카드도 아니다 — 애초에 담지 않는다.
  assert.equal(autoApplicable(후보({ statement: '토큰은 sk-live-9f2Ka83Bx7Qw1Ee55Tz0Rr4Yy8' }), 기본).reason,
    'secret_shaped');
});

// ── 감사 TG5-CX-01 · **모델 제안이 사용자 명시로 둔갑하지 않는다**(생산 관통) ──────────────
// 재현: 사용자는 `안녕`만 말했는데 모델이 `memory.propose` 를 냈다. 예전엔 그것이 그대로
// 장기 기억으로 자동 반영됐다 — 호출자가 `explicit: true` 를 상수로 넘겼기 때문이다.
test('TG5-CX-01: 모델이 제안한 선호는 자동 반영되지 않고, 사용자가 말한 선호는 자동 반영된다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'cx01-'));
  let 제안할까 = false;
  let 지어낼문장 = '사용자는 항상 답을 한 문장으로 원한다';
  const 모델 = {
    async respond(tc, opts = {}) {
      if (tc?.tcellExtract) return JSON.stringify({ decision: 'insufficient_evidence' });
      if (제안할까 && opts.tools?.length) {
        제안할까 = false;
        return { text: '네', toolCalls: [{ name: 'memory.propose', args: { kind: 'preference', statement: 지어낼문장 } }] };
      }
      return '네';
    },
  };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const 턴 = async (text) => (await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text }),
    })).json());

    // ① 모델 제안 — 사용자는 `안녕`만 말했다. 장기 기억에 들어가면 안 된다.
    제안할까 = true;
    const 모델턴 = await 턴('안녕');
    assert.equal(모델턴.memoryAutoApplied, undefined, '모델이 지어낸 선호가 자동 반영됐다');
    const m1 = await (await fetch(`${base}/memory`)).json();
    assert.equal(m1.promoted.length, 0, `모델 제안이 장기 기억에 저장됐다: ${JSON.stringify(m1.promoted)}`);

    // ② **감사 재현 원문은 아직 닫히지 않았다.** 모델이 질문 전체를 기억 후보로 읽는 최악의
    //    경우는 여기서 막히지 않는다 — 정규식도, 의도 층(`interpret`)도 "선언인가 질문인가"라는
    //    사실을 갖고 있지 않다(실측 2026-07-30). 그 사실을 새로 만들지 않고 검사를 통과시키면
    //    결함을 정답으로 굳히게 되므로, 여기에 거짓 통과를 적지 않는다. 미종료로 보고한다.

    // ③ 사용자가 선언하고 모델도 같은 문장으로 읽으면 자동 반영된다(반대 방향 — 과잉 차단 아님).
    제안할까 = true; 지어낼문장 = '보고서는 항상 글로 받는 게 좋아';
    const 사용자턴 = await 턴('보고서는 항상 글로 받는 게 좋아');
    assert.ok(사용자턴.memoryAutoApplied?.statement, '사용자가 직접 말한 선호가 반영되지 않았다');
    const m2 = await (await fetch(`${base}/memory`)).json();
    assert.equal(m2.promoted.length, 1, '사용자 명시 선호가 저장되지 않았다');
  } finally { await new Promise((r) => server.close(r)); }
});

// ── 감사 TG5-CX-04 · **게시 역할은 허용된 것 중 가장 높은 것이다** ────────────────────────
// 예전엔 세포 배열에서 처음 걸리는 값을 써서 언제나 최저 역할(`supporting_context`)이었다.
// M3·M4 가 검증돼도 계획·기본값에 도달할 수 없었다 — TG-5B 를 열어도 성능이 안 나오는 상태.
// ── 감사 TG5-CX-06 · 게시 성숙도는 **손으로 적은 목록이 아니라 계약에서 유도**한다 ─────────
test('TG5-CX-04·06: 성숙도별로 허용된 최고 역할이 게시되고, M0/M1 은 게시되지 않는다', async () => {
  const { projectScopeSnapshot } = await import('../src/kernel/l5-growth/principle-publish.js');
  const { makeTCellCandidate, influenceCeilingFor } = await import('../src/kernel/l5-growth/tcell-core.js');
  const 세포 = (state, allowed) => {
    const c = makeTCellCandidate({
      principle: { statement: `${state} 원리`, type: 'recovery' },
      boundary: { validWhen: ['직전 실행이 실패한 상태'], invalidWhen: [], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
      trace: { observationRefs: ['ledger:s:1'], corrections: [] },
      anchor: { project: '/자리', subject: null },
      geometry: { radius: 'task', depth: 0, sphereStability: 0 },
    });
    c.id = `cell-${state}`; c.state = state;
    c.binding = { '직전 실행이 실패한 상태': 'after_failure' };
    c.authority = { ...c.authority, allowedInfluence: allowed ?? influenceCeilingFor(state), requiresUserConfirmation: false };
    return c;
  };
  const 게시 = (cells) => projectScopeSnapshot({ cells, scope: { project: '/자리' }, now: 1, revision: 1 });
  const 역할 = (state) => 게시([세포(state)]).principles[0]?.role ?? null;

  // ① M0·M1 은 게시되지 않는다 — 영향 상한에 전경 역할이 없다.
  assert.equal(역할('M0_observed'), null, 'M0 이 게시됐다');
  assert.equal(역할('M1_candidate'), null, 'M1 이 게시됐다(전경에 후보가 왔다)');
  // ② M2 이상은 **허용된 것 중 가장 높은 역할**로 게시된다.
  assert.equal(역할('M2_replayed'), 'supporting_context');
  assert.equal(역할('M3_limited'), 'default_value', 'M3 가 최저 역할로 게시됐다');
  assert.equal(역할('M4_stable'), 'default_value', 'M4 가 최저 역할로 게시됐다');
  assert.equal(역할('M5_compressed'), 'default_value', 'M5 가 최저 역할로 게시됐다');
  // ③ 게시 상한 밖(answer_anchor)은 성숙도가 아무리 높아도 게시되지 않는다.
  assert.ok(!['answer_anchor'].includes(역할('M5_compressed')), '게시 상한 밖 역할이 실렸다');
  // ④ 세포가 세 역할 중 아무것도 허용하지 않으면 성숙도와 무관하게 게시되지 않는다.
  assert.equal(게시([세포('M4_stable', ['none', 'candidate_context'])]).principles.length, 0,
    '전경 역할이 없는데 게시됐다');
  // ⑤ 되돌려졌거나 격리된 상태는 게시 대상이 아니다.
  for (const 죽은 of ['softened', 'quarantined', 'rolled_back']) {
    assert.equal(역할(죽은), null, `${죽은} 이 게시됐다`);
  }
});

// ── 감사 TG5-CX-02 · **재시작 경계에서 학습 근거가 조용히 사라지지 않는다** ──────────────
// 예전엔 성장 진행 상태가 서버 수명의 Map 하나였다. 관찰이 남은 뒤 추출 전에 프로세스가 끝나면
// 새 서버는 그 관찰을 다시 깨우지 않았다 — 사용자는 실패를 알 수 없다.
test('TG5-CX-02: 중단 뒤 새 서버가 미처리 관찰부터 정확히 한 번 재개한다', async () => {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { GrowthCheckpointStore, TCellObserver } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'cx02-'));

  // 관찰만 남기고 추출 전에 프로세스가 끝난 상태를 만든다(= checkpoint 없음).
  // 실제 재시작과 같은 조건: **세션 파일이 있고** 그 세션의 관찰이 남아 있는데 처리 기록이 없다.
  const { SessionStore: SS } = await import('../src/surface/session-store.js');
  const 세션 = await new SS(dir).create();
  const ob = new TCellObserver(dir);
  for (const i of [0, 1]) {
    await ob.observeTurn({
      sessionId: 세션.id, ledgerStart: i, turnId: String(i), now: i + 1,
      turnReceipts: [{ userSafeSummary: '막혔어요.', failureState: 'failed', action: 'local.file 실행' }],
    });
  }
  const { events } = await ob.load({ sessionId: 세션.id });
  assert.ok(events.length >= 2, '중단 상황을 만들지 못했다');
  assert.deepEqual(await new GrowthCheckpointStore(dir).pending({ [세션.id]: events.length }), [세션.id],
    '미처리 관찰이 재개 대상으로 잡히지 않았다');

  // 새 서버가 뜨고 그 세션의 턴이 오면 뒤에서 재개한다.
  const 추출본 = [];
  const 모델 = { async respond(tc) {
    if (tc?.tcellExtract) { 추출본.push(tc.tcellExtract.observations.length); return JSON.stringify({ decision: 'insufficient_evidence' }); }
    return '네';
  } };
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), model: 모델 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // 서버가 뜨는 것만으로 재개가 걸린다 — 사용자가 다시 말하기를 기다리지 않는다.
    const 마감 = Date.now() + 10_000;
    while (Date.now() < 마감 && !추출본.length) await new Promise((r) => setTimeout(r, 25));
    // ① checkpoint 가 전진했다 — 처리한 만큼만, 처리 뒤에.
    const cp = await new GrowthCheckpointStore(dir).load();
    assert.ok(Object.keys(cp.sessions ?? {}).length > 0, '처리 뒤에도 checkpoint 가 전진하지 않았다');
    // ② 같은 지점을 두 번 처리하지 않는다 — 재개는 정확히 한 번이다.
    const 처리수 = Object.values(cp.sessions).reduce((a, b) => a + b, 0);
    assert.deepEqual(await new GrowthCheckpointStore(dir).pending({ [Object.keys(cp.sessions)[0]]: 처리수 }), [],
      '처리한 지점이 다시 미처리로 남았다');
  } finally { await new Promise((r) => server.close(r)); }
});
