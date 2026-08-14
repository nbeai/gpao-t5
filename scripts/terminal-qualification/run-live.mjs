// **라이브 5회 러너.** — `node scripts/terminal-qualification/run-live.mjs`
//
// 오너가 확정한 「라이브 5회 규격」을 실제로 돌린다. 5회는 **서로 다른 모양**이고(→ tasks.mjs),
// 회차마다 **같은 자 다섯**을 잰다(→ measure.mjs), 재료는 **한 채**다(→ fixture.mjs).
//
// ── 무엇이 진짜인가 ────────────────────────────────────────────────────────
//   진짜: T5 서버 전체 · 실모델 · 손 · 권한 판정 · 파일 시스템 · 원장 · 표면 HTTP
//   대본: 사용자 발화만. **회차 시작 전에 분기까지 동결돼 있다**(tasks.mjs) — T5 답을 보고
//         발화를 짓지 않는다. 짓는 순간 성공하는 쪽으로 유도하게 된다.
//
// ── 오너 파일 접촉 0 ───────────────────────────────────────────────────────
//   회차마다 새 임시 방을 파고 `HOME` 까지 그 안으로 옮긴다(정본 §9-1 — 터미널이 끼는 판이라
//   홈을 안 옮기면 오너의 실제 홈이 셸 안에서 그대로 보인다). 오너의 실제 홈은 이 러너의
//   어느 경로에도 안 나온다. 자격은 `scripts/s1/run.mjs` 의 `저장된연결` 로만 읽고 **찍지 않는다.**
//
// ── PM 용 스위치 ───────────────────────────────────────────────────────────
//   T5_LIVE_TASKS=1,2,3,4,5     돌릴 과업(기본 전부)
//   T5_LIVE_MODEL_ID=gpt-5.1    저장된 연결의 모델을 덮어쓴다(비교용)
//   T5_LIVE_TURN_TIMEOUT_MS     발화 하나의 상한(기본 10분)
//   T5_LIVE_KEEP=1              임시 방을 안 지운다(사후 조사용)
//   --재료만                     **모델을 안 부른다.** 방을 펼쳐 보여 주고 과업 문장만 찍는다
import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../../src/surface/server.js';
import { 저장된연결 } from '../s1/run.mjs';
import { 방펼치기, 사진, 사진대조, 새파일읽기, 재료, 방이름 } from './fixture.mjs';
import { 과업들, 과업찾기 } from './tasks.mjs';
import { 채점, 측정가능한가, 영수증정리, 거르개 } from './measure.mjs';

const 로그 = (...a) => console.log(...a);
const 발화상한ms = Number(process.env.T5_LIVE_TURN_TIMEOUT_MS ?? 10 * 60 * 1000);
const 승인상한 = 8;

