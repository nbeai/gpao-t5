// **A2 · 명시 예약이 실제로 켜진다 — 선빨강** (`design/T5-AUTOMATION-CLOSE-ko.md` §4 넓힘 1번)
//
// 닫는 문장: *"매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘"* 라고 한 다음 날
// 아침 9시에, 시키지 않아도 그 답이 도착해 있다. 그리고 T5 는 그것이 **안 도는 조건**을
// 미리 말해 두었다.
//
// 왜 지금 빨간가(2026-08-12 전수 실측 · 전부 밟은 기계 사실):
//   (a) 명시 요청이 **추론 레인**(state:'proposed')으로 간다 — 후보만 서고 job 은 0.
//       오픈클로가 그 경계를 못박아 뒀다(`openclaw/docs/concepts/commitments.md:98-100`):
//       *"Exact user requests already belong to the scheduler path. Commitments are only for
//        inferred follow-ups"* — T5 는 명시 요청을 추론 레인에 넣고 있었다.
//   (b) 확정이 **활성 스킬·프로필**을 요구하는데 켜는 길이 제품에 없다(`server.js:889-891`).
//   (c) 그래서 확정이 **활성 스킬 배열의 첫 항목**을 집었다(`server.js:1039-1042`).
//       재현: 사용자 "새 PDF 개수" → skill-invoice(월말 청구서 정리)에 묶여, 다음 날 아침
//       **남의 목적**이 자동으로 돌았다. `bindAutomationCandidate` 는 도구 일치만 본다.
//
// 비교군 둘 다 「만들면 즉시 켜진다」가 예외 없는 기본값이다:
//   · 오픈클로 `dist/jobs-B5P8XABM.js:835` — `enabled = typeof input.enabled === "boolean" ? … : true`
//   · 헤르메스 `cron/jobs.py:1414-1415` — `"enabled": True, "state": "scheduled"`
// 그리고 저장하는 것은 스킬 참조가 아니라 **자족적 지시문**이다:
//   · 헤르메스 `tools/cronjob_tools.py:1401` — *"Jobs run in a fresh session with no
//     current-chat context, so prompts must be self-contained."*
//   T5 의 실행 조립부(`canonical-automation-runtime.js:477-500`)도 `memory:{}`·`recentTurns:[]`·
//   `activeGoal:null` 로 부른다 — 이 대화의 맥락이 **구조적으로** 안 실린다.
//
// 이 시험이 무는 것은 부품이 아니라 실경로다: 실제 서버 · 실제 스토어 · 사용자 발화 →
// 모델 통제 채널 → 원장 파일 → tick → 실행 → 대화 도착.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AUTOMATION_SCHEMA_VERSION, contentHash, skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';

const NOW = 1_786_287_600_000;                 // 2026-08-10 00:00 Asia/Seoul
const 아침9시 = Object.freeze({
  kind: 'daily', timezone: 'Asia/Seoul', localTime: '09:00', misfirePolicy: 'catch_up_once',
});

/** 목적이 **다른** 활성 스킬. 옛 판이 명시 예약을 여기에 묶었다(재현된 사고). */
function 청구서스킬() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'skill-invoice', name: '월말 청구서 정리', purpose: '월말에 청구서를 모아 정리한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '청구서 폴더를 열어 이번 달 청구서를 모은다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['read'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function 청구서담당(root) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'agent-invoice', name: '청구서 담당', purpose: '청구서 폴더만 본다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: [root],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  };
}

async function 제품(model, { now = () => NOW } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-a2-')));
  const state = join(root, '.state');
  await mkdir(state, { recursive: true });
  await mkdir(join(root, 'Downloads'), { recursive: true });
  await writeFile(join(root, 'Downloads', '견적서.pdf'), 'pdf', 'utf8');
  const store = new SessionStore(state);
  const automationStore = new AutomationJobStore(state);
  const runLedger = new AutomationRunLedger(state);
  const skillStore = new SkillDefinitionStore(state);
  const agentProfileStore = new AgentProfileStore(state);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [청구서스킬()] });
  await agentProfileStore.save({
    schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [청구서담당(root)],
  });
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    clock: now, model, env: demoEnv(),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root }),
    }),
    processEnv: {
      HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root,
    },
    startScheduler: false,
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
  return {
    server, store, automationStore, skillStore, runLedger, root, state, session,
    /** **원장 파일 실물** — T5 영수증이 아니라 디스크의 automation.json 이다. */
    원장: async () => JSON.parse(await readFile(join(state, 'automation.json'), 'utf8')),
    turn: async (text) => fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text }),
    }).then((r) => r.json()),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/**
 * 사용자가 말한 것을 그대로 `automation.propose` 로 적는 모델. **확정 동사는 안 부른다** —
 * 명시 예약이 켜지는 데 별도 손짓이 필요하면 그것이 결함이다(자동성 헌장 · `authority.js`:
 * `automate` → 자동).
 */
