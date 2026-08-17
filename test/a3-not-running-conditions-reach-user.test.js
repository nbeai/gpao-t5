// **A3 · 안 도는 조건이 사용자에게 닿는다 — 선빨강**
// (`design/T5-AUTOMATION-CLOSE-ko.md` §0 닫는 문장 **뒤쪽 절반** · §5 「남은 자리」)
//
// 닫는 문장의 앞쪽 절반은 섰다(job 이 실제로 선다 10/10). 뒤쪽 절반이 여기다:
//   *"…그리고 T5 는 그것이 **안 도는 조건**을 미리 말해 두었다."*
//
// ── 왜 지금 빨간가 (2026-08-12 · 전부 밟은 기계 사실 · 탐침 원문은 보고에) ──────────
// 명시 예약(직접 레인)이 켜진 턴에서 커널이 모델에게 준 글이 이랬다:
//   `- 상태: scheduled — **후보이지 예약이 아니다.** 이번 턴에 방금 세웠다`
//   `- 이 후보로 선 예약(job): 0건`
//   `- 켜려면: automation.control(operation='commit', …) 를 부르면 job 이 선다`
// 같은 순간 디스크의 `automation.json` 은 **jobs 1건**(state:'scheduled')이었고 켜는 손
// 반환값에는 `notRunning{requiresAppRunning:true · catchUpLimit:1 · authorityExpiresAt …}`
// 이 실려 있었다. 그러니까 세 가지가 동시에 틀렸다:
//   (a) 커널이 **선 예약을 안 섰다고** 적었다 — F-88 이 걷은 거짓의 **반대 방향**이다
//   (b) 안 도는 조건이 반환값에만 있고 **모델 입력에 한 글자도 안 갔다** — 못 옮기는 게 아니라
//       받은 적이 없다
//   (c) 그래서 출구 그물이 정직한 「켜 뒀어요」를 물어 되돌렸다(`이번턴job` 이 확정 동사로
//       선 job 만 세고 직접 레인의 job 을 안 셌다). **참을 거짓으로 몰았다**
//
// ── 오픈북 (직접 열어 확인한 원문) ────────────────────────────────────────────
// 헤르메스 `~/.hermes/hermes-agent/tools/cronjob_tools.py:341-375` (`_local_delivery_notice`):
//   *"…silently dropping the user's 'tell me when it runs' intent is the trap reported in
//    #51568. Surface it at create time so the agent can relay it instead of promising a
//    delivery that never happens."*
//   그 문자열은 create 응답에 **합쳐져서** 나간다(`:1122-1124` — `_create_message` 에 이어붙임).
// 클로드코드 `create_scheduled_task` 도구 설명서(원문):
//   *"Scheduled tasks run while this app is open. If the app is closed when a task is due,
//    it runs on next launch — tell the user this so they aren't surprised."*
// 둘 다 **생성 시점에 기계로 계산해 건넨다.** 문장 지침이 아니라 재료다 — 여기가 그 자리다.
//
// ── 이 시험이 무는 것 (계획서 반대시험 ①~④) ──────────────────────────────────
//   ① 켜는 손이 돌려준 「안 도는 조건」이 **모델 입력에 실린다**
//   ② 그 값이 **원장 사실에서 나온다** — 반환값과 **같은 값**이다(지어낸 값이 아니다)
//   ③ 예약이 아닌 평범한 턴에는 **안 붙는다** — 잔소리를 늘리지 않는다
//   ④ 켜지지 않은 회차(후보만)에는 「켜 뒀다」가 **여전히** 안 나온다 — F-88 이 안 무너졌다
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AUTOMATION_SCHEMA_VERSION } from '../src/kernel/l5-growth/automation-contracts.js';
import { buildModelMessages } from '../src/runtime/model-provider.js';
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

/**
 * 실경로 한 벌. **모델이 본 것을 그대로 모은다** — 사실이 닿았는지는 모델 입력으로만 잰다
 * (T5 영수증으로 안 잰다 · 닫는문서 §1).
 */
async function 제품(model) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 't5-a3-')));
  const state = join(root, '.state');
  await mkdir(state, { recursive: true });
  await mkdir(join(root, 'Downloads'), { recursive: true });
  await writeFile(join(root, 'Downloads', '견적서.pdf'), 'pdf', 'utf8');
  const server = makeServer({
    store: new SessionStore(state),
    automationStore: new AutomationJobStore(state),
    automationRunLedger: new AutomationRunLedger(state),
    skillStore: new SkillDefinitionStore(state),
    agentProfileStore: new AgentProfileStore(state),
    clock: () => NOW, model, env: demoEnv(),
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
    root, state, session,
    원장: async () => JSON.parse(await readFile(join(state, 'automation.json'), 'utf8')),
    turn: async (text) => fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: session.id, text }),
    }).then((r) => r.json()),
    close: () => new Promise((ok) => server.close(ok)),
  };
}

