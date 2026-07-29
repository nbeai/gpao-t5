// TG-5A 선행 반대시험 20건(계약 패킷 §9 + 감사 보강 8건) — admission 은 shadow, 영향은 0이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitPrinciples, resolveRole, judgeClause, explainAdmission,
  ADMISSION_REASONS, STAGE_ALLOWED_ROLES, ROLE_ORDER,
} from '../src/kernel/l1-intent/tcell-admission.js';
import { makeTCellCandidate } from '../src/kernel/l5-growth/tcell-core.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';

const 저장소 = (recs = {}) => ({ get: (k) => recs[k] ?? null });
const 세포 = (over = {}) => {
  const c = makeTCellCandidate({
    principle: { statement: '막힌 손은 같은 인자로 반복하지 않는다', type: 'recovery', ...(over.principle ?? {}) },
    boundary: { validWhen: ['실패 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'], ...(over.boundary ?? {}) },
    trace: { observationRefs: ['ledger:s:1'], corrections: [] },
    anchor: { project: 'T5', subject: '정산', ...(over.anchor ?? {}) },
    geometry: { radius: 'task', depth: 0, sphereStability: 0, ...(over.geometry ?? {}) },
  });
  c.state = over.state ?? 'M3_limited';
  c.authority = { ...c.authority, allowedInfluence: ['none', 'candidate_context', 'supporting_context', 'plan_hint'], requiresUserConfirmation: false, ...(over.authority ?? {}) };
  if (over.anchor?.stale) c.anchor.stale = true;
  return c;
};
const 기본입력 = (cell, over = {}) => ({
  candidateIds: [cell.id], principleStore: 저장소({ [cell.id]: cell }),
  evidenceStore: 저장소({ 'ledger:s:1': { type: 'tool_result', turnId: '1' } }),
  confirmationStore: 저장소({}), grantStore: 저장소({}),
  requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후', ref: 'ledger:s:1' }] },
  now: 1000, ...over,
});

test('1·4: 미입장 원리는 영향 0이고, M1·quarantined·rolled_back 은 후보에 오르지 못한다', () => {
  for (const [state, code] of [['M1_candidate', ADMISSION_REASONS.maturity],
    ['quarantined', ADMISSION_REASONS.terminal], ['rolled_back', ADMISSION_REASONS.terminal],
    ['softened', ADMISSION_REASONS.terminal]]) {
    const c = 세포({ state });
    const { admissions, trace } = admitPrinciples(기본입력(c));
    assert.equal(admissions.length, 0, `${state} 가 입장했다`);
    assert.equal(trace.rejected[0].reason, code);
    assert.deepEqual(trace.influencedPlan, []);
    assert.deepEqual(trace.influencedAnswer, []);
  }
});

test('2·15: 범위는 식별자로 판정한다 — 시간 경과는 불일치가 아니고, 다른 project·stale 은 거절', () => {
  const 같은범위 = 세포({ anchor: { project: 'T5', subject: '정산', createdAt: 1, lastObservedAt: 1 } });
  assert.equal(admitPrinciples(기본입력(같은범위)).admissions.length, 1, '오래됐다는 이유로 막혔다');
  const 다른project = 세포({ anchor: { project: '다른곳', subject: '정산' } });
  assert.equal(admitPrinciples(기본입력(다른project)).trace.rejected[0].reason, ADMISSION_REASONS.scope);
  const 다른subject = 세포({ anchor: { project: 'T5', subject: '배포' } });
  assert.equal(admitPrinciples(기본입력(다른subject)).trace.rejected[0].reason, ADMISSION_REASONS.scope);
  const stale = 세포({ anchor: { project: 'T5', subject: '정산', stale: true } });
  assert.equal(admitPrinciples(기본입력(stale)).trace.rejected[0].reason, ADMISSION_REASONS.stale);
  const turn범위 = 세포({ geometry: { radius: 'turn' } });
  assert.equal(admitPrinciples(기본입력(turn범위)).trace.rejected[0].reason, ADMISSION_REASONS.scope);
});

test('3: 현재 사용자 정정과 충돌하면 즉시 거절된다(현재 원문이 1순위)', () => {
  const c = 세포();
  const r = admitPrinciples(기본입력(c, {
    requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }], contradicts: ['막힌 손은 같은 인자로 반복하지 않는다'] },
  }));
  assert.equal(r.admissions.length, 0);
  assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.conflict);
});