function 적기만하는모델(overrides = {}) {
  return { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return '알겠어.';
    if (opts.tools.some((tool) => tool.name === 'control.select')) return {
      text: '', toolCalls: [{ name: 'control.select', args: { categories: ['automation'] } }],
    };
    if (tc.automationProposal) return '적어 뒀어.';
    if (!request.trim()) return '알겠어.';
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request,
      kind: 'daily', operation: 'create', trigger: 아침9시,
      tool: 'local.file',
      action: { args: { action: 'list', path: 'Downloads' } },
      skillPurpose: '다운로드 폴더의 새 PDF 개수를 센다',
      deliveryIntent: 'chat',
      ...overrides,
    } }] };
  } };
}

// ── ① 한 문장에 job 이 실제로 선다 ────────────────────────────────────────────
test('A2 ①: "매일 아침 9시에 …" 한 문장에 job 이 선다 (candidate 아니라 job)', async () => {
  const app = await 제품(적기만하는모델());
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 1,
      `**명시 예약이 안 켜졌다** — 후보 ${(원장.candidates ?? []).length}개, job ${(원장.jobs ?? []).length}개. `
      + '비교군 둘 다 만들면 즉시 켜진다(openclaw jobs:835 · hermes jobs.py:1414). '
      + '명시 요청을 추론 레인에 두는 것은 오픈클로가 못박은 경계 위반이다(commitments.md:98-100)');
    assert.equal(원장.jobs[0].state, 'scheduled', '켜졌다면 예정 상태여야 한다');
    assert.equal(원장.jobs[0].trigger.localTime, '09:00', '사용자가 말한 시각이어야 한다');
  } finally { await app.close(); }
});

// ── ② 실행 지시문이 사용자가 말한 그 일이다 ──────────────────────────────────
test('A2 ②: job 의 실행 지시문이 사용자가 말한 그 일이다 — 남의 스킬 목적이 아니다', async () => {
  const app = await 제품(적기만하는모델());
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 원장 = await app.원장();
    const job = (원장.jobs ?? [])[0];
    assert.ok(job, '① 이 먼저 초록이어야 한다');
    assert.notEqual(job.skillRef.id, 'skill-invoice',
      '**남의 스킬에 묶였다** — 목적이 다른 일(월말 청구서 정리)이 매일 아침 자동으로 돈다');
    const skills = await app.skillStore.load();
    const 묶인것 = skills.skills.find((s) => s.id === job.skillRef.id);
    assert.ok(묶인것, '묶인 스킬이 저장소에 실재해야 한다(실행이 이걸로 지시문을 만든다)');
    // 실행 조립부(`canonical-automation-runtime.js:477-500`)가 만드는 그 지시문.
    const 지시문 = [묶인것.purpose, ...(묶인것.steps ?? []).map((s) => s.instruction ?? s.kind)].join('\n');
    assert.ok(지시문.includes('PDF'),
      `실행 지시문에 사용자가 말한 일이 없다: ${지시문}`);
    assert.ok(!지시문.includes('청구서'),
      `실행 지시문이 남의 목적이다: ${지시문}`);
    // 자족성(헤르메스 cronjob_tools.py:1401) — 이 대화 맥락 없이 시작해도 할 수 있어야 한다.
    assert.ok(지시문.includes('Downloads') || JSON.stringify(job.inputTemplate).includes('Downloads'),
      '자족적 지시문이 아니다 — 어디를 보는지가 실행 재료에 없다');
  } finally { await app.close(); }
});

// ── ③ 후보가 스킬을 안 가리키면 첫 활성 스킬을 집지 않는다 ──────────────────
test('A2 ③: 추론 후보를 확정할 때 첫 활성 스킬을 집지 않는다 — 묶지 말고 거절', async () => {
  // 시각을 **사용자가 말하지 않은** 발화. 모델이 그래도 예약을 제안하고, 확정까지 시도한다.
  const 확정까지하는모델 = { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return '알겠어.';
    const 후보 = tc.automationReality?.candidates?.items?.find((c) => c.approved !== true);
    if (후보) {
      return { text: '', toolCalls: [{ name: 'automation.control', args: {
        operation: 'commit',
        targetCandidateRef: 후보.candidateRef ?? 후보.candidateId,
        targetCandidateRevision: 후보.revision,
      } }] };
    }
    if (tc.automationProposal || !request.trim()) return '적어 뒀어.';
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request, kind: 'daily', operation: 'create', trigger: 아침9시,
      tool: 'local.file', action: { args: { action: 'list', path: 'Downloads' } },
      skillPurpose: '다운로드 폴더를 본다', deliveryIntent: 'chat',
    } }] };
  } };
  const app = await 제품(확정까지하는모델);
  try {
    await app.turn('다운로드 폴더 좀 정리해줘.');       // 시점 표현이 없다 — 추론 레인
    const 답 = await app.turn('그거 켜줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 0,
      '**스킬을 안 가리키는 후보가 첫 활성 스킬에 묶였다** — 목적이 다른 일이 자동으로 돈다');
    assert.equal(답.automationControl?.rejected, true, '묶지 말고 거절해야 한다');
    assert.ok(String(답.automationControl?.reason ?? '').length > 0, '거절 이유가 기계값으로 있어야 한다');
  } finally { await app.close(); }
});

