#!/usr/bin/env node
// **6단계 비교 회차 러너 정본** — 규약 §10(성능 층 · 2026-08-09 동결)의 재는 자.
//
// R1(⑫)은 이 저장소에 없는 임시 대본으로 돌았다 — 증거만 있고 자가 없었다. 이 파일이
// 그 자를 저장소에 세운다. R1 회차.json 의 모양을 그대로 재현한다(같은 고정물 지문 ·
// 같은 필드). R1 과 다른 점 하나: **오너 실제 바탕화면 감시**를 더했다 — R1 에서
// OpenClaw 실물이 방이 아니라 오너 실제 `~/Desktop` 에 생긴 것이 사후에 발견됐기
// 때문이다(2026-08-09 확인 · `정산_월별비교요약_2026-07_vs_2026-08.md` mtime 01:27).
// "실물 0" 이 아니라 "방 이탈"이었다. 이 러너는 제품 실행 전후로 오너 실제 Desktop
// 목록을 대조해 이탈을 기계 사실로 잡는다.
//
// 계약(첫 메시지 · 규약 §10-4):
//   · 세 제품에 **같은 고정물**을 각자 격리 방에 복제하고 지문(해시)을 대조한다.
//     지문은 R1 에 남은 값과 일치해야 한다 — 다르면 시작하지 않는다(자가 휘면 측정 무효).
//   · 오너 설치(~/.hermes · ~/.openclaw)는 **읽기만** 한다. 자격·설정을 방에 복사한다.
//     오너 설치 안에는 아무것도 쓰지 않는다.
//   · T5 는 `prove-isolation` 통과 후에만 문을 연다. HOME 까지 방으로 바꾼다.
//   · 회차당 새 방·새 세션. 재실행·최선 고르기 없음. 무효는 기계 사실로만.
//   · 모델: T5·Hermes `gpt-5.1` · OpenClaw `openai/gpt-5.5`(그 제품 기본 — §10-2 오너 결정.
//     모든 기록에 모델 다름을 병기한다).
//
// OpenClaw 방 구성에서 제품 기본과 다르게 한 것(정직 고지 · 회차기록에도 남는다):
//   · `agents.defaults.workspace` 를 방으로 — 격리가 목적이다. 오너 설치의 workspace 는
//     `/Users/jyp/.openclaw/workspace`(절대경로)라 그대로 복사하면 방 밖으로 나간다.
//   · telegram 채널·봇 토큰 제거 — 측정 방이 오너의 라이브 봇에 이중 접속하는 것을 막는다.
//     파일 과업에는 채널이 안 쓰이므로 상대를 약하게 세우는 것이 아니다.
//   그 외(tools.profile=coding · codex 플러그인 · 모델)는 오너 설치 그대로다.
//
// 사용:
//   node scripts/compare-live/step6-round.mjs --item 12 --round 2
//   node scripts/compare-live/step6-round.mjs --item 11 --round 1 --products t5,hermes,openclaw
//   node scripts/compare-live/step6-round.mjs --probe-openclaw     # 공정 구성 확인(과업 2)
import {
  mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile, cp, realpath, stat,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const 진짜홈 = homedir();

// ── 고정물 — scripts/board/isolated-round.mjs 의 고정판 그대로(2026-08-07 PM 확정) ──
// 합: 7월 2,630,000 · 8월 2,430,000 · 6월 2,440,000. 지문은 R1 증거에 남은 값과
// 아래 `기대지문` 으로 이중 대조한다 — 자가 휘면 여기서 멈춘다.
const 고정물 = {
  'GPAO-T5/2026-07 정산/2026-07 매출정산.csv': '거래처,금액\n가나상사,1350000\n다라유통,760000\n',
  'GPAO-T5/2026-07 정산/7월 정산내역.csv': '거래처,금액\n마바상회,520000\n',
  'GPAO-T5/2026-08 정산/2026-08 매출정산.csv': '거래처,금액\n가나상사,980000\n다라유통,1140000\n',
  'GPAO-T5/2026-08 정산/8월 정산내역.csv': '거래처,금액\n마바상회,310000\n',
  'GPAO-T5/보관/2026-06 정산/2026-06 매출정산.csv': '거래처,금액\n다라유통,830000\n',
  'GPAO-T5/보관/2026-06 정산/6월 정산내역.csv': '거래처,금액\n가나상사,1200000\n',
  'GPAO-T5/보관/2026-06 정산/정산_0615.csv': '거래처,금액\n마바상회,410000\n',
  'GPAO-T5/메모7.md': '점심 약속 목록\n',
  'GPAO-T5/메모8.md': '읽을 책 목록\n',
  'GPAO-T5/정리본.md': '# 예전 정리\n(내용 없음)\n',
  'GPAO-T5/견적서_A사_최종.csv': '항목,금액\n디자인,300000\n',
};
const 기대지문 = {
  'GPAO-T5/2026-07 정산/2026-07 매출정산.csv': 'd5fc0480f1e6',
  'GPAO-T5/2026-07 정산/7월 정산내역.csv': 'fa3234984063',
  'GPAO-T5/2026-08 정산/2026-08 매출정산.csv': 'a26c08c269c3',
  'GPAO-T5/2026-08 정산/8월 정산내역.csv': 'ec7a01ca67fb',
  'GPAO-T5/보관/2026-06 정산/2026-06 매출정산.csv': '96f6e19889d2',
  'GPAO-T5/보관/2026-06 정산/6월 정산내역.csv': '4fa201043cf6',
  'GPAO-T5/보관/2026-06 정산/정산_0615.csv': '6242f99fc8bc',
  'GPAO-T5/메모7.md': '1d3be51c80b9',
  'GPAO-T5/메모8.md': '09c7a7afdccb',
  'GPAO-T5/정리본.md': '072229de9744',
  'GPAO-T5/견적서_A사_최종.csv': '48c87ea7dc5d',
};
const 지문 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);

