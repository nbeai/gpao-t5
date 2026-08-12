// **조각 E · 백엔드가 이미 답하는 것에 문을 낸다** — 선빨강
// (`design/T5-UX-PLAN-ko.md` §2 조각 E · §6-2 E 행)
//
// 닫는 문장: *"켠 자동화를 목록으로 보고, 멈추고, 다시 켤 수 있다."*
//
// ── 왜 지금 빨간가 (밟은 기계 사실 · 2026-08-12) ─────────────────────────────
// 서버는 이미 다 답한다: `GET /automation` 이 jobs·candidates·runs 를 내고
// `POST /automation/pause|resume|retry` 가 선다(`src/surface/server.js:2897-3037`).
// 그런데 **화면에 문이 없다.** 설정 허브 등록표(`SET_SECTIONS`)는 6칸이고
// 자동화 칸이 없다 — 사용자는 자기가 켠 자동화를 **볼 방법이 없고**, 그래서
// 멈출 방법도 없다. 서버 수정 0 으로 닫히는 자리다.
//
// ── 서버 수정 0 의 정의역 (여기서 못 넘는 선) ────────────────────────────────
// 화면은 `GET /automation` 이 **실제로 실은 것**만 쓴다. `notRunning`(안 도는 조건)은
// 켜는 손 반환값에만 있고 이 GET 에는 없다(`server.js:715-720` → `automationProposal`).
// 그래서 화면은 페이로드에 **있는** 것만 적는다:
//   `trigger.misfirePolicy` · `authorityEnvelope.expiresAt` · `authorityEnvelope.maxRuns`
// `tickIntervalMs`(=몇 초마다 확인) 는 이 GET 에 없다 → **숫자를 지어내지 않는다.**
// `requiresAppRunning` 은 T5 의 구조 상수다(`automation-contracts.js:351` 이 무조건 true —
// 스케줄러가 `in_process_interval` 이고 데몬이 없다). 값이 아니라 **구조 사실**이므로
// 목록 머리에 한 줄로 적는다.
//
// ── 이 시험이 무는 것 (지시문 반대시험 ①~⑥) ────────────────────────────────
//   ① 목록이 보이고 **상태·다음 실행이 한 줄**에 있다        (헤르메스 cron.py:145-190)
//   ② 멈추고 다시 켤 수 있다 — **삭제와 구별**된다            (cli-commands.md:563-572)
//   ③ **죽은 버튼이 안 생긴다** — 내는 버튼은 전부 실제로 상태를 바꾼다
//   ④ 0개일 때 빈 목록이 아니라 「없어요 + 어떻게 만드나」     (cron.py:64-95, :105-108)
//   ⑤ **「앱이 켜져 있어야 돈다」가 목록에서도 보인다**
//   ⑥ 설정 허브의 기존 6섹션이 그대로 살아 있다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
  transitionState,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { makeServer } from '../src/surface/server.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';

// ── 투영을 **화면에서 그대로 떼어다** 돌린다 ─────────────────────────────────
// 왜 별도 모듈 파일이 아닌가: 이 저장소는 번들러가 없어 **화면 모듈 하나 = 서버 라우트 한 줄**
// 이다(`server.js:2529-2540` 이 `markdown.js`·`approval-state.js` 를 손으로 하나씩 낸다).
// 조각 E 의 규율은 **서버 수정 0** 이므로 새 모듈 파일을 안 만들었다. 그렇다고 검사에
// 사본을 두면 두 진실이 된다 — 그래서 화면이 실제로 실행하는 그 글자를 떼어 온다.
// 블록이 사라지거나 이름이 바뀌면 여기서 먼저 터진다.
const 화면 = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
const 투영블록 = (() => {
  const 시작 = 화면.indexOf('// ╔══ 조각 E 투영 시작');
  const 끝 = 화면.indexOf('// ╚══ 조각 E 투영 끝');
  assert.ok(시작 >= 0 && 끝 > 시작, '조각 E 투영 블록을 index.html 에서 못 찾았다');
  return 화면.slice(시작, 끝);
})();
const { automationJobActions, automationLoadFailure, projectAutomationDoor } = await import(
  `data:text/javascript;base64,${Buffer.from(
    `${투영블록}\nexport { automationJobActions, automationLoadFailure, projectAutomationDoor };`,
    'utf8',
  ).toString('base64')}`
);

