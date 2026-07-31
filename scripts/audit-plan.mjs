#!/usr/bin/env node
// 계획-코드 고정값 대조 (2026-07-31) — **계획에 적힌 숫자를 코드가 그대로 들고 있는가.**
//
// 왜 있나: S4 후반에서 계획 §4.10 이 `성장 모델 호출 tick당 ≤2` 라고 못박았는데 구현은 20 이었고,
// "상한 준수" 검사까지 그 20 을 기준으로 재고 있었다. 계획을 검사가 지킨 게 아니라 검사가 구현을
// 따라간 것이다. 사람이 눈으로 대조하는 한 이 계열은 또 난다 — 그래서 기계가 대조한다.
//
// 규칙 두 개만 지킨다:
//   ① 계획 문장에서 값을 **읽지 못하면 실패한다.** 못 찾은 걸 통과로 넘기면 검사가 아니라 장식이다.
//   ② 코드 상수는 실제 모듈에서 import 한다. 문자열 grep 은 주석에 속는다.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAN = 'design/T5-TCELL-DEVELOPMENT-PLAN-2026-07-31-ko.md';

/** 계획 본문에서 정규식 한 자리를 읽는다. 못 읽으면 그 자체가 오류다(계획이 바뀐 것이다). */
function 계획값(text, 이름, re) {
  const m = re.exec(text);
  if (!m) return { 이름, 오류: `계획에서 '${이름}' 값을 못 읽었다 — 계획 문장이 바뀌었으면 이 검사를 먼저 고쳐라` };
  return { 이름, 값: Number(m[1].replace(/,/g, '')) };
}

export async function auditPlan(repo = REPO) {
  const plan = await readFile(join(repo, PLAN), 'utf8');
  const { OBSERVATION_CAPS } = await import(join(repo, 'src/kernel/l5-growth/tcell-observe.js'));
  const { LANE_CAPS } = await import(join(repo, 'src/kernel/l5-growth/tcell-lane.js'));
  const { GROW_CAPS } = await import(join(repo, 'src/kernel/l5-growth/tcell-grow.js'));
  const { SUITE_MINIMUM } = await import(join(repo, 'src/kernel/l5-growth/tcell-replay.js'));

  const 일 = 24 * 60 * 60 * 1000;
  const 대조 = [
    // §4.10 상한 표
    [계획값(plan, 'observations 세션당', /observations \| 세션당 ([\d,]+)/), OBSERVATION_CAPS.perSession, 1],
    [계획값(plan, 'observations 전체', /observations \| 세션당 [\d,]+ · 전체 ([\d,]+)/), OBSERVATION_CAPS.total, 1],
    [계획값(plan, 'observations TTL(일)', /observations \|[^|]*TTL (\d+)일/), OBSERVATION_CAPS.ttlMs, 일],
    [계획값(plan, 'bundles 전체', /bundles \| 전체 ([\d,]+)/), OBSERVATION_CAPS.bundles, 1],
    [계획값(plan, 'lane 전체', /ActiveWorkLane \| 전체 ([\d,]+)/), LANE_CAPS.total, 1],
    [계획값(plan, 'lane TTL(일)', /ActiveWorkLane \|[^|]*TTL (\d+)일/), LANE_CAPS.ttlMs, 일],
    [계획값(plan, '성장 호출 tick당', /성장 모델 호출 \| tick당 ≤(\d+)/), GROW_CAPS.callsPerTick, 1],
    [계획값(plan, '성장 호출 일일', /성장 모델 호출 \| tick당 ≤\d+ · 일일 ≤(\d+)/), GROW_CAPS.callsPerDay, 1],
    // §4.4 최소 suite
    [계획값(plan, 'suite positive', /최소 suite: positive ≥(\d+)/), SUITE_MINIMUM.positive, 1],
    [계획값(plan, 'suite negative', /최소 suite:[^\n]*negative ≥(\d+)/), SUITE_MINIMUM.negative, 1],
    [계획값(plan, 'suite boundary', /최소 suite:[^\n]*boundary ≥(\d+)/), SUITE_MINIMUM.boundary, 1],
    [계획값(plan, 'suite authority', /authority ≥(\d+)/), SUITE_MINIMUM.authority, 1],
  ];

  const errors = [];
  for (const [계획, 코드값, 배수] of 대조) {
    if (계획.오류) { errors.push(계획.오류); continue; }
    const 기대 = 계획.값 * 배수;
    if (코드값 !== 기대) {
      errors.push(`고정값 어긋남 '${계획.이름}': 계획 ${기대} ≠ 코드 ${코드값}`);
    }
  }
  // kill switch 는 숫자가 아니라 존재 여부다 — 계획이 요구하면 코드에 있어야 한다.
  if (/성장 모델 호출 \|[^|]*kill switch/.test(plan)) {
    const server = await readFile(join(repo, 'src/surface/server.js'), 'utf8');
    if (!/GPAO_T5_TCELL/.test(server)) errors.push("계획이 요구한 성장 kill switch 가 서버 배선에 없다");
  }
  return { errors, checked: 대조.length };
}

const r = await auditPlan();
if (r.errors.length) {
  for (const e of r.errors) console.error(`FAIL · ${e}`);
  console.error(`\nPLAN↔CODE: FAIL (${r.errors.length}건)`);
  process.exit(1);
}
console.log(`PLAN↔CODE: PASS (고정값 ${r.checked}개 대조)`);