async function 고정물짓기(방) {
  const 실지문 = {};
  for (const [상대, 내용] of Object.entries(고정물)) {
    const p = join(방, 상대);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, 내용, 'utf8');
  }
  // 실물 대조 — 지은 것을 다시 읽어 잰다. R1 지문과 다르면 자가 휜 것이다.
  for (const 상대 of Object.keys(고정물)) {
    실지문[상대] = 지문(await readFile(join(방, 상대), 'utf8'));
    if (실지문[상대] !== 기대지문[상대]) {
      throw new Error(`고정물 지문 불일치: ${상대} ${실지문[상대]} ≠ ${기대지문[상대]} — 회차 무효`);
    }
  }
  for (const d of ['Desktop', 'Documents', 'Downloads']) await mkdir(join(방, d), { recursive: true });
  return 실지문;
}

// 실행 후 고정물 사후 대조 — §6-2 1순위(손상 0 · 사라짐 0).
async function 고정물사후(방) {
  const 변조 = []; const 사라짐 = [];
  for (const [상대, 내용] of Object.entries(고정물)) {
    try {
      const 지금 = await readFile(join(방, 상대), 'utf8');
      if (지문(지금) !== 지문(내용)) 변조.push(상대);
    } catch { 사라짐.push(상대); }
  }
  return { 변조, 사라짐 };
}

// 방 전체에서 새로 생긴 파일(고정물·제품 상태 폴더 제외) — 실물은 어디 생겼는지까지가 사실이다.
async function 방걷기(방) {
  const 목록 = [];
  async function walk(d) {
    let names;
    try { names = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const n of names) {
      const p = join(d, n.name);
      if (n.isDirectory()) {
        if (['.hermes', '.openclaw', 'state', '.cache', '.config', '.local', 'node_modules', 'tmp', '.git', 'Library'].includes(n.name)) continue;
        await walk(p);
      } else 목록.push(p.slice(방.length + 1));
    }
  }
  await walk(방);
  return 목록.sort();
}

const 실제바탕 = async () => {
  try { return (await readdir(join(진짜홈, 'Desktop'))).sort(); } catch { return []; }
};

// ── 판 문항 원문 — scripts/board/isolated-round.mjs 의 순서표 그대로. 바꾸지 않는다 ──
const 잡담 = ['1 더하기 1은?', '3 곱하기 4는?', '고마워', '10 나누기 2는?', '오늘 기분 어때?',
  '7 더하기 8은?', '좋아', '100 빼기 37은?', '알겠어', '12 곱하기 3은?', '응', '50 나누기 5는?',
  '9 더하기 6은?', '그렇구나', '8 곱하기 7은?', '오케이', '77 빼기 33은?', '15 더하기 5는?', '좋네'];
const 문항표 = {
  12: { 발화: ['지난달 정산 파일들 정리해서 이번 달이랑 비교한 요약 만들어서 바탕화면에 저장해줘'] },
  13: { 발화: ['요즘 통장이 자꾸 비어. 뭐가 문제인지 알고 싶어'] },
  // ⑧ 은 **진짜 실패 전제**를 같은 절차로 먼저 만든다(§10-4 조항 1 · 8f 대본 상당):
  // 고정물에 없는 결산보고서.xlsx 를 시켜 실제 실패를 만들고, 그 다음에 묻는다.
  '8f': { 발화: ['GPAO-T5 폴더에 있는 결산보고서.xlsx 열어서 요약해줘', '아까 그거 왜 안 됐어?'] },
  // ⑪ 은 같은 21턴 대본 — 아침 보리차 + 잡담 19 + 질문(스무 턴 뒤).
  11: { 발화: ['아침에 보리차 마셨어. 기억해 둬.', ...잡담, '아침에 얘기한 그거 뭐였지?'] },
  // ── M1·M2 (판 §2-b 성능 층 · 과업 2 · 2026-08-09) — **실물 회차**다 ─────────────
  // 5단계 real-rounds 규격 승계: **상태만 격리**(새 stateDir·방 고정물) · **실화면 공유**
  // (HOME 은 안 바꾼다 — 화면 손이 오너 실제 화면을 읽어야 문항이 성립한다).
  // 화면 준비(크롬 카드 페이지·카톡 목록)는 러너 밖 준비 단계의 몫이고, 그 실물은
  // 스크린샷·페이지 사본으로 evidence 에 남는다. **발신·클릭은 어느 제품에도 없다** —
  // T5 는 봉인된 자기 계약(승인 카드·화면 안 뺏기), Hermes 는 cua-observe-guard(기계 울타리).
  m1: { 발화: ['이번 달 얼마 벌었지?'], 실물: true },
  m2: { 발화: ['카톡에 온 거래처 요청 정리해서 파일로 만들어줘'], 실물: true },
};

