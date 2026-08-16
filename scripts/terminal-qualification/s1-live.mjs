// Terminal S1 live qualification: a real server/model/tool turn with a deterministic oracle.
// This is deliberately outside the runtime. It checks physical artifacts and receipts only;
// it does not ask the model to certify its own arithmetic.
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

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const expected = 'A\t23000\nB\t15000\nC\t11000\n';

// 이 도구는 T5 제품 도구가 아니다. S1 평가 하네스가 이 한 세션에만 제공하는
// 객관 oracle이며, turn.js는 이 도구의 존재·PASS·실패를 특별 취급하지 않는다.
function s1Verifier(output) {
  return {
    async handler() {
      const actual = await readFile(output, 'utf8').catch(() => null);
      if (actual === expected) {
        return { pass: true, expectedDigest: sha256(expected), actualDigest: sha256(actual),
          summary: 'S1 artifact verifier: PASS' };
      }
      return {
        pass: false,
        expectedDigest: sha256(expected),
        actualDigest: actual === null ? null : sha256(actual),
        mismatch: { kind: 'artifact_bytes', expected, actual },
        summary: 'S1 artifact verifier: FAIL — artifact bytes differ from the requested result.',
      };
    },
  };
}

async function json(base, cookie, path, body = undefined) {
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return value;
}

async function localFileReceipts(entries, output) {
  const canonicalOutput = await realpath(output).catch(() => null);
  if (!canonicalOutput) return [];
  const result = [];
  for (const entry of entries) {
    if (entry?.actualCall?.tool !== 'local.file') continue;
    const candidate = entry.actualCall?.args?.path ?? entry.result?.path ?? null;
    if (!candidate) continue;
    try {
      const candidatePath = String(candidate);
      const candidates = candidatePath.startsWith('/') ? [candidatePath] : [
        resolve(dirname(output), candidatePath),
        resolve(dirname(dirname(output)), candidatePath),
      ];
      if ((await Promise.all(candidates.map(async (path) => realpath(path).catch(() => null)))).includes(canonicalOutput)) {
        result.push(entry);
      }
    } catch { /* a failed/missing path is not output evidence */ }
  }
  return result;
}

const root = await mkdtemp(join(tmpdir(), 't5-terminal-s1-live-'));
const home = join(root, 'home');
const state = join(root, 'state');
const work = join(home, 'work');
// `home` 과 `home/work` 를 병렬 mkdir 하면 부모 생성 순서에 따라 러너가 ENOENT로
// 멈출 수 있다. 제품 판정 전 격리 환경부터 확정한다.
await Promise.all([mkdir(work, { recursive: true }), mkdir(state, { recursive: true })]);
const files = {
  'sales-east.tsv': 'A\t10000\nB\t15000\n',
  'sales-west.tsv': 'A\t15000\nC\t11000\n',
  'refunds.tsv': 'A\t2000\n',
};
for (const [name, text] of Object.entries(files)) await writeFile(join(work, name), text, 'utf8');
const output = join(work, 'net.tsv');
const sourceHashes = Object.fromEntries(await Promise.all(Object.keys(files).map(async (name) => [name, sha256(await readFile(join(work, name)))])));
const connection = 저장된연결(homedir());
if (!connection?.자격) throw new Error('저장된 모델 연결이 없어 라이브를 시작할 수 없습니다.');

