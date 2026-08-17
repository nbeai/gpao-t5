// 국면 4 슬라이스 1 · **채널 조회 손** — "텔레그램으로 뭐 왔어?" 가 끝나는 자리.
//
// 선빨강(§4-b 1번)의 기계 사실: `node scripts/state-probe.mjs` 「부재 확인」이
//   channel-inbox — 훑은 파일 66 · 생성전용 히트 1 · 모호 0
//   그 히트 1건은 **양성대조** `id: 'telegram.send'@src/surface/demo-context.js:1214` 뿐이고
//   조회 손 검색어 다섯(makeChannelInbox·inboxTool·telegram.inbox·slack.inbox·mail.inbox)은 0건.
// 보내는 손 셋(telegram.send·slack.post·mail.send)은 선언돼 있는데 **받은 것을 꺼내 보는 손이 없다.**
//
// 닫는 문장(선등록 §4):
//   「채널로 들어온 것을 물으면, T5 는 자기가 실제로 보고 있는 채널과 보고 있지 않은 채널을
//    갈라서 답한다.」
//
// ★ 이 손이 **정직해야 하는 이유**(착수 검문 t5-hand-keeper 차단 사유):
//   라이브 텔레그램 기본은 `allowlist_only`(live-context.js:77)다. 그래서 실사용의 다수가
//   게이트에서 걸리고 transcript 에 안 남는다(server.js:4040 이 respond 갈래에서만 push).
//   그 상태에서 「처리한 것」만 목록으로 주면 사용자는 **빠진 게 있는 줄도 모른 채 전부라고 믿는다** —
//   오너가 밟은 `web.collect` 8번 성공 사고와 같은 모양이다. 그래서 이 손은
//   **안 보이는 것을 숫자로라도 말해야** 한다(전례: session-search-tool.js:33-44
//   「대화가 0개인 것과 200개를 뒤져서 없는 것은 완전히 다른 사실이다」).
//
// 경계는 지어내지 않는다 — 같은 재료에 이미 선 경계를 그대로 쓴다(session-search-tool.js:7):
//   「제목·시각·짧은 조각만 돌려준다. 대화 내용을 통째로 옮기지 않는다(내보내기가 아니다).」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeChannelInboxTool } from '../src/runtime/channel-inbox-tool.js';
import { demoDescriptors, demoTools } from '../src/surface/demo-context.js';
import { liveDeps, liveChannels } from '../src/surface/live-context.js';

/**
 * 방마다 따로 사는 세션들. **이것이 원천 ①의 실제 모양이다** —
 * server.js:4104-4115 가 `channel:chatId` → sessionId 를 1:1 로 묶으므로 채널 도착분은
 * **웹 세션이 아니라 그 방 세션에** 쌓인다(server.js:4041).
 */
function 방들() {
  return [
    // 웹에서 물어보는 대화 — 채널 표시 항목이 **하나도 없다**.
    { id: 'web-1', title: '오늘 할 일', updatedAt: 3, transcript: [
      { role: 'user', text: '오늘 할 일 정리해줘' },
      { role: 'assistant', result: { kind: 'reply', reply: '정리했어요.' } },
    ] },
    // 텔레그램 방 — 도착분은 여기 있다.
    { id: 'tg-1', title: '텔레그램 · 사장님', updatedAt: 2, transcript: [
      { role: 'user', text: '내일 회의 자료 준비됐나요?', channel: 'telegram' },
      { role: 'assistant', result: { kind: 'reply', reply: '준비했어요.' } },
      { role: 'user', text: '견적서도 같이 보내줘', channel: 'telegram' },
    ] },
    // 지운 대화는 조회에서 빠진다 — 휴지통이 조회로 되살아나면 "지웠다"가 거짓말이 된다.
    { id: 'tg-지움', title: '지운 방', updatedAt: 1, deletedAt: 9, transcript: [
      { role: 'user', text: '이건 안 나와야 한다', channel: 'telegram' },
    ] },
  ];
}