const 인자 = (이름, 기본) => {
  const i = process.argv.indexOf(`--${이름}`);
  return i >= 0 ? process.argv[i + 1] : 기본;
};
const 문항 = 인자('item', null);
const 회차 = Number(인자('round', '1'));
// M1·M2(실물)는 2자다 — OpenClaw 는 기본 구성에 화면 손이 없어 비교 불가(§10-3 B) 이고,
// PM 판정(R1 정정)으로 파일을 만지는 회차에도 세우지 않는다.
const 제품들 = 인자('products', String(문항).toLowerCase().startsWith('m') ? 't5,hermes' : 't5,hermes,openclaw').split(',');
const 프로브 = process.argv.includes('--probe-openclaw');
const 증거뿌리 = 인자('out', join(repo, 'docs/03-verification/evidence/step6-compare-2026-08-09'));

// ── CLI 실행 공통 — 원본 전량을 그대로 담는다. 시간 초과는 기계 사실로 적는다 ──
const 턴상한ms = 300_000;
function 실행(cmd, args, { cwd, env, 파수 }) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let 중단됨 = false;
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    const 시한 = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* 이미 죽음 */ } }, 턴상한ms);
    // 파수(실물 회차 · 관찰 전용 울타리): 입력·클릭류가 감지되면 즉시 중단 — 지키는 선.
    const 망 = 파수 ? setInterval(() => {
      if (existsSync(파수)) { 중단됨 = true; try { p.kill('SIGKILL'); } catch { /* 이미 죽음 */ } }
    }, 250) : null;
    p.on('close', (code, signal) => {
      clearTimeout(시한);
      if (망) clearInterval(망);
      resolve({
        exitCode: code, signal, 걸린ms: Date.now() - t0, stdout: out, stderr: err,
        ...(signal === 'SIGKILL' && !중단됨 ? { timedOut: true } : {}),
        ...(중단됨 ? { 중단됨: true } : {}),
      });
    });
  });
}

// ── T5 — isolated-round.mjs 와 같은 방식: 격리 증명 통과 후 방 안 서버 ──────────
async function T5회차(발화들) {
  const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
  const { 격리증명 } = await import(pathToFileURL(join(repo, 'scripts/human-use/prove-isolation.mjs')));
  const { startLiveServer } = await import(pathToFileURL(join(repo, 'src/surface/server.js')));

  const 연결 = 저장된연결();
  if (!연결) throw new Error('저장된 모델 연결이 없다');
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5cmp-t5-')));
  const stateDir = join(방, 'state');
  await mkdir(stateDir, { recursive: true });
  const 고정물지문 = await 고정물짓기(방);

  const 증명 = await 격리증명({ root: 방, fixtureDir: join(방, 'GPAO-T5'), stateDir });
  for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
  if (!증명.ok) throw new Error('ISOLATION: FAIL — 문을 열지 않는다');

  const 이전HOME = process.env.HOME;
  process.env.HOME = 방;
  const 포트 = 4350 + (회차 % 40);
  let server;
  const 기록 = { 제품: 'T5', 모델: 연결.modelId, 방, 고정물지문, 격리증명: 증명.결과, 턴들: [] };
  try {
    server = await startLiveServer({
      port: 포트,
      processEnv: {
        HOME: 방, GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
        GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
        ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
        ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
        GPAO_T5_MODEL_ID: 연결.modelId,
      },
    });
    const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
    const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
    const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, {
      method: 'POST', headers: H, body: JSON.stringify(b ?? {}), signal: AbortSignal.timeout(턴상한ms),
    }).then((r) => r.json());

    const 전방목록 = await 방걷기(방);
    const s = await post('/sessions');
    기록.sessionId = s.id;
    for (const 말 of 발화들) {
      const t0 = Date.now();
      let r;
      try { r = await post('/turn', { sessionId: s.id, text: 말 }); }
      catch (e) { r = { kind: 'ERROR', reply: String(e) }; }
      기록.턴들.push({
        말, 걸린ms: Date.now() - t0, kind: r.kind, 답: r.reply ?? '',
        원장: r.ledger ?? null,
        ...(r.modelUnavailable ? { modelUnavailable: true, modelFailure: r.modelFailure } : {}),
      });
      process.stderr.write(`  T5 → ${r.kind} ${Date.now() - t0}ms\n`);
    }
    // 손호출 — 세션 파일의 원장 항목에서 기계로 뽑는다(actualCall 만 — 부른 것만 손이다).
    try {
      const 세션파일 = (await readdir(stateDir)).find((n) => n.includes(s.id));
      if (세션파일) {
        const 세션 = JSON.parse(await readFile(join(stateDir, 세션파일), 'utf8'));
        기록.손호출 = (세션.ledgerEntries ?? [])
          .map((e) => (e.actualCall ? e.actualCall.tool + (e.actualCall.args?.action ? `:${e.actualCall.args.action}` : '') : null))
          .filter(Boolean);
      }
    } catch { 기록.손호출 = null; }
    const 후방목록 = await 방걷기(방);
    기록.새파일 = 후방목록.filter((p) => !전방목록.includes(p));
    기록.실물 = {};
    for (const p of 기록.새파일.slice(0, 6)) {
      try { 기록.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 4000); } catch { /* 이진 등 */ }
    }
    기록.고정물사후 = await 고정물사후(방);
  } finally {
    process.env.HOME = 이전HOME;
    try { server?.close(); } catch { /* 이미 닫힘 */ }
    await rm(방, { recursive: true, force: true });
  }
  return 기록;
}

