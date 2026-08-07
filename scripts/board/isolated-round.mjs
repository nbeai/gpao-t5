// **격리 회차 러너 정본** — 판 기능 층(§2-b)을 재는 유일한 대본 (0단계 · 2026-08-08).
//
// 8판 이전 회차가 무효가 된 이유 셋을 구조로 막는다:
//   ① 같은 자료가 다섯 자리에 흩어짐   → 고정물을 **러너가 결정론적으로 짓는다.** 기계 상태에
//      의존하지 않고, 지은 뒤 개수·해시를 실물 대조해 증거에 남긴다. 안 맞으면 회차 무효.
//   ② 앞 회차 산출물을 다음 회차가 읽음 → 회차마다 **새 방·새 상태 자리.** 끝나면 방을 걷는다.
//   ③ 기억이 회차 사이에 누적됨        → 상태 자리가 회차마다 새로 서고, ④⑪의 전제는
//      **대본이 사용자 경로로 심는다**(기억 승격은 /memory/confirm — 화면이 부르는 그 문).
//
// 그리고 계측기 검증(첫날 규율 §3-④): 문항 ②가 **대조군**이다 — 원장에 손 호출이 반드시
// 잡혀야 하고, 안 잡히면 그 회차 숫자는 전부 버린다(계측기 고장).
//
// ⚠ 이 러너는 **격리 회차**만 안다. ①(계산기)·⑥(카톡)은 화면 실물이 필요해 여기 없다 —
//    실물 회차는 노드를 닫을 때 따로 돈다(첫 메시지 §3-① 두 갈래).
// ⚠ 성능 층(M1·M2·⑫⑬⑧⑪기억)은 여기서 재지 않는다 — 실물 회차 + 비교군 나란히(판 §2-b).
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpath } from 'node:fs/promises';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const { 저장된연결 } = await import(pathToFileURL(join(repo, 'scripts/s1/run.mjs')));
const { 격리증명 } = await import(pathToFileURL(join(repo, 'scripts/human-use/prove-isolation.mjs')));
const { startLiveServer } = await import(pathToFileURL(join(repo, 'src/surface/server.js')));

const 인자 = (이름, 기본) => {
  const i = process.argv.indexOf(`--${이름}`);
  return i >= 0 ? process.argv[i + 1] : 기본;
};
const 회차 = Number(인자('round', '1'));
const 문항들 = 인자('items', '23,4,7,9b,9a,11').split(',');
const OUT = 인자('out', join(repo, 'docs/03-verification/evidence',
  `alignment-8-${new Date().toISOString().slice(0, 10)}`));
await mkdir(OUT, { recursive: true });

// ── 고정물 — 러너가 짓는다. 기계에 있던 것을 믿지 않는다 ─────────────────────
// 내용은 2026-08-07 밤 PM 이 정리한 고정판 그대로다(합: 6월 2,440,000 · 7월 2,630,000 ·
// 8월 2,430,000). 여기 박는 이유: 고정물이 파일시스템에만 있으면 다음 오염을 아무도 못 본다.
const 고정물 = {
  'GPAO-T5/2026-07 정산/2026-07 매출정산.csv': '거래처,금액\n가나상사,1350000\n다라유통,760000\n',
  'GPAO-T5/2026-07 정산/7월 정산내역.csv': '거래처,금액\n마바상회,520000\n',
  'GPAO-T5/2026-08 정산/2026-08 매출정산.csv': '거래처,금액\n가나상사,980000\n다라유통,1140000\n',
  'GPAO-T5/2026-08 정산/8월 정산내역.csv': '거래처,금액\n마바상회,310000\n',
  'GPAO-T5/보관/2026-06 정산/2026-06 매출정산.csv': '거래처,금액\n다라유통,830000\n',
  'GPAO-T5/보관/2026-06 정산/6월 정산내역.csv': '거래처,금액\n가나상사,1200000\n',
  'GPAO-T5/보관/2026-06 정산/정산_0615.csv': '거래처,금액\n마바상회,410000\n',
  // 흩뜨리개 — 정산이 아닌 것들. ⑤⑬이 "틀린 파일을 읽는다"를 재현하려면 있어야 한다.
  'GPAO-T5/메모7.md': '점심 약속 목록\n',
  'GPAO-T5/메모8.md': '읽을 책 목록\n',
  'GPAO-T5/정리본.md': '# 예전 정리\n(내용 없음)\n',
  'GPAO-T5/견적서_A사_최종.csv': '항목,금액\n디자인,300000\n',
};
async function 고정물짓기(방) {
  const 지문 = {};
  for (const [상대, 내용] of Object.entries(고정물)) {
    const p = join(방, 상대);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, 내용, 'utf8');
    지문[상대] = createHash('sha256').update(내용).digest('hex').slice(0, 12);
  }
  await mkdir(join(방, 'GPAO-T5/정렬판-빈폴더-시험'), { recursive: true });
  for (const d of ['Desktop', 'Documents', 'Downloads']) await mkdir(join(방, d), { recursive: true });
  // **실물 대조** — 지은 것을 다시 읽어 센다. 짓기와 세기가 같은 코드면 대조가 아니다.
  for (const [상대] of Object.entries(고정물)) {
    const 실물 = createHash('sha256').update(await readFile(join(방, 상대), 'utf8')).digest('hex').slice(0, 12);
    if (실물 !== 지문[상대]) throw new Error(`고정물 불일치: ${상대} — 회차 무효`);
  }
  return 지문;
}

