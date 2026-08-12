// **F-110 · 예약된 손은 수단을 바꿀 수 없었다** (선빨강)
//
// ── 손 관리자 판정 (2026-08-13 · 착수 직전 소집) ────────────────────────────
// > *"자동화는 영역이 아니라 **시간축의 봉투**이고, 그 안에서 서는 것은 파일 손·웹 손이다.
// > 이건 로봇팔을 손으로 바꾸는 일이 아니라 **「모든 손이 자동화 안에서도 손이게」** 하는 일이다."*
//
// 그가 준 요구 폭 여덟 칸 중 이번에 덮는 것은 **④ 첫 수단이 막히면 다른 수단** 한 칸이다.
// 그리고 그 한 칸을 열면 **⑤ 여러 단계**가 즉시 드러난다고 적었다 —
// *"도구를 넓히고 kind 를 안 넓히면 넓힌 손은 장식이다."*
//
// ── 지금 무엇이 막고 있나 — 세 곳이 한 몸으로 잠겨 있다 ─────────────────────
// ```
// automation-contracts.js:305   직접예약담당 → toolAllowlist: [tool]
// automation-contracts.js:180   bindAutomationCandidate → allowedTools: [tool] · allowedKinds: [kind]
// agent-runner.js:212-220       둘이 다르면 실행 진입에서 던진다
//                               ('child_tools_outside_canonical_allowlist')
// canonical-automation-runtime.js:161-162
//                               도구표 자체를 그 하나로 잘라서 모델에게 준다
//                               → 다른 손은 「막혔다」가 아니라 **안 보인다**
// ```
// 그래서 예약이 도는 순간 모델 앞에는 손이 **하나뿐**이다. 그 하나가 빈손으로 돌아와도
// 갈아탈 것이 없다. 대화에서는 되는 일이 예약에서는 안 된다.
//
// ── 넓히는 축은 tier 다. 도구 목록이 아니다 ────────────────────────────────
// 손 관리자: *"헌장이 요구한 문은 넷뿐이다(비밀·파괴·새 상대·돈). **도구 이름 고정은
// 헌장에 없는 다섯째 문이다.** A0·A1(읽기·관측) 계열로 넓히는 것은 충돌하지 않는다.
// 충돌하는 것은 A2 이상까지 자동으로 넓히는 경우다."*
//
// 그래서 **관측 손만** 더한다(`toolKind==='read'` · 승인 불필요 · A0):
// `web.search`·`web.collect`·`local.locate`·`local.discovery`·`local.system`·
// `session.search`·`browser.observe`.
// **빼는 둘**: `agent.delegate`(예약 안에서 자식을 또 띄우는 재귀) ·
// `browser.act`(분류는 read 지만 실제로 화면을 만진다).
//
// ── 그리고 승인면이 같이 정직해야 한다 ─────────────────────────────────────
// 손 관리자: *"승인면에 무엇이 보이는지를 같이 안 고치면, 이건 유도가 아니라 **몰래
// 넓히기**다. 이 한 줄이 이번 수리의 유일한 헌장 리스크다."*
// 승인 카드는 담당 프로필 이름을 보여준다(`web/index.html`). 그 이름과 목적이
// 「무엇을 할 수 있는 역할인지」를 그대로 말해야 한다.
import assert from 'node:assert/strict';
import test from 'node:test';

import { 직접예약담당, bindAutomationCandidate } from '../src/kernel/l5-growth/automation-contracts.js';

const 관측손 = ['web.search', 'web.collect', 'local.locate', 'local.discovery',
  'local.system', 'session.search', 'browser.observe'];

const 담당 = () => 직접예약담당({
  tool: 'local.file',
  ceiling: 'A0',
  workspaceRoots: ['/집'],
  now: 1_786_000_000_000,
  관측손,
});

// ── ① 첫 수단 옆에 갈아탈 손이 선다 ─────────────────────────────────────────
test('F110 ①: 예약 담당이 **첫 수단 말고도 관측 손을 쥔다** — 하나뿐이면 갈아탈 데가 없다', () => {
  const p = 담당();
  assert.ok(p.toolAllowlist.includes('local.file'), '첫 수단이 빠졌다');
  const 더쥔것 = p.toolAllowlist.filter((t) => t !== 'local.file');
  assert.ok(더쥔것.length >= 3,
    `**예약이 손을 ${p.toolAllowlist.length}개만 쥔다** — 그 하나가 빈손으로 돌아오면 `
    + '갈아탈 것이 없다. 대화에서는 되는 일이 예약에서는 안 된다');
  assert.ok(p.toolAllowlist.includes('local.locate'),
    '찾는 손이 없다 — 「그 폴더가 어디 있지?」를 물을 수단이 없으면 경로 하나가 틀리는 순간 끝이다');
});

