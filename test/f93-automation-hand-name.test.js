// **F-93 · 손 이름 하나 — 예약이 26회차 중 18회만 서던 자리** (선빨강)
//
// 닫는 문장: 모델이 손을 **자기가 보는 이름**(`local_file` · `functions.local_file`)으로
// 적어 내도 예약이 선다. 그리고 그 관대함이 이미 닫은 봉인을 다시 열지 않는다.
//
// 밟은 기계 사실(2026-08-12 라이브 26회차 · 상관 6/6 · `T5-FOLLOWUP-LEDGER-ko.md` F-90 꼬리):
// ```
// tool=functions.local_file → 후보 1건 · job 0건   (실패 전부)
// tool=local.file           → 후보 1건 · job 1건   (성공 전부)
// 실패 회차의 trigger 는 멀쩡했다 — `once` 만의 문제가 아니라 `daily`·`weekly` 도 같이 샌다
// ```
// 원인: 점을 못 쓰는 공급자 때문에 `wireToolName` 이 `local.file` → `local_file` 로 바꾼다.
// 모델은 그 이름을 보고, `automation.propose` 의 `tool` **인자 안에** 그 이름을 적는다.
// 인자는 `byWire` 복원 경계를 안 지난다(그 경계는 호출 **이름**만 되돌린다) — 그래서
// 커널 이름만 아는 `toolActionKind` 가 못 알아보고 `candidate_action_unknown` 으로 떨어진다.
//
// **이 저장소가 같은 자리를 이미 겪고 풀었다**(`src/runtime/capsule.js:186-190`, 실측 2026-08-04):
//   *"캡슐만 `local.file` 을 요구하면 모델이 매번 헛손질하고 … 다섯 번 재시도했고 매번 호출 0이었다.
//     **이름이 두 벌인 것은 우리 사정이지 모델 잘못이 아니다.**"*
//
// ⚠️ 관대하게 받으면 2026-08-12 에 닫은 **「아무 스킬에나 묶는 자리」**가 다시 열린다
// (`server.js` 옛 판의 `?? 첫 활성 스킬`). 그래서 ③④⑤ 가 같은 파일에 함께 선다 —
// 능력만 늘리고 봉인을 안 재면 이 수리는 어제 고친 것을 되돌리는 수리다.
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
import { progressiveControlModel } from './helpers/progressive-control-model.js';

const NOW = 1_786_287_600_000;                 // 2026-08-10 00:00 Asia/Seoul
const 아침9시 = Object.freeze({
  kind: 'daily', timezone: 'Asia/Seoul', localTime: '09:00', misfirePolicy: 'catch_up_once',
});
const 다음주금요일저녁 = Object.freeze({
  kind: 'weekly', timezone: 'Asia/Seoul', localTime: '18:00', weekdays: [5],
  misfirePolicy: 'catch_up_once',
});
// `once` 는 모델이 절대값을 직접 주는 유일한 칸이다(F-90). 판 시각에서 하루 뒤 아침으로 둔다.
const 내일아침9시 = Object.freeze({
  kind: 'once', timezone: 'Asia/Seoul', at: NOW + (33 * 60 * 60 * 1000),
  misfirePolicy: 'catch_up_once',
});

/** 목적이 **다른** 활성 스킬. 「첫 활성 스킬」 폴백이 되살아나면 이것에 묶인다(재현된 사고). */
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

async function 제품(model) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-f93-')));
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
    clock: () => NOW, model: progressiveControlModel(model), env: demoEnv(),
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
    server, skillStore, agentProfileStore, root, state, session,
    /** **원장 파일 실물** — T5 영수증이 아니라 디스크의 automation.json 이다. */
    원장: async () => JSON.parse(await readFile(join(state, 'automation.json'), 'utf8')),
    파일: async (이름) => readFile(join(state, 이름), 'utf8').catch(() => ''),
    turn: async (text) => fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text }),
    }).then((r) => r.json()),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/** 사용자가 말한 것을 그대로 `automation.propose` 로 적는 모델. 확정 동사는 안 부른다. */