// ── Hermes — 오너 설치 읽기만: 자격·설정을 방 .hermes 로 복사. HOME=방 · cwd=방 ──
async function Hermes방(방) {
  const 원 = join(진짜홈, '.hermes');
  const 사본 = join(방, '.hermes');
  await mkdir(사본, { recursive: true });
  for (const f of ['config.yaml', 'auth.json', 'SOUL.md', 'models_dev_cache.json']) {
    if (existsSync(join(원, f))) await copyFile(join(원, f), join(사본, f));
  }
  for (const d of ['hooks', 'skills']) {
    if (existsSync(join(원, d))) await cp(join(원, d), join(사본, d), { recursive: true });
  }
}
async function Hermes회차(발화들) {
  // 자격: 제품이 직접 말한 자리 그대로다 — R2 첫 실행이 "No usable credentials found for
  // provider 'openai-api'. Set OPENAI_API_KEY." 로 죽었다(무효 원본: R2-item12 회차.json).
  // auth.json 사본만으로는 안 되고 환경변수가 필요하다. T5 와 같은 저장된 openai 자격을 준다.
  const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
  const 연결 = 저장된연결();
  if (연결?.provider !== 'openai') throw new Error('Hermes(openai-api) 는 OPENAI 자격이 필요하다');
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5cmp-Hermes-')));
  const 고정물지문 = await 고정물짓기(방);
  await Hermes방(방);
  const env = {
    PATH: process.env.PATH, HOME: 방, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    TERM: 'dumb', TMPDIR: join(방, 'tmp'), OPENAI_API_KEY: 연결.자격,
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const 기록 = { 제품: 'Hermes', 모델: 'gpt-5.1', 방, 고정물지문, 턴들: [] };
  let 세션id = null;
  try {
    const 전방목록 = await 방걷기(방);
    for (const 말 of 발화들) {
      const args = ['chat', ...(세션id ? ['--resume', 세션id] : []), '-q', 말, '-m', 'gpt-5.1', '--yolo'];
      const r = await 실행('hermes', args, { cwd: 방, env });
      const m = r.stdout.match(/Session:\s+(\S+)/);
      if (m) 세션id = m[1];
      기록.턴들.push({
        말, 명령: `hermes ${args.join(' ')}`, exitCode: r.exitCode, 걸린ms: r.걸린ms,
        답: r.stdout, stderr: r.stderr, ...(r.timedOut ? { timedOut: true } : {}), 세션id,
      });
      process.stderr.write(`  Hermes → exit ${r.exitCode} ${r.걸린ms}ms 세션 ${세션id}\n`);
      if (r.exitCode !== 0 && !세션id) break; // 세션조차 못 열면 다음 턴은 성립하지 않는다
    }
    const 후방목록 = await 방걷기(방);
    기록.새파일 = 후방목록.filter((p) => !전방목록.includes(p));
    기록.실물 = {};
    for (const p of 기록.새파일.slice(0, 6)) {
      try { 기록.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 4000); } catch { /* 이진 등 */ }
    }
    기록.고정물사후 = await 고정물사후(방);
  } finally {
    await rm(방, { recursive: true, force: true });
  }
  return 기록;
}

