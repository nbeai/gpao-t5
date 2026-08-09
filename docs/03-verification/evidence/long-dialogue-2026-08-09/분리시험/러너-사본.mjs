#!/usr/bin/env node
// 30턴 장기대화 분리 시험 러너 (측정 라인 · 2026-08-09)
//
// 기준선 회차(t5-long-dialogue-raw.json · productCommit dae9273 · gpt-5.1)의 대본 30턴을
// 같은 모델·같은 순서로, **팔 트리**(한 변수만 다른 소스)에서 돌린다.
// 격리: 새 방 · HOME=방 · 상태=방/state · 파일뿌리=방/GPAO-T5(빈 폴더) · 화면 손 없음
// (GPAO_T5_NO_AUTO_SCREEN_BIN=1 — 대화 전용 회차라 화면 손이 판정 축에 없다 · 기록에 병기).
//
// 사용: node dialogue30.mjs <팔트리> <팔이름> <출력파일>
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = '/Users/jyp/Developer/t5-p-op';
const 팔트리 = process.argv[2];
const 팔이름 = process.argv[3];
const 출력자리 = process.argv[4];
if (!팔트리 || !팔이름 || !출력자리) throw new Error('사용: dialogue30.mjs <팔트리> <팔이름> <출력파일>');

const 원본 = JSON.parse(await readFile(join(repo, 'docs/03-verification/evidence/long-dialogue-2026-08-09/t5-long-dialogue-raw.json'), 'utf8'));
const turns = 원본.turns;
if (turns.length !== 30) throw new Error('대본이 30턴이 아니다');

const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
const 연결 = 저장된연결();
if (!연결) throw new Error('저장된 모델 연결이 없다');

const 방 = await realpath(await mkdtemp(join(tmpdir(), `t5-dlg30-${팔이름}-`)));
const stateDir = join(방, 'state');
await mkdir(stateDir, { recursive: true });
await mkdir(join(방, 'GPAO-T5'), { recursive: true });
for (const d of ['Desktop', 'Documents', 'Downloads']) await mkdir(join(방, d), { recursive: true });
if (!stateDir.startsWith(방) || stateDir.includes('.local/state/gpao-t5')) throw new Error('격리 위반');

// prove-isolation 계약 확인(지키는 선)
const { 격리증명 } = await import(pathToFileURL(join(repo, 'scripts/human-use/prove-isolation.mjs')));
const 증명 = await 격리증명({ root: 방, fixtureDir: join(방, 'GPAO-T5'), stateDir });
for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
if (!증명.ok) throw new Error('ISOLATION: FAIL — 문을 열지 않는다');

const { startLiveServer } = await import(pathToFileURL(join(팔트리, 'src/surface/server.js')));
const 포트 = 4480 + Math.floor(Math.random() * 15);
const server = await startLiveServer({
  port: 포트,
  processEnv: {
    HOME: 방,
    GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
    GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
    GPAO_T5_NO_AUTO_SCREEN_BIN: '1',
    ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
    ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
    GPAO_T5_MODEL_ID: 'gpt-5.1',
  },
});
const 기록 = {
  testedAt: new Date().toISOString(),
  팔: 팔이름,
  팔커밋: execFileSync('git', ['-C', 팔트리, 'log', '--oneline', '-1'], { encoding: 'utf8' }).trim(),
  기준선: { productCommit: 원본.productCommit, testedAt: 원본.testedAt, model: 원본.model },
  모델: 'gpt-5.1', 방,
  격리: '새 방 · HOME=방 · 상태 격리 · 화면 손 없음(NO_AUTO_SCREEN_BIN=1)',
  turns, 답들: [],
};
try {
  const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
  const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
  const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, {
    method: 'POST', headers: H, body: JSON.stringify(b ?? {}), signal: AbortSignal.timeout(300_000),
  }).then((r) => r.json());
  const s = await post('/sessions');
  기록.sessionId = s.id;
  for (let i = 0; i < turns.length; i += 1) {
    const t0 = Date.now();
    let r;
    try { r = await post('/turn', { sessionId: s.id, text: turns[i] }); }
    catch (e) { r = { kind: 'ERROR', reply: String(e) }; }
    기록.답들.push({
      turn: i + 1, reply: r.reply ?? '', elapsedMs: Date.now() - t0, kind: r.kind,
      ...(r.modelUnavailable ? { modelUnavailable: true, modelFailure: r.modelFailure } : {}),
      ledger: r.ledger ?? null,
    });
    process.stderr.write(`  [${팔이름}] ${i + 1}/30 ${r.kind} ${Date.now() - t0}ms\n`);
  }
} finally {
  try { server?.close(); } catch { /* 이미 닫힘 */ }
  await rm(방, { recursive: true, force: true });
}
await writeFile(출력자리, JSON.stringify(기록, null, 2));
console.log(JSON.stringify({ ok: true, 팔: 팔이름, 턴수: 기록.답들.length, out: 출력자리 }, null, 2));
