// S1 · 무마찰 가역 기억과 철회. 계획 §4.2·§4.9.
//
// 봉인 실측이 말한 것: H01 "앞으로 보고서는 목록으로" 는 3/3 모두 카드 1·클릭 1 을 요구했고
// 그 카드가 지킨 실제 위험은 0 이었다. H04 "방금 기억한 선호는 취소해줘" 는 3/3 실패했다 —
// 기억 취소가 파일 되돌리기 승인 카드로 갔고 기억은 지워지지 않았다.
//
// 이 검사가 고정하는 것:
//   ① 사용자가 선언하면 카드·클릭 0 으로 즉시 반영되고 되돌리기가 표면에 있다
//   ② 철회는 한 턴에 끝나고 말·상태·원장이 같은 사실을 본다
//   ③ 자동 반영은 **사용자 원문 인용 그 자체**만 저장한다(요약·확장은 자동 불가)
//   ④ 질문·인용·부정·회상·과거 턴 위조·민감값은 자동 반영 0
//   ⑤ 저장소가 깨졌을 때 빈 상태로 위장하지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { EventLog } from '../src/surface/event-log.js';
import { MemoryStore } from '../src/surface/memory-store.js';
import { demoTools } from '../src/surface/demo-context.js';
import { splitModelControlCalls } from '../src/kernel/l2-plan/model-control.js';

const H01 = '앞으로 보고서는 표보다 짧은 목록으로 정리해줘.';
const H04 = '방금 기억한 보고서 형식 선호는 취소해줘';

/** 지정한 통제 호출을 순서대로 내는 모델 스텁(기존 서버 검사 관례). */
const 고른다 = (perTurn) => {
  const script = perTurn.flatMap((c) => [c, null]);
  return {
    // **정산 호출은 대본을 소비하지 않는다**(2026-08-10). 이 대본은 "모델 호출 n번째"로
    // 세는데, P90-1 정산이 열리면 턴당 호출이 하나 늘어 **대본이 통째로 밀린다**(철회 호출이
    // 먹혔다). 정산은 `workStateSettlement` 를 들고 오는 다른 질문이므로 여기서 갈라 답한다 —
    // 검사가 재려는 것(기억 반영·철회)은 그대로다.
    async respond(tc) {
      if (tc?.workStateSettlement) return { text: '', toolCalls: [{ name: 'work.state', args: { noChange: true } }] };
      const next = script.shift();
      return next ? { text: '', toolCalls: [next] } : '알겠어요.';
    },
  };
};

const propose = (statement, evidence) => ({
  name: 'memory.propose',
  args: { kind: 'preference', statement, evidence },
});
// 아래 시나리오들은 전부 **앞으로도 지킬 선언**이다("앞으로 보고서는…"). 그 사실을 모델이
// 말한 것으로 둔다 — 범위를 말하지 않은 경우는 따로 잰다(맨 아래).
const declared = (quote) => ({ utteranceQuote: quote, speechAct: 'declaration', appliesTo: 'from_now_on' });
/** 범위를 말하지 않은 모델 — 자동 반영 대상이 아니다. */
const 범위없음 = (quote) => ({ utteranceQuote: quote, speechAct: 'declaration' });

async function standUp(perTurn, { onFileCall } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-revmem-'));
  const store = new SessionStore(dir);
  // 파일 손 호출을 관측할 수 있게 한다 — 헌장 뒤에는 승인 목록이 아니라 **실행 사실**이 증거다.
  const base손 = demoTools().tools['local.file'];
  const tools = onFileCall
    ? demoTools({ localFile: { ...base손, handler: async (a) => { onFileCall(a ?? {}); return base손.handler(a); } } })
    : demoTools();
  const server = makeServer({
    store, eventLog: new EventLog(dir), tools, model: 고른다(perTurn),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { dir, store, server, base: `http://127.0.0.1:${server.address().port}`, mem: new MemoryStore(dir) };
}

const post = (base, path, body) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then((r) => r.json());

// ── ① H01: 카드·클릭 0 ────────────────────────────────────────────────────
test('S1/H01: 선언한 선호는 카드·클릭 없이 즉시 반영된다', async () => {
  const { server, base, mem } = await standUp([propose(H01, declared(H01))]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H01 });

    // 카드가 뜨지 않는다 — 확인을 기다리는 제안이 아니다.
    assert.equal(r.memorySuggestion, undefined, '확인 카드를 만들지 않는다');
    // 대신 이미 반영됐고 되돌릴 수 있다는 사실이 표면에 실린다.
    assert.ok(r.memoryApplied, '반영 사실이 응답에 실린다');
    assert.equal(r.memoryApplied.statement, H01, '사용자 원문 그대로');
    assert.ok(r.memoryApplied.undoId, '되돌리기 대상이 함께 온다');

    const m = await mem.load();
    assert.equal(m.candidates.length, 0, '확인 대기 후보를 만들지 않는다');
    assert.equal(m.promoted.length, 1, '바로 반영된다');
    assert.equal(m.promoted[0].statement, H01);
    assert.equal(m.promoted[0].tier, 'auto_reversible', '가역 자동 반영 등급');
  } finally { server.close(); }
});

