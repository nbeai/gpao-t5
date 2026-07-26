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

// ── ① 라이브 레지스트리에 스텁(fixture)이 없다 (§16-C) ────────────────────
{
  const { liveDeps } = await import('../src/surface/live-context.js');
  const registry = liveDeps({}).tools?.tools ?? {};
  const fixtures = Object.entries(registry).filter(([, t]) => t?.isFixture).map(([id]) => id);
  if (fixtures.length) bad(`라이브에 스텁 등록: ${fixtures.join(', ')} — 등록된 도구는 실제로 동작해야 한다`);
  else ok(`라이브 도구 ${Object.keys(registry).length}개 모두 실제 구현`);
}

// ── ② 위험 작업이 승인 없이 실행되지 않는다 (안전 바닥) ───────────────────
{
  const { interpret } = await import('../src/kernel/l1-intent/intent.js');
  const { buildActionPlan } = await import('../src/kernel/l2-plan/action-plan.js');
  const { buildSelfState } = await import('../src/kernel/l0-evidence/self-state.js');
  const { demoEnv } = await import('../src/surface/demo-context.js');
  const selfState = buildSelfState(demoEnv());
  // 위험 발화 → 반드시 승인 대기여야 한다. 하나라도 자동 진행되면 안전 바닥이 샌 것이다.
  const risky = [
    ['파일 삭제', '메모.md 지워줘'],
    ['파일 쓰기', "메모.md 만들어서 '내용'이라고 적어줘"],
    ['슬랙 전송', '슬랙에 회의 시작이라고 올려줘'],
  ];
  for (const [label, text] of risky) {
    const plan = buildActionPlan({ intent: interpret(text), selfState });
    const gated = plan.needsApproval?.length > 0;
    if (!gated) bad(`${label}이 승인 없이 실행된다: "${text}"`);
  }
  if (!failures.length) ok(`위험 작업 ${risky.length}종 모두 승인 게이트 통과`);
}

// ── ③ "후속/TODO" 가 늘지 않았다 (§16-B 후속 남용 방지) ───────────────────
let deferred = 0;
{
  const out = execFileSync('bash', ['-lc',
    `grep -rEoh '후속|TODO|FIXME|아직 (안|없|구현)' ${root}src --include='*.js' | wc -l`,
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

// ── ④ 테스트 + 성능 기준선 (§17) ──────────────────────────────────────────
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

// ── ⑤ 프로세스 산출물이 커밋되지 않았다 ───────────────────────────────────
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
await writeFile(baselineFile, JSON.stringify({ deferred, updatedAt: new Date().toISOString() }, null, 2));
console.log(`[gate] PASS — ${notes.join(' · ')}`);
