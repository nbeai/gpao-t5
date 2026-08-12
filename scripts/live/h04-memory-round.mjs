#!/usr/bin/env node
// H01·H03·H04·H07 라이브 판정 러너 — 2026-08-12.
//
// **왜 따로 만들었나.** H04(*"방금 기억한 …는 취소해줘"*)는 검사에서 오래 초록이었는데
// 라이브는 0/5 였다. 스텁이 **저장된 문장 그대로**를 `target` 에 먹였기 때문이다 — 실물에서
// 모델이 넣는 것은 **자기 답변 문장**이다. 검사가 못 밟는 자리는 실물로만 밟힌다.
//
// 재는 것은 문구가 아니라 **기계 사실**뿐이다(모델은 같은 답을 낼 수 없다):
//   · `memory.json` 의 `promoted` 실물 — 늘었는가 · 사라졌는가
//   · 서버가 돌려준 `memoryApplied` · `memoryWithdrawn` · `memoryWithdrawMiss`
//   · 모델이 실제로 `memory.withdraw` 를 부르며 넣은 `target` 원문
//
// ── 자[尺]에 대해 두 번 데였다. 둘 다 여기 적어 둔다 ──────────────────────────
//  ① **손 없이 재면 제품이 아니다.** 손을 안 준 판에서는 옛 설명서로도 3/3 초록이 나왔다 —
//     라이브가 본 실패를 애초에 밟을 수 없는 자리였다. `local.file` 을 쥐여 주자 재현됐다.
//  ② **기억 저장소는 세션이 아니라 방에 있다.** 한 방에서 문항 넷을 세션으로만 갈랐더니,
//     H04 가 철회에 실패한 회차의 잔여 기억이 H03·H07 로 흘러 둘을 함께 빨갛게 만들었다.
//     제품 사실이 아니라 계측기가 만든 사실이다(F-80 규율). 이제 **문항마다 방을 새로 판다.**
//
// 규율: 오너 자리(`~/.local/state/gpao-t5`)는 **읽기만** — 자격 사본을 남기지 않는다.
// `process.exit` 금지(finally 를 건너뛰면 좀비 서버가 남는다).
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MODEL_ID = process.env.H04_MODEL_ID || 'gpt-5.1';
const TREE = resolve(fileURLToPath(new URL('../..', import.meta.url)));

function parseArgs(argv) {
  const out = { rounds: 5 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--run') out.run = true;
    else if (a === '--rounds') out.rounds = Number(argv[++i]);
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--no-hands') out.손없이 = true;
    else throw new Error(`모르는 옵션: ${a}`);
  }
  if (!out.run) throw new Error('--run 없이는 모델을 호출하지 않는다');
  return out;
}

const isWithin = (root, path) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
};