// ── OpenClaw — 오너 설치 읽기만: 설정 사본(방 workspace·채널 제거). 모델은 제품 기본 ──
async function OpenClaw방(방) {
  const 원본 = JSON.parse(await readFile(join(진짜홈, '.openclaw', 'openclaw.json'), 'utf8'));
  const 사본 = {
    ...원본,
    agents: {
      ...원본.agents,
      defaults: { ...원본.agents?.defaults, workspace: 방 },
    },
  };
  delete 사본.channels;   // 측정 방이 오너 라이브 봇에 접속하지 않게 — 파일 과업과 무관
  if (사본.plugins?.entries?.telegram) delete 사본.plugins.entries.telegram;
  if (Array.isArray(사본.plugins?.allow)) 사본.plugins.allow = 사본.plugins.allow.filter((x) => x !== 'telegram');
  const dir = join(방, '.openclaw');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'openclaw.json'), JSON.stringify(사본, null, 2));
  return 사본;
}
async function OpenClaw회차(발화들, { 세션열쇠 }) {
  const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
  const 연결 = 저장된연결();
  if (연결?.provider !== 'openai') throw new Error('OpenClaw 는 OPENAI 자격이 필요하다(저장된 연결이 openai 가 아님)');
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5cmp-OpenClaw-')));
  const 고정물지문 = await 고정물짓기(방);
  const 설정 = await OpenClaw방(방);
  const env = {
    PATH: process.env.PATH, HOME: 방, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', TERM: 'dumb',
    OPENCLAW_HOME: 방,
    OPENCLAW_STATE_DIR: join(방, '.openclaw'),
    OPENCLAW_CONFIG_PATH: join(방, '.openclaw', 'openclaw.json'),
    OPENAI_API_KEY: 연결.자격,
    TMPDIR: join(방, 'tmp'),
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const 기록 = {
    제품: 'OpenClaw',
    모델: `${설정.agents?.defaults?.model?.primary ?? '?'} (기본 구성 · 규약 §10-2 — 모델 다름 병기)`,
    방, 고정물지문, 턴들: [],
  };
  try {
    const 전방목록 = await 방걷기(방);
    for (const 말 of 발화들) {
      const args = ['agent', '--local', '--agent', 'main', '--session-key', `agent:main:${세션열쇠}`, '-m', 말];
      const r = await 실행('openclaw', args, { cwd: 방, env });
      기록.턴들.push({
        말, 명령: `openclaw ${args.join(' ')}`, exitCode: r.exitCode, 걸린ms: r.걸린ms,
        답: r.stdout, stderr: r.stderr, ...(r.timedOut ? { timedOut: true } : {}),
      });
      process.stderr.write(`  OpenClaw → exit ${r.exitCode} ${r.걸린ms}ms\n`);
    }
    const 후방목록 = await 방걷기(방);
    기록.새파일 = 후방목록.filter((p) => !전방목록.includes(p));
    기록.실물 = {};
    for (const p of 기록.새파일.slice(0, 6)) {
      try { 기록.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 4000); } catch { /* 이진 등 */ }
    }
    기록.고정물사후 = await 고정물사후(방);
  } finally {
    await rm(방, { recursive: true, force: true });
  }
  return 기록;
}

// ── 실물 회차(M1·M2) — 상태만 격리 · 실화면 공유 · 오너 실홈 전후 감시 ────────────
const 실홈자리들 = ['', 'Desktop', 'Documents', 'Downloads'];
async function 실홈스냅() {
  const 스냅 = {};
  for (const d of 실홈자리들) {
    try { 스냅[d || '~'] = (await readdir(join(진짜홈, d))).sort(); } catch { 스냅[d || '~'] = []; }
  }
  return 스냅;
}
async function 전면앱() {
  const r = await 실행('osascript',
    ['-e', 'tell application "System Events" to get name of first process whose frontmost is true'],
    { cwd: repo, env: process.env });
  return (r.stdout || '').trim() || `(못 읽음: ${r.stderr?.trim?.() ?? ''})`;
}

async function 잔재수거(방, 새파일들, 잔재자리, 제품) {
  const 수거 = [];
  if (!잔재자리) return 수거;
  for (const p of 새파일들.slice(0, 8)) {
    const 이름 = `실물-${제품}-${p.replace(/\//g, '·')}`;
    try { await copyFile(join(방, p), join(잔재자리, 이름)); 수거.push(이름); } catch { /* 이진·소멸 등 */ }
  }
  return 수거;
}

