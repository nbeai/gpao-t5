// **카드를 누르는 사람이 있는 라이브.** `그냥써본다.mjs` 의 자매이고 대체가 아니다.
//
// ── 왜 이 자가 따로 있어야 하나 (§7-ak-5 · 2026-08-16) ──────────────────────
//
// `그냥써본다.mjs` 에는 승인 코드가 **0줄**이다(승인은 104행 주석 한 줄뿐 · 호출 0).
// 그 자는 「카드가 떴다」까지를 재는 자다 — 그것이 그 자의 정직한 질문이고, 그대로 둔다.
// 그런데 §7-ai-3 은 종료 조건을 **「T5 가 실제로 파일을 만들었는가(디스크 확인)」** 로 적었다.
// 승인이 필요한 쓰기는 그 자에서 **원리적으로 완료될 수 없다** — 아무도 카드를 안 누르니까.
// 그래서 「파일 3/3 안 만들어짐」은 제품 사실이 아니라 **재는 자의 사실**이었다.
// (§3-2 (나) 「정오 조항이 쓰던 순간 이미 실행 불가능했다」와 같은 종류의 선등록 설계 결함이다.)
//
// **`그냥써본다.mjs` 를 제자리에서 고치지 않는다** — 고치면 그 자로 잰 과거 배치의 의미가
// 조용히 갈린다(감시자 검문 2026-08-16). 질문이 다르면 자도 다르다.
//
// ── 이 자가 재는 것과 안 재는 것 ────────────────────────────────────────────
// 잰다     승인 뒤에 **디스크에 무엇이 생겼는가**(작업 전/후 훑기) · 원장의 손 순서와 실패 상태
// 안 잰다  답의 정오. 그건 `채점기.mjs` 하나뿐이다(두 번째 자 금지)
// ⚠️ 이 자는 **사용자가 언제나 승인을 누른다**고 가정한다. 그건 실제 사용자가 아니다 —
//    「승인만 받으면 되는 일」의 상한을 재는 자이지 사용자 마찰을 재는 자가 아니다.
//    두 자의 숫자를 한 표에 합치지 마라.
//
// 쓰기: node scripts/terminal-qualification/승인까지써본다.mjs "발화" [출력경로.json]
import { mkdtemp, mkdir, cp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '../../src/surface/server.js';
import { SessionStore } from '../../src/surface/session-store.js';
import { EventLog } from '../../src/surface/event-log.js';
import { MemoryStore } from '../../src/surface/memory-store.js';
import { liveDeps } from '../../src/surface/live-context.js';
import { 저장된연결 } from '../s1/run.mjs';
import { 재료실측 as 재료실측하기 } from './재료실측.mjs';

const 저장소 = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const 발화 = process.argv[2];
const 낼자리 = process.argv[3];
if (!발화) { console.error('발화를 인자로 준다'); process.exit(1); }

// 승인 왕복 상한. 카드가 끝없이 뜨면 그건 결함이고, 무한 루프로 덮지 않는다.
const 승인상한 = 3;

const root = await mkdtemp(join(tmpdir(), 't5-승인까지-'));
const home = join(root, 'home');
const state = join(root, 'state');
const work = join(home, '작업');
await mkdir(work, { recursive: true });
await mkdir(state, { recursive: true });
// 재료는 `그냥써본다.mjs` 와 **같은 방**이다 — 갈리면 두 자의 값을 나란히 못 놓는다(§7-ab 방).
await cp(join(저장소, 'docs/00-START-HERE'), join(work, '시작문서'), { recursive: true });
await cp(join(저장소, 'docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md'),
  join(work, '시작문서', 'T5-비전과-성능철학.md'));
await cp(join(저장소, 'README.md'), join(work, 'README.md'));
await cp(join(저장소, 'AGENTS.md'), join(work, 'AGENTS.md'));

const 연결 = 저장된연결(homedir());
if (!연결?.자격) throw new Error('저장된 모델 연결이 없다');

/**
 * **방 전체**를 재귀로 훑는다(상태 폴더는 뺀다 — 커널 살림이지 산출물이 아니다).
 *
 * ⚠️ 첫 판은 `home` 과 `작업/` **두 자리만** 봤다. 그래서 T5 가 `cd .. && tar -czf backup.tar.gz home`
 * 으로 **방 뿌리에 50,721B 를 실제로 만든 회차**를 「파일 0」으로 셌다(2026-08-16 · 디스크로 잡음).
 * 산출물이 어디 생길지는 모델이 정한다 — **재는 자가 자리를 미리 정하면 잰 값이 거짓이 된다.**
 */
const 훑기 = async (뿌리) => {
  const out = [];
  const 걷기 = async (자리, 앞) => {
    for (const e of await readdir(자리, { withFileTypes: true })) {
      const 이름 = 앞 ? `${앞}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (이름 === 'state') continue;      // 커널 살림 — 산출물 아님
        await 걷기(join(자리, e.name), 이름);
      } else out.push(`${이름} (${(await stat(join(자리, e.name))).size}B)`);
    }
  };
  await 걷기(뿌리, '');
  return out.sort();
};

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
  // 포트를 박지 않는다 — 커널이 알려준 포트를 쓴다(agent-start 규율).
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const post = async (p, b) => (await fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b),
  })).json();
  const s = await post('/sessions', {});

  const 전 = { 방: await 훑기(root) };
  const 원본 = {
    schemaVersion: 2, 자: '승인까지써본다', 시각: new Date().toISOString(), 방: root,
    sourceHead: (await import('node:child_process')).execSync('git rev-parse HEAD', { cwd: 저장소 }).toString().trim(),
    모델: { provider: 연결.provider ?? 'openai', modelId: env.GPAO_T5_MODEL_ID },
    발화, 재료실측: await 재료실측하기(work), 디스크전: 전, 왕복: [],
  };
  console.log(`방(home): ${home}\n작업 전 home: ${JSON.stringify(전.home)}\n`);

  let turn = await post('/turn', { sessionId: s.id, text: 발화 });
  원본.왕복.push({ 걸음: '발화', kind: turn.kind ?? 'reply', 답: turn.reply ?? null,
    카드: turn.kind === 'approval' ? turn.pending?.map((p) => p.preview?.impact) : undefined });
  console.log(`[1] 오너: ${발화}\n    kind=${turn.kind ?? 'reply'}\n    답: ${(turn.reply ?? '').slice(0, 400)}`);

  // **카드가 뜨면 누른다.** 이 자의 존재 이유가 이 한 줄이다.
  for (let i = 0; turn.kind === 'approval' && i < 승인상한; i += 1) {
    console.log(`    카드: ${JSON.stringify(turn.pending?.map((p) => p.preview?.impact))}`);
    console.log('    >>> 승인 (POST /turn {approve: pendingId})');
    turn = await post('/turn', { sessionId: s.id, approve: turn.pendingId });
    원본.왕복.push({ 걸음: `승인${i + 1}`, kind: turn.kind ?? 'reply', 답: turn.reply ?? null,
      카드: turn.kind === 'approval' ? turn.pending?.map((p) => p.preview?.impact) : undefined });
    console.log(`[${i + 2}] kind=${turn.kind ?? 'reply'}\n    답: ${(turn.reply ?? '').slice(0, 600)}`);
  }
  if (turn.kind === 'approval') console.log(`⚠️ 승인 ${승인상한}회에도 카드가 계속 떴다 — 그 사실을 그대로 남긴다`);

  원본.디스크후 = { 방: await 훑기(root) };
  // **판정 재료 둘** — 답 문장이 아니라 새로 생긴 실물, 그리고 **몇 번 물어봤나**.
  // 개입 횟수를 같이 안 세면 「카드로 산 초록」이 남는다 — 비교군은 0 개입으로 끝냈다(손 관리자 조건 ③).
  원본.새로생긴것 = 원본.디스크후.방.filter((x) => !전.방.includes(x));
  원본.개입횟수 = 원본.왕복.filter((w) => w.걸음.startsWith('승인')).length;
  console.log(`\n새로 생긴 것: ${JSON.stringify(원본.새로생긴것)}`);
  console.log(`개입(승인 클릭) 횟수: ${원본.개입횟수}`);

  const sess = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8'));
  원본.원장 = (sess.ledgerEntries ?? []).filter((e) => e?.actualCall?.tool).map((e) => ({
    손: e.actualCall.tool, action: e.actualCall.args?.action, 명령: e.actualCall.args?.command,
    failureState: e.failureState, 요약: e.userSafeSummary,
  }));
  console.log('\n── 원장 ──');
  for (const e of 원본.원장) {
    console.log(` ${e.손}${e.action ? `:${e.action}` : ''} · failureState=${e.failureState}`
      + (e.명령 ? ` · cmd=${JSON.stringify(e.명령)}` : '') + `\n    ${String(e.요약 ?? '').slice(0, 200)}`);
  }

  if (낼자리) { await writeFile(낼자리, JSON.stringify(원본, null, 2)); console.log(`\n원본: ${낼자리}`); }
} finally {
  // `process.exit` 를 쓰지 않는다 — finally 를 건너뛰면 좀비 서버가 남아 다음 회차를 오염시킨다.
  if (server) await new Promise((r) => server.close(r));
  if (옛HOME === undefined) delete process.env.HOME; else process.env.HOME = 옛HOME;
}
