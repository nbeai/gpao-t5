// 지어낸 과업도 채점표도 없다. **오너가 클로드코드에게 하는 말을 T5 에 그대로 친다.**
// 재료도 지어내지 않는다 — 이 저장소의 진짜 문서를 격리 방에 복사해 넣는다.
// 판정은 사람이 답을 읽고 한다. 자를 만들지 않는다.
//
// **회차 원본은 저장소에 남는다**(감시자 지적 2026-08-15). 격리 방(mkdtemp)은 사라지므로,
// 남기지 않으면 라이브 숫자가 전부 「세션 콘솔 관측」이 되어 독립 재현이 불가능하다 —
// d05aa755 관행("라이브 전량과 조사 원본을 저장소에 넣는다")을 이 하네스도 따른다.
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeServer } from '/Users/jyp/Developer/t5-p-op/src/surface/server.js';
import { SessionStore } from '/Users/jyp/Developer/t5-p-op/src/surface/session-store.js';
import { EventLog } from '/Users/jyp/Developer/t5-p-op/src/surface/event-log.js';
import { MemoryStore } from '/Users/jyp/Developer/t5-p-op/src/surface/memory-store.js';
import { liveDeps } from '/Users/jyp/Developer/t5-p-op/src/surface/live-context.js';
import { 저장된연결 } from '/Users/jyp/Developer/t5-p-op/scripts/s1/run.mjs';
import { 재료실측 as 재료실측하기 } from './재료실측.mjs';

const 발화 = process.argv.slice(2);
if (!발화.length) { console.error('발화를 인자로 준다'); process.exit(1); }

const root = await mkdtemp(join(tmpdir(), 't5-그냥-'));
const home = join(root, 'home');
const state = join(root, 'state');
const work = join(home, '작업');
await mkdir(work, { recursive: true });
await mkdir(state, { recursive: true });
// **진짜 문서를 넣는다.** 오너가 직접 쓴 자리 + 저장소 문서 몇 개.
await cp('/Users/jyp/Developer/t5-p-op/docs/00-START-HERE', join(work, '시작문서'), { recursive: true });
// ── **방이 깊이를 가르게 한다** (§7-ab · 2026-08-15) ────────────────────────
// 옛 방은 최상위 AGENTS.md(16,051)가 전체 1위였고 방 안 최대가 15,837 — 차이 214B(1.35%)라
// **「최상위만 잰 답」과 「전수로 잰 답」이 같은 이름**을 냈다. 두 팔이 같은 값을 내는 시험은
// 판별력이 0이다(세 배치가 그 방에서 돌았고 깊이에 대해 아무 말도 못 했다).
// 그래서 **최상위보다 큰 실제 저장소 문서 하나**를 `시작문서/` 안에 넣는다 — 45,534B(2.8배).
// 지어낸 파일이 아니고, 방을 더 예쁘게 만들지도 않는다. **갈리면 거기서 멈춘다.**
await cp('/Users/jyp/Developer/t5-p-op/docs/03-product-plan/GPAO-T5-VISION-AND-PERFORMANCE-PHILOSOPHY-2026-07-27-ko.md',
  join(work, '시작문서', 'T5-비전과-성능철학.md'));
await cp('/Users/jyp/Developer/t5-p-op/README.md', join(work, 'README.md'));
await cp('/Users/jyp/Developer/t5-p-op/AGENTS.md', join(work, 'AGENTS.md'));