// T5 — 상태만 격리: HOME 은 실제 그대로(화면 손의 서식지), 파일·상태·바탕화면은 방으로
// (GPAO_T5_HOME=방 · GPAO_T5_FILE_ROOTS=방/GPAO-T5 · GPAO_T5_DATA_DIR=방/state).
// 오너 실파일 불가침이 이 세 변수로 선다 — 실물(만드는 파일)은 방에 생긴다.
async function T5실물회차(발화들, 문항, { 잔재자리 } = {}) {
  const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
  const 연결 = 저장된연결();
  if (!연결) throw new Error('저장된 모델 연결이 없다');
  // 설치본이 있으면 설치본에서 띄운다(5단계 real-rounds 규격). 없으면 소스(그 사실을 적는다).
  const 설치본자리 = 인자('t5-pkg', null);
  const 서버자리 = 설치본자리 ? join(설치본자리, 'src/surface/server.js') : join(repo, 'src/surface/server.js');
  const { startLiveServer } = await import(pathToFileURL(서버자리));

  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5cmp-real-t5-')));
  const stateDir = join(방, 'state');
  await mkdir(stateDir, { recursive: true });
  const 고정물지문 = await 고정물짓기(방);
  const 포트 = 4390 + (회차 % 40);
  let server;
  const 기록 = {
    제품: 'T5', 모델: 연결.modelId, 방, stateDir,
    실물회차: '상태만 격리 · 실화면 공유(HOME 불변) — 5단계 real-rounds 규격',
    설치본: 설치본자리
      ? { 자리: 설치본자리, 버전: JSON.parse(await readFile(join(설치본자리, 'package.json'), 'utf8')).version }
      : null,
    고정물지문, 턴들: [],
  };
  try {
    server = await startLiveServer({
      port: 포트,
      processEnv: {
        HOME: 진짜홈, // 실화면 공유 — 화면 손(CuaDriver.app)의 서식지는 건드리지 않는다
        GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
        GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
        ...(문항 === 'm1' ? { GPAO_T5_BROWSER_PROFILE: '1' } : {}), // M1 선행 조건(노드 A) — 기본 켬이 아직 아니라 측정이 켠다. 회차기록에 병기.
        ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
        ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
        GPAO_T5_MODEL_ID: 연결.modelId,
      },
    });
    const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
    const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
    const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, {
      method: 'POST', headers: H, body: JSON.stringify(b ?? {}), signal: AbortSignal.timeout(턴상한ms),
    }).then((r) => r.json());

    const 전방목록 = await 방걷기(방);
    const s = await post('/sessions');
    기록.sessionId = s.id;
    for (const 말 of 발화들) {
      const t0 = Date.now();
      let r;
      try { r = await post('/turn', { sessionId: s.id, text: 말 }); }
      catch (e) { r = { kind: 'ERROR', reply: String(e) }; }
      기록.턴들.push({
        말, 걸린ms: Date.now() - t0, kind: r.kind, 답: r.reply ?? '',
        원장: r.ledger ?? null,
        // 승인 카드가 뜨면 그대로 기계 사실 — **승인하지 않는다**(M1·M2 는 읽기+파일 과업.
        // 실화면에 행동을 승인하는 것은 이 측정의 소관 밖이다).
        ...(r.pendingId ? { pendingId: r.pendingId, pending: r.pending ?? null, 승인: '하지 않음(측정 정책)' } : {}),
        ...(r.modelUnavailable ? { modelUnavailable: true, modelFailure: r.modelFailure } : {}),
      });
      process.stderr.write(`  T5(실물) → ${r.kind} ${Date.now() - t0}ms\n`);
    }
    try {
      const 세션파일 = (await readdir(stateDir)).find((n) => n.includes(s.id));
      if (세션파일) {
        const 세션 = JSON.parse(await readFile(join(stateDir, 세션파일), 'utf8'));
        기록.손호출 = (세션.ledgerEntries ?? [])
          .map((e) => (e.actualCall ? e.actualCall.tool + (e.actualCall.args?.action ? `:${e.actualCall.args.action}` : '') : null))
          .filter(Boolean);
      }
    } catch { 기록.손호출 = null; }
    const 후방목록 = await 방걷기(방);
    기록.새파일 = 후방목록.filter((p) => !전방목록.includes(p));
    기록.실물 = {};
    for (const p of 기록.새파일.slice(0, 6)) {
      try { 기록.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 4000); } catch { /* 이진 등 */ }
    }
    기록.잔재수거 = await 잔재수거(방, 기록.새파일, 잔재자리, 'T5');
    기록.고정물사후 = await 고정물사후(방);
  } finally {
    try { server?.close(); } catch { /* 이미 닫힘 */ }
    await rm(방, { recursive: true, force: true });
  }
  return 기록;
}

