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

test('반대 ⑤: 좌표로 짚은 걸음은 여전히 미상 — 그 규율은 손대지 않았다', () => {
  const 좌표 = { ...보내기인자(), action: 'click', 대상: { x: 100, y: 200 } };
  const 아는것 = [열쇠(보내기인자())];
  assert.equal(카드떴나(계획(좌표, 아는것)), true,
    '**눈으로 본 자리가 조용히 나간다** — 이름 없는 자리는 약속할 수 없다(오너 2026-08-06)');
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