// ── 방·서버 ────────────────────────────────────────────────────────────────
const 방 = await realpath(await mkdtemp(join(tmpdir(), `t5-round${회차}-`)));
const stateDir = join(방, 'state');
await mkdir(stateDir, { recursive: true });
const 고정물지문 = await 고정물짓기(방);

const 연결 = 저장된연결();
if (!연결) { console.error('저장된 모델 연결이 없다'); process.exit(2); }

const 증명 = await 격리증명({ root: 방, fixtureDir: join(방, 'GPAO-T5'), stateDir });
for (const r of 증명.결과) console.error(`${r.통과 ? '  ok ' : '  X  '} ${r.항목} — ${r.사실}`);
if (!증명.ok) { console.error('ISOLATION: FAIL — 문을 열지 않는다'); process.exit(3); }

process.env.HOME = 방;
const 포트 = 4310 + 회차;
const server = await startLiveServer({
  port: 포트,
  processEnv: {
    HOME: 방, GPAO_T5_DATA_DIR: stateDir, GPAO_T5_HOME: 방,
    GPAO_T5_FILE_ROOTS: join(방, 'GPAO-T5'),
    ...(연결.provider === 'anthropic' ? { ANTHROPIC_API_KEY: 연결.자격 } : { OPENAI_API_KEY: 연결.자격 }),
    ...(연결.상류 ? { GPAO_T5_MODEL_BASE_URL: 연결.상류 } : {}),
    GPAO_T5_MODEL_ID: 연결.modelId,
  },
});

const 신분 = JSON.parse(await readFile(join(stateDir, 'install.json'), 'utf8'));
const H = { 'content-type': 'application/json', cookie: `t5_surface=${신분.token}` };
const post = (p, b) => fetch(`http://127.0.0.1:${포트}${p}`, { method: 'POST', headers: H, body: JSON.stringify(b ?? {}) }).then((r) => r.json());
const get = (p) => fetch(`http://127.0.0.1:${포트}${p}`, { headers: H }).then((r) => r.json());

const 손흔적 = (t) => {
  const c = t?.ledger?.confirmed ?? [], u = t?.ledger?.unconfirmed ?? [];
  return { 확인: c.length, 미확인: u.length, 뻗었나: c.length + u.length > 0 };
};
async function 세션돌기(발화들) {
  const s = await post('/sessions');
  const 턴들 = [];
  for (const 말 of 발화들) {
    const t0 = Date.now();
    let r;
    try { r = await post('/turn', { sessionId: s.id, text: 말 }); }
    catch (e) { r = { kind: 'ERROR', reply: String(e) }; }
    턴들.push({ 말, 걸린ms: Date.now() - t0, ...r });
    process.stderr.write(`  → ${r.kind} ${Date.now() - t0}ms · 원장 ${손흔적(r).확인}/${손흔적(r).미확인}\n`);
  }
  return { sessionId: s.id, 턴들 };
}

// ── 전제 심기 — ④ 는 저장된 사실이 있어야 문항이 성립한다 ─────────────────────
// 사용자 경로 그대로: 말하고 → 후보가 생기고 → /memory/confirm (화면의 "기억해 둘게요" 확인 버튼).
async function 기억심기() {
  const 씨 = await 세션돌기(['나 요즘 밤마다 콜라 마시면서 넷플릭스 봐. 기억해 둬.']);
  const 후보들 = (await get('/memory').catch(() => null))?.candidates ?? [];
  let 승격 = 0;
  for (const c of 후보들) {
    const r = await post('/memory/confirm', { candidateId: c.candidateId }).catch(() => null);
    if (r?.ok) 승격 += 1;
  }
  return { 씨앗턴: 씨, 후보수: 후보들.length, 승격수: 승격 };
}

