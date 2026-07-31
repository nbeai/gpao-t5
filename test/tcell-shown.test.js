// S5-1 · `shownMemoryRefs` — **모델 앞에 실제로 놓인 것만 사실로 남긴다.**
//
// 계획 §4.5 는 세 가지를 엄격히 가른다: 보임(사실) · 모델 주장(cite) · 정정 상관(통계).
// 이 슬라이스는 **첫째 칸 하나**다. 무엇이 렌더됐는지를 그 턴의 신분과 함께 남긴다.
//
// 위험은 "기록이 렌더와 갈리는 것"이다. 후보를 세어 넣거나, 관련 없어 안 들어간 기억을
// 넣거나, 렌더 뒤에 다시 계산해서 다른 답이 나오면 — 그 위에 쌓을 상관·감쇠가 전부 거짓이 된다.
// 그래서 기록은 **렌더된 그 배열**에서만 나온다.
//
// 노출 경계: 내부 ID 는 사용자 답변에도 모델 입력에도 나가지 않는다. 사람이 아는 문장만 간다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore } from '../src/surface/memory-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { makeServer } from '../src/surface/server.js';
import { demoTools } from '../src/surface/demo-context.js';

const 원리 = '월별 수치 정리를 요청하면 표로 정리한다';
const 적용사례 = [
  '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.',
  '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
  '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
];

/** 승격된 원리 하나 · 승격된 선호 하나 · **렌더되면 안 되는** 후보/관찰. */
async function 기억심기(mem) {
  const m = await mem.load();
  m.promoted = [
    {
      candidateId: 'p-원리', kind: 'operating_principle', statement: 원리,
      principleId: 'p-원리', principleVersion: 2,
      admitted: true, userConfirmed: true, replayPassed: true,
      scopeSignals: { appliesWhen: 적용사례, notWhen: [] },
    },
    {
      candidateId: 'pref-보고서', kind: 'preference', statement: '보고서는 짧은 목록으로 정리한다',
      admitted: true, userConfirmed: true,
    },
  ];
  // 아래 둘은 **어떤 경우에도 렌더되지 않는다** — 후보와 관찰은 영향 0 레인이다.
  m.candidates = [{
    candidateId: 'c-후보', kind: 'operating_principle', statement: '월별 수치는 무조건 표로만 낸다',
    admitted: false, userConfirmed: false, replayPassed: false,
  }];
  m.observed = [{ candidateId: 'o-관찰', kind: 'inferred_trait', statement: '숫자를 좋아한다' }];
  await mem.save(m);
}

async function 서버세우기() {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-shown-'));
  const mem = new MemoryStore(dir);
  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '정리했어요.'; } },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());
  return { dir, mem, server, base, post, 받은것 };
}

const shown = (memory) => memory.shownRefs ?? [];

test('S5-1: 모델 입력에 렌더된 것만 shown 으로 남는다', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });

    // 실제로 모델 앞에 놓인 것.
    const tc = 받은것.at(-1);
    assert.deepEqual(tc.admittedContext, [원리], '이 요청에는 원리만 렌더된다');

    const 기록 = shown(await mem.load());
    assert.equal(기록.length, 1, '턴 하나에 기록 하나');
    assert.deepEqual(기록[0].refs.map((r) => r.ref), ['p-원리'], '렌더된 그 항목만 shown');
    assert.deepEqual(기록[0].refs.map((r) => r.kind), ['operating_principle']);
  } finally { server.close(); }
});

test('S5-1: 렌더되지 않은 후보·관찰은 shown 0', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });

    const 기록된 = shown(await mem.load()).flatMap((x) => x.refs.map((r) => r.ref));
    assert.equal(기록된.includes('c-후보'), false, '후보는 렌더되지 않으므로 shown 아님');
    assert.equal(기록된.includes('o-관찰'), false, '관찰 레인도 shown 아님');
    // 모델 입력에도 없다(이중 확인 — 기록만 맞고 렌더가 틀리면 아무 의미가 없다).
    const 입력 = JSON.stringify(받은것.at(-1));
    assert.equal(입력.includes('월별 수치는 무조건 표로만 낸다'), false);
    assert.equal(입력.includes('숫자를 좋아한다'), false);
  } finally { server.close(); }
});

test('S5-1: 관련 없는 요청이면 렌더 0 · shown 0', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '점심 하나만 골라줘' });

    assert.deepEqual(받은것.at(-1).admittedContext, [], '무관한 요청에는 아무 것도 안 든다');
    const 기록 = shown(await mem.load());
    assert.equal(기록.flatMap((x) => x.refs).length, 0, '렌더가 0이면 shown 도 0');
  } finally { server.close(); }
});

test('S5-1: 이어받을 작업(lane)도 렌더됐으면 shown 에 남는다', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기();
  try {
    await 기억심기(mem);
    // 앞 대화에서 산출물을 남긴다 → 새 대화에서 lane 이 공급된다.
    const s1 = await post('/sessions');
    await post('/turn', { sessionId: s1.id, text: '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.' });
    const s2 = await post('/sessions');
    await post('/turn', { sessionId: s2.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });

    const tc = 받은것.at(-1);
    assert.ok((tc.carryableWork ?? []).length > 0, '새 대화에 lane 이 공급됐다');
    const 마지막 = shown(await mem.load()).at(-1);
    const lane기록 = 마지막.refs.filter((r) => r.kind === 'lane');
    assert.equal(lane기록.length, tc.carryableWork.length, '렌더된 lane 수와 같다');
    assert.ok(lane기록.every((r) => r.ref), 'lane 도 신분으로 남는다');
  } finally { server.close(); }
});