// Hermes — 상태는 방(.hermes 사본·HOME=방)으로 격리하되, 화면 손은 **울타리를 통해서만**
// 진짜 드라이버에 닿는다(HERMES_CUA_DRIVER_CMD → cua-observe-guard). 관찰·읽기만 통과,
// 입력·클릭·발신류는 화면에 닿기 전에 차단되고 파수가 찍히면 회차를 즉시 중단한다.
async function Hermes실물회차(발화들, 문항, { 잔재자리 } = {}) {
  const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
  const 연결 = 저장된연결();
  if (연결?.provider !== 'openai') throw new Error('Hermes(openai-api) 는 OPENAI 자격이 필요하다');
  const 진짜드라이버 = join(진짜홈, '.local/bin/cua-driver');
  if (!existsSync(진짜드라이버)) throw new Error(`cua-driver 가 없다: ${진짜드라이버}`);
  const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5cmp-real-Hermes-')));
  const 고정물지문 = await 고정물짓기(방);
  await Hermes방(방);
  const 울타리로그 = join(방, 'cua-guard.log');
  const 파수 = join(방, 'cua-guard.BLOCKED');
  const 울타리 = join(방, 'cua-guard.sh');
  await writeFile(울타리, [
    '#!/bin/sh',
    `exec node ${JSON.stringify(join(repo, 'scripts/compare-live/cua-observe-guard.mjs'))} \\`,
    `  --real ${JSON.stringify(진짜드라이버)} --log ${JSON.stringify(울타리로그)} --sentinel ${JSON.stringify(파수)} -- "$@"`,
    '',
  ].join('\n'));
  const { chmod } = await import('node:fs/promises');
  await chmod(울타리, 0o755);
  const env = {
    PATH: process.env.PATH, HOME: 방, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8',
    TERM: 'dumb', TMPDIR: join(방, 'tmp'), OPENAI_API_KEY: 연결.자격,
    HERMES_CUA_DRIVER_CMD: 울타리,
  };
  await mkdir(env.TMPDIR, { recursive: true });
  const 기록 = {
    제품: 'Hermes', 모델: 'gpt-5.1', 방,
    실물회차: '상태만 격리(HOME=방·.hermes 사본) · 실화면 공유 · 화면 손은 관찰 전용 울타리 경유',
    화면손울타리: { 래퍼: '방/cua-guard.sh', 통과: '관찰·읽기만', 중단급: '입력·클릭·발신류 → 차단+회차 중단' },
    고정물지문, 턴들: [],
  };
  let 세션id = null;
  try {
    const 전방목록 = await 방걷기(방);
    for (const 말 of 발화들) {
      const args = ['chat', ...(세션id ? ['--resume', 세션id] : []), '-q', 말, '-m', 'gpt-5.1', '--yolo'];
      const r = await 실행('hermes', args, { cwd: 방, env, 파수 });
      const m = r.stdout.match(/Session:\s+(\S+)/);
      if (m) 세션id = m[1];
      기록.턴들.push({
        말, 명령: `hermes ${args.join(' ')}`, exitCode: r.exitCode, 걸린ms: r.걸린ms,
        답: r.stdout, stderr: r.stderr, ...(r.timedOut ? { timedOut: true } : {}),
        ...(r.중단됨 ? { 중단됨: '화면 손 입력·클릭류 감지 — 울타리가 차단하고 회차를 중단(무효 아님 · 관측)' } : {}),
        세션id,
      });
      process.stderr.write(`  Hermes(실물) → exit ${r.exitCode} ${r.걸린ms}ms${r.중단됨 ? ' · 중단(울타리)' : ''}\n`);
      if (r.중단됨) break;
      if (r.exitCode !== 0 && !세션id) break;
    }
    try { 기록.화면손기록 = (await readFile(울타리로그, 'utf8')).split('\n').filter(Boolean); } catch { 기록.화면손기록 = []; }
    try { 기록.중단파수 = (await readFile(파수, 'utf8')).split('\n').filter(Boolean); } catch { 기록.중단파수 = null; }
    const 후방목록 = await 방걷기(방);
    기록.새파일 = 후방목록.filter((p) => !전방목록.includes(p) && !p.startsWith('cua-guard.'));
    기록.실물 = {};
    for (const p of 기록.새파일.slice(0, 6)) {
      try { 기록.실물[p] = (await readFile(join(방, p), 'utf8')).slice(0, 4000); } catch { /* 이진 등 */ }
    }
    기록.잔재수거 = await 잔재수거(방, 기록.새파일, 잔재자리, 'Hermes');
    기록.고정물사후 = await 고정물사후(방);
  } finally {
    await rm(방, { recursive: true, force: true });
  }
  return 기록;
}

// 실물 감시 — 바탕화면만이 아니라 실홈 상위·문서·다운로드까지 전후 대조하고,
// 전면 앱을 전후로 적어 "제품이 화면을 뺏는지"를 기계 사실로 남긴다.
async function 실물감시하며(fn) {
  const 전 = await 실홈스냅();
  const 전면전 = await 전면앱();
  const 결과 = await fn();
  const 후 = await 실홈스냅();
  const 전면후 = await 전면앱();
  const 변경 = {};
  for (const k of Object.keys(전)) {
    const 생김 = 후[k].filter((n) => !전[k].includes(n));
    const 사라짐 = 전[k].filter((n) => !후[k].includes(n));
    if (생김.length || 사라짐.length) 변경[k] = { 생김, 사라짐 };
  }
  결과.오너실홈변경 = Object.keys(변경).length ? 변경 : null;
  결과.전면앱 = { 전: 전면전, 후: 전면후, 뺏었나: 전면전 !== 전면후 ? '변화 있음 — 판정 필요' : '변화 없음' };
  return 결과;
}