test('S1/H01: 반영된 선호는 다음 턴 모델 입력에 들어간다', async () => {
  const { server, base, mem } = await standUp([propose(H01, declared(H01))]);
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: H01 });
    const m = await mem.load();
    // 입장 관문이 읽는 사실 — admitted 판정에 필요한 필드가 서 있다.
    assert.equal(m.promoted[0].admitted, true, '입장 자격을 갖는다');
    assert.equal(m.promoted[0].userConfirmed, true, '사용자 선언이 곧 확인이다');
  } finally { server.close(); }
});

// ── ② H04: 한 턴 철회 ─────────────────────────────────────────────────────
test('S1/H04: 철회는 한 턴에 끝나고 말·상태가 일치한다', async () => {
  const { server, base, mem } = await standUp([
    propose(H01, declared(H01)),
    { name: 'memory.withdraw', args: { target: H01, reason: '사용자가 취소를 말함' } },
  ]);
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: H01 });
    assert.equal((await mem.load()).promoted.length, 1, '먼저 반영돼 있다');

    const r = await post(base, '/turn', { sessionId: s.id, text: H04 });
    assert.ok(r.memoryWithdrawn, '철회 사실이 응답에 실린다');
    assert.equal(r.memorySuggestion, undefined, '철회 턴에 기억 카드를 새로 만들지 않는다');
    // 남은 결함(감사 회부): 같은 턴에 파일 되돌리기 승인 카드가 함께 뜬다. 원인은 기억이
    // 아니라 도구 추론 정규식(`intent.js:71` 의 `취소해` → local.file, `file-parse.js:14`
    // 의 undo)이고, 그 자리는 계획 §5 가 이 슬라이스에 금지한 구역이라 손대지 않았다.
    assert.equal(r.memoryWithdrawn.statement, H01, '무엇을 지웠는지 말한다');

    const m = await mem.load();
    assert.equal(m.promoted.length, 0, '상태에서 실제로 사라진다');
    assert.ok(Object.keys(m.closed ?? {}).length >= 1, '철회 표식이 남는다(멱등)');
  } finally { server.close(); }
});

test('S1/H04: 없는 기억을 철회하라 하면 지웠다고 말하지 않는다', async () => {
  const { server, base } = await standUp([
    { name: 'memory.withdraw', args: { target: '있지도 않은 선호' } },
  ]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H04 });
    assert.equal(r.memoryWithdrawn, undefined, '거짓 성공 0');
  } finally { server.close(); }
});

// ── ③ 인용과 내용의 구성적 결합 ───────────────────────────────────────────
test('S1: 요약·확장된 statement 는 자동 반영되지 않는다(확인 통로로 강등)', async () => {
  const { server, base, mem } = await standUp([
    propose('사용자는 항상 목록형 보고서를 선호함', declared(H01)),
  ]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H01 });
    assert.equal(r.memoryApplied, undefined, '자동 반영 0');
    assert.ok(r.memorySuggestion, '대신 기존 확인 후보가 된다');
    const m = await mem.load();
    assert.equal(m.promoted.length, 0, '확인 전에는 반영 0');
    assert.equal(m.candidates.length, 1);
  } finally { server.close(); }
});

// ── ④ 발화 신분 반증 4형 + 위조 + 민감값 ─────────────────────────────────
const 반증 = [
  ['질문형', '내가 목록으로 해달라고 했었나?', 'question'],
  ['인용형', "친구가 '목록이 좋다'고 하더라", 'quotation'],
  ['부정형', '표로 하지 말라는 건 아니야', 'negation'],
  ['회상형', '예전엔 목록으로 했었지', 'recollection'],
];

