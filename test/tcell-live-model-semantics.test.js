// 감사 2회차 #2·#3 · **실제 모델의 의미 판정을 생산 경로 끝까지 관통한다.**
//
// 이전 판의 두 결함을 여기서 닫는다:
//  #2 결합·관계가 **없어도 통과**해서 시험 제목의 의미 판정을 증명하지 못했다
//     → 이제 결합/관계가 없으면 **실패**한다. `insufficient_evidence` 도 통과로 세지 않는다.
//  #3 `extractCandidate` 직접 호출만 지나 생산 경로를 검증하지 않았다
//     → 이제 **실서버 턴**으로 관찰→추출→저장을 만들고, 그 저장물로 다음 턴 admission 까지 본다.
//
// 자격이 없으면 **건너뛴 사실을 기록**한다(조용히 통과시키지 않는다).
// 실행:
//   OPENAI_API_KEY=… ANTHROPIC_API_KEY=… node --test test/tcell-live-model-semantics.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeProviderModelClient } from '../src/runtime/model-provider.js';
import { TCellRegistry, TCellObserver } from '../src/surface/tcell-store.js';
import { buildTurnFacts } from '../src/kernel/l1-intent/turn-facts.js';
import {
  buildAdmissionSnapshot, admitFromSnapshot, ADMISSION_REASONS,
} from '../src/kernel/l1-intent/tcell-admission.js';
import { isFactAtom } from '../src/kernel/l1-intent/fact-atoms.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const LANES = [
  { 이름: 'OpenAI', provider: 'openai', key: process.env.OPENAI_API_KEY, base: 'https://api.openai.com/v1', model: process.env.GPAO_T5_LIVE_OPENAI_MODEL ?? 'gpt-5.1' },
  { 이름: 'Anthropic', provider: 'anthropic', key: process.env.ANTHROPIC_API_KEY, base: 'https://api.anthropic.com', model: process.env.GPAO_T5_LIVE_ANTHROPIC_MODEL ?? 'claude-opus-4-8' },
];

/**
 * **생산 경로 서버** — 실제 대화 턴을 돌려 관찰을 만들고, 그 관찰로 추출을 깨워
 * 세포를 저장소에 남긴다. 어느 단계도 시험이 대신하지 않는다.
 *
 * 대화 응답은 결정적 스텁이 맡고(대화 품질은 이 시험의 대상이 아니다),
 * **추출 호출만 실제 모델**이 받는다 — 판정 대상이 그것이기 때문이다.
 */
async function 생산서버(lane) {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const dir = await mkdtemp(join(tmpdir(), `live-${lane.provider}-`));
  const 자리 = join(dir, '작업자리');
  const 실모델 = makeProviderModelClient({
    provider: lane.provider, modelId: lane.model, maxTokens: 4000, token: lane.key, baseUrl: lane.base,
  });
  let 단계 = 0;
  const 실패 = { async handler() { return { failureState: 'tool_error', userSafeSummary: '파일을 읽지 못했어요(권한 없음).' }; } };
  const 터미널 = {
    subjectOf(r) { const c = r?.result?.command; return c ? { key: `cmd:${c}`, kind: 'command', label: String(c), detail: r.result?.cwd } : null; },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  const 모델 = {
    async respond(tc, opts = {}) {
      // **추출 호출만 실제 모델로 보낸다** — 전용 경계(tcellExtract)가 그 신분이다.
      if (tc?.tcellExtract) return 실모델.respond(tc, opts);
      if (!opts.tools?.length) return '알겠어요';
      if (단계 === 0) { 단계 = 1; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
      if (단계 === 1) { 단계 = 2; return { text: '', toolCalls: [{ name: 'local.file', args: { action: 'read', path: join(자리, 'a.txt') } }] }; }
      return { text: '했어요', toolCalls: [] };
    },
  };
  const server = makeServer({
    store: new SessionStore(dir), env: demoEnv(),
    tools: demoTools({ localTerminal: 터미널, localFile: 실패 }), model: 모델,
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const s = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
  const 턴 = async (text) => {
    단계 = 0;
    return (await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: s.id, text }),
    })).json());
  };
  return { dir, 자리, 세션: s.id, 턴, 닫기: () => new Promise((r) => server.close(r)) };
}

