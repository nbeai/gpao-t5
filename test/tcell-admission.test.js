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
  // ── **사용자에 대한 사실은 발화로 거르지 않는다**(F-18 · 2026-08-05) ──────────
  // 오너 설치 실측: 승격된 기억 **0개**, 집 파일 비어 있음 — 기억이 모델에게 **한 번도** 간 적이
  // 없었다. 그 위에 낱말 겹침 필터가 얹혀 `"내가 뭘 마시는지 알아?"` 에 `"홍차를 마신다"` 가
  // 안 실렸다. **분류기가 사실 공급 여부를 정하고 있었다**(계획서가 F-18 로 적어 둔 그것).
  // 선호는 사용자에 대한 사실이라 무엇을 물었느냐로 참·거짓이 되지 않는다. 개수만 묶는다.
  // (검증 사례가 있는 **원칙**은 그대로 사례로 범위가 정해진다 — 아래 단언들이 그걸 지킨다.)
  assert.deepEqual(admittedContext(m, '보고서 좀 정리해줘'), ['보고서는 짧은 목록으로 정리한다']);
  assert.deepEqual(admittedContext(m, '점심 뭐 먹지'), ['보고서는 짧은 목록으로 정리한다'],
    '무엇을 물었든 사용자에 대한 사실은 그대로다');
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

// ── F-89 · **검증을 통과한 원리가 자기 자신의 트리거로도 못 들어왔다** (2026-08-12) ────────
//
// 오너 실물 `~/.local/state/gpao-t5/sessions/memory.json` 실측: `scopeSignals` 를 가진
// 후보 5건 중 **3건**이, `appliesWhen` 에 적힌 발화를 **글자 하나까지 그대로** 넣어도
// 입장하지 못했다. 그 3건에는 `replayReport.pass=true` 인 **2건이 전부** 들어 있다 —
// 즉 검증을 통과한 원리는 하나도 모델 앞에 서지 못했다.
//
// **왜 그런가**(㉮ · `context-mesh.js` 의 두 값을 **서로 다른 자로** 재고 있었다):
//   적용 = `bestShapeMatch` — 겹침 **그리고** 덮음(두 축)
//   비적용 = `bestShapeOverlap` — 겹침만(한 축). 겹침은 **작은 쪽 기준**이라
//            요청을 통째로 품은 긴 비적용 본보기는 **무조건 1.000** 이 된다.
// negative 사례의 `inputFacts` 에는 그 상황의 사용자 발화가 실제 값 그대로 들어간다
// (`tcell-grow.js` 제안 계약이 그렇게 요구한다 — "발화면 그 문장"). 그래서 비적용 본보기가
// 적용 발화를 **포함**하고, 겹침 1.000 으로 적용과 동점이 되어 엄격 부등호에서 진다.
// 실측: f4e9f555 적용 1.000 대 비적용 1.000 · 9f1e626c 1.000 대 1.000 · a46ecf636 1.000 대 1.000.
//
// **㉯(`tcell-grow.js` 가 발화를 그대로 넣는 것)는 원인이 아니다.** 그 줄을 걷어내는 안을
// 실측했더니 10칸 중 9칸으로, 아래 ④(진짜 비적용)가 깨졌다 — 비적용을 가르는 **유일한**
// 재료가 바로 그 발화 줄이기 때문이다("…도구를 쓸 수 있는지부터 말해줘"). 잡음과 판별력이
// 같은 줄에 있으므로 줄을 지우는 것은 수리가 아니라 판별력 제거다.
//
// 수리는 **자를 맞추는 것**이다: 두 쪽 다 크기를 함께 보는 같은 자(`bestShapeSimilarity`)로
// 재고 겨룬다. 문턱(0.45)과 입장 관문(겹침·덮음)은 **그대로다** — 그물은 안 넓어진다.