const 가짜세션저장소 = (rows = 방들()) => ({ async loadAll() { return rows; } });

/** allowlist-store 의 pending 모양 그대로(allowlist-store.js:77-86). */
const 가짜허용목록 = (pending = []) => ({ async listPending() { return pending; } });

/** liveChannels() 가 내는 모양 그대로 — telegram 만 hasReceiver 를 단다(live-context.js:77). */
const 채널들 = () => [
  { id: 'telegram', label: '텔레그램', hasReceiver: true },
  { id: 'slack.channel', label: '슬랙 채널' },
];

const 손세우기 = (opts = {}) => makeChannelInboxTool({
  store: opts.store ?? 가짜세션저장소(),
  allowlist: opts.allowlist ?? 가짜허용목록(),
  channels: opts.channels ?? 채널들,
});

// ── 1. 손이 존재하고 선언된다 ──────────────────────────────────────────────

test('손이 선언에 선다 — 보내는 손만 있던 자리에 받는 손이 생긴다', () => {
  const 선언 = demoDescriptors({});
  const inbox = 선언.find((d) => d.id === 'telegram.inbox');
  assert.ok(inbox, 'telegram.inbox 선언이 없다 — state-probe channel-inbox 부재 그대로다');
  // read 등급이라 승인 카드가 없다(authority.js SAFETY_FLOOR_KINDS 에 read 가 없다).
  // 조회에 카드를 세우면 마찰만 늘고 안전은 안 는다(자동성이 의무다).
  assert.equal(inbox.toolKind, 'read');
  assert.equal(inbox.reversible, true);
  // 양성 대조 — 보내는 손은 원래 서 있었다. 이 자가 눈이 멀지 않았다는 증거.
  assert.ok(선언.find((d) => d.id === 'telegram.send'), '양성대조 실패 — 자를 먼저 의심하라');
});

test('손이 실제로 붙는다 — 선언만 있고 손이 없으면 사용자에게 하는 거짓말이다', () => {
  assert.ok(demoTools({}).tools['telegram.inbox']?.handler, 'demo 손 미배선');
  // ⚠️ 계측 주의: liveDeps 의 손 자리는 `tools.tools` 다(server.js 도 `deps.tools?.tools` 로 읽는다).
  // 첫 판에서 `live.tools[id]` 로 읽어 **없는 결함을 만들 뻔했다** — 자를 먼저 의심하라.
  const live = liveDeps({ TELEGRAM_BOT_TOKEN: 't' }, { sessionStore: { dir: '/tmp/없는자리', async loadAll() { return []; } } });
  assert.ok(live.tools.tools['session.search']?.handler, '양성대조 실패 — 자가 틀렸다');
  assert.ok(live.tools.tools['telegram.inbox']?.handler, 'live 손 미배선');
  // 1축: 라이브 선언 = 라이브에 실제 손이 있는 것. 손이 붙었으면 선언도 서야 한다.
  assert.ok(live.descriptors.some((d) => d.id === 'telegram.inbox'), '손은 붙었는데 선언이 없다');
});

// ── 2. 교차 세션 읽기 — 웹에서 물어도 방에 온 것을 본다 ─────────────────────

test('★ 웹 대화에서 물어도 텔레그램 방 도착분이 나온다 (교차 세션)', async () => {
  // 자기 세션만 읽으면 웹 세션 transcript 엔 channel 항목이 0건이라 「없어요」가 나온다 —
  // 그건 거짓이다. 전례는 session-search-tool.js:30 의 store.loadAll().
  const { result } = await 손세우기().handler({ channel: 'telegram' });
  const 온것 = result.arrived.map((a) => a.snippet).join(' ');
  assert.match(온것, /회의 자료/);
  assert.match(온것, /견적서/);
});

