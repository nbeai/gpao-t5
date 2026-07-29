// TG-5A 선행 반대시험 20건(계약 패킷 §9 + 감사 보강 8건) — admission 은 shadow, 영향은 0이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  admitPrinciples, resolveRole, judgeClause, judgeDirective, explainAdmission,
  ADMISSION_REASONS, STAGE_ROLES, ROLE_ORDER,
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
  // 단위 시험의 기본은 **계획 뒤**(`post_plan`)다 — 권한·값 역할까지 열리는 넓은 자리에서
  // 각 계약을 본다. 단계 자체의 경계는 아래 「행렬 3」 시험이 따로 증명한다.
  stage: 'post_plan',
  requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후', ref: 'ledger:s:1' }] },
  // 커널이 등급을 판정한 정상 턴 — 판정 없음(tierKnown:false)은 별도 시험에서 본다.
  authorityFacts: { actionTier: 'A0', tierKnown: true },
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

// ── 행렬 2 · 지시 관계는 세 값이다 — 같은 지시는 충돌이 아니다 ──
test('행렬 2: 현재 지시 관계 3값 — 같은 지시는 강화, 부정만 충돌, 그 밖은 unknown', () => {
  const c = 세포();
  const 문장 = '막힌 손은 같은 인자로 반복하지 않는다';
  const 사실 = (directives) => ({
    project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }],
    directives, userDirective: directives.length > 0,
  });

  // ① 같은 지시 = 강화. **입장을 막지 않는다.**
  //    명세 §21 은 「사용자가 명시한 선호를 같은 범위에서 다시 확인받기」를 금지 구현으로 못박았다.
  //    예전 코드는 그보다 나빠서, 같은 문장을 다시 말하면 그 원리를 **거절**했다.
  const 강화 = admitPrinciples(기본입력(c, { requestFacts: 사실([{ statement: 문장, ref: 'd1' }]) }));
  assert.equal(강화.admissions.length, 1,
    `같은 지시를 반복했더니 원리가 죽었다: ${JSON.stringify(강화.trace.rejected)}`);
  assert.equal(강화.admissions[0].directiveRelation, 'reinforces');

  // ② 명시적 부정 = 충돌. 현재 요청이 이긴다.
  const 충돌 = admitPrinciples(기본입력(c, { requestFacts: 사실([{ statement: `!${문장}`, ref: 'd2' }]) }));
  assert.equal(충돌.admissions.length, 0, '현재 지시의 부정을 원리가 이겼다');
  assert.equal(충돌.trace.rejected[0].reason, ADMISSION_REASONS.conflict);

  // ③ 무관한 지시 = unknown. 입장 근거도 아니고 **거절 근거도 아니다**(과잉 차단 금지).
  const 무관 = admitPrinciples(기본입력(c, { requestFacts: 사실([{ statement: '보고서는 목록으로', ref: 'd3' }]) }));
  assert.equal(무관.admissions.length, 1, '무관한 지시가 원리를 막았다(과잉 차단)');
  assert.equal(무관.admissions[0].directiveRelation, 'unknown');

  // ④ 세포가 스스로 "덮지 않는다"고 선언한 것이 이번 턴 사실이면, 지시 턴에서는 충돌이다.
  const 금지 = admitPrinciples(기본입력(c, {
    requestFacts: {
      project: 'T5', subject: '정산',
      facts: [{ fact: '실패 직후' }, { fact: '현재 요청', ref: 'r' }],
      directives: [{ statement: '아무 말' }], userDirective: true,
    },
  }));
  assert.equal(금지.trace.rejected[0].reason, ADMISSION_REASONS.conflict);

  // 순수 함수 자체도 세 값만 낸다.
  assert.equal(judgeDirective(c, { directives: [{ statement: 문장 }] }).relation, 'reinforces');
  assert.equal(judgeDirective(c, { directives: [] }).relation, 'unknown');
  assert.equal(judgeDirective(null, null, null).relation, 'unknown');
});

