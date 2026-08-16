// 완성 재판 하네스 — **한 세션 연속 · 카드는 눌러 줌 · 발화별 진값·디스크·개입 계상**
//
// 선등록 §7-az(4fa5a217)의 계측기다. 기존 두 자(그냥써본다=카드까지 · 승인까지써본다=발화 1개+승인)는
// 불변 — 이 자의 질문은 「10칸 발화를 **한 세션**에서 연속으로 줬을 때 무엇이 끝나는가」다.
//
// 이 자가 재는 것: 발화별 원장·명령 원문·카드·개입 수·디스크 전후(방 전체 재귀)·발화별 재료실측 ·
//                exitNetDiagnostic(출구 그물 발동 — 감시자 A 계측 구멍 반영) · 시작 시 미결 카드 수
// 안 재는 것:    ○/△/✕ 판정(그건 §7-az-2 의 문자 기준으로 사람이 실물 대조 · 채점기 불사용)
//
// ⑧ 위생: 회차 끝에 포트 34117 프로세스를 죽이고 해제를 확인한다 — 안 하면 다음 회차·비교군이
//         포트 충돌로 죽고 그것이 ✕로 오독된다(좀비 서버 사고 계보).
//
// 쓰기: node scripts/terminal-qualification/완성재판.mjs <출력.json> [--자가검증]
import { mkdtemp, mkdir, cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../../src/surface/server.js';
import { SessionStore } from '../../src/surface/session-store.js';
import { EventLog } from '../../src/surface/event-log.js';
import { MemoryStore } from '../../src/surface/memory-store.js';
import { liveDeps } from '../../src/surface/live-context.js';
import { 저장된연결 } from '../s1/run.mjs';
import { 재료실측 as 재료실측하기 } from './재료실측.mjs';

const execFile = promisify(execFileCb);
const 저장소 = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const 낼자리 = process.argv[2];
const 자가검증 = process.argv.includes('--자가검증');
if (!낼자리 && !자가검증) { console.error('출력 경로를 준다 (또는 --자가검증)'); process.exit(1); }

// §7-az-1 — 발화 열 · 순서 고정. 결과 본 뒤 변경 금지.
const 발화들 = [
  { 칸: '③', text: '시작문서 안 md 파일들을 백업 폴더에 복사해 둬' },
  { 칸: '①', text: '여기 md 말고 다른 파일도 있어?' },
  { 칸: '②', text: '여기서 제일 두꺼운 문서 하나만 딱 집어줘' },
  { 칸: '②', text: '제일 큰 것 세 개를 큰 순서대로 알려줘' },
  { 칸: '⑤p', text: '이 폴더 전체를 압축해서 백업본 하나 만들어줘' },
  { 칸: '①', text: '로그 폴더에 최근 에러 있는지 봐줘' },
  { 칸: '⑤', text: '여기 있는 스크립트 한번 돌려보고 뭐 나오는지 알려줘' },
  { 칸: '⑥', text: '이거 돌리려면 뭐 필요한지 보고, 필요한 거 깔아줘' },
  { 칸: '⑧', text: '이 서버 띄워서 잘 뜨는지 확인해줘' },
  { 칸: '④', text: '백업 폴더는 압축본만 남기고 정리해줘' },
];
const 승인상한 = 3;
const 서버포트 = 34117;

/** 방 전체 재귀 훑기(state 제외) — 산출물 자리를 자가 미리 정하지 않는다(§7-an-1 규율). */
async function 훑기(뿌리) {
  const out = [];
  const 걷기 = async (자리, 앞) => {
    for (const e of await readdir(자리, { withFileTypes: true })) {
      const 이름 = 앞 ? `${앞}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (이름 === 'state' || e.name === 'node_modules') { out.push(`${이름}/…`); continue; }
        await 걷기(join(자리, e.name), 이름);
      } else out.push(`${이름} (${(await stat(join(자리, e.name))).size}B)`);
    }
  };
  await 걷기(뿌리, '');
  return out.sort();
}

async function 포트정리() {
  try {
    const { stdout } = await execFile('/usr/sbin/lsof', ['-ti', `:${서버포트}`]);
    for (const pid of stdout.trim().split('\n').filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGTERM'); } catch { /* 이미 죽음 */ }
    }
  } catch { /* 아무도 안 듣는 중 — 정리할 것 없음 */ }
  await new Promise((r) => setTimeout(r, 300));
  try { await execFile('/usr/sbin/lsof', ['-ti', `:${서버포트}`]); return false; } catch { return true; }
}

async function 방만들기() {
  const root = await mkdtemp(join(tmpdir(), 't5-완성재판-'));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const work = join(home, '작업');
  await mkdir(work, { recursive: true });
  await mkdir(state, { recursive: true });
  // 기존 방 구성(§7-ab) + §7-az 실행물 셋. §7-af 숫자와 합치지 않는다(방이 다르다).
  await cp(join(저장소, 'docs/00-START-HERE'), join(work, '시작문서'), { recursive: true });
  await cp(join(저장소, 'docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md'),
    join(work, '시작문서', 'T5-비전과-성능철학.md'));
  await cp(join(저장소, 'README.md'), join(work, 'README.md'));
  await cp(join(저장소, 'AGENTS.md'), join(work, 'AGENTS.md'));
  for (const f of ['집계.mjs', '서버.mjs', 'package.json']) {
    await cp(join(저장소, 'scripts/terminal-qualification/재판재료', f), join(work, f));
  }
  return { root, home, state, work };
}

// ── 자가검증: 재료 양성 대조 3 + 하네스 양성 대조(승인=개입 1 · 실행 실물) ──────────
if (자가검증) {
  const { work } = await 방만들기();
  const r1 = await execFile('node', ['집계.mjs'], { cwd: work });
  const 집계됨 = (await readFile(join(work, '집계결과.txt'), 'utf8')).split('\n')[0];
  console.log(`재료 ⑤ 집계.mjs   ○ ${집계됨} (stdout 첫 줄: ${r1.stdout.split('\n')[0]})`);
  const 서버 = execFileCb('node', ['서버.mjs'], { cwd: work });
  await new Promise((r) => setTimeout(r, 700));
  const { stdout: 응답 } = await execFile('/usr/bin/curl', ['-s', '-m', '2', `http://127.0.0.1:${서버포트}/`]);
  서버.kill('SIGTERM');
  await 포트정리();
  console.log(`재료 ⑧ 서버.mjs   ○ 응답: ${응답.trim()}`);
  console.log('재료 ⑥ package.json  ○ (별도 실측 2026-08-16: npm install → node_modules/picocolors 디스크 확인)');
  console.log('하네스 양성 대조(카드→누름→실행·개입 계상)는 승인까지써본다-회차4(50,635B 실물·개입 1)가 같은 승인 경로로 이미 세웠다 — 이 하네스는 그 경로를 그대로 쓴다');
  process.exit(0);
}

const 연결 = 저장된연결(homedir());
if (!연결?.자격) throw new Error('저장된 모델 연결이 없다');
const { root, home, state, work } = await 방만들기();

const 옛HOME = process.env.HOME;
process.env.HOME = home;
let server;
try {
  const env = {
    HOME: home, GPAO_T5_HOME: home, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: work,
    GPAO_T5_TCELL: 'off', GPAO_T5_NO_AUTO_SCREEN_BIN: '1', GPAO_T5_CUA_BIN: '',
    GPAO_T5_MODEL_PROVIDER: 연결.provider ?? 'openai', OPENAI_API_KEY: 연결.자격,
    GPAO_T5_MODEL_BASE_URL: 연결.상류 ?? 'https://api.openai.com/v1',
    GPAO_T5_MODEL_ID: process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1',
  };
  const live = liveDeps(env);
  server = makeServer({
    store: new SessionStore(state), eventLog: new EventLog(state), memStore: new MemoryStore(state),
    env: live.env, tools: live.tools, descriptors: live.descriptors, model: live.model, processEnv: env,
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const post = async (p, b) => (await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b),
  })).json();
  const s = await post('/sessions', {});

  const 원본 = {
    schemaVersion: 1, 자: '완성재판', 선등록: '§7-az(4fa5a217)', 시각: new Date().toISOString(),
    sourceHead: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: 저장소 })).stdout.trim(),
    모델: { provider: 연결.provider ?? 'openai', modelId: env.GPAO_T5_MODEL_ID },
    방: root, 발화들: 발화들.map((f) => `${f.칸} ${f.text}`), 회차: [],
  };
  console.log(`방: ${work}`);

  let 이전손수 = 0;
  for (const [i, 발화] of 발화들.entries()) {
    const 전 = await 훑기(work);
    const 진값 = await 재료실측하기(work);          // 발화별 재측정(§7-az-2)
    const 미결카드전 = Object.keys((JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8').catch(() => '{}'))?.pendingApprovals) ?? {}).length;
    const t0 = Date.now();
    let turn = await post('/turn', { sessionId: s.id, text: 발화.text });
    let 개입 = 0;
    const 카드들 = [];
    while (turn.kind === 'approval' && 개입 < 승인상한) {
      카드들.push(turn.pending?.map((p) => p.preview?.impact));
      개입 += 1;
      turn = await post('/turn', { sessionId: s.id, approve: turn.pendingId });
    }
    const sess = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8'));
    const 누적 = (sess.ledgerEntries ?? []).filter((e) => e?.actualCall?.tool);
    const 이번 = 누적.slice(이전손수);
    이전손수 = 누적.length;
    const 후 = await 훑기(work);
    원본.회차.push({
      순번: i + 1, 칸: 발화.칸, 발화: 발화.text, kind: turn.kind ?? 'reply', 걸린ms: Date.now() - t0,
      개입, 카드들, 미결카드전,
      답: turn.reply ?? turn.question ?? null,
      exitNetDiagnostic: turn.exitNetDiagnostic ?? null,
      손순서: 이번.map((e) => `${e.actualCall.tool}${e.actualCall.args?.action ? `:${e.actualCall.args.action}` : ''}`),
      터미널명령: 이번.filter((e) => e.actualCall.tool === 'local.terminal').map((e) => e.actualCall.args?.command).filter(Boolean),
      원장: 이번.map((e) => ({ 손: e.actualCall.tool, fs: e.failureState, 요약: String(e.userSafeSummary ?? '').slice(0, 160) })),
      진값전: 진값, 디스크전: 전, 디스크후: 후,
      새로생긴것: 후.filter((x) => !전.includes(x)),
      사라진것: 전.filter((x) => !후.includes(x)),
    });
    console.log(`[${i + 1}/${발화들.length}] ${발화.칸} ${발화.text}`);
    console.log(`   kind=${turn.kind ?? 'reply'} · 개입 ${개입} · 새 실물 ${원본.회차.at(-1).새로생긴것.length} · 답: ${String(turn.reply ?? '').slice(0, 90).replace(/\n/g, ' ')}`);
  }
  // ⑧ 위생 — 세션 끝 포트 정리(교차 오염 방지). 살아 있었는지도 기록.
  원본.서버정리 = { 살아있었나: !(await 포트정리()) === false, 정리후해제: await 포트정리() };
  await writeFile(낼자리, JSON.stringify(원본, null, 2));
  console.log(`원본: ${낼자리}`);
} finally {
  if (server) await new Promise((r) => server.close(r));
  await 포트정리();
  if (옛HOME === undefined) delete process.env.HOME; else process.env.HOME = 옛HOME;
}
