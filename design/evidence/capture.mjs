// 디자인 evidence 캡처 도구 (제품 코드 아님, 개발용).
// Chrome headless + DevTools Protocol. 저장소 의존성 0 — node 내장 fetch/WebSocket 만 사용한다.
// 로컬에 Google Chrome 이 있어야 한다(감사 환경 재현용). 사용:
//   1) npm start                                   # 앱 서버(기본 4173)
//   2) "<Chrome>" --headless=new --remote-debugging-port=9222 --user-data-dir=<tmp> about:blank &
//   3) APP_URL=http://localhost:4173 OUT_DIR=design/evidence/2026-07-24-slice1 node design/evidence/capture.mjs
import { writeFile, mkdir } from 'node:fs/promises';

const APP = process.env.APP_URL ?? 'http://localhost:4173';
const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222';
const OUT = process.env.OUT_DIR ?? '.';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await mkdir(OUT, { recursive: true });

const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no chrome page target — remote-debugging chrome 를 먼저 띄워라');

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');

const metrics = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: w < 500 });
const nav = async () => { await send('Page.navigate', { url: APP }); await sleep(700); };
const run = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true });
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64'));
  console.log('wrote', `${name}.png`);
}

// 1) 첫 화면 — 요구된 3개 모바일 폭 + 데스크톱.
for (const [w, h, tag] of [[375, 812, 'mobile-375'], [390, 844, 'mobile-390'], [430, 932, 'mobile-430'], [1280, 800, 'desktop-1280']]) {
  await metrics(w, h); await nav(); await shot(`workchat-initial-${tag}`);
}

// 2) 인라인 승인 카드 (데스크톱).
await metrics(1280, 800); await nav();
await run(`(async()=>{document.getElementById('text').value='이 소식 슬랙에 올려줘';document.getElementById('send').click();await new Promise(r=>setTimeout(r,450));})()`);
await shot('workchat-approval-card');

// 3) 승인 후 실행 + 접힌 작업 기록(펼침).
await run(`(async()=>{[...document.querySelectorAll('button.act')].find(b=>b.textContent==='승인')?.click();await new Promise(r=>setTimeout(r,500));const r=document.querySelector('.record .head');if(r)r.click();})()`);
await shot('workchat-approved-record');

// 4) 모바일 승인 카드(375) — 하단 입력 잘림 회귀 확인용.
await metrics(375, 812); await nav();
await run(`(async()=>{document.getElementById('text').value='이 소식 슬랙에 올려줘';document.getElementById('send').click();await new Promise(r=>setTimeout(r,450));})()`);
await shot('workchat-mobile-375-approval');

ws.close();
console.log('done');
