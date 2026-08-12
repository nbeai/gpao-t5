// **자동화 닫는 문장을 재는 대본** (design/T5-AUTOMATION-CLOSE-ko.md §1 삼중 금고 그대로).
//
// 채점을 T5 영수증으로 하지 않는다 — 판정은 **저장소 파일과 대화 기록**이 한다.
// 오너 서버(4173)를 끄지 않는다: 격리 포트 + 격리 데이터 자리로 돌린다.
//
// 재는 것 넷 + 고지 하나:
//   ① 그 발화에 **job 이 실제로 서는가** (candidate 아니라 job)
//   ② 그 job 의 실행 지시문이 **사용자가 말한 그 일**인가 (남의 스킬 목적이 아닌가)
//   ③ 시각이 지나면 **실제로 도는가** (nextRunAt 을 과거로 둔 판 + 재기동 따라잡기)
//   ④ 결과가 **사용자 자리에 도착**하는가 (`deliveries.json` state=delivered·exactCount=1
//      **그리고** 세션 transcript)
//   ⑤ 답이 **안 도는 조건**을 말하는가 — 문구는 사람이 읽고, 기계는 **값이 원장과 같은가**만 잰다
//
// ── **여러 회차를 돈다** (2026-08-12) ──────────────────────────────────────────
// 앞 회차는 n=1 이었고 그것도 손 curl 회차였다. `n=1` 을 「선다」로 세우지 않는다
// (닫는문서 §5 — ③④ 를 「계측불가」로 적어 둔 이유가 그것이다). 회차마다 **자기 격리 자리와
// 자기 포트**를 쓰고, 끝에 성공률 표를 낸다.
//
// 쓰는 법: node scripts/live/automation-close.mjs [뿌리] [문장] [시작포트] [회차수]
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, mkdir, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// 저장소 뿌리는 이 파일 자리에서 센다 — 경로를 박으면 다른 설치에서 안 돈다.
const 뿌리 = process.argv[2] ?? dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const 문장 = process.argv[3] ?? '매일 아침 9시에 다운로드 폴더에 새로 생긴 PDF 개수를 알려줘.';
const 시작포트 = Number(process.argv[4] ?? 4295);
const 회차수 = Number(process.argv[5] ?? 5);
// **틱을 짧게 둔다.** 기본 60초로는 재기동 따라잡기 한 번에 회차당 1분이 든다.
// 시각을 당기는 것이 아니다(§1 규율은 그대로) — 재는 자의 **폴링 주기**만 줄인다.
const 틱 = process.env.GPAO_T5_TICK_MS ?? '3000';

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));

