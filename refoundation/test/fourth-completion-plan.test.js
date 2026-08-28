import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('4차 정본은 Cleanroom에서 S4-A만 열고 전체 Gate를 한 문서에 고정한다', async () => {
  const [plan, agents, second] = await Promise.all([
    readFile(new URL('T5-FOURTH-COMPLETION.md', root), 'utf8'),
    readFile(new URL('AGENTS.md', root), 'utf8'),
    readFile(new URL('T5-SECOND-COMPLETION.md', root), 'utf8'),
  ]);
  assert.match(plan, /FOURTH_COMPLETION_ACTIVE · S4_0_COMPLETE · S4_A_BASELINE_ACTIVE · PRODUCT_CODE_LOCKED/u);
  assert.match(plan, /t5-0\.3\.1-clean-baseline · 8aba3700/u);
  assert.match(plan, /현재 Gate: `S4-A SINGLE SOURCE · MINIMUM FAILURE BASELINE`/u);
  const gates = ['S4-0', 'S4-A', 'S4-B', 'S4-C', 'S4-D', 'S4-E', 'S4-F', 'S4-G',
    'S4-H', 'S4-I', 'S4-J', 'S4-K', 'S4-UX', 'S4-L', 'S4-HQ'];
  let cursor = -1;
  for (const gate of gates) { const next = plan.indexOf(`### ${gate} —`); assert.ok(next > cursor, gate); cursor = next; }
  assert.match(plan, /최초 실패 하나로 구현을 열되[\s\S]*서로 다른 세 목적 분야/u);
  assert.match(plan, /Experience-Based Growth[\s\S]*Capability Reality & Acquisition/u);
  assert.match(plan, /S4-UX — Interaction Continuity & Human Reassurance[\s\S]*canonical status projection/u);
  assert.match(plan, /짧은 작업은 별도 진행 소음 없이[\s\S]*긴 작업은 실제 단계가 바뀔 때만/u);
  assert.match(plan, /Console·Telegram에서 같은 canonical 상태/u);
  assert.match(plan, /S4-UX의 단일 상태·진행 밀도·교정·중지·재접속 계약[\s\S]*Windows x64·ARM64/u);
  assert.match(plan, /Windows는 마지막에 처음 고려하지 않는다/u);
  assert.match(plan, /기존 모듈은 정본이 아니라 교재/u);
  assert.match(agents, /`T5-FOURTH-COMPLETION\.md` — 지금 어느 Gate/u);
  assert.match(second, /현재 후속 Gate: `T5-FOURTH-COMPLETION\.md · S4-A`/u);
});

test('S4-A 기계 증거는 일곱 재사용 축과 미개통 S4-B를 정직하게 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-a-android-work-intelligence-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_A_DETERMINISTIC_BASELINE_PASS_LIVE_REPLAY_PENDING');
  assert.equal(evidence.baseCommit, '8aba370095d0620e49b9cd61012a1813be015539');
  assert.equal(evidence.productChanges, 0);
  assert.deepEqual(evidence.baselineSelection.map((item) => item.lane), [
    'business', 'development', 'research', 'personal_file',
    'capability_gap', 'long_execution', 'risk_boundary',
  ]);
  for (const lane of evidence.baselineSelection) {
    assert.ok(lane.scenarioIds.length > 0);
    for (const source of lane.sources) await readFile(new URL(`../../${source}`, import.meta.url));
  }
  assert.equal(evidence.firstCurrentDefect.reproduced, false);
  assert.equal(evidence.firstCurrentDefect.family, null);
  assert.equal(evidence.s4bAuthorized, false);
  assert.deepEqual(evidence.deterministicVerification.focusedTests, { passed: 57, failed: 0 });
  assert.deepEqual(evidence.deterministicVerification.dailyCheck, { passed: 1638, failed: 0, skipped: 1 });
  assert.equal(evidence.sourceDigests['T5-FOURTH-COMPLETION.md'], digest(await readFile(
    new URL('../../T5-FOURTH-COMPLETION.md', import.meta.url))));
  assert.ok(evidence.gateCloseRequires.some((item) => item.includes('three different purpose domains')));
});

test('S4-A 동안 Cleanroom 대비 제품 source와 UI 변경은 0이다', () => {
  execFileSync('git', ['diff', '--quiet', 't5-0.3.1-clean-baseline', '--',
    'refoundation/src', 'refoundation/ui'], { cwd: new URL('../..', import.meta.url) });
});
