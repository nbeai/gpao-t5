// **F-58 봉인 — 승인 기억의 열쇠는 손이 아니라 상대·내용이다** (PM 승인 2026-08-09).
//
// F-53 이 남긴 절반. 채널 손은 `counterpartKnown`(헌장 ③ — 아는 상대엔 안 묻는다)이
// 계약으로 서 있는데, **그 조건을 세우는 배선이 아예 없었고** 화면 경유 전송은 kind 가
// `UNKNOWN_KIND` 라 조건에 닿지도 못했다. 그래서 같은 "카톡에 이 말 보내기"가 채널로는
// 한 번만 묻고 화면으로는 매번 물었다 — **사거리 비대칭병**(사용자에겐 같은 일이다).
//
// 반대시험을 먼저 둔다: 이 수리는 **카드를 줄이는 방향**이라 안전 축을 건드린다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActionPlan } from '../src/kernel/l2-plan/action-plan.js';
import { makeDesktopActTool, 발신실질 } from '../src/runtime/desktop-act-tool.js';
import { demoContext } from '../src/surface/demo-context.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';

const 보내기인자 = (내용 = '지파오가 테스트 중입니다.', 방 = 'n.BEAI 사일런트서비스') => ({
  action: 'type', app: '카카오톡', 창제목: 방,
  대상: { 토큰: 's1:9', label: '메시지 입력' },
  기대: { 요소: '대화 입력', 값: 내용, 바깥으로: true },
});
const 손 = makeDesktopActTool({ drivers: [] });
// 선언과 손을 **같은 opts** 에서 세운다(demoContext) — env 만 따로 만들면 desktop.act 가
// 실행 가능으로 안 잡혀 계획에 아예 안 오른다(F-54 검사에서 밟은 함정 그대로).
const 계획 = (인자, known = []) => {
  const selfState = buildSelfState(demoContext({ desktopAct: 손 }).env);
  return buildActionPlan({
    selfState,
    knownCounterparts: new Set(known),
    intent: {
      currentRequest: '카톡에 보내줘',
      neededTools: ['desktop.act'],
      toolArgs: { 'desktop.act': 인자 },
      toolPreviews: { 'desktop.act': 손.previewOf(인자) },
    },
  });
};
const 카드떴나 = (plan) => (plan.needsApproval ?? []).length > 0;
const 열쇠 = (인자) => 손.previewOf(인자).발신실질;

// ── 반대시험 다섯 (안전이 안 풀린다) ──────────────────────────────────────
test('반대 ①: 새 상대면 카드 — 아무도 허락한 적 없는 방', () => {
  assert.equal(카드떴나(계획(보내기인자())), true, '**새 상대에게 카드 없이 나간다** — 헌장 ③ 붕괴');
});

test('반대 ②: 상대는 같아도 문구가 다르면 카드 — 내용도 열쇠의 일부(PM 판정)', () => {
  const 아는것 = [열쇠(보내기인자('첫 문장'))];
  assert.equal(카드떴나(계획(보내기인자('전혀 다른 문장'), 아는것)), true,
    '**허락한 적 없는 문구가 조용히 나간다** — 화면 전송은 오클릭 위험이 있어 내용도 묻는다');
});

test('반대 ③: 창 제목에 안 읽음 배지가 붙으면 신분 불성립 → 카드 (fail-closed · PM 조건 ②)', () => {
  for (const 방 of ['n.BEAI 사일런트서비스 4', 'TNT(The Next Table) (12)', '단톡방 [3]']) {
    assert.equal(발신실질('카카오톡', 방, '문장'), null, `배지가 섞인 제목으로 신분을 만들었다: ${방}`);
    assert.equal(카드떴나(계획({ ...보내기인자('문장', 방) })), true, `배지 제목인데 카드가 안 뜬다: ${방}`);
  }
});

test('반대 ④: 창 제목에 본문 미리보기가 섞이면 신분 불성립 → 카드', () => {
  for (const 방 of ['n.BEAI 사일런트서비스: 넵 명심하겠습니다', '단톡 — 내일 봬요', '방 | 확인 부탁드립니다']) {
    assert.equal(발신실질('카카오톡', 방, '문장'), null, `미리보기가 섞인 제목으로 신분을 만들었다: ${방}`);
  }
  // 비었거나 지나치게 긴 제목도 신분이 아니다 — 제목이 아니라 본문일 것이다.
  assert.equal(발신실질('카카오톡', '', '문장'), null);
  assert.equal(발신실질('카카오톡', 'ㅁ'.repeat(61), '문장'), null);
  assert.equal(발신실질('카카오톡', '방', ''), null, '보낼 내용이 없는데 신분을 만들었다');
});