function 적기만하는모델(overrides = {}) {
  return { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return '알겠어.';
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

// ── ① 모델이 보는 이름으로 부른 예약이 선다 — 밟은 그 자리 ────────────────────
test('F93 ①: 모델이 보는 이름(functions.local_file · local_file)으로 부른 예약이 선다', async () => {
  for (const 부른이름 of ['functions.local_file', 'local_file']) {
    const app = await 제품(적기만하는모델({ tool: 부른이름 }));
    try {
      await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
      const 원장 = await app.원장();
      assert.equal((원장.jobs ?? []).length, 1,
        `**${부른이름} 로 부른 예약이 안 섰다** — 후보 ${(원장.candidates ?? []).length}개 · `
        + `job ${(원장.jobs ?? []).length}개. 라이브 26회차 중 8회가 정확히 이 모양이었다. `
        + '이름이 두 벌인 것은 우리 사정이지 모델 잘못이 아니다(capsule.js:186-190)');
      assert.equal(원장.jobs[0].state, 'scheduled', '켜졌다면 예정 상태여야 한다');
    } finally { await app.close(); }
  }
});

// ── ①-b `once`·`weekly` 도 같은 자리에서 함께 닫힌다 ─────────────────────────
test('F93 ①-b: once·weekly 도 모델이 보는 이름으로 선다 — once 만의 문제가 아니었다', async () => {
  const 표본 = [
    ['내일 아침 9시에 다운로드 폴더 좀 봐줘.', 내일아침9시, 'once'],
    ['매주 금요일 저녁 6시에 다운로드 폴더 좀 봐줘.', 다음주금요일저녁, 'weekly'],
  ];
  for (const [발화, trigger, 종류] of 표본) {
    const app = await 제품(적기만하는모델({
      tool: 'functions.local_file', kind: 종류, trigger,
    }));
    try {
      await app.turn(발화);
      const 원장 = await app.원장();
      assert.equal((원장.jobs ?? []).length, 1,
        `**${종류} 예약이 손 이름 때문에 안 섰다** — job ${(원장.jobs ?? []).length}개. `
        + '실패 회차에 daily 도 있었다: 이 자리는 트리거 종류와 무관하다');
      assert.equal(원장.jobs[0].trigger.kind, 종류, '사용자가 말한 반복 종류여야 한다');
    } finally { await app.close(); }
  }
});

// ── ② 커널 이름은 예전 그대로 ────────────────────────────────────────────────
test('F93 ②: local.file 은 예전 그대로 선다 — 되던 것이 안 되면 안 된다', async () => {
  const app = await 제품(적기만하는모델());
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 1, '커널 이름으로 부른 예약이 회귀했다');
    const 봉투손 = 원장.jobs[0].authorityEnvelope.allowedTools;
    assert.ok(봉투손.includes('local.file'),
      '권한 봉투가 커널 이름을 그대로 들고 있어야 한다');
    // **폭은 F-110 이 넓혔다** — 첫 수단이 막히면 갈아탈 관측 손이 함께 선다.
    // 이 검사가 무는 것은 「하나인가」가 아니라 **「이름이 커널 이름인가」**다.
    assert.ok(봉투손.every((t) => !t.includes('functions.') && !t.includes('_')),
      `봉투에 와이어 이름이 섞였다: ${봉투손.join(' · ')}`);
  } finally { await app.close(); }
});

// ── ③ 아는 이름 밖은 안 선다 — 그물이 안 넓어졌다 ────────────────────────────
test('F93 ③: 아는 손 목록 밖의 이름(functions.없는손)은 안 선다', async () => {
  for (const 부른이름 of ['functions.없는손', '없는_손', 'functions.mail_send_all']) {
    const app = await 제품(적기만하는모델({ tool: 부른이름 }));
    try {
      await app.turn('매일 아침 9시에 다운로드 폴더를 봐줘.');
      const 원장 = await app.원장();
      assert.equal((원장.jobs ?? []).length, 0,
        `**모르는 손 이름(${부른이름})으로 예약이 섰다** — 정규화가 그물을 넓혔다. `
        + '되찾는 근거는 접두 규칙이 아니라 **실재하는 손 목록**이어야 한다');
    } finally { await app.close(); }
  }
});

// ── ④ 「아무 스킬에나 묶는 자리」가 안 열린다 ────────────────────────────────
test('F93 ④: skillRef 없는 추론 후보는 여전히 거절 — 첫 활성 스킬을 집지 않는다', async () => {
  // 시점을 사용자가 말하지 않은 발화(추론 레인) + 모델은 **모델이 보는 이름**으로 적는다.
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
      tool: 'functions.local_file', action: { args: { action: 'list', path: 'Downloads' } },
      skillPurpose: '다운로드 폴더를 본다', deliveryIntent: 'chat',
    } }] };
  } };
  const app = await 제품(확정까지하는모델);
  try {
    await app.turn('다운로드 폴더 좀 정리해줘.');       // 시점 표현이 없다 — 추론 레인
    const 답 = await app.turn('그거 켜줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 0,
      '**손 이름을 펴 주면서 「아무 스킬에나 묶는 자리」가 다시 열렸다** — '
      + '목적이 다른 일(월말 청구서 정리)이 매일 아침 자동으로 돈다');
    assert.equal(답.automationControl?.rejected, true, '묶지 말고 거절해야 한다');
    assert.equal(답.automationControl?.reason, 'skill_binding_required',
      '거절 이유가 그대로여야 한다 — 이름 정규화가 거절 사유를 바꾸면 안 된다');
  } finally { await app.close(); }
});

