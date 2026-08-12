import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectAutomationCandidate, makeGrowthCandidate, approveAutomation,
  isJobRunnable, cancelJob, admitTickTrigger, nextBackoffMs, resolveAfterRun,
} from '../src/kernel/l5-growth/automation.js';
import { tickAutomation } from '../src/runtime/automation-engine.js';
import { AutomationScheduler } from '../src/runtime/automation-scheduler.js';
import { ToolRunner } from '../src/runtime/tool-runner.js';
import { buildSelfState } from '../src/kernel/l0-evidence/self-state.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import {
  AUTOMATION_SCHEMA_VERSION, contentHash, skillHashSource,
} from '../src/kernel/l5-growth/automation-contracts.js';

const selfState = buildSelfState(demoEnv());
const tools = demoTools();
const localAction = { tool: 'local.file', args: { action: 'read', operation: 'read', path: '/tmp/t5-automation-fixture.txt' } };
const sendAction = { tool: 'slack.post', args: { channel: 'test', text: '정리' } }; // 외부 대상이 고정된 후보

function candidateFor(action, statement = '매주 파일 정리해줘') {
  const c = detectAutomationCandidate(statement, action);
  assert.ok(c, '반복 신호 → 후보');
  return makeGrowthCandidate({ candidateId: 'c1', statement: c.statement, action: c.action });
}

// ── 필수 1) 승인 전 자동화 실행 0 — 후보는 실행이 아니다(승인 전 영향 0). ──
test('승인 전: 후보만 있고 job이 없으면 실행 0', async () => {
  const cand = candidateFor(localAction);
  assert.equal(cand.approved, false, '후보는 승인 안 됨');
  const ran = await tickAutomation([], { tools, selfState, now: 1000 });
  assert.equal(ran.length, 0, '승인 전에는 실행 경로 자체가 없다');
});

// 불변식(목록 아님): isJobRunnable는 scheduled+미만료+도달만 허용. 취소·완료·만료는 절대 실행 금지.
test('불변식: 취소·완료·만료·미도달·만료는 실행 불가', () => {
  const base = { state: 'scheduled', nextRunAt: 0, grantScope: {} };
  assert.equal(isJobRunnable(base, 10), true);
  assert.equal(isJobRunnable({ ...base, state: 'cancelled' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'completed' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'expired' }, 10), false);
  assert.equal(isJobRunnable({ ...base, state: 'paused' }, 10), false);
  assert.equal(isJobRunnable({ ...base, nextRunAt: 100 }, 10), false, '미도달');
  assert.equal(isJobRunnable({ ...base, grantScope: { expiresAt: 5 } }, 10), false, '만료');
});

// ── 필수 2) 승인 후 tick 1회 실행. 재-tick은 실행 안 함(1회 job). ──
test('승인 후: tick에서 정확히 1회 실행', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j1', now: 1000, nextRunAt: 1000 });
  const jobs = [job];
  const ran1 = await tickAutomation(jobs, { tools, selfState, now: 1000 });
  assert.equal(ran1.length, 1, '승인 후 1회 실행');
  assert.equal(job.state, 'completed');
  assert.equal(job.executions.length, 1);
  const ran2 = await tickAutomation(jobs, { tools, selfState, now: 2000 });
  assert.equal(ran2.length, 0, '완료된 job은 다시 실행 안 함');
});

// ── 필수 3) 만료 자동화 미실행 → expired로 정직하게. ──
test('만료: 만료된 자동화는 실행하지 않고 expired로 남는다', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j2', now: 0, nextRunAt: 0, grantScope: { kind: 'session', expiresAt: 500 } });
  const ran = await tickAutomation([job], { tools, selfState, now: 1000 }); // now > expiresAt
  assert.equal(ran.length, 0);
  assert.equal(job.state, 'expired');
  assert.equal(job.executions.length, 0, '만료면 실행 원장도 비어 있다');
});

// ── 필수 4) 취소 자동화 미실행. ──
test('취소: 취소한 자동화는 실행하지 않는다', async () => {
  let job = approveAutomation(candidateFor(localAction), { id: 'j3', now: 0, nextRunAt: 0 });
  job = cancelJob(job);
  assert.equal(job.state, 'cancelled');
  const ran = await tickAutomation([job], { tools, selfState, now: 1000 });
  assert.equal(ran.length, 0);
  assert.equal(job.executions.length, 0);
});