test('반대 ⑤: 좌표로 짚은 미상 걸음은 카드 없이 실행 제외된다', () => {
  const 좌표 = { ...보내기인자(), action: 'click', 대상: { x: 100, y: 200 } };
  const 아는것 = [열쇠(보내기인자())];
  const p = 계획(좌표, 아는것);
  assert.equal(카드떴나(p), false);
  assert.ok(p.authorityDeferred.some((x) => x.disposition === 'observe'));
});

// ── 정방향: 같은 상대·같은 내용 두 번째는 조용하다 ────────────────────────
test('정방향: 사용자가 한 번 허락한 상대·내용은 두 번째에 안 묻는다', () => {
  const 인자 = 보내기인자();
  const 첫판 = 계획(인자);
  assert.equal(카드떴나(첫판), true, '첫 발신은 카드다');
  const 카드 = (첫판.needsApproval ?? [])[0];
  assert.ok(카드?.상대열쇠, '카드가 상대 열쇠를 안 들고 있다 — 승인해도 기억할 것이 없다');

  const 둘째판 = 계획(인자, [카드.상대열쇠]);
  assert.equal(카드떴나(둘째판), false,
    '**같은 방·같은 문구인데 또 묻는다** — 사거리 비대칭병 그대로다');
});

test('보여 준 것과 기억하는 것이 같다 (PM 조건 ①) — 카드 impact 의 상대·내용이 곧 열쇠', () => {
  const 인자 = 보내기인자('지파오가 테스트 중입니다.', 'n.BEAI 사일런트서비스');
  const 카드 = (계획(인자).needsApproval ?? [])[0];
  const impact = String(카드?.approvalPreview?.impact ?? 카드?.preview?.impact ?? '');
  const 키 = String(카드?.상대열쇠 ?? '');
  assert.match(impact, /카카오톡/); assert.match(impact, /n\.BEAI 사일런트서비스/);
  assert.match(impact, /지파오가 테스트 중입니다/);
  // 열쇠의 세 조각이 **카드에 실제로 표시된 그것**이어야 한다 — 별도 유도 라벨이 아니다.
  for (const 조각 of ['카카오톡', 'n.beai 사일런트서비스', '지파오가 테스트 중입니다.']) {
    assert.ok(키.toLowerCase().includes(조각.toLowerCase()),
      `**카드는 A 를 보여 주고 기억은 B 로 저장한다** — 승인한 것과 조용해지는 것이 어긋난다: ${키}`);
  }
});

