// **헌장 라이브 관통** — `npm run live:charter`
//
// M2 복기의 1순위 역량강화다. 라이브가 잡은 결함 둘(`connector.declare` 승인 하드코딩,
// `WHY_AUTO` 미도달)은 회귀 2,088 건이 전부 초록인 상태에서 **20분의 실사용**이 잡았다.
// 그 20분을 한 줄로 만들어, "라이브가 커밋보다 앞"이 규칙이 아니라 **기본값**이 되게 한다.
//
// ── 무엇이 진짜인가 ────────────────────────────────────────────────────────
//   진짜: T5 서버 전체 · 저장소 · 권한 판정 · 손(파일·터미널·커넥터) · 표면 HTTP 계약 ·
//         파일 시스템 · 작업 원장 · 모델 provider 배선(fetch·헤더·스키마·파싱)
//   대본: 모델의 판단 하나. "무엇을 고르는가"를 고정해 **권한 경로만 남긴다.**
//
// ── 판정 규칙 ──────────────────────────────────────────────────────────────
//   문구 일치로 합격을 만들지 않는다(모델은 같은 답을 낼 수 없다 — 유사하면 같은 답이다).
//   재는 것은 넷뿐이다: 카드가 떴는가 · 파일이 실제로 어떻게 됐는가 · 원장에 무엇이 남았는가 ·
//   승인 전에 실행됐는가.
//
// ── 이 하네스가 덮지 않는 것(정직하게) ──────────────────────────────────────
//   DOM 렌더링은 재지 않는다. 표면 HTTP 응답까지가 이 하네스의 한계이고, 화면에 실제로
//   그려지는지는 브라우저 관통이 따로 봐야 한다. 응답에 있는데 안 그려진 결함은 못 잡는다.
import { mkdtemp, writeFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { startLiveServer } from '../../src/surface/server.js';
import { 대본모델띄우기 } from './scripted-model.mjs';

const 조용히 = process.argv.includes('--quiet');
const 로그 = (...a) => { if (!조용히) console.log(...a); };
const md5 = (b) => createHash('md5').update(b).digest('hex');

// ── 대본: 사용자 문장 → 고를 도구 ─────────────────────────────────────────
const 대본 = (자리) => [
  { 열쇠: '지워', tool: 'local.file', args: () => ({ action: 'delete', path: join(자리, '지울것.txt') }) },
  { 열쇠: '읽어', tool: 'local.file', args: () => ({ action: 'read', path: join(자리, '읽을것.txt') }) },
  { 열쇠: '통째로 없애', tool: 'local.terminal', args: () => ({ command: `rm -rf ${join(자리, '버릴폴더')}` }) },
  { 열쇠: '붙여', tool: 'connector.declare', args: () => ({
    service: '어떤협업툴', authKind: 'api_key',
    fields: [{ name: 'api_key', label: 'API 키', secret: true }],
    issue: { url: 'https://example.com/apps', steps: ['앱을 만들고 키를 받아 주세요'] },
    verify: { url: 'https://api.example.com/me', headers: { Authorization: 'Bearer {api_key}' } },
    tools: [{
      name: 'items', label: '항목 목록', description: '항목을 가져온다',
      parameters: { type: 'object', properties: {} },
      request: { url: 'https://api.example.com/items', headers: { Authorization: 'Bearer {api_key}' } },
    }],
  }) },
  { 열쇠: '텔레그램', tool: 'telegram.send', args: (t) => ({
    target: (t.match(/\b(\d{5,})\b/) ?? [, ''])[1], text: '라이브 관통 확인',
  }) },
];

// ── 관통 ───────────────────────────────────────────────────────────────────
const 결과 = [];
const 잰다 = (이름, 통과, 근거) => {
  결과.push({ 이름, 통과, 근거 });
  로그(`  ${통과 ? '✔' : '✖'} ${이름}\n      ${근거}`);
};

const 뿌리 = await mkdtemp(join(tmpdir(), 't5-charter-'));
const 자리 = join(뿌리, 'fixture');
const 상태 = join(뿌리, 'state');
const 홈 = join(뿌리, 'home');
await mkdir(join(자리, '버릴폴더'), { recursive: true });
await mkdir(상태, { recursive: true });
await mkdir(홈, { recursive: true });
await writeFile(join(자리, '지울것.txt'), '지울 내용\n', 'utf8');
await writeFile(join(자리, '읽을것.txt'), '읽을 내용\n', 'utf8');
await writeFile(join(자리, '버릴폴더', '안쪽.txt'), '안에 있던 것\n', 'utf8');
const 지울것md5 = md5(await readFile(join(자리, '지울것.txt')));

const 텔레그램토큰 = process.env.GPAO_T5_LIVE_TELEGRAM_TOKEN;
const 텔레그램상대 = process.env.GPAO_T5_LIVE_TELEGRAM_CHAT;
const 전송축 = Boolean(텔레그램토큰 && 텔레그램상대);

const 모델 = await 대본모델띄우기({ 대본: 대본(자리) });
const server = await startLiveServer({
  port: 0,
  processEnv: {
    GPAO_T5_DATA_DIR: 상태,
    GPAO_T5_HOME: 홈,
    GPAO_T5_FILE_ROOTS: 자리,
    ANTHROPIC_API_KEY: 'live-charter-scripted',
    GPAO_T5_MODEL_BASE_URL: 모델.baseUrl,
    GPAO_T5_MODEL_ID: 'claude-opus-4-8',
    ...(전송축 ? { TELEGRAM_BOT_TOKEN: 텔레그램토큰 } : {}),
  },
});
const 주소 = `http://127.0.0.1:${server.address().port}`;

// 신분은 **쿠키 한 길**로만 받는다(`local-surface.js` — 헤더 뒷문을 열지 않는 설계).
// 하네스도 화면과 같은 길을 쓴다: 먼저 `/` 를 받아 신분 쿠키를 얻고, 그 뒤로 그걸 달고 다닌다.
// 여기서 헤더 우회를 만들면 하네스만 통과하는 두 번째 문이 생긴다 — 그건 관통이 아니다.
const 첫화면 = await fetch(`${주소}/`);
const 신분 = (첫화면.headers.get('set-cookie') ?? '').split(';')[0];

const 부르기 = async (경로, 몸) => {
  const r = await fetch(`${주소}${경로}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(신분 ? { cookie: 신분 } : {}) },
    body: JSON.stringify(몸 ?? {}),
  });
  const 글 = await r.text();
  try { return JSON.parse(글); } catch { throw new Error(`표면이 JSON 이 아닌 답을 줬다(${r.status}): ${글.slice(0, 120)}`); }
};
const 새대화 = async () => (await 부르기('/sessions')).id;
const 말하기 = (sessionId, text) => 부르기('/turn', { sessionId, text });
const 승인 = (sessionId, approve) => 부르기('/turn', { sessionId, approve });

const 휴지통 = async () => readdir(join(상태, '.trash')).catch(() => []);

try {
  로그(`\n헌장 라이브 관통 — ${주소}\n격리 자리 ${뿌리}\n`);

  // ── 헌장 밖: 읽기는 묻지 않는다 ─────────────────────────────────────────
  {
    const s = await 새대화();
    const r = await 말하기(s, '읽을것.txt 읽어줘');
    잰다('읽기는 카드 없이 바로 간다(헌장 밖)', r.kind !== 'approval', `표면 응답 kind=${r.kind}`);
  }

  // ── 헌장 ②: 되돌릴 수 있으면 자동, 단 원본이 실제로 남아야 한다 ──────────
  {
    const s = await 새대화();
    const r = await 말하기(s, '지울것.txt 지워줘');
    const 사라졌나 = !existsSync(join(자리, '지울것.txt'));
    const 남은것 = (await 휴지통()).filter((n) => n.includes('지울것.txt'));
    const 같은가 = 남은것.length === 1
      && md5(await readFile(join(상태, '.trash', 남은것[0]))) === 지울것md5;
    잰다('되돌릴 수 있는 삭제는 카드 없이 실행된다(헌장 ②)',
      r.kind !== 'approval' && 사라졌나, `kind=${r.kind} · 원본 사라짐=${사라졌나}`);
    잰다('그 말이 참이다 — 원본이 휴지통에 바이트 동일하게 남는다',
      같은가, `휴지통 ${남은것.length}건 · md5 일치=${같은가}`);
  }

  // ── 헌장 ②: 되돌릴 수 없으면 묻는다. 그리고 묻는 동안 실행되지 않는다 ────
  {
    const s = await 새대화();
    const r = await 말하기(s, '버릴폴더 통째로 없애줘');
    const 승인전그대로 = existsSync(join(자리, '버릴폴더', '안쪽.txt'));
    잰다('되돌릴 수 없는 명령은 카드가 뜬다(헌장 ②)', r.kind === 'approval', `kind=${r.kind}`);
    잰다('카드가 뜬 동안 실행되지 않는다', 승인전그대로, `대상 파일 그대로=${승인전그대로}`);
    if (r.kind === 'approval') {
      await 승인(s, r.pendingId);
      const 지워졌나 = !existsSync(join(자리, '버릴폴더'));
      잰다('승인하면 실제로 실행된다(카드가 막다른 길이 아니다)', 지워졌나, `폴더 사라짐=${지워졌나}`);
    }
  }

  // ── 헌장 밖: 서비스 붙이기 — 오너가 든 6장 중 하나였다 ──────────────────
  {
    const s = await 새대화();
    const r = await 말하기(s, '어떤협업툴 붙여줘');
    잰다('서비스 붙이기는 카드 없이 간다(헌장 밖 — 오너가 든 카드)',
      r.kind !== 'approval', `kind=${r.kind}`);
  }

  // ── 연속성: 끊겨도 놓친 사실이 되살아난다 ───────────────────────────────
  // 헌장이 승인을 걷은 자리를 지탱하는 것은 **사실 기록**이다(헌장 자신의 문장). 그 기록이
  // 끊긴 연결을 넘어 살아남지 못하면, 자동으로 흘러간 일을 사용자가 영영 못 보게 된다 —
  // 카드를 없앤 대가가 침묵이 된다. 그래서 이 축은 헌장과 같은 자리에서 잰다.
  {
    const s = await 새대화();
    const { streamId } = await 부르기('/turn/stream-start', { sessionId: s, text: '읽을것.txt 읽어줘' });
    const ctrl = new AbortController();
    const 받은것 = []; let 마지막id = null;
    try {
      const r = await fetch(`${주소}/turn/stream?sessionId=${s}&streamId=${streamId}`,
        { headers: { cookie: 신분, accept: 'text/event-stream' }, signal: ctrl.signal });
      const reader = r.body.getReader(); const dec = new TextDecoder();
      while (받은것.length < 2) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const blk of dec.decode(value, { stream: true }).split('\n\n')) {
          const ev = blk.match(/^event: (\w+)/m)?.[1];
          const id = blk.match(/^id: (\d+)/m)?.[1];
          if (ev && ev !== 'heartbeat') { 받은것.push(ev); if (id) 마지막id = id; }
        }
      }
    } catch { /* 끊김은 이 시나리오의 목적이다 */ }
    ctrl.abort();

    await new Promise((r2) => setTimeout(r2, 3000)); // 턴은 서버에서 계속 돈다
    const 재접속 = await fetch(`${주소}/turn/stream?sessionId=${s}&lastEventId=${마지막id ?? 0}`,
      { headers: { cookie: 신분, accept: 'text/event-stream' } });
    const 본문 = await 재접속.text();
    const 되살아난것 = [...본문.matchAll(/^event: (\w+)/gm)].map((m) => m[1]);
    잰다('턴 도중 끊겨도 놓친 사실이 되살아난다(연속성)',
      되살아난것.includes('complete'),
      `끊기 전 ${받은것.join(',')} (lastEventId=${마지막id}) → 복구 ${되살아난것.join(',')}`);
    잰다('다시 붙은 쪽이 턴이 끝났는지 알 수 있다',
      /terminal":true/.test(본문), `reconnected 신호=${/event: reconnected/.test(본문)}`);
  }

  // ── 헌장 ③: 새 상대는 한 번만 묻는다 ────────────────────────────────────
  if (전송축) {
    const s = await 새대화();
    const 첫 = await 말하기(s, `텔레그램 ${텔레그램상대} 로 보내줘`);
    잰다('새 상대 첫 전송은 카드가 뜬다(헌장 ③)', 첫.kind === 'approval', `kind=${첫.kind}`);
    if (첫.kind === 'approval') {
      await 승인(s, 첫.pendingId);
      const 두번째 = await 말하기(s, `텔레그램 ${텔레그램상대} 로 한 번 더 보내줘`);
      잰다('같은 상대 두 번째는 묻지 않는다(헌장 ③ 의 "한 번만")',
        두번째.kind !== 'approval', `kind=${두번째.kind}`);
    }
  } else {
    결과.push({ 이름: '헌장 ③ 새 상대 첫 전송', 건너뜀: true,
      근거: 'GPAO_T5_LIVE_TELEGRAM_TOKEN·_CHAT 이 없어 전송 손이 배선되지 않았다' });
    로그('  · 건너뜀 — 헌장 ③ 새 상대 첫 전송\n      GPAO_T5_LIVE_TELEGRAM_TOKEN·_CHAT 없음(전송 손 미배선)');
  }
} finally {
  await new Promise((r) => server.close(r));
  await 모델.close();
}

// ── 보고 ───────────────────────────────────────────────────────────────────
const 잰것 = 결과.filter((r) => !r.건너뜀);
const 실패 = 잰것.filter((r) => !r.통과);
const 건너뛴 = 결과.filter((r) => r.건너뜀);

로그('');
if (건너뛴.length) {
  // **조용한 축소 금지** — 못 잰 축은 반드시 드러낸다. 안 그러면 "전부 통과"로 읽힌다.
  console.log(`LIVE CHARTER: 건너뛴 축 ${건너뛴.length}건 — ${건너뛴.map((r) => r.이름).join(', ')}`);
}
if (실패.length) {
  console.error(`LIVE CHARTER: FAIL (${실패.length}/${잰것.length})`);
  for (const f of 실패) console.error(`  ✖ ${f.이름} — ${f.근거}`);
  await rm(뿌리, { recursive: true, force: true });
  process.exit(1);
}
console.log(`LIVE CHARTER: PASS (${잰것.length}건 · 실제 서버·파일·표면 응답으로 판정 · DOM 렌더링은 미측정)`);
await rm(뿌리, { recursive: true, force: true });