// 옛 실행기는 승인 계약을 충분히 표현하지 못하므로 안전 바닥을 실행하지 않는다.
test('외부 전송: 옛 tick 경로에서는 승인 범위가 있어도 실행하지 않는다', async () => {
  const cand = candidateFor(sendAction, '매일 슬랙에 정리 올려줘');
  const job = approveAutomation(cand, { id: 'j4', now: 0, nextRunAt: 0, external: true, grantScope: { kind: 'session', expiresAt: 1000 } });
  assert.equal(job.external, true);
  const ran = await tickAutomation([job], { tools, selfState, now: 500 });
  assert.equal(ran.length, 0, '옛 실행기가 외부 전송을 무인 실행했다');
  assert.equal(job.state, 'paused');
  // 만료 후 동일 후보를 새 job으로 검증 — 승인 범위 밖은 실행 안 함(재승인 필요).
  const job2 = approveAutomation(cand, { id: 'j5', now: 0, nextRunAt: 0, external: true, grantScope: { kind: 'session', expiresAt: 1000 } });
  const ran2 = await tickAutomation([job2], { tools, selfState, now: 2000 });
  assert.equal(ran2.length, 0, '만료 후에는 실행 안 함');
  assert.equal(job2.state, 'expired');
});

// ── 필수 6) 실행 결과가 원장(Truth Ledger)에 ToolReceipt로 남는다. ──
test('원장: 실행 결과가 ToolReceipt로 남는다', async () => {
  const job = approveAutomation(candidateFor(localAction), { id: 'j6', now: 0, nextRunAt: 0 });
  await tickAutomation([job], { tools, selfState, now: 100 });
  const rec = job.executions.at(-1);
  assert.ok(rec, '실행 원장에 receipt');
  assert.equal(rec.failureState, 'none');
  assert.ok(rec.intended && rec.actualCall, 'intended·actualCall 기록');
});

// 안전 바닥 차단도 정직하게 남는다.
test('원장: 안전 바닥 차단도 정직하게 남는다', async () => {
  const job = approveAutomation(candidateFor({ tool: 'mail.send', args: {} }), { id: 'j7', now: 0, nextRunAt: 0 });
  await tickAutomation([job], { tools, selfState, now: 100 });
  const rec = job.executions.at(-1);
  assert.notEqual(rec.failureState, 'none', '실행 불가는 정직하게');
  assert.equal(job.state, 'paused');
});

// ── 필수 7) 일반 대화 흐름 미교란 — 반복 신호 없으면 후보 0. ──
test('일반 대화: 반복 신호 없으면 자동화 후보 0', () => {
  assert.equal(detectAutomationCandidate('오늘 뉴스 요약해줘', localAction), null);
  assert.equal(detectAutomationCandidate('안녕', localAction), null);
  const noAction = detectAutomationCandidate('매주 정리', null);
  assert.equal(noAction.action, null, 'action 없는 후보는 실행 불가');
});

// ── 서버 통합: 후보 → 승인 → tick → 원장 → 취소. 외부는 만료 없는 승인 거부. ──
const TICK_TOKEN = 'test-tick-token';
function canonicalSkill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'test-skill', name: '로컬 파일 정리', purpose: '로컬 파일 목록을 읽어 정리한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '로컬 파일 목록을 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file', 'slack.post'],
    authorityHints: ['read', 'send'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 0, updatedAt: 0, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}

function canonicalProfile() {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'test-agent', name: '로컬 정리 담당', purpose: '로컬 파일 정리를 수행한다',
    modelRole: 'worker', toolAllowlist: ['local.file', 'slack.post'], workspaceScope: ['/tmp'],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A2', state: 'active', createdAt: 0, updatedAt: 0,
  };
}

function canonicalApproval(candidateId, overrides = {}) {
  const now = Date.now();
  return {
    candidateId, skillId: 'test-skill', agentProfileId: 'test-agent',
    trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
    ...overrides,
  };
}