for (const [이름, 발화, act] of 반증) {
  test(`S1: ${이름} 발화는 자동 반영되지 않는다`, async () => {
    const { server, base, mem } = await standUp([
      { name: 'memory.propose', args: { kind: 'preference', statement: 발화, evidence: { utteranceQuote: 발화, speechAct: act } } },
    ]);
    try {
      const s = await post(base, '/sessions');
      const r = await post(base, '/turn', { sessionId: s.id, text: 발화 });
      assert.equal(r.memoryApplied, undefined, `${이름}은 선언이 아니다`);
      assert.equal((await mem.load()).promoted.length, 0, '반영 0');
    } finally { server.close(); }
  });
}

test('S1: 이번 턴 원문에 없는 인용(과거 턴 위조)은 자동 반영되지 않는다', async () => {
  const { server, base, mem } = await standUp([
    propose(H01, declared(H01)), // 1턴: 정상 반영
    propose('앞으로 항상 표로 정리해줘.', declared('앞으로 항상 표로 정리해줘.')), // 2턴: 이번 원문에 없음
  ]);
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: H01 });
    const r = await post(base, '/turn', { sessionId: s.id, text: '오늘 날씨 어때?' });
    assert.equal(r.memoryApplied, undefined, '이번 턴 원문의 부분 문자열이 아니면 자동 반영 0');
    assert.equal((await mem.load()).promoted.length, 1, '앞 턴 반영분만 남는다');
  } finally { server.close(); }
});

test('S1: 민감값이 섞인 선언은 자동 반영되지 않는다(H07 회귀선)', async () => {
  const 발화 = '앞으로 이 키로 접속해줘: sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
  const { server, base, mem } = await standUp([propose(발화, declared(발화))]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: 발화 });
    assert.equal(r.memoryApplied, undefined, '민감값은 자동 반영 0');
    const m = await mem.load();
    assert.equal(m.promoted.length, 0);
    assert.equal(m.candidates.length, 0, '후보로도 남지 않는다(기존 경계)');
  } finally { server.close(); }
});

// ── 통제 채널 계약 (단위) ─────────────────────────────────────────────────
test('S1: 통제 채널이 evidence 를 보존하고 withdraw 를 분리한다', () => {
  const out = splitModelControlCalls([
    { name: 'memory.propose', args: { kind: 'preference', statement: H01, evidence: declared(H01) } },
    { name: 'memory.withdraw', args: { target: H01, reason: '취소' } },
    { name: 'web.collect', args: { request: 'x' } },
  ]);
  assert.equal(out.memorySuggestion.statement, H01);
  assert.deepEqual(out.memorySuggestion.evidence, declared(H01), 'evidence 가 소실되지 않는다');
  assert.equal(out.memoryWithdrawal.target, H01, 'withdraw 가 분리된다');
  assert.equal(out.rest.length, 1, '실행 손은 그대로 남는다');
});

// ── ⑤ 저장 정직성 (§4.9) ─────────────────────────────────────────────────
test('S1: 손상된 memory.json 을 빈 상태로 위장하지 않는다', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-revmem-corrupt-'));
  const mem = new MemoryStore(dir);
  await mem.save({ candidates: [], promoted: [{ statement: '지켜야 할 기억' }], observed: [], closed: {} });
  await writeFile(join(dir, 'memory.json'), '{ 깨진 JSON', 'utf8');

  const loaded = await mem.load();
  assert.equal(loaded.corrupted, true, '손상 사실을 상태로 말한다');
  assert.ok(loaded.corruptionQuarantine, '격리 사본 경로를 남긴다');
  const 격리본 = await readFile(loaded.corruptionQuarantine, 'utf8');
  assert.ok(격리본.includes('깨진'), '깨진 원본을 보존한다');
});

test('S1: 파일이 없을 때만 새 저장소로 시작한다(ENOENT)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-revmem-fresh-'));
  const loaded = await new MemoryStore(dir).load();
  assert.equal(loaded.corrupted, undefined, '없는 것은 손상이 아니다');
  assert.deepEqual(loaded.promoted, []);
});

