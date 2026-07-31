// S5-3 보정 · 정정이 **무엇을** 고치는지 지목하고, OS 가 직전 턴 shown 과 대조한다.
//
// 범위 판정(2026-07-31): cite 는 실측 호출률이 낮아(지정 시나리오 0/3) 감쇠의 필수 근거로
// 삼을 수 없다. 그래서 상관의 근거를 **correction 의 지목**으로 옮긴다 — cite 는 있으면
// 확신을 높이는 보조 근거일 뿐이다.
//
// 두 가지를 여기서 지킨다:
//   ① 지목할 목록이 없으면 모델은 지어낼 수밖에 없다 — 직전 턴 shown 문장을 사실로 공급한다.
//   ② confidence 가 문턱을 낮추면 cite 가 뒷문으로 감쇠 조건이 된다 — **문턱은 독립 2회 고정**.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correlateCorrection, decayCandidates, CORRELATION_MIN,
} from '../src/kernel/l5-growth/tcell-correction.js';
import { MODEL_CONTROL_SCHEMAS, splitModelControlCalls } from '../src/kernel/l2-plan/model-control.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';

const 원리문장 = '월별 수치는 표로 정리한다';
const 선호문장 = '보고서는 짧은 목록으로 정리한다';
const 턴 = (seq, sessionId = 's-1') => ({ sessionId, turnSeq: seq });
const 기록 = (seq, { shown = [], cited = null, sessionId = 's-1' } = {}) => ({
  turnRef: 턴(seq, sessionId), refs: shown, ...(cited ? { modelCitedRefs: cited } : {}), at: seq,
});
const 원리 = { ref: 'p-원리', kind: 'operating_principle', statement: 원리문장 };
const 선호 = { ref: 'pref-1', kind: 'preference', statement: 선호문장 };

// ── ① 지목 → 대조 ─────────────────────────────────────────────────────────
test('S5-3: cite 가 없어도 지목이 shown 과 맞으면 상관이 선다', () => {
  const memory = { shownRefs: [기록(2, { shown: [원리, 선호] })] }; // cited 없음
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), target: 원리문장 });
  assert.equal(상관.length, 1);
  assert.equal(상관[0].ref, 'p-원리');
  assert.equal(상관[0].turns[0].confidence, 'claimed', 'cite 없으면 주장 근거');
});

test('S5-3: cite 가 있으면 같은 상관의 확신만 올라간다(문턱은 그대로)', () => {
  const memory = { shownRefs: [기록(2, { shown: [원리, 선호], cited: [원리] })] };
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), target: 원리문장 });
  assert.equal(상관[0].turns[0].confidence, 'cited', '보조 근거가 붙는다');
  assert.deepEqual(decayCandidates({ correctionCorrelation: 상관 }), [],
    `확신이 높아도 상관 1회로는 후보가 아니다(문턱 ${CORRELATION_MIN})`);
});

test('S5-3: 지목한 것에만 상관이 선다(나머지 shown 은 건드리지 않는다)', () => {
  const memory = { shownRefs: [기록(2, { shown: [원리, 선호] })] };
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), target: 선호문장 });
  assert.deepEqual(상관.map((x) => x.ref), ['pref-1']);
});

test('S5-3: 보이지 않은 것·허공·다른 대화 지목은 거부한다', () => {
  const memory = { shownRefs: [기록(2, { shown: [원리] })] };
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4), target: 선호문장 }), [], '안 보인 것');
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4), target: '그런 기억 없다' }), [], '허공');
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4), target: '' }), [], '빈 지목');
  const 다른 = { shownRefs: [기록(2, { shown: [원리], sessionId: 's-다른' })] };
  assert.deepEqual(correlateCorrection(다른, { turnRef: 턴(4, 's-1'), target: 원리문장 }), [], '다른 대화');
});

test('S5-3: 지목이 없으면 상관도 없다(무엇을 고치는지 모르면 아무 데도 표식하지 않는다)', () => {
  const memory = { shownRefs: [기록(2, { shown: [원리], cited: [원리] })] };
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4) }), []);
});

test('S5-3: 같은 턴에서 같은 것을 여러 번 지목해도 1회다', () => {
  let m = { shownRefs: [기록(2, { shown: [원리] })] };
  m = { ...m, correctionCorrelation: correlateCorrection(m, { turnRef: 턴(4), target: 원리문장 }) };
  m = { ...m, correctionCorrelation: correlateCorrection(m, { turnRef: 턴(4), target: 원리문장 }) };
  assert.equal(m.correctionCorrelation[0].turns.length, 1);
});