/** 회차 하나. **자기 자리·자기 포트**를 쓰고 끝나면 자기가 치운다. */
async function 회차(번호, 요청포트) {
  const 방 = await mkdtemp(join(tmpdir(), 'auto-close-'));
  const 자리 = join(방, 'state');
  let 실제포트 = 요청포트;   // 서버가 옮기면 그 값으로 바뀐다(아래 stdout)
  let 알림 = null;           // **이번 기동이** 스스로 알린 포트. 안 알렸으면 두드리지 않는다
  let 서버;
  const 판정 = {
    번호, job: false, 지시문: false, 실행: false, 도착: false,
    고지값: null, 답: '', 실패: null,
  };

  // **모델 연결만 격리 자리로 옮긴다.** 없으면 모델이 안 붙어 회차가 0.1초에 끝난다(밟음).
  // 오너 자리는 **읽기만** 한다 — 이 저장소 규율이다.
  const 연결옮기기 = async () => {
    const 원 = join(process.env.HOME, '.local/state/gpao-t5/sessions');
    // GPAO_T5_DATA_DIR 을 주면 파일이 **그 자리 바로 아래** 산다(밟음) — 오너 자리가
    // `…/gpao-t5/sessions` 인 것은 기본값이 그 경로일 뿐이다. 여기서 `sessions` 를 또 붙이면
    // 서버가 못 찾고 stub 모델로 뜬다.
    await mkdir(자리, { recursive: true });
    for (const f of ['model-connection.json', 'install.json']) {
      try { await copyFile(join(원, f), join(자리, f)); }
      catch (e) { console.error(`  연결 옮기기 실패: ${f} — ${e.message}`); }
    }
  };

  const 서버띄우기 = async () => {
    // **제품 진입점으로 띄운다.** `src/surface/server.js` 를 직접 부르면 `liveDeps()` 를 안 지나
    // 손이 덜 선다 — 그러면 `model-control.js:428` 의 `hands.length` 게이트가
    // `automation.propose` 를 통째로 걷어내고, 모델은 "예약이 막혀 있다"고 정직하게 답한다.
    // 사용자가 실제로 쓰는 것은 이 진입점이므로, 재는 것도 이것이어야 한다(2026-08-12 밟음).
    // ★ **`--no-open` 없이 띄우지 않는다.** 제품 진입점은 기동할 때마다 브라우저 탭을 연다
    // (`bin/gpao-t5.mjs:48,59` — `if (!flag('--no-open')) await openBrowser(url)`).
    // 이 대본은 회차마다 **두 번** 띄우므로(첫 기동 + 재기동 따라잡기), 5회차면 탭이 10개 열린다.
    // 실제로 오너 크롬에 T5 탭이 계속 열리는 피해가 났다(2026-08-12). **계측기가 사용자
    // 화면을 어지럽히면 안 된다** — 재는 자가 재는 대상의 자리를 건드린 것이고, 오늘의
    // 「재는 자가 틀렸다」 목록 중 유일하게 **오너 자리에 실제 피해**를 낸 항목이다.
    // 기동 자리가 늘면 여기에도 반드시 같이 붙인다 — 한 곳만 빠져도 그만큼 열린다.
    서버 = spawn('node', ['bin/gpao-t5.mjs', '--no-open'], {
      cwd: 뿌리, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(요청포트), GPAO_T5_DATA_DIR: 자리, GPAO_T5_TICK_MS: 틱,
        ...(process.env.GPAO_T5_PROMPT_DUMP ? { GPAO_T5_PROMPT_DUMP: process.env.GPAO_T5_PROMPT_DUMP } : {}) },
    });
    // ★ **서버가 알려준 포트를 쓴다.** 제품 진입점은 포트가 막혀 있으면 **실패하지 않고
    // 조용히 옮긴다**("다른 프로그램이 기본 연결 위치를 쓰고 있어서 안전한 위치로 바꿨어요").
    // 그 줄은 stdout 인데 예전엔 통째로 버렸고, 대본은 원래 포트를 폴링해 **남의 서버**와
    // 말했다. 200 이 오니 준비된 줄 알고, 이후 모든 턴이 그리로 갔다 — 대본은 자기 격리
    // 자리를 읽으므로 영원히 0건. 그렇게 5회 연속 「job 0건」을 냈고 전부 거짓이었다
    // (2026-08-12 · 같은 시각 다른 대본은 10/10).
    // **이번 기동이 스스로 알린 포트만 믿는다.** 재기동에서 옛 서버가 아직 안 죽었으면
    // `/health` 를 **그 옛 서버가** 받는다 — 200 이 오니 준비된 줄 알고 이어가다가, 옛 서버가
    // 마저 죽는 순간 `fetch failed` 로 회차가 깨진다(밟음 2026-08-12). 「남의 서버와 말했다」의
    // 새 얼굴이고, 이번엔 남이 아니라 **자기 앞 회차**였다.
    알림 = null;
    서버.stdout.on('data', (b) => {
      const m = String(b).match(/https?:\/\/localhost:(\d+)/);
      if (m) { 실제포트 = Number(m[1]); 알림 = 실제포트; }
    });
    서버.stderr.on('data', (b) => { const s = String(b); if (/Error|error/.test(s)) process.stderr.write(s.slice(0, 300)); });
    // **재기동은 첫 기동보다 오래 걸린다**(밟음 2026-08-12 · 5회차 중 3회가 여기서 죽었다):
    // 밀린 회차가 틱 한 번에 바로 떠서 **모델을 부르며** 부팅과 겹친다. 20초로는 모자랐다.
    for (let i = 0; i < 120; i += 1) {
      await 잠깐(500);
      if (알림 === null) continue;   // 이번 기동이 아직 자기 자리를 안 알렸다 — 두드리지 않는다
      try { const r = await fetch(`http://127.0.0.1:${실제포트}/health`); if (r.ok) return; } catch { /* 아직 */ }
    }
    throw new Error(`서버가 안 떴다(요청 ${요청포트} · 실제 ${실제포트})`);
  };

  /**
   * **죽을 때까지 기다린다.** 안 기다리면 포트를 쥔 채로 다음 기동이 겹친다.
   *
   * ⚠️ **신호로 죽은 프로세스는 `exitCode` 가 null 이다**(`signalCode` 쪽에 들어간다).
   * 첫 판이 `exitCode !== null` 만 보고 「아직 살아 있다」로 읽어, 이미 끝난 `exit` 를
   * 다시 기다리다 **영원히 안 끝났다** — 회차 하나가 통째로 매달렸다(밟음 2026-08-12 ·
   * `unsettled top-level await`). 그리고 시한도 결국 같은 약속을 기다려 빠져나갈 문이 없었다.
   * 이제 시한은 **스스로 풀린다** — 재는 자가 매달리면 재는 것이 통째로 없어진다.
   */
  const 서버죽이기 = async () => {
    const p = 서버;
    if (!p || p.exitCode !== null || p.signalCode !== null) return;
    await new Promise((ok) => {
      let 끝났나 = false;
      let 늦기, 아주늦기;
      const 마침 = () => {
        if (끝났나) return;
        끝났나 = true; clearTimeout(늦기); clearTimeout(아주늦기); ok();
      };
      p.once('exit', 마침);
      try { p.kill(); } catch { 마침(); return; }
      // SIGTERM 을 못 받고 버티면(모델 호출 중) 강제로 내린다 — 안 그러면 포트가 안 풀린다.
      늦기 = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* 이미 죽음 */ } }, 5000);
      아주늦기 = setTimeout(마침, 10_000);   // 그래도 안 죽으면 포기하고 나아간다
    });
  };

  const 기지 = () => `http://127.0.0.1:${실제포트}`;
  let 쿠키 = '';
  const 부르기 = async (경로, 본문) => {
    const r = await fetch(기지() + 경로, {
      method: 본문 ? 'POST' : 'GET',
      headers: { cookie: 쿠키, ...(본문 ? { 'content-type': 'application/json' } : {}) },
      ...(본문 ? { body: JSON.stringify(본문) } : {}),
    });
    const t = await r.text();
    try { return { 상태: r.status, 값: JSON.parse(t) }; } catch { return { 상태: r.status, 값: t }; }
  };
  const 자동화파일 = () => join(자리, 'automation.json');
  const 읽기 = async (이름) => JSON.parse(await readFile(join(자리, 이름), 'utf8').catch(() => '{}'));

  try {
    await 연결옮기기();
    await 서버띄우기();
    쿠키 = String((await fetch(기지() + '/')).headers.get('set-cookie') ?? '').split(';')[0];
    const s = (await 부르기('/sessions', {})).값;
    console.log(`\n${'━'.repeat(70)}\n■ 회차 ${번호} · 격리 자리 ${자리} · 세션 ${s.id}`);

    const t0 = Date.now();
    const r = await 부르기('/turn', { sessionId: s.id, text: 문장 });
    const 답 = String(r.값?.result?.reply ?? r.값?.reply ?? '');
    판정.답 = 답;
    // **켜는 손 반환값** — ⑤ 의 대조 기준이다(답이 지어낸 값인지 여기와 맞춰 본다).
    판정.고지값 = r.값?.result?.automationProposal?.notRunning
      ?? r.값?.automationProposal?.notRunning ?? null;
    console.log(`\n■ 나온 답 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    console.log('   ' + 답.replace(/\n/g, '\n   ').slice(0, 1200));
    console.log(`\n■ 켜는 손이 돌려준 안 도는 조건: ${JSON.stringify(판정.고지값)}`);

    // ── ① job 이 섰나 (T5 말이 아니라 파일) ──────────────────────────────────
    // **응답 직후에 읽으면 못 본다**(밟음 2026-08-12): 저장이 응답보다 늦어 후보 1건을
    // 0건으로 읽었고, 하마터면 「모델이 없는 후보를 말한다」는 결함을 지어낼 뻔했다.
    const 멎을때까지 = async () => {
      let 앞 = '';
      for (let i = 0; i < 12; i += 1) {
        await 잠깐(500);
        const 지금 = await readFile(자동화파일(), 'utf8').catch(() => '');
        if (지금 && 지금 === 앞) return;
        앞 = 지금;
      }
    };
    await 멎을때까지();
    const a = await 읽기('automation.json');
    const 후보 = a.candidates ?? []; const jobs = a.jobs ?? [];
    console.log(`\n■ 실물 ① automation.json — 후보 ${후보.length}건 · job ${jobs.length}건`);
    for (const j of jobs) {
      console.log(`     job: ${String(j.name ?? '').slice(0, 60)}`);
      console.log(`          skillRef=${j.skillRef?.id ?? '(없음)'} · nextRunAt=${new Date(j.trigger?.nextRunAt ?? j.nextRunAt ?? 0).toISOString()}`);
    }
    for (const c of 후보) console.log(`     후보(${c.state}): ${String(c.statement ?? '').slice(0, 60)}`);
    판정.job = jobs.length > 0;
    // ② 지시문이 **이 발화에서 파생된 1회용 스킬**인가 — 남의 스킬에 묶이면 다른 일이 돈다.
    판정.지시문 = jobs.some((j) => String(j.skillRef?.id ?? '').startsWith('direct-automation:'));
    if (!판정.job) {
      console.log('\n   → **job 이 안 섰다.** ①에서 멈춘다 — ③④ 는 잴 자리가 없다.');
      return 판정;
    }

    // ── ③ 시각을 과거로 두고 재기동 따라잡기 — 시계를 당기지 않고 판을 옮긴다(§1 규율) ──
    //
    // ⚠️ **임의의 「90분 전」은 안 통한다**(밟음 2026-08-12 · 5회차 전부 실행 0건).
    // 달력 트리거는 그 시각이 **실제 발생 시각**일 때만 놓친 회차로 읽는다. 아무 과거나 적으면
    // 트리거가 그것을 자기 발생으로 못 알아보고 그냥 다음 9시를 다시 계산한다.
    // A2 검사(`test/a2-explicit-reservation-turns-on.test.js`)가 이 자리를 이미 적어 뒀다:
    // *"임의의 「1분 전」이 아니라 실제 발생 시각이어야 달력 트리거가 그것을 놓친 회차로 읽는다."*
    //
    // 그래서 **레코드가 가진 다음 시각에서 한 주기만큼 되돌린다** — 그러면 그것은 정의상
    // **지나간 그 시각**(어제 아침 9시)이고, 따라잡기 한도 1회에 정확히 맞는 회차 하나다.
    const 한주기 = (t) => {
      if (t?.kind === 'daily') return 24 * 60 * 60 * 1000;
      if (t?.kind === 'weekly') return 7 * 24 * 60 * 60 * 1000;
      if (t?.kind === 'interval' && Number(t.intervalMs) > 0) return Number(t.intervalMs);
      return null;   // once — 되돌릴 주기가 없다
    };
    const 옮김 = JSON.parse(await readFile(자동화파일(), 'utf8'));
    for (const j of 옮김.jobs ?? []) {
      const 다음 = Number(j.trigger?.nextRunAt ?? j.nextRunAt);
      const 주기 = 한주기(j.trigger);
      // once 는 되돌릴 주기가 없으니 그냥 조금 전으로 둔다(그 자체가 발생 시각이다).
      const 과거 = 주기 && Number.isFinite(다음) ? 다음 - 주기 : Date.now() - 60 * 1000;
      if (j.trigger) j.trigger.nextRunAt = 과거;
      if (j.nextRunAt !== undefined) j.nextRunAt = 과거;
      console.log(`     job ${String(j.id ?? '').slice(0, 8)} · ${new Date(다음).toISOString()}`
        + ` → ${new Date(과거).toISOString()} (한 주기 전 = 지나간 그 시각)`);
    }
    await writeFile(자동화파일(), JSON.stringify(옮김, null, 2), 'utf8');
    console.log('\n■ nextRunAt 을 한 주기 전(지나간 그 시각)으로 옮겼다(시계는 안 건드린다). 서버를 다시 띄운다.');
    // **옛 서버가 완전히 죽은 뒤에 띄운다.** 겹치면 새 서버가 포트를 뺏겨 조용히 옮기고,
    // 그러면 아래 폴링이 **죽은 옛 포트**를 두드리다 「서버가 안 떴다」로 끝난다(밟음).
    await 서버죽이기();
    실제포트 = 요청포트;   // 옛 기동에서 옮긴 값을 물려받지 않는다 — 새 기동이 다시 알려준다
    await 잠깐(1000);
    await 서버띄우기();
    쿠키 = String((await fetch(기지() + '/')).headers.get('set-cookie') ?? '').split(';')[0];

    // **실행 흔적은 `automation.json` 이 아니라 `automation-run-state.json` 에 있다.**
    // `settlements` 를 보다가 「안 돈다」로 읽을 뻔했다 — 잘못된 자리를 봤던 회차가 있다.
    // 그리고 **실행이 끝날 때까지 기다린다.** 3초만 기다렸더니 아직 `scheduled` 였고
    // 「결과가 안 온다」로 읽을 뻔했다 — 재는 자가 성급하면 없는 결함이 생긴다.
    let 실행 = [];
    for (let k = 0; k < 90; k += 1) {
      await 잠깐(1000);
      실행 = (await 읽기('automation-run-state.json')).runs ?? [];
      if (실행.some((x) => ['succeeded', 'failed'].includes(x.status ?? x.state))) break;
    }
    console.log(`\n■ 실물 ② 실행 흔적(automation-run-state.json) ${실행.length}건`);
    for (const x of 실행.slice(-3)) {
      console.log(`     ${x.status ?? x.state ?? '?'} · scheduledFor=${x.scheduledFor ?? '?'} · run=${String(x.runId ?? x.id ?? '').slice(0, 8)}`);
    }
    판정.실행 = 실행.some((x) => (x.status ?? x.state) === 'succeeded');

    // ── ④ 결과가 사용자 자리에 도착했나 ────────────────────────────────────
    // **두 자리를 함께 본다**: 배달 원장(기계 사실)과 대화 기록(사용자가 실제로 보는 것).
    // 앞 회차는 대화 기록만 봤고 그래서 배달이 `attempting` 에서 멎어도 못 봤다.
    let 배달 = []; let 도착 = [];
    for (let k = 0; k < 90; k += 1) {
      배달 = (await 읽기('deliveries.json')).deliveries ?? [];
      const 세션 = (await 부르기(`/sessions/${s.id}`)).값;
      도착 = (세션?.transcript ?? []).filter((x) => x?.source === 'automation' || x?.result?.source === 'automation');
      if (배달.some((d) => d.state === 'delivered') && 도착.length) break;
      await 잠깐(1000);
    }
    const 확정배달 = 배달.filter((d) => d.state === 'delivered' && d.receipt?.exactCount === 1);
    console.log(`\n■ 실물 ③ 배달 원장 ${배달.length}건 (delivered·exactCount=1 → ${확정배달.length}건)`);
    for (const d of 배달.slice(-2)) console.log(`     ${d.state} · exactCount=${d.receipt?.exactCount ?? '?'} · conv=${String(d.target?.conversationRef ?? '').slice(0, 8)}`);
    console.log(`■ 실물 ④ 대화 도착 ${도착.length}건`);
    for (const d of 도착.slice(-1)) console.log('     ' + JSON.stringify(d).slice(0, 300));
    // **둘 다 참일 때만 도착이다** — 원장만 참이면 사용자는 못 본다.
    판정.도착 = 확정배달.length > 0 && 도착.length > 0;
    return 판정;
  } catch (e) {
    판정.실패 = e?.message ?? String(e);
    console.error(`  회차 ${번호} 실패: ${판정.실패}`);
    return 판정;
  } finally {
    // ⚠️ **`process.exit` 을 쓰지 않는다.** `finally` 를 건너뛰어 서버가 안 죽고, 다음 회차가
    // 그 좀비에 붙는다 — 그러면 **옛 코드·옛 데이터 자리**를 재게 된다(2026-08-12 밟음).
    // 실제로 4회 연속 「job 0건」이 나왔고, 같은 시각 다른 대본은 10/10 이었다.
    // 게다가 좀비 자리에는 후보가 쌓여 있어서 모델이 *"이미 후보가 5개 떠 있어요"* 라고 말했고,
    // 나는 그것을 환각으로 의심했다 — **모델은 정직했고 재는 자가 거짓말했다.**
    await 서버죽이기();
    await 잠깐(500);
    await rm(방, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * ⑤ **답이 지어낸 값을 말하는가** — 문구 판정이 아니다.
 *
 * 「안 도는 조건을 말했나」는 사람이 읽는다(문구 목록을 만들면 F-12 다). 기계가 재는 것은
 * 하나뿐이다: 답이 **그 축의 숫자를 말했다면 그것이 원장 값과 같은가.** 다르면 지어낸 값이다.
 */
function 값대조(답, 고지값) {
  if (!고지값) return { 어긋남: [], 실린값: [] };
  const 어긋남 = [];
  const 실린값 = [];
  const t = String(답);
  // **답이 날짜를 말했으면 원장의 그 날짜여야 한다.** 날짜는 형식이 좁아 기계로 안전하게 잡힌다.
  if (Number.isFinite(고지값.authorityExpiresAt)) {
    const 원장날 = new Date(고지값.authorityExpiresAt);
    for (const m of t.matchAll(/(\d{4})[-.\s년]+(\d{1,2})[-.\s월]+(\d{1,2})/g)) {
      const 같나 = Number(m[1]) === 원장날.getFullYear()
        && Number(m[2]) === 원장날.getMonth() + 1 && Number(m[3]) === 원장날.getDate();
      if (같나) 실린값.push(`만료일=${m[0]}`);
      else 어긋남.push(`답의 날짜 ${m[0]} ≠ 원장 만료 ${원장날.toISOString().slice(0, 10)}`);
    }
  }
  // **나머지 축은 「어긋났다」를 기계로 못 판정한다.** 답이 그 축을 아예 안 말했을 수도 있고,
  // 말했는지는 문구를 봐야 알 수 있는데 그것은 이 자리가 하지 않는 일이다(F-12).
  // 그래서 **신호만 적는다**: 원장 값이 답에 글자로 있는가. 판정 칸이 아니라 읽는 사람의 실마리다.
  const 숫자들 = [...t.matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, '')));
  for (const [이름, 값] of [['따라잡기한도', 고지값.catchUpLimit], ['최대횟수', 고지값.maxRuns]]) {
    if (Number.isFinite(값) && 숫자들.includes(값)) 실린값.push(`${이름}=${값}`);
  }
  return { 어긋남, 실린값 };
}

const 표 = [];
for (let i = 1; i <= 회차수; i += 1) {
  // 회차마다 포트를 옮긴다 — 앞 회차의 좀비가 남아도 그 자리로 안 간다.
  표.push(await 회차(i, 시작포트 + i * 2));
}

console.log(`\n${'━'.repeat(70)}\n■ 닫는 문장 판정표 (${회차수}회차)\n`);
console.log('회차 | ① job | ② 지시문 | ③ 돈다 | ④ 도착 | ⑤ 값 어긋남 | 답에 실린 원장값(신호)');
console.log('-----|-------|----------|--------|--------|-------------|----------------------');
for (const p of 표) {
  const v = 값대조(p.답, p.고지값);
  console.log(`  ${String(p.번호).padEnd(3)}|   ${p.job ? '○' : '✕'}   |    ${p.지시문 ? '○' : '✕'}     `
    + `|   ${p.실행 ? '○' : '✕'}    |   ${p.도착 ? '○' : '✕'}    | ${(v.어긋남.length ? v.어긋남.join(' / ') : '없음').padEnd(11)}`
    + ` | ${v.실린값.join(' · ') || '(없음)'}`
    + (p.실패 ? `  (실패: ${p.실패})` : ''));
}
const 센다 = (칸) => 표.filter((p) => p[칸]).length;
console.log(`\n성공률 — ① ${센다('job')}/${회차수} · ② ${센다('지시문')}/${회차수} · `
  + `③ ${센다('실행')}/${회차수} · ④ ${센다('도착')}/${회차수}`);
console.log('\n⑤ 「안 도는 조건」을 답이 말했는지는 **사람이 위 답 원문을 읽는다** — 문구 판정은 기계가 안 한다.');
console.log('   기계가 잰 것은 「답이 말한 값이 원장 값과 같은가」뿐이고, 그것이 위 마지막 칸이다.');