const NOW = 1_786_287_600_000; // 2026-08-10 00:00 Asia/Seoul

// ── 붙박이 (기존 automation-surface-v2 검사와 같은 모양 — 두 진실 금지) ──────────
function skill(id = 'skill-active') {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: '주간 정산',
    purpose: '사용자가 반복하는 문서 업무를 정리한다',
    version: 1,
    contentHash: '',
    inputs: [],
    steps: [{ kind: 'summarize', instruction: '문서를 읽고 짧게 정리한다' }],
    resultContract: { kind: 'summary' },
    requiredCapabilities: ['local.file'],
    authorityHints: [],
    replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] },
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
    previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function profile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-local-docs',
    name: '문서 정리 담당',
    purpose: '로컬 문서를 읽고 결과를 준비한다',
    modelRole: 'worker',
    toolAllowlist: ['local.file'],
    workspaceScope: ['/tmp'],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1',
    state: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
}

function proposedJob(id = 'job-weekly', patch = {}) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id,
    name: '금요일 정산 초안',
    skillRef: { id: 'skill-active', version: 1, contentHash: skill().contentHash },
    trigger: {
      kind: 'weekly',
      timezone: 'Asia/Seoul',
      weekdays: [5],
      localTime: '17:00',
      nextRunAt: NOW + 3_600_000,
      misfirePolicy: 'catch_up_once',
    },
    agentProfileId: 'agent-local-docs',
    inputTemplate: { operation: 'read', path: '/tmp/weekly-source.txt' },
    authorityEnvelope: {
      ceiling: 'A1',
      allowedKinds: ['read'],
      allowedTools: ['local.file'],
      allowedTargets: [],
      workspaceRoots: ['/tmp'],
      expiresAt: NOW + 30 * 24 * 3_600_000,
      maxRuns: 20,
      maxCost: 1,
      requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' },
    state: 'proposed',
    nextRunAt: NOW + 3_600_000,
    lastRunId: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

/** 원하는 상태까지 **정상 전이만으로** 끌고 간다 — 상태를 손으로 박지 않는다. */
function jobInState(state, id = 'job-weekly') {
  let record = proposedJob(id);
  if (state === 'proposed') return record;
  const path = {
    approved: ['approved'],
    scheduled: ['approved', 'scheduled'],
    paused: ['approved', 'scheduled', 'paused'],
    needs_review: ['approved', 'scheduled', 'needs_review'],
    cancelled: ['approved', 'scheduled', 'cancelled'],
    expired: ['approved', 'scheduled', 'expired'],
  }[state];
  assert.ok(path, `모르는 상태: ${state}`);
  for (const step of path) {
    const moved = transitionState('automationJob', record, step, 2);
    assert.equal(moved.ok, true, `${state} 로 못 갔다: ${JSON.stringify(moved)}`);
    record = moved.record;
  }
  return record;
}

/**
 * **돌긴 돌았는데 못 전한 실행 한 건**을 원장의 정상 수명주기로 남긴다
 * (queued → claimed → running → succeeded → 배달 실패). 상태를 손으로 박으면 원장이 거절한다.
 *
 * 원장이 배달 기록을 **성공한 실행에만** 허용한다(`automation-run-ledger.js:231`).
 * 그러니 「배달 실패」는 실행 실패와 **다른 사건**이다 — 사용자에겐 특히 그렇다.
 * 한 줄이 둘을 갈라 보여야 하는 이유가 여기 있다.
 */
async function 실패한실행(ledger, job) {
  const 뼈대 = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'run-1',
    jobId: job.id,
    scheduledFor: NOW - 3_600_000,
    idempotencyKey: `${job.id}:${NOW - 3_600_000}:1:${job.skillRef.contentHash}`,
    skillSnapshot: skill(),
    triggerSnapshot: job.trigger,
    inputSnapshot: job.inputTemplate,
    agentSnapshot: profile(),
    authorityEnvelope: job.authorityEnvelope,
    budgets: profile().defaultBudgets,
    receipts: [],
    deliveryState: { status: 'pending' },
    owner: null, heartbeatAt: null, startedAt: null, finishedAt: null,
    status: 'queued',
  };
  await ledger.append(뼈대);
  const 주인 = { pid: process.pid, ownerToken: 'door-test' };
  const 산것 = {
    ...뼈대, owner: 주인, heartbeatAt: NOW - 3_590_000,
    startedAt: NOW - 3_590_000, updatedAt: NOW - 3_590_000,
  };
  await ledger.append({ ...산것, status: 'claimed' });
  await ledger.append({ ...산것, status: 'running', updatedAt: NOW - 3_580_000, heartbeatAt: NOW - 3_580_000 });
  await ledger.append({
    ...산것, status: 'succeeded', updatedAt: NOW - 3_500_000,
    heartbeatAt: NOW - 3_500_000, finishedAt: NOW - 3_500_000,
  });
  await ledger.recordDelivery('run-1', { status: 'failed', reason: 'channel_unavailable' }, NOW - 3_490_000);
}

