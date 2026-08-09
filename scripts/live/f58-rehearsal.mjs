// **F-58 리허설·실물 회차 러너** (PM 조건 ⑤ · 창 동결 셋 반영 2026-08-10)
//
// 닫는 문장: 같은 세션 연속 두 발신 — 첫 카드 O(방·내용 표시) · **두 번째 카드 X** ·
// 두 번 다 발신. 한 실행 = 한 회차. **재실행 없음** — 원하는 모양이 나올 때까지 굴리는 것은
// 재실행 금지 위반이다(PM 동결 ①). 원본은 전량 시각 파일명으로 남는다.
//
// 두 모드:
//   (기본) 격리 리허설 — 실서버+실모델+격리 방+화면만 가짜(제품 슬롯 경계 주입).
//   --실물 — 실물 창 회차(PM 승인 2026-08-10): 설치본(--pkg·--pkg-sha)에서 서버를 띄우고,
//     화면은 진짜 드라이버(제품이 스스로 찾음). **상태만 격리**(GPAO_T5_DATA_DIR 새 자리 —
//     실사용 상태 자리 불가침) · 실홈 전후 대조 · 허가 방/문구만 · 오너가 기계를 비운 창에서만.
//
// 창 동결 셋(PM 2026-08-10) — 러너가 기계로 남긴다:
//   ① click 갈래: 턴 2 카드의 판정인자가 click 이면 그 회차는 ② 미달이 아니라
//      **미측정(click 갈래 첫 실물 표본)** — exit 2. 갈래 판단은 PM 몫.
//   ② F-60 겸용: 둘째 발신이 카드 없이 실행에서 실패하면 **F-60 둘째 표본** — exit 3.
//      실패 순간 재료로 매 턴 뒤 카톡 창 AX 관찰 덤프를 남긴다(읽기 전용).
//   ③ 카드마다 kind·실질(상대열쇠) 유무를 원장에 남긴다 — 승인 직전 세션 파일에서 읽는다
//      (승인 뒤에는 지워진다). 지난 회차의 유일한 원장 공백이 이 자리였다.
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath, readdir, cp, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));

const 인자 = (이름) => { const i = process.argv.indexOf(`--${이름}`); return i >= 0 ? process.argv[i + 1] : null; };
const 실물 = process.argv.includes('--실물');
const 설치본 = 인자('pkg');
const 설치본해시 = 인자('pkg-sha');
if (실물 && !설치본) { console.error('실물 회차는 설치본 전수다(--pkg <펼친 자리> 필수 · PM 규격)'); process.exit(9); }

const 방이름 = 'n.BEAI 사일런트서비스';
const 문구 = '지파오가 테스트 중입니다. 응답 안해주셔도 됩니다.';
const OUT = join(repo, 'docs/03-verification/evidence', 실물 ? 'f58-real-2026-08-10' : 'f58-rehearsal-2026-08-09');

// ── 리허설 화면(모조 모드만) — 상태가 있다: 넣으면 칸에 보이고, 엔터·전송이면 말풍선이 생긴다.
const 행동기록 = [];
const 관찰수 = { n: 0 };
const 화면상태 = { 입력값: '', 보낸것: [] };
const 리허설드라이버 = {
  id: 'cua', label: '화면(리허설 가짜)', needs: [],
  async status() {
    return { backend: { id: 'cua', ready: true }, permissions: { accessibility: true, screenRecording: true } };
  },
  async observe() {
    관찰수.n += 1;
    return {
      frontmost: { name: '카카오톡' },
      windows: [{ id: 9, pid: 7, app: '카카오톡', title: 방이름 }],
      본창: { id: 9, pid: 7, app: '카카오톡', title: 방이름, bounds: { x: 0, y: 0, w: 430, h: 664 } },
      elements: [
        ...화면상태.보낸것.map((m, i) => ({ id: `m${i}`, role: 'AXStaticText', label: '보낸 메시지', value: m })),
        { id: 'e9', element_token: 's1:9', role: 'AXTextArea', label: '메시지 입력', value: 화면상태.입력값 },
        { id: 'e10', element_token: 's1:10', role: 'AXButton', label: '전송' },
      ],
    };
  },
  async act(요청) {
    행동기록.push(JSON.parse(JSON.stringify(요청 ?? {})));
    const 행동 = String(요청?.행동 ?? 요청?.action ?? '');
    const 값 = String(요청?.값 ?? '');
    if (행동 === 'set_value' || 행동 === 'type' || 행동 === 'type_text') 화면상태.입력값 = 값;
    const 엔터 = 행동 === 'press_key' && /^(return|enter)$/i.test(값);
    const 전송클릭 = /click/.test(행동) && String(요청?.대상?.label ?? '') === '전송';
    if ((엔터 || 전송클릭) && 화면상태.입력값) {
      화면상태.보낸것.push(화면상태.입력값);
      화면상태.입력값 = '';
    }
    return { effect: 'confirmed' };
  },
  close() {},
};

