#!/usr/bin/env node
// P-OP 결함 가족(A·B·C) 재현 측정 러너 — 2026-08-09.
// 코덱스 탐색(/Users/jyp/Developer/T5-Multiturn-Exploration-2026-08-09/runner.mjs)의 T5 팔을
// 재사용하되, 층 분리를 위해 턴마다 다음을 덤프한다:
//   ① 전체 result(모델 답·workStateDiagnostic·turnExchange·ledger 투영)
//   ② work-events.json 원장 스냅샷(그 턴 이후 늘어난 사건)
//   ③ projectWorkState → workStateFacts (다음 턴 모델이 받을 Current Work Brief)
//   ④ (fixture 시나리오) 파일 루트 실물 목록·해시
// 제품 코드는 1줄도 바꾸지 않는다. 격리 HOME·상태·파일 루트 — 실사용 자리 불가침.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  mkdir, mkdtemp, readFile, realpath, readdir, rm, writeFile,
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODEL_ID = 'gpt-5.1';

function parseArgs(argv) {
  const out = {};
  const values = new Set(['--t5-tree', '--t5-sha', '--scenario', '--output', '--label']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (values.has(a)) {
      const key = a.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
      out[key] = argv[++i];
    } else throw new Error(`모르는 옵션: ${a}`);
  }
  if (!out.run) throw new Error('--run 없이는 모델을 호출하지 않는다');
  if (!out.t5Tree || !out.t5Sha || !out.scenario || !out.output) {
    throw new Error('--t5-tree --t5-sha --scenario --output 이 모두 필요하다');
  }
  return out;
}

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

function readCredential(home) {
  const path = join(home, '.local/state/gpao-t5/sessions/model-connection.json');
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const connection = (j.connections ?? []).find((c) => c.id === j.activeId) ?? j.connections?.[0];
  if (!connection?.key) throw new Error('API key 방식의 저장 연결이 없다');
  if (connection.provider !== 'openai') throw new Error('openai 연결만 지원한다');
  return {
    provider: 'openai',
    key: connection.key,
    baseUrl: String(connection.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, ''),
  };
}

function importFrom(tree, rel) {
  return import(pathToFileURL(join(tree, rel)).href);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listFiles(root, base = root) {
  const out = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path, base));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      out.push({
        path: relative(base, path),
        bytes: bytes.length,
        sha256: sha256(bytes),
        text: bytes.length <= 4096 ? bytes.toString('utf8') : null,
      });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path, 'ko'));
}

