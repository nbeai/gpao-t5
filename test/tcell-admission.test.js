// S4 · 검증된 원리의 **입장 판정**. 낱말 겹침이 아니라 **suite 가 검증한 사례**로 판단한다.
//
// 라이브에서 막힌 자리: 원리를 좁힐수록 문장이 길고 구체적이 되는데, 관련성 판정이 낱말
// 겹침이라 축약된 실제 발화(`12월 것도. 1800 / 1100 / …`)와 안 겹쳐 **입장 자체를 못 했다.**
// S4 가 "좁혀라"라고 요구하는 방향과 입장 관문이 정면으로 부딪힌 것이다.
//
// 그렇다고 낱말 겹침을 느슨하게 풀면 과잉 적용이 열린다. 대신 이미 있는 사실을 쓴다:
// **그 원리는 어떤 상황에서 통과했고 어떤 상황에서 떨어졌는지 suite 가 이미 검증했다.**
// positive·boundary 사례는 "적용되는 상황", negative 사례는 "적용하면 안 되는 상황"이다.
//
// 실측 문턱(2026-07-31 라이브 데이터):
//   축약 발화 vs 적용 사례 1.00 · 명시 발화 1.00 · 점심 0.00 · 마케팅 문구 0.00 · "표 말고" 0.20
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
import { admittedContext } from '../src/kernel/l1-intent/context-mesh.js';

// 라이브에서 실제로 승격된 원리와 그 사례들(2026-07-31 `r2-data`).
const 원리 = "사용자가 여러 달의 매출·비용·신규·이탈을 연속으로 요청하며 숫자와 함께 '정리해줘/부탁/같이'라고"
  + ' 말할 때에만, 이미 정리한 앞달 표에 해당 달 행만 덧붙인 한 개의 비교표로 답하고 새 설명 요약은 붙이지 않는다';

// **적용 신호는 그 원리를 낳은 반복 발화 그대로다.** 사례 서술문(`사용자가 …라고 말했다`)은
// 사람이 실제로 치는 말과 결이 달라, 짧고 흔한 말이 그 서술문에 우연히 걸린다(실측:
// `오늘 일정 좀 정리해줘` 가 0.60). 같은 결의 말끼리 비교해야 한다.
const 적용사례 = [
  '7월 매출 1200, 비용 800, 신규고객 14명, 이탈 3명. 이거 좀 정리해줘.',
  '8월 것도. 1350 / 900 / 신규 11 / 이탈 5',
  '9월도 부탁. 1500 / 950 / 신규 9 / 이탈 2',
  '10월 것도 같이. 1600 / 1000 / 신규 12 / 이탈 4',
  '11월도 정리해줘. 1700 / 1050 / 신규 15 / 이탈 6',
];
const 비적용사례 = [
  '사용자가 "7월: 매출 1200, 비용 800. 8월: 매출 1350, 비용 900. 이걸 보고 느낀 점을 요약해줘."라고 말했다',
  '사용자가 표 대신 간단한 문장 요약으로 달라고 명시했다',
  '사용자가 이 숫자로 마케팅 문구를 써 달라고 했다',
];

const 승격된 = (over = {}) => ({
  candidateId: 'p-검증됨', kind: 'operating_principle', statement: 원리,
  principleId: 'p-검증됨', principleVersion: 2,
  admitted: true, userConfirmed: true, replayPassed: true,
  scopeSignals: { appliesWhen: 적용사례, notWhen: 비적용사례 },
  ...over,
});

const 기억 = (over = {}) => ({ promoted: [승격된()], candidates: [], ...over });

// ── 반대시험 7건(감사가 지정한 그대로) ────────────────────────────────────
test('S4/입장: 축약 발화도 입장한다 — 낱말이 안 겹쳐도 같은 상황이면 보인다', () => {
  assert.deepEqual(admittedContext(기억(), '12월 것도. 1800 / 1100 / 신규 17 / 이탈 5'), [원리]);
});

test('S4/입장: 명시 발화도 입장한다', () => {
  assert.deepEqual(admittedContext(기억(), '12월 매출·비용·신규·이탈 정리해줘'), [원리]);
});

test('S4/입장: 무관한 요청에는 입장 0', () => {
  assert.deepEqual(admittedContext(기억(), '점심 하나만 골라줘'), []);
});