function canonicalEnvelope() {
  return {
    ceiling: 'A0', allowedKinds: ['read'], allowedTools: ['local.file'],
    allowedTargets: [], workspaceRoots: ['/tmp'], expiresAt: null, maxRuns: 1, maxCost: 1,
    requiresFreshApprovalFor: [],
  };
}

function structuredAutomationModel(path, { once = false } = {}) {
  const proposedTurns = new Set();
  return { async respond(tc, opts = {}) {
    const turnKey = JSON.stringify(tc.turnRef ?? [tc.currentRequest, tc.currentTime]);
    if (!proposedTurns.has(turnKey)
      && opts.tools?.some((entry) => entry.name === 'automation.propose')) {
      proposedTurns.add(turnKey);
      const at = Date.now();
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: once ? '파일 목록을 한 번 확인한다' : '매주 파일 목록을 확인한다',
        operation: 'create', kind: once ? 'once' : 'weekly',
        trigger: once ? {
          kind: 'once', timezone: 'UTC', at, nextRunAt: at, misfirePolicy: 'catch_up_once',
        } : {
          kind: 'weekly', timezone: 'UTC', weekdays: [1], localTime: '09:00',
          nextRunAt: at + 60_000, misfirePolicy: 'catch_up_once',
        },
        tool: 'local.file', action: { args: { action: 'read', path } },
        skillPurpose: '파일 목록 확인', deliveryIntent: 'none',
      } }] };
    }
    return { text: '후보로 준비했어요.', toolCalls: [] };
  } };
}

async function withServer(fn, { model } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-auto-'));
  const autoStore = new AutomationJobStore(dir);
  const skillStore = new SkillDefinitionStore(dir);
  const profileStore = new AgentProfileStore(dir);
  const runLedger = new AutomationRunLedger(dir);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [canonicalSkill()] });
  await profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [canonicalProfile()] });
  const server = makeServer({
    store: new SessionStore(dir), automationStore: autoStore, skillStore,
    agentProfileStore: profileStore, automationRunLedger: runLedger, runtimeToken: TICK_TOKEN,
    ...(model ? { model } : {}),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { return await fn(base, autoStore, server, runLedger); }
  finally { await new Promise((r) => server.close(r)); }
}
/**
 * 응답을 JSON 으로 읽되, **아니면 무엇을 받았는지 말하고 죽는다.**
 *
 * 예전에는 그냥 `.json()` 이었다. 병렬 부하에서 한 번씩 `<!doctype …>` 이 와서 파싱이
 * 터졌는데, 남는 것이 "JSON.parse 실패"뿐이라 **어느 요청이 무엇을 받았는지 알 수 없었다.**
 * 원인을 못 찾으면 남는 선택은 직렬화로 숨기거나 재시도로 넘기는 것뿐인데, 둘 다 사실을
 * 지우는 짓이다. 그래서 실패한 그 순간을 통째로 남긴다.
 */
async function json응답(res, 무엇) {
  const 본문 = await res.text();
  try { return JSON.parse(본문); } catch {
    throw new Error([
      `JSON 이 아니다 — ${무엇}`,
      `  status=${res.status} ${res.statusText}`,
      `  content-type=${res.headers.get('content-type')}`,
      `  server=${res.headers.get('x-t5-server') ?? '(표식 없음)'} date=${res.headers.get('date')}`,
      `  body(0..200)=${JSON.stringify(본문.slice(0, 200))}`,
    ].join('\n'));
  }
}

const post = (base, path, body) =>
  fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const postj = async (base, path, body) => json응답(await post(base, path, body), `POST ${base}${path}`);
const getj = async (base, path) => json응답(await fetch(`${base}${path}`), `GET ${base}${path}`);
// tick은 런타임 이벤트로만(§8.3) — 트러스트 토큰을 실어 호출. 사용자 요청은 이 토큰이 없다.
const tick = (base) =>
  fetch(`${base}/automation/tick`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-runtime-token': TICK_TOKEN } });
const tickj = async (base) => json응답(await tick(base), `POST ${base}/automation/tick`);

test('서버: 후보 승인 → tick 실행 → 원장 기록', async () => {
  await withServer(async (base, autoStore, server, runLedger) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    const approved = await postj(base, '/automation/approve', canonicalApproval('c1'));
    assert.equal(approved.ok, true);
    let view = await getj(base, '/automation');
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].state, 'scheduled');
    assert.equal(view.candidates.length, 0, '승인된 후보는 후보 목록에서 빠진다');
    const ticked = await tickj(base);
    assert.equal(ticked.ran.length, 1);
    assert.equal(ticked.ran[0].status, 'succeeded', JSON.stringify(await runLedger.load()));
    view = await getj(base, '/automation');
    assert.equal(view.jobs[0].state, 'scheduled', '반복 계약과 실행 결과는 다른 상태다');
    assert.equal(view.runs.length, 1, '실행 원장에 1회');
    assert.equal(view.runs[0].status, 'succeeded');
  });
});