test('지운 대화는 조회에서 빠진다 — 휴지통이 조회로 되살아나지 않는다', async () => {
  const { result } = await 손세우기().handler({ channel: 'telegram' });
  assert.ok(!JSON.stringify(result.arrived).includes('안 나와야 한다'));
});

test('안 온 것을 지어내지 않는다 — 투입 밖 문장은 답에 없다', async () => {
  const { result } = await 손세우기().handler({ channel: 'telegram' });
  assert.ok(!JSON.stringify(result).includes('오늘 할 일'), '웹 대화가 도착분으로 샜다');
});

// ── 3. 경계 — 같은 재료에 두 경계가 서면 안 된다 ────────────────────────────

test('제목·시각·조각만 돌려준다 — 대화 전문을 옮기지 않는다', async () => {
  const { result } = await 손세우기().handler({ channel: 'telegram' });
  for (const 한줄 of result.arrived) {
    assert.ok(한줄.title && 한줄.snippet, '제목·조각 계약 미달');
    // 조각이지 전문이 아니다. 전문을 실으면 조회가 내보내기가 된다.
    assert.ok(한줄.snippet.length <= 120, '조각 상한을 넘었다 — 내보내기가 된다');
    assert.ok(!('transcript' in 한줄) && !('text' in 한줄));
    // ★ 선등록 대비 정정(구현 중 · 결과 보기 전): 선등록은 전례를 따라 「제목·**시각**·조각」이라
    // 적었는데, transcript 항목에는 **시각이 없다**(turn-ref.js stampTurn 이 turnRef 만 심는다).
    // `at` 칸을 만들면 모델이 「몇 시에 왔어요」를 지어낼 자리를 우리가 만드는 것이다.
    // 그래서 도착 시각 칸을 안 만들고, 방이 마지막으로 움직인 시각만 그 이름으로 낸다.
    assert.ok(!('at' in 한줄), '도착 시각인 척하는 칸을 만들면 안 된다 — 그 시각은 없다');
    assert.ok('roomUpdatedAt' in 한줄);
  }
});

// ── 4. ★ 조용한 누락 금지 — 안 보이는 것을 숫자로 말한다 ────────────────────

test('★ 답이 「T5 가 처리한 것 기준」임을 사용자에게 말한다', async () => {
  const { userSafeSummary } = await 손세우기().handler({ channel: 'telegram' });
  assert.match(userSafeSummary, /처리한 것/, '경계 구절이 답에 없다 — 부분 목록이 전부인 척한다');
});

test('★ 게이트가 거절한 분을 **집계로** 말한다 — 조용한 누락이면 실패', async () => {
  const pending = [
    { userId: '111', username: '모르는사람가', firstSeenAt: 1, lastSeenAt: 5, count: 7 },
    { userId: '222', username: '모르는사람나', firstSeenAt: 2, lastSeenAt: 6, count: 5 },
  ];
  const { result, userSafeSummary } = await 손세우기({ allowlist: 가짜허용목록(pending) })
    .handler({ channel: 'telegram' });
  assert.equal(result.unknownSenders.people, 2);
  assert.equal(result.unknownSenders.times, 12);
  assert.match(userSafeSummary, /2명/);
  assert.match(userSafeSummary, /12번/);
});

test('★ 거절분은 **집계만** — 신분(userId·username)은 한 글자도 안 나간다', async () => {
  // 프라이버시 바닥이자 **단일 진실원**이다. 신분 목록에는 이미 전용 표면이 있다
  // (server.js:3801-3808 GET /channels/allowlist). 조회 답에 복제하면 같은 진실이 두 표면에
  // 갈라 앉는다(live-context.js:118 「도구가 서비스 목록을 따로 복제하지 않는다」).
  const pending = [{ userId: '99887766', username: '노출되면안됨', firstSeenAt: 1, lastSeenAt: 2, count: 3 }];
  const 답 = await 손세우기({ allowlist: 가짜허용목록(pending) }).handler({ channel: 'telegram' });
  const 전문 = JSON.stringify(답);
  assert.ok(!전문.includes('99887766'), 'userId 가 샜다');
  assert.ok(!전문.includes('노출되면안됨'), 'username 이 샜다');
});

