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
  const 원본 = {
    schemaVersion: 1, 시각: new Date().toISOString(), sourceHead,
    모델: { provider: 연결.provider ?? 'openai', modelId: process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1' },
    재료: ['시작문서/', 'README.md', 'AGENTS.md'], 회차: [],
  };
  let 이전손수 = 0;
  for (const [i, text] of 발화.entries()) {
    const t0 = Date.now();
    const turn = await post('/turn', { sessionId: s.id, text });
    const sess = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8'));
    // ledgerEntries 는 세션 누적이다 — 이번 턴 몫만 잘라 쓴다(원본에 턴별 사실이 서게).
    const 누적손 = (sess.ledgerEntries ?? []).map((e) => e?.actualCall?.tool).filter(Boolean);
    const 손 = 누적손.slice(이전손수);
    이전손수 = 누적손.length;
    console.log('─'.repeat(70));
    console.log(`[${i + 1}] 오너: ${text}`);
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}초 · kind=${turn.kind ?? 'reply'} · 손 ${손.length}회: ${[...new Set(손)].join(', ') || '없음'})`);
    // 순서가 진단 재료다 — 첫 수가 터미널인데 파일로 도망갔으면 하류 겹이 유죄다.
    console.log(`    순서: ${손.join(' → ') || '없음'}`);
    console.log(`\nT5: ${turn.reply ?? turn.question ?? JSON.stringify(turn).slice(0, 300)}\n`);
    원본.회차.push({
      오너: text, kind: turn.kind ?? 'reply', 걸린ms: Date.now() - t0,
      손순서: 손, 답: turn.reply ?? turn.question ?? null,
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