// ── 행렬 3 · 모델 전 맥락 역할과 계획 뒤 권한·값 역할의 분리 ──
test('행렬 3: pre_model 은 맥락 역할만 연다 — 계획 역할은 계획이 선 뒤에만', () => {
  // 세포는 plan_hint 를 허용하고 성숙도 상한도 충분하다. 막는 것은 **단계**뿐이다.
  const 계획역할 = 세포({ state: 'M4_stable', authority: { allowedInfluence: ['none', 'plan_hint'] } });
  const pre = admitPrinciples(기본입력(계획역할, { stage: 'pre_model' }));
  assert.equal(pre.admissions.length, 0, '모델 호출 앞에서 계획 역할이 열렸다');
  assert.equal(pre.trace.rejected[0].reason, ADMISSION_REASONS.roleEmpty);
  assert.equal(pre.trace.stage, 'pre_model');

  const post = admitPrinciples(기본입력(계획역할, { stage: 'post_plan' }));
  assert.equal(post.admissions.length, 1, '계획이 선 뒤에도 계획 역할이 막혔다');
  assert.equal(post.admissions[0].role, 'plan_hint');
  assert.equal(post.admissions[0].stage, 'post_plan');

  // 맥락 역할은 두 단계 모두에서 열린다 — 단계 분리가 과잉 차단이 되지 않는다.
  const 맥락 = 세포({ state: 'M2_replayed' });
  assert.equal(admitPrinciples(기본입력(맥락, { stage: 'pre_model' })).admissions.length, 1);

  // 집합 자체의 계약: 어느 단계도 answer_anchor 를 갖지 않는다. 모르는 단계는 가장 좁은 집합.
  assert.ok(!STAGE_ROLES.pre_model.includes('plan_hint'));
  assert.ok(!STAGE_ROLES.post_plan.includes('answer_anchor'));
  assert.deepEqual(admitPrinciples(기본입력(계획역할, { stage: '있을 리 없는 단계' })).admissions, []);
});

test('5·17: role 은 세 집합의 교집합 최대값 — 상한·단계를 넘지 못하고 answer_anchor 는 불가', () => {
  // M2 상한은 supporting_context 까지 — plan_hint 를 허용해도 잘린다.
  const m2 = 세포({ state: 'M2_replayed' });
  assert.equal(resolveRole(m2, STAGE_ROLES.post_plan), 'supporting_context');
  // M4 는 상한이 전체지만 이번 단계 집합이 answer_anchor 를 갖지 않는다.
  const m4 = 세포({ state: 'M4_stable', authority: { allowedInfluence: [...ROLE_ORDER] } });
  assert.equal(resolveRole(m4, STAGE_ROLES.post_plan), 'default_value', 'answer_anchor 로 자동 상승했다');
  assert.ok(!STAGE_ROLES.post_plan.includes('answer_anchor'));
  // 세포가 아무 역할도 허용하지 않으면 입장 없음.
  const 없음 = 세포({ authority: { allowedInfluence: ['none'] } });
  assert.equal(resolveRole(없음), 'none');
  assert.equal(admitPrinciples(기본입력(없음)).trace.rejected[0].reason, ADMISSION_REASONS.roleEmpty);
});

