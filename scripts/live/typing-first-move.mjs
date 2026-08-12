// ── 왜 이 대본이 저장소에 있나 (2026-08-12) ────────────────────────────────
//   이 수리(이음매 ① · 결재 ①)의 **라이브 증명 절반이 아직 안 닫혔다.** 검사는 9/9 초록이고
//   전체 회귀도 초록인데, 실기기에서 「첫 수 타이핑이 그 칸에 실제로 도착한다」를 못 봤다.
//   막힌 것은 제품이 아니라 **재는 자리**다: 에이전트 셸과 클로드코드 셸 둘 다 손쉬운 사용(AX)
//   권한이 없어 `count of windows` 가 모든 앱에서 0 으로 나온다(오류가 아니라 빈 값이라
//   그대로 쓰면 「효과 없음」을 지어내게 된다). 그래서 그 축을 `계측불가` 로 남겼다.
//
//   **오너 터미널에서는 AX 가 산다.** 거기서 이 한 줄이면 남은 절반이 닫힌다:
//       node scripts/live/typing-first-move.mjs
//   찍히는 것: 사용자 손(승인 카드) 횟수 · 그 칸에 실제로 들어간 글자 · T5 가 부른 손.
//   기대값은 **카드 0회 + 그 칸에 "전세사기" 도착**이다.
// ───────────────────────────────────────────────────────────────────────────
//
// **결재 ① 실기기 회차** — 첫 수 타이핑에 승인 카드가 안 뜨는 것을 실기기에서 보인다.
//
// `organ-round.mjs` 의 규율을 그대로 쓴다(그 러너의 `실기기회차` 를 그대로 부른다):
//   ① 채점을 **모델 말로 하지 않는다** — 독립 기준자가 판정한다.
//   ② **승인 카드 = 사용자 손 1회.** 러너가 HTTP `/turn` 응답의 `kind:'approval'` 을 센다.
//      이건 영수증이 아니라 **사용자 화면에 카드를 띄우는 바로 그 응답**이다.
//   ③ 못 잰 것을 0 으로 적지 않는다.
//
// ── 독립 기준자를 왜 새로 세웠나 ──────────────────────────────────────────
// `organ-round.mjs` 의 기준자는 osascript AX(`System Events → process → window`)를 쓴다.
// **이 에이전트 셸의 osascript 에는 손쉬운 사용 권한이 없다** — 오류가 아니라 **빈 값**을
// 돌려준다(모든 앱에 `count of windows` = 0. 오너 터미널에서는 된다). 그걸 그대로 쓰면
// 「효과 없음」을 지어내게 된다. 그래서 AX 가 필요 없는 자를 세운다:
//   **내가 띄운 HTTP 서버가 그 칸의 입력 사건을 파일에 적는다.** T5 는 이 서버도 이 파일도
//   모른다(붙은 손 어디에도 없다). 파일시스템은 `organ-round` 가 칸5 에서 이미 쓰는 축이다.
//
// ⚠️ HOME 을 격리하지 않는다. 남의 앱에 글자를 치지 않는다 — 시험창은 **내가 직접 띄운**
//    전용 프로필 크롬 창이다(오너의 크롬과 pid·프로필이 다르다).
import { createServer } from 'node:http';
import { appendFile, writeFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
// **경로를 박지 않는다** — 이 대본은 오너 터미널에서 돌아야 한다(아래 「왜 여기 있나」).
// 저장소 뿌리는 이 파일 자리에서 세고, 작업 자리는 이 기계의 임시 자리를 쓴다.
const 뿌리 = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const 방 = join(tmpdir(), 't5-typing-first-move');
const 기록파일 = `${방}/친글자.log`;
const 표식 = '전세사기';
const 포트 = 8791;

// ── 독립 기준자 서버 — 그 칸에 실제로 들어간 글자만 파일에 적는다 ──────────
const 페이지 = `<!doctype html><meta charset=utf-8><title>T5 시험창</title>
<body style="font:16px -apple-system;padding:40px">
<h2>T5 결재 ① 실기기 시험창</h2>
<p>시험용 창입니다. 아래 칸에만 글자가 들어갑니다.</p>
<input id=q type=search aria-label="검색어 입력" placeholder="검색어 입력"
       style="font-size:24px;padding:12px;width:460px" autofocus>
<script>
  const q = document.getElementById('q');
  const 적기 = () => fetch('/기록', { method:'POST', body: q.value });
  q.addEventListener('input', 적기);
  q.addEventListener('keyup', 적기);
</script></body>`;

await mkdir(방, { recursive: true });
await writeFile(기록파일, '', 'utf8');
const 기준자서버 = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/기록') {
    let b = ''; for await (const c of req) b += c;
    await appendFile(기록파일, `${new Date().toISOString()}\t${b}\n`, 'utf8');
    res.writeHead(204); res.end(); return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(페이지);
});
await new Promise((ok) => 기준자서버.listen(포트, '127.0.0.1', ok));
console.log(`독립 기준자 서버: http://127.0.0.1:${포트} → ${기록파일}`);