const 연결 = 저장된연결(homedir());
if (!연결?.자격) throw new Error('저장된 모델 연결이 없다');

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

  console.log(`방: ${root}\n작업 폴더에 넣은 것: 시작문서/ · README.md · AGENTS.md\n`);
  const sourceHead = (await promisify(execFile)('git', ['rev-parse', 'HEAD'],
    { cwd: '/Users/jyp/Developer/t5-p-op' })).stdout.trim();
  // 재료의 **복사 시점 실측**을 같이 남긴다(손 관리자 지적) — 저장소 파일은 계속 바뀌므로,
  // 채점 시점 저장소가 아니라 그 회차가 실제로 본 바이트가 진값이어야 한다.
  // 수집은 재료실측.mjs 하나뿐이다 — 셸 find|wc 를 쓰던 옛 줄은 주변 로케일이 C 면
  // 비ASCII 이름을 `?` 로 잃었다(§7-t). 복제하지 마라.
  const 재료실측 = await 재료실측하기(work);
  const 원본 = {
    schemaVersion: 1, 시각: new Date().toISOString(), sourceHead,
    모델: { provider: 연결.provider ?? 'openai', modelId: process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1' },
    재료: ['시작문서/', 'README.md', 'AGENTS.md'], 재료실측, 회차: [],
  };
  let 이전손수 = 0;
  for (const [i, text] of 발화.entries()) {
    const t0 = Date.now();
    const turn = await post('/turn', { sessionId: s.id, text });
    const sess = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8'));
    // ledgerEntries 는 세션 누적이다 — 이번 턴 몫만 잘라 쓴다(원본에 턴별 사실이 서게).
    // 파일 손은 동사가, 터미널은 명령 원문이 판정 재료다. **필터한 목록 위에서 잘라야**
    // 인덱스가 안 어긋난다(actualCall 없는 항목이 원장에 섞여 있다).
    const 누적호출 = (sess.ledgerEntries ?? []).filter((e) => e?.actualCall?.tool);
    const 이번호출 = 누적호출.slice(이전손수);
    이전손수 = 누적호출.length;
    const 손 = 이번호출.map((e) => `${e.actualCall.tool}${e.actualCall.args?.action ? `:${e.actualCall.args.action}` : ''}`);
    console.log('─'.repeat(70));
    console.log(`[${i + 1}] 오너: ${text}`);
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}초 · kind=${turn.kind ?? 'reply'} · 손 ${손.length}회: ${[...new Set(손)].join(', ') || '없음'})`);
    // 순서가 진단 재료다 — 첫 수가 터미널인데 파일로 도망갔으면 하류 겹이 유죄다.
    console.log(`    순서: ${손.join(' → ') || '없음'}`);
    console.log(`\nT5: ${turn.reply ?? turn.question ?? JSON.stringify(turn).slice(0, 300)}\n`);
    원본.회차.push({
      오너: text, kind: turn.kind ?? 'reply', 걸린ms: Date.now() - t0,
      손순서: 손, 답: turn.reply ?? turn.question ?? null,
      // 승인 카드로 끝난 턴은 「답 없음」이 아니라 **사용자가 카드를 본 것**이다.
      // 카드 내용을 안 남기면 「왜 막혔나」(자리 밖인가·동사 등급인가)를 영영 못 가른다 —
      // 2026-08-15 진단에서 순수 읽기 둘이 카드에서 멈췄는데 이유를 못 읽었다(§7-v).
      카드: (turn.kind ?? 'reply') === 'approval' ? JSON.stringify(turn).slice(0, 2000) : undefined,
      // 터미널 명령 원문 — 깊이 진단 재료(무엇을 쟀는지). 이게 없으면 「얕다」의 원인을 못 가른다.
      터미널명령: 이번호출.filter((e) => e.actualCall.tool === 'local.terminal')
        .map((e) => e.actualCall.args?.command).filter(Boolean),
    });
  }
  const 증거집 = '/Users/jyp/Developer/t5-p-op/docs/03-verification/evidence/terminal-2026-08-15/그냥써본다-원본';
  await mkdir(증거집, { recursive: true });
  const 증거경로 = `${증거집}/${원본.시각.replace(/[:.]/g, '-')}.json`;
  await writeFile(증거경로, JSON.stringify(원본, null, 2));
  console.log(`원본: ${증거경로}`);
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (옛HOME === undefined) delete process.env.HOME; else process.env.HOME = 옛HOME;
}