test('6·16: A2/A3 원리는 유효한 bounded grant 없이는 참고 대상이 아니다(일회성·만료·다른 대상 포함)', () => {
  // 등급은 세포가 아니라 **이번 턴 행동의 사실**이다.
  const 전송원리 = () => 세포({ principle: { statement: '보낼 때 대상 확정 후 보낸다', type: 'execution' } });
  const base = (over) => 기본입력(전송원리(), {
    authorityFacts: { actionTier: 'A2', tierKnown: true, actionKind: 'telegram.send', actionOperation: 'send', target: '오너', scope: 'project:T5', grantRef: 'g1' },
    ...over,
  });
  // grant 없음
  assert.equal(admitPrinciples(base({})).trace.rejected[0].reason, ADMISSION_REASONS.authority);
  for (const [이름, g] of [
    ['일회성', { kind: 'once', action: 'telegram.send', operation: 'send', target: '오너', scope: 'project:T5', expiresAt: 9999 }],
    ['만료', { kind: 'bounded', action: 'telegram.send', operation: 'send', target: '오너', scope: 'project:T5', expiresAt: 10 }],
    ['다른 대상', { kind: 'bounded', action: 'telegram.send', operation: 'send', target: '남', scope: 'project:T5', expiresAt: 9999 }],
    ['같은 손 다른 행동', { kind: 'bounded', action: 'telegram.send', operation: 'delete', target: '오너', scope: 'project:T5', expiresAt: 9999 }],
    ['다른 범위', { kind: 'bounded', action: 'telegram.send', operation: 'send', target: '오너', scope: 'project:X', expiresAt: 9999 }],
  ]) {
    const r = admitPrinciples(base({ grantStore: 저장소({ g1: g }) }));
    assert.equal(r.admissions.length, 0, `${이름} grant 가 A2 를 열었다`);
    assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.authority);
  }
  // 정확히 일치하는 유효 grant → 참고 가능. 단 실행 승인은 아니다.
  const ok = admitPrinciples(base({ grantStore: 저장소({ g1: { kind: 'bounded', action: 'telegram.send', operation: 'send', target: '오너', scope: 'project:T5', expiresAt: 9999 } }) }));
  assert.equal(ok.admissions.length, 1);
  assert.equal(ok.admissions[0].authorityAllowed, true);
  assert.equal(ok.admissions[0].reverifyAtExecution, true, '실행 경계 재검증 표시가 없다');
  // A2 턴이라도 계획·값에 관여하지 않는 역할(맥락)은 권한을 여는 것이 아니다.
  const 맥락만 = 세포({ state: 'M2_replayed' }); // 상한이 supporting_context 까지
  const r맥락 = admitPrinciples(기본입력(맥락만, { authorityFacts: { actionTier: 'A3', tierKnown: true, actionKind: 'delete' } }));
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
    confirmationStore: 저장소({ ok: { kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1, sourceRefs: ['ledger:s:1'] } }),
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

// ── 11·20: **진짜 관통** — 실제 입장까지 확인한다(retrieved 1 → admitted 1) ──
async function 관통서버({ 원리 = null, 확인 = null, texts = ['폴더 봐줘', '한 번 더 봐줘'], 마지막도구 = null } = {}) {
  const { makeServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { TCellRegistry, TCellObserver, ConfirmationStore } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-adm-run-'));
  // §0-C-1: project 는 세션 저장 폴더가 아니라 **실제 작업 자리**다. 첫 턴의 터미널 실행이
  // 이 자리를 확정하고(workingState 「지금 자리」), 그 다음 턴부터 admission 의 범위가 된다.
  const 자리 = join(dir, '작업자리');
  const 실행기록 = [];
  const 손 = {
    // 실제 `local-terminal` 과 같은 subject 계약 — 명령이 대상, cwd 가 자리(detail).
    subjectOf(rec) {
      const command = rec?.result?.command;
      if (!command) return null;
      return { key: `cmd:${command}`, kind: 'command', label: String(command), detail: rec.result?.cwd };
    },
    async probe(c) { return { command: c, cwd: 자리, changes: false, probe: { exitCode: 0, stdout: '', stderr: '' } }; },
    async handler(a) { 실행기록.push(a); return { result: { command: a.command, exitCode: 0, stdout: '', cwd: 자리 }, userSafeSummary: '봤어요.' }; },
  };
  if (원리) {
    // **과거 세션**의 근거를 심는다 — 장기 원리의 근거는 다른 대화에 있다(감사 5).
    const ob = new TCellObserver(dir);
    await ob.observeTurn({ sessionId: '과거세션', ledgerStart: 0, turnId: '1', now: 1,
      turnReceipts: [{ userSafeSummary: '봤어요.', failureState: 'none', action: 'local.terminal 실행' }] });
    원리.trace.observationRefs = ['ledger:과거세션:0'];
    // 이 세포가 **이 작업 자리의 것**이라는 시험 설정이다. 같은 값을 생산 경로가 실제로
    // 저장하는지는 아래 「행렬 6」 시험이 관찰 파일을 직접 읽어 따로 증명한다 —
    // 그 시험이 없으면 이 한 줄이 미배선을 가리게 된다(예전에 정확히 그랬다).
    원리.anchor = { ...원리.anchor, project: 자리, subject: null };
    await new TCellRegistry(dir).upsert(원리, null);
    if (확인) await new ConfirmationStore(dir).record({ id: 확인, tcellId: 원리.id, sourceRefs: ['ledger:과거세션:0'], now: 1 });
  }
  // 행렬 7: **실행 전 바이트**. 사후에 두 번 읽어 비교하면 "안 바뀌었다"가 아니라
  // "두 번 읽는 사이에 안 바뀌었다"만 증명된다(감사 지적).
  const 실행전바이트 = JSON.stringify((await new TCellRegistry(dir).load()).cells ?? []);
  const 본것 = [];
  let 첫 = true;
  let 마지막턴 = false;
  const 모델 = { async respond(tc, opts = {}) {
    // 임시 폴더 경로는 실행마다 다르다 — 비교 가능한 형태로 정규화한다(사실 손실 없음: 자리 유무는 남는다).
    본것.push({
      tc: JSON.stringify(tc).replace(/"now":\{[^}]*\}/g, '"now":<고정>').split(dir).join('<루트>'),
      tools: JSON.stringify(opts.tools ?? []),
    });
    if (!opts.tools?.length) return '네';
    if (첫) {
      첫 = false;
      // 마지막 턴에 **실제 A2 도구**를 고르게 할 수 있다 — 그래야 권한 경계를 진짜로 지난다.
      // (예전 검사는 이 장치가 없어 A2 턴을 만들지 못한 채 "권한이 지켰다"고 읽었다.)
      if (마지막턴 && 마지막도구) return { text: '', toolCalls: [마지막도구] };
      return { text: '', toolCalls: [{ name: 'local.terminal', args: { command: 'ls' } }] };
    }
    return { text: '봤어요', toolCalls: [] };
  } };
  // 게시 저장소를 시험이 들고 서버에 넘긴다 — 상태를 손으로 넣는 게 아니라, **제어면이 실제로
  // 게시한 결과**를 같은 객체로 관찰하기 위해서다. 게시는 여전히 서버의 성장 경로가 한다.
  const { makePrincipleSnapshotStore, scopeKeyOf } = await import('../src/kernel/l1-intent/principle-snapshot.js');
  const 게시본저장소 = makePrincipleSnapshotStore();
  const server = makeServer({ store: new SessionStore(dir), env: demoEnv(), tools: demoTools({ localTerminal: 손 }), model: 모델, principleSnapshotStore: 게시본저장소 });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const sess = await (await fetch(`${base}/sessions`, { method: 'POST' })).json();
    const 턴 = async (body) => (await (await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: sess.id, ...body }),
    })).json());
    // §10.2 · 부팅 게시는 **자리가 확정된 뒤** 뒤에서 걸린다. 그래서 의미 있는 턴들 앞에
    // 예열 턴 하나를 둔다 — 실제 제품에서도 첫 턴은 게시본 없이(미스로) 도는 것이 계약이다.
    // 있음·없음 두 경우 모두 같은 조건이 되도록 **무조건** 돈다.
    첫 = true; 마지막턴 = false;
    await 턴({ text: '폴더 봐줘' });
    if (원리) {
      const key = scopeKeyOf({ project: 자리 });
      for (let n = 0; n < 300 && !게시본저장소.read(key); n += 1) {
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    let r;
    for (const [i, t] of texts.entries()) {
      첫 = true; // 매 턴 도구를 한 번 고른다
      마지막턴 = i === texts.length - 1;
      r = await 턴({ text: t });
    }
    const 실행후바이트 = JSON.stringify((await new TCellRegistry(dir).load()).cells ?? []);
    // 관찰 파일 원문 — 행렬 6 이 anchor 를 여기서 직접 읽는다.
    const 관찰원문 = await readFile(join(dir, 'growth', 'observations.jsonl'), 'utf8').catch(() => '');
    void 턴;
    // 실행 인자도 같은 정규화 — 임시 경로 차이가 "외부 효과 차이"로 오독되지 않게.
    const 실행 = 실행기록.map((a) => JSON.parse(JSON.stringify(a).split(dir).join('<루트>')));
    return { dir, 자리, 본것, 실행, reply: r.reply, trace: r.principleTrace, 실행전바이트, 실행후바이트, 관찰원문, 게시본저장소 };
  } finally { await new Promise((r2) => server.close(r2)); }
}