// ── 시험창을 내가 직접 띄운다(전용 프로필 · 오너 크롬과 분리) ──────────────
//
// **같은 제목의 창을 둘 띄우면 안 된다**(1회차 실측): T5 가 *"두 개 떠 있는 「T5 시험창」 중
// 어떤 창인지 화면 정보로 안 잡힌다"* 며 정직하게 멈췄다 — 제품이 옳게 군 것이고 **대본이
// 틀렸다.** 앞선 회차의 전용 프로필 크롬을 먼저 정리하고 **한 창만** 띄운다.
// (오너 크롬은 프로필이 달라 이 정리에 안 걸린다 — `--user-data-dir` 로만 고른다.)
try { await run('pkill', ['-f', `${방}/t5-live-chrome`]); } catch { /* 없으면 그만 */ }
await new Promise((ok) => setTimeout(ok, 2500));
await run('open', ['-na', 'Google Chrome', '--args',
  `--user-data-dir=${방}/t5-live-chrome`, '--no-first-run', '--no-default-browser-check',
  '--new-window', `http://127.0.0.1:${포트}/`]);
await new Promise((ok) => setTimeout(ok, 6000));

const 창목록 = async () => {
  const { stdout } = await run(`${뿌리}/vendor/cua-driver/darwin-arm64/CuaDriver.app/Contents/MacOS/cua-driver`,
    ['call', 'list_windows', '--json', '{}']);
  return JSON.parse(stdout).windows.filter((w) => w.title && w.is_on_screen);
};
console.log(`시험창 확인: ${(await 창목록()).filter((w) => /T5 시험창/.test(w.title)).map((w) => `${w.app_name}|${w.title}|pid ${w.pid}`).join(' , ') || '없음'}`);

const 친것 = async () => {
  const t = await readFile(기록파일, 'utf8');
  return t.trim().split('\n').filter(Boolean).map((l) => l.split('\t')[1] ?? '');
};

const 목록 = [{
  칸: '결재① 첫수 타이핑',
  문장: `화면에 떠 있는 「T5 시험창」 창의 검색어 입력 칸에 "${표식}" 이라고 입력해줘.`,
  async 판정() {
    const 줄 = await 친것();
    const 마지막 = 줄[줄.length - 1] ?? '';
    return {
      사실: `그 칸에 실제로 들어간 글자(내 서버가 받은 것) = ${JSON.stringify(마지막)}`
        + ` · 입력사건 ${줄.length}건`,
      통과: 마지막.includes(표식),
    };
  },
}];

try {
  const { 실기기회차 } = await import(`${뿌리}/scripts/live/organ-round.mjs`);
  const { 방: 회차방, 줄들 } = await 실기기회차({ 목록 });
  for (const r of 줄들) {
    console.log('');
    console.log(`${r.통과 === true ? '○' : r.통과 === false ? '✕' : '계측불가'}  [${r.칸}] ${r.문장}`);
    console.log(`     **사용자 손 ${r.카드}회** · ${r.걸린}초`);
    console.log(`     손: ${r.손.join(' ') || '없음'}`);
    console.log(`     독립 기준자: ${r.사실}`);
    console.log(`     T5 답(참고): ${r.답.slice(0, 160)}`);
    console.log(`     손기록: ${JSON.stringify(r.손기록.map((x) => ({ t: x.tool, a: x.args?.action, 대상: x.args?.대상, 값: x.args?.값 ?? x.args?.기대?.값, f: x.failureState }))).slice(0, 1200)}`);
  }
  console.log(`\n회차 원본: ${회차방}/회차.json`);
} finally {
  await new Promise((ok) => 기준자서버.close(ok));
}
