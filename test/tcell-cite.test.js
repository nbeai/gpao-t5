// S5-2 · `memory.cite` — 모델이 **썼다고 주장한** 것을 기록하되, 그것을 사용 사실로 부르지 않는다.
//
// §4.5·불변식 9: 모델 내부에서 무엇이 실제로 쓰였는지는 **관측 불가**다. 그래서 이 채널이
// 남기는 것은 사실이 아니라 **주장**이고, 이름도 그렇게 붙인다(`modelCitedRefs`).
// `applied`·`used`·`verified` 같은 이름을 저장 쪽에 쓰지 않는다 — 이름이 사실보다 앞서면
// 다음 슬라이스의 감쇠가 거짓 위에 선다.
//
// 그리고 **모델에게 내부 ID 를 주지 않는다.** 모델은 자기가 본 문장으로 지목하고, OS 가 그
// 턴의 shown 기록에 대조해 신분으로 바꾼다. 그래서 `usedRefs ⊆ shownMemoryRefs` 가
// 검사로 지켜지는 게 아니라 **구조로** 지켜진다 — 대조에 실패한 것은 애초에 신분을 못 얻는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { citedFromShown } from '../src/kernel/l5-growth/tcell-shown.js';
import { splitModelControlCalls, MODEL_CONTROL_SCHEMAS } from '../src/kernel/l2-plan/model-control.js';

const 후보들 = [
  { ref: 'p-원리', kind: 'operating_principle', statement: '월별 수치는 표로 정리한다' },
  { ref: 'pref-1', kind: 'preference', statement: '보고서는 짧은 목록으로 정리한다' },
  { ref: 'lane-1', kind: 'lane', statement: '지난 정리 — 정리한 답이 남아 있음' },
];
const 렌더된 = ['월별 수치는 표로 정리한다', '지난 정리 — 정리한 답이 남아 있음'];

test('S5-2: 본 것을 지목하면 신분으로 기록된다', () => {
  const r = citedFromShown({ 렌더된, 후보들, used: ['월별 수치는 표로 정리한다'] });
  assert.deepEqual(r.refs, [{ ref: 'p-원리', kind: 'operating_principle' }]);
  assert.equal(r.rejected.length, 0);
});

test('S5-2: 보여주지 않은 것을 지목하면 거부한다(이번 턴에 렌더되지 않았다)', () => {
  // `pref-1` 은 승격돼 있지만 **이번 턴에는 렌더되지 않았다.** 주장만으로 신분을 얻지 못한다.
  const r = citedFromShown({ 렌더된, 후보들, used: ['보고서는 짧은 목록으로 정리한다'] });
  assert.deepEqual(r.refs, []);
  assert.equal(r.rejected.length, 1);
});

test('S5-2: 허공 인용은 거부한다', () => {
  const r = citedFromShown({ 렌더된, 후보들, used: ['그런 기억은 없다', ''] });
  assert.deepEqual(r.refs, []);
  assert.equal(r.rejected.length, 1, '빈 문자열은 인용으로 세지 않는다');
});

test('S5-2: 후보·관찰은 렌더되지 않으므로 인용해도 신분을 얻지 못한다', () => {
  const r = citedFromShown({
    렌더된, 후보들,
    used: ['월별 수치는 무조건 표로만 낸다', '숫자를 좋아한다'],
  });
  assert.deepEqual(r.refs, []);
  assert.equal(r.rejected.length, 2);
});

test('S5-2: 렌더된 것 여럿을 지목하면 그만큼 남고, 중복은 하나로 센다', () => {
  const r = citedFromShown({
    렌더된, 후보들,
    used: ['월별 수치는 표로 정리한다', '지난 정리 — 정리한 답이 남아 있음', '월별 수치는 표로 정리한다'],
  });
  assert.deepEqual(r.refs.map((x) => x.ref), ['p-원리', 'lane-1']);
});

test('S5-2: 인용이 없으면 아무 것도 남기지 않는다(빈 기록을 만들지 않는다)', () => {
  assert.deepEqual(citedFromShown({ 렌더된, 후보들, used: [] }).refs, []);
  assert.deepEqual(citedFromShown({ 렌더된, 후보들 }).refs, []);
});