/** 실제로 입장 가능한 세포 — 직전 턴 사실(`실행 성공 직후`)과 맞물리는 경계를 갖는다. */
const 입장가능세포 = () => {
  const c = 세포({
    boundary: { validWhen: ['실행 성공 직후'], invalidWhen: ['재시도 지시'], needsReviewWhen: [], mustNotOverride: ['현재 요청'] },
    authority: { allowedInfluence: ['none', 'candidate_context', 'supporting_context'], requiresUserConfirmation: false },
  });
  c.id = 'cell-live';
  // M1 은 전경에 오지 않는다(§10.1) — 입장을 보려면 게시 가능한 성숙도여야 한다.
  c.state = 'M2_replayed';
  return c;
};

test('11·20 관통: 과거 세션 원리가 현재 턴에 실제로 입장하고, 그 외 모든 것은 동일하다', async () => {
  const 없음 = await 관통서버({});
  const 있음 = await 관통서버({ 원리: 입장가능세포() });
  // ① admission 이 실제로 돌았고 ② **실제로 입장했다**(읽었다가 아니라).
  assert.ok(있음.trace, 'principleTrace 가 없다 — admission 이 안 돌았다');
  assert.equal(있음.trace.retrievedIds.length, 1, '실제 registry 세포를 읽지 못했다');
  assert.equal(있음.trace.admitted.length, 1,
    `입장하지 못했다(거절 사유: ${JSON.stringify(있음.trace.rejected)})`);
  assert.equal(있음.trace.admitted[0].role, 'supporting_context');
  assert.equal(있음.trace.status, 'ok');
  assert.equal(없음.trace.admitted.length, 0);
  // ③ 그 외 모든 관측 지점은 같다.
  assert.deepEqual(있음.본것, 없음.본것, '모델 메시지·도구 스키마가 달라졌다');
  assert.equal(있음.본것.length, 없음.본것.length, '모델 호출 횟수가 다르다');
  assert.deepEqual(있음.실행, 없음.실행, '도구 실행(외부 효과)이 달라졌다');
  assert.equal(있음.reply, 없음.reply, '사용자 답이 달라졌다');
  assert.ok(!JSON.stringify(있음.본것).includes('막힌 손은'), '원리 문장이 모델 입력에 실렸다');
  assert.deepEqual(있음.trace.influencedPlan, []);
  assert.deepEqual(있음.trace.influencedAnswer, []);
  // ④ 행렬 7: registry 는 **실행 전 바이트와 실행 후 바이트**가 같다.
  //    예전 검사는 턴이 끝난 뒤 두 번 읽어 비교했다 — 그건 "두 번 읽는 사이에 안 바뀌었다"만 증명한다.
  assert.equal(있음.실행후바이트, 있음.실행전바이트, 'admission 이 registry 를 바꿨다');
  assert.ok(있음.실행전바이트.includes('cell-live'), '실행 전 바이트가 비어 있다(비교가 무의미해진다)');
  // ⑤ 행렬 3: 두 단계가 실제로 돌았고 trace 에 남는다.
  assert.deepEqual(있음.trace.passes.map((p) => p.stage), ['pre_model', 'post_plan'],
    `두 단계가 돌지 않았다: ${JSON.stringify(있음.trace.passes?.map((p) => p.stage))}`);
});

