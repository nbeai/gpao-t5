import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import {
  AUTOMATION_SCHEMA_VERSION,
  contentHash,
  skillHashSource,
  transitionState,
} from '../src/kernel/l5-growth/automation-contracts.js';
import { makeGrowthCandidate } from '../src/kernel/l5-growth/automation.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';

const CLOSE = process.env.T5_F64_PROBE_CLOSE === '1';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const PILOT_SHA = '873fb72de05f1d1143d569a9eeab34e99409d28466202aa434b6dd984df441f0';
const RUNNER_SHA = 'cb6142c4dbf6df2b69985b6c1805c3c05f5623e5a3dd5719dea000f610996efe';

async function room(prefix) {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const state = join(root, '.state');
  return { root, state };
}

async function startProduct({ root, state, model, terminalCwd = root, initialize }) {
  const store = new SessionStore(state);
  const automationStore = new AutomationJobStore(state);
  const runLedger = new AutomationRunLedger(state);
  const skillStore = new SkillDefinitionStore(state);
  const agentProfileStore = new AgentProfileStore(state);
  await initialize?.({ automationStore, runLedger, skillStore, agentProfileStore });
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    model, env: demoEnv(),
    tools: demoTools({
      localFile: makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root }),
      localTerminal: makeLocalTerminalTool({ cwd: terminalCwd, dataDir: state }),
    }),
    processEnv: { HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
  const turn = (text) => fetch(`${base}/turn`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: session.id, text }),
  }).then((r) => r.json());
  return { base, server, store, automationStore, runLedger, session, turn };
}

async function withProduct(options, fn) {
  const app = await startProduct(options);
  try { return await fn(app); }
  finally { await new Promise((resolve) => app.server.close(resolve)); }
}

const L5_FIXTURE = Object.freeze({
  '위생설비_지원공고.txt': '대상: 영업신고 후 1년 이상인 지역 내 식품접객업. 지원: 냉장·세척 설비 비용의 70%, 최대 200만원. 필수: 사업자등록증, 영업신고증, 최근 1개월 견적서, 지방세 완납증명서. 접수 전 구매한 설비는 제외.\n',
  '우리상황.txt': '지역 내 반찬가게. 영업신고 2024-03-10. 세척기 교체 예정, 아직 구매하지 않음. 받은 견적은 2026-06-15 작성.\n',
  '보유서류.txt': '사업자등록증 있음. 영업신고증 있음. 지방세 완납증명서 없음. 세척기 견적서 있음.\n',
});
const L5_SHA = Object.freeze({
  '보유서류.txt': '2ed1be38db8072afa5ce961d8334dc16cdc8fdcaf06f58e3f4235346649cd36e',
  '우리상황.txt': '27af652a128fc8763f7e337f6ae3873bbcbaeb0d97078851b18fbde9260cadfb',
  '위생설비_지원공고.txt': '5717d0c230663a72bf53512ae3d1e385d025e43226e9c1a6683dbe9bc938d202',
});

function exchangeData(exchange) {
  if (exchange?.data && typeof exchange.data === 'object') return exchange.data;
  if (typeof exchange?.data !== 'string') return {};
  try { return JSON.parse(exchange.data); } catch { return {}; }
}

/**
 * **모델이 실제로 받는 글에서 stdout 을 뽑는다.**
 *
 * 터미널 결과는 이제 JSON 통짜가 아니라 줄 구조가 살아 있는 원문으로 온다
 * (task-context `③-b 터미널` · 2026-08-14). 파일 읽기가 이미 `내용:\n` 로 같은 길을 가고
 * 있었고(바로 아래 `successfulReadTexts`), 터미널만 JSON 이라 스텁이 `JSON.parse` 로 읽고
 * 있었다. **재는 것은 그대로다** — 실행 stdout 이 결과 파일로 정확히 옮겨졌는가.
 * 다만 스텁이 보는 것을 실모델이 보는 것과 같게 맞춘다.
 */