// ── **실경로 관통 봉인**(PM 지시 2026-08-09) ─────────────────────────────────
//
// 부품 봉인 7개가 초록인데 **실전이 빨갰다** — 봉인이 잘못된 곳에 서 있었다는 뜻이다.
// F-59 계열(계약은 있는데 배선 0)의 수리는 부품 레인이 아니라 **사용자 경로 전체**를
// 관통해서 물어야 한다: 모델이 손을 고르고 → 걸음 루프가 계획을 세우고 → 카드가 뜨고 →
// 사용자가 승인하고 → 그 승인이 상대를 기억하고 → **다음 요청에서 카드가 사라진다.**
//
// (첫 리허설의 미달은 제품이 아니라 **검사 하네스**였다: 턴마다 새 ctx 를 만들어
//  pending·knownCounterparts 가 안 이어졌다. 한 대화는 한 ctx 다 — 그 사실도 여기 박는다.)
test('실경로: 승인 한 번 → 같은 방·같은 문구 두 번째는 카드 없이 실행된다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 보내기 = {
    action: 'type', app: '카카오톡', 창제목: 방,
    대상: { 토큰: 's1:9', label: '메시지 입력' },
    기대: { 요소: '대화 입력', 값: 문구, 바깥으로: true },
  };
  const 드라이버 = {
    id: 'cua', label: '화면(가짜)',
    async status() { return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } }; },
    async observe() {
      return { frontmost: { name: '카카오톡' },
        본창: { id: 9, pid: 7, app: '카카오톡', title: 방, bounds: { x: 0, y: 0, w: 430, h: 664 } },
        elements: [{ id: 'e9', 토큰: 's1:9', element_token: 's1:9', role: 'AXTextArea', label: '메시지 입력' }] };
    },
    async act() { return { effect: 'confirmed' }; },   // 실제로는 아무 데도 안 보낸다
  };
  // **한 대화 = 한 ctx** — pending 과 아는 상대를 세션 내내 이어간다.
  const ctx = {
    ...demoContext({ desktopAct: makeDesktopActTool({ drivers: [드라이버] }) }),
    knownCounterparts: new Set(),
    pending: new Map(),
    model: {
      낸것: 0,
      async respond(tc) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        this.낸것 += 1;
        // 사용자가 보내라고 한 턴에서만 손을 고른다(승인 재개 턴은 커널이 이어받는다).
        return tc?.currentRequest?.includes('보내')
          ? { text: '', toolCalls: [{ providerCallId: `p${this.낸것}`, name: 'desktop.act', args: 보내기 }] }
          : { text: '알겠어.' };
      },
    },
  };

  const 첫 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 보내줘` }, ctx);
  assert.equal(첫.kind, 'approval', '첫 발신이 카드 없이 나갔다 — 헌장 ③ 붕괴');
  const 카드 = (첫.pending ?? [])[0];
  assert.match(String(카드?.preview?.impact ?? ''), /n\.BEAI 사일런트서비스/, '카드가 상대를 안 보여 준다');

  const 승인 = await runTurn({ approve: 첫.pendingId }, ctx);
  assert.notEqual(승인.kind, 'approval', '승인했는데 또 카드다');
  assert.equal(ctx.knownCounterparts.size, 1,
    `**승인이 상대를 기억하지 않았다** — 배선이 실경로에서 끊겼다(부품 봉인만으론 못 잡는 자리): ${[...ctx.knownCounterparts]}`);

  const 둘째 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 한 번 더 보내줘` }, ctx);
  assert.notEqual(둘째.kind, 'approval',
    '**같은 방·같은 문구인데 또 물었다** — 사거리 비대칭병 그대로다');
  assert.ok((둘째.turnExchange ?? []).some((x) => x.tool === 'desktop.act'),
    `두 번째가 조용하긴 한데 **손이 안 돌았다** — 카드만 사라지고 일이 안 되면 수리가 아니다: ${JSON.stringify((둘째.turnExchange ?? []).map((x) => x.tool))}`);
});