/**
 * 사용자가 말한 것을 그대로 적는 모델. **본 것을 전부 모은다**(입력 검증용).
 *
 * ⚠️ **예약 사실을 먼저 본다.** 답을 쓰는 두 번째 호출은 손 없이 온다(`opts.tools` 0개) —
 * 손부터 보고 일찍 돌아가면 예약이 선 턴의 답이 통째로 「알겠어.」가 되고, 그것을 제품
 * 결함으로 읽게 된다(이 시험을 쓰다 실제로 밟았다).
 */
function 적는모델(본것, 답문장 = '매일 아침 9시에 알려드리도록 켜 뒀어요.') {
  return { async respond(tc, opts = {}) {
    본것.push(tc);
    const request = String(tc.currentRequest ?? '');
    if (tc.automationProposal) return 답문장;
    if (!opts.tools?.length) return '알겠어.';
    if (opts.tools.some((tool) => tool.name === 'control.select')) return {
      text: '', toolCalls: [{ name: 'control.select', args: { categories: ['automation'] } }],
    };
    if (!request.trim()) return '알겠어.';
    return { text: '', toolCalls: [{ name: 'automation.propose', args: {
      statement: request, kind: 'daily', operation: 'create', trigger: 아침9시,
      tool: 'local.file', action: { args: { action: 'list', path: 'Downloads' } },
      skillPurpose: '다운로드 폴더를 본다', deliveryIntent: 'chat',
    } }] };
  } };
}

/** 예약 사실 블록을 **모델이 실제로 읽는 글**에서 잘라 낸다. */
const 예약블록 = (tc) => {
  const { system } = buildModelMessages(tc);
  const m = String(system).match(/\[이번 턴에[^\]]*예약[^\]]*][\s\S]*?(?=\n\[|$)/);
  return m ? m[0] : '';
};

// ── ① 안 도는 조건이 모델 입력에 실린다 ────────────────────────────────────────
test('A3 ①: 켜는 손이 돌려준 「안 도는 조건」이 모델 입력에 실린다', async () => {
  const 본것 = [];
  const app = await 제품(적는모델(본것));
  try {
    const 답 = await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    assert.equal((await app.원장()).jobs.length, 1, '앞쪽 절반(job 이 선다)이 먼저 초록이어야 한다');
    assert.ok(답.automationProposal?.notRunning, '반환값에 조건이 없다 — 앞 회차가 세운 자리다');

    const 블록 = 예약블록(본것.find((tc) => tc.automationProposal));
    assert.ok(블록, '예약 사실 블록 자체가 모델 입력에 없다');
    assert.match(블록, /꺼져 있으면|켜져 있을 때만/,
      '**앱이 꺼져 있으면 안 돈다는 사실이 모델에게 한 글자도 안 갔다.** '
      + '반환값에만 있고 모델 입력에 없으면 모델은 옮길 것이 없다 '
      + '(헤르메스 cronjob_tools.py:341-375 — "Surface it at create time so the agent can relay it")');
    assert.match(블록, /따라잡/, '놓친 실행 따라잡기 한도가 모델 입력에 없다');
    assert.match(블록, /만료|권한창/, '권한창 만료가 모델 입력에 없다');
  } finally { await app.close(); }
});

// ── ② 지어낸 값이 아니다 — 반환값과 같은 값이다 ────────────────────────────────
test('A3 ②: 블록의 값이 켜는 손 반환값과 같은 값이다 (지어낸 값이 아니다)', async () => {
  const 본것 = [];
  const app = await 제품(적는모델(본것));
  try {
    const 답 = await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    const 조건 = 답.automationProposal.notRunning;
    const 블록 = 예약블록(본것.find((tc) => tc.automationProposal));
    // 기계값 셋을 **글자 그대로** 대조한다 — 다른 숫자가 적혀 있으면 그것은 지어낸 값이다.
    assert.ok(블록.includes(String(조건.catchUpLimit)),
      `따라잡기 한도가 반환값(${조건.catchUpLimit})과 다르다: ${블록}`);
    assert.ok(블록.includes(String(조건.maxRuns)),
      `최대 실행 횟수가 반환값(${조건.maxRuns})과 다르다: ${블록}`);
    assert.ok(블록.includes(new Date(조건.authorityExpiresAt).toISOString().slice(0, 10)),
      `권한창 만료가 반환값(${조건.authorityExpiresAt})과 다르다: ${블록}`);
  } finally { await app.close(); }
});