// ── 통제 채널 ──────────────────────────────────────────────────────────────
test('S5-2: memory.cite 는 통제 채널이지 실행 손이 아니다', () => {
  const cite = MODEL_CONTROL_SCHEMAS.find((s) => s.name === 'memory.cite');
  assert.ok(cite, '통제 채널로 선언돼 있다');
  const { memoryCitation, rest } = splitModelControlCalls([
    { name: 'memory.cite', args: { used: ['월별 수치는 표로 정리한다'] } },
    { name: 'local.file', args: { action: 'write' } },
  ]);
  assert.deepEqual(memoryCitation.used, ['월별 수치는 표로 정리한다']);
  assert.equal(rest.length, 1, '실행 후보만 남는다');
  assert.equal(rest[0].name, 'local.file');
});

test('S5-2: cite 를 안 불러도 분리는 정상이다', () => {
  const r = splitModelControlCalls([{ name: 'local.file', args: {} }]);
  assert.equal(r.memoryCitation, null);
  assert.equal(r.rest.length, 1);
});

test('S5-2: 저장 이름이 사실을 앞지르지 않는다(applied·used·verified 금지)', () => {
  const r = citedFromShown({ 렌더된, 후보들, used: ['월별 수치는 표로 정리한다'] });
  const 키 = JSON.stringify(r);
  for (const 금지 of ['applied', 'verified', 'usedRefs']) {
    assert.equal(키.includes(금지), false, `${금지} 라는 이름을 쓰지 않는다`);
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

/** 모델이 `memory.cite` 를 부르게 하는 대역(손 목록이 있어야 통제 채널이 붙는다). */
async function 서버세우기(인용할것) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-cite-'));
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
    model: {
      async respond(tc, opts = {}) {
        받은것.push(tc);
        if (인용할것 && opts.tools?.length) {
          return { text: '정리했어요.', toolCalls: [{ name: 'memory.cite', args: { used: 인용할것 } }] };
        }
        return '정리했어요.';
      },
    },
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  return { mem, server, post, 받은것 };
}

test('S5-2/제품: 보인 것을 인용하면 주장으로 저장되고, shown 사실은 그대로다', async () => {
  const { mem, server, post } = await 서버세우기([원리문장]);
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });
    const 기록 = (await mem.load()).shownRefs.at(-1);
    assert.deepEqual(기록.refs.map((r) => r.ref), ['p-원리'], 'shown 사실은 그대로');
    assert.deepEqual(기록.modelCitedRefs, [{ ref: 'p-원리', kind: 'operating_principle' }], '주장은 따로 남는다');
  } finally { server.close(); }
});

test('S5-2/제품: 보여주지 않은 것을 인용하면 저장 0 — shown 은 유지된다', async () => {
  const { mem, server, post } = await 서버세우기(['보여준 적 없는 문장']);
  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });
    const 기록 = (await mem.load()).shownRefs.at(-1);
    assert.deepEqual(기록.refs.map((r) => r.ref), ['p-원리'], 'shown 은 유지된다');
    assert.equal('modelCitedRefs' in 기록, false, '허공 인용은 아예 남지 않는다');
  } finally { server.close(); }
});

test('S5-2/제품: cite 를 안 불러도 턴은 정상이고 shown 은 남는다', async () => {
  const { mem, server, post } = await 서버세우기(null);
  try {
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });
    assert.ok(String(답.reply ?? '').length > 0, '턴이 정상으로 끝난다');
    const 기록 = (await mem.load()).shownRefs.at(-1);
    assert.deepEqual(기록.refs.map((r) => r.ref), ['p-원리']);
    assert.equal('modelCitedRefs' in 기록, false);
  } finally { server.close(); }
});

test('S5-2/제품: 인용도 같은 TurnRef 에 묶이고, 내부 ID 는 나가지 않는다', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기([원리문장]);
  try {
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });
    const 기록 = (await mem.load()).shownRefs.at(-1);
    assert.equal(기록.turnRef.sessionId, s.id);
    assert.ok(Number.isInteger(기록.turnRef.turnSeq));
    assert.equal(String(답.reply ?? '').includes('p-원리'), false, '사용자 답변에 내부 ID 없음');
    assert.equal(JSON.stringify(받은것).includes('p-원리'), false, '모델 입력에도 내부 ID 없음');
  } finally { server.close(); }
});