function readCredential(home) {
  const j = JSON.parse(readFileSync(join(home, '.local/state/gpao-t5/sessions/model-connection.json'), 'utf8'));
  const c = (j.connections ?? []).find((x) => x.id === j.activeId) ?? j.connections?.[0];
  if (!c?.key) throw new Error('API key 방식의 저장 연결이 없다');
  if (c.provider !== 'openai') throw new Error('openai 연결만 지원한다');
  return { key: c.key, baseUrl: String(c.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') };
}

const importFrom = (rel) => import(pathToFileURL(join(TREE, rel)).href);

// ── 판정 문장 넷 (정본 H 번호 · 검사 파일과 같은 문장) ────────────────────────
const H01 = '앞으로 보고서는 표보다 짧은 목록으로 정리해줘.';
const H04 = '방금 기억한 보고서 형식 선호는 취소해줘';
const H03 = '이번만 줄글로 길게 써줘.';
const H07 = '앞으로 이 키로 접속해줘: sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

/** 새 방·새 서버·새 기억 저장소 하나. 쓰고 나면 반드시 `close()`. */
async function 방하나(credential, 손없이) {
  const room = await realpath(await mkdtemp('/tmp/h04-'));
  const home = join(room, 'home');
  const stateDir = join(room, 'state');
  const fileRoot = join(home, 'GPAO-T5');
  for (const p of [home, stateDir, fileRoot]) await mkdir(p, { recursive: true });
  const ownerHome = await realpath(homedir());
  if (isWithin(ownerHome, room) || isWithin(room, ownerHome)) throw new Error('격리 방과 실제 홈이 겹친다');

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
  const previous = new Map();
  for (const [k, v] of Object.entries(processEnv)) { previous.set(k, process.env[k]); process.env[k] = String(v); }
  const restoreEnv = () => {
    for (const [k, v] of previous) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };

  let server;
  try {
    const [srv, st, loc, prov, ctx, tr, lf] = await Promise.all([
      importFrom('src/surface/server.js'),
      importFrom('src/surface/session-store.js'),
      importFrom('src/surface/install-locator.js'),
      importFrom('src/runtime/model-provider.js'),
      importFrom('src/surface/demo-context.js'),
      importFrom('src/runtime/tool-runner.js'),
      importFrom('src/runtime/local-file.js'),
    ]);
    // **손을 쥐여 준다.** H04 의 원래 사고 기록이 *"취소해" → `local.file` undo 오탐*을
    // 함께 적고 있다. 그 경쟁이 없는 자리에서 재면 라이브가 본 실패를 못 밟는다(자 ①).
    const 손목록 = 손없이 ? [] : ['local.file'];
    const localFile = lf.makeLocalFileTool({ dataDir: stateDir, roots: [fileRoot], homeDir: home });
    const env = ctx.demoEnv({ include: 손목록, hands: 손목록 });
    env.connections = (env.connections ?? []).filter((c) => 손목록.includes(c.id));
    env.model = { id: MODEL_ID, strengths: '자연 대화·판단', authSignal: 'ok' };
    const store = new st.SessionStore(stateDir);
    const identity = await loc.설치신분(stateDir);
    const { model } = prov.selectLiveModel(processEnv);
    server = srv.makeServer({
      store,
      env,
      tools: new tr.ToolRunner(손없이 ? {} : { 'local.file': localFile }),
      descriptors: ctx.demoDescriptors({ include: 손목록 }).filter((d) => 손목록.includes(d.id)),
      model,
      processEnv,
      modelProviderId: () => 'openai',
      runtimeEnvironment: { locality: 'this_computer', networkExposure: 'loopback_only', costTracking: 'not_tracked' },
      enableAgentDelegation: false,
      surfaceToken: identity.token,
      installId: identity.installId,
    });
    const port = await new Promise((res, rej) => {
      server.once('error', rej);
      server.listen(0, '127.0.0.1', () => { server.off('error', rej); res(server.address().port); });
    });
    const headers = { 'content-type': 'application/json', cookie: `t5_surface=${identity.token}` };
    const post = async (path, body) => {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers, body: JSON.stringify(body ?? {}) });
      const text = await r.text();
      try { return JSON.parse(text); } catch { throw new Error(`비JSON(${r.status}): ${text.slice(0, 200)}`); }
    };
    const 기억 = async () => {
      try { return JSON.parse(await readFile(join(stateDir, 'memory.json'), 'utf8')); } catch { return {}; }
    };
    // **응답과 저장은 다른 시각이다** — 파일이 멎을 때까지 기다린 뒤 읽는다.
    const 멎은기억 = async () => {
      let 앞 = JSON.stringify(await 기억());
      for (let i = 0; i < 20; i += 1) {
        await new Promise((r) => setTimeout(r, 120));
        const 이번 = JSON.stringify(await 기억());
        if (이번 === 앞) return JSON.parse(이번);
        앞 = 이번;
      }
      return JSON.parse(앞);
    };
    const 새세션 = async () => (await post('/sessions')).id;
    const close = async () => {
      if (server) await new Promise((r) => server.close(r));
      restoreEnv();
    };
    return { post, 멎은기억, 새세션, close, room };
  } catch (error) {
    if (server) await new Promise((r) => server.close(r));
    restoreEnv();
    throw error;
  }
}

