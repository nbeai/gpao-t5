#!/usr/bin/env node
// F-54 재프로브 v2 — 지침 교란변수 분리 (측정 라인 · 2026-08-09)
//
// 원 프로브 조건 재현: GPAO_T5_HOME=실홈(자리 명부가 실홈 폴더 9곳) ·
// GPAO_T5_FILE_ROOTS=~/GPAO-T5(실재 고정물 · 8월 합 2,430,000) · 상태만 격리(방 state) ·
// 화면 답은 같은 카드 고정물(sha1 b284d7a6)의 내용 — 화면 손 스텁(AX 텍스트)로 준다
// (실화면 전면 전환 3회 막힘 · 실화면 불가침 우회 — 전달 경로 차이는 기록에 병기).
//
// 사용: node f54-probe2.mjs <팔트리> <표본번호> <출력파일>
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = '/Users/jyp/Developer/t5-p-op';
const 스크래치 = '/private/tmp/claude-501/-Users-jyp-Developer-t5-p-op/e54633d2-3dbf-4f84-9fc7-e40d0cf96472/scratchpad';
const 팔트리 = process.argv[2];
const 표본번호 = process.argv[3] ?? '1';
const 출력자리 = process.argv[4];
const 진짜홈 = homedir();

// 재료 확인(읽기만) — 실 GPAO-T5 의 8월 정산 두 파일이 동결 고정물과 같은 내용인가
const 지문 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const 기대 = { '2026-08 정산/2026-08 매출정산.csv': 'a26c08c269c3', '2026-08 정산/8월 정산내역.csv': 'ec7a01ca67fb' };
for (const [상대, 값] of Object.entries(기대)) {
  const 실 = 지문(await readFile(join(진짜홈, 'GPAO-T5', 상대), 'utf8'));
  if (실 !== 값) throw new Error(`실 고정물 지문 불일치: ${상대} ${실}`);
}

// 실홈 전후 감시(러너 규격) — 오너 실파일 불가침을 기계 사실로
const 실홈자리들 = ['', 'Desktop', 'Documents', 'Downloads', 'GPAO-T5'];
async function 실홈스냅() {
  const 스냅 = {};
  for (const d of 실홈자리들) {
    try { 스냅[d || '~'] = (await readdir(join(진짜홈, d))).sort(); } catch { 스냅[d || '~'] = []; }
  }
  return 스냅;
}

const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
const 연결 = 저장된연결();
if (!연결) throw new Error('저장된 모델 연결이 없다');

const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5-f54-reprobe-')));
const stateDir = join(방, 'state');
const 덤프자리 = join(방, 'prompt-dump');
await mkdir(stateDir, { recursive: true });
await mkdir(덤프자리, { recursive: true });
if (!stateDir.startsWith(방) || stateDir.includes('.local/state/gpao-t5')) throw new Error('격리 위반');

// 덤프는 model-provider 가 process.env 로 읽는다(호출부가 env 인자를 안 준다) — 여기서 켠다.
process.env.GPAO_T5_PROMPT_DUMP = 덤프자리;
const 전 = await 실홈스냅();
const { startLiveServer } = await import(pathToFileURL(join(팔트리, 'src/surface/server.js')));
const 포트 = 4470 + Number(표본번호);
const server = await startLiveServer({
  port: 포트,
  processEnv: {
    HOME: 진짜홈,
    GPAO_T5_DATA_DIR: stateDir,
    GPAO_T5_FILE_ROOTS: join(진짜홈, 'GPAO-T5'),
    GPAO_T5_BROWSER_PROFILE: '1',
    GPAO_T5_PROMPT_DUMP: 덤프자리,
    GPAO_T5_CUA_BIN: join(스크래치, 'cua-stub-bin'),
    ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
    ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
    GPAO_T5_MODEL_ID: 'gpt-5.1',
  },
});
const 기록 = { 시각: new Date().toISOString(), 팔트리, 팔커밋: execFileSync('git', ['-C', 팔트리, 'log', '--oneline', '-1'], { encoding: 'utf8' }).trim(), 표본번호, 모델: 'gpt-5.1', 방 };
try {
  const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
  const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
  const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, {
    method: 'POST', headers: H, body: JSON.stringify(b ?? {}), signal: AbortSignal.timeout(300_000),
  }).then((r) => r.json());
  const s = await post('/sessions');
  const t0 = Date.now();
  const r = await post('/turn', { sessionId: s.id, text: '이번 달 얼마 벌었지?' });
  기록.걸린ms = Date.now() - t0;
  기록.kind = r.kind;
  기록.답 = r.reply ?? '';
  기록.원장 = r.ledger ?? null;
  if (r.pendingId) 기록.승인 = '하지 않음(측정 정책)';
  try {
    const 세션파일 = (await readdir(stateDir)).find((n) => n.includes(s.id));
    const 세션 = JSON.parse(await readFile(join(stateDir, 세션파일), 'utf8'));
    기록.손호출 = (세션.ledgerEntries ?? [])
      .map((e) => (e.actualCall ? e.actualCall.tool + (e.actualCall.args?.action ? `:${e.actualCall.args.action}` : '') : null))
      .filter(Boolean);
  } catch (e) { 기록.손호출 = null; 기록.손호출오류 = String(e); }
  // 실림 증명 — 덤프에서 system 원문을 읽어 B 4문장의 부재/존재를 기계로 확인
  try {
    const 덤프들 = (await readdir(덤프자리)).filter((n) => n.endsWith('.json')).sort();
    기록.덤프수 = 덤프들.length;
    let sys = '';
    for (const f of 덤프들) sys += await readFile(join(덤프자리, f), 'utf8');
    기록.실림검사 = {
      'B1 답할 수 있으면 묻지 않는다': sys.includes('답할 수 있으면 묻지 않는다'),
      'B2 유추해 답하': sys.includes('유추해 답하'),
      'B3 닫히면 닫는다': sys.includes('닫히면 닫는다'),
      'B4 남았으면 끝난 게 아니다': sys.includes('남았으면 끝난 게 아니다'),
      '태도문장 존재(스스로 본다)': sys.includes('답하기 전에 스스로 본다'),
      '화면답 실림(570,000)': sys.includes('570,000'),
      '자리사실 실림(안 본 자리 종류)': sys.includes('안 본 자리 종류'),
    };
  } catch (e) { 기록.덤프오류 = String(e); }
} finally {
  try { server?.close(); } catch { /* 이미 닫힘 */ }
}
const 후 = await 실홈스냅();
const 변경 = {};
for (const k of Object.keys(전)) {
  const 생김 = 후[k].filter((n) => !전[k].includes(n));
  const 사라짐 = 전[k].filter((n) => !후[k].includes(n));
  if (생김.length || 사라짐.length) 변경[k] = { 생김, 사라짐 };
}
기록.오너실홈변경 = Object.keys(변경).length ? 변경 : null;

const 파일손 = (기록.손호출 ?? []).filter((h) => /^local\./.test(h));
const 합산 = /3,?000,?000|300만/.test(기록.답 ?? '');
const 밝히기 = /(파일|정산|장부).{0,30}(안 봤|못 봤|확인하지 않|보지 않|안 열어|열지 않)/.test(기록.답 ?? '');
기록.판정 = { 파일손호출: 파일손, 합산나옴: 합산, 밝히기나옴: 밝히기, 행동변화: (파일손.length > 0 || 합산 || 밝히기) ? 1 : 0 };
await rm(방, { recursive: true, force: true });
if (출력자리) await writeFile(출력자리, JSON.stringify(기록, null, 2));
console.log(JSON.stringify(기록, null, 2));