test('서버: 자동화 설정은 후보와 맞는 활성 스킬·담당 역할만 보여준다', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({
      candidateId: 'setup-1', statement: '매주 파일을 읽는다', action: localAction,
    })], jobs: [] });
    const setup = await getj(base, '/automation/setup?candidateId=setup-1');
    assert.equal(setup.ok, true);
    assert.deepEqual(setup.skills.map((entry) => entry.id), ['test-skill']);
    assert.deepEqual(setup.profiles.map((entry) => entry.id), ['test-agent']);
  });
});

test('서버: 승인 요청은 후보의 실행 인자·권한을 다른 내용으로 바꿀 수 없다', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({
      candidateId: 'bound-1', statement: '매주 파일을 읽는다', action: localAction,
    })], jobs: [] });
    const response = await post(base, '/automation/approve', canonicalApproval('bound-1', {
      inputTemplate: { action: 'delete', path: '/tmp/other.txt' },
      authorityEnvelope: { ...canonicalEnvelope(), ceiling: 'A2', allowedKinds: ['write'] },
    }));
    assert.equal(response.status, 400);
    assert.equal((await getj(base, '/automation')).jobs.length, 0);
  });
});

test('서버: 외부 전송 자동화는 만료 없는 승인을 거부한다(A2)', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({ candidateId: 'c2', statement: '매일 슬랙', action: sendAction })], jobs: [] });
    const rej = await post(base, '/automation/approve', canonicalApproval('c2', {
      trigger: { kind: 'daily', timezone: 'UTC', localTime: '09:00', nextRunAt: Date.now(), misfirePolicy: 'catch_up_once' },
    }));
    assert.equal(rej.status, 422, '반복 외부 전송은 만료 필요');
    const rejected = await json응답(rej, `POST ${base}/automation/approve (만료 없음)`);
    assert.match(JSON.stringify(rejected), /repeated_requires_expiry/);
    const expiresAt = Date.now() + 3600_000;
    const ok = await postj(base, '/automation/approve', canonicalApproval('c2', {
      trigger: { kind: 'daily', timezone: 'UTC', localTime: '09:00', nextRunAt: Date.now(), misfirePolicy: 'catch_up_once' },
      expiresAt,
    }));
    assert.equal(ok.ok, true);
    assert.equal(ok.state, 'scheduled');
  });
});

test('서버: 취소한 자동화는 tick에서 실행되지 않는다', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({ candidateId: 'c3', statement: '매주 정리', action: localAction })], jobs: [] });
    const { jobId } = await postj(base, '/automation/approve', canonicalApproval('c3'));
    const cancelled = await postj(base, '/automation/cancel', { jobId });
    assert.equal(cancelled.state, 'cancelled');
    const ticked = await tickj(base);
    assert.equal(ticked.ran.length, 0, '취소된 job은 실행 안 함');
  });
});