// ── **실경로 관통 ② — 모델이 신고를 안 해도 실질이 같으면 아는 상대다** (PM 판정 (가) · 2026-08-09) ──
//
// 실물 회차 미달의 원장: 첫 발신의 카드 넷 중 **하나만** "…보내기"(`기대.바깥으로`)였고,
// 두 번째 턴의 걸음은 *"메시지 입력 에 글자 넣기"* — **전송으로 신고되지 않아** 헌장 ③ 조건에
// 닿지도 못했다. 열쇠가 **모델의 자기 신고**에 달려 있었던 것이다: 같은 일(같은 방·같은 문구)
// 인데 부르는 모양에 따라 마찰이 갈렸다 — 사거리 비대칭병이 **같은 손 안**에 남아 있었다.
//
// (나)(모델이 매번 같게 신고하게 만든다)는 기각됐다 — "모델은 같은 답을 낼 수 없다"(오너)에
// 반하고 문구 층 금지와 충돌한다. (가): **기계가 이미 아는 현실**(어느 앱·어느 방·무슨 내용)로
// 실질을 세운다. 안전은 조여지는 방향이다 — 카드가 줄어드는 자리는 **이미 허락한 방·문구**
// 한 곳뿐이고, 새 상대·새 내용·모호한 실질은 그대로 카드다(fail-closed 불변).
test('실경로 ②: 두 번째를 신고 없이 불러도 카드가 없다 — 같은 방·같은 문구면 아는 상대', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 신고함 = {
    action: 'type', app: '카카오톡', 창제목: 방,
    대상: { 토큰: 's1:9', label: '메시지 입력' },
    기대: { 요소: '대화 입력', 값: 문구, 바깥으로: true },
  };
  // **실물이 낸 그 모양** — 같은 일인데 `바깥으로` 신고가 없다(회차 원장의 ② 카드).
  const 신고없음 = {
    action: 'type', app: '카카오톡', 창제목: 방,
    대상: { 토큰: 's1:9', label: '메시지 입력' },
    값: 문구,
  };
  const 드라이버 = {
    id: 'cua', label: '화면(가짜)',
    async status() { return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } }; },
    async observe() {
      return { frontmost: { name: '카카오톡' },
        본창: { id: 9, pid: 7, app: '카카오톡', title: 방, bounds: { x: 0, y: 0, w: 430, h: 664 } },
        elements: [{ id: 'e9', 토큰: 's1:9', element_token: 's1:9', role: 'AXTextArea', label: '메시지 입력' }] };
    },
    async act() { return { effect: 'confirmed' }; },
  };
  const ctx = {
    ...demoContext({ desktopAct: makeDesktopActTool({ drivers: [드라이버] }) }),
    knownCounterparts: new Set(),
    pending: new Map(),
    model: {
      // **전역 카운터로 세면 안 된다**(이 대본의 첫 판이 그랬다): 승인 재개 턴도 모델을
      // 여러 번 부른다(재개 실행·답완성·출구 검증). 전역으로 세면 턴 2 차례가 그 사이에
      // 소진돼 손을 낼 기회가 지나가고, 검사는 제품이 아니라 대본을 잰다. 턴 기준으로 센다.
      첫턴손냈나: false, 둘째낸것: 0,
      async respond(tc) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        const req = String(tc?.currentRequest ?? '');
        if (!req.includes('보내')) return { text: '알겠어.' };
        if (tc?.answerOnly) return { text: '보냈어.' };
        if (!req.includes('한 번 더')) {
          // 턴 1(과 그 승인 재개): 신고하고 한 번 부르고, 그 뒤는 마무리 말만.
          if (this.첫턴손냈나) return { text: '보냈어.' };
          this.첫턴손냈나 = true;
          return { text: '', toolCalls: [{ providerCallId: 'p1', name: 'desktop.act', args: 신고함 }] };
        }
        // **두 번째 턴은 실물 모양 그대로**(격리 리허설 원장 2026-08-09): 화면을 먼저 보고,
        // 그 다음 걸음(**걸음 경로**)에서 신고 없이 type 을 낸다. act 를 첫 호출로 내면
        // 계획 경로로 가서 이 검사가 걸음 경로의 증발(F-20 계열)을 영영 못 문다 —
        // 실물에서 정확히 그 자리(승인 분기 grants 빈손 break)로 걸음이 사라졌다.
        this.둘째낸것 += 1;
        if (this.둘째낸것 === 1) return { text: '', toolCalls: [{ providerCallId: 'p2', name: 'desktop.screen', args: { action: 'observe', scope: 'window', app: '카카오톡' } }] };
        if (this.둘째낸것 === 2) return { text: '', toolCalls: [{ providerCallId: 'p3', name: 'desktop.act', args: 신고없음 }] };
        return { text: '다시 보냈어.' };
      },
    },
  };

  const 첫 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 보내줘` }, ctx);
  assert.equal(첫.kind, 'approval', '첫 발신이 카드 없이 나갔다');
  await runTurn({ approve: 첫.pendingId }, ctx);
  assert.equal(ctx.knownCounterparts.size, 1, '승인이 상대를 기억하지 않았다');

  const 둘째 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 한 번 더 보내줘` }, ctx);
  assert.notEqual(둘째.kind, 'approval',
    '**신고를 안 했다는 이유로 같은 방·같은 문구에 또 물었다** — 열쇠가 모델 신고에 달려 있다(실물 미달의 그 자리)');
  assert.ok((둘째.turnExchange ?? []).some((x) => x.tool === 'desktop.act'),
    '**카드도 없이 손도 안 돌았다** — 걸음이 조용히 증발했다(경계 "승인 필요" vs 계획 "자동"의 어긋남 · F-20 계열)');
});