function exchangeStdout(exchange) {
  const 값 = exchangeData(exchange).stdout;
  if (typeof 값 === 'string') return 값;
  const 글 = typeof exchange?.data === 'string' ? exchange.data : '';
  return 글.match(/^stdout 전체 [^\n]*:\n([\s\S]*)$/m)?.[1];
}

function successfulReadTexts(tc) {
  return (tc.turnExchange ?? [])
    .filter((exchange) => exchange.tool === 'local.file'
      && exchange.args?.action === 'read'
      && (typeof exchangeData(exchange).text === 'string'
        || (typeof exchange.data === 'string' && exchange.data.includes('내용:\n'))))
    .map((exchange) => ({
      path: exchange.args.path,
      text: exchangeData(exchange).text ?? String(exchange.data).split('내용:\n').slice(1).join('내용:\n'),
    }));
}

async function l5Case(correct, fixture = L5_FIXTURE) {
  const x = await room('t5-f64-l5-');
  for (const [name, text] of Object.entries(fixture)) {
    if (fixture === L5_FIXTURE) assert.equal(sha(Buffer.from(text)), L5_SHA[name]);
    await writeFile(join(x.root, name), text);
  }
  let main = 0;
  const model = { async respond(tc, opts = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
    if (!opts.tools?.length) return '준비표를 만들었어요.';
    main += 1;
    if (correct) {
      const readFacts = successfulReadTexts(tc);
      const readPaths = new Set(readFacts.map(({ path }) => path));
      const nextPath = Object.keys(fixture).find((path) => !readPaths.has(path));
      if (nextPath) return { text: '', toolCalls: [
        { name: 'local.file', args: { action: 'read', path: nextPath } },
      ] };
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: '신청준비표.md',
        // 정답 문장을 주입하지 않는다. 모델이 실제 읽기 Receipt에서 본 전문만 결과로 조립한다.
        text: readFacts.map(({ path, text }) => `## ${path}\n${text}`).join('\n'),
      } }] };
    }
    if (main === 1) return { text: '', toolCalls: [{ name: 'local.file', args: {
      action: 'write', path: '신청준비표.md',
      text: '보유: 사업자등록증, 임대차계약서, 통장사본\n준비 필요: 국세납세증명서\n일반 준비표 완료\n',
    } }] };
    return { text: '준비표를 만들었어요.', toolCalls: [] };
  } };
  return withProduct({ ...x, model }, async (app) => {
    await app.turn('신청한 건 아니고 준비만 하는 거야. 신청준비표.md로 정리해줘.');
    const saved = await app.store.load(app.session.id);
    const text = await readFile(join(x.root, '신청준비표.md'), 'utf8');
    const reads = saved.ledgerEntries.filter((r) => r.actualCall?.tool === 'local.file' && r.actualCall.args?.action === 'read');
    const completed = saved.ledgerEntries.filter((r) => r.origin === 'completion_settlement' || r.receiptRef).length;
    // 채점기는 원천 bytes를 독립적으로 읽는다. 이 값들은 provider/model 입력에 들어가지 않는다.
    const sourceTexts = await Promise.all(Object.keys(fixture).map((name) => readFile(join(x.root, name), 'utf8')));
    const purposeMet = sourceTexts.every((sourceText) => text.includes(sourceText.trim()));
    return { purposeMet, reads: reads.length, completed, text, textSha256: sha(text), fixtureSha256: sha(JSON.stringify(fixture)) };
  });
}

const L6_FALSE_SURFACE_CLAIM = '화요일 10시, 켜짐, 다음 실행도 잡혔어요.';

