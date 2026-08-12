// **자동화 닫는 문장을 재는 대본** (design/T5-AUTOMATION-CLOSE-ko.md §1 삼중 금고 그대로).
//
// 채점을 T5 영수증으로 하지 않는다 — 판정은 **저장소 파일과 대화 기록**이 한다.
// 오너 서버(4173)를 끄지 않는다: 격리 포트 + 격리 데이터 자리로 돌린다.
//
// 재는 것 넷:
//   ① 그 발화에 **job 이 실제로 서는가** (candidate 아니라 job)
//   ② 그 job 의 실행 지시문이 **사용자가 말한 그 일**인가 (남의 스킬 목적이 아닌가)
//   ③ 시각이 지나면 **실제로 도는가** (nextRunAt 을 과거로 둔 판 + tick 1회)
//   ④ 결과가 **사용자 자리(대화)에 도착**하는가
// 그리고 답이 「안 도는 조건」을 말했는지는 사람이 읽는다(문구 판정은 기계가 안 한다).
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 저장소 뿌리는 이 파일 자리에서 센다 — 경로를 박으면 다른 설치에서 안 돈다.
const 뿌리 = process.argv[2] ?? dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const 문장 = process.argv[3] ?? '매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.';
const 포트 = Number(process.argv[4] ?? 4295);
const 방 = await mkdtemp(join(tmpdir(), 'auto-close-'));
const 자리 = join(방, 'state');

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
let 서버;
// **모델 연결만 격리 자리로 옮긴다.** 없으면 모델이 안 붙어 회차가 0.1초에 끝난다(밟음).
// 오너 자리는 **읽기만** 한다 — 이 저장소 규율이다.
const 연결옮기기 = async () => {
  const 원 = join(process.env.HOME, '.local/state/gpao-t5/sessions');
  // GPAO_T5_DATA_DIR 을 주면 파일이 **그 자리 바로 아래** 산다(밟음) — 오너 자리가
  // `…/gpao-t5/sessions` 인 것은 기본값이 그 경로일 뿐이다. 여기서 `sessions` 를 또 붙이면
  // 서버가 못 찾고 stub 모델로 뜬다.
  const 새 = 자리;
  await mkdir(새, { recursive: true });
  for (const f of ['model-connection.json', 'install.json']) {
    try { await copyFile(join(원, f), join(새, f)); }
    catch (e) { console.error(`  연결 옮기기 실패: ${f} — ${e.message}`); }
  }
};

const 서버띄우기 = async () => {
  서버 = spawn('node', ['src/surface/server.js'], {
    cwd: 뿌리, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(포트), GPAO_T5_DATA_DIR: 자리 },
  });
  서버.stdout.on('data', () => {});
  서버.stderr.on('data', (b) => { const s = String(b); if (/Error|error/.test(s)) process.stderr.write(s.slice(0, 300)); });
  for (let i = 0; i < 40; i += 1) {
    await 잠깐(500);
    try { const r = await fetch(`http://127.0.0.1:${포트}/health`); if (r.ok) return; } catch { /* 아직 */ }
  }
  throw new Error('서버가 안 떴다');
};

const 기지 = `http://127.0.0.1:${포트}`;
let 쿠키 = '';
const 부르기 = async (경로, 본문) => {
  const r = await fetch(기지 + 경로, {
    method: 본문 ? 'POST' : 'GET',
    headers: { cookie: 쿠키, ...(본문 ? { 'content-type': 'application/json' } : {}) },
    ...(본문 ? { body: JSON.stringify(본문) } : {}),
  });
  const t = await r.text();
  try { return { 상태: r.status, 값: JSON.parse(t) }; } catch { return { 상태: r.status, 값: t }; }
};
const 자동화파일 = () => join(자리, 'automation.json');
const 자동화읽기 = async () => JSON.parse(await readFile(자동화파일(), 'utf8').catch(() => '{}'));

