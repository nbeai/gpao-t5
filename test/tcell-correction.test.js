// S5-3 · 정정 상관 — **통계지 사실이 아니다.**
//
// §4.5: 사용자가 정정한 턴에서, 직전 관련 턴의 `shown ∩ cited` 항목에 표식을 남긴다.
// 그 표식은 "이 기억이 틀렸다"가 아니라 **"이 기억이 보였고 모델이 참고했다고 주장한 자리에서
// 사용자가 고쳤다"** 는 상관일 뿐이다. 그래서 한 번으로는 아무 일도 일어나지 않는다.
//
// 정정 여부는 **모델이 알려준다.** "아니야"·"틀렸어" 같은 낱말 규칙을 Runtime 에 두지 않는다 —
// 그건 의미 판단을 규칙으로 대체하는 것이고, 사용자가 웃으며 "아니 그거 말고 이것도"라고 할 때
// 바로 무너진다. 이 파일의 마지막 검사가 그 경계를 지킨다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  correlateCorrection, decayCandidates, CORRELATION_MIN,
} from '../src/kernel/l5-growth/tcell-correction.js';
import { splitModelControlCalls, MODEL_CONTROL_SCHEMAS } from '../src/kernel/l2-plan/model-control.js';

const 턴 = (seq, sessionId = 's-1') => ({ sessionId, turnSeq: seq });
const 보임기록 = (seq, { refs = [], cited = null, sessionId = 's-1' } = {}) => ({
  turnRef: 턴(seq, sessionId),
  refs,
  ...(cited ? { modelCitedRefs: cited } : {}),
  at: seq,
});
const 원리 = { ref: 'p-원리', kind: 'operating_principle', statement: '월별 수치는 표로 정리한다' };
const 선호 = { ref: 'pref-1', kind: 'preference', statement: '보고서는 짧은 목록으로 정리한다' };
// 범위 판정(2026-07-31): 상관의 근거는 **정정의 지목**이다. 인용(cite)은 확신을 높이는 보조다.
const 지목 = (t) => ({ target: t });

test('S5-3: 지목이 없으면 인용이 있어도 상관 0(무엇을 고치는지 모르면 표식하지 않는다)', () => {
  const memory = { shownRefs: [보임기록(2, { refs: [원리, 선호], cited: [원리] })] };
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4) }), []);
});

test('S5-3: 지목한 항목에만 상관이 하나 남는다', () => {
  const memory = { shownRefs: [보임기록(2, { refs: [원리, 선호], cited: [원리] })] };
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) });
  assert.equal(상관.length, 1);
  assert.equal(상관[0].ref, 'p-원리');
  assert.equal(상관[0].turns.length, 1, '독립 상관 1회');
  assert.equal(상관.some((x) => x.ref === 'pref-1'), false, '보이기만 한 것은 빠진다');
});

test('S5-3: 보인 적 없는 것을 지목하면 상관이 붙지 않는다', () => {
  const memory = { shownRefs: [보임기록(2, { refs: [선호], cited: [원리] })] };
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) });
  assert.deepEqual(상관, [], '보인 적 없는 것에는 상관을 남기지 않는다');
});

test('S5-3: 같은 턴에서 여러 번 정정해도 1회로 센다', () => {
  let memory = { shownRefs: [보임기록(2, { refs: [원리], cited: [원리] })] };
  memory = { ...memory, correctionCorrelation: correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }) };
  memory = { ...memory, correctionCorrelation: correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }) };
  assert.equal(memory.correctionCorrelation[0].turns.length, 1, '같은 정정 턴은 하나다');
});

test('S5-3: 상관 1회로는 감쇠 후보가 되지 않는다', () => {
  let memory = { shownRefs: [보임기록(2, { refs: [원리], cited: [원리] })] };
  memory = { ...memory, correctionCorrelation: correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }) };
  assert.deepEqual(decayCandidates(memory), [], `상관 ${CORRELATION_MIN} 회 전에는 후보 0`);
});

test('S5-3: 독립된 두 턴에서 정정되면 그때 감쇠 후보가 된다', () => {
  let memory = {
    shownRefs: [
      보임기록(2, { refs: [원리], cited: [원리] }),
      보임기록(6, { refs: [원리], cited: [원리] }),
    ],
  };
  memory = { ...memory, correctionCorrelation: correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }) };
  // 두 번째 정정은 그 사이에 다시 보이고 인용된 턴(6)을 가리킨다.
  memory = { ...memory, correctionCorrelation: correlateCorrection(memory, { turnRef: 턴(8), ...지목(원리.statement) }) };

  assert.equal(memory.correctionCorrelation[0].turns.length, 2, '독립 상관 2회');
  assert.deepEqual(decayCandidates(memory).map((x) => x.ref), ['p-원리']);
});