test('S5-3: 독립 2회에서만 후보가 된다 — 확신 종류와 무관하다', () => {
  let m = {
    shownRefs: [
      기록(2, { shown: [원리], cited: [원리] }), // cited
      기록(6, { shown: [원리] }),                // claimed
    ],
  };
  m = { ...m, correctionCorrelation: correlateCorrection(m, { turnRef: 턴(4), target: 원리문장 }) };
  assert.deepEqual(decayCandidates(m), [], '1회는 후보 아님');
  m = { ...m, correctionCorrelation: correlateCorrection(m, { turnRef: 턴(8), target: 원리문장 }) };
  const 후보 = decayCandidates(m);
  assert.deepEqual(후보.map((x) => x.ref), ['p-원리']);
  assert.equal(후보[0].correlations, 2);
  assert.deepEqual(후보[0].confidence, ['cited', 'claimed'], '근거 종류는 남기되 문턱은 안 바꾼다');
});

// ── ② 지목할 목록을 공급한다 ──────────────────────────────────────────────
const tc = (over = {}) => ({
  currentRequest: '아니 그거 말고', selfStateFacts: {}, admittedContext: [],
  authorityFacts: {}, answerMode: 'complex_work', naturalness: 'method_and_language_open', ...over,
});

test('S5-3: 직전 답이 놓고 쓴 기억 문장을 이번 턴에 사실로 준다', () => {
  const m = buildModelMessages(tc({ priorShown: [원리문장, 선호문장] }));
  assert.match(m.user, /직전 답/);
  assert.ok(m.user.includes(원리문장), '지목할 대상을 실제로 보여준다');
  assert.match(m.user, /memory\.correction/);
});

test('S5-3: 직전 턴에 보인 것이 없으면 그 안내도 없다', () => {
  assert.equal(/memory\.correction/.test(buildModelMessages(tc({})).user), false);
  assert.equal(/memory\.correction/.test(buildModelMessages(tc({ priorShown: [] })).user), false);
});

test('S5-3: 지목 인자를 통제 채널이 받는다', () => {
  const s = MODEL_CONTROL_SCHEMAS.find((x) => x.name === 'memory.correction');
  assert.ok(s.parameters.properties.target, '무엇을 고치는지 받는다');
  const { memoryCorrection } = splitModelControlCalls([
    { name: 'memory.correction', args: { target: 원리문장, reason: '표가 아니라 요약을 원했다' } },
  ]);
  assert.equal(memoryCorrection.target, 원리문장);
});

test('S5-3: 내부 ID 는 여전히 나가지 않는다', () => {
  const m = buildModelMessages(tc({ priorShown: [원리문장] }));
  assert.equal(m.user.includes('p-원리'), false);
});

// ── 제품 경로: 목록이 실제로 공급되는가 ───────────────────────────────────
test('S5-3/제품: 다음 턴 모델 입력에 직전 답이 놓고 쓴 문장이 실제로 온다', async () => {
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { MemoryStore } = await import('../src/surface/memory-store.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { EventLog } = await import('../src/surface/event-log.js');
  const { makeServer } = await import('../src/surface/server.js');
  const { demoTools } = await import('../src/surface/demo-context.js');

  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-target-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [{
    candidateId: 'p-원리', kind: 'operating_principle', statement: 원리문장,
    principleId: 'p-원리', principleVersion: 2,
    admitted: true, userConfirmed: true, replayPassed: true,
    scopeSignals: {
      appliesWhen: [
        '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.',
        '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
        '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
      ],
      notWhen: [],
    },
  }];
  await mem.save(m);

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '표로 정리했어요.'; } },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());

  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });
    assert.deepEqual(받은것.at(-1).priorShown ?? [], [], '첫 턴에는 직전이 없다');

    await post('/turn', { sessionId: s.id, text: '아니 그거 말고 한 문장으로만' });
    // **저장된 shown 기록에서 문장이 실제로 실려 와야** 모델이 지목할 수 있다.
    assert.deepEqual(받은것.at(-1).priorShown, [원리문장], '직전 턴에 보인 문장이 온다');
  } finally { server.close(); }
});