// ── 안전 대차 — (가)로 넓어지는 자리는 하나뿐임을 증명한다 (PM 조건 ②) ──────
test('안전 대차: 카드가 줄어드는 곳은 「아는 방·아는 문구」 하나뿐 — 나머지는 전부 카드 유지', () => {
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 신고없이 = (창, 값) => ({ action: 'type', app: '카카오톡', 창제목: 창, 대상: { 토큰: 's1:9', label: '메시지 입력' }, 값 });
  const 아는것 = [발신실질('카카오톡', 방, 문구)];
  const 표 = [
    ['아는 방 · 아는 문구', 신고없이(방, 문구), false],            // ← 유일하게 줄어드는 자리
    ['아는 방 · 새 문구', 신고없이(방, '전혀 다른 말'), false],
    ['새 방 · 아는 문구', 신고없이('다른 대화방', 문구), false],
    ['배지 섞인 방 이름(실질 모호)', 신고없이(`${방} 4`, 문구), false],
    ['미리보기 섞인 방 이름(실질 모호)', 신고없이(`${방}: 넵 명심하겠습니다`, 문구), false],
    ['내용 없음(실질 모호)', 신고없이(방, ''), false],
  ];
  for (const [이름, 인자, 카드여야] of 표) {
    assert.equal(카드떴나(계획(인자, 아는것)), 카드여야,
      `**안전 대차가 깨졌다** — "${이름}" 에서 카드 ${카드여야 ? '가 사라졌다' : '가 남았다'}`);
  }
});

// ── **실질의 창은 모델 신고가 아니라 탐침이 본 창이다** (F-58 (가-2) 리허설 실측 · 2026-08-09) ──
//
// 격리 리허설 2차(실모델 gpt-5.1)가 잡았다: 모델이 `창제목`·`app` 을 **비우는 회차**가 실재하고,
// 그때 열쇠가 못 서 같은 방·같은 문구 두 번째에도 카드가 떴다(리허설기록 원본). 열쇠를 신고에서
// 떼는 것이 (가-2)인데 **창만 신고에 남아 있었다.** 탐침이 실제로 본 창(`본창`)이 실질의 창이다.
test('신고 없는 type 도 탐침의 본창으로 열쇠가 선다 — 창제목·app 을 비운 그 모양', () => {
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const pv = 손.previewOf({
    action: 'type', 대상: { 토큰: 's1:9', label: '메시지 입력' }, 값: 문구,
    눌러본사실: { 찾음: true, 값있음: true, 본창: { app: '카카오톡', 제목: 방 } },
  });
  assert.equal(pv.발신실질, 발신실질('카카오톡', 방, 문구),
    `**모델이 창을 안 적으면 열쇠가 없다** — 실질이 신고에 달려 있다: ${pv.발신실질}`);
});

// 계약 갱신(PM 조건 ① · 2026-08-10): 엔터 열쇠 재료는 **탐침이 읽은 칸 내용만**이다 —
// 신고(기대.값)는 재료가 아니다. 리허설 실측: 신고만 하고 값을 비우는 회차(열쇠 불성립 →
// 매번 카드)와, 신고값 ≠ 칸내용(카드 A·실행 B 어긋남 — F-62)이 둘 다 실재했다.
test('엔터 열쇠는 신고가 아니라 칸 내용이다 — 빈 신고값·다른 신고값 모두 기계가 이긴다', () => {
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 본창 = { app: '카카오톡', 제목: 방 };
  // ① 신고만 하고 값을 비운 그 모양(리허설 카드 "return 누르기") — 칸 내용으로 열쇠가 선다.
  const 빈신고 = 손.previewOf({
    action: 'press_key', 값: 'return', 기대: { 요소: '전송', 바깥으로: true },
    눌러본사실: { 찾음: false, 본창, 칸내용: 문구 },
  });
  assert.equal(빈신고.발신실질, 발신실질('카카오톡', 방, 문구),
    `빈 신고값에서 열쇠가 못 선다 — 같은 방·같은 문구의 전송이 매번 카드가 된다: ${빈신고.발신실질}`);
  assert.match(String(빈신고.impact), /지파오가 테스트 중입니다/, '카드가 실제 나갈 내용을 안 보여 준다');
  // ② 신고값이 칸 내용과 달라도 **기계가 읽은 그 내용**이 카드·열쇠다(F-62 를 엔터에서 닫음).
  const 다른신고 = 손.previewOf({
    action: 'press_key', 값: 'return', 기대: { 값: '전송됨', 바깥으로: true },
    눌러본사실: { 찾음: false, 본창, 칸내용: 문구 },
  });
  assert.equal(다른신고.발신실질, 발신실질('카카오톡', 방, 문구),
    `신고값이 열쇠 재료가 됐다 — 카드가 A 를 보여 주고 엔터가 B 를 보낸다: ${다른신고.발신실질}`);
  // ③ 칸 내용을 못 읽었으면 신고가 있어도 열쇠가 없다 — fail-closed(매번 카드).
  const 못읽음 = 손.previewOf({
    action: 'press_key', 값: 'return', 기대: { 값: 문구, 바깥으로: true },
    눌러본사실: { 찾음: false, 본창 },
  });
  assert.equal(못읽음.발신실질, undefined, '칸 내용 없이 신고값으로 열쇠를 만들었다 — PM 조건 ① 위반');
});