function envPatch(values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tree = await realpath(resolve(args.t5Tree));
  const scenario = JSON.parse(await readFile(resolve(args.scenario), 'utf8'));
  const credential = readCredential(homedir());

  const room = await realpath(await mkdtemp(join(tmpdir(), `p-op-repro-${scenario.id}-`)));
  const home = join(room, 'home');
  const stateDir = join(room, 'state');
  const fileRoot = join(home, 'GPAO-T5');
  for (const path of [home, stateDir, fileRoot, join(home, 'Desktop'), join(home, 'Documents'), join(home, 'Downloads')]) {
    await mkdir(path, { recursive: true });
  }
  const ownerHome = await realpath(homedir());
  if (isWithin(ownerHome, room) || isWithin(room, ownerHome)) throw new Error('격리 방과 실제 홈이 겹친다');
  for (const [name, content] of Object.entries(scenario.fixture ?? {})) {
    const path = resolve(fileRoot, name);
    if (!isWithin(fileRoot, path)) throw new Error(`fixture 경로 이탈: ${name}`);
    await writeFile(path, content, 'utf8');
  }
  const fixtureBefore = scenario.fixture ? await listFiles(fileRoot) : null;

  const processEnv = {
    ...process.env,
    HOME: home,
    GPAO_T5_HOME: home,
    GPAO_T5_DATA_DIR: stateDir,
    GPAO_T5_FILE_ROOTS: fileRoot,
    GPAO_T5_TCELL: 'off',
    GPAO_T5_NO_AUTO_SCREEN_BIN: '1',
    GPAO_T5_CUA_BIN: '',
    GPAO_T5_DESKTOP_BIN: '',
    GPAO_T5_BROWSER_PATH: '',
    GPAO_T5_MODEL_PROVIDER: 'openai',
    OPENAI_API_KEY: credential.key,
    GPAO_T5_MODEL_BASE_URL: credential.baseUrl,
    GPAO_T5_MODEL_ID: MODEL_ID,
    GPAO_T5_MODEL_TIMEOUT_MS: '0',
    GPAO_T5_MODEL_HTTP_TIMEOUT_MS: '0',
  };
  const restoreEnv = envPatch(processEnv);
  let server;
  const turns = [];
  try {
    const [serverModule, storeModule, locatorModule, providerModule, contextModule, toolRunnerModule, fileModule, workStateModule] = await Promise.all([
      importFrom(tree, 'src/surface/server.js'),
      importFrom(tree, 'src/surface/session-store.js'),
      importFrom(tree, 'src/surface/install-locator.js'),
      importFrom(tree, 'src/runtime/model-provider.js'),
      importFrom(tree, 'src/surface/demo-context.js'),
      importFrom(tree, 'src/runtime/tool-runner.js'),
      importFrom(tree, 'src/runtime/local-file.js'),
      importFrom(tree, 'src/kernel/l1-intent/work-state.js'),
    ]);
    const allowed = scenario.fixture ? ['local.file'] : [];
    const localFile = fileModule.makeLocalFileTool({ dataDir: stateDir, roots: [fileRoot], homeDir: home });
    const toolMap = scenario.fixture ? { 'local.file': localFile } : {};
    const tools = new toolRunnerModule.ToolRunner(toolMap);
    const descriptors = contextModule.demoDescriptors({ include: allowed }).filter((d) => allowed.includes(d.id));
    const env = contextModule.demoEnv({ include: allowed, hands: allowed });
    env.connections = env.connections.filter((c) => allowed.includes(c.id));
    env.model = { id: MODEL_ID, strengths: '자연 대화·판단', authSignal: 'ok' };

    const store = new storeModule.SessionStore(stateDir);
    const identity = await locatorModule.설치신분(stateDir);
    const { model } = providerModule.selectLiveModel(processEnv);
    server = serverModule.makeServer({
      store,
      env,
      tools,
      descriptors,
      model,
      processEnv,
      modelProviderId: () => 'openai',
      runtimeEnvironment: { locality: 'this_computer', networkExposure: 'loopback_only', costTracking: 'not_tracked' },
      enableAgentDelegation: false,
      surfaceToken: identity.token,
      installId: identity.installId,
    });
    const port = await new Promise((resolveListen, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolveListen(server.address().port);
      });
    });
    const headers = { 'content-type': 'application/json', cookie: `t5_surface=${identity.token}` };
    const post = async (path, body) => {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new Error(`T5 표면 비JSON(${response.status}): ${text.slice(0, 160)}`); }
      if (!response.ok) throw new Error(`T5 표면 오류(${response.status}): ${parsed.error ?? parsed.kind ?? 'unknown'}`);
      return parsed;
    };
    const sessionId = (await post('/sessions')).id;
    const workEventsFile = join(stateDir, 'work-events.json');
    const readWorkEvents = async () => {
      try { return JSON.parse(await readFile(workEventsFile, 'utf8')).records ?? []; }
      catch { return []; }
    };
    const readSession = async () => JSON.parse(await readFile(join(stateDir, `${sessionId}.json`), 'utf8'));

    let previousEventCount = 0;
    for (let index = 0; index < scenario.turns.length; index += 1) {
      const started = Date.now();
      let result = await post('/turn', { sessionId, text: scenario.turns[index] });
      const steps = [result];
      while (result.kind === 'approval') {
        if (!scenario.fixture) throw new Error(`대화 시나리오에서 예상하지 않은 승인 카드: turn ${index + 1}`);
        result = await post('/turn', { sessionId, approve: result.pendingId });
        steps.push(result);
      }
      const elapsedMs = Date.now() - started;
      const session = await readSession();
      const events = await readWorkEvents();
      const newEvents = events.slice(previousEventCount);
      previousEventCount = events.length;
      let projectedBrief = null;
      let projection = null;
      if (session.workRef && session.principalRef) {
        projection = workStateModule.projectWorkState(events, {
          principalRef: session.principalRef,
          projectRef: session.workRef,
        });
        projectedBrief = workStateModule.workStateFacts(projection, { maxChars: 4000 });
      }
      turns.push({
        turn: index + 1,
        user: scenario.turns[index],
        elapsedMs,
        steps,
        newWorkEvents: newEvents,
        workEventTotal: events.length,
        nextTurnWorkBrief: projectedBrief,
        workStateProjection: projection,
        files: scenario.fixture ? await listFiles(fileRoot) : null,
      });
      process.stderr.write(`[${scenario.id}] turn ${index + 1}/${scenario.turns.length} 완료 (${elapsedMs}ms)\n`);
    }
    const fixtureAfter = scenario.fixture ? await listFiles(fileRoot) : null;
    const allEvents = await readWorkEvents();
    const record = {
      purpose: 'P-OP 결함 가족 A·B·C 재현 — 층 분리 측정',
      label: args.label ?? null,
      testedAt: new Date().toISOString(),
      productSha: args.t5Sha,
      model: { provider: 'openai', modelId: MODEL_ID },
      isolation: { room: 'ephemeral', home: 'ephemeral', state: 'ephemeral', fileRoot: 'ephemeral' },
      scenario: { id: scenario.id, title: scenario.title, turns: scenario.turns },
      fixture: scenario.fixture ? { before: fixtureBefore, after: fixtureAfter } : null,
      workEvents: allEvents,
      turns,
    };
    const output = resolve(args.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(record, null, 2), 'utf8');
    console.log(JSON.stringify({ ok: true, output, turns: turns.length }, null, 2));
  } finally {
    if (server?.listening) await new Promise((r) => server.close(() => r()));
    restoreEnv();
    await rm(room, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error?.stack ?? error}`);
  process.exitCode = 1;
});
