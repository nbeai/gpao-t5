#!/usr/bin/env node
// 돌연변이 스윕 (2026-07-31) — **검사가 정말 무는가.**
//
// 왜 있나: 이번 T-cell 구현에서 제일 자주 난 실수는 버그가 아니라 **기능을 지워도 통과하는
// 검사**였다(요청문 없이 부른 `admittedContext` 는 언제나 0 · 익지 않은 묶음으로 잰 전경 비용 ·
// 실패할 수 없는 자리에 둔 증거 검증). 전부 "코드를 쓴 머리가 검사도 써서 같은 맹점을
// 물려받은" 한 가지 모양이다.
//
// 그 해독제로 매 슬라이스마다 손으로 돌연변이를 넣어 돌렸는데, 손으로 하니 두 번은 조용히
// 빠져나갔고 세션이 끝나면 그 지식도 사라졌다. 여기 적어 두면 다음 사람이 물려받는다.
//
// 규칙:
//   ① 각 주입은 **정확히 한 자리**에만 걸려야 한다. 여러 자리에 걸리는 주입은 무엇을 쟀는지
//      알 수 없으므로 오류로 본다.
//   ② 주입 뒤 지정한 검사 파일이 **반드시 실패**해야 한다. 통과하면 그 계약은 지금 무방비다.
//   ③ 무슨 일이 있어도 원본을 되돌린다. 되돌리기에 실패하면 크게 소리친다.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const GROW = 'src/kernel/l5-growth/tcell-grow.js';
const REPLAY = 'src/kernel/l5-growth/tcell-replay.js';
const OBSERVE = 'src/kernel/l5-growth/tcell-observe.js';
const LANE = 'src/kernel/l5-growth/tcell-lane.js';
const CONN = 'src/surface/model-connection.js';
const SERVER = 'src/surface/server.js';

const T_GROW = 'test/tcell-grow.test.js';
const T_REPLAY = 'test/tcell-replay.test.js';
const T_OBS = 'test/tcell-observation.test.js';
const T_LANE = 'test/tcell-lane.test.js';
const T_IDN = 'test/tcell-model-identity.test.js';
const T_ROUND = 'test/tcell-round-retry.test.js';

/**
 * 주입 목록. 각 줄은 "이 계약이 깨지면 어떤 검사가 울어야 하는가"의 기록이다.
 * 새 계약을 만들면 여기 한 줄을 더한다 — 그게 곧 "이 계약을 지키는 검사가 있다"는 증명이다.
 */