test('본창이 있어도 좌표 걸음에는 열쇠가 없다 — 그 규율은 그대로다', () => {
  const pv = 손.previewOf({
    action: 'type', 대상: { x: 100, y: 200 }, 값: '문장',
    기대: { 값: '문장', 바깥으로: true },
    눌러본사실: { 찾음: true, 값있음: true, 본창: { app: '카카오톡', 제목: '방이름' } },
  });
  assert.equal(pv.발신실질, undefined,
    '**눈으로 본 자리에 열쇠가 생겼다** — 이름 없는 자리는 약속할 수 없다(오너 2026-08-06)');
});

test('탐침이 press_key 에서 창 신분을 들고 온다 — 요소는 안 찾는다(등급 불변)', async () => {
  const 손2 = makeDesktopActTool({
    drivers: [{
      id: 'f', status: () => ({ permissions: { accessibility: 'granted' } }),
      observe: () => ({
        frontmost: { name: 'K' }, windows: [{ id: 9, pid: 77 }],
        본창: { id: 9, app: '카카오톡', title: '박종윤', pid: 77 }, elements: [],
      }),
      act: () => ({ ok: true }),
    }],
  });
  const r = await 손2.probe({ action: 'press_key', app: '카카오톡', 값: 'return' });
  assert.equal(r?.찾음, false, '요소를 찾은 척했다 — 창 신분만 보는 걸음이다');
  assert.deepEqual(r?.본창, { app: '카카오톡', 제목: '박종윤' },
    `탐침이 본 창이 사실로 안 남는다: ${JSON.stringify(r)}`);
});