// **저장소 자리에서 묻는다.** cwd 에서 물으면 어디서 켰는지에 따라 조용히 null 이 된다
// (실측: 임시 방에서 부르면 `not a git repository`). 회차가 어느 코드에서 나왔는지는
// 증거의 뼈라서 빠지면 안 된다.
const 저장소 = join(import.meta.dirname, '../..');
function 지금HEAD() {
  try { return execFileSync('git', ['-C', 저장소, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return null; }
}

/** 한 회차. **여기서는 판정하지 않는다** — 사실만 모아 채점자에게 넘긴다. */
export async function 회차돌리기({ 과업, 연결 }) {
  const 방 = await 방펼치기();
  const 앞사진 = await 사진(방.작업);
  const 원래HOME = process.env.HOME;
  const processEnv = {
    HOME: 방.홈,
    GPAO_T5_HOME: 방.홈,
    GPAO_T5_DATA_DIR: 방.상태,
    GPAO_T5_FILE_ROOTS: 방.작업,
    GPAO_T5_TCELL: 'off',              // 학습 축은 이 시험의 변수가 아니다
    GPAO_T5_NO_AUTO_SCREEN_BIN: '1',   // 화면 드라이버 끔 — 지금 재는 것은 화면 손이 아니다
    GPAO_T5_CUA_BIN: '',
    GPAO_T5_MODEL_PROVIDER: 연결.provider ?? 'openai',
    OPENAI_API_KEY: 연결.자격,
    GPAO_T5_MODEL_BASE_URL: 연결.상류 ?? 'https://api.openai.com/v1',
    GPAO_T5_MODEL_ID: process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1',
  };

  const 턴들 = [];
  let 하네스오류 = null;
  let 세션id = null;
  let server = null;
  const 시작 = Date.now();
  process.env.HOME = 방.홈;
  try {
    server = await startLiveServer({ port: 0, processEnv });
    const 주소 = `http://127.0.0.1:${server.address().port}`;
    const 첫화면 = await fetch(`${주소}/`);
    const 신분 = (첫화면.headers.get('set-cookie') ?? '').split(';')[0];
    const 부르기 = async (경로, 몸) => {
      const r = await fetch(`${주소}${경로}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(신분 ? { cookie: 신분 } : {}) },
        body: JSON.stringify(몸 ?? {}),
        signal: AbortSignal.timeout(발화상한ms),
      });
      const 글 = await r.text();
      try { return JSON.parse(글); } catch { throw new Error(`표면이 JSON 이 아니다(${r.status}): ${글.slice(0, 200)}`); }
    };

    세션id = (await 부르기('/sessions', {})).id;
    const 대본 = 과업.대본 ?? [];
    let 발화 = 과업.발화[0];
    let 갈래 = null;

    for (let 차례 = 1; 발화; 차례 += 1) {
      let 답 = await 부르기('/turn', { sessionId: 세션id, text: 발화 });
      턴들.push({ 차례, 발화, 갈래, kind: 답?.kind ?? null, reply: 답?.reply ?? null, question: 답?.question ?? null });
      // **승인 카드는 언제나 승인한다.** 승인을 아끼면 "모델이 못 했다"가 아니라 "사용자가 안
      // 눌렀다"를 재게 된다. 승인 수는 예산이 아니라 축 ① 이 이미 재고 있는 **측정 대상**이다.
      for (let n = 0; 답?.kind === 'approval' && n < 승인상한; n += 1) {
        답 = await 부르기('/turn', { sessionId: 세션id, approve: 답.pendingId });
        턴들.push({ 차례, 발화: '(승인)', 갈래: null, kind: 답?.kind ?? null, reply: 답?.reply ?? null, question: 답?.question ?? null });
      }
      // **싱글턴은 되묻기에 답하지 않는다.** 답하면 시험이 바뀐다 — 되물었다는 사실 자체가 비용이다.
      if (답?.kind === 'clarify' && !대본.length) break;

      const 다음 = 대본[차례 - 1];
      if (!다음) break;
      const 지금사진 = await 사진(방.작업);
      const 고른것 = 다음.분기({
        새로생김: 사진대조(앞사진, 지금사진).새로생김,
        마지막답: String([...턴들].reverse().find((t) => t.reply)?.reply ?? ''),
      });
      발화 = 고른것.발화;
      갈래 = 고른것.갈래;
      턴들.push({ 차례: `${차례}→${차례 + 1}`, 분기조건: 다음.조건설명, 고른갈래: 고른것.갈래, 고른발화: 고른것.발화 });
      if (!발화) break;
    }
  } catch (e) {
    하네스오류 = e?.name === 'TimeoutError' ? `발화 상한 ${발화상한ms}ms 초과` : (e?.message ?? String(e));
  } finally {
    if (server) await new Promise((r) => server.close(r));
    if (원래HOME === undefined) delete process.env.HOME; else process.env.HOME = 원래HOME;
  }

  const 뒤사진 = await 사진(방.작업);
  const 대조 = 사진대조(앞사진, 뒤사진);
  const 새파일내용 = await 새파일읽기(방.작업, 대조.새로생김);
  let 원장 = [];
  try {
    원장 = JSON.parse(await readFile(join(방.상태, `${세션id}.json`), 'utf8')).ledgerEntries ?? [];
  } catch { /* 세션이 안 섰으면 원장도 없다 — 아래에서 미측정으로 잡힌다 */ }
  const 영수증 = 영수증정리(원장);

  const 실제턴들 = 턴들.filter((t) => t.kind);
  const 사실 = {
    마지막답: String([...실제턴들].reverse().find((t) => t.reply)?.reply ?? ''),
    영수증,
    터미널영수증: 영수증.filter((r) => r.tool === 'local.terminal'),
    새로생김: 대조.새로생김,
    새파일내용,
  };
  const 측정 = 측정가능한가({
    과업,
    하네스오류,
    답한턴수: 실제턴들.filter((t) => t.kind === 'reply' || t.kind === 'clarify').length,
    사실,
  });
  const 점수 = 채점({ 과업, 턴들: 실제턴들, 영수증, 대조, 새파일내용 });

  const 회차 = {
    schemaVersion: 1,
    과업: { 번호: 과업.번호, 이름: 과업.이름, 모양: 과업.모양, 발화: 과업.발화[0] },
    모델: { provider: 연결.provider, modelId: processEnv.GPAO_T5_MODEL_ID },
    sourceHead: 지금HEAD(),
    시각: new Date(시작).toISOString(),
    걸린ms: Date.now() - 시작,
    하네스오류,
    측정,
    // **미측정이면 점수를 안 적는다.** 관측값은 참고로 남기되 「빵점」과 섞지 않는다.
    채점: 측정.측정됨 ? 점수 : null,
    미측정관측: 측정.측정됨 ? null : 점수,
    턴들,
    영수증,
    파일변화: { ...대조, 새파일내용 },
    // **원장 원문을 보존한다.** 요약은 언제나 가설을 지우는 방향으로 기운다 — 원본이 있어야
    // 나중에 다른 질문을 던질 수 있다. 저장 직전에 자리·자격을 거른다.
    원장원문: 원장,
  };
  // 방 경로는 **저장하는 JSON 에 안 싣는다** — 거기 실으면 거르개가 `<방>` 으로 지워 버려
  // 쓸모가 없고, 안 지우면 절대경로가 저장소에 남는다. 남긴 방은 화면으로만 알린다.
  if (process.env.T5_LIVE_KEEP !== '1') await rm(방.뿌리, { recursive: true, force: true });
  return { 회차, 방 };
}

// ── 본체 ───────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const 고른번호 = String(process.env.T5_LIVE_TASKS ?? '1,2,3,4,5').split(',').map((s) => s.trim()).filter(Boolean);
  const 돌릴것 = 고른번호.map((n) => 과업찾기(n)).filter(Boolean);
  if (!돌릴것.length) { console.error('돌릴 과업이 없다 — T5_LIVE_TASKS 를 확인해라.'); process.exit(2); }

  if (process.argv.includes('--재료만')) {
    // **모델을 안 부른다. 그래서 돈이 들지 않는다.** PM 이 돌리기 전에 방과 문장을 눈으로 본다.
    const 방 = await 방펼치기();
    로그(`\n방 → ${방.뿌리}`);
    로그(`  HOME=${방.홈}\n  GPAO_T5_FILE_ROOTS=${방.작업}\n  GPAO_T5_DATA_DIR=${방.상태}`);
    로그(`\n재료 ${Object.keys(재료).length}개 (${방이름}/ 아래)`);
    for (const 상대 of Object.keys(재료)) 로그(`  ${상대}`);
    로그('\n과업');
    for (const t of 돌릴것) {
      로그(`\n  ${t.번호} · ${t.이름} · ${t.모양}${t.실물필요 ? ' · 실물 요구' : ''}`);
      로그(`     1턴  "${t.발화[0]}"`);
      for (const s of t.대본 ?? []) 로그(`     ${s.턴}턴  분기[${s.조건설명}]`);
    }
    if (process.env.T5_LIVE_KEEP !== '1') await rm(방.뿌리, { recursive: true, force: true });
    로그('\n모델을 부르지 않았다.');
    process.exit(0);
  }

  const 연결 = 저장된연결(homedir());
  if (!연결?.자격) {
    console.error('저장된 모델 연결이 없다. 오너가 T5 화면에서 연결한 뒤 다시 돌린다.');
    process.exit(2);
  }
  const 모델id = process.env.T5_LIVE_MODEL_ID ?? 연결.modelId ?? 'gpt-5.1';
  로그(`\n라이브 5회 · 모델 ${연결.provider}/${모델id} · 과업 ${돌릴것.map((t) => t.번호).join(',')}`);
  로그('오너 파일 접촉 0 — 회차마다 새 임시 방을 파고 HOME 까지 그 안으로 옮긴다.\n');

  const 저장자리 = join(저장소, 'docs/03-verification/evidence',
    `live5-${new Date().toISOString().slice(0, 10)}`,
    `run-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`);
  await mkdir(저장자리, { recursive: true });

  const 요약 = [];
  for (const 과업 of 돌릴것) {
    로그(`── 과업 ${과업.번호} · ${과업.이름} · ${과업.모양} ───────────────────`);
    const { 회차, 방 } = await 회차돌리기({ 과업, 연결 });
    const 거르기 = 거르개({
      // 긴 자리부터 지운다 — 홈을 먼저 지우면 방 경로 안의 홈 조각이 반쪽으로 남는다.
      자리들: [[방.뿌리, '<방>'], [저장소, '<저장소>'], [homedir(), '<사용자홈>']],
      자격들: [연결.자격].filter(Boolean),
    });
    await writeFile(join(저장자리, `과업${과업.번호}-${과업.이름}.json`), JSON.stringify(거르기(회차), null, 2), 'utf8');

    if (!회차.측정.측정됨) 로그(`  ⊘ 미측정 — ${회차.측정.이유}`);
    else {
      로그(`  멈춘칸 ${회차.채점.멈춘칸} · 개입 ${회차.채점.개입.합}(승인${회차.채점.개입.승인카드}·되묻기${회차.채점.개입.되묻기}·유도${회차.채점.개입.유도갈래}·떠넘김${회차.채점.개입.떠넘김의심})`);
      로그(`  실물 ${회차.채점.실물.새로생김.length}건 · 원본불변 ${회차.채점.원본불변.지켜졌나 ? '지켜짐' : '깨짐'} · 자리고지 ${회차.채점.자리고지.알렸나 ? '했다' : '안했다'}`);
      로그(`  사다리 ${회차.채점.사다리.map((c) => `${c.이름}:${c.상태}`).join(' → ')}`);
    }
    로그(`  ${(회차.걸린ms / 1000).toFixed(1)}초 · 영수증 ${회차.영수증.length}건${회차.하네스오류 ? ` · 하네스오류 ${회차.하네스오류}` : ''}`);
    if (process.env.T5_LIVE_KEEP === '1') 로그(`  방 남김 → ${방.뿌리}`);
    로그('');
    요약.push({
      과업: 과업.번호, 이름: 과업.이름, 모양: 과업.모양,
      측정됨: 회차.측정.측정됨, 미측정이유: 회차.측정.이유,
      멈춘칸: 회차.채점?.멈춘칸 ?? null,
      개입: 회차.채점?.개입.합 ?? null,
      실물: 회차.채점?.실물.생겼나 ?? null,
      원본불변: 회차.채점?.원본불변.지켜졌나 ?? null,
      자리고지: 회차.채점?.자리고지.알렸나 ?? null,
      완료: 회차.채점?.완료 ?? null,
      걸린ms: 회차.걸린ms,
    });
  }

  await writeFile(join(저장자리, '요약.json'), JSON.stringify({
    schemaVersion: 1, 시각: new Date().toISOString(), sourceHead: 지금HEAD(),
    모델: { provider: 연결.provider, modelId: 모델id },
    // 미측정은 **분모에서 뺀다.** 빵점과 섞으면 없는 결함이 생긴다.
    셈: {
      돌린회차: 요약.length,
      측정됨: 요약.filter((r) => r.측정됨).length,
      미측정: 요약.filter((r) => !r.측정됨).length,
      완료: 요약.filter((r) => r.완료 === true).length,
    },
    회차: 요약,
  }, null, 2), 'utf8');
  로그(`증거 → ${저장자리}`);
  로그(`측정 ${요약.filter((r) => r.측정됨).length} · 미측정 ${요약.filter((r) => !r.측정됨).length} · 완료 ${요약.filter((r) => r.완료 === true).length}`);
}
