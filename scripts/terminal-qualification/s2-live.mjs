// Terminal S2 live qualification: missing-command recovery with a harness-only verifier.
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { makeServer } from '../../src/surface/server.js';
import { SessionStore } from '../../src/surface/session-store.js';
import { EventLog } from '../../src/surface/event-log.js';
import { MemoryStore } from '../../src/surface/memory-store.js';
import { liveDeps } from '../../src/surface/live-context.js';
import { defineTool, toConnection } from '../../src/kernel/l2-plan/tool-descriptor.js';
import { 저장된연결 } from '../s1/run.mjs';

const expected = 'E_CONN\t3\nE_PARSE\t1\n';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function post(base, cookie, path, body) {
  const r = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return json;
}

function verifier(output) {
  return { async handler() {
    const actual = await readFile(output, 'utf8').catch(() => null);
    return actual === expected
      ? { pass: true, expectedDigest: sha256(expected), actualDigest: sha256(actual), summary: 'S2 artifact verifier: PASS' }
      : { pass: false, expectedDigest: sha256(expected), actualDigest: actual === null ? null : sha256(actual),
        mismatch: { kind: 'artifact_bytes', expected, actual }, summary: 'S2 artifact verifier: FAIL — artifact bytes differ.' };
  } };
}

async function outputReceipts(entries, output) {
  const canonical = await realpath(output).catch(() => null);
  if (!canonical) return [];
  const found = [];
  for (const entry of entries) {
    if (entry?.actualCall?.tool !== 'local.file') continue;
    const candidate = entry.actualCall?.args?.path ?? entry.result?.path;
    if (!candidate) continue;
    const text = String(candidate);
    const choices = text.startsWith('/') ? [text] : [resolve(dirname(output), text), resolve(dirname(dirname(output)), text)];
    if ((await Promise.all(choices.map((p) => realpath(p).catch(() => null)))).includes(canonical)) found.push(entry);
  }
  return found;
}