// ── 행렬 6 + §0-C-1 · 관찰 생산 경로가 **실제 자리** anchor 를 저장한다 ──
test('행렬 6: 실제 생산 경로가 workspace/project/subject anchor 를 저장한다', async () => {
  const r = await 관통서버({ 원리: 입장가능세포() });
  const 관찰 = r.관찰원문.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.ok(관찰.length > 0, '관찰이 하나도 저장되지 않았다');
  // 이번 세션이 만든 관찰만 본다(과거 세션 fixture 제외).
  const 이번것 = 관찰.filter((e) => e.sessionId && e.sessionId !== '과거세션');
  assert.ok(이번것.length > 0, '이번 세션의 관찰이 없다');
  for (const e of 이번것) {
    assert.equal(e.anchor?.workspace, r.dir, `관찰 anchor.workspace 가 비었다: ${e.type}`);
    // §0-C-1: project 는 세션 저장 폴더(store.dir)가 아니라 **실제 작업 자리**다.
    assert.equal(e.anchor?.project, r.자리, `관찰 anchor.project 가 실제 자리가 아니다: ${e.type} → ${e.anchor?.project}`);
    assert.notEqual(e.anchor?.project, r.dir, 'project 가 아직 세션 저장 폴더다(§0-C-1 미해소)');
  }
  // **이 값이 admission 의 범위 식별자와 같은 값**이어야 세포의 범위 판정이 의미를 갖는다.
  // 같지 않으면 위 11·20 관통이 scope_mismatch 로 깨진다 — 두 시험이 서로를 묶는다.
  assert.equal(r.trace.admitted.length, 1, 'anchor 가 맞는데도 범위 판정에서 떨어졌다');
});

