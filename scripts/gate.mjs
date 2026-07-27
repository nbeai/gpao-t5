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
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const baselineFile = new URL('./gate-baseline.json', import.meta.url);
const failures = [];
const notes = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { failures.push(m); console.log(`  ✗ ${m}`); };

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

  const phantom = [...declared].filter(([id]) => !handlers.has(id));
  if (phantom.length) {
    bad(`선언만 있고 손이 없는 도구: ${phantom.map(([id, src]) => `${id}(${src})`).join(', ')} — 배선하거나 선언을 거둘 것`);
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
    const { tools: shown } = await (await fetch(`${base}/toolbox`)).json();
    const surfaced = (shown ?? []).map((t) => t.id);
    const unbacked = surfaced.filter((id) => !handlers.has(id));
    if (unbacked.length) bad(`도구함에 손 없는 도구가 보인다: ${unbacked.join(', ')} — liveDeps 를 서버에 안 넘겼는지 확인할 것`);

    // 말귀도 같은 집합만 가리켜야 한다. 없는 도구로 라우팅하면 "연결이 필요해요/[연결 화면 열기]"
    // 라는 **죽은 버튼**이 뜬다 — 연결할 대상이 없으므로 거짓 안내다(재감사 지적).
    const { interpret } = await import('../src/kernel/l1-intent/intent.js');
    const { buildSelfState: bss } = await import('../src/kernel/l0-evidence/self-state.js');
    const liveSelf = bss(live.env);
    for (const text of ['메일로 보내줘', '슬랙에 올려줘', '텔레그램으로 보내줘', '메모.md 지워줘', '뉴스 조사해줘']) {
      const routed = interpret(text, { selfState: liveSelf }).neededTools ?? [];
      const dead = routed.filter((id) => !handlers.has(id));
      if (dead.length) bad(`"${text}" 가 손 없는 도구로 라우팅된다: ${dead.join(', ')} (죽은 연결 안내)`);
    }

    if (!unbacked.length && !phantom.length && !fixtures.length && failures.length === 0) {
      ok(`선언 ${declared.size} = 손 ${handlers.size} = 화면 ${surfaced.length}, 스텁 0`);
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
    // 막기만 하면 도구가 아니다.
    for (const cmd of ['kill 999999', 'rm -rf /tmp/남의것', 'npm test']) {
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
    // "아직 없다/지원하지 않는다/못 한다" 는 **사실일 수도 있다**. 그래서 막지 않고 **보이게** 한다 —
    // 기능이 생기면 이 줄부터 고쳐야 한다는 걸 매 게이트마다 상기시킨다.
    const negatives = Object.entries(CAPABILITY_LINES)
      .filter(([, line]) => /아직 없|지원하지 않|못 한다|불가능/.test(line));
    if (negatives.length) {
      console.log(`  ⚠ 능력 설명에 "못 한다" 주장 ${negatives.length}건 — 기능이 생겼으면 먼저 고칠 것:`);
      for (const [id, line] of negatives) console.log(`      · ${id}: ${line.slice(0, 60)}…`);
    } else {
      ok('능력 설명에 남은 "못 한다" 주장 없음');
    }
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
  let baseline = { deferred: Infinity };
  try { baseline = JSON.parse(await readFile(baselineFile, 'utf8')); } catch { /* 최초 실행 */ }
  if (deferred > (baseline.deferred ?? Infinity)) {
    bad(`"후속/아직" 표현이 늘었다: ${baseline.deferred} → ${deferred} (§16-B: 사용자가 부딪히는 것은 후속 불가)`);
  } else {
    ok(`"후속" 표현 ${deferred}건 (기준선 ${baseline.deferred ?? deferred} 이하)`);
  }
}

// ── ⑤ 테스트 + 성능 기준선 (§17) ──────────────────────────────────────────
{
  const out = execFileSync('npm', ['test'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const pass = Number(out.match(/^ℹ pass (\d+)/m)?.[1] ?? 0);
  const fail = Number(out.match(/^ℹ fail (\d+)/m)?.[1] ?? 1);
  const ms = Number(out.match(/^ℹ duration_ms ([\d.]+)/m)?.[1] ?? 0);
  if (fail > 0) bad(`테스트 실패 ${fail}건`);
  else ok(`테스트 ${pass}건 통과 (${(ms / 1000).toFixed(2)}s)`);
  if (ms > 5000) bad(`테스트가 기준선을 넘었다: ${(ms / 1000).toFixed(2)}s > 5s (§17)`);

  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {}).length;
  if (deps > 0) bad(`런타임 의존성이 생겼다: ${deps}개 (§17 의존성 0 유지)`);
  else ok('런타임 의존성 0');
  notes.push(`테스트 ${pass}건 / ${(ms / 1000).toFixed(2)}s`);
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
{
  let prev = null;
  try { prev = JSON.parse(await readFile(baselineFile, 'utf8')); } catch { /* 최초 */ }
  if (prev?.deferred !== deferred) {
    await writeFile(baselineFile, `${JSON.stringify({ deferred }, null, 2)}\n`);
  }
}
console.log(`[gate] PASS — ${notes.join(' · ')}`);