/** 오너 실물에서 옮긴 고정물 — 실물 파일에 의존하지 않는다(읽기 전용 실측 2026-08-12). */
const 오너실물 = [
  {
    id: 'f4e9f555925ffd8aed89e192',
    pass: true,
    statement: '같은 검색 요청이 반복되면, 실제 검색을 수행할 수 없다는 제한을 한 번은 분명히 밝히고,'
      + ' 이후에도 같은 제한하에서 네이버 검색 결과 대신 관련 요약·대안을 제공하는 답만 한다.',
    appliesWhen: ['네이버 열어서 전세사기 검색 결과 알려줘'],
    notWhen: [
      "사용자 발화: '네이버 열어서 전세사기 검색 결과 알려줘'",
      '도우미는 외부 사이트를 직접 열 수 없다.',
      "도우미는 제한 설명 없이 '네이버 첫 번째 결과는 △△, 두 번째는 ○○'라고 단정적으로 말한다.",
    ],
  },
  {
    id: '9f1e626c6c24edb8f1e32f6f',
    pass: true,
    statement: '사용자가 같은 네이버 플레이스 후기 분석 요청을 여러 번 반복하되, 실제 네이버 검색·크롤링'
      + ' 수행 가능 여부를 묻지 않은 상황에서는, 도우미는 실제 검색을 했다고 서술하거나 검색 결과를 인용하지 말고'
      + '(이 원리는 사용자가 이미 도구 사용 가능 여부를 명시적으로 물어본 경우에는 적용하지 않는다).',
    appliesWhen: ['네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어?'],
    notWhen: [
      '사용자가 "네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어? 도구를 쓸 수 있는지부터 말해줘"라고 물었다.',
      '도우미는 사용할 수 있는 네이버 검색 도구의 유무와 한계를 먼저 설명했다.',
      '도우미는 실제 검색 가능 여부를 설명하는 과정에서만 도구 사용 여부를 언급했다.',
    ],
  },
  {
    // 이 건은 오늘 `replayReport.pass=false` 라 승격 자체가 막힌다. 그래도 고정물로 박는다 —
    // 막힌 것은 **입장 판정**이고, 그 판정은 승격 여부와 독립으로 같은 결함을 보였다.
    id: 'a46ecf636dbb865764397405',
    pass: false,
    statement: '사용자가 내 컴퓨터 파일 존재·위치를 묻는다면, 실제 검색 가능 여부와 검색 범위를 먼저'
      + ' 분명히 밝히고, 그 범위 안에서 찾은 파일의 존재 여부와 경로를 사실대로 요약해서 답한다.',
    appliesWhen: [
      '내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘.',
      '내 컴퓨터에 PDF 파일 있어? 찾아서 어디 있는지 알려줘.',
      '문서 폴더에 텍스트 파일 있는지 찾아서 알려줘.',
    ],
    notWhen: [
      "사용자 발화: '내 컴퓨터에 엑셀 파일 있어? 찾아서 어디 있는지 알려줘.'",
      '도우미는 현재 어떤 파일 시스템에도 접근할 수 없다.',
      '도우미는 과거 대화에서 이 컴퓨터의 파일 목록을 받은 적이 없다.',
    ],
  },
];

const 실물기억 = (x) => ({
  promoted: [{
    candidateId: x.id, kind: 'operating_principle', statement: x.statement,
    principleId: x.id, principleVersion: 1,
    admitted: true, userConfirmed: true, replayPassed: true,
    scopeSignals: { appliesWhen: x.appliesWhen, notWhen: x.notWhen },
  }],
  candidates: [],
});

// ① 검증 통과한 원리가 **자기 `appliesWhen` 과 같은 발화**에서 실린다 — 밟은 그 자리.
// ② 오너 실물에서 막히던 3건이 전부 실린다.
for (const x of 오너실물) {
  test(`F-89 ①②/입장: 오너 실물 ${x.id.slice(0, 8)} 가 자기 appliesWhen 발화에서 실린다`, () => {
    for (const 발화 of x.appliesWhen) {
      assert.deepEqual(
        admittedContext(실물기억(x), 발화), [x.statement],
        `검증된 원리가 자기 트리거(${발화.slice(0, 24)}…)에서 입장하지 못했다`,
      );
    }
  });
}