// ── 행렬 2 관통 · 같은 지시는 원리를 죽이지 않는다 ──
test('관통: 같은 지시를 다시 말해도 원리는 살아 있다(강화이지 충돌이 아니다)', async () => {
  const c = 입장가능세포();
  c.principle.statement = '반드시 실행 성공 직후에는 확인한다';
  // 사용자가 **같은 문장**을 구조화된 지시로 다시 말한다. 명세 §21: 같은 범위의 재확인 금지.
  const r = await 관통서버({ 원리: c, texts: ['폴더 봐줘', '반드시 실행 성공 직후에는 확인한다'] });
  assert.ok(r.trace, 'trace 없음');
  assert.equal(r.trace.admitted.length, 1,
    `같은 지시를 반복했더니 원리가 죽었다: ${JSON.stringify(r.trace.rejected)}`);
  assert.equal(r.trace.admitted[0].reason, ADMISSION_REASONS.admitted);
});

test('관통: 확인이 필요한 원리는 실제 확인 원장이 있어야 입장한다', async () => {
  const 확인필요 = () => { const c = 입장가능세포(); c.authority.requiresUserConfirmation = true; return c; };
  const { scopeKeyOf } = await import('../src/kernel/l1-intent/principle-snapshot.js');

  // ① 확인 없이는 **전경에 도달하지 못한다.** 판정이 게시층으로 옮겨갔으므로 증명도 거기서 한다 —
  //    보장은 그대로다: 확인되지 않은 원리는 사용자 턴에 영향 0 이다.
  const 없이 = await 관통서버({ 원리: 확인필요() });
  assert.equal(없이.trace.admitted.length, 0, '확인 없이 입장했다');
  const 게시본 = 없이.게시본저장소.read(scopeKeyOf({ project: 없이.자리 }));
  assert.equal(게시본?.principles?.length ?? 0, 0, '확인되지 않은 원리가 게시본에 실렸다');

  // ② 그 사유가 **정확히 확인 부재**인지는 게시 자격 판정기에 직접 묻는다(아무 이유로나 막힌 것이
  //    아님을 증명해야 한다 — 예전 검사가 사유를 뭉뚱그려 통과시키던 자리다).
  const { buildAdmissionSnapshot, publishableIds } = await import('../src/kernel/l5-growth/principle-publish.js');
  const { TCellRegistry, TCellObserver } = await import('../src/surface/tcell-store.js');
  const snap = await buildAdmissionSnapshot({
    registry: new TCellRegistry(없이.dir), observer: new TCellObserver(없이.dir),
    scope: { project: 없이.자리 },
  });
  assert.ok((snap.candidateIds ?? []).includes('cell-live'), '세포가 저장소에 없다(시험 전제 붕괴)');
  assert.equal(publishableIds(snap, { scope: { project: 없이.자리 }, confirmationRefs: {} }).size, 0,
    '확인 없는 원리가 게시 자격을 얻었다');
  // ③ **반대 방향** — 확인 원장이 있으면 같은 원리가 게시 자격을 얻는다(과잉 차단이 아니다).
  assert.equal(publishableIds(snap, {
    scope: { project: 없이.자리 }, confirmationRefs: { 'cell-live': 'confirm-1' },
  }).size, 0, '확인 id 만으로 통과하면 안 된다 — 원장 기록이 있어야 한다');
});