async function l6Case(surfaceReply = L6_FALSE_SURFACE_CLAIM) {
  const x = await room('t5-f64-l6-');
  const seen = new Set();
  const model = { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return request === '최종 상태를 알려줘'
      ? surfaceReply : '처리했어요.';
    if (!seen.has(request) && request !== '최종 상태를 알려줘') {
      seen.add(request);
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: request, operation: 'create', kind: 'weekly',
        trigger: {
          kind: 'weekly', timezone: 'Asia/Seoul', misfirePolicy: 'catch_up_once',
          weekdays: [1], localTime: '09:30', nextRunAt: 1_900_000_000_000,
        },
        tool: 'local.file', action: { args: { action: 'read', path: '지난주정산.txt' } },
        skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
      } }] };
    }
    return { text: request === '최종 상태를 알려줘'
      ? surfaceReply : '처리했어요.', toolCalls: [] };
  } };
  return withProduct({ ...x, model }, async (app) => {
    await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.');
    await app.turn('매주 월요일 오전 9시 반 알림 후보를 다시 준비해줘.');
    await app.turn('매주 화요일 오전 10시에 지난주 정산을 확인하라고 바꿔줘.');
    const final = await app.turn('최종 상태를 알려줘');
    const state = await app.automationStore.load();
    const runs = await app.runLedger.load();
    return {
      candidates: state.candidates.length, approved: state.candidates.filter((c) => c.approved).length,
      jobs: state.jobs.length, runs: runs.runs.length, surfaceReply: final.reply,
      falseSurfaceClaim: final.reply === L6_FALSE_SURFACE_CLAIM,
      purposeMet: state.jobs.some((j) => j.state === 'scheduled' && j.nextRunAt),
    };
  });
}

function l6Skill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'l6-skill', name: '주간 자료 확인', purpose: '로컬 자료를 정해진 때 확인한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '로컬 자료를 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['read'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function l6Profile(root) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'l6-agent', name: '주간 확인 담당', purpose: '허용된 로컬 자료를 확인한다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: [root],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  };
}

function l6ScheduledJob(id, skill, root) {
  const proposed = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id, name: '기존 주간 자료 확인',
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger: {
      kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [1], localTime: '09:30',
      nextRunAt: 1_900_000_000_000, misfirePolicy: 'catch_up_once',
    },
    agentProfileId: 'l6-agent', inputTemplate: {},
    authorityEnvelope: {
      ceiling: 'A1', allowedKinds: ['read'], allowedTools: ['local.file'],
      allowedTargets: [], workspaceRoots: [root], expiresAt: null,
      maxRuns: 20, maxCost: 1, requiresFreshApprovalFor: [],
    },
    deliveryPolicy: { mode: 'none' }, state: 'proposed', nextRunAt: 1_900_000_000_000,
    lastRunId: null, createdAt: 1, updatedAt: 1,
  };
  const approved = transitionState('automationJob', proposed, 'approved', 2);
  assert.equal(approved.ok, true, JSON.stringify(approved));
  const scheduled = transitionState('automationJob', approved.record, 'scheduled', 3);
  assert.equal(scheduled.ok, true, JSON.stringify(scheduled));
  return scheduled.record;
}