test('거절분 집계는 20명에서 잘린다는 사실을 답이 감추지 않는다', async () => {
  // allowlist-store.js:86 `list.slice(-20)` — 그 위는 조용히 밀려난다.
  // 「전부」라고 말하면 거짓이 된다.
  const pending = Array.from({ length: 20 }, (_, i) => ({ userId: `u${i}`, count: 1, firstSeenAt: 1, lastSeenAt: 2 }));
  const { result } = await 손세우기({ allowlist: 가짜허용목록(pending) }).handler({ channel: 'telegram' });
  assert.equal(result.unknownSenders.atCap, true, '상한에 닿았다는 사실이 안 실렸다');
});

// ── 5. ★ 보고 있지 않은 채널 — 빈 목록이 아니라 「배선 없음」 ────────────────

test('★ 수신기 없는 채널은 빈 목록이 아니라 「받는 배선이 없다」로 답한다', async () => {
  const { result, userSafeSummary } = await 손세우기().handler({ channel: 'slack.channel' });
  assert.equal(result.hasReceiver, false);
  assert.match(userSafeSummary, /배선|받지 않/, '빈 목록으로 답하면 없는 능력을 있다고 말하는 것이다');
  assert.ok(!/찾지 못했|0건|없어요$/.test(userSafeSummary), '수신기 부재를 「안 왔다」로 답했다');
});

test('liveChannels 가 그 사실의 원천이다 — 손이 채널 목록을 따로 복제하지 않는다', () => {
  const chans = liveChannels({ TELEGRAM_BOT_TOKEN: 't', SLACK_BOT_TOKEN: 's' });
  assert.equal(chans.find((c) => c.id === 'telegram').hasReceiver, true);
  assert.ok(!chans.find((c) => c.id === 'slack.channel').hasReceiver);
});

// ── 6. 음성 대조 — 「없다」와 「못 봤다」를 가른다 ────────────────────────────

test('★ 아무것도 안 온 방에서는 「없다」 + **몇 개를 뒤졌는지**를 말한다', async () => {
  // 전례 session-search-tool.js:33-44 — 0개인 것과 N개를 뒤져서 없는 것은 완전히 다른 사실이다.
  const 빈방들 = [{ id: 'web-1', title: '오늘 할 일', updatedAt: 1, transcript: [{ role: 'user', text: '안녕' }] }];
  const { result, userSafeSummary } = await 손세우기({ store: 가짜세션저장소(빈방들) })
    .handler({ channel: 'telegram' });
  assert.equal(result.arrived.length, 0);
  assert.equal(result.searched, 1);
  assert.match(userSafeSummary, /1개|뒤졌|찾아봤/);
});

// ── 7. 유도인가 강제인가 ────────────────────────────────────────────────────

test('설명문은 **무엇을 돌려주는지**만 적는다 — 「언제 부르라」는 안 적는다', () => {
  // 리트머스(정본 §1-0): 이걸 넣으면 모델이 더 잘 판단하게 되나, 판단을 안 하게 되나?
  // 발동 조건을 박으면 "텔레그램 확인해줘"·"연락 온 거 있어?"·"누가 뭐래?" 를 다 놓친다
  // (헤르메스 verify_on_stop 전례). 전례는 session.search 의 설명 규율이다.
  const d = demoDescriptors({}).find((x) => x.id === 'telegram.inbox');
  const 설명 = `${d.schema.description} ${d.capability ?? ''}`;
  assert.ok(!/라고 하면|말하면|물으면 이 손을|호출하라/.test(설명), '발동 조건을 박았다 — 강제다');
  assert.match(설명, /처리한 것|돌려준다|보여준다/);
});