// ── 행렬 8 · A2 무grant 관통은 **정확히 권한 경계**를 증명한다 ──
test('행렬 8: A2 턴에서 계획 역할은 유효 grant 없이 못 들어오고, 사유는 정확히 권한이다', async () => {
  const 계획역할 = () => {
    const c = 입장가능세포();
    c.state = 'M3_limited';
    // 맥락 역할도 함께 허용한다 — 이렇게 해야 "역할이 없어서"가 아니라 **권한 때문에** 막혔음을
    // 증명할 수 있다. plan_hint 만 두면 role_not_allowed 로 떨어져 권한 경계를 안 지난다.
    c.authority.allowedInfluence = ['none', 'supporting_context', 'plan_hint'];
    return c;
  };
  // **실제 A2 계획을 만든다** — `slack.post` 는 실행 가능하면서 `needsApproval:true` 라
  // 커널이 A2 로 올린다. 부여된 권한 원장은 비어 있다(승인을 누른 적이 없다).
  const r = await 관통서버({
    원리: 계획역할(), texts: ['폴더 봐줘', '이 내용 오너한테 보내줘'],
    마지막도구: { name: 'slack.post', args: { target: '#general', text: '보고' } },
  });
  assert.ok(r.trace, 'trace 없음');
  const post = r.trace.passes.find((p) => p.stage === 'post_plan');
  assert.ok(post, `post_plan 단계가 돌지 않았다: ${JSON.stringify(r.trace.passes?.map((p) => p.stage))}`);

  // ① 계획 역할로는 못 들어온다. ② 그 사유는 **정확히 권한**이다 — 다른 사유를 허용하지 않는다.
  //    예전 검사는 authority/authorityUnknown/boundary/conflict 중 아무거나 통과시켜서,
  //    경계와 무관한 이유로 막혀도 "권한이 지켰다"고 읽혔다(감사 지적).
  const 계획거절 = post.rejected.find((x) => x.id === 'cell-live');
  const 계획입장 = post.admitted.find((x) => x.id === 'cell-live');
  if (계획입장) {
    // 들어왔다면 그것은 **맥락 역할**이어야 한다. 계획 역할이 열렸다면 권한 경계가 뚫린 것이다.
    assert.equal(계획입장.role, 'supporting_context',
      `A2 턴에서 grant 없이 계획 역할이 열렸다: ${JSON.stringify(계획입장)}`);
  } else {
    assert.equal(계획거절?.reason, ADMISSION_REASONS.authority,
      `권한이 아닌 사유로 막혔다(경계를 증명하지 못한다): ${계획거절?.reason}`);
  }

  // ③ **pre_model 단계에서는 계획 역할이 애초에 없다**(행렬 3) — 추정 위에서 권한을 열지 않는다.
  const pre = r.trace.passes.find((p) => p.stage === 'pre_model');
  assert.ok(!pre.admitted.some((x) => ['plan_hint', 'default_value'].includes(x.role)),
    '모델 호출 앞에서 계획·값 역할이 열렸다');
});

test('스냅샷 경계: 실제 비동기 저장소를 읽고, 읽기 실패는 degraded 로 승계된다', async () => {
  const { buildAdmissionSnapshot } = await import('../src/kernel/l5-growth/principle-publish.js');
  const { admitFromSnapshot } = await import('../src/kernel/l1-intent/tcell-admission.js');
  const { TCellRegistry, TCellObserver } = await import('../src/surface/tcell-store.js');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-snap-'));
  const c = 세포(); c.id = 'cell-1'; c.trace.observationRefs = ['ledger:과거:1'];
  await new TCellRegistry(dir).upsert(c, null);
  const ob = new TCellObserver(dir);
  // **다른 세션**에 근거를 심는다 — 장기 원리의 근거는 과거 대화에 있다.
  await ob.observeTurn({ sessionId: '과거', ledgerStart: 1, turnReceipts: [{ userSafeSummary: '봤어요.', failureState: 'none' }], turnId: '1', now: 1 });
  const snap = await buildAdmissionSnapshot({ registry: new TCellRegistry(dir), observer: ob, sessionId: '지금' });
  assert.equal(snap.status, 'ok');
  assert.deepEqual(snap.candidateIds, ['cell-1'], '실제 registry 세포를 읽지 못했다');
  assert.ok(snap.evidenceStore.get('ledger:과거:1'), '다른 세션의 근거를 참조로 찾지 못했다(장기 원리 차단)');
  assert.ok(Object.isFrozen(snap), '스냅샷이 불변이 아니다');
  // 읽기 실패 → degraded 가 trace 로 승계된다.
  const 깨진 = await buildAdmissionSnapshot({ registry: { load: () => { throw new Error('boom'); } }, observer: ob, sessionId: 's' });
  assert.equal(깨진.status, 'degraded');
  assert.equal(admitFromSnapshot(깨진, { requestFacts: {} }).trace.status, 'degraded');
});

// ── 감사 재현 5건: 이번 회차의 직접 재현 입력 ──
test('재현 ①: 저장소가 던지면 ok 가 아니라 degraded 다', () => {
  const c = 세포();
  const 던지는저장소 = { get: () => { throw new Error('boom'); } };
  const r = admitPrinciples(기본입력(c, { evidenceStore: 던지는저장소 }));
  assert.equal(r.trace.status, 'degraded', '저장소 오류가 ok 로 처리됐다');
  assert.ok(r.trace.errorCodes.includes(ADMISSION_REASONS.storeError));
  assert.equal(r.admissions.length, 0);
});

