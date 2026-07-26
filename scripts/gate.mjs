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
  const { CAPABILITY_LINES } = await import('../src/kernel/tool-labels.js').then((m) => ({
    CAPABILITY_LINES: m.allCapabilityLines?.() ?? null,
  })).catch(() => ({ CAPABILITY_LINES: null }));
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
