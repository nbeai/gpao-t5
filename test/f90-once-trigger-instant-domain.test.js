// F-90 · 한 번만 도는 예약(`once`)이 새던 자리 — 「유한한 수」는 시각의 자가 아니다.
//
// 밟은 사실(라이브 3회차 · 2026-08-12): "내일 아침 9시에 …" 가 job 3/3 · 돈다 1/3.
// `daily`·`weekly` 는 3/3. 가른 것은 **누가 시각을 계산하는가**였다:
//   daily·weekly — 모델은 `localTime`(벽시계 문자열)만 주고 **커널이 달력에서 계산**한다
//   once        — 모델이 epoch ms 절대값을 직접 준다. 틀리면 아무도 안 잡는다
// `validateTriggerSpec` 은 `Number.isFinite(at)` 만 봤다(automation-contracts.js:355).
// 그래서 `at:0`(1970년)·초를 밀리초로 준 값·서기 5만년이 **전부 같은 문**으로 들어왔고,
// job 은 서는데 `nextRunAt:0` 이라 실행이 `scheduledFor=0` 으로 끝나고 배달이 0건이었다.
//
// 오픈북 — 비교군 둘 다 「확인 절차」가 아니라 **표현 불가능**으로 막는다:
//   오픈클로 `dist/jobs-B5P8XABM.js:489-496` — 절대 안 도는 잡은 생성 자체를 거부한다:
//     `cron expression "..." has no upcoming run time and would never fire`
//   오픈클로 `dist/cron-tool-OFO3yXrE.js:852-865` — `at`/`every`/`cron` 을 스키마에서 가른다
//   클로드코드 — 일회성은 분·시·일·월을 못박게 하고 *"Never use a cron expression for a
//     one-time task; cron has no one-shot semantics"* 라고 적는다
//
// 이 검사는 **여섯 축**을 잰다(반대시험 ①~⑥).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bindAutomationCandidate,
  validateTriggerSpec,
  예약이설자리있는가,
  직접예약재료,
} from '../src/kernel/l5-growth/automation-contracts.js';
import {
  nextTriggerOccurrence,
  planTriggerOccurrences,
} from '../src/kernel/l5-growth/trigger-spec.js';