test('S4/입장: 인접하지만 원리가 적용되면 안 되는 요청에는 입장 0(과잉 적용 차단)', () => {
  // 같은 숫자를 놓고도 **다른 일**을 시킨다 — negative 사례가 검증한 자리다.
  assert.deepEqual(admittedContext(기억(), '이 숫자로 마케팅 문구 한 줄만 써줘'), []);
});

test('S4/입장: 현재 지시가 원리와 다르면 원리를 강제하지 않는다', () => {
  assert.deepEqual(admittedContext(기억(), '표 말고 한 문장으로만'), []);
});

test('S4/입장: replay 미통과 원리는 입장 0(사례가 있어도)', () => {
  const m = 기억({ promoted: [승격된({ replayPassed: false })] });
  assert.deepEqual(admittedContext(m, '12월 것도. 1800 / 1100 / 신규 17 / 이탈 5'), []);
});

test('S4/입장: 사용자 확인 없는 원리는 입장 0(사례가 있어도)', () => {
  const m = 기억({ promoted: [승격된({ userConfirmed: false })] });
  assert.deepEqual(admittedContext(m, '12월 것도. 1800 / 1100 / 신규 17 / 이탈 5'), []);
});

// ── 경계: 사례가 없으면 예전 판정을 그대로 쓴다 ───────────────────────────
test('S4/입장: 검증 사례가 없는 항목은 기존 낱말 판정을 그대로 쓴다(선호 기억 불변)', () => {
  const m = {
    promoted: [{
      candidateId: 'pref-1', kind: 'preference', statement: '보고서는 짧은 목록으로 정리한다',
      admitted: true, userConfirmed: true, replayPassed: true,
    }],
  };
  assert.deepEqual(admittedContext(m, '보고서 좀 정리해줘'), ['보고서는 짧은 목록으로 정리한다']);
  assert.deepEqual(admittedContext(m, '점심 뭐 먹지'), []);
});

test('S4/입장: 비적용 신호와 아슬아슬하면 들어가지 않는다(잘못 든 원리가 더 나쁘다)', () => {
  // 실측 0.86 대 0.80 — 적용이 조금 크다고 들이면 검증된 비적용 상황에 원리가 낀다.
  const m = 기억();
  assert.deepEqual(
    admittedContext(m, '7월 매출 1200, 비용 800, 신규 14, 이탈 3. 이걸 보고 느낀 점을 요약해줘.'),
    [],
  );
});

test('S4/입장: 짧고 흔한 말이 우연히 걸리지 않는다(본보기를 덮어야 든다)', () => {
  // 겹침만 보면 `오늘 일정 좀 정리해줘` 가 0.60 으로 붙었다. 본보기의 3분의 1밖에 못 덮는다.
  const m = 기억();
  assert.deepEqual(admittedContext(m, '오늘 일정 좀 정리해줘'), []);
  assert.deepEqual(admittedContext(m, '회의록 정리해줘'), []);
});

// ── 제품 경로 ──────────────────────────────────────────────────────────────
test('S4/제품: 승격된 원리가 실제 턴의 모델 입력에 든다(축약 발화)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-admit-'));
  const mem = new MemoryStore(dir);
  const m = await mem.load();
  m.promoted = [승격된()];
  await mem.save(m);

  const 받은것 = [];
  const server = makeServer({
    store: new SessionStore(dir), eventLog: new EventLog(dir), tools: demoTools(),
    model: { async respond(tc) { 받은것.push(tc); return '알겠어요.'; } },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());

  try {
    const s = await post('/sessions');
    await post('/turn', { sessionId: s.id, text: '12월 것도. 1800 / 1100 / 신규 17 / 이탈 5' });
    assert.deepEqual(받은것.at(-1).admittedContext, [원리], '축약 발화에도 원리가 모델 입력에 든다');
    assert.deepEqual(받은것.at(-1).carryableWork ?? [], [], '앞 대화가 없으므로 lane 기여 0');

    const s2 = await post('/sessions');
    await post('/turn', { sessionId: s2.id, text: '이 숫자로 마케팅 문구 한 줄만 써줘' });
    assert.deepEqual(받은것.at(-1).admittedContext, [], '인접 요청에는 들어가지 않는다');
  } finally { server.close(); }
});