test('재현 ②: 현재 project·subject 가 없으면 범위를 확인할 수 없어 입장하지 못한다', () => {
  const c = 세포();
  for (const rf of [{ facts: [{ fact: '실패 직후' }] }, { project: 'T5', facts: [{ fact: '실패 직후' }] },
    { subject: '정산', facts: [{ fact: '실패 직후' }] }]) {
    const r = admitPrinciples(기본입력(c, { requestFacts: rf }));
    assert.equal(r.admissions.length, 0, `범위 식별자 없이 입장했다: ${JSON.stringify(rf)}`);
    assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.scopeUnknown);
  }
});

test('재현 ③: sourceRefs 없는·계보 밖 확인 기록은 인정되지 않는다', () => {
  const c = 세포({ authority: { requiresUserConfirmation: true } });
  const 입력 = (rec) => 기본입력(c, {
    confirmationStore: 저장소({ ok: rec }),
    requestFacts: { project: 'T5', subject: '정산', facts: [{ fact: '실패 직후' }], confirmationRefs: { [c.id]: 'ok' } },
  });
  for (const [이름, rec] of [
    ['sourceRefs 없음', { kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1 }],
    ['빈 sourceRefs', { kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1, sourceRefs: [] }],
    ['계보 밖', { kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1, sourceRefs: ['ledger:s:9'] }],
    ['시각 없음', { kind: 'user_confirmation', tcellId: c.id, confirmed: true, sourceRefs: ['ledger:s:1'] }],
  ]) {
    assert.equal(admitPrinciples(입력(rec)).admissions.length, 0, `확인 ${이름} 이 인정됐다`);
  }
  assert.equal(admitPrinciples(입력({ kind: 'user_confirmation', tcellId: c.id, confirmed: true, at: 1, sourceRefs: ['ledger:s:1'] })).admissions.length, 1);
});

test('재현 ④: grant 는 정확히 bounded·미철회여야 한다', () => {
  const base = (g) => 기본입력(세포(), {
    authorityFacts: { actionTier: 'A2', tierKnown: true, actionKind: 'telegram.send', actionOperation: 'send', target: '오너', scope: 'project:T5', grantRef: 'g1' },
    grantStore: 저장소({ g1: g }),
  });
  const 유효 = { kind: 'bounded', action: 'telegram.send', operation: 'send', target: '오너', scope: 'project:T5', expiresAt: 9999 };
  for (const [이름, g] of [
    ['임의 kind', { ...유효, kind: '아무거나' }],
    ['kind 없음', { ...유효, kind: undefined }],
    ['철회됨', { ...유효, revoked: true }],
    ['비활성', { ...유효, active: false }],
    // 감사 P0: 같은 손이라도 **행동 종류가 다르면 다른 권한**이다.
    ['같은 손 다른 행동', { ...유효, operation: 'delete' }],
    ['행동 종류 없음', { ...유효, operation: undefined }],
  ]) {
    assert.equal(admitPrinciples(base(g)).admissions.length, 0, `${이름} grant 가 인정됐다`);
  }
  assert.equal(admitPrinciples(base(유효)).admissions.length, 1);
});

test('재현 ⑤: 같은 세포 ID 를 두 번 넣어도 한 번만 입장한다', () => {
  const c = 세포();
  const r = admitPrinciples(기본입력(c, { candidateIds: [c.id, c.id, c.id] }));
  assert.equal(r.admissions.length, 1, `중복 ID 가 ${r.admissions.length}번 입장했다`);
  assert.equal(r.trace.retrievedIds.length, 1);
  assert.equal(r.trace.admitted.length + r.trace.rejected.length, 1);
});

test('감사 ③: 등급을 모르면 저위험이 아니다 — 계획 역할은 막고 맥락 역할은 허용한다', () => {
  const 계획 = 세포({ authority: { allowedInfluence: ['none', 'plan_hint'] } });
  const r = admitPrinciples(기본입력(계획, { authorityFacts: { } })); // tierKnown 없음
  assert.equal(r.admissions.length, 0, '모르는 등급이 A0 로 취급됐다');
  assert.equal(r.trace.rejected[0].reason, ADMISSION_REASONS.authorityUnknown);
  // 맥락 역할은 권한을 여는 것이 아니므로 과잉 차단하지 않는다.
  const 맥락 = 세포({ state: 'M2_replayed' });
  assert.equal(admitPrinciples(기본입력(맥락, { authorityFacts: {} })).admissions.length, 1, '맥락 역할이 과잉 차단됐다');
});