let server;
const previousHome = process.env.HOME;
process.env.HOME = home;
try {
  const processEnv = {
    HOME: home, GPAO_T5_HOME: home, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: work,
    GPAO_T5_TCELL: 'off', GPAO_T5_NO_AUTO_SCREEN_BIN: '1', GPAO_T5_CUA_BIN: '',
    GPAO_T5_MODEL_PROVIDER: connection.provider ?? 'openai', OPENAI_API_KEY: connection.자격,
    GPAO_T5_MODEL_BASE_URL: connection.상류 ?? 'https://api.openai.com/v1',
    // 비교와 회귀 측정에서 같은 T5 제품 경로에 다른 연결 모델을 명시할 수 있다.
    GPAO_T5_MODEL_ID: process.env.T5_LIVE_MODEL_ID ?? connection.modelId ?? 'gpt-5.1',
  };
  const live = liveDeps(processEnv);
  const verifyDescriptor = defineTool({
    id: 'task.verify', label: 'S1 결과 검사', owner: 'plugin', availability: [{ kind: 'connected' }],
    toolKind: 'read', needsApproval: false,
    capability: '이 평가 과업의 실제 결과 파일을 객관적으로 검사한다.',
    operatorFact: '평가 하네스가 제공한 결과 검사를 실행한다.',
    schema: {
      description: 'S1 평가 하네스가 제공한 결과 검사다. 결과 파일을 만든 뒤 호출한다. FAIL이면 mismatch 영수증을 보고 원본 자료와 요청을 다시 확인해 고치고 재검사한다.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  });
  live.tools.tools['task.verify'] = s1Verifier(output);
  live.env.connections.push({ ...toConnection(verifyDescriptor, { connected: true }), hasHandler: true });
  live.descriptors.push(verifyDescriptor);
  server = makeServer({
    store: new SessionStore(state), eventLog: new EventLog(state), memStore: new MemoryStore(state),
    env: live.env, tools: live.tools, descriptors: live.descriptors, model: live.model,
    processEnv,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const session = await json(base, cookie, '/sessions', {});
  const prompt = [
    '홈 폴더 안 work 폴더의 sales-east.tsv, sales-west.tsv, refunds.tsv를 모두 읽어 순매출을 계산해 주세요.',
    'sales는 더하고 refunds는 빼서 A, B, C 순서의 탭 TSV net.tsv를 만드세요.',
    '터미널로 계산할 때는 결과를 표준 출력으로 확인하고, 파일 저장은 파일 도구로 하세요.',
    'net.tsv를 다시 읽고 S1 결과 검사 도구를 호출해 실제 내용이 맞는지 확인한 뒤 완료를 알려 주세요.',
    '이 평가에서는 S1 결과 검사 도구의 PASS 영수증이 나오기 전에는 계산 설명만으로 완료할 수 없습니다.',
  ].join(' ');
  const turn = await json(base, cookie, '/turn', { sessionId: session.id, text: prompt });
  const persisted = JSON.parse(await readFile(join(state, `${session.id}.json`), 'utf8'));
  const artifact = await readFile(output, 'utf8').catch(() => null);
  const sourceUnchanged = await Promise.all(Object.keys(files).map(async (name) => sha256(await readFile(join(work, name))) === sourceHashes[name]));
  const outputReceipts = await localFileReceipts(persisted.ledgerEntries ?? [], output);
  const writes = outputReceipts.filter((entry) => entry.actualCall?.args?.action === 'write');
  const reads = outputReceipts.filter((entry) => ['read', 'open'].includes(entry.actualCall?.args?.action));
  const approvals = (persisted.ledgerEntries ?? []).filter((entry) => entry?.failureState === 'approval_required').length;
  const report = {
    schemaVersion: 1,
    scenario: 'terminal-s1-net-settlement',
    modelId: processEnv.GPAO_T5_MODEL_ID,
    sourceHead: (await import('node:child_process')).execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    artifact: { expected, observed: artifact, matches: artifact === expected },
    sourceUnchanged: sourceUnchanged.every(Boolean), approvals,
    outputWriteReceipts: writes.length, outputReadReceipts: reads.length,
    verifierReceipts: (persisted.ledgerEntries ?? []).filter((entry) => entry?.actualCall?.tool === 'task.verify')
      .map((entry) => ({ pass: entry.result?.pass === true, mismatch: entry.result?.mismatch ?? null })),
    terminalReceipts: (persisted.ledgerEntries ?? []).filter((entry) => entry?.actualCall?.tool === 'local.terminal').map((entry) => ({
      executable: entry.actualCall?.args?.executable ?? null,
      argv: entry.actualCall?.args?.argv ?? null,
      cwd: entry.actualCall?.args?.cwd ?? null,
      exitCode: entry.result?.exitCode ?? entry.result?.commandExit?.code ?? null,
      stdout: entry.result?.stdout ?? null,
      stderr: entry.result?.stderr ?? null,
      processState: entry.result?.processState ?? entry.result?.effect?.process ?? null,
      failureState: entry.failureState ?? null,
    })),
    receiptTools: (persisted.ledgerEntries ?? []).map((entry) => ({
      tool: entry?.actualCall?.tool ?? null,
      action: entry?.actualCall?.args?.action ?? null,
      path: entry?.actualCall?.args?.path ?? entry?.result?.path ?? null,
    })),
    finalReply: turn.reply ?? turn.text ?? null,
    pass: artifact === expected && sourceUnchanged.every(Boolean) && approvals === 0
      && writes.length >= 1 && reads.length >= 1
      && (persisted.ledgerEntries ?? []).some((entry) => entry?.actualCall?.tool === 'task.verify' && entry.result?.pass === true),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
}
