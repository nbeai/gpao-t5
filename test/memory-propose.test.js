// H · **의미 포착은 모델이 한다 — 기억 후보 제출 통로(memory.propose).**
//
// 라이브 실측(2026-07-29 H 1회차): 오너가 `보고서는 표보다 짧은 목록으로 정리해줘.` 라고 했는데
// 정규식(detectCandidate)이 못 잡아 후보 0건 — 그런데 T5 는 "앞으로 …할게"라고 **기억을 약속**했다.
// "앞으로"를 붙이면 즉시 후보가 생겼다. 정규식 단어 하나가 최종 판정자였다(§24 위반, 아홉 번째
// 못 지킬 약속). 이제 모델이 이해한 선호를 구조화된 후보로 제출하고, 정규식은 보조 신호다.
//
// 불변식은 그대로다: 후보는 영향 0 · 자동 승격 없음 · 반영은 사용자 확인 뒤에만.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runTurn } from '../src/kernel/turn.js';
import { admittedContext } from '../src/kernel/l1-intent/context-mesh.js';
import { projectUserModel } from '../src/kernel/l1-intent/user-model.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { MemoryStore } from '../src/surface/memory-store.js';

// 정규식이 못 잡는 자연어 원문 — 라이브에서 실제로 샌 문장.
const 자연어선호 = '보고서는 표보다 짧은 목록으로 정리해줘.';

/** 지정한 도구 호출을 순서대로 내놓는 모델. */
function 계획모델(계획, 답 = '알겠어요') {
  let i = 0;
  return {
    async respond(tc, opts = {}) {
      // P90-2: 판정 호출도 구조 채널을 받는다 — 계약 사실로 가른다(구현 모양 대리 규칙 금지).
      if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
      if (!opts.tools?.length) return 답;
      if (i >= 계획.length) return { text: 답, toolCalls: [] };
      const 걸음 = 계획[i]; i += 1;
      return { text: '', toolCalls: [걸음] };
    },
  };
}

const 제안 = (args) => ({ name: 'memory.propose', args });
const ctxOf = (model) => ({ env: demoEnv(), model, tools: demoTools() });

test('모델이 이해한 선호가 후보가 된다 — 정규식이 최종 판정자가 아니다(수정 전 실패)', async () => {
  const r = await runTurn({ text: 자연어선호 },
    ctxOf(계획모델([제안({ kind: 'preference', statement: '보고서는 표보다 짧은 목록으로 정리한다' })])));
  assert.ok(r.memorySuggestion, '모델이 제출했는데 후보가 없다 — 정규식이 아직 판정자다');
  assert.equal(r.memorySuggestion.kind, 'preference');
  assert.equal(r.memorySuggestion.statement, '보고서는 표보다 짧은 목록으로 정리한다');
});

test('제출은 실행이 아니다 — 원장 0건 · 승인 카드 없음 · 영향 0', async () => {
  const r = await runTurn({ text: 자연어선호 },
    ctxOf(계획모델([제안({ statement: '보고서는 목록으로' })])));
  assert.notEqual(r.kind, 'approval', '후보 제출이 승인 카드가 됐다');
  const 원장 = [...(r.ledger?.confirmed ?? []), ...(r.ledger?.unconfirmed ?? [])];
  assert.ok(!원장.some((e) => JSON.stringify(e).includes('memory.propose')),
    `후보 제출이 실행 원장에 남았다: ${JSON.stringify(원장)}`);
  // 후보는 admittedContext 에 절대 들어가지 않는다(승격 전 영향 0).
  const mem = { candidates: [{ candidateId: 'c1', kind: 'preference', statement: '보고서는 목록으로', userConfirmed: false }], promoted: [] };
  assert.deepEqual(admittedContext(mem, '보고서 정리해줘'), [], '미승인 후보가 입장했다');
});