async function l6ApprovedCase() {
  const x = await room('t5-f64-l6-approved-');
  const skill = l6Skill();
  const profile = l6Profile(x.root);
  const seeded = l6ScheduledJob('l6-existing-job', skill, x.root);
  const candidate = makeGrowthCandidate({
    candidateId: 'l6-approved-candidate',
    statement: '매주 화요일 오전 10시에 지난주 정산을 확인한다',
    action: { tool: 'local.file', args: { action: 'read', path: '지난주정산.txt' } },
    dedupKey: 'l6-approved-candidate',
  });
  const model = { async respond() { return { text: '준비됐어요.', toolCalls: [] }; } };
  return withProduct({
    ...x, model,
    async initialize({ automationStore, skillStore, agentProfileStore }) {
      await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
      await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
      await automationStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [candidate], jobs: [seeded] });
    },
  }, async (app) => {
    const before = await app.automationStore.load();
    const storedCandidate = before.candidates.find((c) => !c.approved);
    assert.equal(storedCandidate?.candidateId, candidate.candidateId);
    const setupResponse = await fetch(`${app.base}/automation/setup?candidateId=${storedCandidate.candidateId}`);
    const setup = await setupResponse.json();
    const nextRunAt = 1_900_000_360_000;
    const approveResponse = await fetch(`${app.base}/automation/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        candidateId: storedCandidate.candidateId, skillId: skill.id, agentProfileId: profile.id,
        trigger: {
          kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [2], localTime: '10:00',
          nextRunAt, misfirePolicy: 'catch_up_once',
        },
        expiresAt: 2_000_000_000_000,
        maxRuns: 20,
      }),
    });
    const approval = await approveResponse.json();
    const after = await app.automationStore.load();
    const newJob = after.jobs.find((job) => job.id === approval.jobId);
    const runs = await app.runLedger.load();
    return {
      candidateId: storedCandidate.candidateId,
      setupStatus: setupResponse.status, setupCandidateId: setup.candidate?.candidateId,
      approvalStatus: approveResponse.status, approval, newJob,
      seededUnchanged: JSON.stringify(after.jobs.find((job) => job.id === seeded.id)) === JSON.stringify(seeded),
      jobs: after.jobs.length, runs: runs.runs.length, expectedNextRunAt: nextRunAt,
    };
  });
}

const L7_SOURCE = '상태=승인\n버전=2.4\n서버=production\n승인자=민지\n';
const L7_FIXTURE = Object.freeze({
  '초안/배포설정_최종.txt': '상태=검토중\n버전=2.3\n서버=staging\n',
  '보관/배포설정_2025.txt': '상태=승인\n버전=1.8\n서버=production\n',
  '승인본/배포설정.txt': L7_SOURCE,
  'README.txt': '배포에는 상태=승인, 가장 높은 버전, production 서버인 설정을 사용한다.\n',
});
const L7_SHA = Object.freeze({
  'README.txt': 'd666601730f75d6969a5115b3ffedbe5ce3572886a6806cfd20142d9d0ccdbf2',
  '보관/배포설정_2025.txt': 'b96ea8da5067a7fd39c29e763752fdd66311e2fdc15b3a2e137ba1f8780b21d6',
  '승인본/배포설정.txt': '2c085a02059453ef2792a22416959fd1be8662da6082decf3e3c695b2ccdae1b',
  '초안/배포설정_최종.txt': 'fb7c6dea318e6a9e78c9f8ce3c2f2e13af9bf85f30264f4dd1bba8fc7cc36faf',
});

async function l7Case(correct, { mutateStdout = false } = {}) {
  const x = await room('t5-f64-l7-');
  const home = join(x.root, 'home');
  for (const [name, text] of Object.entries(L7_FIXTURE)) {
    assert.equal(sha(Buffer.from(text)), L7_SHA[name]);
    await mkdir(join(x.root, name, '..'), { recursive: true });
    await writeFile(join(x.root, name), text);
  }
  await mkdir(home);
  const expected = sha(Buffer.from(L7_SOURCE));
  let main = 0;
  let modelObservedStdout = '';
  const model = { async respond(tc, opts = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
    if (!opts.tools?.length) return '해시 정보를 기록했어요.';
    main += 1;
    if (main === 1) return { text: '', toolCalls: [
      { name: 'local.terminal', args: { command: correct ? `shasum -a 256 ${join(x.root, '승인본/배포설정.txt')}` : 'md5 승인본/배포설정.txt' } },
      ...(!correct ? [{ name: 'local.file', args: {
        action: 'write', path: '배포_점검.txt',
        text: '파일: 승인본/배포설정.txt\n해시: 계산 실패 - 경로 확인 필요\n버전=2.4\n서버=production\n',
      } }] : []),
    ] };
    if (main === 2 && correct) {
      const terminalExchange = (tc.turnExchange ?? []).find((exchange) => exchange.tool === 'local.terminal'
        && typeof exchangeStdout(exchange) === 'string');
      const stdout = String(exchangeStdout(terminalExchange) ?? '');
      modelObservedStdout = stdout;
      const artifactStdout = mutateStdout
        ? stdout.replace(/[0-9a-f]/u, (character) => character === '0' ? '1' : '0')
        : stdout;
      return { text: '', toolCalls: [{ name: 'local.file', args: {
        action: 'write', path: '배포_점검.txt',
        // digest를 미리 넣지 않는다. 실제 terminal Receipt stdout을 다음 모델 호출이 옮긴다.
        text: `명령: shasum -a 256\n실행 결과:\n${artifactStdout}`,
      } }] };
    }
    return { text: '해시 정보를 기록했어요.', toolCalls: [] };
  } };
  return withProduct({ ...x, model, terminalCwd: home }, async (app) => {
    await app.turn('선택한 파일의 해시와 핵심 설정을 배포_점검.txt에 따로 남겨줘. 원본은 건드리지 마.');
    const saved = await app.store.load(app.session.id);
    const terminal = saved.ledgerEntries.find((r) => r.actualCall?.tool === 'local.terminal');
    const text = await readFile(join(x.root, '배포_점검.txt'), 'utf8');
    const completion = saved.ledgerEntries.filter((r) => r.origin === 'completion_settlement' || r.receiptRef).length;
    const terminalStdout = String(terminal?.result?.stdout ?? '');
    return { terminalExit: terminal?.result?.exitCode, terminalStdout, modelObservedStdout, expectedDigest: expected,
      stdoutHasExpected: terminalStdout.includes(expected), outputDigest: sha(Buffer.from(text)),
      artifact: text, hashRecorded: text.includes(expected), completion };
  });
}

test('L5 원본 형제: 자료 미관측·잘못된 보유/누락 준비표는 목적 결과가 아니다', async () => {
  assert.equal(sha(await readFile('scripts/human-use/living-sim-pilot-v1.json')), PILOT_SHA);
  assert.equal(sha(await readFile('scripts/human-use/living-sim-runner.mjs')), RUNNER_SHA);
  const observed = await l5Case(false);
  process.stdout.write(`${JSON.stringify({ probe: 'L5-red', observed })}\n`);
  assert.equal(observed.reads, 0);
  assert.equal(observed.completed, 0);
  assert.equal(observed.purposeMet, CLOSE ? true : false);
});

test('L5 정상 반대조건: 세 자료를 읽고 실제 보유·누락·기간·선구매 조건을 모두 남긴다', async () => {
  const observed = await l5Case(true);
  assert.equal(observed.reads >= 3, true);
  assert.equal(observed.purposeMet, true);
});

test('L5 정상 변형: 원천 사실이 바뀌면 read Receipt에서 조립한 산출물과 독립 채점도 함께 바뀐다', async () => {
  const changed = Object.freeze({
    ...L5_FIXTURE,
    '보유서류.txt': L5_FIXTURE['보유서류.txt'].replace('지방세 완납증명서 없음', '지방세 완납증명서 있음'),
  });
  const baseline = await l5Case(true);
  const sibling = await l5Case(true, changed);
  assert.equal(sibling.purposeMet, true);
  assert.notEqual(sibling.textSha256, baseline.textSha256);
  assert.match(sibling.text, /지방세 완납증명서 있음/u);
  assert.doesNotMatch(sibling.text, /지방세 완납증명서 없음/u);
});

// **동결 관측을 손으로 옮긴다**(2026-08-12 · `design/T5-AUTOMATION-CLOSE-ko.md` §4 넓힘 1번).
// `preflight.mjs` 의 기준지문과 같은 규율이다: *"제품 코드가 정당하게 바뀌면 이 값을 손으로
// 옮기고 왜 바뀌었는지 함께 적는다 — 스스로 갱신되는 기준선은 기준선이 아니다."*
//
// 옛 동결값 `[후보 3, 승인 0, job 0, run 0]` 은 **명시 요청이 추론 레인에 갇혀 있던** 원본
// 결함의 사진이었다. 자동성 헌장(`kernel/l2-plan/authority.js`: *"automate → 자동"*)과
// 오너 지시(2026-08-12 *"불필요한 승인카드는 모두 없애야해"*)대로 명시 예약이 그 자리에서
// 켜지므로, 같은 발화 셋은 이제 `[3, 3, 3, 0]` 을 낸다.
// **안 움직인 축이 이 검사의 알맹이다**: run 0 — 등록은 실행이 아니다.
test('L6 원본이 닫혔다: 같은 발화 셋이 job 3 으로 서고 예정 시각 전 실행은 0', async () => {
  const observed = await l6Case();
  const 옛정직문 = await l6Case('후보만 있고 아직 켜지지 않았어요. 다음 실행은 정해지지 않았어요.');
  process.stdout.write(`${JSON.stringify({ probe: 'L6-closed', observed })}\n`);
  assert.deepEqual([observed.candidates, observed.approved, observed.jobs, observed.runs], [3, 3, 3, 0]);
  assert.equal(observed.surfaceReply, L6_FALSE_SURFACE_CLAIM, '동결된 surface fixture 신분');
  assert.equal(observed.purposeMet, true, '명시 예약이 실제로 켜져 있어야 한다');
  // 옛 "정직한" 문장은 이제 **원장과 어긋난다** — 기준은 문장이 아니라 원장이다.
  assert.deepEqual([옛정직문.candidates, 옛정직문.approved, 옛정직문.jobs, 옛정직문.runs], [3, 3, 3, 0]);
  assert.equal(옛정직문.purposeMet, true,
    '원장이 움직였는데 옛 문장을 그대로 두면 그것이 새 거짓말이다');
});

test('L6 정상 반대조건: 실제 setup·approve 경로가 예약 job을 만들고 기존 job과 실행 원장을 보존한다', async () => {
  const observed = await l6ApprovedCase();
  assert.equal(observed.setupStatus, 200);
  assert.equal(observed.approvalStatus, 200, JSON.stringify(observed.approval));
  assert.equal(observed.setupCandidateId, observed.candidateId);
  assert.equal(observed.approval.ok, true);
  assert.equal(observed.newJob?.state, 'scheduled');
  assert.equal(observed.newJob?.nextRunAt, observed.expectedNextRunAt);
  assert.equal(observed.jobs, 2);
  assert.equal(observed.runs, 0, '예정 시각 전에는 실행 실물이 없어야 한다');
  assert.equal(observed.seededUnchanged, true, '다른 예약 job은 승인 경로가 바꾸지 않는다');
});

test('L7 원본 형제: 해시 실행 실패와 실패문구 결과 파일은 해시 기록 목적 결과가 아니다', async () => {
  const observed = await l7Case(false);
  process.stdout.write(`${JSON.stringify({ probe: 'L7-red', observed })}\n`);
  assert.equal(observed.terminalExit, 1);
  assert.equal(observed.completion, 0);
  assert.equal(observed.hashRecorded, CLOSE ? true : false);
});

test('L7 정상 반대조건: 성공 명령 digest가 결과 파일에 정확히 기록된다', async () => {
  const observed = await l7Case(true);
  assert.equal(observed.terminalExit, 0);
  assert.equal(observed.stdoutHasExpected, true);
  assert.equal(observed.hashRecorded, true);
  assert.match(observed.artifact, /명령: shasum -a 256/u);
  assert.equal(observed.artifact.includes(observed.modelObservedStdout.trim()), true);
});

test('L7 결속 반례: 성공 stdout을 변형해 쓰면 독립 source digest 자를 통과하지 못한다', async () => {
  const observed = await l7Case(true, { mutateStdout: true });
  assert.equal(observed.terminalExit, 0);
  assert.equal(observed.stdoutHasExpected, true, '실행 Receipt 자체는 올바른 digest를 가져야 한다');
  assert.equal(observed.hashRecorded, false, '결과 파일의 변형 digest는 목적 결과가 아니다');
  assert.equal(observed.artifact.includes(observed.modelObservedStdout.trim()), false);
});