export const MUTATIONS = [
  // ── §4.4 replay 증거 결합 ───────────────────────────────────────────────
  { 이름: '계보 대신 호출자가 고른 영수증을 조회', 파일: REPLAY, 검사: T_REPLAY,
    찾기: 'const ref = replayCase?.runReceiptRef;',
    바꾸기: 'const ref = ctx?.runReceiptRef ?? replayCase?.runReceiptRef;' },
  { 이름: '계보 부재 거절 제거', 파일: REPLAY, 검사: T_REPLAY,
    찾기: "  if (!ref) return { ok: false, reason: 'run_receipt_ref_missing' };", 바꾸기: '' },
  { 이름: '영수증이 주장된 outputDigest 를 받아들임', 파일: REPLAY, 검사: T_REPLAY,
    찾기: '    outputDigest: outputDigestOf(p.outputText),',
    바꾸기: '    outputDigest: p.outputDigest ?? outputDigestOf(p.outputText),' },
  { 이름: '저장된 산출물 대신 호출자 digest 로 대조', 파일: REPLAY, 검사: T_REPLAY,
    찾기: "  if (typeof 산출물 !== 'string') return { ok: false, reason: 'output_not_stored' };",
    바꾸기: '  if (typeof 산출물 !== \'string\') return { ok: true, responseIdentityVerified: false };' },

  // ── §4.6 호출 신분 ──────────────────────────────────────────────────────
  { 이름: '자격·주소가 바뀌어도 같은 instance 로 둠', 파일: CONN, 검사: T_IDN,
    찾기: '  const 그대로 = prev?.instanceId && prev?.credentialFp === fp;',
    바꾸기: '  const 그대로 = Boolean(prev?.instanceId);' },
  { 이름: '실제 호출 대신 선택값을 신분으로 복사', 파일: CONN, 검사: T_IDN,
    찾기: '            actualEndpointOrigin: 실제?.endpointOrigin ?? null,',
    바꾸기: '            actualEndpointOrigin: selection.endpointOrigin,' },

  // ── §4.10 예산 · §4.8 자물쇠 ────────────────────────────────────────────
  { 이름: 'tick 상한을 계획보다 높임', 파일: GROW, 검사: T_GROW,
    찾기: '  callsPerTick: 2,', 바꾸기: '  callsPerTick: 20,' },
  { 이름: '예산 예약 없이 잔량만 보고 부름', 파일: GROW, 검사: T_GROW,
    찾기: '    m.growBudget = { day: 예산.day, used: 예산.used + 예약 };',
    바꾸기: '    m.growBudget = { day: 예산.day, used: 예산.used };' },
  { 이름: '쓴 호출을 예산에 안 적음', 파일: GROW, 검사: T_GROW,
    찾기: '    m.growBudget = { day: 예산.day, used: Math.max(0, 예산.used - 계획.예약) + calls };',
    바꾸기: '    m.growBudget = { day: 예산.day, used: 예산.used };' },
  { 이름: '빌림 없이 job 을 집음(동시 착수 허용)', 파일: GROW, 검사: T_GROW,
    찾기: '    job.nextAttemptAt = now + GROW_CAPS.leaseMs;', 바꾸기: '    job.nextAttemptAt = 0;' },
  { 이름: '빌림을 영구화(만료 없음)', 파일: GROW, 검사: T_GROW,
    찾기: '    job.nextAttemptAt = now + GROW_CAPS.leaseMs;',
    바꾸기: '    job.nextAttemptAt = Number.MAX_SAFE_INTEGER;' },
  { 이름: '현재 상태 가드 제거(지나간 시도도 반영)', 파일: GROW, 검사: T_GROW,
    찾기: "    if (!job || job.attemptId !== 계획.job.attemptId) return { calls, reason: 'superseded' };",
    바꾸기: "    if (!job) return { calls, reason: 'superseded' };" },
  { 이름: '성장 호출을 자물쇠 안으로', 파일: SERVER, 검사: T_GROW,
    찾기: '      const r = await growTick({\n        memStore, store, withMemory,',
    바꾸기: '      const r = await withMemory(() => growTick({\n        memStore, store,' },

  // ── §4.3 상태기계 · 회차 ────────────────────────────────────────────────
  { 이름: '신분 미확인 호출로도 계속 진행', 파일: GROW, 검사: T_GROW,
    찾기: "    if (!v.ok) return { ok: false, reason: 'call_identity_unverified', identityReason: v.reason };",
    바꾸기: '' },
  { 이름: '예산 미룸을 실패로 세어 backoff', 파일: GROW, 검사: T_GROW,
    찾기: "  if (reason === 'tick_cap') { job.nextAttemptAt = 0; job.updatedAt = now; return; }", 바꾸기: '' },
  { 이름: '못 물어본 판정을 판정 불가로 굳힘', 파일: GROW, 검사: T_GROW,
    찾기: '      verdict: 판정.ok ? 판정읽기(판정.text) : undefined,',
    바꾸기: '      verdict: 판정.ok ? 판정읽기(판정.text) : null,' },
  { 이름: 'suite 실패에도 묶음을 소비', 파일: GROW, 검사: T_GROW,
    찾기: '    회차종료(job, `suite_failed:${report.missing.join(\',\')}`, now);',
    바꾸기: '    회차종료(job, \'suite_failed\', now);\n    m.grownBundles = [...new Set([...(m.grownBundles ?? []), job.bundleId])];' },
  { 이름: '종단이 저절로 되살아남', 파일: GROW, 검사: T_GROW,
    찾기: "const 종단 = new Set(['passed', 'exhausted']);", 바꾸기: "const 종단 = new Set(['passed']);" },
  { 이름: '앞 회차 실패를 다음 회차에 안 넘김(재추첨)', 파일: GROW, 검사: T_GROW,
    찾기: '        [...(준비된.priorAttempts ?? []), ...(요약 ? [요약] : [])]);',
    바꾸기: '        []);' },
  { 이름: '첫 회차에도 없는 이력을 붙임', 파일: GROW, 검사: T_GROW,
    찾기: '  const 앞선것 = priorAttempts.length ? [', 바꾸기: '  const 앞선것 = true ? [' },
  { 이름: '옛 job 의 실패 이력을 복원하지 않음(통로가 안 닿음)', 파일: GROW, 검사: T_GROW,
    찾기: '      const 요약 = 실패요약복원(memory, 준비된);',
    바꾸기: '      const 요약 = 준비된.실패요약 ?? null;' },
  { 이름: '복원할 사실이 없어도 껍데기를 만듦', 파일: GROW, 검사: T_GROW,
    찾기: '  if (!job.statement || !job.principleId) return null;',
    바꾸기: '  if (!job.statement || !job.principleId) return { statement: job.statement ?? \'(모름)\', missing: [], reasons: [] };' },

  // ── 회차 재시도가 학습 품질을 개선하는가(격리 시간 주입 증명) ──────────
  { 이름: '만료 전에도 회차를 염(cooldown 무시)', 파일: GROW, 검사: T_ROUND,
    찾기: '  const 준비된 = jobs.find((j) => !종단.has(j.state) && (j.nextAttemptAt ?? 0) <= now);',
    바꾸기: '  const 준비된 = jobs.find((j) => !종단.has(j.state));' },
  { 이름: 'replay·승인 없이 원리가 모델 입력에 듦', 파일: 'src/kernel/l1-intent/context-mesh.js', 검사: T_ROUND,
    찾기: '    return entry.replayPassed === true && entry.userConfirmed === true;',
    바꾸기: '    return true;' },
  { 이름: '무관한 요청에도 원리를 넣음(과잉 적용)', 파일: 'src/kernel/l1-intent/context-mesh.js', 검사: T_ROUND,
    찾기: '    .filter((e) => relevant(e, requestText))', 바꾸기: '' },

  // ── §4.3 묶음 · §4.7 lane ───────────────────────────────────────────────
  { 이름: '표현이 달라도 안 묶이게(문턱을 1.0 으로)', 파일: OBSERVE, 검사: T_OBS,
    찾기: 'export const BUNDLE_SIMILARITY = 0.45;', 바꾸기: 'export const BUNDLE_SIMILARITY = 1.01;' },
  { 이름: '무관한 것까지 한 묶음으로(문턱 0)', 파일: OBSERVE, 검사: T_OBS,
    찾기: 'export const BUNDLE_SIMILARITY = 0.45;', 바꾸기: 'export const BUNDLE_SIMILARITY = 0;' },
  { 이름: 'lane 의 principal 경계 제거', 파일: LANE, 검사: T_LANE,
    찾기: '    if (!ctx.principalRef || l.scopeRef?.principalRef !== ctx.principalRef) return false;',
    바꾸기: '    if (false) return false;' },
  { 이름: '실패한 실행도 산출물로 취급', 파일: LANE, 검사: T_LANE,
    찾기: "const 성공 = (r) => r?.lifecycle === 'executed' && (r.failureState ?? 'none') === 'none';",
    바꾸기: 'const 성공 = () => true;' },
];

