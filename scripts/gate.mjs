#!/usr/bin/env node
// 빠른 공정 게이트 (v3.1 §19) — 매 슬라이스 종료 시 기계적으로 검사한다.
//
// 왜: "하나도 그냥 넘어가지 않는다"를 지키려면 매번 사람·에이전트 감사를 부를 게 아니라,
// **예/아니오로 끝나는 것은 기계가** 본다. 판단이 필요한 것(범위 이탈·설계 타당성)만 Phase 종료
// 시 깊은 감사로 넘긴다. 이 게이트가 통과하지 않으면 다음 슬라이스로 진입하지 않는다.
//
// 검사: ①라이브 스텁 ②위험 작업 승인 누락 ③"후속" 증가 ④테스트·성능 기준선 ⑤프로세스 산출물 커밋
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { 방크기 } from './dir-size.mjs';
import { 동시성, 유휴초 } from './gate-idle.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const baselineFile = new URL('./gate-baseline.json', import.meta.url);
// 기준선은 **한 번만 읽는다**(단일 진실). 예전엔 ④ 와 마지막 쓰기가 따로 읽어서, 새 기준선을
// 추가하면 조용히 덮여 사라질 수 있었다.
let baseline = {
  deferred: Infinity,
  testCpuSeconds: Infinity,
  testCpuPerTestSeconds: Infinity,
  testIdleSeconds: Infinity, // 기다림의 자 — 벽시계(30s 고정)는 §1-A 로 퇴역했다
};
try { baseline = { ...baseline, ...JSON.parse(await readFile(baselineFile, 'utf8')) }; } catch { /* 최초 실행 */ }
const failures = [];
let 누수기준선 = null; // 커널 말귀 층의 서비스 이름 분기 — 줄어들 때만 따라 내려간다
const notes = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.log(`  ✗ ${m}`); };

// ── ⓪ 정본 진입 경로가 과거 계획·worktree로 갈라지지 않는다 ─────────────
try {
  // 감사의 **경고**(작업 중인 방 · F-101 보탬 2)는 실패가 아니라서 stdout 으로 나온다. 여기서 안 보이면
  // 게이트가 초록인 순간 그 줄이 통째로 사라진다 — 미등재 커밋을 아무도 못 보게 된다.
  const 감사출력 = execFileSync(process.execPath, ['scripts/audit-project-entry.mjs'], {
    cwd: root, stdio: 'pipe', encoding: 'utf8',
  });
  ok('프로젝트 정본·퇴역 문서·worktree 경계');
  for (const l of 감사출력.split('\n')) if (l.includes('⚠')) console.log(`    ${l.trim()}`);
} catch (error) {
  // **두 줄기를 다 싣는다.** stdout 만 보면(예전 판) 경고가 실린 순간 stderr 의 **실패 목록이
  // 통째로 가려진다** — 판정 이유가 안 보이는 게이트가 된다.
  const 원문 = [error.stdout?.toString(), error.stderr?.toString()].filter(Boolean).join('\n').trim();
  bad(`프로젝트 진입 감사 실패: ${원문 || error.message}`);
}