const root = await mkdtemp(join(tmpdir(), 't5-terminal-s2-live-'));
const home = join(root, 'home'); const state = join(root, 'state'); const work = join(home, 'work');
await Promise.all([mkdir(work, { recursive: true }), mkdir(state, { recursive: true })]);
const sources = {
  'api.log': '2026-08-14 INFO start\n2026-08-14 ERROR E_CONN upstream\n2026-08-14 ERROR E_PARSE payload\n2026-08-14 ERROR E_CONN retry\n',
  'worker.log': '2026-08-14 ERROR E_CONN retry\n2026-08-14 INFO done\n',
};
for (const [name, content] of Object.entries(sources)) await writeFile(join(work, name), content);
const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(sources).map(async (name) => [name, sha256(await readFile(join(work, name)))])));
const output = join(work, 'error-summary.tsv');
const connection = 저장된연결(homedir());
if (!connection?.자격) throw new Error('저장된 모델 연결이 없어 라이브를 시작할 수 없습니다.');
const oldHome = process.env.HOME; let server;
process.env.HOME = home;
try {
  const env = {
    HOME: home, GPAO_T5_HOME: home, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: work,
    GPAO_T5_TCELL: 'off', GPAO_T5_NO_AUTO_SCREEN_BIN: '1', GPAO_T5_CUA_BIN: '',
    GPAO_T5_MODEL_PROVIDER: connection.provider ?? 'openai', OPENAI_API_KEY: connection.자격,
    GPAO_T5_MODEL_BASE_URL: connection.상류 ?? 'https://api.openai.com/v1',
    GPAO_T5_MODEL_ID: process.env.T5_LIVE_MODEL_ID ?? connection.modelId ?? 'gpt-5.1',
  };
  const live = liveDeps(env);
  // 실패 원문은 같은 턴 판단에만 산다. SessionStore readback 으로 그 원문을 다시 꺼내
  // S2를 판정하면 제품의 수명 계약을 깨야만 하네스가 통과한다. 실제 handler 경계에서
  // 이번 실행 동안만 관측하고, 지속 원장은 공개 호출·상태 검증에만 쓴다.
  const terminalRuns = [];
  const terminalTool = live.tools.tools['local.terminal'];
  const terminalHandler = terminalTool.handler.bind(terminalTool);
  terminalTool.handler = async (args, context) => {
    const out = await terminalHandler(args, context);
    terminalRuns.push({
      command: args?.command ?? null,
      observation: structuredClone(out?.failureResult ?? out?.result ?? null),
      failureState: out?.failed ? 'failed' : (out?.blocked ? 'blocked' : 'none'),
    });
    return out;
  };
  const descriptor = defineTool({
    id: 'task.verify', label: 'S2 결과 검사', owner: 'plugin', availability: [{ kind: 'connected' }], toolKind: 'read', needsApproval: false,
    capability: '이 평가 과업의 실제 결과 파일을 객관적으로 검사한다.', operatorFact: '평가 하네스가 제공한 결과 검사를 실행한다.',
    schema: { description: 'S2 평가 하네스 결과 검사다. 결과 파일을 만든 뒤 호출한다. FAIL이면 원본 로그를 다시 확인해 고치고 재검사한다.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
  });
  live.tools.tools['task.verify'] = verifier(output);
  live.env.connections.push({ ...toConnection(descriptor, { connected: true }), hasHandler: true });
  live.descriptors.push(descriptor);
  server = makeServer({ store: new SessionStore(state), eventLog: new EventLog(state), memStore: new MemoryStore(state), env: live.env, tools: live.tools, descriptors: live.descriptors, model: live.model, processEnv: env });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const session = await post(base, cookie, '/sessions', {});
  const turn = await post(base, cookie, '/turn', { sessionId: session.id, text: [
    '홈 폴더 안 work 폴더의 api.log와 worker.log에서 ERROR 코드별 발생 횟수를 집계해 error-summary.tsv를 만드세요. 헤더 없이 E_CONN, E_PARSE 순서의 탭 TSV 행만 써야 합니다.',
    '먼저 이 회사의 logstat 명령을 실행해 보세요. 없거나 실패하면 같은 명령을 반복하지 말고 터미널의 다른 방법으로 바로 집계를 끝내세요.',
    '계산 결과는 터미널 표준 출력으로 확인하고 파일 저장은 파일 도구로 하세요. 결과 파일을 다시 읽고 S2 결과 검사 도구를 호출하세요.',
    '이 평가에서는 S2 결과 검사 PASS 영수증 전에는 완료라고 말할 수 없습니다.',
  ].join(' ') });
  const persisted = JSON.parse(await readFile(join(state, `${session.id}.json`), 'utf8'));
  const entries = persisted.ledgerEntries ?? [];
  const artifact = await readFile(output, 'utf8').catch(() => null);
  const receipts = await outputReceipts(entries, output);
  const terminal = entries.filter((entry) => entry?.actualCall?.tool === 'local.terminal');
  const missing = terminalRuns.some((run) => /logstat/.test(run.command ?? '')
    && run.observation?.processDelivery === 'delivered'
    && Number(run.observation?.exitCode ?? run.observation?.commandExit?.code) !== 0);
  // 단순 pwd·ls 성공은 복구가 아니다. 실패 뒤의 다른 터미널 명령이 실제 집계 TSV만
  // stdout으로 냈을 때만 S2의 복구로 센다. CRLF는 전송 차이로만 정규화한다.
  const recovered = terminalRuns.some((run) => !/logstat/.test(run.command ?? '')
    && Number(run.observation?.exitCode ?? run.observation?.commandExit?.code) === 0
    && String(run.observation?.stdout ?? '').replace(/\r\n/g, '\n') === expected);
  const sourceUnchanged = (await Promise.all(Object.keys(sources).map(async (name) => sha256(await readFile(join(work, name))) === sourceHashes[name]))).every(Boolean);
  const approvals = entries.filter((entry) => entry?.failureState === 'approval_required').length;
  const report = {
    schemaVersion: 1, scenario: 'terminal-s2-missing-command-recovery', modelId: env.GPAO_T5_MODEL_ID,
    sourceHead: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    artifact: { expected, observed: artifact, matches: artifact === expected }, sourceUnchanged, approvals,
    initialMissingCommandObserved: missing, alternativeTerminalSuccess: recovered,
    outputWriteReceipts: receipts.filter((entry) => entry.actualCall?.args?.action === 'write').length,
    outputReadReceipts: receipts.filter((entry) => ['read', 'open'].includes(entry.actualCall?.args?.action)).length,
    verifierReceipts: entries.filter((entry) => entry?.actualCall?.tool === 'task.verify').map((entry) => ({ pass: entry.result?.pass === true, mismatch: entry.result?.mismatch ?? null })),
    terminalReceipts: terminal.map((entry) => ({ command: entry.actualCall?.args?.command ?? null, cwd: entry.actualCall?.args?.cwd ?? null, failureState: entry.failureState ?? null })),
    runtimeTerminalObservations: terminalRuns,
    finalReply: turn.reply ?? turn.text ?? null,
  };
  report.pass = report.artifact.matches && sourceUnchanged && approvals === 0 && missing && recovered && report.outputWriteReceipts >= 1 && report.outputReadReceipts >= 1 && report.verifierReceipts.some((entry) => entry.pass);
  console.log(JSON.stringify(report, null, 2)); process.exitCode = report.pass ? 0 : 1;
} finally {
  if (server) await new Promise((done) => server.close(done));
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
}
