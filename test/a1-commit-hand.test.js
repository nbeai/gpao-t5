// **A1 · 확정하는 손 — 선빨강** (최종 조립 계획서 칸 A1 · 오너 동결 2026-08-11)
//
// 닫는 문장(계획서 A1): *"매주 월요일 아침에 지난주 정산 알려줘"* 가 **대화만으로 켜지고**,
// *"이번 주는 쉬어"* 로 멈추고, *"다시 켜"* 로 살아나며, 자동화 화면에 그대로 보인다.
//
// 지금 왜 빨간가(2026-08-11 전수 실측): 모델에게 열린 자동화 채널은 `propose`(후보) ·
// `control`(pause/resume/status) · `observe`(읽기) 셋뿐이고 **후보를 예약으로 확정하는 동사가
// 없다.** 확정은 표면 라우트 `POST /automation/approve` 전용이라 대화만으로는 job 이 0 이다.
// 생활모의 L6 실측: 9턴 · 도구 호출 0 · 후보 2 · job 0(귀속 A — 이 저장소 첫 A · 장부 F-70).
//
// 왜 헌장 위반인가: 예약 등록은 **가역**(pause·cancel)이고 비밀값·불가역 파괴·새 상대 첫 전송·
// 돈 어디에도 없다. 헌장 넷 밖은 자동이어야 한다 — *"코드와 헌장이 어긋나면 코드가 결함이다."*
//
// 이 시험이 무는 것은 **부품이 아니라 실경로**다(C4): 실제 서버 · 실제 스토어 · 사용자 발화 →
// 모델 통제 채널 → 확정 → 원장·화면. `/automation/approve` 를 **한 번도 부르지 않는다** —
// 그것이 "대화만으로"의 기계적 정의다.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AUTOMATION_SCHEMA_VERSION } from '../src/kernel/l5-growth/automation-contracts.js';
import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { AgentProfileStore } from '../src/surface/agent-profile-store.js';
import { SkillDefinitionStore } from '../src/surface/skill-store.js';
import { SessionStore } from '../src/surface/session-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { contentHash, skillHashSource } from '../src/kernel/l5-growth/automation-contracts.js';

const FROZEN_NOW = 1_786_287_600_000;              // 2026-08-10 00:00 Asia/Seoul
const MONDAY = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', weekdays: [1], localTime: '09:30',
  nextRunAt: 1_786_321_800_000, misfirePolicy: 'catch_up_once',
});

function skill() {
  const record = {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'a1-skill', name: '주간 정산 확인', purpose: '로컬 자료를 정해진 때 확인한다',
    version: 1, contentHash: '', inputs: [],
    steps: [{ kind: 'read', instruction: '지난주 정산 자료를 확인한다' }],
    resultContract: { kind: 'summary' }, requiredCapabilities: ['local.file'],
    authorityHints: ['read'], replayCases: [],
    source: { kind: 'test', sessionId: null, traceIds: [] }, state: 'active',
    createdAt: 1, updatedAt: 1, previousVersion: null,
  };
  record.contentHash = contentHash(skillHashSource(record));
  return record;
}
function profile(root) {
  return {
    schemaVersion: AUTOMATION_SCHEMA_VERSION,
    id: 'a1-agent', name: '정산 확인 담당', purpose: '허용된 로컬 자료를 확인한다',
    modelRole: 'worker', toolAllowlist: ['local.file'], workspaceScope: [root],
    defaultBudgets: { maxToolCalls: 4, timeoutMs: 30_000, maxCost: 1, maxConcurrency: 1 },
    authorityCeiling: 'A1', state: 'active', createdAt: 1, updatedAt: 1,
  };
}

/** 실제 제품 서버 하나. 표면 승인 라우트는 이 시험에서 **한 번도 부르지 않는다**. */
async function 제품(model) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-a1-')));
  const state = join(root, '.state');
  await mkdir(state, { recursive: true });
  const store = new SessionStore(state);
  const automationStore = new AutomationJobStore(state);
  const runLedger = new AutomationRunLedger(state);
  const skillStore = new SkillDefinitionStore(state);
  const agentProfileStore = new AgentProfileStore(state);
  await skillStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, skills: [skill()] });
  await agentProfileStore.save({ schemaVersion: AUTOMATION_SCHEMA_VERSION, profiles: [profile(root)] });
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, skillStore, agentProfileStore,
    clock: () => FROZEN_NOW, model, env: demoEnv(),
    tools: demoTools({ localFile: makeLocalFileTool({ roots: [root], dataDir: state, homeDir: root }) }),
    processEnv: { HOME: root, GPAO_T5_HOME: root, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: root },
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const session = await fetch(`${base}/sessions`, { method: 'POST' }).then((r) => r.json());
  return {
    server, automationStore, root,
    turn: async (text) => fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text }),
    }).then((r) => r.json()),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/**
 * 사용자가 시킨 것을 그대로 수행하는 모델. **후보를 만들고 그 자리에서 확정한다** —
 * 사용자가 "알려줘"라고 명시적으로 시켰으므로 켜는 것이 그 지시의 완수다.
 * 판단은 모델의 몫이고(절대원칙 2), 커널은 현실(후보 목록)과 경계(가역이라 자동)만 준다.
 */