test('S5-1: 기록은 그 턴의 TurnRef 와 묶인다', async () => {
  const { dir, mem, server, post } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });

    const { readFileSync } = await import('node:fs');
    const 세션 = JSON.parse(readFileSync(join(dir, `${s.id}.json`), 'utf8'));
    const assistant = [...세션.transcript].reverse().find((e) => e.role === 'assistant');
    const 기록 = shown(await mem.load()).at(-1);
    assert.deepEqual(기록.turnRef, assistant.turnRef, '같은 턴의 신분이다');
    assert.equal(기록.turnRef.sessionId, s.id);
    assert.equal(Number.isInteger(기록.turnRef.turnSeq), true);
  } finally { server.close(); }
});

test('S5-1: 내부 ID 는 사용자 답변에도 모델 입력에도 나가지 않는다', async () => {
  const { mem, server, post, 받은것 } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    const 답 = await post('/turn', { sessionId: s.id, text: '10월 것도. 1600 / 1000 / 신규 12 / 이탈 4' });

    const 내부ID = ['p-원리', 'pref-보고서', 'c-후보', 'o-관찰'];
    for (const id of 내부ID) {
      assert.equal(String(답.reply ?? '').includes(id), false, `사용자 답변에 ${id} 노출`);
      assert.equal(JSON.stringify(받은것.at(-1)).includes(id), false, `모델 입력에 ${id} 노출`);
    }
    // 사람이 아는 문장은 그대로 간다.
    assert.ok(JSON.stringify(받은것.at(-1)).includes(원리));
  } finally { server.close(); }
});

test('S5-1: 기록이 무한히 쌓이지 않는다', async () => {
  const { mem, server, post } = await 서버세우기();
  try {
    await 기억심기(mem);
    const s = await post('/sessions');
    for (let i = 0; i < 6; i += 1) {
      await post('/turn', { sessionId: s.id, text: `${10 + i}월 것도. 1600 / 1000 / 신규 12 / 이탈 4` });
    }
    const { SHOWN_CAP } = await import('../src/kernel/l5-growth/tcell-shown.js');
    const 기록 = shown(await mem.load());
    assert.ok(기록.length <= SHOWN_CAP, `기록 ${기록.length} ≤ 상한 ${SHOWN_CAP}`);
    assert.ok(기록.length > 0);
  } finally { server.close(); }
});

// ── 계약 자체 ──────────────────────────────────────────────────────────────
test('S5-1: 렌더된 배열에 없는 것은 후보로 들고 있어도 shown 이 아니다', async () => {
  const { shownFromRendered } = await import('../src/kernel/l5-growth/tcell-shown.js');
  const r = shownFromRendered({
    turnRef: { sessionId: 's', turnSeq: 2 },
    렌더된: ['보인 문장'],
    후보들: [
      { ref: 'a', kind: 'preference', statement: '보인 문장' },
      { ref: 'b', kind: 'operating_principle', statement: '안 보인 문장' },
    ],
  });
  assert.deepEqual(r.refs, [{ ref: 'a', kind: 'preference', statement: '보인 문장' }],
    '렌더된 것만 남는다(문장도 함께 — 정정이 지목할 대상이 된다)');
});

test('S5-1: 신분 없는 항목은 shown 에 남기지 않는다(무엇을 가리키는지 모르는 기록은 쓸모없다)', async () => {
  const { shownFromRendered } = await import('../src/kernel/l5-growth/tcell-shown.js');
  const r = shownFromRendered({
    turnRef: { sessionId: 's', turnSeq: 2 },
    렌더된: ['현재 목표: 보고서 정리', '보인 문장'],
    후보들: [
      { ref: null, kind: 'active_goal', statement: '현재 목표: 보고서 정리' },
      { ref: 'a', kind: 'preference', statement: '보인 문장' },
    ],
  });
  assert.deepEqual(r.refs.map((x) => x.ref), ['a']);
});

test('S5-1: 기록 상한을 넘기면 오래된 것부터 걷고, 같은 턴은 덮어쓴다', async () => {
  const { recordShown, SHOWN_CAP } = await import('../src/kernel/l5-growth/tcell-shown.js');
  let memory = { shownRefs: [] };
  for (let i = 0; i < SHOWN_CAP + 10; i += 1) {
    memory = { shownRefs: recordShown(memory, { turnRef: { sessionId: 's', turnSeq: i }, refs: [{ ref: `r-${i}`, kind: 'preference' }] }) };
  }
  assert.equal(memory.shownRefs.length, SHOWN_CAP, `상한 ${SHOWN_CAP} 을 넘지 않는다`);
  assert.equal(memory.shownRefs.at(-1).turnRef.turnSeq, SHOWN_CAP + 9, '최근 것이 남는다');
  assert.equal(memory.shownRefs[0].turnRef.turnSeq, 10, '오래된 것부터 걷힌다');

  // 재처리는 통계를 부풀리지 않는다.
  const 전 = memory.shownRefs.length;
  memory = { shownRefs: recordShown(memory, { turnRef: { sessionId: 's', turnSeq: SHOWN_CAP + 9 }, refs: [{ ref: 'r-바뀜', kind: 'preference' }] }) };
  assert.equal(memory.shownRefs.length, 전, '같은 턴은 하나로 유지된다');
  assert.equal(memory.shownRefs.at(-1).refs[0].ref, 'r-바뀜');
});
