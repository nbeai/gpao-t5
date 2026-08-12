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

// **계측기를 먼저 검증한다.** 도청기가 도구 호출을 못 잡으면 "모델이 안 썼다"는 결론이
// 통째로 틀린다. 반드시 도구를 부르는 대조 발화를 같은 실행에 넣어 그것부터 확인한다.
const 발화들 = process.argv.slice(2).length ? process.argv.slice(2) : [
  ['대조(도구를 반드시 부른다)', 'fixture 폴더에 뭐가 있는지 목록으로 보여줘.'],
  ['자동화', '매일 아침 9시에 fixture 폴더에 새 파일이 생겼는지 확인해서 알려주는 걸 반복으로 걸어줘.'],
].map((x) => (Array.isArray(x) ? x : ['직접', x]));

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

const 회차들 = [];
for (const [이름, 발화] of 발화들) {
  const 앞까지 = 도청.기록.length;
  const s = await 부르기('/sessions');
  const 답 = await 부르기('/turn', { sessionId: s.id, text: 발화 });
  회차들.push({ 이름, 발화, 답, 기록: 도청.기록.slice(앞까지) });
}

await new Promise((r) => server.close(r));
await 도청.close();

// ── 회차별 판정 ────────────────────────────────────────────────────────────
const 부른도구 = (기록) => {
  const 낸것 = [];
  for (const 한건 of 기록) {
    const 몸 = 한건.받은것;
    for (const x of (몸?.choices?.[0]?.message?.tool_calls ?? [])) 낸것.push(x.function?.name ?? x.name);
    for (const x of (몸?.output ?? []).filter?.((o) => o.type === 'function_call') ?? []) 낸것.push(x.name);
    const 본문 = 한건.받은본문 ?? 한건.본문 ?? (typeof 몸 === 'string' ? 몸 : null);
    if (typeof 본문 === 'string') {
      for (const m of 본문.matchAll(/"function"\s*:\s*\{[^}]*"name"\s*:\s*"([a-z_.]+)"/g)) 낸것.push(m[1]);
    }
  }
  return 낸것;
};

for (const r of 회차들) {
  const 요청들 = r.기록.filter((x) => x.보낸것?.tools || x.보낸것?.messages);
  const 실림 = 요청들.filter((x) => (x.보낸것?.tools ?? []).some((t) => String(t.function?.name ?? t.name).includes('automation')));
  const 낸것 = 부른도구(r.기록);
  console.log(`\n[${r.이름}] "${r.발화.slice(0, 40)}…"`);
  console.log(`  모델 요청 ${요청들.length}건 · automation 실린 요청 ${실림.length}건`);
  console.log(`  모델이 부른 도구: ${낸것.length ? [...new Set(낸것)].join(', ') : '(없음)'}`);
  console.log(`  답: ${String(r.답?.reply ?? r.답?.question ?? '').slice(0, 110).replace(/\n/g, ' ')}`);
}

const 대조 = 회차들[0];
const 대조가부름 = 부른도구(대조?.기록 ?? []).length > 0;
console.log(`\n=== 계측기 검증: ${대조가부름 ? '**정상** — 도구 호출을 잡는다' : '**고장** — 대조 발화에서도 못 잡았다. 아래 판정은 무효다'}`);
if (대조가부름) {
  const 자동화회차 = 회차들.find((r) => r.이름.includes('자동화'));
  const 낸것 = 부른도구(자동화회차?.기록 ?? []);
  console.log(`=== F-11 판정: ${낸것.some((n) => String(n).includes('automation'))
    ? '모델이 자동화 채널을 실제로 썼다' : '**모델이 채널을 쥐고도 안 썼다**'}`);
}
await rm(root, { recursive: true, force: true });