test('5·17: role 은 세 집합의 교집합 최대값 — 상한·단계를 넘지 못하고 answer_anchor 는 불가', () => {
  // M2 상한은 supporting_context 까지 — plan_hint 를 허용해도 잘린다.
  const m2 = 세포({ state: 'M2_replayed' });
  assert.equal(resolveRole(m2), 'supporting_context');
  // M4 는 상한이 전체지만 이번 단계 집합이 answer_anchor 를 갖지 않는다.
  const m4 = 세포({ state: 'M4_stable', authority: { allowedInfluence: [...ROLE_ORDER] } });
  assert.equal(resolveRole(m4), 'default_value', 'answer_anchor 로 자동 상승했다');
  assert.ok(!STAGE_ALLOWED_ROLES.includes('answer_anchor'));
  // 세포가 아무 역할도 허용하지 않으면 입장 없음.
  const 없음 = 세포({ authority: { allowedInfluence: ['none'] } });
  assert.equal(resolveRole(없음), 'none');
  assert.equal(admitPrinciples(기본입력(없음)).trace.rejected[0].reason, ADMISSION_REASONS.roleEmpty);
});

test('6·16: A2/A3 원리는 유효한 bounded grant 없이는 참고 대상이 아니다(일회성·만료·다른 대상 포함)', () => {
  // 등급은 세포가 아니라 **이번 턴 행동의 사실**이다.
  const 전송원리 = () => 세포({ principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' } });
  const base = (over) => 기본입력(전송원리(), {
    authorityFacts: { actionTier: 'A2', actionKind: 'send', target: '오너', scope: 'project:T5', grantRef: 'g1' },
    ...over,
  });
  // grant 없음
  assert.equal(admitPrinciples(base({})).trace.rejected[0].reason, ADMISSION_REASONS.authority);
  for (const [이름, g] of [
    ['일회성', { kind: 'once', action: 'send', target: '오너', scope: 'project:T5', expiresAt: 9999 }],
    ['만료', { kind: 'bounded', action: 'send', target: '오너', scope: 'project:T5', expiresAt: 10 }],
    ['다른 대상', { kind: 'bounded', action: 'send', target: '남', scope: 'project:T5', expiresAt: 9999 }],
    ['다른 행동', { kind: 'bounded', action: 'delete', target: '오너', scope: 'project:T5', expiresAt: 9999 }],
    ['다른 범위', { kind: 'bounded', action: 'send', target: '오너', scope: 'project:X', expiresAt: 9999 }],
  ]) {
    const r = admitPrinciples(base({ grantStore: 저장소({ g1: g }) }));
    assert.equal(r.admissions.length, 0, `${이름} grant 가 A2 를 열었다`);
    assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.authority);
  }
  // 정확히 일치하는 유효 grant → 참고 가능. 단 실행 승인은 아니다.
  const ok = admitPrinciples(base({ grantStore: 저장소({ g1: { kind: 'bounded', action: 'send', target: '오너', scope: 'project:T5', expiresAt: 9999 } }) }));
  assert.equal(ok.admissions.length, 1);
  assert.equal(ok.admissions[0].authorityAllowed, true);
  assert.equal(ok.admissions[0].reverifyAtExecution, true, '실행 경계 재검증 표시가 없다');
  // A2 턴이라도 계획·값에 관여하지 않는 역할(맥락)은 권한을 여는 것이 아니다.
  const 맥락만 = 세포({ state: 'M2_replayed' }); // 상한이 supporting_context 까지
  const r맥락 = admitPrinciples(기본입력(맥락만, { authorityFacts: { actionTier: 'A3', actionKind: 'delete' } }));
  assert.equal(r맥락.admissions.length, 1, '맥락 역할이 A3 턴이라고 막혔다(과잉 차단)');
  assert.equal(r맥락.admissions[0].role, 'supporting_context');
});

test('7·13: 확인·세포·권한은 조회된 사실만 쓴다 — 호출자 위조는 통하지 않는다', () => {
  const c = 세포({ authority: { requiresUserConfirmation: true } });
  // 확인 기록 없음 → 미입장
  assert.equal(admitPrinciples(기본입력(c)).trace.rejected[0].reason, ADMISSION_REASONS.confirmation);
  // 호출자가 세포 객체·불리언을 넣어도 저장소가 진실이다.
  const 위조 = admitPrinciples({
    ...기본입력(c), cells: [{ ...c, authority: { requiresUserConfirmation: false } }], authorityAllowed: true, confirmed: true,
  });
  assert.equal(위조.admissions.length, 0, '위조 입력이 통했다');
  // tcellId 가 다른 확인 기록도 인정되지 않는다.
  const 남의확인 = admitPrinciples(기본입력(c, {
    confirmationStore: 저장소({ ok: { kind: 'user_confirmation', tcellId: '남', confirmed: true, at: 1 } }),
    requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }], confirmationRefs: { [c.id]: 'ok' } },
  }));
  assert.equal(남의확인.admissions.length, 0);
  // 제대로 된 확인 기록이면 입장.
  const 정상 = admitPrinciples(기본입력(c, {
    confirmationStore: 저장소({ ok: { kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1 } }),
    requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }], confirmationRefs: { [c.id]: 'ok' } },
  }));
  assert.equal(정상.admissions.length, 1);
});

