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
  /**
   * **오너의 실크롬만 센다.** T5 브라우저 손이 켜는 헤드리스는 같은 실행파일이라
   * `pgrep -x "Google Chrome"` 로는 안 갈린다 — 실제로 T5 가 남긴 헤드리스 다섯이
   * 떠 있는데 「크롬 실행중」으로 읽혔다(2026-08-11 · 오너 지적으로 드러남).
   * 임시 프로필(`gpao-t5-browser`)·`--headless` 를 뺀 것만 실크롬이다.
   */
  async 실크롬떠있나() {
    try {
      const { stdout } = await run('ps', ['-Ao', 'command']);
      return stdout.split('\n').some((l) => l.includes('Google Chrome.app/Contents/MacOS/Google Chrome')
        && !l.includes('--headless') && !l.includes('gpao-t5-browser') && !l.includes('Helper'));
    } catch { return false; }
  },
  /** T5 가 남긴 헤드리스 잔재 수 — 회차마다 하나씩 새는지 본다. */
  async 헤드리스잔재() {
    try {
      const { stdout } = await run('ps', ['-Ao', 'command']);
      return stdout.split('\n').filter((l) => l.includes('gpao-t5-browser') && !l.includes('Helper')).length;
    } catch { return 0; }
  /** `file` 이 뭐라고 읽는가. 확장자가 아니라 **내용**이 판정한다 — 빈 파일에 이름만 붙는 것을 막는다. */
  async 무슨파일(경로) {
    if (!existsSync(경로)) return null;
    try { const { stdout } = await run('file', ['-b', 경로]); return stdout.trim(); } catch { return null; }
  },
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
    // ── **자를 두 번 고쳤다. 두 번째는 계측기 결함 수리다**(2026-08-11 · 이력을 남긴다) ──
    //
    // 1차(느슨): 「네이버 지목 + 아무거나 읽음」 → **첫 화면만 열어도 통과했다.**
    // 2차(조임): 「검색 걸음 + **그 뒤에** 읽기 걸음」 → 조였는데 **거짓 실패**를 만들었다.
    //   실측 회차 O3QoMu 가 `web.collect https://search.naver.com/...` **한 걸음으로**
    //   검색이자 읽기를 했는데, "뒤에"를 요구해서 ✕ 가 찍혔다. 한 걸음이 둘 다일 수 있다.
    //   그리고 `search.naver` 를 문자열로만 봐서 `www.naver.com/search.naver?...`
    //   (메인으로 리다이렉트된 **잘못된 주소**)도 검색으로 세었다.
    // 3차(지금): 조건을 **하나**로 세운다 — *"검색 결과를 실제로 읽은 성공한 걸음이 있는가."*
    //
    //   길 ㉮ 주소로 읽기   읽기손(browser.observe·web.collect·desktop.screen)의 인자에
    //                     **호스트가 `search.naver.com`** 인 주소가 있다.
    //                     호스트로 보는 이유가 위 실측이다 — 경로 문자열은 틀린 주소를 통과시킨다
    //   길 ㉯ 화면으로 읽기 실크롬 검색창에 질의어를 **넣은** 걸음(`desktop.act:type`) 뒤에
    //                     성공한 화면 읽기가 있다. 이 길에는 주소가 인자에 안 실린다
    // 손의 종류는 안 묻는다 — 브라우저 손이든 화면 손이든 사용자 목적은 같다
    // (2026-08-11 PM 오류의 교훈).
    //
    // **못 재는 것을 적어 둔다**: 읽은 페이지의 실제 내용·최종 주소는 영수증에서 가려져
    // (`[민감정보]`) 여기서 볼 수 없다. 그래서 이 자는 *"검색 결과 주소를 읽었다"* 까지만
    // 말하고 *"답이 그 결과에 근거한다"* 는 말하지 않는다.
    칸: '칸4 자력완결', 문장: '네이버 열어서 전세사기 검색 결과 알려줘.',
    async 판정(회차) {
      const 손들 = 회차?.손기록 ?? [];
      const 성공 = (x) => (x?.failureState ?? 'none') === 'none';
      const 글 = (x) => JSON.stringify(x?.args ?? {});
      const 읽기손 = ['browser.observe', 'web.collect', 'desktop.screen'];
      const 질의어 = /전세\s*사기|%EC%A0%84%EC%84%B8%EC%82%AC%EA%B8%B0/i;
      const 네이버열림 = 손들.some((x) => /naver/i.test(글(x)));
      // 검색 결과 **호스트**를 읽기손이 잡았는가.
      const 주소로읽음 = 손들.some((x) => 성공(x) && 읽기손.includes(x?.tool)
        && /\/\/search\.naver\.com[/"?]/i.test(글(x)));
      // **어느 손이든** 검색창에 치고 그 뒤에 읽었는가. 브라우저 손이 직접 치게 된 뒤로
      // 화면 손만 세면 거짓 실패가 난다(2026-08-11 실측).
      const 친번호 = 손들.findIndex((x) => 성공(x)
        && ['desktop.act', 'browser.act'].includes(x?.tool)
        && ['type', 'press', 'press_key'].includes(x?.args?.action) && 질의어.test(글(x)));
      const 친뒤읽음 = 친번호 >= 0 && 손들.slice(친번호 + 1)
        .some((x) => 성공(x) && [...읽기손, 'browser.act'].includes(x?.tool));
      const 결과읽음 = 주소로읽음 || 친뒤읽음;
      const [앞, 크롬, 잔재] = await Promise.all([
        기준자.앞창(), 기준자.실크롬떠있나(), 기준자.헤드리스잔재()]);
      return {
        사실: `네이버 지목=${네이버열림 ? 'O' : 'X'} · 결과주소읽음=${주소로읽음 ? 'O' : 'X'}`
          + ` · 쳐서읽음=${친뒤읽음 ? 'O' : 'X'} · 앞창=${앞}`
          + ` | 실크롬=${크롬 ? 'O' : 'X'} · T5 헤드리스 잔재 ${잔재}개`,
        통과: 네이버열림 && 결과읽음,
      };
    },
  },
  {
    // **A 층 문장이지만 여기서 잰다** — 7과목 하네스는 화면·브라우저 손이 서면 시험을 거부하고,
    // 이 회차는 그 손들을 켜 놓고 돈다. 판정은 기계 사실 하나다: 그 자리에 파일이 실재하고
    // `file` 이 내용으로 엑셀이라고 읽는가. 확장자만 맞는 빈 파일은 통과가 아니다.
    // 고정물: 러너가 임시 방을 만들고 `GPAO_T5_FILE_ROOTS` 로 물린다(아래 `방만들기`).
    칸: '칸5 생성', 문장: '이 폴더에 8월_정산.xlsx 로 표 하나 만들어줘.',
    async 판정(회차) {
      const 자리 = join(회차?.파일방 ?? '', '8월_정산.xlsx');
      const 무엇 = await 기준자.무슨파일(자리);
      return {
        사실: 무엇 ? `file="${무엇}"` : `그 자리에 파일이 없다(${회차?.파일방})`,
        통과: Boolean(무엇 && /Microsoft Excel/i.test(무엇)),
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
async function 한문장(base, cookie, 항목, 파일방, 카드상한 = 4) {
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
  const 판정 = await 항목.판정({ 손기록, 답: 결과?.reply ?? '', 파일방 });
  // **손기록 원본도 남긴다.** 조인 자가 왜 그렇게 판정했는지는 걸음의 인자를 봐야 안다.
  return { 칸: 항목.칸, 문장: 항목.문장, 카드, 걸린, 손, ...판정, 답: (결과?.reply ?? '').slice(0, 200), 손기록 };
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
    for (const 항목 of 목록) 줄들.push(await 한문장(base, cookie, 항목, join(방, 'files')));
    await writeFile(join(방, '회차.json'), JSON.stringify({ 방, 줄들 }, null, 2), 'utf8');
    return { 방, 줄들 };
  } finally {
    await new Promise((ok) => server.close(ok));
  }
}

/**
 * `--only=<조각>` — 문장표에서 그 조각을 칸이나 문장에 담은 줄만 돌린다.
 * **문장을 새로 짓는 문이 아니다**(즉흥 문장 금지 · §9). 동결된 표에서 고르기만 한다.
 * 아무것도 안 걸리면 **조용히 전부 돌리지 않는다** — 0줄 회차를 통과로 읽지 않게 멈춘다.
 */
export function 고르기(목록, only) {
  const 조각 = String(only ?? '').trim();
  if (!조각) return 목록;
  return 목록.filter((x) => x.칸.includes(조각) || x.문장.includes(조각));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const only = (process.argv.slice(2).find((a) => a.startsWith('--only=')) ?? '').slice('--only='.length);
  const 목록 = 고르기(문장표, only);
  if (!목록.length) {
    console.error(`--only=${only} 에 걸리는 문장이 없다. 문장표: ${문장표.map((x) => x.칸).join(' · ')}`);
    process.exit(2);
  }
  const { 방, 줄들 } = await 실기기회차({ 목록 });
  console.log(표(줄들));
  console.log(`\n회차 원본: ${방}/회차.json`);
  process.exit(줄들.some((r) => r.통과 === false) ? 1 : 0);
}