// 산출물 검증(원칙 1): 모델의 구조 제안이 /turn→원장 저장으로 관통하는지.
//
// **2026-08-12 계약 이동**(`design/T5-AUTOMATION-CLOSE-ko.md` §4 넓힘 1번). 옛 판은 여기서
// *"후보로 저장됨(자동 승인 아님)"* 을 쟀다. 사용자가 **스스로 시점을 말한** 요청("매주 …")은
// 이제 명시 예약 레인이고 그 자리에서 켜진다 — 자동성 헌장(`kernel/l2-plan/authority.js`):
// *"automate → 자동. 문지기는 사후 교정 표면(오너: 사전 게이트 금지)"*, 그리고 오너 지시
// (2026-08-12) *"불필요한 승인카드는 모두 없애야해."* 오픈클로도 같은 경계다
// (`docs/concepts/commitments.md:98-100`: 명시 요청은 스케줄러 레인, 추론만 후보 레인).
// 재는 것은 그대로다 — **모델 구조 제안이 실경로로 원장까지 관통하는가.**
test('서버: structured model proposal → 제안 카드 + 원장 저장(실경로)', async () => {
  await withServer(async (base) => {
    const s = await postj(base, '/sessions');
    const r = await postj(base, '/turn', { sessionId: s.id, text: '매주 /tmp 파일 목록 정리해줘' });
    assert.ok(r.automationProposal, '구조 제안 → 제안 카드');
    assert.ok(r.automationProposal.candidateId, 'UI 승인용 candidateId');
    const view = await getj(base, '/automation');
    assert.equal(view.jobs.length, 1, '명시 예약은 그 자리에서 켜진다');
    assert.equal(view.candidates.length, 0, '켜진 것은 후보 목록에 남지 않는다');
    // 같은 발화 재입력 → 중복 등록 안 함(이미 켜져 있으면 그 예약이 답이다).
    // 같은 controlRef 로 다시 오면 `alreadyScheduled` 로 그 예약을 돌려준다 —
    // 두 번 말했다고 예약이 둘 서지 않는다(a1-commit-hand 가 그 자리를 정면으로 문다).
    const r2 = await postj(base, '/turn', { sessionId: s.id, text: '매주 /tmp 파일 목록 정리해줘' });
    assert.equal(r2.automationProposal?.candidateId, undefined, '새 후보 카드를 또 세우지 않는다');
    assert.equal((await getj(base, '/automation')).jobs.length, 1, '예약은 여전히 하나');
  }, { model: structuredAutomationModel('/tmp/t5-automation-list.txt') });
});

// 전체 경로 회귀(감사 보정): /sessions → /turn structured proposal → tick → runs 1.
// 위와 같은 계약 이동 — 중간의 `/automation/approve` 손짓이 명시 예약에서 사라졌다.
// `/automation/approve` 라우트 자체는 아래 `canonicalApproval` 검사들이 그대로 무다.
test('서버: 전체 경로 /turn structured proposal → tick → 원장 runs 1', async () => {
  await withServer(async (base, autoStore, server, runLedger) => {
    const s = await postj(base, '/sessions');
    const r = await postj(base, '/turn', { sessionId: s.id, text: '매주 /tmp/t5-automation-fixture.txt 읽어서 정리해줘' });
    assert.ok(r.automationProposal?.jobRef, `명시 예약이 안 켜졌다: ${JSON.stringify(r.automationProposal)}`);
    const stored = (await getj(base, '/automation')).jobs[0];
    assert.equal(stored.authorityEnvelope?.allowedTools?.[0], 'local.file');
    const ticked = await tickj(base);
    assert.equal(ticked.ran.length, 1);
    assert.equal(ticked.ran[0].status, 'succeeded', JSON.stringify(await runLedger.load()));
    const view = await getj(base, '/automation');
    assert.equal(view.jobs.length, 1);
    assert.equal(view.jobs[0].state, 'scheduled');
    assert.equal(view.runs.length, 1, 'AutomationRunLedger에 실행 1건');
    assert.equal(view.runs[0].status, 'succeeded');
  }, { model: structuredAutomationModel('/tmp/t5-automation-fixture.txt', { once: true }) });
});

test('서버: 일반 대화 turn은 자동화 후보를 만들지 않는다(흐름 미교란)', async () => {
  await withServer(async (base) => {
    const s = await postj(base, '/sessions');
    const r = await postj(base, '/turn', { sessionId: s.id, text: '안녕' });
    assert.equal(r.kind, 'reply');
    assert.equal(r.automationSuggestion, undefined, '반복 신호 없으면 제안 0');
    assert.deepEqual((await getj(base, '/automation')).candidates, []);
  });
});