// ── ①-2 커널이 선 예약을 「안 섰다」고 적지 않는다 (F-88 의 반대 방향) ──────────
test('A3 ①-2: 직접 레인에서 커널이 「job 0건 · 후보이지 예약이 아니다」라고 거짓말하지 않는다', async () => {
  const 본것 = [];
  const app = await 제품(적는모델(본것));
  try {
    await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    assert.equal((await app.원장()).jobs.length, 1);
    const 블록 = 예약블록(본것.find((tc) => tc.automationProposal));
    assert.doesNotMatch(블록, /선 예약\(job\)[^\n]*0건/,
      '**job 이 실제로 선 턴인데 커널이 0건이라고 적고 있다** — 사용자에게 「아직 안 켜졌다」가 된다');
    assert.doesNotMatch(블록, /후보이지 예약이 아니다/,
      'job 이 선 턴에 「후보이지 예약이 아니다」라고 적고 있다');
    assert.doesNotMatch(블록, /켜려면/,
      '이미 켜진 예약에 「켜려면 …을 부르라」고 적고 있다 — 모델이 또 확정하러 간다');
  } finally { await app.close(); }
});

// ── ①-3 정직한 「켜 뒀어요」가 출구에서 안 되돌려진다 ──────────────────────────
test('A3 ①-3: 직접 레인의 정직한 「켜 뒀어요」를 출구 그물이 물지 않는다', async () => {
  const app = await 제품(적는모델([], '매일 아침 9시에 알려드리도록 켜 뒀어요.'));
  try {
    const 답 = await app.turn('매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.');
    assert.equal((await app.원장()).jobs.length, 1, 'job 은 실제로 섰다');
    assert.match(String(답.reply ?? ''), /켜 뒀어요/,
      '**job 이 선 정직한 답을 그물이 물어 되돌렸다** — 참을 거짓으로 몰았다. '
      + '`이번턴job` 이 확정 동사로 선 job 만 세고 직접 레인의 job 을 안 센다');
  } finally { await app.close(); }
});

// ── ③ 예약이 아닌 평범한 턴에는 안 붙는다 ─────────────────────────────────────
test('A3 ③: 예약이 아닌 평범한 턴에는 안 도는 조건이 안 붙는다 (잔소리를 늘리지 않는다)', () => {
  const { system } = buildModelMessages({ currentRequest: '다운로드 폴더에 뭐가 있어?' });
  const 글 = String(system);
  assert.doesNotMatch(글, /꺼져 있으면|따라잡/,
    '자동화와 무관한 턴에 예약 고지가 붙었다 — 정의역이 넓어졌다');
});

// ── ④ 켜지지 않은 회차(후보만)에는 「켜 뒀다」가 여전히 안 나온다 (F-88) ────────
test('A3 ④: 후보만 선 턴은 F-88 그대로다 — 「job 0건 · 켜려면」이 살아 있다', () => {
  const { system } = buildModelMessages({
    currentRequest: '다운로드 폴더 좀 봐줘.',
    automationProposal: {
      candidateRef: 'cand-1', revision: 1, state: 'proposed', operation: 'create',
      statement: '다운로드 폴더를 본다',
    },
  });
  const 글 = String(system);
  assert.match(글, /이번 턴에 세운 예약 후보/, 'F-88 후보 블록이 사라졌다');
  assert.match(글, /선 예약\(job\)[^\n]*0건/, 'F-88 이 무너졌다 — job 0건이 안 실렸다');
  assert.match(글, /automation\.control/, 'F-88 이 무너졌다 — 켜는 방법이 안 실렸다');
  assert.doesNotMatch(글, /꺼져 있으면|따라잡/,
    '**안 선 예약에 「안 도는 조건」을 붙였다** — 켜지지도 않은 것의 조건을 말하면 켜졌다고 들린다');
});

test('A3 ④-2: 후보만 선 턴의 「켜 뒀다」는 여전히 출구에서 물린다', async () => {
  const app = await 제품(적는모델([], '설정 그대로 활성화해 뒀어요.'));
  try {
    // 시점 표현이 없다 — 추론 레인이라 후보만 선다.
    const 답 = await app.turn('다운로드 폴더 좀 봐줘.');
    assert.equal((await app.원장()).jobs.length, 0, '추론 레인은 job 이 안 선다');
    assert.doesNotMatch(String(답.reply ?? ''), /활성화해 뒀어요/,
      '**후보만 선 턴이 「켜 뒀다」로 그대로 나갔다** — F-88 이 무너졌다');
  } finally { await app.close(); }
});