// ── ① 선언한 도구는 라이브에 실제 손이 있다 (§16-C 불변식) ────────────────
// 예전엔 `isFixture` 플래그가 붙은 것만 셌다 — 플래그 없는 유령 선언(`telegram.send`·`mail.send`)은
// 그대로 통과했다. 목록이 아니라 **선언 ⊆ 손** 불변식을 본다.
{
  const { liveDeps } = await import('../src/surface/live-context.js');
  const live = liveDeps({});
  const registry = live.tools?.tools ?? {};
  const handlers = new Set(Object.keys(registry));

  const declared = new Map(); // id → 어디서 선언했는가(사용자에게 뭐라고 말하는가)
  for (const d of live.descriptors ?? []) declared.set(d.id, 'descriptor(도구함)');
  for (const c of live.channels ?? []) if (c.outboundTool) declared.set(c.outboundTool, `채널 ${c.id} 의 보내기`);

  // P5-B-0: **선언 ≠ 실행 가능.** 예전엔 둘을 같은 것으로 봤기 때문에, 연결 전 서비스를
  // 선언할 방법이 아예 없었다(그래서 라이브가 `mail.send` 를 통째로 걸러냈고, 사용자는 메일이
  // 존재한다는 것조차 못 들었다). 이제 잡아야 할 것은 **"실행 가능하다고 말하는데 손이 없는"**
  // 경우다. 연결 전 선언은 `executable:false + reason` 으로 정직하게 표시되면 정상이다.
  const { buildSelfState: 자기상태 } = await import('../src/kernel/l0-evidence/self-state.js');
  const 실행가능 = new Set(자기상태(live.env, { tools: live.tools }).connectedTools
    .filter((t) => t.executable).map((t) => t.id));
  const phantom = [...declared].filter(([id]) => 실행가능.has(id) && !handlers.has(id));
  if (phantom.length) {
    bad(`실행 가능하다면서 손이 없는 도구: ${phantom.map(([id, src]) => `${id}(${src})`).join(', ')} — 배선하거나 실행 불가로 표시할 것`);
  }
  // 1축: **반대 방향도 본다.** 손은 배선했는데 선언이 없으면 그 도구는 모델에게도 도구함에도
  // 안 보인다 — 만들어 놓고 아무도 못 쓰는 상태다(`session.search` 가 정확히 그랬다: 손은 있는데
  // 스키마가 없어서 모델이 "그 기능은 없습니다"라고 답했다). 선언⊆손 만으로는 이걸 못 잡는다.
  const orphanHands = [...handlers].filter((id) => !declared.has(id));
  if (orphanHands.length) {
    bad(`손은 있는데 선언이 없는 도구: ${orphanHands.join(', ')} — 모델·도구함에 안 보인다(descriptor 를 만들 것)`);
  }
  const fixtures = Object.entries(registry).filter(([, t]) => t?.isFixture).map(([id]) => id);
  if (fixtures.length) bad(`라이브에 스텁 등록: ${fixtures.join(', ')} — 등록된 도구는 실제로 동작해야 한다`);

  // **여기까지는 liveDeps 만 본 것이다.** 그걸 서버에 안 넘기면 서버는 demo fixture 로 폴백한다 —
  // Phase 0-5 에서 실제로 그렇게 새서 토큰 없는 채널이 라이브에서 열렸다. 그래서 진짜 서버를 띄워
  // **사용자에게 도달하는 화면**을 확인한다(절대원칙 1: 소스가 아니라 산출물).
  const { startLiveServer } = await import('../src/surface/server.js');
  const { SessionStore } = await import('../src/surface/session-store.js');
  const { mkdtemp } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-gate-'));
  const server = await startLiveServer({
    port: 0, processEnv: {}, sessionStore: new SessionStore(dir), startScheduler: false,
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    // 사람이 하는 그대로 들어간다: 화면을 열면 신분이 붙고 그 다음부터 API 가 열린다(P-DIST-1 §3).
    // 게이트도 **사용자에게 도달하는 경로**로 확인해야 하므로 화면을 건너뛰지 않는다.
    const 쿠키 = ((await fetch(`${base}/`)).headers.get('set-cookie') ?? '').split(';')[0];
    const { tools: shown } = await (await fetch(`${base}/toolbox`, { headers: { cookie: 쿠키 } })).json();
    const surfaced = (shown ?? []).map((t) => t.id);
    // P5-B-0: 도구함에 **보이는 것** 자체는 문제가 아니다(연결 전 서비스도 보여야 사용자가 안다).
    // 문제는 **"지금 쓸 수 있다"고 보이는데 손이 없는** 경우다.
    const unbacked = surfaced.filter((id) => 실행가능.has(id) && !handlers.has(id));
    if (unbacked.length) bad(`도구함에 "쓸 수 있다"로 보이는데 손이 없다: ${unbacked.join(', ')} — liveDeps 를 서버에 안 넘겼는지 확인할 것`);

    // 말귀도 같은 집합만 가리켜야 한다. 없는 도구로 라우팅하면 "연결이 필요해요/[연결 화면 열기]"
    // 라는 **죽은 버튼**이 뜬다 — 연결할 대상이 없으므로 거짓 안내다(재감사 지적).
    const { interpret } = await import('../src/kernel/l1-intent/intent.js');
    const { buildSelfState: bss } = await import('../src/kernel/l0-evidence/self-state.js');
    const liveSelf = bss(live.env);
    for (const text of ['메일로 보내줘', '슬랙에 올려줘', '텔레그램으로 보내줘', '메모.md 지워줘', '뉴스 조사해줘']) {
      const routed = interpret(text, { selfState: liveSelf }).neededTools ?? [];
      // 연결 전 서비스로 라우팅되는 것은 **정상이다** — "메일 계정을 연결하면 가능해요"를
      // 말할 수 있어야 하니까. 죽은 안내는 선언조차 없는 도구로 갈 때다.
      const dead = routed.filter((id) => !handlers.has(id) && !declared.has(id));
      if (dead.length) bad(`"${text}" 가 선언도 손도 없는 도구로 라우팅된다: ${dead.join(', ')} (죽은 연결 안내)`);
    }

    if (!unbacked.length && !phantom.length && !fixtures.length && failures.length === 0) {
      ok(`선언 ${declared.size} · 손 ${handlers.size} · 화면 ${surfaced.length} · 실행 가능 ${실행가능.size}, 스텁 0`);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
}

// ── ② 위험 작업이 승인 없이 실행되지 않는다 (안전 바닥 불변식) ────────────
// 예전엔 위험 발화 **3문장 목록**이었다. 그 목록에 "옮겨줘"가 없어서 파일 이동·되돌리기가
// 승인 없이 실행되는 것을 놓쳤다(Phase 0 감사 blocker). 문장이 아니라 **종류 전체**를 검사한다.
{
  const { fileKind } = await import('../src/kernel/l2-plan/action-plan.js');
  const { decideAutoGrant, SAFETY_FLOOR_KINDS } = await import('../src/kernel/l2-plan/authority.js');
  const { parseFileRequest } = await import('../src/kernel/l1-intent/file-parse.js');
  const before = failures.length;

  // (a) 안전 바닥은 어느 모드에서도 자동 진행하지 않는다.
  for (const kind of SAFETY_FLOOR_KINDS) {
    for (const mode of ['strict', 'smart', 'manual']) {
      if (decideAutoGrant({ kind }, mode)) bad(`안전 바닥 ${kind} 이 ${mode} 모드에서 자동 진행된다`);
    }
  }
  // (b) 파일 도구: 읽기·목록 외의 모든 작업(모르는 작업 포함)은 자동 진행 금지.
  for (const action of ['write', 'move', 'delete', 'undo', undefined, '새로운_작업']) {
    if (decideAutoGrant({ kind: fileKind({ action }) }, 'smart')) {
      bad(`파일 작업 "${action ?? '(미상)'}" 이 승인 없이 실행된다`);
    }
  }
  // (c) 말로 들어오는 표현도 파싱을 거쳐 같은 결론이어야 한다(파서가 바뀌어도 안전 쪽으로).
  for (const text of ['메모.md 지워줘', "메모.md 만들어서 '내용' 적어줘", 'a.md 를 b.md 로 옮겨줘', '방금 거 되돌려줘']) {
    if (decideAutoGrant({ kind: fileKind(parseFileRequest(text)) }, 'smart')) {
      bad(`"${text}" 가 승인 없이 실행된다`);
    }
  }
  // (d) **사람 없는 실행(tick)** 도 같은 바닥을 지킨다. 승인 게이트를 한 층에서 고쳐도 다른 층으로
  //     샌다 — 실제로 턴은 삭제를 막았는데 자동화 tick 이 같은 삭제를 무인 실행했다.
  const { tickAutomation } = await import('../src/runtime/automation-engine.js');
  const { approveAutomation } = await import('../src/kernel/l5-growth/automation.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const irreversible = [
    { tool: 'local.file', args: { action: 'delete', path: 'x.md' } },
    { tool: 'slack.post', args: { text: '안녕' } },
  ];
  for (const action of irreversible) {
    let called = false;
    const job = approveAutomation({ action, statement: '매주' }, { id: 'gate', now: 0, nextRunAt: 0 });
    await tickAutomation([job], {
      tools: { run: async () => { called = true; return { failureState: 'none' }; } },
      selfState: buildSelfState(demoEnv()), now: 1,
    });
    if (called && action.tool === 'local.file') bad(`자동화 tick 이 ${action.tool} 삭제를 무인 실행한다`);
  }
  if (failures.length === before) ok('안전 바닥 불변식 통과(파일 변경·전송·결제·기억 승격 + 무인 실행)');
}

// ── ②-c 터미널: **미끼가 살아있는가** (P6-T2) ─────────────────────────
// 셸을 통째로 열었으므로 여기가 가장 큰 구멍이다. 도구가 "막았어요"라고 말하는지 보지 않는다 —
// 메시지는 거짓말할 수 있지만 파일시스템은 못 한다(어제 blocked 만 보다 ENOENT 를 보호로 셌다).
{
  const before = failures.length;
  try {
    const { runCommand } = await import('../src/runtime/terminal-run.js');
    const { sandboxAvailable } = await import('../src/runtime/sandbox.js');
    const { makeLocalTerminalTool } = await import('../src/runtime/local-terminal.js');
    const { mkdtemp, writeFile, readFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    if (!sandboxAvailable()) {
      // 샌드박스가 없으면 **자동 실행을 열면 안 된다.** 여기서 통과시키면 무방비가 된다.
      bad('이 컴퓨터에서 실행 샌드박스를 쓸 수 없다 — 터미널 자동 실행을 열지 말 것');
    } else {
      const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-gate-term-'));
      const 원본 = '게이트 미끼';
      await writeFile(join(dir, '미끼.md'), 원본);

      // 우회 몇 갈래. 목록으로 막는 설계였다면 아래 절반이 뚫린다.
      for (const cmd of [
        'rm -f 미끼.md',
        'find . -name 미끼.md -delete',
        'python3 -c "import os; os.remove(\'미끼.md\')"',
        'echo 오염 > 미끼.md',
        'perl -e \'unlink("미끼.md")\'',
      ]) {
        await runCommand(cmd, { cwd: dir, timeoutMs: 15_000 });
        let now = null;
        try { now = await readFile(join(dir, '미끼.md'), 'utf8'); } catch { /* 사라짐 */ }
        if (now !== 원본) bad(`터미널로 파일이 바뀌었다: ${cmd}`);
      }

      // 비밀은 승인 뒤에도 안 읽힌다.
      for (const mode of ['probe', 'granted']) {
        const r = await runCommand('cat ~/.ssh/* 2>&1 | head -3', { mode, timeoutMs: 10_000 });
        if (/PRIVATE KEY|ssh-rsa|ssh-ed25519/.test(r.stdout)) bad(`${mode}: 개인키가 읽혔다`);
      }

      // 막기만 하면 도구가 아니다 — 읽기는 승인 없이 통과해야 한다.
      const tool = makeLocalTerminalTool({ cwd: dir });
      const read = await tool.probe('ls -1 && pwd');
      if (read.changes !== false) bad('읽기 명령이 승인 대상으로 잡힌다 — 사용자가 승인을 기계적으로 누르게 된다');
      const write = await tool.probe('rm -f 미끼.md');
      if (write.changes !== true) bad('파일을 지우는 명령이 자동 실행으로 잡힌다');

      // 출력이 프롬프트를 삼키지 않는다.
      const big = await runCommand('seq 1 120000', { cwd: dir });
      if (!big.truncated || !/가운데 \d+자 생략/.test(big.stdout)) bad('큰 출력이 잘렸다는 사실을 안 남긴다');
      if (big.stdout.length > 60_000) bad(`출력 상한이 안 먹는다(${big.stdout.length}자)`);
    }
    if (failures.length === before) ok('터미널: 우회 5갈래 모두 미끼가 살아있고, 읽기는 자동·변경은 승인');
  } catch (e) {
    bad(`터미널 검사 실패: ${e.message}`);
  }
}

// ── ②-d 프로세스: **죽은 걸 살아있다고 하지 않는가** (P6-T3) ─────────────
// 이 표면의 계약은 하나다. 기록에 running 이 남은 것과 실제로 도는 것은 다른 사실이고,
// 그걸 섞으면 사용자는 켜진 줄 알고 기다리고 모델은 없는 서버 위에서 다음 일을 한다.
{
  const before = failures.length;
  try {
    const { makeLocalProcessTool, alive } = await import('../src/runtime/local-process.js');
    const { ProcessStore } = await import('../src/runtime/process-store.js');
    const { lifecycleRisk } = await import('../src/runtime/lifecycle-guard.js');
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const dir = await mkdtemp(join(tmpdir(), 'gpao-t5-gate-proc-'));
    const tool = makeLocalProcessTool({ store: new ProcessStore(dir), dataDir: dir, cwd: dir });
    const 오래 = 'node -e "setInterval(()=>console.log(1),200)"';

    const s = await tool.handler({ action: 'start', command: 오래, label: '게이트서버', settleMs: 250 });
    if (s.blocked || s.result?.status !== 'running') bad(`프로세스를 못 켠다: ${s.userSafeSummary}`);
    else {
      // 밖에서 죽인다 — T5 가 모르는 사이 죽는 실제 상황.
      process.kill(s.result.pid, 'SIGKILL');
      await new Promise((r) => setTimeout(r, 200));
      const st = await tool.handler({ action: 'status' });
      if (st.result?.procs?.[0]?.status === 'running') bad('죽은 프로세스를 살아있다고 말한다');
      const sp = await tool.handler({ action: 'stop', target: '게이트서버' });
      if (!sp.result?.alreadyStopped) bad('이미 죽은 것을 "제가 껐어요"라고 말한다');
    }

    // 시작하자마자 죽는 것을 켰다고 하지 않는다.
    const d = await tool.handler({ action: 'start', command: 'node -e "process.exit(1)"', settleMs: 400 });
    if (!d.blocked) bad('시작하자마자 죽은 것을 "켰어요"라고 말한다');

    // 자기보존: 자기 프로세스·자기 기억·자동 실행 등록.
    const D = '/Users/누구/.local/state/gpao-t5';
    for (const cmd of [`kill ${process.pid}`, 'pkill -f gpao-t5', `rm -rf ${D}`, 'launchctl load x.plist']) {
      if (!lifecycleRisk(cmd, { dataDir: D })) bad(`자기보존 경계를 통과한다: ${cmd}`);
    }
    // **남의 프로세스를 끄는 것도 승인 경계다**(2026-07-28 라이브에서 전제가 깨졌다).
    // 모델이 `kill <pid> 2>/dev/null || true` 를 쓰면 그 관용구가 막혔다는 증거를 지운다 —
    // exitCode 0 → 변경 없음으로 읽혀 승인도 granted 도 안 붙고, 사용자는 승인을 눌러도
    // 아무 일이 안 일어난다. 그 앞 회차에는 승인 없이 프로세스가 죽기까지 했다.
    if (!lifecycleRisk('kill 999999', { dataDir: D })) bad('남의 프로세스를 끄는데 승인 경계가 없다');
    // T5 가 켠 것은 "꺼줘" 한 마디로 끈다 — 거기까지 막으면 그게 능력 축소다.
    if (lifecycleRisk('kill 999999', { dataDir: D, managed: 999999 })) bad('내가 켠 것을 끄는 데 또 승인을 받는다');
    // 막기만 하면 도구가 아니다.
    for (const cmd of ['rm -rf /tmp/남의것', 'npm test']) {
      if (lifecycleRisk(cmd, { dataDir: D })) bad(`평범한 명령이 자기보존에 걸린다: ${cmd}`);
    }
    if (alive(process.pid) !== true) bad('자기 프로세스 확인이 망가졌다');

    if (failures.length === before) ok('프로세스: 죽은 건 죽었다고 말하고, 자기 자신은 끄지 않는다');
  } catch (e) {
    bad(`프로세스 검사 실패: ${e.message}`);
  }
}

// ── ②-e 위생: **소스 트리에 런타임 상태를 만들지 않는다** ────────────────
// 실측: 프로세스 기록이 `src/surface/processes.json` 에 쌓이고 로그가 /tmp 로 흩어졌다.
// 단위 테스트는 dataDir 을 직접 넘겨서 이 경로를 한 번도 안 지나갔다 — 라이브에서야 드러났다.
// "커밋하지 마라"를 사람이 기억하게 두지 않고, 라이브 배선을 실제로 돌려 보고 확인한다.
{
  const before = failures.length;
  try {
    const { readdir } = await import('node:fs/promises');
    const { liveDeps } = await import('../src/surface/live-context.js');
    const 찍기 = async () => {
      const out = [];
      for (const d of ['src', 'src/surface', 'src/runtime', 'src/kernel', 'scripts']) {
        for (const f of await readdir(new URL(`../${d}`, import.meta.url))) {
          if (/\.(json|log|sqlite|db)$/.test(f)) out.push(`${d}/${f}`);
        }
      }
      return out;
    };
    const 전 = await 찍기();
    // 라이브 배선을 세우고 **실제로 기록이 일어나게** 한다. 읽기만 해서는 파일이 안 생겨
    // 경로가 소스 트리로 잡혀 있어도 초록이 뜬다 — 반대 검증에서 실제로 그렇게 놓쳤다.
    const live = liveDeps({});
    const proc = live.tools?.tools?.['local.process'];
    const 켠것 = await proc?.handler?.({ action: 'start', command: 'sleep 5', label: '위생검사', settleMs: 100 });
    if (켠것?.result?.id) await proc.handler({ action: 'stop', target: 켠것.result.id });
    const 후 = await 찍기();
    const 새로생김 = 후.filter((f) => !전.includes(f));
    if (새로생김.length) bad(`소스 트리에 런타임 상태가 생긴다: ${새로생김.join(', ')} — GPAO_T5_DATA_DIR 쪽으로 보낼 것`);
    if (전.length) notes.push(`소스 트리에 이미 있는 데이터 파일: ${전.join(', ')}`);
    if (failures.length === before) ok('위생: 라이브 배선이 소스 트리에 상태 파일을 만들지 않는다');
  } catch (e) {
    bad(`위생 검사 실패: ${e.message}`);
  }
}

// ── ②-f 작업 대상 찾기: **가짜 홈에서 도는가** (P6-W2) ────────────────────
// T5 는 특정 사용자의 개발 보조기가 아니다. 이 검사는 **남의 홈**에서 돌기 때문에,
// 어딘가에 내 경로를 박으면 그 순간 여기서 깨진다 — 하드코딩 금지를 문장이 아니라 구조로 지킨다.
// 그리고 코드 프로젝트만 찾는 도구가 아니라는 것도 여기서 잠근다(정산·계약서·원고·시안).
{
  const before = failures.length;
  try {
    const { makeLocalLocateTool } = await import('../src/runtime/local-locate.js');
    const { mkdtemp, mkdir, writeFile } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const home = await mkdtemp(join(tmpdir(), 'gpao-t5-gate-home-'));
    const 심기 = async (p, files) => {
      await mkdir(join(home, p), { recursive: true });
      for (const f of files) await writeFile(join(home, p, f), 'x');
    };
    await 심기('회계/1분기-정산', ['매출.xlsx', '매입.xlsx', '증빙.pdf']);
    await 심기('거래처/계약서', ['가-계약.pdf', '나-계약.pdf', '약관.docx']);
    await 심기('원고', ['1화.md', '2화.md', '3화.md', '4화.md']);
    await 심기('work/서버', ['package.json', 'a.js', 'b.js', 'c.js']);
    const tool = makeLocalLocateTool({ home });

    // 업무 자료가 코드와 같은 무게로 잡혀야 한다 — 여기가 T5 사용자의 실제 작업 대상이다.
    for (const [말, 기대] of [['정산 자료', /정산/], ['계약서', /계약서/], ['원고', /원고/], ['이 프로젝트', /서버/]]) {
      const [으뜸] = (await tool.handler({ what: 말 })).result.candidates;
      if (!으뜸) { bad(`"${말}" 후보를 못 찾는다`); continue; }
      if (!기대.test(으뜸.path)) bad(`"${말}" 이 엉뚱한 자리를 가리킨다: ${으뜸.path}`);
      if (!으뜸.why) bad(`"${말}" 후보에 근거가 없다 — 사용자가 고를 수 없다`);
      if (!['high', 'medium', 'low'].includes(으뜸.confidence)) bad(`"${말}" 확신도가 없다`);
    }

    // **이름이 안 맞을 때**를 봐야 표식 판정을 실제로 검사한다. 위 검사는 폴더 이름만
    // 맞아도 통과해서, 업무 자료 표식을 통째로 빼도 초록이 떴다(반대 검증에서 드러났다).
    const 종류로 = await tool.handler({ what: '문서 좀 정리하고 싶은데' });
    const 문서후보 = (종류로.result.candidates ?? []).filter((c) => c.kind === 'documents');
    if (!문서후보.length) bad('이름이 안 맞으면 업무 자료를 못 찾는다 — 문서 표식 판정이 죽어 있다');
    const 코드로 = await tool.handler({ what: '개발하던 거 이어서' });
    if (!(코드로.result.candidates ?? []).some((c) => c.kind === 'project')) {
      bad('이름이 안 맞으면 작업 프로젝트를 못 찾는다 — 코드 표식 판정이 죽어 있다');
    }

    // 못 찾은 것을 찾은 척하지 않는다. 자를 고쳤다(3단계 매듭 ① · 2026-08-08):
    // "못 찾았어요" 앞머리를 모델이 "자료 없음"으로 읽어 후보를 버리고 심문했다(⑬ 실측).
    // 재고를 앞세우되 **요청한 이름이 없다는 사실은 명시**한다 — 이 계약이 재는 것은
    // 문구가 아니라 "찾은 척 안 하기"이고, 두 문장 다 그것을 지킨다.
    const 없는것 = await tool.handler({ what: '세무서 제출용 홍보영상' });
    if (!/못 찾았어요|이름 그대로의 자리는 따로 없어요/.test(없는것.userSafeSummary)) {
      bad('없는 것을 찾은 것처럼 말한다');
    }
    if (!없는것.nextSafeAction) bad('못 찾았는데 다음 길이 없다(막다른 답)');

    // 긴 목록이 모델 입력으로 새지 않는다.
    const 많이 = await tool.handler({ what: '자료' });
    if ((많이.result.candidates ?? []).length > 5) bad('후보가 5개를 넘는다 — 프롬프트를 삼킨다');

    if (failures.length === before) ok('작업 대상 찾기: 남의 홈에서도 업무 자료·코드를 근거와 함께 짚는다');
  } catch (e) {
    bad(`작업 대상 찾기 검사 실패: ${e.message}`);
  }
}

// ── ②-b 프롬프트 예산 (Hermes 의 prompt-size 원리 흡수) ───────────────────
// 프롬프트는 조용히 자란다. 어디에 예산이 가는지 매번 보이게 하고, **캐시 접두 대비 가변 구역**이
// 커지면 경고한다 — 가변이 앞에 끼면 매 턴 캐시가 통째로 깨진다(실제로 그렇게 만들어 놨다가 고쳤다).
{
  const { buildModelMessages } = await import('../src/runtime/model-provider.js');
  const { buildTaskContext } = await import('../src/kernel/l1-intent/task-context.js');
  const { interpret: parse } = await import('../src/kernel/l1-intent/intent.js');
  const { buildSelfState: bss2 } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv: env2 } = await import('../src/surface/demo-context.js');
  const { judgmentCharter } = await import('../src/kernel/judgment-charter.js');
  const st = bss2(env2());
  const sys = buildModelMessages(buildTaskContext({
    intent: parse('안녕', { selfState: st }), selfState: st, nativeSearch: true,
  })).system;
  const charter = judgmentCharter().length;
  const nowAt = sys.indexOf('[지금]');
  const volatile = nowAt > 0 ? sys.length - nowAt : 0;
  const stable = sys.length - volatile;
  if (nowAt > 0 && nowAt < sys.length * 0.8) {
    bad(`가변 구역이 프롬프트 앞쪽에 있다(${nowAt}/${sys.length}) — 매 턴 캐시가 깨진다`);
  } else {
    ok(`프롬프트 ${sys.length}자 = 고정 ${stable}(헌장 ${charter}) + 가변 ${volatile}`);
  }
}

// ── ③ 능력 설명의 부정 주장은 매번 눈에 띄게 한다 (감사 지적: 되는데 "못 한다"고 말했다) ──
{
  // 1축: 능력 문장은 이제 **descriptor 파생**이다(수동 맵 없음). selfState 를 만들어 훑는다.
  const CAPABILITY_LINES = await (async () => {
    try {
      const [{ allCapabilityLines }, { buildSelfState }, { demoEnv }] = await Promise.all([
        import('../src/kernel/tool-labels.js'),
        import('../src/kernel/l0-evidence/self-state.js'),
        import('../src/surface/demo-context.js'),
      ]);
      return allCapabilityLines(buildSelfState(demoEnv()));
    } catch { return null; }
  })();
  if (CAPABILITY_LINES) {
    // 예전엔 이게 **⚠ 경고**였다. "사실일 수도 있으니 보이게만 한다"는 이유였는데, 상시 노란불은
    // 아무도 안 본다 — 실제로 `web.collect` 가 "브라우저를 띄워 조작하는 손은 아직 없다"고 말하는
    // 동안 `browser.observe` 는 배선돼 있었고, 같은 능력 목록 안에서 두 도구가 서로 다른 말을 했다.
    // 경고가 결함을 덮은 것이다. 그래서 **막는다.**
    //
    // 다만 부정 주장은 정말 사실일 수 있다(로그인벽·robots). 그래서 단어 사냥이 아니라 계약으로 본다:
    //   · 능력 설명에 부재 주장이 있으면 → descriptor 가 `limits` 를 선언해야 한다
    //   · limit 의 `coveredBy` 가 **배선된 도구**면 → 능력 설명이 그 손을 가리켜야 한다
    //     (있는 손을 없다고 말하는 것을 여기서 막는다 — §3-④ 반대 방향)
    const 부재주장 = /아직 없|지원하지 않|못\s*(한다|합니다|읽|봅)|불가능|손은 없/;
    const { liveDeps } = await import('../src/surface/live-context.js');
    const 배선됨 = new Set(Object.keys(liveDeps({}).tools?.tools ?? {}));
    const byId = new Map((await import('../src/surface/demo-context.js')).demoDescriptors().map((d) => [d.id, d]));

    const problems = [];
    for (const [id, line] of Object.entries(CAPABILITY_LINES)) {
      if (!부재주장.test(line)) continue;
      const limits = byId.get(id)?.limits;
      if (!Array.isArray(limits) || !limits.length) {
        problems.push(`${id}: 능력 설명이 "못 한다"고 말하는데 limits 선언이 없다 — 검증할 수 없는 주장이다`);
        continue;
      }
      for (const lim of limits) {
        if (!lim?.coveredBy || !배선됨.has(lim.coveredBy)) continue;
        // 덮는 손이 실제로 있다 → 능력 설명은 그 손을 **가리켜야** 한다.
        //
        // **가리키는 것과 id 를 적는 것은 다르다**(2026-08-05). 이 줄은 id 만 인정했는데,
        // 능력 설명은 SOUL.md 파생 구역에 그대로 나가 **사용자가 읽는 문장**이다. 그래서
        // 다른 그물(`operational-selfhood` — 내부 도구 id 가 새지 않는다)과 정면으로 부딪혔다:
        // id 를 적으면 사용자면에 내부 이름이 새고, 안 적으면 여기서 걸린다. 둘 다 옳은 규칙이라
        // 어느 한쪽을 끄면 안 되고, **재는 것을 정확히 하면 둘 다 선다.**
        // 계약은 *"그 일을 하는 손이 있으면 그 손을 가리킨다"* 이지 *"id 를 쓴다"* 가 아니다.
        // 그러니 **사람 이름(label)으로 가리키는 것도 가리킨 것**이다.
        const 가리키는말 = [lim.coveredBy, byId.get(lim.coveredBy)?.label].filter(Boolean);
        if (!가리키는말.some((말) => line.includes(말))) {
          problems.push(`${id}: "${lim.says}" 는 이미 ${lim.coveredBy} 가 한다 — 능력 설명이 그 손을 가리켜야 한다(id 또는 사람 이름 "${byId.get(lim.coveredBy)?.label ?? ''}")`);
        }
      }
    }
    if (problems.length) for (const p of problems) bad(`능력 설명이 있는 손을 없다고 말한다 — ${p}`);
    else ok('능력 설명의 "못 한다" 주장이 배선된 손과 어긋나지 않는다');
  }
}

// ── ③-a2 커넥터 진실층 (P5-B-0) ────────────────────────────────────────────
// 불변식은 **한 줄**이다: `model tool schema ⊆ executable:true`.
// 이유(reason)가 몇 개로 늘어도 이 줄은 안 바뀐다 — 그래서 상태를 2축으로 나눴다.
//
// 그리고 **demo 도 검사한다.** 예전엔 게이트가 live 만 봐서, demo 에서 `local.terminal`·
// `local.process`·`local.locate` 가 손 없이 모델 schema 에 있었고 `mail.send` 는 자격 설정
// 덕에 우연히 빠져 있었을 뿐이었다. 컨텍스트가 다르면 진실도 달라진다는 뜻이라 사고다.
{
  const [{ buildSelfState }, { toolSchemasFor }, { connectorTruth }, demo, { liveDeps }] = await Promise.all([
    import('../src/kernel/l0-evidence/self-state.js'),
    import('../src/kernel/l2-plan/tool-schema.js'),
    import('../src/kernel/l2-plan/connector-truth.js'),
    import('../src/surface/demo-context.js'),
    import('../src/surface/live-context.js'),
  ]);
  const live = liveDeps({});
  const 컨텍스트 = [
    ['demo', demo.demoContext(), demo.demoDescriptors(), demo.demoConnectors()],
    ['live', { env: live.env, tools: live.tools }, live.descriptors ?? [], live.connectors ?? demo.demoConnectors()],
  ];
  let 문제 = 0;
  for (const [이름, ctx, descriptors, connectors] of 컨텍스트) {
    const selfState = buildSelfState(ctx.env, { tools: ctx.tools });
    const hands = new Set(Object.keys(ctx.tools?.tools ?? {}));
    const schema = toolSchemasFor(selfState).map((t) => t.name);

    // 7.1 schema ⊆ executable, 그리고 executable ⊆ 손
    const 유령 = schema.filter((id) => !hands.has(id));
    if (유령.length) { bad(`[${이름}] 손 없는 도구가 모델 schema 에 있다: ${유령.join(', ')}`); 문제 += 1; }
    const 거짓실행가능 = selfState.connectedTools.filter((t) => t.executable && !hands.has(t.id)).map((t) => t.id);
    if (거짓실행가능.length) { bad(`[${이름}] 손이 없는데 실행 가능이라고 한다: ${거짓실행가능.join(', ')}`); 문제 += 1; }

    // 7.1 실행 불가인데 schema 에 남는 경우(2축이 어긋난 것)
    const 새어나감 = selfState.connectedTools.filter((t) => !t.executable && schema.includes(t.id)).map((t) => t.id);
    if (새어나감.length) { bad(`[${이름}] 실행 불가 도구가 모델 schema 에 있다: ${새어나감.join(', ')}`); 문제 += 1; }

    // 7.1 실행 불가면 **왜 아닌지**가 있어야 한다. 이유 없는 불가는 사용자에게 설명할 말이 없다.
    const 이유없음 = selfState.connectedTools.filter((t) => !t.executable && !t.reason).map((t) => t.id);
    if (이유없음.length) { bad(`[${이름}] 실행 불가인데 이유가 없다: ${이유없음.join(', ')}`); 문제 += 1; }

    // 7.2 커넥터의 도구 목록은 **파생**이다 — 수동 목록을 다시 만들면 막는다.
    const 수동목록 = connectors.filter((c) => Array.isArray(c.availableTools)).map((c) => c.id);
    if (수동목록.length) { bad(`[${이름}] 커넥터가 도구 목록을 손으로 든다: ${수동목록.join(', ')} — descriptor 에서 파생할 것`); 문제 += 1; }
    // 7.2 승인 정책도 커넥터에 중복 저장하지 않는다(승인의 진실은 도구 층 하나다).
    const 중복정책 = connectors.filter((c) => c.approvalPolicy || c.riskLevel).map((c) => c.id);
    if (중복정책.length) { bad(`[${이름}] 커넥터에 승인 정책이 또 있다: ${중복정책.join(', ')} — 승인의 진실이 둘이 된다`); 문제 += 1; }

    // 7.5 연결 안 된 커넥터의 도구가 "지금 되는 일"로 표시되면 막는다.
    for (const c of connectorTruth(connectors, selfState, descriptors)) {
      if (!c.executable && c.userJobs.length) {
        bad(`[${이름}] ${c.id}: 실행 불가인데 "지금 되는 일"이 적혀 있다 — 연결하면 가능으로 말할 것`); 문제 += 1;
      }
      const 노출 = c.tools.filter((t) => t.inModelSchema && !t.executable).map((t) => t.id);
      if (노출.length) { bad(`[${이름}] ${c.id}: 실행 불가 도구가 모델에 노출된다: ${노출.join(', ')}`); 문제 += 1; }
    }
  }
  if (!문제) ok('커넥터 진실층: schema ⊆ 실행 가능 ⊆ 손 (demo·live 동일)');
}

// ── ③-b 승인이 필요한 도구는 자기 미리보기를 낸다 (P5-B 진입 전 계약 게이트) ──
// 사용자가 **무엇을 허락하는지 모르는 승인은 승인이 아니다.** previewOf 가 없으면 카드가
// `${라벨} 실행` 으로 떨어진다(실측: "실행 중인 것 실행"). 전송은 되돌릴 수도 없다.
//
// 실측으로 드러난 더 나쁜 경우: `local.file` 이 계약을 안 내서 카드가 모델이 보낸 인자를 그대로
// 실었고, `path:'GPAO-T5/메모4.md'` 가 작업 루트 기준으로 풀려 `~/GPAO-T5/GPAO-T5/메모4.md` 에
// 생겼다. 카드에는 그 사실이 없었다 — **인자가 아니라 결과를 보여야 한다.**
{
  const { liveDeps } = await import('../src/surface/live-context.js');
  const live = liveDeps({});
  const hands = live.tools?.tools ?? {};
  // P5-B-0: **실행 가능한** 승인 대상만 본다. 연결 전 도구는 승인 카드가 뜰 일이 없다 —
  // 연결되는 슬라이스에서 handler·previewOf·receipt 를 함께 닫는다(그 전엔 요구하지 않는다).
  const { buildSelfState: 자기상태2 } = await import('../src/kernel/l0-evidence/self-state.js');
  const 실행가능ids = new Set(자기상태2(live.env, { tools: live.tools }).connectedTools
    .filter((t) => t.executable).map((t) => t.id));
  const 승인필요 = new Set((live.descriptors ?? []).filter((d) => d.needsApproval && 실행가능ids.has(d.id)).map((d) => d.id));
  // 도구 종류로 승인이 갈리는 것(local.file 의 write·delete)도 계약 대상이다.
  const { toolActionKind } = await import('../src/kernel/l2-plan/action-plan.js');
  for (const id of Object.keys(hands)) {
    const k = toolActionKind({ toolId: id, args: { action: 'write' }, selfState: { connectedTools: live.descriptors ?? [] } });
    if (k === 'write' || k === 'delete' || k === 'send') 승인필요.add(id);
  }
  const 계약없음 = [...승인필요].filter((id) => typeof hands[id]?.previewOf !== 'function');
  if (계약없음.length) {
    bad(`승인이 필요한데 미리보기 계약이 없다: ${계약없음.join(', ')} — 무엇을 허락하는지 모르는 승인은 승인이 아니다`);
  } else {
    ok(`승인이 필요한 도구는 모두 previewOf 를 낸다 (${승인필요.size}개)`);
  }
}

// ── ③-b2 **같은 사실을 두 층이 따로 계산하지 않는다** (구조 원칙 §1-B) ────
//
// 2026-07-28 하루에 같은 병을 다섯 번 만났다. 전부 위층이 아래층의 사실을 자기 말로 덮었고,
// 매번 **덜 아는 쪽이 이겼다.** 사용자가 본 것:
//   · 없던 파일을 만드는 카드에 "원본은 휴지통에 남아요"   (도구는 새 파일인 걸 알았다)
//   · 파일 저장 거절에 "보내지 않았어요. 초안은 그대로 있어요"
//   · 조회 승인에 "메시지를 실제로 밖으로 보내는 일이라"
//   · 주소로 붙은 MCP 카드에 `undefined 서버에서` · 내부 id `notion 에서`
//   · 원장에 `{"results":[],"type":"workspace_search"}`
//
// 회귀 테스트는 **그 자리**를 지킨다. 게이트는 **그 종류**를 지킨다(구조 원칙 §2-C).
// 넷 다 예/아니오로 끝나므로 기계가 본다.
{
  const before = failures.length;
  const { readFile: 읽기 } = await import('node:fs/promises');
  const 소스 = async (p) => 읽기(new URL(`../${p}`, import.meta.url), 'utf8');
  const 주석뺀줄 = (s) => s.split('\n')
    .map((줄, i) => ({ n: i + 1, t: 줄 }))
    .filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x.t));

  // ① 도구가 이 작업에 대해 낸 문장이 도구 전체 고정 문구를 이긴다.
  //    (`previewOf().cancel` > `reversibleNote`)
  try {
    const { explainAuthority } = await import('../src/kernel/l2-plan/authority.js');
    const r = explainAuthority({
      kind: 'write', revocable: true,
      reversibleNote: '층 전체에 붙은 고정 문구',
      preview: { impact: 'x', cancel: '이 작업에 대해 도구가 낸 문장' },
    });
    if (r.reversible !== '이 작업에 대해 도구가 낸 문장') {
      bad('승인 카드가 도구의 문장 대신 층 전체 고정 문구를 쓴다 — 같은 카드에 두 진실이 생긴다'
        + ` (나온 값: ${r.reversible})`);
    }
  } catch (e) { bad(`되돌리기 문구 우선순위 검사 실패: ${e.message}`); }

  // ② 위층이 아래층의 **종류를 바꿔 부르지 않는다.** 승인 강제는 등급으로만 한다.
  //    예전엔 계획 층이 `kind = 'send'` 로 갈아 달아서 조회·연결까지 전송으로 설명됐다.
  try {
    const { grantFor } = await import('../src/kernel/l2-plan/authority.js');
    const g = grantFor({ label: 'x', kind: 'read', needsApproval: true, preview: { impact: 'x' } });
    if (!g.approvalRequired) bad('도구가 확인을 요구하는데 승인이 강제되지 않는다');
    if (g.kind !== 'read') bad(`승인을 강제하려고 종류를 바꿔 달았다: read → ${g.kind}`);
    if (/보내는 일/.test(g.reason?.why ?? '')) bad(`조회인데 전송으로 설명한다: ${g.reason?.why}`);
    for (const f of ['src/kernel/l2-plan/action-plan.js', 'src/kernel/turn.js']) {
      const 갈아단곳 = 주석뺀줄(await 소스(f)).filter((x) => /\bkind\s*=\s*['"]send['"]/.test(x.t));
      if (갈아단곳.length) bad(`${f}:${갈아단곳[0].n} 에서 종류를 send 로 갈아 단다 — 등급만 올릴 것`);
    }
  } catch (e) { bad(`종류 보존 검사 실패: ${e.message}`); }

  // ③ **사람 말 자리에 기계 말을 넣지 않는다.** 승인 카드·원장 문구를 만드는 자리에서
  //    JSON.stringify 로 값을 그대로 싣는 것을 막는다(그게 MCP 카드에 브레이스가 뜬 이유다).
  try {
    const 사람말자리 = /(userSafeSummary|impact|scope|what|cancel|nextSafeAction)\s*:/;
    const 검사파일 = ['src/runtime/tool-admission.js', 'src/runtime/local-file.js',
      'src/runtime/connector-declare.js', 'src/runtime/connector-connect.js', 'src/kernel/turn.js'];
    for (const f of 검사파일) {
      const 샌곳 = 주석뺀줄(await 소스(f)).filter((x) => 사람말자리.test(x.t) && /JSON\.stringify/.test(x.t));
      if (샌곳.length) {
        bad(`${f}:${샌곳[0].n} 사람이 읽는 자리에 기계 말을 싣는다 — 구조는 result 로 모델에게 간다`);
      }
    }
  } catch (e) { bad(`사람 말 자리 검사 실패: ${e.message}`); }

  // ④ **한 요청에서 같은 질문을 두 번 하지 않는다.** 승인을 만드는 자리가 둘인데 한쪽만
  //    허락을 이어받으면, 같은 요청인데 어느 길로 왔느냐로 묻는 횟수가 달라진다(프랙탈 위반).
  try {
    const t = await 소스('src/kernel/turn.js');
    const 자리 = [...t.matchAll(/ctx\.pending\.set\(/g)];
    // **이어받기만 센다**(2026-08-05 · S6-b 에서 이 검사가 물었다).
    // 예전엔 `허락한손:` 이름만 셌다. 그런데 S6-b 가 면제 판정을 경계로 모으면서
    // `허락한손: ctx.허락한손` 이라는 **읽어서 넘기는** 자리가 하나 생겼고,
    // 이어받기가 아닌데 이어받기로 세어져 게이트가 빨개졌다.
    // 계약은 "이름이 몇 번 나오나"가 아니라 **"봉인마다 허락이 이어지나"** 다 —
    // 이어받기는 `허락한손: [ …기존…, …새것… ]` 꼴로만 쓴다. 그것만 센다.
    const 이어받는곳 = [...t.matchAll(/허락한손:\s*\[/g)];
    if (자리.length !== 이어받는곳.length) {
      bad(`승인을 만드는 자리 ${자리.length}곳 중 ${이어받는곳.length}곳만 허락을 이어받는다`
        + ' — 같은 요청인데 경로에 따라 묻는 횟수가 달라진다');
    }
    if (!/input\.text[^\n]*ctx\.허락한손 = undefined|ctx\.허락한손 = undefined/.test(t)) {
      bad('새 요청에서 승인 면제를 비우지 않는다 — 면제가 다음 요청까지 조용히 넘어간다');
    }
  } catch (e) { bad(`승인 면제 범위 검사 실패: ${e.message}`); }

  if (failures.length === before) {
    ok('한 사실은 한 층에서만 — 도구 문장 우선 · 종류 보존 · 사람 말 자리 · 승인 면제 범위');
  }
}

// ── ③-c 커널은 도구 이름을 모른다 (P5 진입 전 구조 게이트) ──────────────
// 예전엔 working-state.js 가 `if (tool === 'web.collect') … if (tool === 'local.file') …`
// 사다리였다. 도구가 늘 때마다 커널을 고쳐야 했고, 안 고치면 그 도구만 조용히 다음 턴으로
// 안 이어졌다(local.locate 가 그랬다). 이미 세 번 샌 패턴이라 subjectOf 계약으로 바꿨다.
// P5 에서 채널·외부 API·MCP·CLI 가 붙으면 같은 누수가 그만큼 커진다 — 여기서 못 박는다.
{
  const 이어받기커널 = ['src/kernel/l0-evidence/working-state.js'];
  const 샌것 = [];
  for (const f of 이어받기커널) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    src.split('\n').forEach((line, i) => {
      const t = line.trim();
      // 주석은 뺀다 — 왜 이렇게 됐는지 설명하려면 옛 코드를 인용해야 한다.
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      if (/\btool\s*===|actualCall\s*\?\.\s*tool|receipt\.actualCall\.tool/.test(line)) {
        샌것.push(`${f}:${i + 1}  ${t.slice(0, 70)}`);
      }
    });
  }
  if (샌것.length) {
    bad(`이어받기 커널이 도구 이름을 알아본다 — 새 도구는 subjectOf 계약으로 낸다(커널 수정 금지):\n      ${샌것.join('\n      ')}`);
  } else {
    ok('이어받기 커널이 도구 이름을 모른다(subjectOf 계약)');
  }
}

// ── ③-c2 실행기·커널은 서비스를 모른다 (P5-B-1B 안전핀) ─────────────────
// 오너 기준(2026-07-27): 감사는 **"노션 됐나?"가 아니라 "노션이라는 단어를 빼도 구조가 남나?"**
// 지금 이 순간 실행기 코드에 서비스 이름이 0건이다. **깨끗한 지금 박아야 한다** — 나중에 박으면
// 이미 새어든 것을 정당화하게 된다. 노션·구글·카카오·스마트스토어가 들어올수록 값이 커지는 핀이다.
//
// 범위를 나눈다. 서비스 지식은 **선언층에는 있어야 한다** — 없으면 그게 상상으로 메우는 자리다.
//   검사: 커널 전체 · 연결 실행기 · OAuth/PKCE · MCP 전송 · Tool Admission · 상태 해석층
//   허용: connector 선언 · demo-context · fixture · docs · tests
// 주석은 뺀다. "실측(2026-07-27, mcp.notion.com): 401 이 로그인 위치를 알려준다" 같은 근거는
// 남아야 한다 — 금지하는 것은 **코드가 서비스 이름으로 갈라지는 것**이지 사실의 기록이 아니다.
{
  const { readdir } = await import('node:fs/promises');
  const 훑기 = async (dir) => {
    const out = [];
    for (const e of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await 훑기(`${dir}/${e.name}`));
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  const 검사대상 = [
    ...await 훑기('src/kernel'),
    'src/runtime/connector-connect.js',   // 연결 실행기
    'src/runtime/oauth-pkce.js',          // OAuth/PKCE 실행기
    'src/runtime/api-key.js',             // API 키 실행기
    'src/runtime/http-tool.js',           // 선언형 HTTP 도구(API 키 커넥터의 손)
    'src/runtime/cli-tool.js',            // 선언형 CLI 도구(이미 깔린 명령)
    'src/runtime/mcp-http.js',            // MCP 원격 전송
    'src/runtime/mcp-client.js',          // MCP stdio 전송
    'src/runtime/tool-admission.js',      // 도구 편입
    'src/runtime/local-signs.js',         // 공통 상태 해석(로컬 흔적 확인)
  ];

  // **금지어를 선언층에서 파생한다.** 고정 목록은 썩는다 — 새 커넥터를 선언하면 그 이름이
  // 자동으로 금지어가 되어야, 다음 사람이 목록을 손볼 일이 없다.
  const { demoConnectors } = await import('../src/surface/demo-context.js');
  // 일반어는 뺀다. 'mail'·'메일' 같은 건 서비스 이름이자 보통 명사라, 금지하면 정상 코드가 막힌다.
  const 일반어 = new Set(['mail', '메일', 'web', '웹', 'local', '파일', 'file', 'chat', '채팅', 'core']);
  const 금지어 = new Set();
  for (const c of demoConnectors()) {
    for (const w of [c.id, c.label, ...(c.aliases ?? [])]) {
      const t = String(w ?? '').trim().toLowerCase();
      if (t.length >= 3 && !일반어.has(t)) 금지어.add(t);
    }
  }
  // 아직 선언되지 않았지만 들어올 것이 뻔한 이름들 — 선언보다 코드가 먼저 새는 것을 막는다.
  for (const w of ['figma', 'kakao', '카카오', 'naver', '네이버', '스마트스토어', 'cafe24', 'shopify', 'dropbox', 'github']) 금지어.add(w);

  // 두 층으로 나눈다. **연결 층은 0건 하드** — 이번에 깨끗하게 지었으므로 한 건도 못 샌다.
  // 커널 말귀 층은 P5 이전부터 서비스 이름으로 갈라진다(`if (/슬랙|slack/) tools.push(…)` —
  // 침범 목록 1번 "키워드 분기"가 여기 산다). 지금 뜯는 건 별개 작업이라 **기준선 이하**로 묶는다:
  // 늘면 그 자리에서 막히고, 줄이면 기준선이 따라 내려간다("후속" 카운터와 같은 방식).
  const 연결층 = new Set(검사대상.filter((f) => !f.startsWith('src/kernel/')
    || /connector|self-state|external-service/.test(f)));
  const 훑은것 = [];
  const 단어경계 = (word) => new RegExp(
    `(^|[^\\p{L}\\p{N}_])${word.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`,
    'u',
  );
  for (const f of 검사대상) {
    const src = await readFile(new URL(`../${f}`, import.meta.url), 'utf8');
    // 주석을 지운 뒤에 본다 — 근거 기록은 살리고 분기만 잡는다.
    const 코드 = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .map((l) => (l.trim().startsWith('//') ? '' : l.replace(/\/\/.*$/, '')));
    코드.forEach((line, i) => {
      const low = line.toLowerCase();
      for (const w of 금지어) {
        if (단어경계(w).test(low)) 훑은것.push({ f, 줄: `${f}:${i + 1}  "${w}" ← ${line.trim().slice(0, 60)}` });
      }
    });
  }
  const 연결층누수 = 훑은것.filter((x) => 연결층.has(x.f));
  const 말귀층누수 = 훑은것.filter((x) => !연결층.has(x.f));
  if (연결층누수.length) {
    bad('연결 실행기·상태 해석층이 서비스를 알아본다 — 서비스 지식은 커넥터 선언에만 둔다'
      + `(실행기는 방식(kind)만 안다):\n      ${연결층누수.slice(0, 8).map((x) => x.줄).join('\n      ')}`);
  } else {
    ok(`연결 실행기·상태 해석층에 서비스 이름 0건 (${연결층.size}개 파일 · 금지어 ${금지어.size})`);
  }
  const 말귀기준 = baseline.serviceNameLeaks ?? 말귀층누수.length;
  if (말귀층누수.length > 말귀기준) {
    bad(`커널 말귀 층의 서비스 이름 분기가 늘었다 ${말귀기준} → ${말귀층누수.length}`
      + ` (키워드 분기는 침범 목록 1번이다):\n      ${말귀층누수.slice(0, 6).map((x) => x.줄).join('\n      ')}`);
  } else {
    ok(`커널 말귀 층의 서비스 이름 ${말귀층누수.length}건 (기준선 ${말귀기준} 이하 · 줄일 대상)`);
  }
  누수기준선 = Math.min(말귀층누수.length, 말귀기준);
}

// ── §1-B 오너 지시(2026-08-09) · 손이 세는 사실은 도메인 낱말 없이 참이어야 한다 ──
// 기준선 0 하드 · 상향 금지. 기계는 fact-purity.mjs 한 벌 — 게이트가 실제 소스로 부르고
// 반대시험(test/fact-layer-purity.test.js)이 심은 소스로 불러 빨개짐을 확인한다.
// 경계(규격 5): 그물 트리거의 총·전체·합계는 업종 어휘가 아니라 **일반 수량어**라 이
// 불변식의 대상이 아니다 — 「세 성질」(문구는 최소 보조)이 다스린다. 원고·강의·설계 같은
// 내용 종류 낱말도 대상이 아니다(locate 성격 분류표는 여러 업을 포괄하는 선언).
{
  const { readdir } = await import('node:fs/promises');
  const { 사실층정의역, 업종금지어, 업종어휘위반, 미등록사실층 } = await import(new URL('./checks/fact-purity.mjs', import.meta.url));
  const 훑기 = async (dir) => {
    const out = [];
    for (const e of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) out.push(...await 훑기(`${dir}/${e.name}`));
      else if (e.name.endsWith('.js')) out.push(`${dir}/${e.name}`);
    }
    return out;
  };
  const 전체 = await Promise.all((await 훑기('src')).map(async (path) => ({
    path, src: await readFile(new URL(`../${path}`, import.meta.url), 'utf8'),
  })));
  const 정의역 = 전체.filter((x) => 사실층정의역.includes(x.path));
  const 위반 = 업종어휘위반(정의역);
  const 미등록 = 미등록사실층(전체);
  if (위반.length) {
    bad(`사실 층에 업종 어휘가 스몄다 — 도메인 낱말 없이 참이어야 한다(§1-B · 기준선 0 하드):\n      ${위반.slice(0, 8).map((x) => x.줄).join('\n      ')}`);
  } else if (미등록.length) {
    bad(`등록 없는 사실 층 추가 — 표지가 코드에 있는데 정의역 목록에 없다(§1-B 규격 1): ${미등록.join(' · ')}`);
  } else {
    ok(`사실 층 ${사실층정의역.length}개 파일 업종 어휘 0건 · 미등록 사실 층 0 (§1-B · 금지어 ${업종금지어.length})`);
  }
}

// ── ③-b 1축: 도구의 이름·설명은 descriptor 하나에서만 나온다 ─────────────
// 예전엔 tool-labels.js 에 LABELS·CAPABILITIES 수동 맵 두 개가 따로 있었다. 그래서 도구를 더해도
// 이름·설명이 안 따라왔다(`session.search` 는 CAPABILITIES 에 없어서 자기파악에 이름만 나왔다).
// 목록이 아니라 **불변식**으로 막는다(§8): 선언된 도구는 이름과 설명을 갖고, 커널은 그것만 쓴다.
{
  try {
    const [{ buildSelfState }, { demoEnv, demoDescriptors }, { toolLabel, toolCapabilityLine }] =
      await Promise.all([
        import('../src/kernel/l0-evidence/self-state.js'),
        import('../src/surface/demo-context.js'),
        import('../src/kernel/tool-labels.js'),
      ]);
    const selfState = buildSelfState(demoEnv());
    const problems = [];
    for (const d of demoDescriptors()) {
      if (!d.label || d.label === d.id) problems.push(`${d.id}: 이름이 없다(id 가 화면에 샌다)`);
      if (!d.capability) problems.push(`${d.id}: 하는 일 설명이 없다(모델이 지어낸다)`);
      // 스키마가 없으면 모델이 그 도구의 **존재를 모른다.** 실행 불가 도구도 마찬가지다 —
      // 연결되는 순간 보여야 하는데 그때 없으면 `session.search` 사고가 그대로 재현된다.
      if (!d.schema?.description || !d.schema?.parameters) problems.push(`${d.id}: 모델 노출 스키마가 없다(모델이 존재를 모른다)`);
      // 커널이 보는 이름이 descriptor 의 이름과 같아야 한다 — 다르면 어딘가 또 맵이 생긴 것이다.
      if (toolLabel(d.id, selfState) !== d.label) problems.push(`${d.id}: 커널 이름이 descriptor 와 다르다`);
      if (!toolCapabilityLine(d.id, selfState).startsWith(d.label)) problems.push(`${d.id}: 능력 문장이 descriptor 파생이 아니다`);
    }
    // 수동 맵이 되살아나면 잡는다 — 파일에 id→문자열 리터럴 맵이 다시 생기는 것을 막는다.
    const labelsSrc = await readFile(new URL('../src/kernel/tool-labels.js', import.meta.url), 'utf8');
    if (/^\s*'[\w.]+'\s*:\s*'/m.test(labelsSrc)) problems.push('tool-labels.js 에 수동 맵이 다시 생겼다');
    const schemaSrc = await readFile(new URL('../src/kernel/l2-plan/tool-schema.js', import.meta.url), 'utf8');
    if (/^\s*'[\w.]+'\s*:\s*\{/m.test(schemaSrc)) problems.push('tool-schema.js 에 수동 맵이 다시 생겼다');
    if (problems.length) problems.forEach((p) => bad(p));
    else ok(`도구 이름·설명이 descriptor 단일 진실 (${demoDescriptors().length}개)`);
  } catch (e) {
    bad(`도구 단일 진실 검사 실패: ${e.message}`);
  }
}

// ── ④ "후속/TODO" 가 늘지 않았다 (§16-B 후속 남용 방지) ───────────────────
let deferred = 0;
{
  // **주석만** 센다. 사용자에게 보이는 문구("아직 안 되는 것")까지 세면 정직한 표시가 유예로
  // 오인된다(실제로 그렇게 막혔다). 이 검사의 뜻은 "미룬 일이 늘었는가"이지 단어 사냥이 아니다.
  const out = execFileSync('bash', ['-lc',
    `grep -rEh '^\\s*(//|\\*)' ${root}src --include='*.js' | grep -Eoc '후속|TODO|FIXME|아직 (안|없|구현)' || true`,
  ], { encoding: 'utf8' });
  deferred = Number(out.trim());
  if (deferred > (baseline.deferred ?? Infinity)) {
    bad(`"후속/아직" 표현이 늘었다: ${baseline.deferred} → ${deferred} (§16-B: 사용자가 부딪히는 것은 후속 불가)`);
  } else {
    ok(`"후속" 표현 ${deferred}건 (기준선 ${baseline.deferred ?? deferred} 이하)`);
  }
}

// ── ⑤ 테스트 + 성능 기준선 (§17) ──────────────────────────────────────────
// **벽시계로 판정하지 않는다.** `≤5s` 는 421건/0.86s 이던 2026-07-26 에 정한 선인데, 그 뒤 커널
// 샌드박스가 생기면서 일부 검사가 실제 OS 프로세스를 띄운다(sandbox-exec·자식 노드·서버).
// 그 시간은 우리 코드가 아니라 기계 부하가 정한다. 실측(2026-07-27, 같은 코드 7회):
//
//     벽시계  5.70s ~ 8.44s   (±48% — 부하만으로 통과/차단이 뒤집혔다: 5.08s BLOCKED, 3.87s PASS)
//     CPU     30.7s ~ 33.0s   (±3%  — 부하를 걸어도 거의 안 움직인다)
//
// 뒤집히는 게이트는 진짜 회귀가 났을 때 "또 부하겠지"로 넘어가게 만든다. 그래서 **일한 양(CPU)**
// 으로 판정한다 — 검사가 늘거나 무거워지면 정확히 잡히고, 옆에서 빌드가 돌아도 안 흔들린다.
//
// 다만 CPU 하나로는 **잠든 검사**를 못 잡는다(`sleep 30` 은 CPU 를 안 쓴다). 그래서 벽시계도
// 남기되 역할을 나눈다: CPU 는 일한 양의 폭주를, 벽시계는 기다림을 막는다. 부하 변동(±48%)을
// 흡수하고도 잠든 검사는 잡히도록 벽시계 선은 넉넉하게 둔다.
//
// 두 선 모두 **자동 갱신하지 않는다.** 넘겼으면 코드를 고치거나, 오너 결정으로 선을 옮긴다.
{
  // **검사에게 자기 임시방을 준다**(2026-08-07 · 오너 지시). 그래야 끝나고 통째로 지울 수 있다.
  //
  // 왜 이 모양인가 — 2026-08-06 에 디스크가 100% 로 찼다. 주범은 다른 것이었지만
  // 검사가 남긴 임시 폴더도 2.1GB 였다. `mkdtemp` 를 쓰는 자리가 400곳이 넘고
  // 접두가 `t5-`·`gpao-t5-` 뿐 아니라 `what-`·`zero-locate-`·`turn-seq-` 까지 제각각이라
  // **접두 목록으로 지우면 반드시 샌다**(§목록으로 짐작하지 마라).
  //
  // 그래서 목록이 아니라 **경계**로 푼다. `TMPDIR` 을 이 회차 전용 방으로 바꿔 주면
  // `os.tmpdir()` 이 그 방을 가리키므로 **검사가 만든 것은 전부 그 안에 떨어진다.**
  // 끝나고 그 방만 지우면 된다 — 남의 프로세스 임시 폴더는 애초에 손댈 일이 없다.
  // 그래서 "무엇을 지울까"를 판단할 필요가 없어진다. 판단이 없으면 틀릴 수도 없다.
  const 검사방 = mkdtempSync(join(tmpdir(), 'gate-run-'));
  let out;
  try {
    // 검사는 **한 번만** 돌린다. CPU 시간은 자식의 rusage 라 Node 가 안 준다 — POSIX `time -p` 가
    // stderr 로 내므로 `2>&1` 로 합쳐 한 번에 받는다(두 번 돌리면 게이트가 두 배로 느려진다).
    // `TMPDIR` 은 **명령 안에서도** 세운다 — `bash -lc` 는 로그인 셸이라 프로필이 환경을 덮을 수 있다.
    out = execFileSync('bash', ['-lc',
      `cd ${root} && export TMPDIR=${검사방}/ && { /usr/bin/time -p npm test; } 2>&1`,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, TMPDIR: `${검사방}/` } });
  } finally {
    // **얼마나 남겼는지 말한다.** 조용히 지우면 검사가 임시 폴더를 흘리는 것이 영영 안 보인다 —
    // 게이트는 치우는 자리가 아니라 알리는 자리다.
    const 남긴바이트 = 방크기(검사방);
    rmSync(검사방, { recursive: true, force: true });
    if (남긴바이트 > 0) ok(`검사 임시방 정리 ${(남긴바이트 / 1024 / 1024).toFixed(1)}MB (검사가 안 치운 것)`);
  }

  const pass = Number(out.match(/^ℹ pass (\d+)/m)?.[1] ?? 0);
  const fail = Number(out.match(/^ℹ fail (\d+)/m)?.[1] ?? 1);
  if (fail > 0) bad(`테스트 실패 ${fail}건`);
  else ok(`테스트 ${pass}건 통과`);

  const num = (re) => { const m = out.match(re); return m ? Number(m[1]) : null; };
  const user = num(/^user\s+([\d.]+)/m);
  const sys = num(/^sys\s+([\d.]+)/m);
  const wall = num(/^real\s+([\d.]+)/m);
  const cpu = user === null || sys === null ? null : user + sys;
  // 테스트 수가 늘어도 1598건 시점의 40초를 영원히 절대 상한으로 쓰면, 검사를 추가한 행위 자체가
  // 회귀가 된다. 기존 기준의 건당 CPU(약 0.025초)는 고정하고 절대 40초는 바닥으로 유지한다.
  // 따라서 테스트가 늘어도 **검사 한 건당 비용이 나빠지면** 차단되고, 단순한 검증 확장은 차단하지 않는다.
  const cpuLimit = Math.max(
    baseline.testCpuSeconds,
    pass * baseline.testCpuPerTestSeconds,
  );

  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  if (cpu === null || wall === null) {
    // 못 쟀으면 **조용히 통과시키지 않는다** — 안 해 본 검사를 통과로 세는 것이 우리가 반복한 실패다.
    bad('테스트 시간을 재지 못했다(`/usr/bin/time -p` 출력 없음) — 성능 기준선이 검사되지 않았다 (§17)');
  } else {
    if (cpu > cpuLimit) bad(`테스트가 일하는 양이 기준선을 넘었다: CPU ${cpu.toFixed(1)}s > ${cpuLimit}s (§17)`);
    // ── 기다림은 벽시계가 아니라 **유휴**로 잰다 (오너 결정 2026-08-07 · 현재상황 §1-A) ──
    //
    // 벽시계 30s 고정선은 검사가 늘면 반드시 터졌다 — 기다림이 아니라 크기를 재고 있었다.
    // 실측(2026-08-08): 같은 트리가 한가한 기계에서 PASS(23.6s), 옆에 부하가 돌자
    // BLOCKED(35.4s) — 부하만으로 판이 뒤집혔다. 유휴(= 벽시계 − CPU÷동시성)는 그 두
    // 회차에서 9.7s/6.2s 로 **부하 쪽이 오히려 낮았다.** 계산과 상한 근거는 `gate-idle.mjs`,
    // 상한 교정치는 `gate-baseline.json`(자동 갱신 없음 — §17 그대로).
    const conc = 동시성(pkg);
    const idle = 유휴초({ wall, cpu, concurrency: conc });
    if (idle === null) {
      bad('유휴를 못 쟀다(동시성 또는 시간 없음) — package.json 의 --test-concurrency 를 확인할 것 (§17)');
    } else if (idle > baseline.testIdleSeconds) {
      bad(`테스트가 기다리고 있다: 유휴 ${idle.toFixed(1)}s > ${baseline.testIdleSeconds}s`
        + ` (벽시계 ${wall.toFixed(1)} − CPU ${cpu.toFixed(1)}÷${conc}) — 잠든 검사·타임아웃 대기를 의심할 것 (§17)`);
    }
    if (cpu <= cpuLimit && idle !== null && idle <= baseline.testIdleSeconds) {
      ok(`테스트 CPU ${cpu.toFixed(1)}s (기준선 ${cpuLimit}s) · 유휴 ${idle.toFixed(1)}s (상한 ${baseline.testIdleSeconds}s · 벽시계 ${wall.toFixed(1)}s)`);
    }
  }
  const deps = Object.keys(pkg.dependencies ?? {}).length;
  if (deps > 0) bad(`런타임 의존성이 생겼다: ${deps}개 (§17 의존성 0 유지)`);
  else ok('런타임 의존성 0');

  // ── 매듭: **조용한 절단 금지** (정본 §S3 · 구조원칙 §2-C) ──────────────────
  //
  // 사고 원문(2026-08-03): 다운로드 437개 목록이 잘려 23개(5%)만 모델에게 갔다. 요약은
  // "437개를 찾았어요"였고 잘렸다는 말은 마침표 세 개가 전부였으며, **나머지를 가져올 인자가
  // 없었다.** 모델은 그 자리에서 실행을 요구받았고 다섯 턴 내내 계획만 반복했다.
  //
  // 자르는 것 자체는 옳다(437개를 다 실으면 프롬프트가 폭주한다). 금지되는 것은 **조용히**
  // 자르는 것이다. 자를 때는 셋이 함께 간다: 뺀 양 · 뺀 것의 성질 · **문**.
  //
  // 이 매듭을 여기 두는 이유: 새 갈래가 `compactResult` 에 늘 때마다 사람이 기억해서 지킬
  // 수 없다. 갈래가 늘면 여기서 걸린다(§2-C — 한 자리에서 매듭을 묶는다).
  {
    const { compactResult } = await import('../src/kernel/l1-intent/task-context.js');
    const 많은목록 = {
      path: '/집/다운로드',
      items: Array.from({ length: 437 }, (_, i) => ({
        name: `자료-${String(i).padStart(3, '0')}.pdf`, kind: 'file',
        modifiedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
      })),
    };
    const 잘린것 = String(compactResult(많은목록) ?? '');
    const 빠진것 = [];
    if (!/나머지 \d+개는 이 답에 이름을 싣지 못했다/.test(잘린것)) 빠진것.push('뺀 양');
    if (!/확장자:/.test(잘린것)) 빠진것.push('뺀 것의 성질');
    if (!/offset=\d+/.test(잘린것) || !/limit/.test(잘린것)) 빠진것.push('문(offset·limit)');
    if (빠진것.length) {
      bad(`조용한 절단: 모델 입력이 잘리는데 ${빠진것.join(' · ')} 이(가) 없다 (§S3)`);
    } else {
      ok('조용한 절단 없음 — 뺀 양·성질·문이 함께 간다');
    }
  }
  notes.push(`테스트 ${pass}건 / CPU ${cpu === null ? '미측정' : `${cpu.toFixed(1)}s`}`);
}

// ── ⑥ 프로세스 산출물이 커밋되지 않았다 ───────────────────────────────────
{
  const tracked = execFileSync('bash', ['-lc',
    `cd ${root} && git ls-files | grep -E '(^|/)(\\.beai-harness|workspace-notes)/' | head -3`,
  ], { encoding: 'utf8' }).trim();
  if (tracked) bad(`프로세스 산출물이 커밋됐다: ${tracked.split('\n').join(', ')}`);
  else ok('프로세스 산출물 미커밋');
}

// ── 결과 ──────────────────────────────────────────────────────────────────
console.log('');
if (failures.length) {
  console.error(`[gate] BLOCKED — ${failures.length}건`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}
// 기준선은 **값이 바뀔 때만** 쓴다. 매번 timestamp 를 갱신하면 실행할 때마다 워킹트리가 더러워져
// "이 변경이 의도된 것인가"를 매번 되묻게 된다(감사에서 실제로 지적됐다).
// **자동 갱신은 `deferred` 뿐이다.** 성능 기준선(CPU·벽시계)은 여기서 안 쓴다 — 스스로 올리는
// 기준선은 기준선이 아니다. 넘겼으면 코드를 고치거나, 오너 결정으로 이 파일을 손으로 옮긴다.
{
  let prev = null;
  try { prev = JSON.parse(await readFile(baselineFile, 'utf8')); } catch { /* 최초 */ }
  const 다음 = { ...prev, deferred, ...(누수기준선 === null ? {} : { serviceNameLeaks: 누수기준선 }) };
  if (prev?.deferred !== deferred || prev?.serviceNameLeaks !== 다음.serviceNameLeaks) {
    await writeFile(baselineFile, `${JSON.stringify(다음, null, 2)}\n`);
  }
}
console.log(`[gate] PASS — ${notes.join(' · ')}`);
