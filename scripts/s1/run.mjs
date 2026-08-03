// **S1 A/B 러너** — `node scripts/s1/run.mjs`
//
// 동결 정본: `design/S1-EXPERIMENT-FREEZE-2026-08-04-ko.md` (실행 전 동결, 오너 승인)
//
// 재는 것 하나: **주객을 되돌리면 모델이 목적을 끝내는가.**
// 사고 원문 그대로의 한 문장을 437개 fixture 앞에 놓고, 플래그 하나만 다른 두 팔에서
// 각각 세 번 돌린다. 판정은 문구가 아니라 **파일이 실제로 어떻게 됐는가**와 원장·와이어다.
//
// ── 무엇이 진짜인가 ────────────────────────────────────────────────────────
//   진짜: T5 서버 전체 · 실모델(gpt-5.1) · 손 · 권한 판정 · 파일 시스템 · 원장 · 표면 HTTP
//   가짜: 없다. 사용자 개입만 대본이다("응, 그렇게 해줘" 한 번, 그 외 0 — 동결 §6).
//
// ── 오너 파일 접촉 0 ───────────────────────────────────────────────────────
//   회차마다 새 HOME 을 만들고 그 안의 `Downloads` 에 fixture 를 생성한다. 파일 뿌리도
//   거기 하나뿐이다. 실제 오너 다운로드 폴더는 이 러너의 어느 경로에도 나오지 않는다.
import { mkdtemp, mkdir, rm, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startLiveServer } from '../../src/surface/server.js';
import { makeFixture, 대조 } from './make-fixture.mjs';
import { preflight } from './preflight.mjs';
import { 도청기띄우기, 고른도구, 낸글, 쓴토큰 } from './wire-tap.mjs';

// ── 동결값 (§4 · §6) ───────────────────────────────────────────────────────
export const 순서 = ['A', 'B', 'B', 'A', 'A', 'B'];
export const 문장 = '내 다운로드 폴더 깔끔하게 정리 좀 하고 싶다.';
export const 후속 = '응, 그렇게 해줘.';
export const 회차상한ms = 15 * 60 * 1000;
const 모델id = 'gpt-5.1';

const sha = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const 로그 = (...a) => console.log(...a);

/** 오너의 저장된 연결에서 자격을 꺼낸다. **값은 어디에도 찍지 않는다.** */
export function 저장된연결(home = homedir()) {
  const p = join(home, '.local/state/gpao-t5/sessions/model-connection.json');
  if (!existsSync(p)) return null;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  const c = (j.connections ?? []).find((x) => x.id === j.activeId) ?? j.connections?.[0];
  if (!c?.key) return null;
  return { provider: c.provider, 자격: c.key, modelId: c.modelId ?? 모델id, 상류: c.baseUrl };
}

// ── 호출별 전이 판정 (§5.1.1 · §5.3) ───────────────────────────────────────
/** 호출지문 — 같은 손·같은 action·의미상 같은 인자인가. */
export function 호출지문(고름) {
  const a = 고름?.args ?? {};
  const 뼈 = { tool: 고름?.name, action: a.action ?? a.op ?? null };
  // 인자는 **의미상 같음**을 본다: 값의 순서·공백은 지우고, 값 자체는 남긴다.
  const 값 = Object.entries(a).filter(([k]) => k !== 'action' && k !== 'op')
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v.trim() : JSON.stringify(v)}`)
    .sort().join('|');
  return `${뼈.tool}#${뼈.action ?? '-'}#${값}`;
}

/**
 * 직전 호출 대비 이번 호출의 전이(§5.1.1). **첫 호출은 `최초`** — 폴더를 보는 것은 정상 순서다.
 * @param {string|null} 앞지문
 * @param {string} 이번지문
 * @param {boolean} 앞이부분결과  직전 결과가 잘렸거나 불완전했는가
 */
export function 전이판정(앞지문, 이번지문, 앞이부분결과) {
  if (!앞지문) return '최초';
  if (앞지문 !== 이번지문) return '전략전환';
  // 같은 지문이 다시 왔다. 직전이 부분 결과였다면 같은 부분 결과를 또 받는 것이다.
  return 앞이부분결과 ? '무진전반복' : '같은호출반복';
}