test('S1: 손상 상태에서는 새 자동 반영을 하지 않는다', async () => {
  const { dir, server, base, mem } = await standUp([propose(H01, declared(H01))]);
  try {
    await mem.save({ candidates: [], promoted: [], observed: [], closed: {} });
    await writeFile(join(dir, 'memory.json'), '{ 깨진', 'utf8');
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H01 });
    assert.equal(r.memoryApplied, undefined, '복구 전에는 반영하지 않는다');
    assert.ok(r.memoryStoreWarning, '사람 말로 알린다');
  } finally { server.close(); }
});

// ── H04 사용자 표면 완결: 무관 파일 승인 카드 0 ──────────────────────────────
// 오너 판정(2026-07-31): 기억은 지워졌어도 "파일 되돌릴까요?" 가 뜨면 말귀는 여전히
// 어긋난 것이다. 도구 선택 정책 전체를 바꾸지 않고, **같은 발화에서 기억 철회가 더 구체적인
// 의도로 확정된 경우에만** 파일 undo 오탐을 억누르는 충돌 해소로 닫는다.

test('S1/H04: 철회가 성립한 턴에는 무관한 파일 승인 카드가 뜨지 않는다', async () => {
  const { server, base, mem } = await standUp([
    propose(H01, declared(H01)),
    { name: 'memory.withdraw', args: { target: H01, reason: '사용자가 취소를 말함' } },
  ]);
  try {
    const s = await post(base, '/sessions');
    await post(base, '/turn', { sessionId: s.id, text: H01 });
    const r = await post(base, '/turn', { sessionId: s.id, text: H04 });

    assert.ok(r.memoryWithdrawn, '기억은 지워졌다');
    const 파일승인 = (r.pending ?? []).filter((p) => p.action === 'local.file');
    assert.equal(파일승인.length, 0, '요청하지 않은 파일 되돌리기 승인이 없다');
    assert.notEqual(r.kind, 'approval', '철회 턴이 승인 대기로 끝나지 않는다');
    assert.equal((await mem.load()).promoted.length, 0);
  } finally { server.close(); }
});

test('S1: 진짜 파일 되돌리기 요청은 그대로 실행된다(억제가 번지지 않는다)', async () => {
  // 억제는 기억 철회가 성립한 턴에만 걸린다. 파일 undo 자체를 없애면 그건 **능력 삭제**다 —
  // 이 검사가 지키는 것은 그것이지 "승인을 받는다"가 아니었다(관측점이 승인이었을 뿐).
  // 헌장(2026-08-03) 뒤 되돌릴 수 있는 파일 작업은 자동이므로, 억제가 번졌는지는
  // **손이 실제로 불렸는가**로 잰다 — 억제가 번지면 undo 가 아예 실행되지 않는다.
  const 불린것 = [];
  const { server, base } = await standUp([
    { name: 'local.file', args: { action: 'undo' } },
  ], { onFileCall: (a) => 불린것.push(a) });
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: '방금 만든 파일 되돌려줘' });
    assert.notEqual(r.kind, 'approval');
    assert.ok(불린것.some((a) => a.action === 'undo'),
      '진짜 되돌리기 요청인데 파일 손이 불리지 않았다 — 억제가 번져 능력이 사라졌다');
  } finally { server.close(); }
});

// ── 현재 턴 예외는 기억이 되지 않는다 (H 진단 계열 ② · P0) ────────────────
//
// 라이브 진단에서 `"이번만 줄글로 길게 써줘."` 가 **영구 선호로 승격**(`admitted: true`)되고,
// 그 뒤 **무관한 다른 대화의 모델 입력에 실제로 보였다.** 일회성 예외가 규칙이 되고 대화를
// 넘어 샌 것이다 — 판정표 H03 안전 문장과 무관 과잉 적용 금지의 정면 위반(P0).
//
// 스키마에는 이미 "한 번 요청(`이번만`)은 적지 않는다"고 **산문으로** 적혀 있었다. 모델은
// 그걸 지키지 않았다. cite 때와 같은 모양이다 — 산문 금지는 계약이 아니다.
//
// 그래서 낱말 규칙을 Runtime 에 두지 않는다(그건 의미 판단을 정규식으로 대체하는 것이고,
// "이번엔 짧게"·"오늘만"·"방금 것만" 앞에서 바로 무너진다). 대신 **모델이 범위를 말하게**
// 하고 Runtime 은 그 결과만 집행한다.
const 범위 = (quote, appliesTo) => ({ utteranceQuote: quote, speechAct: 'declaration', appliesTo });
const 이번만 = '이번만 줄글로 길게 써줘.';

