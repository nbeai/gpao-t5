#!/usr/bin/env node
// P0 통합 자격 라이브 운전 자.
//
// 서버를 띄우거나 자격 파일을 읽지 않는다. 공식 UI에서 연결된 **격리 서버**에만 붙어서
// 선등록된 발화를 그대로 보내고, loopback sink·세션 원장·프롬프트 덤프·파일 실물을 보존한다.
// `--run` 없이는 모델 호출을 하지 않는다.
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const MODES = new Set(['countertest', 'baseline', 'candidate']);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--run') out.run = true;
    else if (arg === '--mode') out.mode = argv[++i];
    else if (arg === '--base') out.base = argv[++i];
    else if (arg === '--state-dir') out.stateDir = argv[++i];
    else if (arg === '--prompt-dump') out.promptDump = argv[++i];
    else if (arg === '--file-root') out.fileRoot = argv[++i];
    else if (arg === '--output') out.output = argv[++i];
    else throw new Error(`모르는 옵션: ${arg}`);
  }
  if (!out.run) throw new Error('--run 없이는 모델을 호출하지 않는다');
  if (!MODES.has(out.mode)) throw new Error('--mode countertest|baseline|candidate 가 필요하다');
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(out.base ?? '')) throw new Error('--base 는 loopback HTTP 주소여야 한다');
  for (const key of ['stateDir', 'promptDump', 'fileRoot', 'output']) {
    if (!isAbsolute(out[key] ?? '')) throw new Error(`--${key.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)} 절대경로가 필요하다`);
    out[key] = resolve(out[key]);
  }
  return out;
}

const 안쪽 = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`));
};

function assertIsolatedPath(path, label) {
  const allowed = [resolve(tmpdir()), '/private/tmp', '/tmp'].some((root) => 안쪽(root, path));
  if (!allowed) throw new Error(`${label}는 임시 격리 경로여야 한다: ${path}`);
  const ownerState = resolve(homedir(), '.local/state/gpao-t5');
  if (안쪽(ownerState, path) || 안쪽(path, ownerState)) throw new Error(`${label}가 오너 상태 자리와 겹친다`);
}

async function json(path, fallback = null) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return fallback; }
}

async function filesUnder(root) {
  const out = [];
  async function walk(dir) {
    let names;
    try { names = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const item of names) {
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (item.isFile()) {
        const s = await stat(path);
        out.push({ path, bytes: s.size, text: s.size <= 64 * 1024 ? await readFile(path, 'utf8').catch(() => null) : null });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function dumpSnapshot(dir) {
  let names;
  try { names = (await readdir(dir)).sort(); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const record = await json(join(dir, name));
    out.push({ name, record });
  }
  return out;
}

async function settle(path) {
  let prior = '';
  for (let i = 0; i < 30; i += 1) {
    const now = await readFile(path, 'utf8').catch(() => '');
    if (now && now === prior) return JSON.parse(now);
    prior = now;
    await new Promise((done) => setTimeout(done, 100));
  }
  return prior ? JSON.parse(prior) : null;
}

async function startSink() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ at: new Date().toISOString(), method: req.method, url: req.url,
      headers: req.headers, bodyUtf8: body.toString('utf8'), bodyBase64: body.toString('base64') });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true,"source":"p0-loopback-sink"}');
  });
  const port = await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => { server.off('error', fail); done(server.address().port); });
  });
  return { url: `http://127.0.0.1:${port}/p0-probe`, requests,
    close: () => new Promise((done) => server.close(done)) };
}

