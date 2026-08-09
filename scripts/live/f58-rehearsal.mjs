// **F-58 격리 리허설** (PM 조건 ⑤ · 2026-08-09) — 닫는 문장을 실경로+실모델로 잰다:
//   같은 세션 연속 두 발신 — 첫 번째 카드 O · **두 번째 카드 X** · 두 번 다 발신이 손에 닿음.
//
// 무엇이 진짜인가: 서버(HTTP·세션 지속·installed 신분) · 모델(저장된연결 — 제품 기본) ·
// 상태 자리(격리 방 + 격리증명). **화면만 가짜다** — 제품 슬롯 경계(화면등록소)에 리허설
// 드라이버를 붙인다. MCP 층을 흉내 내지 않는 이유: 첫 리허설 미달이 하네스 결함이었다
// (77ffe3a 부기) — 가짜는 얇을수록 하네스가 결과를 오염시킬 자리가 준다. MCP·실물 층은
// F-53 봉인이 따로 물고, 실물 확인은 이 리허설 초록 뒤 **창 요청**(오너 자리)이 한다.
//
// 방·서버·기록은 finally 에서 걷는다 — **만들기와 걷기가 한 코드다**(F-61 · 하루 4회 재발의
// 원인 제거. 세션 손으로 worktree·방을 만들지 않는다).
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
const { 격리증명 } = await import(pathToFileURL(join(repo, 'scripts/human-use/prove-isolation.mjs')));
const { 화면등록소, DESKTOP_SLOT } = await import(pathToFileURL(join(repo, 'src/runtime/desktop-slot.js')));
const { startLiveServer } = await import(pathToFileURL(join(repo, 'src/surface/server.js')));

const 방이름 = 'n.BEAI 사일런트서비스';
const 문구 = '지파오가 테스트 중입니다. 응답 안해주셔도 됩니다.';
const OUT = join(repo, 'docs/03-verification/evidence', 'f58-rehearsal-2026-08-09');

// ── 리허설 화면 — **상태가 있다.** 첫 판(정적 화면)에서 모델이 정직하게 "안 들어간다"로
// 판정하고 시도를 접었다(리허설기록 1차 · 판정 빨강 — 하네스 충실도가 원인). 실물처럼
// 넣으면 칸에 보이고, 엔터·전송이면 말풍선이 생기고 칸이 빈다. 행동은 전부 기록한다.
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

// ── 방·격리·서버 ─────────────────────────────────────────────────────────
const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다 — 리허설 불가'); process.exit(2); }