// ── ② 넓히는 상한은 tier 다 ─────────────────────────────────────────────────
test('F110 ②: **조작하는 손은 안 준다** — 사용자가 없는 자리다', () => {
  const p = 담당();
  for (const 금지 of ['agent.delegate', 'browser.act', 'desktop.act', 'mail.send', 'slack.post']) {
    assert.ok(!p.toolAllowlist.includes(금지),
      `**${금지} 가 예약 봉투에 들어갔다** — 사용자가 없는 시각에 도는 자리다. `
      + '관측 손(A0)까지가 헌장이 허락한 폭이고, 그 위는 사람이 있을 때의 일이다');
  }
});

// ── ③ kind 를 안 넓히면 넓힌 손은 장식이다 ──────────────────────────────────
//
// 손 관리자 지적 그대로: 손을 여럿 줘도 `allowedKinds:[kind]` 가 남아 있으면
// 「목록 본 뒤 그 파일을 읽기」조차 `agent_tool_kind_outside_scope` 로 막힌다.
// **③ 은 한 번 되돌렸다가 다시 닫았다**(2026-08-13).
//
// 처음엔 프로필의 폭을 그대로 봉투에 담았다가 **tick 이 통째로 죽었다** — `agent-runner.js:217`
// 이 `boundedChildToolAllowlist`(그 순간 실재하는 손으로 좁힌 결과)와 봉투를 **같은지** 보는데
// 봉투가 더 넓으면 던진다. 성장 자동화 검사 셋이 빨개졌고, 되던 것을 깼으므로 되돌렸다.
//
// 두 번째 길이 옳았다 — **같은 함수로 미리 거른다.** 「명시 예약이면 넓힌다」 같은 짐작으로
// 가르지 않는다(그 짐작도 한 번 틀렸다). 거르는 규칙이 두 곳에 있으면 언젠가 갈린다.
test('F110 ③: 봉투가 **읽기 종류를 허락한다** — 손만 넓히고 kind 를 안 넓히면 장식이다', () => {
  const 결과 = bindAutomationCandidate(
    {
      // **실제 후보 모양 그대로** — 오너 자리 automation.json 에 저장된 것과 같은 꼴이다.
      action: { tool: 'local.file', args: { action: 'list', path: '~/Downloads', limit: 100 } },
    },
    { state: 'active', requiredCapabilities: ['local.file'], id: 's1' },
    {
      id: 'p1', state: 'active', toolAllowlist: ['local.file', ...관측손],
      workspaceScope: ['/집'], authorityCeiling: 'A0',
      defaultBudgets: { maxCost: 1 },
    },
    {
      now: 1_786_000_000_000,
      expiresAt: 1_789_000_000_000,
      // **실행 시점과 같은 자로 거르게 한다** — 서버가 `selfState` 를 넘긴다(server.js).
      // 안 넘기면 안 넓힌다(모르면 안 넓히는 쪽이 옳다 · 사용자가 없는 시각의 봉투다).
      selfState: {
        connectedTools: [{ id: 'local.file', toolKind: 'read' },
          ...관측손.map((id) => ({ id, toolKind: 'read' }))],
      },
      // trigger 는 **options** 로 온다(automation-contracts.js:154) — candidate 가 아니다.
      trigger: {
        kind: 'daily', timezone: 'Asia/Seoul', misfirePolicy: 'catch_up_once',
        weekdays: [1, 2, 3, 4, 5, 6, 7], localTime: '09:00', nextRunAt: 1_789_000_000_000,
      },
    },
  );
  assert.equal(결과.ok, true, `봉투를 못 만들었다: ${결과.reason} ${JSON.stringify(결과.errors ?? '')}`);
  const e = 결과.authorityEnvelope;
  assert.ok(e.allowedTools.length >= 4,
    `**봉투가 손을 ${e.allowedTools.length}개만 담았다** — 프로필이 여럿을 쥐어도 `
    + '봉투가 하나로 굳으면 실행 진입에서 등가 검사에 걸려 던진다(agent-runner.js:212-220)');
  assert.ok(e.allowedKinds.includes('read'),
    '**읽기 종류가 안 열렸다** — 손을 넓혀도 kind 가 한 칸이면 「목록 본 뒤 읽기」조차 막힌다');
});

// ── ④ 승인면이 정직하다 ─────────────────────────────────────────────────────
//
// 사용자는 승인 카드에서 담당 이름을 본다. 「local.file 로 한다」고 보고 승인했는데
// 실제로 손 여덟 개를 쓰면 그건 유도가 아니라 몰래 넓히기다.
test('F110 ④: 담당 이름·목적이 **무엇을 할 수 있는 역할인지** 말한다', () => {
  const p = 담당();
  assert.match(`${p.name} ${p.purpose}`, /막히|바꿔|다른 수단|찾아/,
    '**승인 카드에 보이는 말이 예전 그대로다** — 사용자는 손 하나짜리 역할인 줄 알고 승인하는데 '
    + '실제로는 관측 손 여럿을 쓴다. 넓힌 폭은 승인면에 보여야 한다');
});