// ── 후속 슬라이스: tick 트러스트 경계(§8.3) + 반복 스케줄러 ──

// 불변식: tick은 trusted_runtime_event만 트리거한다. 사용자·자동화 인바운드·빈 값은 불허.
test('불변식: admitTickTrigger는 trusted_runtime_event만 허용', () => {
  assert.equal(admitTickTrigger({ source: 'trusted_runtime_event' }), true);
  assert.equal(admitTickTrigger({ source: 'user_chat' }), false);
  assert.equal(admitTickTrigger({ source: 'automation_trigger' }), false, '게이트 대상 외부 이벤트는 tick 아님');
  assert.equal(admitTickTrigger({ source: 'external_channel' }), false);
  assert.equal(admitTickTrigger({}), false);
  assert.equal(admitTickTrigger(null), false);
});

// 핵심 경계: 사용자가 누르듯 토큰 없이 tick을 치면 실행 0(403). "사용자 버튼 아님"을 산출물에서 고정.
test('서버: 트러스트 토큰 없는 tick은 거부되고 실행 0(not_trusted)', async () => {
  await withServer(async (base, autoStore) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    await post(base, '/automation/approve', canonicalApproval('c1'));
    // 토큰 없이 일반 POST(=사용자 요청 흉내) → 403, job은 scheduled 그대로.
    const res = await post(base, '/automation/tick');
    assert.equal(res.status, 403);
    assert.equal((await json응답(res, `POST ${base}/automation/tick (토큰 없음)`)).reason, 'not_trusted');
    const view = await getj(base, '/automation');
    assert.equal(view.jobs[0].state, 'scheduled', '거부됐으니 실행 안 됨');
    assert.equal(view.runs.length, 0);
    // 트러스트 토큰을 실으면 정상 실행(대조).
    const ok = await tickj(base);
    assert.equal(ok.ran.length, 1);
    assert.equal((await getj(base, '/automation')).runs.length, 1);
  });
});

// in-process 스케줄러는 trusted_runtime_event로 발화하고, server.runtimeTick 경로로 실제 실행한다.
test('서버: 스케줄러 발화(runtimeTick)로 tick이 실제 실행된다', async () => {
  await withServer(async (base, autoStore, server) => {
    await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [makeGrowthCandidate({ candidateId: 'c1', statement: '매주 정리', action: localAction })], jobs: [] });
    await post(base, '/automation/approve', canonicalApproval('c1'));
    const scheduler = new AutomationScheduler({ onTick: server.runtimeTick });
    const out = await scheduler.fire(); // 실타이머 없이 1회 발화(결정적)
    assert.equal(out.ok, true);
    assert.equal(out.ran.length, 1, '스케줄러 발화로 실행됨');
    assert.equal((await getj(base, '/automation')).runs.length, 1);
  });
});

// 반복(interval) job: 스케줄러가 여러 번 발화하면 여러 번 실행되고, 매번 AutomationLedger에 쌓인다.
test('반복 job: 연속 tick에서 여러 번 실행되고 재예약된다', async () => {
  // engine 직접 구동(결정적 now). interval=100ms 반복 job.
  const cand = candidateFor(localAction, '매일 로컬 정리');
  const job = approveAutomation(cand, { id: 'r1', now: 0, nextRunAt: 0, intervalMs: 100 });
  const ran1 = await tickAutomation([job], { tools, selfState, now: 0 });
  assert.equal(ran1.length, 1, '1차 실행');
  assert.equal(job.state, 'scheduled', '반복은 완료되지 않고 재예약');
  assert.equal(job.nextRunAt, 100, 'nextRunAt 재예약');
  // 아직 nextRunAt 미도달 → 실행 안 함
  assert.equal((await tickAutomation([job], { tools, selfState, now: 50 })).length, 0, '미도달은 실행 0');
  // 도달 → 2차 실행
  const ran2 = await tickAutomation([job], { tools, selfState, now: 100 });
  assert.equal(ran2.length, 1, '2차 실행');
  assert.equal(job.executions.length, 2, 'AutomationLedger에 2건 누적');
  assert.equal(job.nextRunAt, 200);
});