// ── 실홈 전후 대조(실물) — 오너 홈 최상위 세 자리의 이름 목록. 변경 0 이어야 한다.
const 실홈목록 = async () => {
  if (!실물) return null;
  const 결과 = {};
  for (const d of ['Desktop', 'Documents', 'Downloads']) {
    결과[d] = (await readdir(join(homedir(), d)).catch(() => [])).sort();
  }
  return 결과;
};
// 실사용 상태 자리 불가침 — mtime 전후로 잰다(내용은 열지 않는다).
const 실상태자리 = join(homedir(), '.local', 'state', 'gpao-t5');
const 실상태mtime = async () => (await stat(실상태자리).catch(() => null))?.mtimeMs ?? null;

// ── 실물 AX 관찰(읽기 전용 · F-60 재료) — 제품 드라이버로 카톡 창을 한 번 본다.
async function 실물관찰덤프() {
  if (!실물) return null;
  try {
    const { 화면손찾기 } = await import(pathToFileURL(join(repo, 'src/runtime/desktop-bin.js')));
    const { makeCuaDriver } = await import(pathToFileURL(join(repo, 'src/runtime/desktop-cua-driver.js')));
    const bin = 화면손찾기({ env: process.env });
    if (!bin) return { 없음: '화면 백엔드를 못 찾았다' };
    const d = makeCuaDriver({ binPath: bin });
    const 관찰 = await d.observe({ scope: 'window', app: 'KakaoTalk', 창제목: 방이름, 글자만: true, limit: 60 })
      .catch((e) => ({ 오류: String(e?.message ?? e) }));
    try { d.close?.(); } catch { /* 걷기 실패는 삼킨다 */ }
    return JSON.parse(JSON.stringify(관찰 ?? null));
  } catch (e) { return { 오류: String(e?.message ?? e) }; }
}
const 문구행수 = (덤프) => (JSON.stringify(덤프 ?? '').match(new RegExp(문구.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;

// ── 방·격리·서버 ─────────────────────────────────────────────────────────
const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다 — 회차 불가'); process.exit(9); }

const 방 = await realpath(await mkdtemp(join(tmpdir(), 실물 ? 't5-f58-real-' : 't5-f58-rehearsal-')));
let server = null;
let 판정 = { ok: false, 이유: '시작 전' };
let 종료코드 = 1;
try {
  const stateDir = join(방, 'state');
  await mkdir(stateDir, { recursive: true });

  let 격리기록 = null;
  if (!실물) {
    await mkdir(join(방, 'GPAO-T5'), { recursive: true });
    for (const d of ['Desktop', 'Documents', 'Downloads']) await mkdir(join(방, d), { recursive: true });
    const { 격리증명 } = await import(pathToFileURL(join(repo, 'scripts/human-use/prove-isolation.mjs')));
    const 증명 = await 격리증명({ root: 방, fixtureDir: join(방, 'GPAO-T5'), stateDir });
    for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
    if (!증명.ok) { console.error('ISOLATION: FAIL — 문을 열지 않는다'); process.exit(9); }
    격리기록 = 증명.결과;
    // **슬롯 경계 주입** — 등록소에 먼저 붙이면 live-context 는 실드라이버를 만들지 않는다.
    const { 화면등록소, DESKTOP_SLOT } = await import(pathToFileURL(join(repo, 'src/runtime/desktop-slot.js')));
    화면등록소().붙이기(DESKTOP_SLOT, 리허설드라이버);
    process.env.HOME = 방;
  } else {
    // **상태만 격리**(PM 규격) — 실홈·실화면은 진짜, 데이터 자리만 새 방이다.
    if (stateDir.startsWith(실상태자리)) { console.error('상태 자리가 실사용 자리를 침범한다'); process.exit(9); }
    격리기록 = [{ 항목: '상태 격리', 통과: true, 사실: `GPAO_T5_DATA_DIR=${stateDir} (실자리 ${실상태자리} 불가침 · mtime 전후 대조)` }];
  }
  const 실홈전 = await 실홈목록();
  const 실상태전 = await 실상태mtime();
  const 관찰덤프들 = [];
  if (실물) 관찰덤프들.push({ 시점: '전', 덤프: await 실물관찰덤프() });

  // dumpModelInput/Output 은 전역 process.env 를 읽는다(서버가 같은 프로세스라 여기서 켠다).
  process.env.GPAO_T5_PROMPT_DUMP = join(방, 'prompt-dump');
  const 서버자리 = 설치본 ? join(설치본, 'src/surface/server.js') : join(repo, 'src/surface/server.js');
  const { startLiveServer } = await import(pathToFileURL(서버자리));
  const 포트 = 실물 ? 4391 : 4390;
  server = await startLiveServer({
    port: 포트,
    processEnv: {
      ...(실물 ? process.env : { HOME: 방, GPAO_T5_HOME: 방, GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5') }),
      GPAO_T5_DATA_DIR: stateDir,
      ...(실물 ? {} : { GPAO_T5_DESKTOP_BIN: join(방, '리허설-화면-없음') }),
      GPAO_T5_PROMPT_DUMP: join(방, 'prompt-dump'),
      ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
      ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
      GPAO_T5_MODEL_ID: 연결.modelId,
    },
  });

  const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
  const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
  const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, {
    method: 'POST', headers: H, body: JSON.stringify(b ?? {}),
  }).then((r) => r.json());

  // **카드의 kind·실질 유무를 승인 직전에 원장으로 남긴다**(PM 동결 ③ — 승인 뒤엔 지워진다).
  async function 카드원장(sessionId, pendingId) {
    try {
      const 파일들 = await readdir(stateDir);
      for (const f of 파일들.filter((x) => x.endsWith('.json'))) {
        const s = JSON.parse(await readFile(join(stateDir, f), 'utf8').catch(() => 'null'));
        const 대기 = s?.pendingApprovals?.[pendingId] ?? (s?.id === sessionId ? s?.pendingApprovals?.[pendingId] : null);
        if (!대기) continue;
        const g = (대기.plan?.needsApproval ?? [])[0] ?? null;
        const 인자 = 대기.intent?.toolArgs?.['desktop.act'] ?? null;
        return {
          kind: g?.kind ?? null,
          실질있음: Boolean(g?.상대열쇠),
          action: 인자?.action ?? null,
        };
      }
    } catch { /* 없으면 없다고 남긴다 */ }
    return { kind: null, 실질있음: null, action: null };
  }

  async function 발화하고승인까지(sessionId, text) {
    const 턴들 = []; const 카드들 = [];
    let r = await post('/turn', { sessionId, text });
    턴들.push(r);
    let 한도 = 6;
    while (r?.kind === 'approval' && 한도-- > 0) {
      const 카드 = (r.pending ?? [])[0];
      카드들.push({
        pendingId: r.pendingId,
        impact: 카드?.preview?.impact ?? 카드?.approvalPreview?.impact ?? null,
        ...(await 카드원장(sessionId, r.pendingId)),
      });
      r = await post('/turn', { sessionId, approve: r.pendingId });
      턴들.push(r);
    }
    return { 턴들, 카드들, 마지막: r };
  }

  const s = await post('/sessions');

  console.error('— 턴 1: 첫 발신 —');
  const 보냄0 = 실물 ? 문구행수(관찰덤프들[0]?.덤프) : 화면상태.보낸것.length;
  const T1 = await 발화하고승인까지(s.id, `카톡 "${방이름}" 에 "${문구}" 보내줘`);
  if (실물) 관찰덤프들.push({ 시점: '턴1후', 덤프: await 실물관찰덤프() });
  const 보냄1 = 실물 ? 문구행수(관찰덤프들.at(-1)?.덤프) : 화면상태.보낸것.length;

  console.error('— 턴 2: 같은 세션 · 같은 방 · 같은 문구 —');
  const T2 = await 발화하고승인까지(s.id, `카톡 "${방이름}" 에 "${문구}" 한 번 더 보내줘`);
  if (실물) 관찰덤프들.push({ 시점: '턴2후', 덤프: await 실물관찰덤프() });
  const 보냄2 = 실물 ? 문구행수(관찰덤프들.at(-1)?.덤프) : 화면상태.보낸것.length;

  const 실홈후 = await 실홈목록();
  const 실상태후 = await 실상태mtime();

  // ── 판정 — 기계 사실만. 창 동결 셋(PM)의 갈래를 먼저 가른다 ───────────────
  const 사실 = {
    턴1_카드수: T1.카드들.length,
    턴1_발신: 보냄1 - 보냄0,
    턴2_카드수: T2.카드들.length,
    턴2_발신: 보냄2 - 보냄1,
    ...(실물 ? {} : { 보낸말풍선: 화면상태.보낸것, 관찰호출: 관찰수.n, 행동호출: 행동기록.length }),
    ...(실물 ? {
      실홈변경: JSON.stringify(실홈전) === JSON.stringify(실홈후) ? 0 : { 전: 실홈전, 후: 실홈후 },
      실상태자리변경: 실상태전 === 실상태후 ? 0 : { 전: 실상태전, 후: 실상태후 },
    } : {}),
  };
  const click갈래 = T2.카드들.some((c) => c.action === 'click');
  const 초록 = 사실.턴1_카드수 >= 1 && 사실.턴1_발신 >= 1 && 사실.턴2_카드수 === 0 && 사실.턴2_발신 >= 1;
  const f60꼴 = 사실.턴2_카드수 === 0 && 사실.턴2_발신 < 1;   // 카드 없이 실행이 안 닿았다
  판정 = 초록 ? { ok: true, 갈래: '초록', 사실 }
    : click갈래 ? { ok: false, 갈래: '미측정(click 갈래 표본 · PM 동결 ①)', 사실 }
      : f60꼴 ? { ok: false, 갈래: 'F-60 표본(카드 없이 실행 미달 · PM 동결 ②)', 사실 }
        : { ok: false, 갈래: '빨강(기타)', 사실 };
  종료코드 = 초록 ? 0 : click갈래 ? 2 : f60꼴 ? 3 : 1;

  await mkdir(OUT, { recursive: true });
  // **회차 원본은 덮지 않는다** — 시각이 파일명이다. 무효·빨강 판도 전량 남긴다.
  const 기록이름 = `${실물 ? '실물회차' : '리허설기록'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(join(OUT, 기록이름), JSON.stringify({
    시각: new Date().toISOString(),
    모드: 실물 ? '실물(창)' : '격리 리허설',
    productCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    ...(설치본 ? {
      설치본: { 자리: 설치본, 버전: JSON.parse(await readFile(join(설치본, 'package.json'), 'utf8')).version, ...(설치본해시 ? { shasum: 설치본해시 } : {}) },
    } : {}),
    모델: 연결.modelId,
    격리: 격리기록,
    판정, 카드들: { 턴1: T1.카드들, 턴2: T2.카드들 },
    ...(실물 ? { 관찰덤프들 } : { 행동기록 }),
    턴전문: { 턴1: T1.턴들, 턴2: T2.턴들 },
  }, null, 2), 'utf8');

  console.error(`판정: ${판정.갈래} — ${JSON.stringify({ ...판정.사실, 보낸말풍선: undefined })}`);
  // 프롬프트 덤프(모델이 받은 재료)를 방이 걷히기 전에 증거로 옮긴다.
  await cp(join(방, 'prompt-dump'), join(OUT, 기록이름.replace('.json', '-prompts')), { recursive: true }).catch(() => {});
  // 실물 회차의 세션 파일(원장 전문)도 증거로 옮긴다 — 지난 회차의 원장 공백을 반복하지 않는다.
  if (실물) await cp(stateDir, join(OUT, 기록이름.replace('.json', '-state')), { recursive: true }).catch(() => {});
} finally {
  try { await new Promise((r) => server?.close(r)); } catch { /* 이미 닫혔으면 그만 */ }
  try { 리허설드라이버.close(); } catch { /* 없음 */ }
  // 방은 걷는다 — 기록은 OUT(저장소 evidence)에 이미 남았다(F-61 — 만들기와 걷기 한 코드).
  await rm(방, { recursive: true, force: true }).catch(() => {});
}
process.exit(종료코드);