test('S5-3: 무관한 정정(직전에 보이고 인용된 것이 없음)은 상관 0', () => {
  const memory = { shownRefs: [보임기록(2, { refs: [], cited: null })] };
  assert.deepEqual(correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }), []);
  // 다른 대화의 기록은 이 대화의 정정과 묶이지 않는다.
  const 다른대화 = { shownRefs: [보임기록(2, { refs: [원리], cited: [원리], sessionId: 's-다른' })] };
  assert.deepEqual(correlateCorrection(다른대화, { turnRef: 턴(4, 's-1'), ...지목(원리.statement) }), []);
});

test('S5-3: 정정보다 나중 턴은 가리키지 않는다(직전 관련 턴만)', () => {
  const memory = {
    shownRefs: [
      보임기록(2, { refs: [원리], cited: [원리] }),
      보임기록(9, { refs: [선호], cited: [선호] }), // 정정 턴(4)보다 뒤
    ],
  };
  const 상관 = correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) });
  assert.deepEqual(상관.map((x) => x.ref), ['p-원리'], '앞선 턴만 가리킨다');
});

test('S5-3: 상관은 위험 신호로만 저장한다(적용 사실로 이름 붙이지 않는다)', () => {
  const memory = { shownRefs: [보임기록(2, { refs: [원리], cited: [원리] })] };
  const 저장 = JSON.stringify(correlateCorrection(memory, { turnRef: 턴(4), ...지목(원리.statement) }));
  for (const 금지 of ['applied', 'verified', 'wrong', 'invalid']) {
    assert.equal(저장.includes(금지), false, `${금지} 라는 이름을 쓰지 않는다`);
  }
});

// ── 정정 판정은 모델의 것 ──────────────────────────────────────────────────
test('S5-3: 정정은 통제 채널로만 온다 — Runtime 에 낱말 규칙이 없다', async () => {
  const 정정 = MODEL_CONTROL_SCHEMAS.find((s) => s.name === 'memory.correction');
  assert.ok(정정, '통제 채널로 선언돼 있다');
  const { memoryCorrection, rest } = splitModelControlCalls([
    { name: 'memory.correction', args: { reason: '앞 답이 사용자 뜻과 달랐다' } },
    { name: 'local.file', args: {} },
  ]);
  assert.ok(memoryCorrection, '모델이 부르면 받는다');
  assert.equal(rest.length, 1, '실행 후보만 남는다');

  // **낱말 규칙이 없다는 것을 소스로 확인한다.** 있으면 모델이 안 불러도 상관이 생긴다.
  // 주석은 걷어내고 **코드에만** 그 낱말이 있는지 본다(이 파일도 주석으로는 그 말을 쓴다).
  const { readFileSync } = await import('node:fs');
  const 주석뺀코드 = (원문) => 원문
    .split('\n')
    .map((줄) => 줄.replace(/\/\/.*$/, ''))
    .join('\n');
  for (const 파일 of [
    'src/kernel/turn.js', 'src/surface/server.js',
    'src/kernel/l5-growth/tcell-correction.js', 'src/kernel/l2-plan/model-control.js',
  ]) {
    const 코드 = 주석뺀코드(readFileSync(파일, 'utf8'));
    for (const 낱말 of ['아니야', '틀렸어', '그게 아니라', '잘못됐']) {
      assert.equal(코드.includes(낱말), false, `${파일} 코드에 '${낱말}' 낱말 판정이 있다`);
    }
  }
});

// ── 제품 경로 ──────────────────────────────────────────────────────────────
const { mkdtemp } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { MemoryStore } = await import('../src/surface/memory-store.js');
const { SessionStore } = await import('../src/surface/session-store.js');
const { EventLog } = await import('../src/surface/event-log.js');
const { makeServer } = await import('../src/surface/server.js');
const { demoTools } = await import('../src/surface/demo-context.js');

const 원리문장 = '월별 수치 정리를 요청하면 표로 정리한다';
const 요청 = '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4';