// 스케줄러는 프로세스를 붙잡지 않는다(unref) — start/stop이 타이머를 정리한다.
test('스케줄러: start/stop이 타이머를 정리한다(데몬 아님)', () => {
  let fired = 0;
  const s = new AutomationScheduler({ onTick: async () => { fired++; }, intervalMs: 10_000 });
  s.start();
  assert.ok(s._timer, '기동됨');
  s.start(); // 중복 기동 금지
  s.stop();
  assert.equal(s._timer, null, '정지됨');
});

// ── P6-4 Automation Reliability Guard: 백오프·포기·중첩·만료 ──

// 실행 가능한 도구를 가진 결정적 컨텍스트(성공/transient실패/permanent차단).
function reliabilityCtx() {
  const env = {
    model: { authSignal: 'ok' },
    connections: [
      { id: 'ok', status: 'usable', connected: true, toolKind: 'read' },
      { id: 'flaky', status: 'usable', connected: true, toolKind: 'read' },
      { id: 'wall', status: 'usable', connected: true, toolKind: 'read' },
    ],
    grantedAuthorities: [],
  };
  const tools = new ToolRunner({
    ok: { async handler() { return { result: {}, userSafeSummary: '됨' }; } },
    flaky: { async handler() { throw new Error('transient'); } }, // → failed(transient)
    wall: { async handler() { return { blocked: true, userSafeSummary: '차단' }; } }, // → blocked(permanent)
  });
  return { self: buildSelfState(env), tools };
}

test('신뢰성: nextBackoffMs는 지수 증가하고 cap에서 포화한다', () => {
  assert.equal(nextBackoffMs(1, { baseMs: 10, capMs: 1000 }), 10);
  assert.equal(nextBackoffMs(2, { baseMs: 10, capMs: 1000 }), 20);
  assert.equal(nextBackoffMs(3, { baseMs: 10, capMs: 1000 }), 40);
  assert.equal(nextBackoffMs(10, { baseMs: 10, capMs: 100 }), 100, 'cap 포화');
  assert.equal(nextBackoffMs(0, { baseMs: 10, capMs: 1000 }), 10, 'fc<1은 1로 취급');
});

test('신뢰성: resolveAfterRun — 성공 리셋 / permanent 즉시 포기 / transient 백오프', () => {
  // 성공(반복): 재예약 + failureCount 0
  assert.deepEqual(resolveAfterRun({ intervalMs: 100, failureCount: 3 }, 'none', 1000), { state: 'scheduled', nextRunAt: 1100, failureCount: 0 });
  // 성공(1회): completed
  assert.deepEqual(resolveAfterRun({ failureCount: 2 }, 'none', 1000), { state: 'completed', failureCount: 0 });
  // permanent(차단): 즉시 failed(재시도 없음)
  assert.deepEqual(resolveAfterRun({ failureCount: 0 }, 'blocked', 1000), { state: 'failed', failureCount: 1 });
  // transient(cap 미만): 백오프 재예약
  const r = resolveAfterRun({ failureCount: 0, maxAttempts: 5, backoffBaseMs: 10 }, 'failed', 1000);
  assert.deepEqual(r, { state: 'scheduled', nextRunAt: 1010, failureCount: 1 });
  // transient(maxAttempts 도달): failed
  assert.deepEqual(resolveAfterRun({ failureCount: 4, maxAttempts: 5 }, 'timeout', 1000), { state: 'failed', failureCount: 5 });
});

test('신뢰성: transient 실패는 백오프 재시도 후 maxAttempts에서 포기(failed)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'flaky', args: {} } },
    { id: 'f1', now: 0, nextRunAt: 0, intervalMs: 100, maxAttempts: 3, backoffBaseMs: 10, backoffCapMs: 1000 });
  await tickAutomation([job], { tools, selfState: self, now: 0 });   // 1차 실패
  assert.equal(job.state, 'scheduled'); assert.equal(job.failureCount, 1); assert.equal(job.nextRunAt, 10);
  assert.equal((await tickAutomation([job], { tools, selfState: self, now: 5 })).length, 0, '백오프 미도달은 실행 0');
  await tickAutomation([job], { tools, selfState: self, now: 10 });  // 2차 실패
  assert.equal(job.failureCount, 2); assert.equal(job.nextRunAt, 30);
  await tickAutomation([job], { tools, selfState: self, now: 30 });  // 3차 → maxAttempts 도달
  assert.equal(job.state, 'failed', 'maxAttempts 초과 → 정직하게 포기');
  assert.equal(job.executions.length, 3, '원장에 3회 실패');
  assert.equal((await tickAutomation([job], { tools, selfState: self, now: 100 })).length, 0, 'failed는 다시 실행 안 함');
});

