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
const T_ADMIT = 'test/tcell-admission.test.js';
const MESH = 'src/kernel/l1-intent/context-mesh.js';
const SHAPE = 'src/kernel/l0-evidence/text-shape.js';
const TURN = 'src/kernel/turn.js';
const SHOWN = 'src/kernel/l5-growth/tcell-shown.js';
const T_SHOWN = 'test/tcell-shown.test.js';
const T_CITE = 'test/tcell-cite.test.js';
const CONTROL = 'src/kernel/l2-plan/model-control.js';
const CORR = 'src/kernel/l5-growth/tcell-correction.js';
const T_CORR = 'test/tcell-correction.test.js';
const T_CORR2 = 'test/tcell-correction-target.test.js';
const DECAY = 'src/kernel/l5-growth/tcell-decay.js';
const T_DECAY = 'test/tcell-decay.test.js';

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
  { 이름: '회차 사이에 시계를 다시 넣음(대기로 학습을 늦춤)', 파일: GROW, 검사: T_ROUND,
    찾기: "  job.state = 'retry_pending';\n  job.failures = 0;",
    바꾸기: "  job.state = 'retry_pending';\n  job.failures = 0;\n  job.nextAttemptAt = now + 6 * 60 * 60 * 1000;" },
  { 이름: '회차 상한을 없애 무한 재시도', 파일: GROW, 검사: T_ROUND,
    찾기: '  if (job.round + 1 >= GROW_CAPS.maxRounds) {', 바꾸기: '  if (false) {' },
  { 이름: 'replay·승인 없이 원리가 모델 입력에 듦', 파일: 'src/kernel/l1-intent/context-mesh.js', 검사: T_ROUND,
    찾기: '    return entry.replayPassed === true && entry.userConfirmed === true;',
    바꾸기: '    return true;' },
  { 이름: '무관한 요청에도 원리를 넣음(과잉 적용)', 파일: 'src/kernel/l1-intent/context-mesh.js', 검사: T_ROUND,
    찾기: '    .filter((e) => relevant(e, requestText))', 바꾸기: '' },

  { 이름: '표본 부족을 제안 단계에서 안 세고 다 돌림', 파일: GROW, 검사: T_GROW,
    찾기: '    if (부족.length) return { kind: \'propose\', 표본부족: 부족, statement: 초안.statement };',
    바꾸기: '' },
  { 이름: '묶음 잃은 job 을 호출 실패로 세어 회차를 태움', 파일: GROW, 검사: T_GROW,
    찾기: "    if (!계획.bundle) return { kind: 'propose', 묶음없음: true };",
    바꾸기: "    if (!계획.bundle) return { kind: 'propose', fail: 'bundle_gone' };" },

  // ── 검증된 원리의 입장 판정(사례 기반) ─────────────────────────────────
  { 이름: '입장 판정이 다시 낱말 겹침으로만(축약 발화를 못 알아봄)', 파일: MESH, 검사: T_ADMIT,
    찾기: '  if (!s?.appliesWhen?.length) return null; // 검증 사례가 없으면 이 판정을 쓰지 않는다',
    바꾸기: '  if (true) return null;' },
  { 이름: '비적용 사례를 안 봄(과잉 적용이 열림)', 파일: MESH, 검사: T_ADMIT,
    찾기: '  return 비적용 < 적용.overlap;', 바꾸기: '  return true;' },
  { 이름: '본보기 덮음을 안 봄(짧고 흔한 말이 걸림)', 파일: MESH, 검사: T_ADMIT,
    찾기: '  if (적용.overlap < SHAPE_SIMILARITY || 적용.coverage < SHAPE_SIMILARITY) return false;',
    바꾸기: '  if (적용.overlap < SHAPE_SIMILARITY) return false;' },
  { 이름: '입장 문턱을 0으로(아무 말에나 원리가 듦)', 파일: SHAPE, 검사: T_ADMIT,
    찾기: 'export const SHAPE_SIMILARITY = 0.45;', 바꾸기: 'export const SHAPE_SIMILARITY = 0;' },
  { 이름: '입장 문턱을 1로(축약 발화가 영영 못 듦)', 파일: SHAPE, 검사: T_ADMIT,
    찾기: 'export const SHAPE_SIMILARITY = 0.45;', 바꾸기: 'export const SHAPE_SIMILARITY = 1.01;' },
  { 이름: '검증 안 된 사례까지 비적용 신호로 씀', 파일: GROW, 검사: T_GROW,
    찾기: '  const 검증된 = job.cases.filter((c) => c.verdict?.pass === true);',
    바꾸기: '  const 검증된 = job.cases;' },
  { 이름: '적용 신호를 사례 서술문으로(사람 말과 결이 다름)', 파일: GROW, 검사: T_GROW,
    찾기: '    appliesWhen: [...new Set(반복발화)],',
    바꾸기: "    appliesWhen: 검증된.filter((c) => c.kind !== 'negative').flatMap((c) => c.inputFacts ?? [])," },

  // ── S5-1 보임 기록(렌더된 것만) ────────────────────────────────────────
  { 이름: '렌더 여부를 안 보고 후보 전부를 shown 으로', 파일: SHOWN, 검사: T_SHOWN,
    찾기: '    .filter((e) => e?.ref && 놓인것.has(e.statement))',
    바꾸기: '    .filter((e) => e?.ref)' },
  // (뺀 주입) "관련성과 무관하게 승격 기억 전부를 후보로" — 렌더 대조 가드가 그걸 그대로
  // 걸러내서 **행동이 바뀌지 않는다.** 안 무는 것이 결함이 아니라 가드가 일한 것이라 뺀다.
  // 가드 자체는 바로 아래 주입이 지킨다.
  { 이름: '보임 기록을 턴 신분과 안 묶음', 파일: SERVER, 검사: T_SHOWN,
    찾기: '            turnRef,\n            at: Date.now(),',
    바꾸기: '            turnRef: { sessionId: null, turnSeq: null },\n            at: Date.now(),' },
  { 이름: '보임 기록 상한 제거', 파일: SHOWN, 검사: T_SHOWN,
    찾기: '  return [...남길것, record].slice(-SHOWN_CAP);', 바꾸기: '  return [...남길것, record];' },

  // ── S5-2 인용(주장이지 사용 사실이 아니다) ─────────────────────────────
  { 이름: '보인 것과 대조하지 않고 인용을 그대로 받음(허공 인용 통과)', 파일: SHOWN, 검사: T_CITE,
    찾기: '    if (!e) { rejected.push(문장.slice(0, 120)); continue; } // 허공 인용',
    바꾸기: '    if (!e) { refs.push({ ref: 문장, kind: \'unknown\' }); continue; }' },
  { 이름: '렌더 안 된 것도 인용 대상으로(보여준 적 없는 기억을 인용 가능하게)', 파일: SHOWN, 검사: T_CITE,
    찾기: '    if (e?.ref && 보인것.refs.some((r) => r.ref === e.ref)) 문장에서신분.set(e.statement, e);',
    바꾸기: '    if (e?.ref) 문장에서신분.set(e.statement, e);' },
  { 이름: '인용을 실행 도구로 흘려보냄(통제 채널 분리 실패)', 파일: CONTROL, 검사: T_CITE,
    찾기: "    if (c.name === 'memory.cite') {", 바꾸기: '    if (false) {' },
  { 이름: '주장을 shown 사실 자리에 합쳐 넣음', 파일: SERVER, 검사: T_CITE,
    찾기: '            ...(result.modelCitedRefs?.length ? { modelCitedRefs: result.modelCitedRefs } : {}),',
    바꾸기: '            ...(result.modelCitedRefs?.length ? { refs: [...result.shownMemoryRefs.refs, ...result.modelCitedRefs] } : {}),' },

  // ── S5-3 정정 상관(통계지 사실이 아니다) ───────────────────────────────
  { 이름: '지목을 대조하지 않고 아무 shown 에나 상관을 남김', 파일: CORR, 검사: T_CORR,
    찾기: '  const 맞은것 = (관련.refs ?? []).find((r) => r.statement === 지목);',
    바꾸기: '  const 맞은것 = (관련.refs ?? [])[0];' },
  // (뺀 주입) "지목 없이도 상관을 남김" — 빈 지목은 아래 문장 대조에서 어차피 아무 것도
  // 맞히지 못해 **행동이 바뀌지 않는다.** 안 무는 것이 결함이 아니라 대조가 일한 것이라 뺀다.
  { 이름: '인용이 있으면 문턱을 낮춤(cite 가 뒷문으로 감쇠 조건이 됨)', 파일: CORR, 검사: T_CORR,
    찾기: '    .filter((x) => (x.turns?.length ?? 0) >= min)',
    바꾸기: "    .filter((x) => (x.turns?.length ?? 0) >= (x.turns?.some((t) => t.confidence === 'cited') ? 1 : min))" },
  { 이름: '같은 정정 턴을 여러 번 셈(통계 부풀리기)', 파일: CORR, 검사: T_CORR,
    찾기: '  if (!칸.turns.some((t) => 같은턴(t, turnRef))) {',
    바꾸기: '  if (true) {' },
  { 이름: '상관 1회로 감쇠 후보가 됨', 파일: CORR, 검사: T_CORR,
    찾기: 'export const CORRELATION_MIN = 2;', 바꾸기: 'export const CORRELATION_MIN = 1;' },
  { 이름: '정정보다 뒤의 턴도 가리킴(직전 관련 턴이 아님)', 파일: CORR, 검사: T_CORR,
    찾기: '    .filter((x) => Number.isInteger(x.turnRef?.turnSeq) && x.turnRef.turnSeq < turnRef.turnSeq)',
    바꾸기: '    .filter((x) => Number.isInteger(x.turnRef?.turnSeq))' },
  { 이름: '다른 대화의 기록까지 가리킴', 파일: CORR, 검사: T_CORR,
    찾기: '    .filter((x) => x.turnRef?.sessionId === turnRef?.sessionId)', 바꾸기: '' },
  { 이름: '모델 신호 없이도 상관을 만듦(낱말 규칙으로 되돌림)', 파일: SERVER, 검사: T_CORR,
    찾기: '          if (result.memoryCorrection) {',
    바꾸기: "          if (result.memoryCorrection || /아니|틀렸/.test(String(input.text ?? ''))) {\n            result.memoryCorrection = result.memoryCorrection ?? { target: (result.shownMemoryRefs?.refs ?? [])[0]?.statement };" },
  { 이름: '지목할 목록을 안 줌(모델이 지어내게 됨)', 파일: SERVER, 검사: T_CORR2,
    찾기: '    return (직전.refs ?? []).map((r) => r.statement).filter(Boolean);',
    바꾸기: '    return [];' },

  // ── S5-4 가역 감쇠(잘못 내리지 않는 것이 먼저다) ───────────────────────
  { 이름: '상관 1회로도 내림(문턱 붕괴)', 파일: DECAY, 검사: T_DECAY,
    찾기: '    if (셀것.length < CORRELATION_MIN) continue;',
    바꾸기: '    if (셀것.length < 1) continue;' },
  { 이름: 'cite 확신이 있으면 문턱을 낮춤(뒷문)', 파일: DECAY, 검사: T_DECAY,
    찾기: '    if (셀것.length < CORRELATION_MIN) continue;',
    바꾸기: "    if (셀것.length < (셀것.some((t) => t.confidence === 'cited') ? 1 : CORRELATION_MIN)) continue;" },
  { 이름: 'pin 도 자동으로 내림(사용자가 붙든 것을 OS 가 뗌)', 파일: DECAY, 검사: T_DECAY,
    찾기: '    if (e.pinned) continue; // 사용자가 붙들어 둔 것은 OS 가 내리지 않는다', 바꾸기: '' },
  { 이름: '한 번에 몰아서 내림(상한 제거)', 파일: DECAY, 검사: T_DECAY,
    찾기: '    if (decayed.length >= DECAY_CAPS.perRun) break;', 바꾸기: '' },
  { 이름: '감쇠를 삭제로 바꿈(되돌릴 수 없게)', 파일: DECAY, 검사: T_DECAY,
    찾기: '    e.decayedAt = now;',
    바꾸기: '    e.decayedAt = now;\n    memory.promoted = memory.promoted.filter((x) => x !== e);' },
  { 이름: '복원해도 입장하지 않음(표식이 안 걷힘)', 파일: DECAY, 검사: T_DECAY,
    찾기: '  delete e.decayedAt;', 바꾸기: '' },
  { 이름: '복원 뒤 같은 근거로 다시 내림(무한 왕복)', 파일: DECAY, 검사: T_DECAY,
    찾기: '  e.decayJudgedUpTo = now;', 바꾸기: '' },
  { 이름: '내려간 기억이 여전히 모델 입장(게이트 무력화)', 파일: MESH, 검사: T_DECAY,
    찾기: '  if (Number.isFinite(entry.decayedAt)) return false;', 바꾸기: '' },
  { 이름: '내려간 것을 표면에서 감춤(사용자가 되돌릴 수 없게)', 파일: SERVER, 검사: T_DECAY,
    찾기: '          decayed: 내려감,', 바꾸기: '          decayed: [],' },
  { 이름: '감쇠를 원장에 안 남김', 파일: SERVER, 검사: T_DECAY,
    찾기: "        await 기억영수증('decayed', e ?? { candidateId: d.ref, kind: d.kind });", 바꾸기: '' },

  // ── §4.3 묶음 · §4.7 lane ───────────────────────────────────────────────
  { 이름: '표현이 달라도 안 묶이게(문턱을 1.0 으로)', 파일: OBSERVE, 검사: T_OBS,
    찾기: 'export const BUNDLE_SIMILARITY = 0.45;', 바꾸기: 'export const BUNDLE_SIMILARITY = 1.01;' },
  { 이름: '무관한 것까지 한 묶음으로(문턱 0)', 파일: OBSERVE, 검사: T_OBS,
    찾기: 'export const BUNDLE_SIMILARITY = 0.45;', 바꾸기: 'export const BUNDLE_SIMILARITY = 0;' },
  { 이름: '군집 씨앗을 id 순으로(나중 관찰이 앞자리를 뺏어 신분이 갈림)', 파일: OBSERVE, 검사: T_OBS,
    찾기: '  const sorted = [...observations].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)\n    || a.observationId.localeCompare(b.observationId));',
    바꾸기: '  const sorted = [...observations].sort((a, b) => a.observationId.localeCompare(b.observationId));' },
  { 이름: '묶음 신분을 구성원 전체로(관찰 하나에 신분이 바뀜)', 파일: OBSERVE, 검사: T_OBS,
    찾기: "      bundleId: digest(['bundle', c.kind, c.members[0].observationId]),",
    바꾸기: "      bundleId: digest(['bundle', c.kind, ...ids])," },
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