// ── ④ 켜는 손의 반환값에 안 도는 조건이 실려 있다 ───────────────────────────
test('A2 ④: 켜는 손의 반환값에 안 도는 조건이 실려 있다 (서버 꺼짐·따라잡기·만료)', async () => {
  const app = await 제품(적기만하는모델());
  try {
    const 답 = await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 조건 = 답.automationProposal?.notRunning;
    assert.ok(조건, '**안 도는 조건이 반환값에 없다** — 「켜 뒀어요」의 절반만 참이다. '
      + '헤르메스는 같은 함정을 문장 지침이 아니라 생성 시점 기계 통지로 봉인했다'
      + '(cronjob_tools.py:341-375 — #51568)');
    assert.equal(조건.requiresAppRunning, true, 'T5 는 데몬이 아니다 — 꺼져 있으면 안 돈다');
    assert.equal(조건.schedulerKind, 'in_process_interval', 'cron·launchd 가 아니다');
    assert.equal(typeof 조건.tickIntervalMs, 'number', '틱 주기가 기계값이어야 한다');
    assert.equal(조건.catchUpLimit, 1, '따라잡기는 다음 기동 때 1회뿐(MAX_CATCH_UP_OCCURRENCES)');
    assert.equal(조건.misfirePolicy, 'catch_up_once', '놓친 실행 정책이 실제 레코드 값이어야 한다');
    assert.equal(typeof 조건.authorityExpiresAt, 'number', '권한창 만료가 기계값이어야 한다');
    assert.equal(typeof 조건.maxRuns, 'number', '권한창 횟수가 기계값이어야 한다');
  } finally { await app.close(); }
});

// ── ⑤ 실행 때 부르는 손은 여전히 헌장 판정을 탄다 ───────────────────────────
test('A2 ⑤: 자동화라고 승인을 안 건너뛴다 — 행동 종류를 못 읽는 예약은 서지 않는다', async () => {
  const app = await 제품(적기만하는모델({
    tool: '없는.손', action: { args: { action: 'list', path: 'Downloads' } },
  }));
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더를 봐줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 0,
      '**행동 종류를 못 읽는 예약이 섰다** — 헌장 판정을 안 탄 자동화다');
  } finally { await app.close(); }
});

// ── ⑥ 시각이 지나면 실제로 돈다 ─────────────────────────────────────────────
test('A2 ⑥: nextRunAt 을 과거로 둔 판에서 tick 1회 → 실행 1회 + 대화 도착', async () => {
  const app = await 제품(적기만하는모델());
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 전 = await app.원장();
    assert.equal((전.jobs ?? []).length, 1, '① 이 먼저 초록이어야 한다');
    // 시각은 당기지 않는다(닫는문서 §1) — **`nextRunAt` 을 과거로 둔 판**을 만든다.
    // 판 시각은 2026-08-10 00:00 KST 이고, 커서를 **지나간 그 아침 9시**(08-09 09:00 KST)에 둔다.
    // 임의의 "1분 전"이 아니라 실제 발생 시각이어야 달력 트리거가 그것을 놓친 회차로 읽는다.
    const 지나간아침9시 = NOW - (15 * 60 * 60 * 1000);
    await app.automationStore.update((state) => ({
      ...state,
      jobs: state.jobs.map((job) => ({
        ...job, nextRunAt: 지나간아침9시,
        trigger: { ...job.trigger, nextRunAt: 지나간아침9시 },
      })),
    }));
    const tick = await app.server.runtimeTick();
    assert.equal(tick.ran?.length, 1, `시각이 지났는데 안 돌았다: ${JSON.stringify(tick)}`);
    assert.equal(tick.ran[0].status, 'succeeded', '실행이 성공 흔적을 남겨야 한다');
    const runs = await app.runLedger.load();
    assert.equal(runs.runs.length, 1, '실행 원장에 흔적이 한 번 남아야 한다');
    const 대화 = await app.store.load(app.session.id);
    assert.equal(대화.transcript.filter((e) => e.source === 'automation').length, 1,
      '**결과가 사용자 자리에 도착하지 않았다** — 돌기만 한 것은 절반이다');
  } finally { await app.close(); }
});

// ── ⑦ 추론 제안은 여전히 후보 레인이다 ──────────────────────────────────────
test('A2 ⑦: 사용자가 시각을 안 말한 제안은 여전히 후보 레인이다 (그물이 안 넓어졌다)', async () => {
  const app = await 제품(적기만하는모델());
  try {
    await app.turn('다운로드 폴더 좀 봐줘.');       // 시점 표현 없음
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 0,
      '**추론 제안이 자동으로 켜졌다** — 그물이 넓어졌다. 오픈클로 경계: 명시만 스케줄러 레인');
    assert.equal((원장.candidates ?? []).length, 1, '후보로는 남아야 한다');
    assert.equal(원장.candidates[0].state, 'proposed', '추론 후보는 proposed 그대로');
  } finally { await app.close(); }
});
