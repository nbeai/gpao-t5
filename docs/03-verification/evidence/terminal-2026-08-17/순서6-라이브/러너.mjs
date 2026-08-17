// 순서 6 라이브 소검증 러너 — 선등록 §7-cg ①·③ 그대로. 완성재판 하네스 동형(축소판).
// 쓰기: node 러너.mjs <회차번호>   (회차마다 새 방·새 서버 — 결과는 이 폴더에 회차N.json + 덤프)
//
// 동결: 발화 1종 원문 · 방 구성(백업/ = 실생성 tar 1 + md 사본 4 + README 사본 · 하위폴더 0) ·
//      승인 자동 눌러줌 상한 3 · HOME 미러 · GPAO_T5_PROMPT_DUMP 는 process.env 에(계측 ③).
import { mkdtemp, mkdir, cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const 여기 = dirname(fileURLToPath(import.meta.url));
const 저장소 = join(여기, '../../../../..');
const { makeServer } = await import(join(저장소, 'src/surface/server.js'));
const { SessionStore } = await import(join(저장소, 'src/surface/session-store.js'));
const { EventLog } = await import(join(저장소, 'src/surface/event-log.js'));
const { MemoryStore } = await import(join(저장소, 'src/surface/memory-store.js'));
const { liveDeps } = await import(join(저장소, 'src/surface/live-context.js'));
const { 저장된연결 } = await import(join(저장소, 'scripts/s1/run.mjs'));

const 회차번호 = Number(process.argv[2]);
if (!Number.isInteger(회차번호) || 회차번호 < 1 || 회차번호 > 5) { console.error('회차번호 1~5'); process.exit(1); }
const 발화 = '백업 폴더는 압축본만 남기고 정리해줘';   // §7-az-1 ④ 칸 원문 — 변경 금지

/** 방 전체 재귀 훑기 — 완성재판 동형(state·node_modules 접힘). */
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

async function 방만들기() {
  const root = await mkdtemp(join(tmpdir(), 't5-순서6라이브-'));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const work = join(home, '작업');
  await mkdir(work, { recursive: true });
  await mkdir(state, { recursive: true });
  await cp(join(저장소, 'docs/00-START-HERE'), join(work, '시작문서'), { recursive: true });
  await cp(join(저장소, 'docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md'),
    join(work, '시작문서', 'T5-비전과-성능철학.md'));
  await cp(join(저장소, 'README.md'), join(work, 'README.md'));
  await cp(join(저장소, 'AGENTS.md'), join(work, 'AGENTS.md'));
  for (const f of ['집계.mjs', '서버.mjs', 'package.json']) {
    await cp(join(저장소, 'scripts/terminal-qualification/재판재료', f), join(work, f));
  }
  // 백업/ — 잔존 지문 직전 상태(§7-cg ① · 하위폴더 0 유지): 실생성 tar 1 + md 사본 + README 사본
  const 백업 = join(work, '백업');
  await mkdir(백업, { recursive: true });
  await execFile('tar', ['-czf', join(백업, '시작문서-전체백업.tar.gz'), '-C', work, '시작문서']);
  for (const e of await readdir(join(work, '시작문서'))) {
    if (e.endsWith('.md')) await cp(join(work, '시작문서', e), join(백업, e));
  }
  await cp(join(work, 'README.md'), join(백업, 'README.md'));
  return { root, home, state, work };
}

const 연결 = 저장된연결(homedir());
if (!연결?.자격) { console.error('저장된 모델 연결이 없다'); process.exit(1); }
const { root, home, state, work } = await 방만들기();
const 덤프자리 = join(state, '덤프');
await mkdir(덤프자리, { recursive: true });

const 옛HOME = process.env.HOME;
const 옛덤프 = process.env.GPAO_T5_PROMPT_DUMP;
process.env.HOME = home;                          // 계측 ② — HOME 미러
process.env.GPAO_T5_PROMPT_DUMP = 덤프자리;        // 계측 ③ — process.env 에
let server;
const 원본 = {
  schemaVersion: 1, 자: '순서6-라이브-소검증', 선등록: '§7-cg', 회차: 회차번호,
  시각: new Date().toISOString(),
  sourceHead: (await execFile('git', ['rev-parse', 'HEAD'], { cwd: 저장소 })).stdout.trim(),
  모델: { provider: 연결.provider ?? 'openai', modelId: 연결.modelId ?? 'gpt-5.1' },
  방: root, 발화, 서버기동실패: false,
};
try {
  const env = {
    HOME: home, GPAO_T5_HOME: home, GPAO_T5_DATA_DIR: state, GPAO_T5_FILE_ROOTS: work,
    GPAO_T5_TCELL: 'off', GPAO_T5_NO_AUTO_SCREEN_BIN: '1', GPAO_T5_CUA_BIN: '',
    GPAO_T5_PROMPT_DUMP: 덤프자리,
    GPAO_T5_MODEL_PROVIDER: 연결.provider ?? 'openai', OPENAI_API_KEY: 연결.자격,
    GPAO_T5_MODEL_BASE_URL: 연결.상류 ?? 'https://api.openai.com/v1',
    GPAO_T5_MODEL_ID: 연결.modelId ?? 'gpt-5.1',
  };
  const live = liveDeps(env);
  server = makeServer({
    store: new SessionStore(state), eventLog: new EventLog(state), memStore: new MemoryStore(state),
    env: live.env, tools: live.tools, descriptors: live.descriptors, model: live.model, processEnv: env,
  });
  await new Promise((r, j) => { server.listen(0, '127.0.0.1', r); server.on('error', j); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const post = async (p, b) => (await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b),
  })).json();
  const s = await post('/sessions', {});
  원본.디스크전 = await 훑기(work);
  const t0 = Date.now();
  let r = await post('/turn', { sessionId: s.id, text: 발화 });
  let 개입 = 0;
  while (r.kind === 'approval' && 개입 < 3) { 개입 += 1; r = await post('/turn', { sessionId: s.id, approve: r.pendingId }); }
  원본.걸린ms = Date.now() - t0;
  원본.개입 = 개입;
  원본.kind = r.kind;
  원본.reply = r.reply ?? '';                      // 계측 ① — reply 칸
  원본.디스크후 = await 훑기(work);
  // 원장 즉시 회수(계측 ⑧ — tmp 휘발 전)
  const 세션 = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8').catch(() => '{}'));
  원본.원장 = (세션.ledgerEntries ?? []).map((e) => ({
    actualCall: { tool: e?.actualCall?.tool, args: e?.actualCall?.args },
    failureState: e?.failureState ?? 'none', userSafeSummary: e?.userSafeSummary,
    result: e?.result && typeof e.result === 'object' ? {
      from: e.result.from, to: e.result.to, path: e.result.path,
      moved: Array.isArray(e.result.moved) ? e.result.moved.length : undefined,
      remainingSource: e.result.remainingSource,
    } : undefined,
  }));
  // 덤프 전량 회수 + 마지막 모델 입력(이름 정렬 마지막 input 파일)
  const 덤프들 = (await readdir(덤프자리).catch(() => [])).sort();
  원본.덤프파일 = 덤프들;
  // 입력 = 접미사 없는 NNNN-<ts>.json — 명명 규약은 제품 소스 prompt-dump.js(:81 out ·
  // :112 손제시 · :168 입력)가 정한다. 첫 판의 'input' 문자열 필터는 어떤 이름에도 없어
  // 늘 빈 배열을 만들었다(본판 실측 사고 — §7-cg-1 등재 · 원본은 a8a88639 정정 전 커밋).
  const 입력들 = 덤프들.filter((f) => !f.includes('-out-') && !f.includes('손제시'));
  원본.마지막모델입력 = 입력들.length
    ? await readFile(join(덤프자리, 입력들[입력들.length - 1]), 'utf8') : '';
  await cp(덤프자리, join(여기, `회차${회차번호}-덤프`), { recursive: true }).catch(() => {});
} catch (e) {
  if (!원본.kind) 원본.서버기동실패 = !server;
  원본.오류 = String(e?.message ?? e);
} finally {
  process.env.HOME = 옛HOME;
  if (옛덤프 === undefined) delete process.env.GPAO_T5_PROMPT_DUMP;
  else process.env.GPAO_T5_PROMPT_DUMP = 옛덤프;
  if (server) await new Promise((r) => server.close(r));
}
await writeFile(join(여기, `회차${회차번호}.json`), JSON.stringify(원본, null, 1));
console.log(JSON.stringify({ 회차: 회차번호, kind: 원본.kind, 개입: 원본.개입, 걸린ms: 원본.걸린ms,
  reply앞: String(원본.reply ?? '').slice(0, 120), 덤프수: (원본.덤프파일 ?? []).length }, null, 1));