function 시킨대로하는모델() {
  return { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return '알겠어.';
    const 후보 = tc.automationReality?.candidates?.items?.find((c) => c.approved !== true);
    const 예약 = tc.automationReality?.jobs?.items?.[0];
    // ① 켜 달라는 첫 발화 — 후보가 아직 없으면 만들고, 있으면 확정한다.
    if (request.includes('알려줘')) {
      if (!후보) {
        return { text: '', toolCalls: [{ name: 'automation.propose', args: {
          statement: request, kind: 'weekly', tool: 'local.file',
          action: { args: { action: 'read', path: '지난주정산.txt' } },
          operation: 'create', trigger: MONDAY,
          skillPurpose: '지난주 정산 확인', deliveryIntent: 'none',
        } }] };
      }
      return { text: '', toolCalls: [{ name: 'automation.control', args: {
        operation: 'commit',
        targetCandidateRef: 후보.candidateRef ?? 후보.candidateId,
        targetCandidateRevision: 후보.revision,
      } }] };
    }
    // ② 멈춤·재개 — 이미 열려 있는 길
    if (예약 && (request.includes('쉬어') || request.includes('다시 켜'))) {
      return { text: '', toolCalls: [{ name: 'automation.control', args: {
        operation: request.includes('쉬어') ? 'pause' : 'resume',
        targetJobRef: 예약.jobRef, targetJobRevision: 예약.jobRevision,
      } }] };
    }
    return { text: '알겠어.', toolCalls: [] };
  } };
}

test('A1 선빨강: "매주 월요일 아침에 알려줘" 가 대화만으로 켜진다 (표면 승인 라우트 0회)', async () => {
  const app = await 제품(시킨대로하는모델());
  try {
    await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.');
    await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.');
    const state = await app.automationStore.load();
    const jobs = state.jobs ?? [];
    assert.equal(jobs.length, 1,
      `**대화만으로 예약이 안 켜졌다** — 후보 ${(state.candidates ?? []).length}개, job ${jobs.length}개. `
      + '확정하는 손이 없으면 사용자는 화면을 눌러야 하고, 그것은 헌장 넷 밖의 정지다(F-70)');
    assert.equal(jobs[0].state, 'scheduled', '켜졌다면 예정 상태여야 한다');
    assert.equal(jobs[0].nextRunAt, MONDAY.nextRunAt, '다음 실행이 사용자가 말한 시각이어야 한다');
  } finally { await app.close(); }
});

test('A1 선빨강: 켠 뒤 "이번 주는 쉬어" → "다시 켜" 가 같은 예약 하나에서 돈다', async () => {
  const app = await 제품(시킨대로하는모델());
  try {
    await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.');
    await app.turn('매주 월요일 오전 9시 반에 지난주 정산을 확인하라고 알려줘.');
    const 멈춤 = await app.turn('이번 주는 쉬어.');
    const 재개 = await app.turn('다시 켜줘.');
    const state = await app.automationStore.load();
    assert.equal((state.jobs ?? []).length, 1, '중복 등록 0 — 같은 예약 하나여야 한다');
    assert.equal(멈춤.automationControl?.state, 'paused', '"쉬어"가 실제로 멈춰야 한다');
    assert.equal(재개.automationControl?.state, 'scheduled', '"다시 켜"가 실제로 살려야 한다');
    assert.equal(state.jobs[0].state, 'scheduled', '원장의 최종 상태도 켜짐이어야 한다');
  } finally { await app.close(); }
});

test('A1 안전 대차: 확정이 열려도 헌장 넷은 그대로 — 없는 후보·바뀐 개정은 확정되지 않는다', async () => {
  const 엉뚱한확정모델 = () => ({ async respond(tc, opts = {}) {
    if (!opts.tools?.length) return '알겠어.';
    return { text: '', toolCalls: [{ name: 'automation.control', args: {
      operation: 'commit', targetCandidateRef: '없는-후보-ref', targetCandidateRevision: 99,
    } }] };
  } });
  const app = await 제품(엉뚱한확정모델());
  try {
    await app.turn('아무거나 켜줘.');
    const state = await app.automationStore.load();
    assert.equal((state.jobs ?? []).length, 0,
      '**없는 후보로 예약이 생겼다** — 확정은 실제 후보에만 붙어야 한다(fail-closed)');
  } finally { await app.close(); }
});