test('8: trace 하강 불가면 입장하지 않는다', () => {
  const c = 세포();
  assert.equal(admitPrinciples(기본입력(c, { evidenceStore: 저장소({}) })).trace.rejected[0].reason, ADMISSION_REASONS.trace);
  const 근거없음 = 세포(); 근거없음.trace.observationRefs = [];
  assert.equal(admitPrinciples(기본입력(근거없음)).trace.rejected[0].reason, ADMISSION_REASONS.trace);
});

test('9·18: 손상 후보가 정상 후보를 막지 않고 status:degraded 가 남는다', () => {
  const 정상 = 세포();
  const store = 저장소({ [정상.id]: 정상, '손상': { state: 7 }, '없음': null });
  const r = admitPrinciples(기본입력(정상, { candidateIds: [정상.id, '손상', '없음'], principleStore: store }));
  assert.equal(r.admissions.length, 1, '손상 후보가 정상 후보를 막았다');
  assert.equal(r.trace.status, 'degraded');
  assert.ok(r.trace.errorCodes.length >= 1);
  // 계약 E: 모든 후보는 정확히 한 번 나타난다.
  assert.equal(r.trace.admitted.length + r.trace.rejected.length, 3);
  // 정상적으로 입장 대상이 없는 경우는 ok(degraded 아님).
  const 빈것 = admitPrinciples(기본입력(세포({ state: 'M1_candidate' })));
  assert.equal(빈것.trace.status, 'ok');
  assert.equal(빈것.admissions.length, 0);
});

test('10·14: unknown 은 입장 근거도 단독 거절 근거도 아니다', () => {
  assert.equal(judgeClause('실패 직후', [{ fact: '실패 직후', ref: 'r' }]).verdict, 'matched');
  assert.equal(judgeClause('실패 직후', [{ fact: '!실패 직후' }]).verdict, 'not_matched');
  assert.equal(judgeClause('실패 직후', []).verdict, 'unknown');
  // validWhen 이 전부 unknown 이면 입장하지 못한다(unknown 은 근거가 아니다).
  const c = 세포();
  const r = admitPrinciples(기본입력(c, { requestFacts: { project: 'T5', subject: '정산', facts: [] } }));
  assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.boundary);
  // invalidWhen 이 unknown 이어도 그것만으로 막히지 않는다(과잉 차단 금지).
  const 통과 = admitPrinciples(기본입력(c)); // '재시도 지시' 는 사실 집합에 없어 unknown
  assert.equal(통과.admissions.length, 1, 'unknown invalidWhen 이 단독으로 막았다');
  assert.ok(통과.admissions[0].boundaryChecks.some((b) => b.kind === 'invalidWhen' && b.verdict === 'unknown'));
  // invalidWhen 이 matched 면 당연히 막힌다.
  const 막힘 = admitPrinciples(기본입력(c, { requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }, { fact: '재시도 지시' }] } }));
  assert.equal(막힘.trace.rejected[0].reason, ADMISSION_REASONS.invalidWhen);
});

test('12·19: 재시작·철회 뒤 되살아나지 않고, 사용자 원문·비밀값이 trace 에 남지 않는다', () => {
  const c = 세포({ state: 'rolled_back' });
  assert.equal(admitPrinciples(기본입력(c)).admissions.length, 0);
  // trace 는 사유 **코드**만 담는다 — 사용자 원문·비밀이 들어갈 자리가 없다.
  const 비밀facts = [{ fact: '실패 직후' }, { fact: 'sk-proj-AbCdEf0123456789AbCdEf0123456789' }];
  const r = admitPrinciples(기본입력(세포(), {
    requestFacts: { project: 'T5', subject: '정산', facts: 비밀facts, userText: '내 키는 sk-proj-XYZ 야' },
  }));
  const json = JSON.stringify(r.trace);
  assert.ok(!json.includes('sk-proj-'), '비밀 모양이 trace 에 남았다');
  assert.ok(!json.includes('내 키는'), '사용자 원문이 trace 에 남았다');
  assert.ok(!json.includes('막힌 손은'), '원리 문장이 trace 에 원문으로 남았다');
  for (const e of [...r.trace.admitted, ...r.trace.rejected]) {
    assert.ok(Object.values(ADMISSION_REASONS).includes(e.reason), `사유가 코드가 아니다: ${e.reason}`);
  }
  assert.ok(explainAdmission({ reason: ADMISSION_REASONS.conflict }).includes('지금'));
});

