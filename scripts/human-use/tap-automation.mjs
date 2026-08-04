// **F-11 도청** — 모델이 자동화 채널을 쥐고도 안 쓰는 이유를 와이어에서 확정한다.
//
// 라이브 3회 재현(사람 사용시험, gpt-5.1):
//   ① "내일 아침 9시에 …"                → "스스로 다시 일어나는 기능이 아직 없어서"
//   ② "매일 아침 9시에 … 반복으로 걸어줘" → "예약 기능까지는 열려 있지 않아서" + cron 스크립트
//   ③ "automation.propose 채널을 써서 …"  → 도구 호출이 아니라 코드블록을 **글로** 썼다
//
// 가설(설명이 안 되는 것만 말해서)을 세우고 선언을 고쳤는데 **고친 뒤에도 재현됐다.**
// 가설이 틀렸다. 그래서 추측을 멈추고 **실제로 나간 전문**을 본다.
//
// ── 이 도청이 가르는 것 ────────────────────────────────────────────────────
//   `automation.propose` 가 요청 `tools` 에 **실렸는가**
//     · 실렸는데 안 썼다 → 모델 쪽. 선언 문구·배치 순서·이름을 본다.
//     · 안 실렸다        → 커널 쪽. 어느 호출에서 빠졌는지가 곧 결함 자리다.
//
// **자격은 기록에 안 남는다**(도청기가 헤더를 읽지도 적지도 않는다).
import { mkdtemp, mkdir, writeFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 저장된연결 } from '../s1/run.mjs';
import { 도청기띄우기 } from '../s1/wire-tap.mjs';
import { startLiveServer } from '../../src/surface/server.js';

const 발화 = process.argv[2]
  ?? '매일 아침 9시에 fixture 폴더에 새 파일이 생겼는지 확인해서 알려주는 걸 반복으로 걸어줘.';

const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다.'); process.exit(2); }

const root = await realpath(await mkdtemp(join(tmpdir(), 't5-tap-f11-')));
const fixture = join(root, 'fixture');
await mkdir(fixture, { recursive: true });
await mkdir(join(root, 'state'), { recursive: true });
await writeFile(join(fixture, 'brief-v1.txt'), '매출 1200\n', 'utf8');
process.env.HOME = root;                       // 격리 — `~` 가 오너 홈으로 풀리지 않게

const 도청 = await 도청기띄우기({ 상류: 연결.상류 ?? 'https://api.openai.com/v1', 자격: 연결.자격 });
const server = await startLiveServer({
  port: 0,
  processEnv: {
    HOME: root, GPAO_T5_HOME: root,
    GPAO_T5_DATA_DIR: join(root, 'state'),
    GPAO_T5_FILE_ROOTS: fixture,
    OPENAI_API_KEY: 연결.자격,
    GPAO_T5_MODEL_BASE_URL: 도청.baseUrl,
    GPAO_T5_MODEL_ID: 연결.modelId,
    GPAO_T5_TCELL: 'off',
  },
});
const 주소 = `http://127.0.0.1:${server.address().port}`;
const 첫화면 = await fetch(`${주소}/`);
const 신분 = (첫화면.headers.get('set-cookie') ?? '').split(';')[0];
const 부르기 = async (경로, 몸) => (await fetch(`${주소}${경로}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(신분 ? { cookie: 신분 } : {}) },
  body: JSON.stringify(몸 ?? {}),
})).json();

const s = await 부르기('/sessions');
const 답 = await 부르기('/turn', { sessionId: s.id, text: 발화 });

await new Promise((r) => server.close(r));
await 도청.close();

// ── 판정: 각 요청에 자동화 채널이 실렸는가 ─────────────────────────────────
const 요청들 = 도청.기록.filter((r) => r.보낸것?.tools || r.보낸것?.messages);
console.log(`\n발화: ${발화}\n모델 요청 ${요청들.length}건\n`);
let 실린적 = 0;
요청들.forEach((r, i) => {
  const 이름들 = (r.보낸것?.tools ?? []).map((t) => t.function?.name ?? t.name).filter(Boolean);
  const 있나 = 이름들.some((n) => String(n).includes('automation'));
  if (있나) 실린적 += 1;
  console.log(`  요청${i + 1}: 도구 ${이름들.length}개 · automation ${있나 ? '실림' : '안 실림'}`
    + (있나 ? ` (${이름들.findIndex((n) => String(n).includes('automation')) + 1}번째/${이름들.length})` : '')
    + (이름들.length ? `\n           ${이름들.join(', ')}` : ''));
});

// 모델이 실제로 부른 것
const 부른것 = [];
for (const 한건 of 도청.기록) {
  const 몸 = 한건.받은것;
  const 호출 = 몸?.choices?.[0]?.message?.tool_calls
    ?? 몸?.output?.filter?.((o) => o.type === 'function_call')
    ?? [];
  for (const x of 호출) 부른것.push(x.function?.name ?? x.name);
  // 스트리밍이면 본문이 문자열로 남는다 — 이름만 훑는다.
  if (typeof 한건.받은본문 === 'string') {
    for (const m of 한건.받은본문.matchAll(/"name"\s*:\s*"([a-z_]+)"/g)) 부른것.push(m[1]);
  }
}
console.log(`\n모델이 부른 도구: ${부른것.length ? 부른것.join(', ') : '(없음)'}`);
console.log(`자동화 채널이 실린 요청: ${실린적}/${요청들.length}`);
console.log(`\n판정: ${실린적 === 0 ? '**커널 쪽** — 채널이 요청에 안 실렸다'
  : 부른것.some((n) => String(n).includes('automation')) ? '모델이 실제로 썼다(재현 실패)'
    : '**모델 쪽** — 채널은 실렸는데 안 썼다'}`);
console.log(`\n최종 답 앞부분: ${String(답?.reply ?? '').slice(0, 160)}`);
await rm(root, { recursive: true, force: true });
