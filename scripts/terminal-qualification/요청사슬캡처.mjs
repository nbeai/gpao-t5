// J12 선빨강 재확보용 — 한 라이브의 **모델 요청·응답 사슬 전체**를 저장소 증거로 남긴다.
// 그냥써본다.mjs 와 같은 격리 방·같은 발화. 다른 것 하나: 모델로 나가는 요청 본문과
// 돌아온 응답(모델이 고른 것·쓴 것)을 전부 기록한다 — 「측정→최종답 구간」의 변형을
// 회차 원본만으로는 못 가르기 때문(어느 요청까지 정답이었고 어디서 뒤집혔는지).
// 자격은 기존 문(scripts/s1/run.mjs) 하나만 빌린다. 비밀은 본문에 없다(키는 헤더뿐 · 저장 안 함).
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
import { 재료실측, 재료실측원문 } from './재료실측.mjs';

const 발화 = process.argv.slice(2);
if (!발화.length) { console.error('발화를 인자로 준다'); process.exit(1); }

const 사슬 = [];
const 원본fetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  const 모델호출 = /chat\/completions|\/responses|\/messages/.test(u) && init?.body;
  const res = await 원본fetch(url, init);
  if (모델호출) {
    let 요청; let 응답;
    try { 요청 = JSON.parse(init.body); } catch { 요청 = { 원문일부: String(init.body).slice(0, 500) }; }
    try { 응답 = await res.clone().json(); } catch { 응답 = { 스트림또는비JSON: true }; }
    사슬.push({ 순번: 사슬.length + 1, 요청, 응답 });
  }
  return res;
};

const root = await mkdtemp(join(tmpdir(), 't5-사슬-'));
const home = join(root, 'home');
const state = join(root, 'state');
const work = join(home, '작업');
await mkdir(work, { recursive: true });
await mkdir(state, { recursive: true });
await cp('/Users/jyp/Developer/t5-p-op/docs/00-START-HERE', join(work, '시작문서'), { recursive: true });
await cp('/Users/jyp/Developer/t5-p-op/README.md', join(work, 'README.md'));
await cp('/Users/jyp/Developer/t5-p-op/AGENTS.md', join(work, 'AGENTS.md'));

const 연결 = 저장된연결(homedir());
if (!연결?.자격) throw new Error('저장된 모델 연결이 없다');
const 실행 = promisify(execFile);
const sourceHead = (await 실행('git', ['rev-parse', 'HEAD'], { cwd: '/Users/jyp/Developer/t5-p-op' })).stdout.trim();
// 형제 수집기와 **같은 함수**를 쓴다 — 옛 셸 find|wc 는 로케일이 C 면 이름을 잃었다(§7-t).
const wc = 재료실측원문(await 재료실측(work));

const 옛HOME = process.env.HOME;
process.env.HOME = home;
let server;
const 회차들 = [];
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
  const cookie = ((await 원본fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
  const post = async (p, b) => (await 원본fetch(`${base}${p}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(b),
  })).json();
  const s = await post('/sessions', {});
  for (const text of 발화) {
    const turn = await post('/turn', { sessionId: s.id, text });
    회차들.push({ 오너: text, 답: turn.reply ?? turn.question ?? null });
    console.log(`[오너] ${text}\nT5: ${String(turn.reply ?? '').slice(0, 160)}\n`);
  }
} finally {
  if (server) await new Promise((r) => server.close(r));
  if (옛HOME === undefined) delete process.env.HOME; else process.env.HOME = 옛HOME;
}

const 증거집 = '/Users/jyp/Developer/t5-p-op/docs/03-verification/evidence/terminal-2026-08-15/J12-요청사슬';
await mkdir(증거집, { recursive: true });
const 경로 = join(증거집, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await writeFile(경로, JSON.stringify({ schemaVersion: 1, sourceHead, 재료실측wc: wc.trim(), 회차들, 사슬 }, null, 1));
console.log(`사슬 ${사슬.length}개 요청 저장: ${경로}`);