async function 한번(m, repo) {
  const path = join(repo, m.파일);
  const 원본 = await readFile(path, 'utf8');
  const 자리수 = 원본.split(m.찾기).length - 1;
  if (자리수 !== 1) {
    return { ...m, 결과: 'anchor', 메모: `주입 지점이 ${자리수}곳 — 정확히 한 자리여야 한다` };
  }
  try {
    await writeFile(path, 원본.replace(m.찾기, m.바꾸기), 'utf8');
    const r = spawnSync('node', ['--test', '--test-timeout=30000', m.검사], { cwd: repo, encoding: 'utf8' });
    // 종료코드 0 = 검사가 전부 통과 = **주입이 빠져나갔다**.
    return { ...m, 결과: r.status === 0 ? 'escaped' : 'caught' };
  } finally {
    await writeFile(path, 원본, 'utf8');
    const 되돌림 = await readFile(path, 'utf8');
    if (되돌림 !== 원본) {
      console.error(`\n치명: ${m.파일} 을 원래대로 되돌리지 못했다. git 으로 확인하라.`);
      process.exit(2);
    }
  }
}

export async function auditMutation(repo = REPO, 목록 = MUTATIONS) {
  const 결과 = [];
  for (const m of 목록) {
    const r = await 한번(m, repo);
    결과.push(r);
    const 표 = { caught: '물었다', escaped: '빠져나갔다', anchor: '주입 실패' }[r.결과];
    console.log(`${r.결과 === 'caught' ? ' ok ' : 'FAIL'} · ${표.padEnd(6)} · ${r.이름}${r.메모 ? ` (${r.메모})` : ''}`);
  }
  return 결과;
}

const 결과 = await auditMutation();
const 샌것 = 결과.filter((r) => r.결과 !== 'caught');
if (샌것.length) {
  console.error(`\nMUTATION SWEEP: FAIL — ${샌것.length}/${결과.length} 건이 검사에 안 걸린다`);
  console.error('빠져나간 주입은 그 계약이 지금 무방비라는 뜻이다. 검사를 먼저 세워라.');
  process.exit(1);
}
console.log(`\nMUTATION SWEEP: PASS (${결과.length}건 전부 검사가 물었다)`);