// ── ⑤ 실행 시점 헌장 판정은 그대로 ──────────────────────────────────────────
test('F93 ⑤: 이름을 펴도 헌장 판정은 그대로 — 지우는 예약은 여전히 안 선다', async () => {
  const app = await 제품(적기만하는모델({
    tool: 'functions.local_file',
    action: { args: { action: 'delete', path: 'Downloads/견적서.pdf' } },
  }));
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더의 견적서를 지워줘.');
    const 원장 = await app.원장();
    assert.equal((원장.jobs ?? []).length, 0,
      '**이름을 펴 주는 김에 헌장 판정까지 건너뛰었다** — 지우는 일이 무인으로 매일 돈다. '
      + 'delete 는 A3 이고 자동화 후보로 설 수 없다(automation-contracts.js: A0~A2 만)');
  } finally { await app.close(); }
});

// ── ⑥ 이름이 두 벌로 살지 않는다 ────────────────────────────────────────────
test('F93 ⑥: 원장·스킬·담당 어디에도 와이어 이름이 남지 않는다 — 한 자리에서만 편다', async () => {
  const app = await 제품(적기만하는모델({ tool: 'functions.local_file' }));
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 원장 = await app.원장();
    const job = (원장.jobs ?? [])[0];
    assert.ok(job, '① 이 먼저 초록이어야 한다');
    // **폭은 F-110 이 넓혔다**(예약도 막히면 갈아탈 관측 손이 함께 선다).
    // 이 검사가 무는 것은 폭이 아니라 **이름의 결**이다 — 와이어 이름이 새면 실행이 손을 못 찾는다.
    assert.ok(job.authorityEnvelope.allowedTools.includes('local.file'),
      'job 의 권한 봉투가 커널 이름을 들고 있어야 한다 — 실행은 이 이름으로 손을 부른다');
    assert.ok(job.authorityEnvelope.allowedTools.every((t) => t.includes('.') && !t.includes('functions.')),
      'job 봉투에 와이어 이름이 섞였다');
    const 후보 = (원장.candidates ?? []).find((c) => c.jobRef === job.id);
    assert.equal(후보?.action?.tool, 'local.file',
      '**후보 레코드에 와이어 이름이 남았다** — 두 벌이 살면 언젠가 갈린다');
    const 스킬 = (await app.skillStore.load()).skills.find((s) => s.id === job.skillRef.id);
    assert.deepEqual(스킬?.requiredCapabilities, ['local.file'],
      '1회용 지시문의 필요 능력도 커널 이름이어야 한다');
    const 담당 = (await app.agentProfileStore.load()).profiles
      .find((p) => p.id === job.agentProfileId);
    assert.ok(담당, '실행 역할이 저장소에 실재해야 한다');
    // **폭은 F-110 이 넓혔다.** 이 검사가 무는 것은 이름의 결이다 — 와이어 이름(`_` 구분,
    // `functions.` 접두)이 남으면 실행 때 그 이름으로 손을 못 부른다.
    assert.ok(담당.toolAllowlist.includes('local.file'),
      '**실행 역할이 첫 수단을 잃었다** — 맡긴 그 일을 할 손이 없다');
    assert.ok(담당.toolAllowlist.every((t) => t.includes('.') && !t.startsWith('functions.')),
      `**실행 역할의 허용 손에 와이어 이름이 남았다** — 실행 때 그 이름으로는 못 부른다: ${담당.toolAllowlist.join(' · ')}`);
    for (const 파일 of ['automation.json', 'skills.json', 'agent-profiles.json']) {
      const 본문 = await app.파일(파일);
      assert.ok(!본문.includes('local_file'),
        `**${파일} 에 와이어 이름이 살아 있다** — 정규화가 한 자리에서 안 돌았다`);
    }
  } finally { await app.close(); }
});