/** 추출은 응답 뒤(후처리)에 돈다 — 저장될 때까지 기다린다. */
async function 세포생길때까지(dir, 초 = 60) {
  const reg = new TCellRegistry(dir);
  for (let i = 0; i < 초 * 4; i += 1) {
    const cells = (await reg.load()).cells ?? [];
    if (cells.length) return cells;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [];
}

for (const lane of LANES) {
  const 건너뜀 = lane.key ? false : `${lane.이름} 자격 없음 — 이 검증선 미실행(증거에 그대로 기록)`;

  test(`[실모델 ${lane.이름}] 생산 경로 관통: 관찰 → 추출 → 저장 → 다음 턴 admission`, { skip: 건너뜀 }, async () => {
    const s = await 생산서버(lane);
    try {
      // ① 실제 턴 두 번 — 자리 확정 + 실패 관찰(추출을 깨우는 근거)을 **생산 경로로** 만든다.
      await s.턴('작업 폴더 좀 봐줘');
      await s.턴('그 파일 읽어줘');
      await s.턴('또 안 되네, 앞으로 이런 건 다른 방법부터 찾아줘');

      // ② 관찰이 실제로 남았는가(생산 경로의 앞 절반).
      const { events } = await new TCellObserver(s.dir).load({ sessionId: s.세션 });
      assert.ok(events.length > 0, '생산 경로가 관찰을 만들지 못했다');
      assert.ok(events.some((e) => e.signal?.valence === 'failure'), '실패 관찰이 없다(추출을 깨울 근거가 없다)');

      // ③ **실제 모델이** 그 관찰에서 원리를 뽑아 저장소에 남겼는가(뒤 절반).
      const cells = await 세포생길때까지(s.dir);
      assert.ok(cells.length > 0, '실제 모델 추출이 저장소에 아무 것도 남기지 못했다(생산 경로 단절)');
      const cell = cells[0];

      // ④ #2: **의미 결합이 실제로 있어야 한다.** 없으면 이 시험은 통과하지 않는다.
      const 결합 = cell.binding ?? {};
      assert.ok(Object.keys(결합).length > 0,
        `모델이 경계를 OS 사실 어휘에 결합하지 않았다(의미 결합 미증명): ${JSON.stringify(cell.boundary)}`);
      for (const [절, atom] of Object.entries(결합)) {
        assert.ok(isFactAtom(atom), `없는 원자에 결합했다: ${절} → ${atom}`);
      }
      // 실패 근거만 준 묶음이므로 실패 계열 원자에 결합돼야 admission 에서 살아난다.
      assert.ok(Object.values(결합).some((a) => a === 'after_failure' || a === 'prev_turn_failure'),
        `실패 상황의 원리인데 실패 원자에 결합되지 않았다: ${JSON.stringify(결합)}`);

      // ⑤ **그 저장물로 다음 턴 admission 이 실제로 판정한다** — 같은 사실이 끝까지 유지되는가.
      cell.state = 'M2_replayed';
      cell.authority = { ...cell.authority, allowedInfluence: ['none', 'supporting_context'], requiresUserConfirmation: false };
      await new TCellRegistry(s.dir).upsert(cell, null);
      const ob = new TCellObserver(s.dir);
      const snap = await buildAdmissionSnapshot({
        registry: new TCellRegistry(s.dir), observer: ob, scope: { project: cell.anchor?.project ?? null },
      });
      const 재료 = buildTurnFacts({
        stage: 'pre_model', sessionId: s.세션, projectId: cell.anchor?.project ?? null,
        ledgerWindow: {
          previousTurn: [{ userSafeSummary: '실패', failureState: 'tool_error', action: 'local.file 실행' }],
          previousTurnStart: 0,
        },
      });
      const trace = admitFromSnapshot(snap, { ...재료, stage: 'pre_model', now: Date.now() }).trace;
      assert.ok(trace.admitted.some((a) => a.id === cell.id),
        `모델이 결합한 원리가 다음 턴 admission 에서 살아나지 못했다: ${JSON.stringify(trace.rejected)}`);
    } finally { await s.닫기(); }
  });

  test(`[실모델 ${lane.이름}] 반대 뜻 지시를 기존 원리와의 관계로 판정한다`, { skip: 건너뜀 }, async () => {
    const { buildEvidenceBundle, extractCandidate } = await import('../src/runtime/tcell-extractor.js');
    const { makeObservationEvent } = await import('../src/kernel/l0-evidence/tcell-observation.js');
    const model = makeProviderModelClient({
      provider: lane.provider, modelId: lane.model, maxTokens: 4000, token: lane.key, baseUrl: lane.base,
    });
    const bundle = buildEvidenceBundle({
      id: 'live-contra', activeTarget: '보낼 땐 확인하지 마',
      observations: [makeObservationEvent({
        type: 'user_correction', sessionId: 's', turnId: '1', occurredAt: 1,
        anchor: { workspace: '/w', project: '/p', surface: 'web', subject: null },
        signal: { summary: '사용자가 확인 없이 바로 보내라고 했어요', valence: 'correction' },
        sourceRefs: ['session:s'], receiptRefs: ['ledger:s:0'],
      })],
      existingCandidates: [{
        id: 'cell-확인',
        statement: '외부로 보내기 전에는 대상을 사용자에게 확인한다',
        center: { point: '전송 전 확인', axis: '외부 효과' },
        boundary: { validWhen: ['보내기 직전'], invalidWhen: [] },
        anchor: { project: '/p', subject: null },
      }],
      explicitInstruction: { scope: 'session:s', text: '보낼 땐 확인하지 마', observationRef: 'ledger:s:0' },
    });
    const r = await extractCandidate({ model, bundle, now: 1, timeoutMs: 90_000 });
    // #2: **관계가 없으면 통과시키지 않는다.** 의미 판정을 증명하는 것이 이 시험의 목적이다.
    assert.ok(r.relation, `모델이 기존 원리와의 관계를 전혀 잡지 못했다: ${JSON.stringify(r).slice(0, 400)}`);
    assert.equal(r.relation.id, 'cell-확인', `지어낸 대상을 가리켰다: ${JSON.stringify(r.relation)}`);
    assert.equal(r.relation.kind, 'contradicts',
      `반대 지시를 반대로 판정하지 못했다: ${r.relation.kind}`);
    void ADMISSION_REASONS;
  });
}

test('실모델 검증선의 실행 여부를 사실로 남긴다', () => {
  const 있음 = LANES.filter((l) => l.key).map((l) => l.이름);
  const 없음 = LANES.filter((l) => !l.key).map((l) => l.이름);
  if (없음.length) {
    console.error(`[실모델 미검증] ${없음.join(', ')} — 자격 없음. 실행된 검증선: ${있음.join(', ') || '없음'}`);
  }
  assert.equal(LANES.length, 2);
});
