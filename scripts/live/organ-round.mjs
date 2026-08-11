// 실기기 층 자동 채점기 — **화면·브라우저 손을 켜 놓고** 닫는 문장을 그대로 돌린다.
//
// 왜 따로 있나: 7과목 하네스(`human-use/living-sim-runner.mjs`)는 `EXTERNAL_EFFECT_HANDS`
// (`desktop.act`·`browser.act`·발신 셋)가 **쓸 수 있으면 시험을 거부한다** — 밖으로 나가는
// 손이라 시험 방에 가둘 수 없어서다. 그래서 화면 층은 늘 사람이 손으로 한 번 돌려보고 끝났고,
// 결과가 대화 속에 흩어져 **기억과 산문으로 다투게 됐다**(2026-08-11 실측: 문서 45커밋 / 라이브 2턴).
//
// 이 러너의 규율 셋
//   ① 채점을 **모델 말로 하지 않는다.** 문장마다 **독립 기준자**(osascript·파일시스템)를 따로 둔다.
//      T5 가 낸 영수증은 참고로만 적고, 판정은 기준자가 한다.
//   ② **승인 카드 = 사용자 손 1회.** 카드가 뜨면 세고, 승인해서 나머지를 계속 잰다.
//      「사용자 손 0회」가 닫는 문장이므로 카드 수가 곧 성적이다.
//   ③ 못 잰 것을 0 으로 적지 않는다. 기준자가 답을 못 내면 `계측불가` 로 적는다.
//
// 격리: 상태 자리와 파일 뿌리만 임시 방으로 돌린다. **HOME 은 실제 것을 쓴다** —
// HOME 을 격리하면 화면 드라이버가 죽어 `blocked` 가 나고, 그건 제품 실패가 아니라
// 하네스가 만든 거짓 실패다(2026-08-11 실측).
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const 저장소 = resolve(new URL('../..', import.meta.url).pathname);

/** 독립 기준자 — T5 드라이버를 안 쓴다. 이게 이 러너의 전부다. */
const 기준자 = {
  async 앞창() {
    try {
      const { stdout } = await run('osascript', ['-e',
        'tell application "System Events" to get name of first application process whose frontmost is true']);
      return stdout.trim();
    } catch { return null; }
  },
  async 크롬주소() {
    try {
      const { stdout } = await run('osascript', ['-e',
        'tell application "Google Chrome" to get URL of active tab of front window']);
      return stdout.trim();
    } catch { return null; }
  },
  파일있나(경로) { return existsSync(경로); },
};

/**
 * 동결 문장표. **여기 없는 문장은 안 잰다** — 즉흥으로 시키지 않는다(2026-08-11 PM 오류).
 * `기대` 는 기준자가 판정할 수 있는 형태여야 한다. 아니면 그 줄은 `계측불가` 다.
 */
export const 문장표 = Object.freeze([
  {
    칸: '창 전환', 문장: '카카오톡 창을 앞으로 띄워줘.',
    async 판정() { const a = await 기준자.앞창(); return { 사실: a, 통과: a === 'KakaoTalk' }; },
  },
  {
    칸: '창 전환', 문장: '크롬 창을 앞으로 띄워줘.',
    async 판정() { const a = await 기준자.앞창(); return { 사실: a, 통과: a === 'Google Chrome' }; },
  },
  {
    // **판정을 실크롬 주소로 잡았다가 틀렸다**(2026-08-11 · PM 오류). T5 브라우저 손은
    // 자기 임시 헤드리스 프로필을 몬다 — 그 손으로 몇 걸음을 걷든 실크롬 주소는 안 변한다.
    // 그런데 사용자 문장은 *"검색 결과 알려줘"* 이지 *"실크롬에서 해라"* 가 아니다.
    // 자가 구조적으로 통과 불가였고, 되는 것을 실패로 찍었다.
    //
    // 그래서 **영수증으로 판정한다** — 어느 손이든 네이버를 실제로 열고 읽었으면 통과다.
    // 손의 종류는 안 묻는다(브라우저 손이든 화면 손이든 사용자 목적은 같다).
    // **자가 느슨했다**(오너 지적 2026-08-11). 위 판정은 「네이버를 지목했고 무언가 읽었다」만
    // 물어서, **첫 화면만 열고 검색은 안 한 회차가 통과했다.** 사용자 문장은
    // *"전세사기 **검색 결과** 알려줘"* 다 — 물어야 할 것은 **검색이 실제로 일어났는가**이고,
    // 그것은 문구가 아니라 기계로 가릴 수 있다.
    //
    // 조인 자 셋(전부 손기록의 기계 사실 · 모델 문장은 안 본다):
    //   ① 네이버를 지목했다
    //   ② **검색이 일어났다** — 성공한 걸음의 인자에 `search.naver`(검색 결과 주소)가 있거나,
    //      질의어를 실제로 **넣은/보낸** 걸음(type·검색 질의)이 있다
    //   ③ ② **뒤에** 성공한 읽기 걸음이 있다 — 결과를 읽지 않으면 "알려줘"가 안 닫힌다
    // ②를 주소 하나로만 잡지 않는 이유: T5 손이 실크롬을 몰든 자기 브라우저를 몰든
    // 사용자 목적은 같다(손의 종류는 안 묻는다 · 2026-08-11 PM 오류의 교훈).
    칸: '칸4 자력완결', 문장: '네이버 열어서 전세사기 검색 결과 알려줘.',
    async 판정(회차) {
      const 손들 = 회차?.손기록 ?? [];
      const 성공 = (x) => (x?.failureState ?? 'none') === 'none';
      const 글 = (x) => JSON.stringify(x?.args ?? {});
      const 네이버열림 = 손들.some((x) => /naver/i.test(글(x)));
      // ② 검색 자체. 주소로 잡히거나(결과 페이지) 질의어를 넣은 걸음으로 잡힌다.
      const 검색번호 = 손들.findIndex((x) => 성공(x) && (
        /search\.naver/i.test(글(x))
        || (/전세\s*사기/.test(글(x)) && ['desktop.act', 'browser.act', 'web.collect'].includes(x?.tool))
      ));
      // ③ 검색 뒤의 읽기.
      const 읽음 = 검색번호 >= 0 && 손들.slice(검색번호 + 1).some((x) => 성공(x)
        && ['browser.observe', 'web.collect', 'desktop.screen'].includes(x?.tool));
      const 앞 = await 기준자.앞창();
      return {
        사실: `네이버 지목=${네이버열림 ? 'O' : 'X'} · 검색함=${검색번호 >= 0 ? 'O' : 'X'}`
          + ` · 검색뒤읽음=${읽음 ? 'O' : 'X'} · 앞창=${앞}`,
        통과: 네이버열림 && 검색번호 >= 0 && 읽음,
      };
    },
  },
]);