test('S1/H03: 현재 턴 범위로 말한 지시는 승격도 카드도 만들지 않는다', async () => {
  const { server, base, mem } = await standUp([propose(이번만, 범위(이번만, 'this_turn_only'))]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: 이번만 });

    assert.equal(r.memoryApplied, undefined, '현재 턴 예외가 영구 반영됐다');
    assert.equal(r.memorySuggestion, undefined, '현재 턴 예외로 확인 카드를 만들지 않는다');

    const m = await mem.load();
    assert.equal(m.promoted.length, 0, '승격 레인에 남았다');
    assert.equal(m.candidates.length, 0, '후보 레인에 남았다');
  } finally { await new Promise((r) => server.close(r)); }
});

test('S1/H03: 앞으로 지킬 범위로 말하면 예전처럼 즉시 반영된다(마찰 0 유지)', async () => {
  const { server, base, mem } = await standUp([propose(H01, 범위(H01, 'from_now_on'))]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H01 });
    assert.ok(r.memoryApplied, '앞으로 지킬 선언은 그대로 즉시 반영');
    assert.equal(r.memorySuggestion, undefined, '카드 0');
    assert.equal((await mem.load()).promoted.length, 1);
  } finally { await new Promise((r) => server.close(r)); }
});

test('S1/H03: 범위를 말하지 않으면 자동 반영하지 않고 기존 확인 통로로 보낸다', async () => {
  // 모르는 것을 "앞으로"로 가정하지 않는다. Runtime 이 범위를 추측하는 순간 같은 구멍이
  // 다시 열린다. 새 카드 종류를 만들지 않고 **이미 있는** 확인 통로를 쓴다.
  const { server, base, mem } = await standUp([propose(H01, 범위없음(H01))]);
  try {
    const s = await post(base, '/sessions');
    const r = await post(base, '/turn', { sessionId: s.id, text: H01 });
    assert.equal(r.memoryApplied, undefined, '범위 미상인데 자동 반영했다');
    assert.ok(r.memorySuggestion, '기존 확인 통로로 간다');
    assert.equal((await mem.load()).promoted.length, 0);
  } finally { await new Promise((r) => server.close(r)); }
});

// ── H04 채널 교통 — 철회 발화가 새 기억으로 쌓이지 않게 하는 사실 공급 ────────
//
// 재봉인 r14 실측: "아 그 짧은 목록 규칙은 이제 그만할래"(선언 5턴 뒤)에서 모델이
// `memory.withdraw` 대신 `memory.propose` 를 골라, 철회 발화가 **새 선호로 저장**되고
// 원래 선호도 남았다(모순 공존). withdraw 설명이 "**방금** 기억한 것"으로 범위를 좁혀
// 오래된 기억의 철회에서 채널 선택을 오도한 것 — 도구 설명은 모델에게 공급되는 현실이다.
import { test as h04시험 } from 'node:test';
import assert3 from 'node:assert/strict';
import { MODEL_CONTROL_SCHEMAS as 통제스키마 } from '../src/kernel/l2-plan/model-control.js';

h04시험('H04: withdraw 설명은 저장된 기억 전체를 대상으로 말한다 — "방금"으로 좁혀 오도하지 않는다', () => {
  const w = 통제스키마.find((s) => s.name === 'memory.withdraw');
  assert3.ok(w, 'withdraw 통제 채널이 없다');
  assert3.doesNotMatch(w.description, /방금 기억한 것/, '설명이 최근 기억으로 범위를 좁혀 오래된 철회를 오도한다');
  assert3.match(w.description, /저장된|기억해 둔/, '저장된 기억 일반이 대상임을 말하지 않는다');
});

h04시험('H04: propose 설명이 취소·중단 발화의 교통(withdraw)을 말한다 — 철회가 새 기억으로 쌓이지 않게', () => {
  const p = 통제스키마.find((s) => s.name === 'memory.propose');
  assert3.match(p.description, /withdraw/, '취소 발화가 propose 로 흘러 새 기억이 되는 길이 열려 있다');
});
