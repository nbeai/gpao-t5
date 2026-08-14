// 지어낸 과업도 채점표도 없다. **오너가 클로드코드에게 하는 말을 T5 에 그대로 친다.**
// 재료도 지어내지 않는다 — 이 저장소의 진짜 문서를 격리 방에 복사해 넣는다.
// 판정은 사람이 답을 읽고 한다. 자를 만들지 않는다.
import { mkdtemp, mkdir, cp, readFile } from 'node:fs/promises';
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
  for (const [i, text] of 발화.entries()) {
    const t0 = Date.now();
    const turn = await post('/turn', { sessionId: s.id, text });
    const sess = JSON.parse(await readFile(join(state, `${s.id}.json`), 'utf8'));
    const 손 = (sess.ledgerEntries ?? []).map((e) => e?.actualCall?.tool).filter(Boolean);
    console.log('─'.repeat(70));
    console.log(`[${i + 1}] 오너: ${text}`);
    console.log(`    (${((Date.now() - t0) / 1000).toFixed(1)}초 · kind=${turn.kind ?? 'reply'} · 손 ${손.length}회: ${[...new Set(손)].join(', ') || '없음'})`);
    console.log(`\nT5: ${turn.reply ?? turn.question ?? JSON.stringify(turn).slice(0, 300)}\n`);
  }
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (옛HOME === undefined) delete process.env.HOME; else process.env.HOME = 옛HOME;
}
