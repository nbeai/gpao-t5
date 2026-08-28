import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('4차 정본은 S4-D0 fact-only 교정 뒤 S4-C workspace presence qualification만 연다', async () => {
  const [plan, agents, second] = await Promise.all([
    readFile(new URL('T5-FOURTH-COMPLETION.md', root), 'utf8'),
    readFile(new URL('AGENTS.md', root), 'utf8'),
    readFile(new URL('T5-SECOND-COMPLETION.md', root), 'utf8'),
  ]);
  assert.match(plan, /FOURTH_COMPLETION_ACTIVE · S4_0_COMPLETE · S4_A_COMPLETE · S4_B_COMPLETE_MODEL_OBSERVATION · S4_D0_FACT_ONLY_CORRECTED · S4_C_WORKSPACE_PRESENCE_QUALIFICATION_ACTIVE · PRODUCT_CODE_LOCKED/u);
  assert.match(plan, /t5-0\.3\.1-clean-baseline · 8aba3700/u);
  assert.match(plan, /현재 Gate: `S4-C SITUATION & HAND · WORKSPACE PRESENCE QUALIFICATION-ONLY A\/B`/u);
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
  assert.match(plan, /S4-B — Purpose & Done Model Reality/u);
  assert.match(plan, /Work brief Tool·목적 schema·성공 기준 schema·Intent enum·목적 전용 Store/u);
  assert.match(plan, /제품 변경 0[\s\S]*gpt-5\.5 반복과 Terra/u);
  assert.match(plan, /exact source 재투영 후보는 열지 않는다/u);
  assert.match(plan, /S4-C — Situation·Hand의 실제 차이 수리 — WORKSPACE PRESENCE QUALIFICATION ACTIVE/u);
  assert.match(plan, /첫 기준선은 KHB-S01/u);
  assert.match(plan, /connection list가 로컬 Evidence보다 먼저 호출/u);
  assert.match(plan, /find -printf[\s\S]*exit 0/u);
  assert.match(plan, /S4-D — Terminal 실행 중 output·process 미달 — D0 FACT-ONLY CORRECTED, BROADER GATE UNOPENED/u);
  assert.match(plan, /전역 pipefail과 exit-code 예외 목록은 적용하지 않았다/u);
  assert.match(plan, /workspacePresence:[\s\S]*scope: current_managed_workspace[\s\S]*contentIncluded: false/u);
  assert.match(plan, /Transmission Receipt는 `workspace_presence`/u);
  assert.match(plan, /A03·S01·M05·HP-01과 empty workspace/u);
  assert.match(plan, /boolean 실패 뒤 metadata 확대/u);
  assert.match(plan, /각 local engine·model·Capability의 실제 사용 가능 여부[\s\S]*개인정보 범위/u);
  assert.match(plan, /publishable output, internal intermediate, diagnostic, temporary, cleanup/u);
  assert.match(plan, /두 행의 고유값 교환[\s\S]*요청하지 않은 개인정보 JSON/u);
  assert.match(plan, /one-to-one·one-to-many·many-to-one·ambiguous·unmatched·conflicting/u);
  assert.match(plan, /최종 Excel·ZIP을 독립 재개방/u);
  assert.match(plan, /model partial[\s\S]*surface persistence[\s\S]*delivery terminal/u);
  assert.match(plan, /engine·model 후보별 identity[\s\S]*local\/external[\s\S]*privacy scope/u);
  assert.match(plan, /사용자 메시지·T5 답변·실제 작업시간/u);
  assert.match(plan, /Artifact lineage에서 version이 단조 증가/u);
  assert.match(plan, /내부 `sandbox:` URL/u);
  assert.match(plan, /권역별 Excel 6개[\s\S]*내부 파일 0/u);
  assert.match(plan, /장시간 한국어 오디오[\s\S]*Notion에 반영·재개방/u);
  assert.match(agents, /`T5-FOURTH-COMPLETION\.md` — 지금 어느 Gate/u);
  assert.match(second, /현재 후속 Gate: `T5-FOURTH-COMPLETION\.md · S4-C`/u);
});

test('S4-A 기계 증거는 일곱 재사용 축과 재현된 최초 S4-B 결함을 분리한다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-a-android-work-intelligence-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.status, 'S4_A_COMPLETE_S4_B_COMPLETE_MODEL_OBSERVATION_S4_C_BASELINE_OPEN');
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
  assert.equal(evidence.firstCurrentDefect.reproduced, true);
  assert.equal(evidence.firstCurrentDefect.family, 'purpose_result_scope');
  assert.equal(evidence.firstCurrentDefect.promptAnalysis.promptDumps, 6);
  assert.equal(evidence.firstCurrentDefect.separation.evidenceCorrect, true);
  assert.equal(evidence.firstCurrentDefect.separation.surfaceOutOfScope, true);
  assert.equal(evidence.s4bAuthorized, true);
  assert.equal(evidence.productImplementationAuthorized, false);
  assert.deepEqual(evidence.rejectedExperiments.map((item) => item.productAdopted), [false, false]);
  assert.equal(evidence.unchangedProductModelComparison.gpt55.resultScopePassed, false);
  assert.equal(evidence.unchangedProductModelComparison.terra.resultScopePassed, false);
  assert.equal(evidence.unchangedProductModelComparison.contextPlacementCandidate, true);
  assert.equal(evidence.unchangedProductModelComparison.contextPlacementCausalityProven, false);
  assert.equal(evidence.ownerDecision.exactSourceReprojectionCandidateOpened, false);
  assert.equal(evidence.ownerDecision.s4bClosedWithoutProductCode, true);
  assert.deepEqual(evidence.deterministicVerification.focusedTests, { passed: 57, failed: 0 });
  assert.deepEqual(evidence.deterministicVerification.dailyCheck, { passed: 1638, failed: 0, skipped: 1 });
  assert.equal(evidence.sourceDigests['T5-FOURTH-COMPLETION.md'], digest(await readFile(
    new URL('../../T5-FOURTH-COMPLETION.md', import.meta.url))));
  assert.ok(evidence.gateCloseRequires.some((item) => item.includes('exact-source placement defect')));
});

test('S4-A 완료 시점의 Cleanroom 대비 제품 source와 UI 변경은 0이었다', async () => {
  const evidence = JSON.parse(await readFile(new URL(
    '../evidence/s4-a-android-work-intelligence-baseline-2026-08-28.json', import.meta.url), 'utf8'));
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.deterministicVerification.productSourceChangedFromCleanBaseline, false);
});