async function 방만들기() {
  const 방 = await mkdtemp(join(tmpdir(), 't5-organ-'));
  await mkdir(join(방, 'state'), { recursive: true });
  await mkdir(join(방, 'files'), { recursive: true });
  const 자격 = join(homedir(), '.local/state/gpao-t5/sessions/model-connection.json');
  if (existsSync(자격)) await copyFile(자격, join(방, 'state/model-connection.json'));
  return 방;
}

async function 서버띄우기(방, port) {
  const { startLiveServer } = await import(join(저장소, 'src/surface/server.js'));
  const processEnv = {
    ...process.env,
    GPAO_T5_DATA_DIR: join(방, 'state'),
    GPAO_T5_FILE_ROOTS: join(방, 'files'),
  };
  const server = await startLiveServer({ port, processEnv, startScheduler: false });
  return server;
}

/** 한 문장을 끝까지 밟는다. 승인 카드는 세고 승인한다 — 카드 수가 곧 「사용자 손」이다. */
async function 한문장(base, cookie, 항목, 카드상한 = 4) {
  const post = async (body) => {
    const r = await fetch(`${base}/turn`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(body),
    });
    return r.json();
  };
  const s = await fetch(`${base}/sessions`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}',
  }).then((r) => r.json());

  const 시작 = Date.now();
  let 결과 = await post({ sessionId: s.id, text: 항목.문장 });
  let 카드 = 0;
  while (결과?.kind === 'approval' && 카드 < 카드상한) {
    카드 += 1;
    결과 = await post({ sessionId: s.id, approve: 결과.pendingId });
  }
  const 걸린 = Math.round((Date.now() - 시작) / 1000);
  const 손기록 = (결과?.turnExchange ?? []);
  const 손 = 손기록.map((x) => `${x.tool}${x.args?.action ? ':' + x.args.action : ''}`);
  await new Promise((ok) => setTimeout(ok, 1500));   // 창 관리자가 반영할 틈을 준다
  const 판정 = await 항목.판정({ 손기록, 답: 결과?.reply ?? '' });
  return { 칸: 항목.칸, 문장: 항목.문장, 카드, 걸린, 손, ...판정, 답: (결과?.reply ?? '').slice(0, 200) };
}

function 표(줄들) {
  const 기호 = (v) => (v === true ? '○' : v === false ? '✕' : '계측불가');
  const out = ['', '── 실기기 회차 ──────────────────────────────────────────────'];
  for (const r of 줄들) {
    out.push(`${기호(r.통과)}  [${r.칸}] ${r.문장}`);
    out.push(`     사용자 손 ${r.카드}회 · ${r.걸린}초 · 손: ${r.손.join(' ') || '없음'}`);
    out.push(`     기준자: ${r.사실 ?? '—'}`);
  }
  const 통과 = 줄들.filter((r) => r.통과 === true).length;
  const 손0 = 줄들.filter((r) => r.통과 === true && r.카드 === 0).length;
  out.push('──────────────────────────────────────────────────────────');
  out.push(`통과 ${통과}/${줄들.length} · **사용자 손 0회로 통과 ${손0}/${줄들.length}** · 계측불가 ${줄들.filter((r) => r.통과 === null).length}`);
  return out.join('\n');
}

export async function 실기기회차({ port = 0, 목록 = 문장표 } = {}) {
  const 방 = await 방만들기();
  const server = await 서버띄우기(방, port);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const cookie = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const 줄들 = [];
    for (const 항목 of 목록) 줄들.push(await 한문장(base, cookie, 항목));
    await writeFile(join(방, '회차.json'), JSON.stringify({ 방, 줄들 }, null, 2), 'utf8');
    return { 방, 줄들 };
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  // `--only=<조각>` — 한 문장만 돌린다(칸·문장 어디에 걸려도 된다). 유료 회차를 아끼는 자리다.
  // 동결 문장표에서 **고르기만** 한다 — 즉흥 문장은 여기로도 못 들어온다(§9).
  const 조각 = (process.argv.slice(2).find((a) => a.startsWith('--only=')) ?? '').slice(7).trim();
  const 목록 = 조각 ? 문장표.filter((x) => x.칸.includes(조각) || x.문장.includes(조각)) : 문장표;
  if (!목록.length) { console.error(`--only=${조각} 에 걸리는 문장이 문장표에 없다`); process.exit(2); }
  const { 방, 줄들 } = await 실기기회차({ 목록 });
  console.log(표(줄들));
  console.log(`\n회차 원본: ${방}/회차.json`);
  process.exit(줄들.some((r) => r.통과 === false) ? 1 : 0);
}