/** 도구 결과가 **잘렸는가**. task-context 가 다는 정직 표식을 그대로 읽는다. */
export function 잘림사실(글) {
  const t = String(글 ?? '');
  // 원문(`task-context.js`)에 강조 표식이 붙는다: `**나머지 414개는 … 못했다**(전체 437개).`
  const m = t.match(/나머지 (\d+)개는 이 답에 이름을 싣지 못했다\*{0,2}\(전체 (\d+)개\)/);
  if (m) return { 잘림: true, 전달: Number(m[2]) - Number(m[1]), 전체: Number(m[2]) };
  if (/생략\)/.test(t)) return { 잘림: true, 전달: null, 전체: null };
  return { 잘림: false };
}

// ── 회차 하나 ──────────────────────────────────────────────────────────────
export async function 회차돌리기({ n, 팔, 연결 }) {
  const 뿌리 = await mkdtemp(join(tmpdir(), `s1-r${n}-${팔}-`));
  const 홈 = join(뿌리, 'home');
  const 상태 = join(뿌리, 'state');
  const 다운로드 = join(홈, 'Downloads');
  await mkdir(홈, { recursive: true });
  await mkdir(상태, { recursive: true });
  const { manifest } = makeFixture(다운로드);

  // §3 회차 독립성 — 시작 시점에 남은 것이 0인지 **확인하고 기록한다**(주장하지 않는다).
  const 시작잔여 = await readdir(상태).catch(() => []);

  // **플래그는 진짜 프로세스 env 에 세운다.** `심문허용()` 은 `process.env` 를 읽는다 —
  // `startLiveServer({processEnv})` 는 서버 배선용 사본이라 커널까지 가지 않는다.
  // 예행에서 이걸 놓쳐 B 팔이 A 와 똑같이 심문 1회를 돌렸다(실측 2026-08-04). 인자로도
  // 함께 넘긴다(나중에 배선이 이어지면 그쪽이 이긴다 — 두 자리가 갈리지 않게).
  const 원래플래그 = process.env.T5_MODEL_SOVEREIGN;
  if (팔 === 'B') process.env.T5_MODEL_SOVEREIGN = '1';
  else delete process.env.T5_MODEL_SOVEREIGN;

  const 도청 = await 도청기띄우기({ 상류: 연결.상류 ?? 'https://api.openai.com/v1', 자격: 연결.자격 });
  const server = await startLiveServer({
    port: 0,
    processEnv: {
      GPAO_T5_DATA_DIR: 상태,
      GPAO_T5_HOME: 홈,
      GPAO_T5_FILE_ROOTS: 다운로드,
      OPENAI_API_KEY: 연결.자격,
      GPAO_T5_MODEL_BASE_URL: 도청.baseUrl,
      GPAO_T5_MODEL_ID: 연결.modelId,
      GPAO_T5_TCELL: 'off', // 학습 축은 이 실험의 변수가 아니다(회차 독립성 §3)
      ...(팔 === 'B' ? { T5_MODEL_SOVEREIGN: '1' } : {}),
    },
  });
  const 주소 = `http://127.0.0.1:${server.address().port}`;

  const 첫화면 = await fetch(`${주소}/`);
  const 신분 = (첫화면.headers.get('set-cookie') ?? '').split(';')[0];
  const 부르기 = async (경로, 몸) => {
    const r = await fetch(`${주소}${경로}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(신분 ? { cookie: 신분 } : {}) },
      body: JSON.stringify(몸 ?? {}),
    });
    const 글 = await r.text();
    try { return JSON.parse(글); } catch { throw new Error(`표면이 JSON 이 아니다(${r.status}): ${글.slice(0, 160)}`); }
  };

  const 턴들 = [];
  const 시작 = Date.now();
  let 타임아웃 = false;
  let 후속씀 = false;
  let 승인수 = 0;
  try {
    const s = (await 부르기('/sessions')).id;
    let 답 = await 부르기('/turn', { sessionId: s, text: 문장 });
    턴들.push(답);

    // ── 사용자 규약 (동결 §6) — **두 팔이 글자 하나까지 같은 규약을 받는다** ────────
    //
    // 첫 판은 "모델이 확인을 물으면"을 답변 문구 정규식으로 판정했다. 1회차 A 는 승인
    // 카드로 개입을 썼고, 2회차 B 는 되묻는 답을 냈는데 정규식이 못 잡아 개입 0을 받았다
    // (실측 2026-08-04). **팔마다 다른 규약을 받으면 그건 A/B 가 아니다.** 그래서 문구
    // 판정을 없앤다.
    //
    //   · 승인 카드 → **언제나 승인한다.** 승인 수는 개입 예산이 아니라 §5.2 과정 ⑧ 이
    //     이미 재고 있는 **측정 대상**이다("사용자 질문·승인·클릭 수"). 승인을 아끼면
    //     "모델이 못 했다"가 아니라 "사용자가 안 눌렀다"를 재게 된다.
    //   · 그 밖의 답 → 회차당 **딱 한 번** "응, 그렇게 해줘."를 보낸다. 조건 없다.
    //     그 뒤로 조종 개입 0 — 모델이 스스로 이어가는지가 이 실험이 재는 것이다.
    while (Date.now() - 시작 < 회차상한ms) {
      if (답?.kind === 'approval') {
        승인수 += 1;
        답 = await 부르기('/turn', { sessionId: s, approve: 답.pendingId });
        턴들.push(답);
        continue;
      }
      if (!후속씀) {
        후속씀 = true;
        답 = await 부르기('/turn', { sessionId: s, text: 후속 });
        턴들.push(답);
        continue;
      }
      break;
    }
    if (Date.now() - 시작 >= 회차상한ms) 타임아웃 = true;
  } finally {
    await new Promise((r) => server.close(r));
    if (원래플래그 === undefined) delete process.env.T5_MODEL_SOVEREIGN;
    else process.env.T5_MODEL_SOVEREIGN = 원래플래그;
  }
  await 도청.close();

  // ── 실물 대조 (§5.2 결과 증거) ──────────────────────────────────────────
  const 실물 = 대조(manifest, 다운로드);

  // ── 와이어에서 과정 증거 (§5.2 · §5.3) ─────────────────────────────────
  const 호출표 = [];
  let 앞지문 = null;
  let 앞부분결과 = false;
  let 심문호출 = 0;
  let 토큰 = { 입력: 0, 출력: 0 };
  const 프롬프트지문 = [];
  const 스키마지문 = [];

  for (const 기 of 도청.기록) {
    if (!기.보낸것?.messages) continue;
    const 시스템 = 기.보낸것.messages.find((m) => m.role === 'system')?.content ?? '';
    프롬프트지문.push(sha(시스템));
    스키마지문.push(sha(JSON.stringify((기.보낸것.tools ?? []).map((t) => t.function))));
    const 쓴것 = 쓴토큰(기.받은것);
    if (쓴것) { 토큰.입력 += 쓴것.입력; 토큰.출력 += 쓴것.출력; }
    // 심문 호출의 기계 서명: `tool_choice` 로 판정 스키마 하나를 강제한 호출.
    const 강제 = 기.보낸것.tool_choice?.function?.name;
    if (강제 && /work_deliverable|current-action-scope|current_action_scope/.test(강제)) 심문호출 += 1;

    for (const 고름 of 고른도구(기.받은것)) {
      const 지문 = 호출지문(고름);
      호출표.push({
        n: 호출표.length + 1,
        tool: 고름.name,
        action: 고름.args?.action ?? null,
        args지문: 지문,
        요청강제: Boolean(강제),
        노출도구수: (기.보낸것.tools ?? []).length,
        전이: 전이판정(앞지문, 지문, 앞부분결과),
      });
      앞지문 = 지문;
    }
    // 다음 호출이 "부분 결과 뒤인가"를 알려면 이번에 **모델이 받은 도구 결과**를 봐야 한다.
    // 다음 요청의 exchange 본문에서 잘림 표식을 찾는다(그것이 모델이 실제로 본 것이다).
    const 마지막 = 기.보낸것.messages.at(-1);
    앞부분결과 = 잘림사실(typeof 마지막?.content === 'string' ? 마지막.content : JSON.stringify(마지막 ?? '')).잘림;
  }

  // §5.2 과정 ① — **한 호출의 사용자 블록 안에서 같은 발화가 두 번 실리는가.**
  // 이력에 앞 턴 발화가 남는 것은 정상이다(그게 대화다). 잡으려는 것은 task-context 가
  // 같은 문장을 자기 블록 안에서 다시 적어 모델이 두 번 요청받은 것처럼 읽는 자리다.
  const 발화횟수 = 도청.기록.filter((기) => 기.보낸것?.messages).map((기) => {
    const 사용자블록 = [...기.보낸것.messages].reverse().find((m) => m.role === 'user');
    const 글 = String(typeof 사용자블록?.content === 'string' ? 사용자블록.content : '');
    return Math.max(글.split(문장).length - 1, 글.split(후속).length - 1);
  });

  const 회차 = {
    n, 팔, 뿌리,
    시작: new Date(시작).toISOString(),
    걸린ms: Date.now() - 시작,
    타임아웃,
    승인수,                                    // §5.2 과정 ⑧ — 사용자가 눌러야 했던 횟수
    후속씀,                                    // 조종 개입(회차당 최대 1)
    턴종류: 턴들.map((t) => t?.kind ?? '?'),
    시작잔여: 시작잔여.length,
    모델: { provider: 연결.provider, modelId: 연결.modelId },
    실물,
    호출표,
    무진전반복: 호출표.filter((r) => r.전이 === '무진전반복' || r.전이 === '같은호출반복').length,
    심문호출,
    모델호출수: 도청.기록.filter((기) => 기.보낸것?.messages).length,
    토큰,
    // §1.1 이 요구하는 것은 **A/B 첫 턴이 같은가**다. 한 회차 안에서 호출마다 다른 것은
    // 정상이다(심문 호출은 다른 도구 하나만 쥐어준다) — 팔 사이를 대조하려면 첫 호출을 본다.
    첫프롬프트지문: 프롬프트지문[0] ?? null,
    첫스키마지문: 스키마지문[0] ?? null,
    프롬프트지문: [...new Set(프롬프트지문)],
    스키마지문: [...new Set(스키마지문)],
    발화중복: 발화횟수.filter((v) => v > 1).length,
    턴수: 턴들.length,
    // 답은 **자르지 않는다.** 1회차에서 2000자에서 잘려 마지막 문장을 못 봤고, 그래서
    // 되묻는 답인지 아닌지를 사후에 확인할 수 없었다(실측 2026-08-04).
    답들: 턴들.map((t) => String(t?.reply ?? '')),
  };
  return 회차;
}

// ── 본체 ───────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { 결과: 전검사, 통과 } = await preflight();
  로그('\nS1 preflight');
  for (const r of 전검사) 로그(`  ${r.통과 ? '✔' : '✖'} ${r.이름}\n      ${r.근거}`);
  if (!통과) { console.error('\npreflight 실패 — 회차를 열지 않는다.'); process.exit(1); }

  const 연결 = 저장된연결();
  if (!연결) { console.error('저장된 모델 연결이 없다. 오너가 T5 화면에서 연결한 뒤 다시 돌린다.'); process.exit(2); }
  if (연결.modelId !== 모델id) {
    console.error(`동결은 ${모델id} 인데 저장된 연결은 ${연결.modelId} 다 — 실행하지 않는다(§6).`);
    process.exit(2);
  }
  로그(`\n모델 ${연결.provider}/${연결.modelId} · 순서 ${순서.join('-')} · 회차당 상한 ${회차상한ms / 60000}분`);
  로그('오너 파일 접촉 0 — 회차마다 새 HOME 안 Downloads 에 437개를 생성한다.\n');

  // 회차는 서로 독립이므로(§3) 나눠 돌려도 된다. **순서는 인덱스로 지킨다** — 이어 돌릴 때
  // 앞에서부터 다시 세면 A-B-B-A-A-B 가 무너진다.
  const 회차들 = [];
  const 처음 = Number(process.env.S1_FROM ?? 1) - 1;
  const 끝 = Math.min(처음 + Number(process.env.S1_ROUNDS ?? 순서.length), 순서.length);
  for (let i = 처음; i < 끝; i += 1) {
    const 팔 = 순서[i];
    로그(`── 회차 ${i + 1} · 팔 ${팔} ────────────────────────────────`);
    const r = await 회차돌리기({ n: i + 1, 팔, 연결 });
    회차들.push(r);
    로그(`  이동 ${r.실물.이동} · 이동불명 ${r.실물.이동불명} · 손상 ${r.실물.손상} · 사라짐 ${r.실물.사라짐} · 새로생김 ${r.실물.새로생김}`);
    로그(`  모델호출 ${r.모델호출수} · 심문 ${r.심문호출} · 도구선택 ${r.호출표.length} · 무진전반복 ${r.무진전반복}`);
    로그(`  턴 ${r.턴수}(${r.턴종류.join(',')}) · 승인 ${r.승인수} · 후속 ${r.후속씀 ? 1 : 0} · ${(r.걸린ms / 1000).toFixed(1)}초 · 토큰 입력${r.토큰.입력}/출력${r.토큰.출력}${r.타임아웃 ? ' · 타임아웃' : ''}`);
    await rm(r.뿌리, { recursive: true, force: true });
  }

  const 자리 = join(process.cwd(), "design", `S1-RESULT-${new Date().toISOString().slice(0, 10)}-r${처음 + 1}-${끝}.json`);
  await writeFile(자리, JSON.stringify({ 순서, 문장, 회차: 회차들 }, null, 2), 'utf8');
  로그(`\n회차 장부 → ${자리}`);
}