// ④ `notWhen` 이 **진짜로 맞는** 발화에서는 여전히 안 실린다 — 비적용 판정이 살아 있다.
test('F-89 ④/입장: 검증된 비적용 상황에는 여전히 안 실린다(판별력을 지운 것이 아니다)', () => {
  const x = 오너실물[1];
  // negative 사례를 가르는 재료는 뒤에 붙은 "도구를 쓸 수 있는지부터 말해줘" 하나뿐이다.
  assert.deepEqual(
    admittedContext(실물기억(x),
      '네이버에서 팔식당 검색해서 플레이스에 있는 후기 분석해줄 수 있어? 도구를 쓸 수 있는지부터 말해줘'),
    [], '원리가 적용되면 안 되는 검증된 상황에 원리가 끼었다',
  );
  // 위 tcell-admission 본 묶음의 아슬아슬 사례도 그대로 막혀 있어야 한다(중복 방어).
  assert.deepEqual(
    admittedContext(기억(), '7월 매출 1200, 비용 800, 신규 14, 이탈 3. 이걸 보고 느낀 점을 요약해줘.'), [],
  );
});

// ③ **무관한 발화에는 안 실린다** — 그물이 안 넓어졌다(이게 없으면 수리가 아니라 파괴다).
test('F-89 ③/입장: 무관한 발화에는 안 실린다 — 그물이 넓어지지 않았다', () => {
  const 무관 = [
    '오늘 점심 뭐 먹을까?',
    '이 코드 리팩터링 좀 해줘',
    '내일 회의 일정 정리해줘',
    '엑셀에서 vlookup 쓰는 법 알려줘',
    '고마워',
  ];
  for (const x of 오너실물) {
    for (const 발화 of 무관) {
      assert.deepEqual(admittedContext(실물기억(x), 발화), [],
        `무관한 발화에 원리가 실렸다: ${x.id.slice(0, 8)} ← ${발화}`);
    }
  }
  // 서로 다른 원리의 영역끼리도 안 넘어간다.
  assert.deepEqual(admittedContext(실물기억(오너실물[0]), '내 컴퓨터에 엑셀 파일 있어?'), []);
  assert.deepEqual(admittedContext(실물기억(오너실물[2]), '네이버 열어서 전세사기 검색 결과 알려줘'), []);
});

// ⑤ 상한 30 이 그대로다 — 프롬프트가 잡음으로 안 찬다.
test('F-89 ⑤/입장: 사용자 사실 상한 30 이 그대로다(무한 성장 금지)', () => {
  const 사실들 = Array.from({ length: 45 }, (_, i) => ({
    candidateId: `f${i}`, kind: 'user_fact', statement: `사실 ${i}`,
    admitted: true, userConfirmed: true, replayPassed: true,
  }));
  const 실린것 = admittedContext({ promoted: 사실들 }, '아무 말');
  assert.equal(실린것.length, 30, '상한이 움직였다 — 프롬프트가 조용히 커진다');
  assert.equal(실린것.at(-1), '사실 44', '넘치면 최근 것을 남긴다');
});

// ⑥ 사용자 사실(`user_fact`)은 예전 그대로 **무조건** 실린다(F-18 계약 불변).
test('F-89 ⑥/입장: 사용자 사실은 발화와 무관하게 그대로 실린다(F-18 불변)', () => {
  const m = {
    promoted: [{
      candidateId: 'uf', kind: 'user_fact', statement: '나는 커피를 마시지 않는다.',
      admitted: true, userConfirmed: true, replayPassed: true,
    }],
  };
  for (const 발화 of ['내가 뭘 마시는지 알아?', '점심 뭐 먹지', '네이버 열어서 검색해줘']) {
    assert.deepEqual(admittedContext(m, 발화), ['나는 커피를 마시지 않는다.'],
      '사용자에 대한 사실이 발화로 걸러졌다');
  }
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
