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
    async respond(_tc, opts = {}) {
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

// ── 서버 — 후보 정리(지우기)가 어느 턴에서도 가능하다 ────────────────────
test('/memory/reject 는 후보를 지운다 · /memory/confirm 은 종류 공통이다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-mem-'));
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools(), memoryStore: new MemoryStore(dir) });
  await new Promise((r) => server.listen(0, r));
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
    // 지우기 — 영향 0이었으니 흔적 없이 사라진다.
    const rj = await (await post('/memory/reject', { candidateId: 'c2' })).json();
    assert.equal(rj.rejected, true);
    // 확인 — 대화 후보(kind: preference)가 공통 통로로 승격된다.
    const cf = await (await post('/memory/confirm', { candidateId: 'c1' })).json();
    assert.equal(cf.ok, true);
    const after = await mem.load();
    assert.equal(after.candidates.length, 0);
    assert.equal(after.promoted.length, 1);
    assert.equal(after.promoted[0].statement, '목록으로');
  } finally { await new Promise((r) => server.close(r)); }
});