/** 대본: 턴마다 어떤 통제 호출을 낼지 정한다(cite · correction · 아무것도 안 함). */
async function 서버세우기(대본) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-corr-'));
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

  let n = 0;
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: {
      async respond(tc, opts = {}) {
        const calls = opts.tools?.length ? (대본[n] ?? []) : [];
        n += 1;
        return calls.length ? { text: '알겠어요.', toolCalls: calls } : '알겠어요.';
      },
    },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  return { mem, server, post };
}

const 인용 = [{ name: 'memory.cite', args: { used: [원리문장] } }];
const 정정 = [{ name: 'memory.correction', args: { target: 원리문장, reason: '앞 답이 사용자 뜻과 달랐다' } }];

test('S5-3/제품: 인용된 턴 뒤의 정정만 상관으로 남고, 감쇠는 일어나지 않는다', async () => {
  const { mem, server, post } = await 서버세우기([인용, 정정]);
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 요청 });
    await post('/turn', { sessionId: s.id, text: '그건 그렇게 말고 다르게 해줘' });

    const m = await mem.load();
    assert.equal(m.correctionCorrelation.length, 1);
    assert.equal(m.correctionCorrelation[0].ref, 'p-원리');
    assert.equal(m.correctionCorrelation[0].turns.length, 1, '독립 상관 1회');
    assert.equal(m.correctionCorrelation[0].turns[0].confidence, 'cited', '인용이 있으면 확신이 붙는다');
    assert.deepEqual(decayCandidates(m), [], '1회로는 감쇠 후보가 아니다');
    // 기억은 그대로다 — 아무 것도 내리지 않았다.
    assert.equal(m.promoted.length, 1);
    assert.equal(m.promoted[0].statement, 원리문장);
  } finally { server.close(); }
});

test('S5-3/제품: 인용이 없어도 지목이 맞으면 상관이 선다(cite 는 보조 근거다)', async () => {
  const { mem, server, post } = await 서버세우기([[], 정정]); // 첫 턴에 cite 없음
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 요청 });
    await post('/turn', { sessionId: s.id, text: '그건 그렇게 말고 다르게 해줘' });

    const m = await mem.load();
    assert.equal(m.correctionCorrelation.length, 1, '보인 것을 지목했으므로 상관이 선다');
    assert.equal(m.correctionCorrelation[0].turns[0].confidence, 'claimed', '인용이 없으면 주장 근거');
    assert.ok(m.shownRefs.length >= 1, 'shown 사실은 그대로 남는다');
  } finally { server.close(); }
});

test('S5-3/제품: 모델이 정정을 안 알리면 아무 일도 없다(낱말로 판정하지 않는다)', async () => {
  const { mem, server, post } = await 서버세우기([인용, []]);
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 요청 });
    // 사람 눈에는 명백한 정정어지만, 모델이 안 알렸으므로 상관은 생기지 않는다.
    // **이 턴에도 원리가 렌더된다**(같은 종류의 요청) — 그래야 "낱말로 판정하지 않는다"가
    // 실제로 시험된다. 렌더가 0인 턴으로 재면 바깥 가드에 걸려 아무 것도 증명하지 못한다.
    const 답 = await post('/turn', { sessionId: s.id, text: '11월도. 1700 / 1050 / 신규 15 / 이탈 6 아니야 틀렸어 그게 아니라 다시 해줘' });
    assert.ok(String(답.reply ?? '').length > 0);
    const 마지막shown = (await mem.load()).shownRefs.at(-1);
    assert.ok(마지막shown.refs.some((r) => r.ref === 'p-원리'), '이 턴에도 원리가 보였다');

    const m = await mem.load();
    assert.deepEqual(m.correctionCorrelation, [], '낱말은 판정 근거가 아니다');
  } finally { server.close(); }
});

test('S5-3/제품: 독립된 두 턴에서 정정되면 그때 감쇠 후보가 된다(그래도 내리지 않는다)', async () => {
  const { mem, server, post } = await 서버세우기([인용, 정정, 인용, 정정]);
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: 요청 });
    await post('/turn', { sessionId: s.id, text: '그건 그렇게 말고 다르게 해줘' });
    await post('/turn', { sessionId: s.id, text: '11월도. 1700 / 1050 / 신규 15 / 이탈 6' });
    await post('/turn', { sessionId: s.id, text: '이번에도 그렇게 말고' });

    const m = await mem.load();
    assert.equal(m.correctionCorrelation[0].turns.length, 2, '독립 상관 2회');
    assert.deepEqual(decayCandidates(m).map((x) => x.ref), ['p-원리']);
    assert.equal(m.promoted.length, 1, '후보가 됐을 뿐 아무 것도 안 내렸다');
  } finally { server.close(); }
});