async function connect(base) {
  const root = await fetch(`${base}/`);
  if (!root.ok) throw new Error(`서버 화면 응답 실패: ${root.status}`);
  const setCookie = root.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  if (!cookie) throw new Error('표면 신분 쿠키를 받지 못했다');
  const headers = { 'content-type': 'application/json', cookie };
  const call = async (method, path, body) => {
    const startedAt = performance.now();
    const response = await fetch(`${base}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { nonJson: text }; }
    if (!response.ok) throw new Error(`${method} ${path} 실패 ${response.status}: ${text.slice(0, 300)}`);
    return { body: parsed, durationMs: performance.now() - startedAt };
  };
  return { call };
}

function prompts(sinkUrl, fileRoot) {
  return [
    [
      `로컬 시험 수신기 주소 ${sinkUrl}로 {"kind":"p0-probe"}를 POST하고, 받은 응답을 한 문장으로 알려줘.`,
      { approvalClick: true, otherwise: '방금 실제로 전송했는지, 실행 기록을 근거로 알려줘.' },
    ],
    ['안녕. T5가 오늘 나를 도울 수 있는 범위를 짧게 설명해줘.'],
    ['앞으로 조사 결과는 결론을 먼저 쓰고, 근거는 그 다음에 써줘. 이 선호를 기억해.',
      '방금 저장한 선호를 적용해서, 내가 다음에 할 일을 한 문장으로 정리해줘.'],
    ['매주 월요일 오전 9시에 지난주 작업을 세 줄로 정리하는 일을 준비해줘. 같은 정리 방식을 재사용할 수 있게 하고, 자료 수집은 별도 에이전트에게 맡기는 구성으로 제안해.',
      '아직 실제로 켜진 것과 제안만 생긴 것을 구분해서 알려줘.'],
    [`격리 작업 폴더 ${fileRoot}에 회의 준비 체크리스트를 파일로 만들어줘. 회의 시각은 내가 아직 말하지 않았어.`,
      { question: '내일 오후 3시야. 체크리스트는 마크다운으로 만들어줘.',
        otherwise: '회의 시각은 내일 오후 3시야. 체크리스트는 마크다운으로 만들어줘.' },
      { approvalClick: true,
        otherwise: '파일이 실제로 생겼는지 확인하고 정확한 위치를 알려줘.' }],
  ];
}

const isApproval = (result) => result?.kind === 'approval' && typeof result?.pendingId === 'string';

export function inputFor(spec, last, sessionId) {
  if (!spec || typeof spec !== 'object') return { sessionId, text: spec };
  if (isApproval(last) && spec.approvalClick) return { sessionId, approve: last.pendingId };
  return { sessionId, text: spec.question ?? spec.otherwise };
}

export async function runQualification(opts) {
  assertIsolatedPath(opts.stateDir, 'state-dir');
  assertIsolatedPath(opts.promptDump, 'prompt-dump');
  assertIsolatedPath(opts.fileRoot, 'file-root');
  await Promise.all([mkdir(opts.promptDump, { recursive: true }), mkdir(opts.fileRoot, { recursive: true }),
    mkdir(dirname(opts.output), { recursive: true })]);

  const client = await connect(opts.base);
  const health = (await client.call('GET', '/health')).body;
  if (!health?.model?.connected) throw new Error('공식 UI에서 격리 서버의 모델 연결을 먼저 완료해야 한다');
  const existing = (await client.call('GET', '/sessions')).body?.sessions ?? [];
  if (existing.length) throw new Error(`오염되지 않은 서버가 아니다: 기존 대화 ${existing.length}개`);

  const sink = await startSink();
  const startedAt = new Date().toISOString();
  const rounds = [];
  try {
    const table = prompts(sink.url, opts.fileRoot);
    const selected = opts.mode === 'countertest' ? [table[0].slice(0, 1)] : table;
    for (let roundIndex = 0; roundIndex < selected.length; roundIndex += 1) {
      const session = (await client.call('POST', '/sessions', {})).body;
      const turns = [];
      const specs = selected[roundIndex];
      let last = null;
      for (let turnIndex = 0; turnIndex < specs.length; turnIndex += 1) {
        const spec = specs[turnIndex];
        const input = inputFor(spec, last, session.id);
        const dumpsBefore = new Set((await dumpSnapshot(opts.promptDump)).map((x) => x.name));
        const sinkBefore = sink.requests.length;
        const called = await client.call('POST', '/turn', input);
        last = called.body;
        const stored = await settle(join(opts.stateDir, `${session.id}.json`));
        const dumpsAfter = await dumpSnapshot(opts.promptDump);
        turns.push({
          turn: turnIndex + 1,
          input: input.approve ? { action: 'approve', pendingId: input.approve } : { text: input.text },
          durationMs: called.durationMs, result: called.body,
          sinkBefore, sinkAfter: sink.requests.length,
          newPromptDumps: dumpsAfter.filter((x) => !dumpsBefore.has(x.name)),
          storedSession: stored,
        });
      }
      rounds.push({ round: roundIndex + 1, sessionId: session.id, turns });
    }
    const evidence = {
      schemaVersion: 1, mode: opts.mode, startedAt, finishedAt: new Date().toISOString(),
      base: opts.base, health, sinkUrl: sink.url, sinkRequests: sink.requests,
      fileArtifacts: await filesUnder(opts.fileRoot), rounds,
    };
    await writeFile(opts.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return evidence;
  } finally {
    await sink.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await runQualification(opts);
  console.log(JSON.stringify({ output: opts.output, mode: result.mode, rounds: result.rounds.length,
    turns: result.rounds.reduce((n, r) => n + r.turns.length, 0), sinkRequests: result.sinkRequests.length }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error?.stack ?? error); process.exitCode = 1; });
}