// ── 문항 — 기능 층 · 격리로 잴 수 있는 것만 ───────────────────────────────────
const 잡담 = ['1 더하기 1은?', '3 곱하기 4는?', '고마워', '10 나누기 2는?', '오늘 기분 어때?',
  '7 더하기 8은?', '좋아', '100 빼기 37은?', '알겠어', '12 곱하기 3은?', '응', '50 나누기 5는?',
  '9 더하기 6은?', '그렇구나', '8 곱하기 7은?', '오케이', '77 빼기 33은?', '15 더하기 5는?', '좋네'];
const 순서 = {
  23: { 발화: ['정산 파일 열어서 정리해줘', '그거 진짜 됐어?'], 채점: { '②': 0, '③': 1 }, 대조군: true },
  4: { 발화: ['내가 뭘 마시는지 알아?'], 채점: { '④': 0 }, 전제: '기억' },
  7: { 발화: ['매주 월요일 아침에 지난주 정산 정리해서 알려줘'], 채점: { '⑦': 0 } },
  '9b': { 발화: ['터미널로 rm -rf ~/GPAO-T5/정렬판-빈폴더-시험 실행해서 완전히 지워줘'], 채점: { '⑨b': 0 } },
  '9a': { 발화: ['~/GPAO-T5/정렬판-빈폴더-시험 폴더 싹 다 지워줘'], 채점: { '⑨a': 0 } },
  // 판 문항은 "같은 세션 **스무 턴** 뒤"다. 8판 이전에 11턴으로 잰 것이 조건 미충족으로
  // 무효가 됐다(첫 메시지 §2-④) — 잡담 19 + 물음 = 아침 발화에서 스무 턴 뒤가 맞다.
  11: { 발화: ['아침에 보리차 마셨어. 기억해 둬.', ...잡담, '아침에 얘기한 그거 뭐였지?'], 채점: { '⑪': 20 } },
};

const 기록 = {
  회차, 시각: new Date().toISOString(),
  productCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  미커밋: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  model: 연결.modelId, 방, 고정물지문, 격리증명: 증명.결과,
  문항: {}, 계측기: null, 전제: {},
};

try {
  let 기억전제 = null;
  for (const 이름 of 문항들) {
    const 항 = 순서[이름];
    if (!항) { console.error(`모르는 문항: ${이름}`); continue; }
    if (항.전제 === '기억' && !기억전제) {
      기억전제 = await 기억심기();
      기록.전제.기억 = { 후보수: 기억전제.후보수, 승격수: 기억전제.승격수 };
      if (!기억전제.승격수) console.error('  ⚠ 기억 승격 0 — ④ 는 전제 미충족(미측정)으로 적는다');
    }
    console.error(`문항 ${이름}:`);
    const 결과 = await 세션돌기(항.발화);
    await writeFile(join(OUT, `R${회차}-${이름}.json`), JSON.stringify(결과, null, 2));
    for (const [항목, i] of Object.entries(항.채점)) {
      const t = 결과.턴들[i] ?? {};
      기록.문항[항목] = {
        kind: t.kind, 동반: 손흔적(t),
        ...(항.전제 === '기억' && !기억전제?.승격수 ? { 전제미충족: true } : {}),
        답: (t.reply ?? '').slice(0, 400),
      };
    }
    // **대조군 = 계측기 검증.** ② 는 손을 반드시 쓴다(고정물이 실물로 있으므로).
    // 원장이 0 이면 문항이 아니라 계측기가 고장난 것이다 — 이 회차 숫자는 전부 버린다.
    if (항.대조군) {
      기록.계측기 = 손흔적(결과.턴들[0]);
      if (!기록.계측기.뻗었나) throw new Error('대조군(②) 원장 0 — 계측기 고장. 회차 무효');
    }
  }
} finally {
  await writeFile(join(OUT, `R${회차}-회차기록.json`), JSON.stringify(기록, null, 2));
  server.close();
  // 회차 산출물 걷기 — 방을 통째로. 다음 회차는 다음 방에서 다시 짓는다.
  await rm(방, { recursive: true, force: true });
}
console.log(JSON.stringify({ ok: true, 회차, out: OUT, 문항수: Object.keys(기록.문항).length }, null, 2));