async function 제품({ jobs = [jobInState('scheduled')], candidates = [], 실패실행 = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 't5-door-'));
  const skillStore = new SkillDefinitionStore(dir);
  const automationStore = new AutomationJobStore(dir);
  const agentProfileStore = new AgentProfileStore(dir);
  const automationRunLedger = new AutomationRunLedger(dir);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
  await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile()] });
  await automationStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates, jobs });
  if (실패실행) await 실패한실행(automationRunLedger, jobs[0]);
  const server = makeServer({
    store: new SessionStore(dir),
    skillStore,
    automationStore,
    agentProfileStore,
    automationRunLedger,
    env: demoEnv(),
    tools: demoTools(),
    model: { async respond() { return '알겠어요.'; } },
    clock: () => NOW,
    modelTimeoutMs: 0,
    processEnv: { GPAO_T5_TCELL: 'off' },
    startScheduler: false,
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    목록: () => fetch(`${base}/automation`).then((r) => r.json()),
    보내기: (path, body) => fetch(`${base}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

// ── ① 상태·다음 실행·마지막 결과·배달 실패가 **한 줄**에 있다 ──────────────────
test('E ①: 자동화 한 줄에 상태·다음 실행·마지막 결과·배달 실패가 다 있다', async () => {
  const app = await 제품({ jobs: [jobInState('scheduled')], 실패실행: true });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.jobs.length, 1, '켠 자동화가 목록에 안 보인다');
    const 줄 = 문.jobs[0].summaryLine;
    assert.match(줄, /금요일 정산 초안/, '이름이 한 줄에 없다');
    assert.match(줄, /켜져 있어요/, '상태가 한 줄에 없다 (헤르메스 cron.py:145-190)');
    assert.match(줄, /다음 실행/, '다음 실행이 한 줄에 없다');
    assert.match(줄, /마지막/, '마지막 결과가 한 줄에 없다');
    assert.match(줄, /배달/, '배달 실패가 한 줄에 없다 — 돌았는데 못 전한 것이 안 보인다');
  } finally { await app.close(); }
});

test('E ①-2: 멈춘 자동화에 「다음 실행 시각」을 적지 않는다 (남은 nextRunAt 은 거짓이다)', async () => {
  const app = await 제품({ jobs: [jobInState('paused')] });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    const 줄 = 문.jobs[0].summaryLine;
    assert.match(줄, /멈춰 뒀어요/);
    assert.doesNotMatch(줄, /다음 실행 \d/,
      '**멈춘 job 에 옛 nextRunAt 을 다음 실행이라고 적었다** — 안 도는데 돈다고 말한 것이다');
  } finally { await app.close(); }
});

// ── ② 멈추고 다시 켠다 — 삭제와 구별된다 ─────────────────────────────────────
test('E ②: 멈추기 → 다시 켜기가 실제로 서고, 자동화는 사라지지 않는다', async () => {
  const app = await 제품({ jobs: [jobInState('scheduled')] });
  try {
    const 멈춤 = await app.보내기('/automation/pause', { jobId: 'job-weekly' });
    assert.equal(멈춤.status, 200, '멈추기가 안 선다');
    let 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.jobs.length, 1, '**멈췄더니 목록에서 사라졌다** — 멈춤이 삭제가 됐다');
    assert.equal(문.jobs[0].state, 'paused');
    assert.match(문.jobs[0].keptHint ?? '', /사라지지|지워지지/,
      '멈춤이 삭제가 아니라는 말이 화면에 없다 (cli-commands.md:563-572)');

    const 재개 = await app.보내기('/automation/resume', { jobId: 'job-weekly' });
    assert.equal(재개.status, 200, '다시 켜기가 안 선다');
    문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.jobs[0].state, 'scheduled', '다시 켰는데 안 켜졌다');
  } finally { await app.close(); }
});

// ── ③ 죽은 버튼이 안 생긴다 — 내는 버튼은 **전부 실제로 상태를 바꾼다** ────────
test('E ③: 화면이 내는 모든 버튼이 서버에서 실제 상태 변화를 만든다 (죽은 버튼 0)', async () => {
  const 상태들 = ['proposed', 'approved', 'scheduled', 'paused', 'needs_review', 'cancelled', 'expired'];
  for (const 상태 of 상태들) {
    const app = await 제품({ jobs: [jobInState(상태)] });
    try {
      const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
      const row = 문.jobs[0] ?? 문.ended[0];
      assert.ok(row, `${상태}: 자동화가 어느 목록에도 안 보인다 — 조용히 사라졌다`);
      for (const 동작 of row.actions) {
        const res = await app.보내기(동작.path, { jobId: 'job-weekly' });
        assert.equal(res.status, 200,
          `**${상태} 에서 「${동작.label}」 버튼을 냈는데 서버가 ${res.status} 로 거절했다** — 죽은 버튼이다`);
        const 뒤 = projectAutomationDoor(await app.목록(), { now: NOW });
        const 뒤row = 뒤.jobs[0] ?? 뒤.ended[0];
        assert.notEqual(뒤row.state, row.state,
          `**${상태} 에서 「${동작.label}」 을 눌러도 상태가 그대로다(${row.state})** — `
          + '서버가 200 을 주지만 아무 일도 안 한다. 200 은 살아 있다는 증거가 아니다');
      }
      // 버튼이 하나도 없으면 **그 자리에 텍스트가 있어야 한다**(index.html:715·990 원칙)
      if (!row.actions.length) {
        assert.ok(row.noActionReason,
          `${상태}: 버튼도 없고 설명도 없다 — 사용자가 왜 아무것도 못 하는지 모른다`);
      }
    } finally { await app.close(); }
  }
});

test('E ③-2: 화면은 서버가 거절하는 동작을 아예 안 낸다 (pause/resume 정의역 대조)', async () => {
  // 서버 정의역(`server.js:2992-3020`)을 **직접 밟아** 얻은 표와 화면의 버튼을 1:1 로 맞춘다.
  for (const 상태 of ['proposed', 'approved', 'scheduled', 'paused', 'needs_review', 'cancelled', 'expired']) {
    for (const path of ['/automation/pause', '/automation/resume']) {
      const app = await 제품({ jobs: [jobInState(상태)] });
      try {
        const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
        const row = 문.jobs[0] ?? 문.ended[0];
        const 냈나 = (row?.actions ?? []).some((a) => a.path === path);
        const res = await app.보내기(path, { jobId: 'job-weekly' });
        if (냈나) {
          assert.equal(res.status, 200, `${상태} ${path}: 낸 버튼을 서버가 거절한다`);
        } else if (res.status === 200) {
          // 200 이어도 **상태가 안 바뀌면** 안 내는 것이 맞다 — 그것이 죽은 버튼이다.
          const 뒤 = projectAutomationDoor(await app.목록(), { now: NOW });
          assert.equal((뒤.jobs[0] ?? 뒤.ended[0]).state, row.state,
            `${상태} ${path}: 실제로 상태가 바뀌는데 화면이 버튼을 안 냈다 — 할 수 있는 것을 숨겼다`);
        }
      } finally { await app.close(); }
    }
  }
});

// ── ④ 0개일 때 빈 목록이 아니라 「없어요 + 어떻게 만드나」 ─────────────────────
test('E ④: 자동화가 0개면 빈 목록이 아니라 다음 행동을 준다', async () => {
  const app = await 제품({ jobs: [] });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.empty, true);
    assert.ok(문.guide, '**0개인데 안내가 없다** — 빈 목록은 다음 행동을 안 준다 (cron.py:64-95)');
    assert.match(문.guide.title, /없어요|없습니다/);
    assert.ok(문.guide.steps.length >= 1, '어떻게 만드는지가 없다');
    assert.ok(문.guide.steps.some((s) => /시점|시간|매일|아침/.test(s)),
      '「어떻게 만드나」가 구체적이지 않다 — 시점을 넣어 말해야 후보가 선다는 사실이 없다');
  } finally { await app.close(); }
});

test('E ④-2: 켜기를 기다리는 후보가 있으면 0개 안내가 그 사실로 바뀐다', async () => {
  const app = await 제품({
    jobs: [],
    candidates: [{
      candidateId: 'cand-1', statement: '매일 아침 9시에 다운로드 폴더를 본다',
      approved: false, current: true, revision: 1, operation: 'create',
      expiresAt: NOW + 3_600_000,
    }],
  });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.candidates.length, 1, '켜기를 기다리는 후보가 화면에 안 보인다');
    assert.match(문.guide.title, /기다리|후보/,
      '후보가 있는데 「아무것도 없어요」라고 말한다 — 사용자는 이미 절반을 했다');
  } finally { await app.close(); }
});

// ── ⑤ 「앱이 켜져 있어야 돈다」가 목록에서도 보인다 ────────────────────────────
test('E ⑤: 도는 예약이 있으면 「앱이 켜져 있어야 돈다」를 목록 머리에서 먼저 말한다', async () => {
  const app = await 제품({ jobs: [jobInState('scheduled')] });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.appRunning.applies, true);
    assert.match(문.appRunning.text, /켜져 있|꺼져 있/,
      '**T5 는 데몬이 아니다 — 앱이 꺼지면 예약이 안 돈다.** 그 사실이 목록에 없다');
    assert.doesNotMatch(문.appRunning.text, /\d+\s*초마다/,
      '`tickIntervalMs` 는 GET /automation 에 없다 — 숫자를 지어냈다');
    // 놓친 회차 처리는 **페이로드에 실린 misfirePolicy** 에서만 나온다.
    assert.ok(문.jobs[0].notRunning.some((t) => /따라잡/.test(t)),
      'misfirePolicy=catch_up_once 인데 놓친 회차 처리가 안 보인다');
    assert.ok(문.jobs[0].notRunning.some((t) => /권한|만료/.test(t)),
      'authorityEnvelope.expiresAt 이 있는데 권한 만료가 안 보인다');
  } finally { await app.close(); }
});

test('E ⑤-2: 해당 없는 진단은 통째로 숨긴다 (cron.py:223-243)', async () => {
  const app = await 제품({
    jobs: [jobInState('cancelled')],
  });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    assert.equal(문.appRunning.applies, false,
      '**도는 예약이 하나도 없는데 「앱을 켜 두라」고 잔소리한다** — 해당 없는 진단이다');
  } finally { await app.close(); }
});

test('E ⑤-3: misfirePolicy=skip 이면 「따라잡는다」가 아니라 「버린다」라고 적는다', async () => {
  const 버리는것 = jobInState('scheduled');
  버리는것.trigger = { ...버리는것.trigger, misfirePolicy: 'skip' };
  const app = await 제품({ jobs: [버리는것] });
  try {
    const 문 = projectAutomationDoor(await app.목록(), { now: NOW });
    const 조건 = 문.jobs[0].notRunning.join(' ');
    assert.match(조건, /버려|건너뜁|따라잡지/, 'skip 인데 따라잡는다고 적었다 — 반대로 말했다');
    assert.doesNotMatch(조건, /다음에 T5 를 켤 때 따라잡아요/);
  } finally { await app.close(); }
});

// ── ④-3 목록을 **못 불러온 것도 「안 뜰 상황」이다** ──────────────────────────
// 라이브에서 밟았다(2026-08-12): 신분 쿠키가 식으면 `/automation` 이 403 을 준다.
// 그때 렌더가 그대로 터지면 설정 허브의 바깥 catch 가 **패널 전체**를 「이 영역을 지금
// 불러오지 못했어요」로 갈아 버린다 — 사용자는 무엇을 해야 하는지 모른다.
// 형제 6섹션은 카드를 지키고 그 자리에 한 줄을 놓는다. 조각 E 도 같아야 하고,
// §6-2 의 규칙(「안 뜰 상황」에 **고칠 길을 그 자리에 붙인다**)이 여기에도 걸린다.
test('E ④-3: 목록을 못 불러오면 빈 화면이 아니라 고칠 길을 그 자리에 준다', async () => {
  const 안내 = automationLoadFailure();
  assert.ok(안내?.title, '못 불러왔을 때 아무 말도 없다');
  assert.ok(안내.steps?.some((s) => /새로 고치|다시 열/.test(s)),
    '고칠 길이 없다 — 「잠시 후 다시」는 다음 행동이 아니다');

  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  const 렌더 = html.slice(html.indexOf('  async automation()'), html.indexOf('  async memory()'));
  assert.match(렌더, /catch/,
    '**렌더가 fetch 실패를 안 잡는다** — 바깥 catch 가 패널을 통째로 갈아 버린다');
  assert.match(렌더, /automationLoadFailure\(/, '못 불러왔을 때 쓸 안내를 안 쓴다');
});

// ── 순수 투영 — 서버 없이도 계약이 선다 ───────────────────────────────────────
test('E: 버튼 정의역은 job 상태 하나로 결정된다 (화면이 따로 계산하지 않는다)', () => {
  assert.deepEqual(automationJobActions({ state: 'scheduled' }).map((a) => a.id), ['pause']);
  assert.deepEqual(automationJobActions({ state: 'paused' }).map((a) => a.id), ['resume']);
  assert.deepEqual(automationJobActions({ state: 'approved' }).map((a) => a.id), ['resume']);
  for (const state of ['proposed', 'needs_review', 'cancelled', 'expired']) {
    assert.deepEqual(automationJobActions({ state }), [], `${state} 에 버튼이 생겼다`);
  }
});

// ── ⑥ 설정 허브에 **섹션으로** 들어간다 — 등록표 2곳만, 기존 6섹션 그대로 ──────
test('E ⑥: 설정 허브 등록표 2곳으로 들어가고 기존 6섹션이 그대로 살아 있다', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');

  // 1곳: SET_SECTIONS
  const 표 = html.match(/const SET_SECTIONS = \[[\s\S]*?\];/);
  assert.ok(표, 'SET_SECTIONS 등록표가 없다');
  for (const id of ['model', 'messenger', 'tools', 'skills', 'memory', 'looks']) {
    assert.ok(표[0].includes(`'${id}'`), `기존 섹션 ${id} 이 등록표에서 사라졌다`);
  }
  assert.ok(표[0].includes("'automation'"), '**자동화 칸이 설정 허브 등록표에 없다** — 문이 안 났다');

  // 2곳: SET_RENDER
  assert.match(html, /const SET_RENDER = \{[\s\S]*?async automation\(\)/,
    'SET_RENDER 에 automation 렌더가 없다');
  for (const id of ['model', 'messenger', 'tools', 'skills', 'memory', 'looks']) {
    assert.match(html, new RegExp(`async ${id}\\(\\)`), `기존 렌더 ${id} 이 사라졌다`);
  }

  // 새 오버레이를 만들지 않았다 (§5 — 오버레이는 5곳을 고쳐야 한다)
  assert.doesNotMatch(html, /id="autoov"|getElementById\('autoov'\)/,
    '**새 오버레이를 만들었다** — 설정 섹션으로 가라는 계획을 어겼다(§2 조각 E)');

  // 화면은 서버 사실을 **투영 한 벌**로 받는다 (§5 — 조각 E 가 첫 소비자).
  // 렌더가 job.state 를 직접 뒤져 버튼을 고르면 그 순간 판단이 두 곳에 산다.
  const 렌더 = html.slice(html.indexOf('  async automation()'), html.indexOf('  async memory()'));
  assert.match(렌더, /projectAutomationDoor\(/, '렌더가 투영을 안 쓴다');
  assert.doesNotMatch(렌더, /state === '(scheduled|paused|approved|needs_review)'/,
    '렌더가 상태를 제 손으로 다시 판정한다 — 판단은 투영 한 자리에만 있어야 한다');

  // 서버 수정 0 — 화면 모듈을 늘리면 서버에 라우트가 한 줄 따라온다(server.js:2529-2540).
  const server = await readFile(new URL('../src/surface/server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /automation-view\.js/,
    '**서버에 새 정적 라우트가 생겼다** — 조각 E 의 규율은 서버 수정 0 이다');
});

test('E ⑥-2: 새 스타일은 <style> 맨 끝에 「조각 E」 주석으로 덧붙었다 (§1)', async () => {
  const html = await readFile(new URL('../src/surface/web/index.html', import.meta.url), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
  assert.ok(style.includes('조각 E'), '조각 E 스타일 표식이 없다');
  const 뒤쪽 = style.slice(style.indexOf('조각 E'));
  assert.ok(!뒤쪽.includes('@media'),
    '조각 E 블록이 맨 끝이 아니다 — 기존 줄 사이에 끼워 넣으면 다른 조각과 충돌한다');
});