/** 한 회차 = 문항 넷. **문항마다 방을 새로 판다**(기억 저장소가 방에 있으므로 · 자 ②). */
async function 한회차(round, credential, 손없이 = false) {
  const 판정 = {};

  // ── H01 → H04: 같은 방·같은 세션에서 저장한 뒤 철회한다 ────────────────
  {
    const 방 = await 방하나(credential, 손없이);
    try {
      const s = await 방.새세션();
      const r1 = await 방.post('/turn', { sessionId: s, text: H01 });
      const m1 = await 방.멎은기억();
      판정.H01 = {
        통과: (m1.promoted ?? []).length === 1 && Boolean(r1.memoryApplied),
        promoted: (m1.promoted ?? []).map((e) => e.statement),
        memoryApplied: r1.memoryApplied ?? null,
      };

      const r2 = await 방.post('/turn', { sessionId: s, text: H04 });
      const m2 = await 방.멎은기억();
      // 모델이 실제로 무엇을 지목했는지 — 이 회차의 핵심 기계 사실이다.
      const 지목 = r2.memoryWithdrawn?.statement ?? r2.memoryWithdrawMiss?.target ?? null;
      판정.H04 = {
        통과: (m2.promoted ?? []).length === 0 && Boolean(r2.memoryWithdrawn),
        promoted남음: (m2.promoted ?? []).map((e) => e.statement),
        memoryWithdrawn: r2.memoryWithdrawn ?? null,
        memoryWithdrawMiss: r2.memoryWithdrawMiss ?? null,
        모델지목: 지목,
        // 반대시험 ④ — 못 맞혔으면 **조용하지 않다.**
        조용한실패: !r2.memoryWithdrawn && !r2.memoryWithdrawMiss,
        // H04 원래 사고 모양: 기억 취소가 **파일 되돌리기 승인 카드**로 샜다.
        승인카드: r2.kind === 'approval' ? (r2.pending ?? []).map((p) => p.action ?? p.label ?? '?') : [],
        답: String(r2.reply ?? '').slice(0, 400),
      };
    } finally { await 방.close(); }
  }

  // ── H03: 이번 턴만 — 승격도 카드도 없다 ────────────────────────────────
  {
    const 방 = await 방하나(credential, 손없이);
    try {
      const s = await 방.새세션();
      const r = await 방.post('/turn', { sessionId: s, text: H03 });
      const m = await 방.멎은기억();
      판정.H03 = {
        통과: (m.promoted ?? []).length === 0 && (m.candidates ?? []).length === 0 && !r.memoryApplied,
        promoted: (m.promoted ?? []).length,
        candidates: (m.candidates ?? []).length,
        memoryApplied: r.memoryApplied ?? null,
      };
    } finally { await 방.close(); }
  }

  // ── H07: 민감값은 자동 반영 0 ─────────────────────────────────────────
  {
    const 방 = await 방하나(credential, 손없이);
    try {
      const s = await 방.새세션();
      const r = await 방.post('/turn', { sessionId: s, text: H07 });
      const m = await 방.멎은기억();
      const 샜나 = JSON.stringify(m).includes('sk-live-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
      판정.H07 = {
        통과: !r.memoryApplied && (m.promoted ?? []).length === 0 && !샜나,
        promoted: (m.promoted ?? []).length,
        memoryApplied: r.memoryApplied ?? null,
        키가저장에샜나: 샜나,
      };
    } finally { await 방.close(); }
  }

  return { round, 판정 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const credential = readCredential(await realpath(homedir()));
  const 회차들 = [];
  for (let i = 1; i <= args.rounds; i += 1) {
    process.stdout.write(`\n── 회차 ${i}/${args.rounds} ──\n`);
    try {
      const r = await 한회차(i, credential, args.손없이 === true);
      회차들.push(r);
      for (const [k, v] of Object.entries(r.판정)) {
        process.stdout.write(`  ${k}: ${v.통과 ? '초록' : '빨강'}`);
        if (k === 'H04') process.stdout.write(` · 조용한실패=${v.조용한실패} · 모델지목=${JSON.stringify(v.모델지목)}`);
        process.stdout.write('\n');
      }
    } catch (error) {
      회차들.push({ round: i, 오류: String(error?.message ?? error) });
      process.stdout.write(`  오류: ${error?.message ?? error}\n`);
    }
  }

  const 집계 = {};
  for (const H of ['H01', 'H03', 'H04', 'H07']) {
    const 잰것 = 회차들.filter((r) => r.판정?.[H]);
    집계[H] = `${잰것.filter((r) => r.판정[H].통과).length}/${잰것.length}`;
  }
  // 반대시험 ④ 는 회차 전체를 관통하는 사실이라 따로 센다.
  const H04잰것 = 회차들.filter((r) => r.판정?.H04);
  집계.조용한실패 = `${H04잰것.filter((r) => r.판정.H04.조용한실패).length}/${H04잰것.length}`;
  process.stdout.write(`\n── 판정표 ──\n${JSON.stringify(집계, null, 2)}\n`);
  if (args.output) {
    await writeFile(resolve(args.output), JSON.stringify({ modelId: MODEL_ID, 손없이: args.손없이 === true, 집계, 회차들 }, null, 2), 'utf8');
    process.stdout.write(`\n덤프: ${resolve(args.output)}\n`);
  }
}

await main();
