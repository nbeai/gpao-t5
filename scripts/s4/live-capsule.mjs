// **캡슐 실모델 관통** — `node scripts/s4/live-capsule.mjs`
//
// 재는 것: 모델이 **읽어 봐야 아는 조건**을 만났을 때 캡슐을 잡는가, 그리고 그 결과가
// 실물·답과 일치하는가. 격리는 `test/s4-capsule-isolation.test.js` 가 따로 잰다.
//
// 과업: 정산표 12개 중 **합계가 100만을 넘는 것만** 옮긴다. `bulk_move` 의 `match` 로는
// 표현되지 않는다 — 금액은 파일을 열어야 안다. 이름·확장자·날짜로도 못 가른다.
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLiveServer } from '../../src/surface/server.js';
import { 저장된연결 } from '../s1/run.mjs';
import { 도청기띄우기, 고른도구 } from '../s1/wire-tap.mjs';

const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다.'); process.exit(2); }

const 뿌리 = await mkdtemp(join(tmpdir(), 's4-live-'));
const 홈 = join(뿌리, 'home'); const 상태 = join(뿌리, 'state'); const 자리 = join(홈, '정산');
await mkdir(자리, { recursive: true }); await mkdir(상태, { recursive: true });
await mkdir(join(자리, '큰건'), { recursive: true });
const 표 = [];
for (let i = 0; i < 60; i += 1) {
  const 금액 = i % 20 === 0 ? 1_200_000 + i * 1000 : 3_000 + i * 100;
  표.push([`정산-${String(i).padStart(2, '0')}.csv`, `항목,금액\n비용,${금액}\n`, 금액]);
}
for (const [이름, 내용] of 표) await writeFile(join(자리, 이름), 내용);
const 큰것 = 표.filter(([, , 금액]) => 금액 > 1_000_000).map(([이름]) => 이름).sort();

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
const 쿠키 = ((await fetch(`${주소}/`)).headers.get('set-cookie') ?? '').split(';')[0];
const 부르기 = async (p, b) => (await fetch(`${주소}${p}`, {
  method: 'POST', headers: { 'content-type': 'application/json', cookie: 쿠키 }, body: JSON.stringify(b ?? {}),
})).json();

let 답 = null;
try {
  const s = (await 부르기('/sessions')).id;
  답 = await 부르기('/turn', { sessionId: s, text: '정산 폴더에 표가 60개 있어. 합계가 100만 원 넘는 것만 큰건 폴더로 옮겨줘.' });
  if (답?.kind === 'approval') 답 = await 부르기('/turn', { sessionId: s, approve: 답.pendingId });
} finally {
  await new Promise((r) => server.close(r));
  await 도청.close();
}

const 옮겨진것 = (await readdir(join(자리, '큰건'))).filter((n) => n.endsWith('.csv')).sort();
const 남은것 = (await readdir(자리)).filter((n) => n.endsWith('.csv')).sort();
const 고른손 = 도청.기록.flatMap((기) => 고른도구(기.받은것)).map((c) => c.name).filter(Boolean);
// 캡슐이 무엇을 받았는지 — 실패 원인을 사후에 볼 수 있게 남긴다(원시 보존).
for (const 기 of 도청.기록) {
  for (const m of 기.보낸것?.messages ?? []) {
    if (m.role === 'tool' && /스크립트|캡슐|capsule/.test(String(m.content ?? ''))) {
      console.log('  [캡슐 결과] ' + String(m.content).slice(0, 300).replace(/\n/g, ' | '));
    }
  }
}
for (const 기 of 도청.기록) {
  for (const c of 고른도구(기.받은것)) {
    if (String(c.name).includes('capsule')) console.log('  [캡슐 코드] ' + String(c.args?.code ?? '').slice(0, 400).replace(/\n/g, ' '));
  }
}

const 잰것 = [];
const 잰다 = (이름, 통과, 근거) => { 잰것.push({ 이름, 통과 }); console.log(`  ${통과 ? '✔' : '✖'} ${이름}\n      ${근거}`); };

console.log('\n캡슐 실모델 관통 — gpt-5.1\n');
잰다('모델이 캡슐을 골랐다', 고른손.some((n) => String(n).includes('capsule')),
  `고른 손: ${[...new Set(고른손)].join(', ') || '(없음)'}`);
잰다('큰 것만 옮겨졌다(읽어 봐야 아는 조건)',
  옮겨진것.join(',') === 큰것.join(','),
  `옮겨진 것: ${옮겨진것.join(', ') || '(없음)'} / 기대: ${큰것.join(', ')}`);
잰다('작은 것은 그대로 있다(오대상 실행 0)',
  남은것.length === 표.length - 큰것.length,
  `남은 것 ${남은것.length}개 (기대 ${표.length - 큰것.length}개)`);
잰다('최종 답이 실물과 맞는다',
  /3개|세 개|3 개/.test(String(답?.reply ?? '')) || 큰것.every((n) => String(답?.reply ?? '').includes(n)),
  `답: ${String(답?.reply ?? '').slice(0, 200).replace(/\n/g, ' ')}`);

await rm(뿌리, { recursive: true, force: true });
const 실패 = 잰것.filter((x) => !x.통과);
console.log('');
if (실패.length) { console.error(`LIVE CAPSULE: FAIL (${실패.length}/${잰것.length})`); process.exit(1); }
console.log(`LIVE CAPSULE: PASS (${잰것.length}건 · 실모델·실물 일치)`);