// 2026-08-12 12:00 KST. 「지금」은 고정한다 — 시계를 읽으면 검사가 날마다 다른 것을 잰다.
const NOW = Date.UTC(2026, 7, 12, 3, 0, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function once(at, patch = {}) {
  return {
    kind: 'once',
    at,
    timezone: 'Asia/Seoul',
    misfirePolicy: 'catch_up_once',
    nextRunAt: at,
    ...patch,
  };
}

// ── ① 내일 아침 9시가 **미래의 그 시각**으로 선다 (밟은 그 자리) ────────────────
test('F-90 ① 내일 아침 9시 once 는 미래의 그 시각으로 서고 그때 돈다', () => {
  const 내일아침9시 = Date.UTC(2026, 7, 13, 0, 0, 0); // 2026-08-13 09:00 KST
  const t = once(내일아침9시);

  assert.equal(validateTriggerSpec(t).ok, true, '정상 미래 시각은 통과해야 한다');
  assert.equal(예약이설자리있는가(t, NOW).ok, true, '설 자리가 있어야 한다');
  assert.equal(nextTriggerOccurrence(t, NOW), 내일아침9시);

  // 아직 시각 전 — 안 돈다.
  const 전 = planTriggerOccurrences(t, { nextRunAt: 내일아침9시, now: NOW });
  assert.deepEqual(전.occurrences, [], '예정 시각 전에는 안 돈다');
  assert.equal(전.reason, 'not_due');

  // 그 시각 — 정확히 한 번 돈다.
  const 때 = planTriggerOccurrences(t, { nextRunAt: 내일아침9시, now: 내일아침9시 });
  assert.deepEqual(때.occurrences, [내일아침9시], '그 시각에 그 시각으로 돈다');
  assert.equal(때.reason, 'scheduled');
});

// ── ② at:0 · 과거 · 숫자 아닌 것은 job 이 **안 선다** ──────────────────────────
// 조용히 서서 안 도는 것보다 안 서는 것이 낫다 — 「켜 뒀어요」가 거짓이 되는 자리다.
//
// **어느 층에서 막는가를 재서 골랐다.** 처음엔 `validateTriggerSpec`(레코드 계약)에서
// 막았고 F-90 여섯 축이 전부 초록이었다. 그런데 그 검사는 **저장된 레코드를 읽을 때도**
// 돈다(`automation-store.js:156`). 실패하면 job 하나가 아니라 automation.json 전체가
// 손상 취급되어 읽기 표면이 unknown 으로 닫힌다 — 이미 `at:0` job 이 저장된 사용자의
// 멀쩡한 daily·weekly 까지 날아간다. 그래서 **세우는 자리**로 층을 옮겼다.
test('F-90 ② at:0 으로는 예약이 서지 않는다 — 1970년은 예약이 아니다', () => {
  const 막힘 = 예약이설자리있는가(once(0), NOW);
  assert.equal(막힘.ok, false, 'at:0 이 통과하면 nextRunAt:0 인 job 이 선다');
  assert.equal(막힘.reason, 'at_not_an_instant');
});

test('F-90 ② 초를 밀리초 자리에 준 값으로는 예약이 서지 않는다', () => {
  // 모델이 자주 내는 실수다 — 2026년을 **초**로 주면 밀리초로는 1970년이다.
  const 초단위 = Math.floor(Date.UTC(2026, 7, 13, 0, 0, 0) / 1000);
  const 막힘 = 예약이설자리있는가(once(초단위), NOW);
  assert.equal(막힘.ok, false);
  assert.equal(막힘.reason, 'at_looks_like_seconds', '초를 준 것이라고 짚어야 고칠 수 있다');
});

test('F-90 ② 사람이 예약할 수 없는 먼 미래로는 예약이 서지 않는다', () => {
  // 조용히 영원히 `not_due` 로 남는 job 이 된다 — 안 도는데 「켜 뒀다」가 된다.
  assert.equal(예약이설자리있는가(once(1e18), NOW).ok, false);
});

test('F-90 ② 숫자가 아닌 것·정수가 아닌 것으로는 예약이 서지 않는다', () => {
  for (const 나쁜값 of [undefined, null, NaN, Infinity, -Infinity, '1786582800000', {}, [], 1.5]) {
    assert.equal(
      예약이설자리있는가(once(나쁜값), NOW).ok,
      false,
      `${String(나쁜값)} 이 시각으로 통과하면 안 된다`,
    );
  }
});

test('F-90 ② 지나간 시각은 **생성 시점에** 막힌다 (오픈클로: would never fire)', () => {
  const 어제 = NOW - DAY;
  assert.equal(예약이설자리있는가(once(어제), NOW).ok, false, '지나간 시각으로 새 예약을 세울 수 없다');
  assert.equal(예약이설자리있는가(once(어제), NOW).reason, 'at_already_passed');
  assert.equal(예약이설자리있는가(once(NOW - HOUR), NOW).ok, false, '한 시간 전도 예약이 아니다');
});

// **「지금 한 번」은 지나간 시각이 아니다.** 모델이 `Date.now()` 로 잰 값은 서버가 재는
// 순간엔 이미 몇 밀리초 전이다 — 그 왕복만 흡수하고, 그 이상은 안 봐준다.
// 이 검사가 유예를 못 넓히게 잡아 둔다(넓히면 잘못 만든 시각과 놓친 회차가 안 갈린다).
test('F-90 ② 왕복 유예는 「지금」만 흡수하고 그 이상은 안 봐준다', () => {
  assert.equal(예약이설자리있는가(once(NOW), NOW).ok, true, '지금 한 번은 설 수 있어야 한다');
  assert.equal(예약이설자리있는가(once(NOW - 30_000), NOW).ok, true, '30초 전 왕복은 흡수한다');
  assert.equal(예약이설자리있는가(once(NOW - (4 * 60_000)), NOW).ok, true, '4분 전까지는 흡수한다');
  assert.equal(예약이설자리있는가(once(NOW - (6 * 60_000)), NOW).ok, false, '6분 전은 왕복이 아니다');
});

// **막는 자리를 옮긴 값을 이 검사가 지킨다** — 다시 레코드 계약으로 올라가면 여기서 빨개진다.
test('F-90 ② 저장된 레코드 계약은 안 조여진다 — 원장이 통째로 닫히면 버그보다 나쁘다', () => {
  for (const 나쁜값 of [0, 100, NOW - DAY, 1e18]) {
    assert.equal(
      validateTriggerSpec(once(나쁜값)).ok,
      true,
      `이미 저장된 at:${나쁜값} 레코드가 무효가 되면 automation.json 전체가 손상 취급된다`,
    );
  }
});

test('F-90 ② 막힌 트리거로는 후보가 job 재료를 못 얻는다', () => {
  const skill = {
    state: 'active',
    requiredCapabilities: ['local.file'],
  };
  const profile = {
    state: 'active',
    toolAllowlist: ['local.file'],
    authorityCeiling: 'A2',
    workspaceScope: ['/tmp/work'],
    defaultBudgets: {},
  };
  const candidate = {
    action: { tool: 'local.file', args: { action: 'write', path: '/tmp/report.md', text: 'done' } },
  };

  const bound = bindAutomationCandidate(candidate, skill, profile, {
    trigger: once(0),
    now: NOW,
  });
  assert.equal(bound.ok, false, 'at:0 으로는 바인딩이 안 된다');
  assert.equal(bound.reason, 'invalid_trigger');
});

// **만든 것과 닿은 것은 다르다** — 명시 예약("내일 아침 9시에 …")이 실제로 서는 자리는
// `직접예약재료` 다(`server.js:684` 가 `now` 를 주며 부른다). 그 자리에서 막히는지 잰다.
test('F-90 ② 명시 예약 레인이 안 도는 시각을 세우지 않는다 (제품이 밟는 자리)', () => {
  const 후보 = (at) => ({
    candidateId: 'cand-1',
    statement: '내일 아침 9시에 다운로드 폴더의 PDF 개수를 알려줘',
    action: { tool: 'local.file', args: { action: 'write', path: '/tmp/work/report.md', text: 'done' } },
    trigger: once(at),
  });
  const 옵션 = { workspaceRoots: ['/tmp/work'], now: NOW };

  const 막힘 = 직접예약재료(후보(0), 옵션);
  assert.equal(막힘.ok, false, 'at:0 짜리 명시 예약이 서면 안 된다');
  assert.equal(막힘.reason, 'trigger_has_no_future');
  assert.ok(막힘.안서는이유?.고칠길, '왜 안 되고 어떻게 고치는지가 함께 와야 한다');

  const 과거 = 직접예약재료(후보(NOW - DAY), 옵션);
  assert.equal(과거.ok, false, '지나간 시각짜리 명시 예약이 서면 안 된다');

  const 선다 = 직접예약재료(후보(Date.UTC(2026, 7, 13, 0, 0, 0)), 옵션);
  assert.equal(선다.ok, true, '미래의 그 시각이면 예전 그대로 선다');
  assert.ok(선다.skill && 선다.profile);
});

// ── ③ 막을 때 **무엇이 왜 안 되는지와 다음 길**이 함께 온다 ────────────────────
// 거절로 끝내지 않는다 — 헤르메스가 안 닿는 조건을 생성 시점 반환값에 싣는 것과 같은 결.
test('F-90 ③ 거절은 무엇이·왜·어떻게를 함께 싣는다', () => {
  const 막힘 = 예약이설자리있는가(once(0), NOW);
  assert.equal(막힘.ok, false);
  assert.ok(막힘.reason, '기계가 읽는 이유 칸이 있어야 한다');
  assert.ok(막힘.받은값 !== undefined, '무엇을 받았는지 적어야 한다');
  assert.ok(막힘.고칠길 && 막힘.고칠길.length > 0, '다음 길이 없으면 거절로 끝난 것이다');
  // 「다음 길」은 실제로 쓸 수 있는 값이어야 한다 — 문장만 주고 끝내지 않는다.
  assert.ok(Number.isInteger(막힘.지금), '지금이 몇인지 기계값으로 줘야 한다');
  assert.equal(예약이설자리있는가(once(막힘.지금 + HOUR), NOW).ok, true, '준 자로 고치면 통과해야 한다');

  const 과거 = 예약이설자리있는가(once(NOW - DAY), NOW);
  assert.equal(과거.ok, false);
  assert.notEqual(과거.reason, 막힘.reason, '1970년과 어제는 다른 이유로 막혀야 한다');
  assert.ok(과거.고칠길.length > 0);
});

// ── ④ daily·weekly 는 예전 그대로 — 그물이 안 넓어졌다 ────────────────────────
test('F-90 ④ daily·weekly 는 한 글자도 안 달라졌다', () => {
  const daily = {
    kind: 'daily', localTime: '09:00', timezone: 'Asia/Seoul',
    misfirePolicy: 'catch_up_once', nextRunAt: null,
  };
  const weekly = {
    kind: 'weekly', localTime: '18:00', weekdays: [5], timezone: 'Asia/Seoul',
    misfirePolicy: 'catch_up_once', nextRunAt: null,
  };
  assert.equal(validateTriggerSpec(daily).ok, true);
  assert.equal(validateTriggerSpec(weekly).ok, true);
  // 달력에서 계산하는 길은 그대로다 — `at` 이 없어도 되고, 있어도 안 본다.
  assert.equal(예약이설자리있는가(daily, NOW).ok, true);
  assert.equal(예약이설자리있는가(weekly, NOW).ok, true);
  assert.equal(nextTriggerOccurrence(daily, NOW), Date.UTC(2026, 7, 13, 0, 0, 0));
  assert.equal(nextTriggerOccurrence(weekly, NOW), Date.UTC(2026, 7, 14, 9, 0, 0));
  // interval 도 안 건드렸다.
  const interval = {
    kind: 'interval', intervalMs: HOUR, timezone: 'Asia/Seoul',
    misfirePolicy: 'skip', nextRunAt: NOW + HOUR,
  };
  assert.equal(validateTriggerSpec(interval).ok, true);
  assert.equal(nextTriggerOccurrence(interval, NOW), NOW + HOUR);
});

// ── ⑤ 한 번 돈 once 는 다시 안 돈다 ───────────────────────────────────────────
test('F-90 ⑤ 한 번 돈 once 는 다시 안 돈다 (maxRuns:1 · nextRunAt null)', () => {
  const 내일아침9시 = Date.UTC(2026, 7, 13, 0, 0, 0);
  const t = once(내일아침9시);
  const 돈다 = planTriggerOccurrences(t, { nextRunAt: 내일아침9시, now: 내일아침9시 });
  assert.deepEqual(돈다.occurrences, [내일아침9시]);
  assert.equal(돈다.nextRunAt, null, '한 번 돌면 다음 자리가 없어야 한다');

  // 소진된 커서로 다시 물어도 안 돈다.
  const 또 = planTriggerOccurrences(t, { nextRunAt: null, now: 내일아침9시 + DAY });
  assert.deepEqual(또.occurrences, []);
  assert.equal(또.reason, 'exhausted');

  // 권한창도 1회로 닫힌다.
  const skill = { state: 'active', requiredCapabilities: ['local.file'] };
  const profile = {
    state: 'active', toolAllowlist: ['local.file'], authorityCeiling: 'A2',
    workspaceScope: ['/tmp/work'], defaultBudgets: {},
  };
  const bound = bindAutomationCandidate(
    { action: { tool: 'local.file', args: { action: 'write', path: '/tmp/work/report.md', text: 'done' } } },
    skill, profile, { trigger: t, now: NOW },
  );
  assert.equal(bound.ok, true);
  assert.equal(bound.authorityEnvelope.maxRuns, 1, 'once 의 권한창은 1회다');
});

// ── ⑥ 놓친 once(앱이 꺼져 있던 사이 지남)는 따라잡기 규칙 그대로 ──────────────
test('F-90 ⑥ 놓친 once 는 misfirePolicy 그대로 따라잡거나 버린다', () => {
  const 예정 = Date.UTC(2026, 7, 13, 0, 0, 0);
  const 늦게켬 = 예정 + (3 * HOUR); // 앱이 3시간 꺼져 있었다

  // 저장된 과거 레코드는 여전히 구조상 유효해야 한다 — 안 그러면 원장이 깨진다.
  assert.equal(validateTriggerSpec(once(예정)).ok, true);

  const 따라잡 = planTriggerOccurrences(once(예정), {
    nextRunAt: 예정, now: 늦게켬, recovering: true,
  });
  assert.deepEqual(따라잡.occurrences, [예정], 'catch_up_once 는 놓친 회차를 따라잡는다');
  assert.equal(따라잡.reason, 'catch_up_once');

  const 버림 = planTriggerOccurrences(once(예정, { misfirePolicy: 'skip' }), {
    nextRunAt: 예정, now: 늦게켬, recovering: true,
  });
  assert.deepEqual(버림.occurrences, [], 'skip 은 놓친 회차를 버린다');
  assert.equal(버림.skippedCount, 1);
});