test('걸음 경로에서도 잡는다 — 다른 손 뒤의 제출', async () => {
  const 읽는손 = {
    async probe(command) { return { command, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(args) { return { result: { command: args.command, exitCode: 0, stdout: '', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
  };
  const r = await runTurn(
    { text: '작업 폴더 보고 앞으로는 이런 식으로 정리해줘' },
    { env: demoEnv(), tools: demoTools({ localTerminal: 읽는손 }),
      model: 계획모델([{ name: 'local.terminal', args: { command: 'ls' } }, 제안({ statement: '작업 폴더는 날짜별로 정리한다' })], '정리했어요') });
  assert.equal(r.memorySuggestion?.statement, '작업 폴더는 날짜별로 정리한다');
  assert.notEqual(r.kind, 'approval');
});

test('부정: 모델이 제출하지 않고 정규식도 못 잡으면 후보는 없다', async () => {
  const r = await runTurn({ text: 자연어선호 }, ctxOf(계획모델([])));
  assert.equal(r.memorySuggestion, null, '아무도 안 잡았는데 후보가 생겼다');
});

test('부정: 빈 문장 제출은 조용히 버린다', async () => {
  const r = await runTurn({ text: 자연어선호 }, ctxOf(계획모델([제안({ statement: '  ' })])));
  assert.equal(r.memorySuggestion, null);
});

test('보조 신호: 모델이 못 골라도 기존 정규식 신호는 남아 있다', async () => {
  const r = await runTurn({ text: '앞으로 보고서는 목록으로 줘' }, ctxOf(계획모델([])));
  assert.equal(r.memorySuggestion?.kind, 'preference', '보조 신호(정규식 폴백)가 사라졌다');
});

test('둘 다 있으면 모델 제출이 이긴다(정규식은 보조)', async () => {
  const r = await runTurn({ text: '앞으로 보고서는 목록으로 줘' },
    ctxOf(계획모델([제안({ statement: '보고서는 짧은 목록으로 정리한다' })])));
  assert.equal(r.memorySuggestion.statement, '보고서는 짧은 목록으로 정리한다');
});

// ── 투영 — 대기·반영 상태의 단일 진실(projectUserModel) ──────────────────
test('대화 후보(preference·operating_principle)도 확인 대기로 투영된다(수정 전 실패)', () => {
  const um = projectUserModel({
    candidates: [
      { candidateId: 'c1', kind: 'preference', statement: '목록으로' },
      { candidateId: 'c2', kind: 'operating_principle', statement: '보낼 땐 확인' },
      { candidateId: 'c3', kind: 'operating_preference', statement: '표로' },
    ],
    promoted: [{ candidateId: 'p1', kind: 'preference', statement: '짧게' }],
    observed: [{ kind: 'inferred_trait', statement: '아침형' }],
  });
  const pending = um.operatingPreferences.filter((x) => x.status === 'pending_confirm');
  assert.equal(pending.length, 3, `대화 후보가 투영에서 빠졌다: ${JSON.stringify(pending)}`);
  const admitted = um.operatingPreferences.filter((x) => x.admitted);
  assert.equal(admitted.length, 1);
  assert.equal(admitted[0].id, 'p1', '되돌리기용 id 가 없다');
  // 추정은 영향 0 그대로.
  assert.equal(um.inferredTraits[0].influence, 'none');
});

test('기억 검색 반영분(recalled_context)은 선호 투영에 섞이지 않는다(별도 절)', () => {
  const um = projectUserModel({ candidates: [], promoted: [{ candidateId: 'r1', kind: 'recalled_context', statement: '지난 결정' }], observed: [] });
  assert.equal(um.operatingPreferences.length, 0);
});

// ── 통제 채널은 실행 도구가 아니다 (감사 보강 1) ──────────────────────────
test('memory.propose 는 실행 등록부 어디에도 없다 — ToolRunner 로 도달 불가(수정 전 실패)', async () => {
  const { demoDescriptors } = await import('../src/surface/demo-context.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { toolSchemasFor, callsToIntentParts } = await import('../src/kernel/l2-plan/tool-schema.js');
  const { modelSchemasFor } = await import('../src/kernel/l2-plan/model-control.js');
  const tools = demoTools();
  // ① 손 없음 — 실행 경로가 애초에 없다(예비 handler 가 "적어뒀어요"라고 거짓 성공할 자리 제거).
  assert.equal(tools.tools['memory.propose'], undefined, '실행 손이 등록돼 있다');
  // ② 선언 없음 — descriptor·연결·도구함 어디에도 실행 도구로 나타나지 않는다.
  assert.ok(!demoDescriptors().some((d) => d.id === 'memory.propose'), 'descriptor 에 실행 도구로 선언돼 있다');
  const ss = buildSelfState(demoEnv(), { tools });
  assert.ok(!toolSchemasFor(ss).some((t) => t.name === 'memory.propose'), '실행 스키마에 나타난다');
  // ③ 그래도 모델에게는 보인다 — 통제 채널로.
  assert.ok(modelSchemasFor(ss).some((t) => t.name === 'memory.propose'), '모델이 통제 채널을 못 본다');
  // ④ 분리 경계를 우회해 계획 경로로 흘러도, 보여준 실행 도구가 아니므로 조용히 버려진다(이중 방어).
  const parts = callsToIntentParts([{ name: 'memory.propose', args: { statement: 'x' } }], ss);
  assert.deepEqual(parts.neededTools, [], '통제 호출이 계획 경로에 들어갔다');
});

// ── 서버 — 후보 정리(지우기)가 어느 턴에서도 가능하다 ────────────────────
test('/memory/reject 는 후보를 지운다 · /memory/confirm 은 종류 공통이다 · 수명주기 영수증이 남는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), memoryStore: new MemoryStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  try {
    const mem = new MemoryStore(dir);
    await mem.save({
      candidates: [
        { candidateId: 'c1', kind: 'preference', statement: '목록으로', userConfirmed: false, rollbackable: true },
        { candidateId: 'c2', kind: 'preference', statement: '지울 것', userConfirmed: false, rollbackable: true },
      ],
      promoted: [], observed: [],
    });
    // 지우기 — 상태에서는 사라지고, 사라졌다는 사실은 원장에 남는다.
    const rj = await (await post('/memory/reject', { candidateId: 'c2' })).json();
    assert.equal(rj.rejected, true);
    // 확인 — 대화 후보(kind: preference)가 공통 통로로 승격된다.
    const cf = await (await post('/memory/confirm', { candidateId: 'c1' })).json();
    assert.equal(cf.ok, true);
    const after = await mem.load();
    assert.equal(after.candidates.length, 0);
    assert.equal(after.promoted.length, 1);
    assert.equal(after.promoted[0].statement, '목록으로');
    // 철회 — 상태에서 제거되지만 "승인됐다가 철회됐다"는 감사 흔적은 원장에 남는다(감사 보강 2).
    const rb = await (await post('/memory/rollback', { candidateId: 'c1' })).json();
    assert.equal(rb.rolledBack, true);
    const ledger = await (await fetch(`${base}/memory/ledger`)).json();
    const events = ledger.entries.map((e) => e.event);
    assert.deepEqual(events, ['rejected', 'confirmed', 'rolled_back'],
      `수명주기 영수증이 빠졌다: ${JSON.stringify(events)}`);
    // 원장에 기억 원문은 없다 — 철회로 지운 내용이 원장에 되살아나지 않는다. digest 는 있다.
    const raw = JSON.stringify(ledger);
    assert.ok(!raw.includes('목록으로') && !raw.includes('지울 것'), '원장에 기억 원문이 남았다');
    assert.ok(ledger.entries.every((e) => /^[0-9a-f]{16}$/.test(e.digest)), '내용 지문이 없다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('옛 주소(/user-model/preferences/:id/confirm)도 같은 단일 통로로 승격한다(감사 보강 3)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem2-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), memoryStore: new MemoryStore(dir) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const mem = new MemoryStore(dir);
    await mem.save({
      candidates: [{ candidateId: 'op1', kind: 'operating_preference', statement: '표로 주세요', userConfirmed: false, rollbackable: true }],
      promoted: [], observed: [],
    });
    const r = await (await fetch(`${base}/user-model/preferences/op1/confirm`, { method: 'POST' })).json();
    assert.equal(r.ok, true);
    const after = await mem.load();
    assert.equal(after.promoted.length, 1);
    // 어느 주소로 승격해도 같은 수명주기 원장에 남는다 — 통로가 갈라지면 여기서 잡힌다.
    const ledger = await (await fetch(`${base}/memory/ledger`)).json();
    assert.deepEqual(ledger.entries.map((e) => e.event), ['confirmed'], '옛 주소가 원장 밖에서 승격했다');
  } finally { await new Promise((r) => server.close(r)); }
});