test('신뢰성: permanent 실패(차단)는 재시도 없이 즉시 포기(무한 재전송 차단)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'wall', args: {} } },
    { id: 'w1', now: 0, nextRunAt: 0, intervalMs: 100 });
  await tickAutomation([job], { tools, selfState: self, now: 0 });
  assert.equal(job.state, 'failed', '차단은 재시도로 안 풀린다 → 즉시 포기');
  assert.equal(job.failureCount, 1);
  const ran = await tickAutomation([job], { tools, selfState: self, now: 200 });
  assert.equal(ran.length, 0, '재전송 반복 없음');
  assert.equal(job.executions.length, 1);
});

test('신뢰성: 백오프 대기 중 만료되면 expired(만료가 재시도보다 우선)', async () => {
  const { self, tools } = reliabilityCtx();
  const job = approveAutomation({ statement: 'x', action: { tool: 'flaky', args: {} } },
    { id: 'e1', now: 0, nextRunAt: 0, intervalMs: 100, maxAttempts: 5, backoffBaseMs: 1000, grantScope: { kind: 'session', expiresAt: 500 } });
  await tickAutomation([job], { tools, selfState: self, now: 0 }); // 실패 → 백오프 nextRunAt=1000
  assert.equal(job.state, 'scheduled'); assert.equal(job.nextRunAt, 1000);
  const ran = await tickAutomation([job], { tools, selfState: self, now: 600 }); // 만료(>500)
  assert.equal(ran.length, 0);
  assert.equal(job.state, 'expired', '백오프 대기 중이라도 만료 우선');
});

test('신뢰성: tick 중첩 방지 — 겹친 tick은 skip되고 job은 1회만 실행', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-lock-'));
  const autoStore = new AutomationJobStore(dir);
  const skillStore = new SkillDefinitionStore(dir);
  const profileStore = new AgentProfileStore(dir);
  const runLedger = new AutomationRunLedger(dir);
  let release; const gate = new Promise((r) => { release = r; });
  let modelCalls = 0;
  const model = { async respond() { modelCalls++; await gate; return '완료'; } };
  const now = Date.now();
  const skill = canonicalSkill();
  const profile = canonicalProfile();
  const scheduled = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION, id: 's1', name: '겹침 검사',
    skillRef: { id: skill.id, version: skill.version, contentHash: skill.contentHash },
    trigger: { kind: 'once', timezone: 'UTC', at: now, nextRunAt: now, misfirePolicy: 'catch_up_once' },
    agentProfileId: profile.id,
    inputTemplate: { operation: 'read', path: '/tmp/t5-automation-fixture.txt' },
    authorityEnvelope: canonicalEnvelope(),
    deliveryPolicy: { mode: 'none' }, state: 'scheduled', nextRunAt: now,
    lastRunId: null, createdAt: now, updatedAt: now,
  };
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill] });
  await profileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile] });
  await autoStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, candidates: [], jobs: [scheduled] });
  const server = makeServer({
    store: new SessionStore(dir), automationStore: autoStore, skillStore,
    agentProfileStore: profileStore, automationRunLedger: runLedger,
    runtimeToken: TICK_TOKEN, model,
  });
  const p1 = server.runtimeTick(); // 첫 tick이 gate에서 대기
  const p2 = server.runtimeTick(); // 겹침 → skip
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal([r1, r2].filter((r) => r.skipped === 'in_flight').length, 1, '하나는 in_flight로 skip');
  assert.ok(modelCalls >= 1, '실행 모델은 호출된다');
  assert.equal((await runLedger.load()).runs.length, 1, '발생 1건은 AgentRun 하나만 가진다');
});