// ── **실경로 ③ — 미신고 엔터도 칸 내용(기계 사실)으로 아는 상대다** (PM 판정 (a) · 2026-08-10) ──
//
// 리허설 9~10판의 잔여 빨강 한 칸: 모델이 엔터를 `바깥으로` 신고 없이 내면 미상 등급이라
// 같은 방·같은 문구 두 번째에도 `return 누르기` 카드가 남았다. PM 판정: **탐침이 그 칸의
// 실제 내용을 읽으면 그 걸음은 더 이상 미상이 아니다** — (가-2)가 type 에 한 일(신고 대신
// 기계 사실로 신분)을 엔터 걸음에 마저 한다. 열쇠 재료는 탐침이 읽은 칸 내용만이고
// 모델 신고(기대.값)는 재료가 아니다(조건 ①). 못 읽으면 카드(조건 ② fail-closed).
test('실경로 ③: 미신고 엔터도 칸 내용으로 아는 상대 — 두 번째는 카드 없이 type·엔터가 다 돈다', async () => {
  const { runTurn } = await import('../src/kernel/turn.js');
  const { demoContext } = await import('../src/surface/demo-context.js');
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 신고함 = {
    action: 'type', app: '카카오톡', 창제목: 방,
    대상: { 토큰: 's1:9', label: '메시지 입력' },
    기대: { 요소: '대화 입력', 값: 문구, 바깥으로: true },
  };
  const 미신고type = {
    action: 'type', app: '카카오톡', 창제목: 방,
    대상: { 토큰: 's1:9', label: '메시지 입력' }, 값: 문구,
  };
  // **실물 회차의 그 모양** — 엔터를 신고 없이 낸다(리허설 9~10판 원장의 남은 카드).
  const 미신고엔터 = { action: 'press_key', app: '카카오톡', 창제목: 방, 값: 'return' };
  const 행동들 = [];
  const 드라이버 = {
    id: 'cua', label: '화면(가짜)',
    async status() { return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } }; },
    async observe() {
      return { frontmost: { name: '카카오톡' },
        본창: { id: 9, pid: 7, app: '카카오톡', title: 방, bounds: { x: 0, y: 0, w: 430, h: 664 } },
        // 값이 실린 글자칸 하나 — 탐침이 읽을 기계 사실이다(둘이면 모호 → 카드가 맞다).
        elements: [{ id: 'e9', 토큰: 's1:9', element_token: 's1:9', role: 'AXTextArea', label: '메시지 입력', value: 문구 }] };
    },
    async act(r) { 행동들.push(String(r?.행동 ?? r?.action ?? '')); return { effect: 'confirmed' }; },
  };
  const ctx = {
    ...demoContext({ desktopAct: makeDesktopActTool({ drivers: [드라이버] }) }),
    knownCounterparts: new Set(),
    pending: new Map(),
    model: {
      첫턴손냈나: false, 둘째낸것: 0,
      async respond(tc) {
        if (tc?.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'chat' } }] };
        const req = String(tc?.currentRequest ?? '');
        if (!req.includes('보내')) return { text: '알겠어.' };
        if (tc?.answerOnly) return { text: '보냈어.' };
        if (!req.includes('한 번 더')) {
          if (this.첫턴손냈나) return { text: '보냈어.' };
          this.첫턴손냈나 = true;
          return { text: '', toolCalls: [{ providerCallId: 'q1', name: 'desktop.act', args: 신고함 }] };
        }
        this.둘째낸것 += 1;
        if (this.둘째낸것 === 1) return { text: '', toolCalls: [{ providerCallId: 'q2', name: 'desktop.screen', args: { action: 'observe', scope: 'window', app: '카카오톡' } }] };
        if (this.둘째낸것 === 2) return { text: '', toolCalls: [{ providerCallId: 'q3', name: 'desktop.act', args: 미신고type }] };
        if (this.둘째낸것 === 3) return { text: '', toolCalls: [{ providerCallId: 'q4', name: 'desktop.act', args: 미신고엔터 }] };
        return { text: '다시 보냈어.' };
      },
    },
  };

  const 첫 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 보내줘` }, ctx);
  assert.equal(첫.kind, 'approval', '첫 발신은 카드다');
  await runTurn({ approve: 첫.pendingId }, ctx);
  assert.equal(ctx.knownCounterparts.size, 1, '승인이 상대를 기억하지 않았다');

  const 둘째 = await runTurn({ text: `카톡 "${방}" 에 "${문구}" 한 번 더 보내줘` }, ctx);
  assert.notEqual(둘째.kind, 'approval',
    '**미신고 엔터가 또 물었다** — 기계가 칸 내용을 아는데 걸음이 미상으로 남아 있다(리허설 잔여 빨강 그 칸)');
  const 돈행동 = (둘째.turnExchange ?? []).filter((x) => x.tool === 'desktop.act').length;
  assert.equal(돈행동, 2,
    `type 과 엔터가 둘 다 돌아야 한다(카드만 사라지면 수리가 아니다): desktop.act ${돈행동}회 · 드라이버 ${JSON.stringify(행동들)}`);
});

// ── 안전 대차 추가 두 행 (PM 조건 ③ · 2026-08-10) — 엔터 열쇠의 fail-closed ──────
test('안전 대차(엔터): 칸 내용이 승인 내용과 다르면 카드 · 못 읽으면 카드', () => {
  const 방 = 'n.BEAI 사일런트서비스';
  const 문구 = '지파오가 테스트 중입니다.';
  const 아는것 = [발신실질('카카오톡', 방, 문구)];
  const 엔터 = (눌러본사실) => ({
    action: 'press_key', app: '카카오톡', 창제목: 방, 값: 'return',
    ...(눌러본사실 ? { 눌러본사실 } : {}),
  });
  const 본창 = { app: '카카오톡', 제목: 방 };
  const 표 = [
    ['칸 내용 = 승인 내용', 엔터({ 찾음: false, 본창, 칸내용: 문구 }), false],   // ← 유일하게 조용한 행
    ['칸 내용 ≠ 승인 내용', 엔터({ 찾음: false, 본창, 칸내용: '전혀 다른 말' }), true],
    ['칸 내용 못 읽음', 엔터({ 찾음: false, 본창 }), false],
    ['탐침 자체가 빈손', 엔터(undefined), false],
  ];
  for (const [이름, 인자, 카드여야] of 표) {
    assert.equal(카드떴나(계획(인자, 아는것)), 카드여야,
      `**안전 대차(엔터)가 깨졌다** — "${이름}" 에서 카드 ${카드여야 ? '가 사라졌다' : '가 남았다'}`);
  }
});