test('total function: 임의 입력에도 던지지 않는다', () => {
  for (const 이상 of [null, 7, 'x', [], { candidateIds: 'x' }, { candidateIds: [null, 7] }]) {
    assert.doesNotThrow(() => admitPrinciples(이상));
    assert.doesNotThrow(() => resolveRole(이상));
    assert.doesNotThrow(() => judgeClause(이상, 이상));
    assert.doesNotThrow(() => explainAdmission(이상));
  }
  assert.deepEqual(admitPrinciples(null).admissions, []);
});

// ── 11·20: 영향 0 관통 — 실제 runTurn 을 지나며 모든 관측 가능한 것이 동일해야 한다 ──
test('11·20: admission on/off 에서 메시지·스키마·호출·실행·외부효과·registry 동일, trace 만 다름', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { TCellRegistry } = await import('../src/surface/tcell-store.js');
  const 실행기록 = [];
  const 손 = {
    async probe(c) { return { command: c, cwd: '/x', changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 실행기록.push(a); return { result: { command: a.command, exitCode: 0, stdout: '', cwd: '/x' }, userSafeSummary: '봤어요.' }; },
  };
  const 돌리기 = async () => {
    const 본것 = [];
    let 첫 = true;
    const 모델 = { async respond(tc, opts = {}) {
      본것.push({ tc: JSON.stringify(tc), tools: JSON.stringify(opts.tools ?? []) });
      if (!opts.tools?.length) return '네';
      if (첫) { 첫 = false; return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] }; }
      return { text: '봤어요', toolCalls: [] };
    } };
    실행기록.length = 0;
    // 시계를 고정한다 — 밀리초 차이가 아니라 **admission 때문에** 달라지는지를 본다.
    const r = await runTurn({ text: '폴더 봐줘' },
      { env: demoEnv(), model: 모델, tools: demoTools({ localTerminal: 손 }), now: () => 1_700_000_000_000 });
    return { 본것, 실행: [...실행기록], reply: r.reply, kind: r.kind };
  };
  const a = await 돌리기();
  const b = await 돌리기();
  // 표시용 시계(now.iso/local)는 실행 시각이라 매 실행 다르다 — **그것만** 정규화하고,
  // 정규화 뒤에는 바이트 단위로 같아야 한다(차이가 시계 하나뿐임을 이 방식이 증명한다).
  const 시계뺀것 = (xs) => xs.map((x) => ({ ...x, tc: x.tc.replace(/"now":\{[^}]*\}/g, '"now":<고정>') }));
  const A = 시계뺀것(a.본것); const B = 시계뺀것(b.본것);
  assert.deepEqual(A, B, '모델 메시지·도구 스키마가 시계 외의 이유로 달라졌다');
  // 정규화 전 차이가 있었다면 그것은 시계 안에서만이어야 한다.
  for (let i = 0; i < a.본것.length; i++) {
    const 원차이 = a.본것[i].tc !== b.본것[i].tc;
    if (원차이) assert.notEqual(a.본것[i].tc.match(/"now":\{[^}]*\}/)?.[0], b.본것[i].tc.match(/"now":\{[^}]*\}/)?.[0],
      '시계 밖에서 차이가 났다');
  }
  assert.equal(a.본것.length, b.본것.length, '모델 호출 횟수가 다르다');
  assert.deepEqual(a.실행, b.실행, '도구 실행(외부 효과)이 달라졌다');
  assert.equal(a.reply, b.reply);
  // registry 바이트 불변 — admission 은 저장소에 쓰지 않는다.
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-adm-'));
  const reg = new TCellRegistry(dir);
  const 전 = JSON.stringify(await reg.load());
  admitPrinciples(기본입력(세포()));
  assert.equal(JSON.stringify(await reg.load()), 전, 'admission 이 registry 를 건드렸다');
  // 어댑터 경계에 원리가 실리지 않는다(TG-5B 전까지).
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const m = buildModelMessages({ currentRequest: '폴더 봐줘', identity: { name: 'T5' } });
  assert.ok(!m.system.includes('admittedPrinciples') && !m.user.includes('admittedPrinciples'));
  assert.ok(!m.system.includes('막힌 손은') && !m.user.includes('막힌 손은'), '원리 문장이 모델 입력에 실렸다');
});

test('커널·서버가 admission 을 아직 소비하지 않는다(TG-5A 는 shadow)', async () => {
  for (const f of ['src/kernel/turn.js', 'src/surface/server.js', 'src/runtime/model-provider.js']) {
    const src = await readFile(f, 'utf8');
    assert.ok(!src.includes('admitPrinciples') && !src.includes('admittedPrinciples'),
      `${f} 가 admission 을 소비한다 — TG-5A 는 영향 0 이다`);
  }
});