try {
  await 연결옮기기();
  await 서버띄우기();
  쿠키 = String((await fetch(기지 + '/')).headers.get('set-cookie') ?? '').split(';')[0];
  const s = (await 부르기('/sessions', {})).값;
  console.log(`격리 자리: ${자리}\n세션: ${s.id}\n\n■ 친 문장\n   ${문장}\n`);

  const t0 = Date.now();
  const r = await 부르기('/turn', { sessionId: s.id, text: 문장 });
  const 답 = String(r.값?.result?.reply ?? r.값?.reply ?? '');
  console.log(`■ 나온 답 (${((Date.now() - t0) / 1000).toFixed(1)}초 · kind=${r.값?.result?.kind ?? r.값?.kind})`);
  console.log('   ' + 답.replace(/\n/g, '\n   ').slice(0, 900) + '\n');

  // ── ① job 이 섰나 (T5 말이 아니라 파일) ──────────────────────────────────
  let a = await 자동화읽기();
  const 후보 = a.candidates ?? []; let jobs = a.jobs ?? [];
  console.log(`■ 실물 ① automation.json — 후보 ${후보.length}건 · job ${jobs.length}건`);
  for (const j of jobs) {
    console.log(`     job: ${String(j.name ?? '').slice(0, 60)}`);
    console.log(`          skillRef=${j.skillRef?.id ?? '(없음)'} · nextRunAt=${new Date(j.trigger?.nextRunAt ?? j.nextRunAt ?? 0).toISOString()}`);
  }
  for (const c of 후보) console.log(`     후보(${c.state}): ${String(c.statement ?? '').slice(0, 60)}`);
  if (!jobs.length) {
    console.log('\n   → **job 이 안 섰다.** 닫는 문장 ①에서 멈춘다. 아래는 안 잰다.');
    process.exit(0);
  }

  // ── ③ 시각을 과거로 두고 tick — 시계를 당기지 않고 판을 옮긴다(§1 규율) ──
  const 원본 = await readFile(자동화파일(), 'utf8');
  const 옮김 = JSON.parse(원본);
  for (const j of 옮김.jobs ?? []) {
    const 과거 = Date.now() - 90 * 60 * 1000;   // 90분 전
    if (j.trigger) j.trigger.nextRunAt = 과거;
    if (j.nextRunAt !== undefined) j.nextRunAt = 과거;
  }
  await writeFile(자동화파일(), JSON.stringify(옮김, null, 2), 'utf8');
  console.log('\n■ nextRunAt 을 90분 전으로 옮겼다(시계는 안 건드린다). 서버를 다시 띄워 tick 을 태운다.');
  서버.kill(); await 잠깐(2500); await 서버띄우기();
  쿠키 = String((await fetch(기지 + '/')).headers.get('set-cookie') ?? '').split(';')[0];
  await 잠깐(3000);

  a = await 자동화읽기();
  const 정산 = a.settlements ?? [];
  console.log(`■ 실물 ② 실행 흔적(settlements) ${정산.length}건`);
  for (const x of 정산.slice(-3)) {
    console.log(`     ${x.status ?? x.state ?? '?'} · scheduledFor=${x.scheduledFor ?? '?'} · run=${String(x.runId ?? '').slice(0, 8)}`);
  }

  // ── ④ 결과가 대화에 도착했나 ──────────────────────────────────────────
  const 세션 = (await 부르기(`/sessions/${s.id}`)).값;
  const 도착 = (세션?.transcript ?? []).filter((x) => x?.source === 'automation' || x?.result?.source === 'automation');
  console.log(`\n■ 실물 ③ 대화 도착 ${도착.length}건`);
  for (const d of 도착.slice(-2)) console.log('     ' + JSON.stringify(d).slice(0, 220));

  console.log('\n── 닫는 문장 판정 ──');
  console.log(`   ① job 이 선다        ${jobs.length ? '○' : '✕'}`);
  console.log(`   ③ 시각 지나면 돈다    ${정산.length ? '○' : '✕'}`);
  console.log(`   ④ 결과가 도착한다     ${도착.length ? '○' : '✕'}`);
  console.log('   ② 지시문이 그 일인가 · 「안 도는 조건」 고지 → 위 답과 job 을 사람이 읽는다');
} finally {
  서버?.kill();
  await 잠깐(500);
  await rm(방, { recursive: true, force: true }).catch(() => {});
}