const 방 = await realpath(await mkdtemp(join(tmpdir(), 't5-f58-rehearsal-')));
let server = null;
let 판정 = { ok: false, 이유: '시작 전' };
try {
  const stateDir = join(방, 'state');
  await mkdir(stateDir, { recursive: true });
  await mkdir(join(방, 'GPAO-T5'), { recursive: true });
  for (const d of ['Desktop', 'Documents', 'Downloads']) await mkdir(join(방, d), { recursive: true });

  const 증명 = await 격리증명({ root: 방, fixtureDir: join(방, 'GPAO-T5'), stateDir });
  for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
  if (!증명.ok) { console.error('ISOLATION: FAIL — 문을 열지 않는다'); process.exit(3); }

  // **슬롯 경계 주입** — 등록소에 먼저 붙이면 live-context 는 실드라이버를 만들지 않는다
  // (`if (!등록소.드라이버(DESKTOP_SLOT).length)`). 문은 GPAO_T5_DESKTOP_BIN 으로 연다.
  화면등록소().붙이기(DESKTOP_SLOT, 리허설드라이버);

  process.env.HOME = 방;
  // dumpModelInput/Output 은 전역 process.env 를 읽는다(서버가 같은 프로세스라 여기서 켠다).
  process.env.GPAO_T5_PROMPT_DUMP = join(방, 'prompt-dump');
  const 포트 = 4390;
  server = await startLiveServer({
    port: 포트,
    processEnv: {
      HOME: 방, GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
      GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
      GPAO_T5_DESKTOP_BIN: join(방, '리허설-화면-없음'),   // 문만 연다 — 실행은 등록소의 가짜가 받는다
      // 모델이 받은 재료를 원장으로 남긴다 — "환경상 불가" 서사가 재료에서 왔는지 가르는 자
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

  // 한 발화를 넣고, 카드가 뜨는 동안 승인한다(사용자 경로 그대로). 카드 원문 전량 기록.
  async function 발화하고승인까지(sessionId, text) {
    const 턴들 = []; const 카드들 = [];
    let r = await post('/turn', { sessionId, text });
    턴들.push(r);
    let 한도 = 6;
    while (r?.kind === 'approval' && 한도-- > 0) {
      const 카드 = (r.pending ?? [])[0];
      카드들.push({ pendingId: r.pendingId, impact: 카드?.preview?.impact ?? 카드?.approvalPreview?.impact ?? null, kind: 카드?.kind ?? null });
      r = await post('/turn', { sessionId, approve: r.pendingId });
      턴들.push(r);
    }
    return { 턴들, 카드들, 마지막: r };
  }

  const s = await post('/sessions');

  console.error('— 턴 1: 첫 발신 —');
  const 보냄0 = 화면상태.보낸것.length;
  const T1 = await 발화하고승인까지(s.id, `카톡 "${방이름}" 에 "${문구}" 보내줘`);
  const 보냄1 = 화면상태.보낸것.length;

  console.error('— 턴 2: 같은 세션 · 같은 방 · 같은 문구 —');
  const T2 = await 발화하고승인까지(s.id, `카톡 "${방이름}" 에 "${문구}" 한 번 더 보내줘`);
  const 보냄2 = 화면상태.보낸것.length;

  // ── 판정 — 기계 사실만. 발신 = **말풍선이 실제로 생겼다**(화면 상태 전이) ───
  const 사실 = {
    턴1_카드수: T1.카드들.length,
    턴1_발신: 보냄1 - 보냄0,
    턴2_카드수: T2.카드들.length,
    턴2_발신: 보냄2 - 보냄1,
    보낸말풍선: 화면상태.보낸것,
    관찰호출: 관찰수.n,
    행동호출: 행동기록.length,
  };
  판정 = {
    ok: 사실.턴1_카드수 >= 1 && 사실.턴1_발신 >= 1 && 사실.턴2_카드수 === 0 && 사실.턴2_발신 >= 1,
    사실,
  };

  await mkdir(OUT, { recursive: true });
  // **회차 원본은 덮지 않는다** — 처음 두 판이 같은 이름에 덮여 사라졌다(러너 결함 · 즉시 수리).
  // 시각이 파일명이다. 무효·빨강 판도 전량 남긴다(재실행 금지 규율의 러너면).
  const 기록이름 = `리허설기록-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  await writeFile(join(OUT, 기록이름), JSON.stringify({
    시각: new Date().toISOString(),
    productCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    모델: 연결.modelId,
    격리방: 방, 격리증명: 증명.결과,
    판정, 카드들: { 턴1: T1.카드들, 턴2: T2.카드들 },
    행동기록,
    턴응답요약: {
      턴1: T1.턴들.map((t) => ({ kind: t.kind, reply: String(t.reply ?? '').slice(0, 200) })),
      턴2: T2.턴들.map((t) => ({ kind: t.kind, reply: String(t.reply ?? '').slice(0, 200) })),
    },
    // **턴 전문** — 요약만 남겼다가 "무엇이 호출을 삼켰나"를 원본으로 못 가렸다(7판). 전량.
    턴전문: { 턴1: T1.턴들, 턴2: T2.턴들 },
  }, null, 2), 'utf8');

  console.error(`판정: ${판정.ok ? '초록' : '빨강'} — ${JSON.stringify(판정.사실)}`);
  // 프롬프트 덤프(모델이 받은 재료)를 방이 걷히기 전에 증거로 옮긴다.
  const { cp } = await import('node:fs/promises');
  await cp(join(방, 'prompt-dump'), join(OUT, 기록이름.replace('.json', '-prompts')), { recursive: true }).catch(() => {});
} finally {
  try { await new Promise((r) => server?.close(r)); } catch { /* 이미 닫혔으면 그만 */ }
  try { 리허설드라이버.close(); } catch { /* 없음 */ }
  // 방은 걷는다 — 기록은 OUT(저장소 evidence)에 이미 남았다.
  await rm(방, { recursive: true, force: true }).catch(() => {});
}
process.exit(판정.ok ? 0 : 1);
