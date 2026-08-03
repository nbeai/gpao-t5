// **호출 신분 실모델 관통** — `node scripts/s1/live-call-identity.mjs`
//
// 대본 모델은 우리가 만든 신분을 돌려주므로, 그것만으로는 **진짜 공급자가 발급한 신분**이
// 도는지 알 수 없다. 여기서는 실제 gpt-5.1 이 발급한 `call_...` 이
//   응답 파싱 → 대기열 → 실행 → ToolReceipt → turnExchange → **다음 요청의 tool_call_id**
// 까지 그대로 가는지를 **와이어 전문에서** 확인한다.
//
// 짧게 돈다: 파일 하나 읽기. 판정에 쓰지 않는다 — 신분이 도는지만 본다.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../../src/surface/server.js';
import { 저장된연결 } from './run.mjs';
import { 도청기띄우기, 고른도구 } from './wire-tap.mjs';

const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다.'); process.exit(2); }

const 뿌리 = await mkdtemp(join(tmpdir(), 'call-id-live-'));
const 홈 = join(뿌리, 'home'); const 상태 = join(뿌리, 'state'); const 자리 = join(홈, '자료');
await mkdir(자리, { recursive: true }); await mkdir(상태, { recursive: true });
await writeFile(join(자리, '정산.csv'), '항목,금액\n임대료,500000\n전기요금,120000\n');

const 도청 = await 도청기띄우기({ 상류: 연결.상류 ?? 'https://api.openai.com/v1', 자격: 연결.자격 });
const server = await startLiveServer({
  port: 0,
  processEnv: {
    GPAO_T5_DATA_DIR: 상태, GPAO_T5_HOME: 홈, GPAO_T5_FILE_ROOTS: 자리,
    OPENAI_API_KEY: 연결.자격, GPAO_T5_MODEL_BASE_URL: 도청.baseUrl,
    GPAO_T5_MODEL_ID: 연결.modelId, GPAO_T5_TCELL: 'off',
  },
});
const 주소 = `http://127.0.0.1:${server.address().port}`;
const 신분쿠키 = ((await fetch(`${주소}/`)).headers.get('set-cookie') ?? '').split(';')[0];
const 부르기 = async (p, b) => (await fetch(`${주소}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: 신분쿠키 }, body: JSON.stringify(b ?? {}),
})).json();

try {
  const s = (await 부르기('/sessions')).id;
  await 부르기('/turn', { sessionId: s, text: '자료 폴더의 정산.csv 읽고 뭐가 들었는지 알려줘' });
} finally {
  await new Promise((r) => server.close(r));
  await 도청.close();
}

const 잰것 = [];
const 잰다 = (이름, 통과, 근거) => { 잰것.push({ 이름, 통과 }); console.log(`  ${통과 ? '✔' : '✖'} ${이름}\n      ${근거}`); };

console.log('\n호출 신분 실모델 관통 — gpt-5.1\n');

// ① 모델이 실제로 발급한 신분을 모은다(응답 쪽).
const 발급된신분 = [];
for (const 기 of 도청.기록) {
  if (!기.보낸것?.messages) continue;
  for (const c of 고른도구(기.받은것)) if (c.name) 발급된신분.push(c);
}
const 진짜신분 = 도청.기록.flatMap((기) => {
  const 글 = String(기.받은것 ?? '');
  return [...글.matchAll(/"id"\s*:\s*"(call_[A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
});
잰다('실모델이 호출 신분을 발급했다', 진짜신분.length > 0,
  `${진짜신분.length}건 — ${[...new Set(진짜신분)].slice(0, 3).join(', ')}`);

// ② 그 신분이 **다음 요청**의 assistant tool_calls / tool 메시지에 그대로 실렸다.
const 되돌아온것 = [];
for (const 기 of 도청.기록) {
  for (const m of 기.보낸것?.messages ?? []) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) 되돌아온것.push(...m.tool_calls.map((t) => t.id));
    if (m.role === 'tool' && m.tool_call_id) 되돌아온것.push(m.tool_call_id);
  }
}
const 겹침 = [...new Set(되돌아온것)].filter((id) => 진짜신분.includes(id));
잰다('그 신분이 다음 요청의 tool_call_id 로 그대로 돌아갔다', 겹침.length > 0,
  `되돌아온 신분 ${[...new Set(되돌아온것)].join(', ') || '(없음)'} · 그중 모델이 발급한 것 ${겹침.length}건`);

// ③ **지어낸 신분이 섞이지 않았다** — 모델이 발급한 적 없는 id 를 돌려주지 않는다.
const 지어낸것 = [...new Set(되돌아온것)].filter((id) => !진짜신분.includes(id));
잰다('모델이 발급한 적 없는 신분을 돌려주지 않는다', 지어낸것.length === 0,
  지어낸것.length ? `지어낸 신분: ${지어낸것.join(', ')}` : '없음');

// ④ 실행이 실제로 일어났다(신분만 돌고 일은 안 하면 의미가 없다).
잰다('그 턴에 손이 실제로 움직였다', 되돌아온것.length > 0,
  `도구 대화 ${되돌아온것.length}건`);

await rm(뿌리, { recursive: true, force: true });
const 실패 = 잰것.filter((x) => !x.통과);
console.log('');
if (실패.length) { console.error(`LIVE CALL-ID: FAIL (${실패.length}/${잰것.length})`); process.exit(1); }
console.log(`LIVE CALL-ID: PASS (${잰것.length}건 · 실제 공급자 발급 신분으로 판정)`);