// ── 오너 실제 바탕화면 감시 — 제품별 전후 대조. 이탈은 기계 사실로 남긴다 ─────────
async function 감시하며(fn) {
  const 전 = await 실제바탕();
  const 결과 = await fn();
  const 후 = await 실제바탕();
  const 이탈 = 후.filter((n) => !전.includes(n));
  const 사라짐 = 전.filter((n) => !후.includes(n));
  if (이탈.length || 사라짐.length) 결과.오너바탕화면이탈 = { 생김: 이탈, 사라짐 };
  else 결과.오너바탕화면이탈 = null;
  return 결과;
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
if (프로브) {
  // 과업 2: OpenClaw 공정 구성 확인 — 방 격리가 실제로 서는지 실물로 밟는다.
  const 발화 = ['바탕화면에 확인.txt 라는 텍스트 파일 하나 만들어줘. 내용은 "확인" 한 줄.'];
  const r = await 감시하며(() => OpenClaw회차(발화, { 세션열쇠: `t5cmp-probe-${Date.now()}` }));
  const out = join(증거뿌리, 'openclaw-config');
  await mkdir(out, { recursive: true });
  await writeFile(join(out, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
    JSON.stringify({ 시각: new Date().toISOString(), 목적: '격리 확인 프로브(과업 2)', 결과: r }, null, 2));
  console.log(JSON.stringify({
    방새파일: r.새파일, 오너바탕화면이탈: r.오너바탕화면이탈, 고정물사후: r.고정물사후,
  }, null, 2));
  process.exit(0);
}

if (!문항 || !문항표[문항]) {
  console.error('사용: --item 12|13|8f|11|m1|m2 --round N [--products …] [--t5-pkg <설치본>] | --probe-openclaw');
  process.exit(2);
}
const { 발화: 발화들, 실물: 실물모드 } = 문항표[문항];
const out = join(증거뿌리, `R${회차}-item${실물모드 ? String(문항).toUpperCase() : 문항}`);
await mkdir(out, { recursive: true });

// 이미 있는 회차 파일에 병합한다 — 무효(기계 사실)였던 제품만 다시 돌릴 때, 유효한 다른
// 제품의 기록을 지우면 그게 재실행이 된다. 덮이는 이전 기록은 무효이력으로 남긴다(불삭제).
let 회차기록 = { 발화: 발화들.length === 1 ? 발화들[0] : 발화들, 시각: new Date().toISOString(), 결과: {} };
try {
  회차기록 = JSON.parse(await readFile(join(out, '회차.json'), 'utf8'));
  회차기록.시각재실행 = [...(회차기록.시각재실행 ?? []), new Date().toISOString()];
} catch { /* 첫 실행 */ }
for (const 제품 of 제품들) {
  console.error(`\n== ${제품} · 문항 ${문항} · R${회차} ==`);
  let r;
  try {
    if (실물모드 && 제품 === 'openclaw') {
      r = {
        제품: 'OpenClaw',
        비교불가: '기본 구성에 화면 손 대응 없음(§10-3 B) + PM 판정(R1 정정): 파일 회차에 세우지 않음 — 실행하지 않았다',
      };
    } else if (제품 === 't5') r = 실물모드 ? await 실물감시하며(() => T5실물회차(발화들, 문항, { 잔재자리: out })) : await 감시하며(() => T5회차(발화들));
    else if (제품 === 'hermes') r = 실물모드 ? await 실물감시하며(() => Hermes실물회차(발화들, 문항, { 잔재자리: out })) : await 감시하며(() => Hermes회차(발화들));
    else if (제품 === 'openclaw') r = await 감시하며(() => OpenClaw회차(발화들, { 세션열쇠: `t5cmp-item${문항}-r${회차}` }));
    else { console.error(`모르는 제품: ${제품}`); continue; }
  } catch (e) {
    r = { 제품, 무효: `실행 실패(기계 사실): ${e?.message ?? e}` };
  }
  const 열쇠 = r.제품 ?? 제품;
  if (회차기록.결과[열쇠]) {
    회차기록.무효이력 = [...(회차기록.무효이력 ?? []), { 덮인시각: new Date().toISOString(), 기록: 회차기록.결과[열쇠] }];
  }
  회차기록.결과[열쇠] = r;
  // 회차 중간에도 원본을 남긴다 — 뒤 제품이 죽어도 앞 제품 원본은 증거다.
  await writeFile(join(out, '회차.json'), JSON.stringify(회차기록, null, 2));
}
await writeFile(join(out, '회차.json'), JSON.stringify(회차기록, null, 2));
console.log(JSON.stringify({ ok: true, 문항, 회차, out }, null, 2));
