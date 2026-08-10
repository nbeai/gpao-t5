import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeLocalFileTool } from '../src/runtime/local-file.js';
import { makeLocalTerminalTool } from '../src/runtime/local-terminal.js';
import { AutomationRunLedger } from '../src/surface/automation-run-ledger.js';
import { AutomationJobStore } from '../src/surface/automation-store.js';
import { demoEnv, demoTools } from '../src/surface/demo-context.js';
import { makeServer } from '../src/surface/server.js';
import { SessionStore } from '../src/surface/session-store.js';

const CLOSE = process.env.T5_F64_PROBE_CLOSE === '1';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const PILOT_SHA = '873fb72de05f1d1143d569a9eeab34e99409d28466202aa434b6dd984df441f0';
const RUNNER_SHA = 'cb6142c4dbf6df2b69985b6c1805c3c05f5623e5a3dd5719dea000f610996efe';

async function room(prefix) {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const state = join(root, '.state');
  return { root, state };
}

async function startProduct({ root, state, model, terminalCwd = root }) {
  const store = new SessionStore(state);
  const automationStore = new AutomationJobStore(state);
  const runLedger = new AutomationRunLedger(state);
  const server = makeServer({
    store, automationStore, automationRunLedger: runLedger, model, env: demoEnv(),
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
  return { server, store, automationStore, runLedger, session, turn };
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

async function l5Case(correct) {
  const x = await room('t5-f64-l5-');
  for (const [name, text] of Object.entries(L5_FIXTURE)) {
    assert.equal(sha(Buffer.from(text)), L5_SHA[name]);
    await writeFile(join(x.root, name), text);
  }
  const output = correct
    ? '보유: 사업자등록증, 영업신고증, 세척기 견적서\n준비 필요: 지방세 완납증명서\n확인: 견적서는 최근 1개월 기준 재확인\n구매: 접수 전 구매 제외\n'
    : '보유: 사업자등록증, 임대차계약서, 통장사본\n준비 필요: 국세납세증명서\n일반 준비표 완료\n';
  let main = 0;
  const model = { async respond(tc, opts = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
    if (!opts.tools?.length) return '준비표를 만들었어요.';
    main += 1;
    if (main === 1) return { text: '', toolCalls: [
      ...(correct ? Object.keys(L5_FIXTURE).map((path) => ({ name: 'local.file', args: { action: 'read', path } })) : []),
      { name: 'local.file', args: { action: 'write', path: '신청준비표.md', text: output } },
    ] };
    return { text: '준비표를 만들었어요.', toolCalls: [] };
  } };
  return withProduct({ ...x, model }, async (app) => {
    await app.turn('신청한 건 아니고 준비만 하는 거야. 신청준비표.md로 정리해줘.');
    const saved = await app.store.load(app.session.id);
    const text = await readFile(join(x.root, '신청준비표.md'), 'utf8');
    const reads = saved.ledgerEntries.filter((r) => r.actualCall?.tool === 'local.file' && r.actualCall.args?.action === 'read');
    const completed = saved.ledgerEntries.filter((r) => r.origin === 'completion_settlement' || r.receiptRef).length;
    const purposeMet = text.includes('영업신고증') && text.includes('지방세 완납증명서')
      && text.includes('최근 1개월') && text.includes('접수 전 구매 제외');
    return { purposeMet, reads: reads.length, completed, textSha256: sha(text), fixtureSha256: sha(JSON.stringify(L5_FIXTURE)) };
  });
}

async function l6Case() {
  const x = await room('t5-f64-l6-');
  const seen = new Set();
  const model = { async respond(tc, opts = {}) {
    const request = String(tc.currentRequest ?? '');
    if (!opts.tools?.length) return request === '최종 상태를 알려줘'
      ? '화요일 10시, 켜짐, 다음 실행도 잡혔어요.' : '처리했어요.';
    if (!seen.has(request) && request !== '최종 상태를 알려줘') {
      seen.add(request);
      return { text: '', toolCalls: [{ name: 'automation.propose', args: {
        statement: request, kind: 'weekly', tool: 'local.file',
      } }] };
    }
    return { text: request === '최종 상태를 알려줘'
      ? '화요일 10시, 켜짐, 다음 실행도 잡혔어요.' : '처리했어요.', toolCalls: [] };
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
      purposeMet: state.jobs.some((j) => j.state === 'scheduled' && j.nextRunAt),
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

async function l7Case(correct) {
  const x = await room('t5-f64-l7-');
  const home = join(x.root, 'home');
  for (const [name, text] of Object.entries(L7_FIXTURE)) {
    assert.equal(sha(Buffer.from(text)), L7_SHA[name]);
    await mkdir(join(x.root, name, '..'), { recursive: true });
    await writeFile(join(x.root, name), text);
  }
  await mkdir(home);
  const expected = sha(Buffer.from(L7_SOURCE));
  const output = correct
    ? `파일: 승인본/배포설정.txt\nSHA256: ${expected}\n버전=2.4\n서버=production\n`
    : '파일: 승인본/배포설정.txt\n해시: 계산 실패 - 경로 확인 필요\n버전=2.4\n서버=production\n';
  let main = 0;
  const model = { async respond(tc, opts = {}) {
    if (tc.workContractAssessment) return { text: '', toolCalls: [{ name: 'work.deliverable', args: { output: 'file' } }] };
    if (!opts.tools?.length) return '해시 정보를 기록했어요.';
    main += 1;
    if (main === 1) return { text: '', toolCalls: [
      { name: 'local.terminal', args: { command: correct ? `shasum -a 256 ${join(x.root, '승인본/배포설정.txt')}` : 'md5 승인본/배포설정.txt' } },
      { name: 'local.file', args: { action: 'write', path: '배포_점검.txt', text: output } },
    ] };
    return { text: '해시 정보를 기록했어요.', toolCalls: [] };
  } };
  return withProduct({ ...x, model, terminalCwd: home }, async (app) => {
    await app.turn('선택한 파일의 해시와 핵심 설정을 배포_점검.txt에 따로 남겨줘. 원본은 건드리지 마.');
    const saved = await app.store.load(app.session.id);
    const terminal = saved.ledgerEntries.find((r) => r.actualCall?.tool === 'local.terminal');
    const text = await readFile(join(x.root, '배포_점검.txt'), 'utf8');
    const completion = saved.ledgerEntries.filter((r) => r.origin === 'completion_settlement' || r.receiptRef).length;
    return { terminalExit: terminal?.result?.exitCode, expectedDigest: expected,
      outputDigest: sha(Buffer.from(text)), hashRecorded: text.includes(expected), completion };
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

test('L6 원본 형제: 후보 3·승인/job/run 0은 활성 자동화 목적 결과가 아니다', async () => {
  const observed = await l6Case();
  process.stdout.write(`${JSON.stringify({ probe: 'L6-red', observed })}\n`);
  assert.deepEqual([observed.candidates, observed.approved, observed.jobs, observed.runs], [3, 0, 0, 0]);
  assert.equal(observed.purposeMet, CLOSE ? true : false);
});

test('L6 정상 반대조건의 기계 자: 활성·다음 실행은 실제 job에서만 참이다', () => {
  const state = { jobs: [{ state: 'scheduled', nextRunAt: 1786410000000 }] };
  assert.equal(state.jobs.some((j) => j.state === 'scheduled' && j.nextRunAt), true);
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
  assert.equal(observed.hashRecorded, true);
});
