import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('4차 정본은 S4-G6를 닫고 S4-G7 product activation A/B만 연다', async () => {
  const [plan, agents, second] = await Promise.all([
    readFile(new URL('T5-FOURTH-COMPLETION.md', root), 'utf8'),
    readFile(new URL('AGENTS.md', root), 'utf8'),
    readFile(new URL('T5-SECOND-COMPLETION.md', root), 'utf8'),
  ]);
  assert.match(plan, /S4_G6_PUBLICATION_CLEANUP_COMPLETE · S4_G7_EXEC_PROGRAM_CONTRACT_REDESIGN_ACTIVE · S4_J_DEFERRED_FUTURE_RESEARCH/u);
  assert.match(plan, /t5-0\.3\.1-clean-baseline · 8aba3700/u);
  assert.match(plan, /현재 Gate: `S4-G7 EPHEMERAL PROGRAM CAPSULE · PRODUCT ACTIVATION AND A\/B`/u);
  const gates = ['S4-0', 'S4-A', 'S4-B', 'S4-C', 'S4-D', 'S4-E', 'S4-F', 'S4-G',
    'S4-H', 'S4-I', 'S4-J', 'S4-K', 'S4-UX', 'S4-L', 'S4-HQ'];
  let cursor = -1;
  for (const gate of gates) { const next = plan.indexOf(`### ${gate} —`); assert.ok(next > cursor, gate); cursor = next; }
  assert.match(plan, /최초 실패 하나로 구현을 열되[\s\S]*서로 다른 세 목적 분야/u);
  assert.match(plan, /S4-J — Experience-Based Growth — DEFERRED TO FUTURE RESEARCH/u);
  assert.match(plan, /S4-K — Capability Reality CROSS-CUTTING · Acquisition DEFERRED TO FUTURE RESEARCH/u);
  assert.match(plan, /Capability Reality는 별도 획득 엔진이나 Gate가 아니다[\s\S]*S4-G·S4-I·S4-HQ/u);
  assert.match(plan, /Capability Acquisition은 오너 결정으로 미래 연구에 이관/u);
  assert.match(plan, /제품 import는 0/u);
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
  assert.match(plan, /S4-C — Situation·Hand의 실제 차이 수리 — CLOSED WITH MODEL\/PROVIDER OBSERVATION/u);
  assert.match(plan, /첫 기준선은 KHB-S01/u);
  assert.match(plan, /connection list가 로컬 Evidence보다 먼저 호출/u);
  assert.match(plan, /find -printf[\s\S]*exit 0/u);
  assert.match(plan, /S4-D — Terminal 실행 중 output·process 미달 — MANAGED NON-PTY COMPLETE/u);
  assert.match(plan, /전역 pipefail과 exit-code 예외 목록은 적용하지 않았다/u);
  assert.match(plan, /workspacePresence:[\s\S]*scope: current_managed_workspace[\s\S]*contentIncluded: false/u);
  assert.match(plan, /workspace_presence` 범주는 call당 161 payload bytes/u);
  assert.match(plan, /후보 코드와 전송 범주를 모두 제거/u);
  assert.match(plan, /1MiB를 넘는 managed stdout·stderr/u);
  assert.match(plan, /Runtime 종료·재시작 뒤 OS process 생존/u);
  assert.match(plan, /총 402,872자가 exact recall/u);
  assert.match(plan, /completion wake가 다시 claim/u);
  assert.match(plan, /successor registry는 process 0·old handle 404/u);
  assert.match(plan, /양성 대조 24개는 실패 0/u);
  assert.match(plan, /S4-D2 Stop\/Completion Settlement[\s\S]*S4-D3 Live Output Spine[\s\S]*S4-D4 Crash Process Ownership/u);
  assert.match(plan, /terminalObserved`·`wakeClaimed`/u);
  assert.match(plan, /새 Store와 고정 sleep은 없다/u);
  assert.match(plan, /S4-D2 actual은 stop-first RED/u);
  assert.match(plan, /S4-D3 완료 문장:[\s\S]*대형 process 출력을 실행 중부터 유실 없이/u);
  assert.match(plan, /출력 유실 수리와 RSS 원인·개선은 별도 사실/u);
  assert.match(plan, /TerminalOutputStore v3` live raw chunk/u);
  assert.match(plan, /RSS는 약 634MB[\s\S]*개선을 주장하지 않/u);
  assert.match(plan, /S4-D4 완료 문장:[\s\S]*T5가 모르는 process가 계속 효과를 만들지 않/u);
  assert.match(plan, /PPID 1로 살아 late effect/u);
  assert.match(plan, /Work와 execution claim은 active/u);
  assert.match(plan, /PID 재부착이 아니다/u);
  assert.match(plan, /fd3 parent-liveness channel/u);
  assert.match(plan, /helper 부재는 보호 없는 실행으로 낮추지 않고 fail closed/u);
  assert.match(plan, /S4-D4A 완료 문장:[\s\S]*late effect를 만들기 전에/u);
  assert.match(plan, /managed background startup 비용[\s\S]*\+22\.84ms/u);
  assert.match(plan, /S4-D4B 완료 문장:[\s\S]*interrupted-resumable·effect unknown/u);
  assert.match(plan, /사업 보고·개발 분석·개인 파일 세 목적[\s\S]*Tool 재실행 0/u);
  assert.match(plan, /PTY는 children terminal로 꾸미지 않고 active claim/u);
  assert.match(plan, /S4-D5 완료 문장:[\s\S]*높은 RSS가 생기는 실제 계층/u);
  assert.match(plan, /Store-only RSS 중앙 증가[\s\S]*595\.6MB/u);
  assert.match(plan, /S4-D5A 완료 문장:[\s\S]*parse-derived 객체/u);
  assert.match(plan, /reset`·`delete`[\s\S]*temporary file pointer/u);
  assert.match(plan, /one-shot 격리 positive control[\s\S]*167\.5ms 느렸/u);
  assert.match(plan, /S4-D5B 완료 문장:[\s\S]*helper 사고/u);
  assert.match(plan, /cold 39\.6ms[\s\S]*warm 20회 median 0\.19ms/u);
  assert.match(plan, /주 Runtime peak delta median 18\.6MB[\s\S]*\+39\.4ms/u);
  assert.match(plan, /S4-D5C 완료 문장:[\s\S]*고아 helper/u);
  assert.match(plan, /전체 약 82\.1MB[\s\S]*약 86% 감소/u);
  assert.match(plan, /PTY parent-death containment[\s\S]*S4-L/u);
  assert.match(plan, /S4-E2 actual[\s\S]*S4-E3 actual/u);
  assert.match(plan, /S4-E1 actual은 여섯 계약/u);
  assert.match(plan, /S4-C carry-forward의 모델별 Hand 선택/u);
  assert.match(plan, /S4-C carry-forward로 실제 자료가 있는데 없다고 말하는지/u);
  assert.match(plan, /각 local engine·model·Capability의 실제 사용 가능 여부[\s\S]*개인정보 범위/u);
  assert.match(plan, /publishable output, internal intermediate, diagnostic, temporary, cleanup/u);
  assert.match(plan, /같은 Node child를 실행해[\s\S]*sampled RSS monitor[\s\S]*hard cap으로 채택하지 않/u);
  assert.match(plan, /QuickJS release-sync WASM[\s\S]*host API를 0[\s\S]*D-managed one-shot helper[\s\S]*G4 actual은/u);
  assert.match(plan, /Tree-sitter command explanation에서 heredoc body의 exact span·bytes·digest/u);
  assert.match(plan, /body가 없는 일반 exec explanation에는 새 field를 만들지 않/u);
  assert.match(plan, /transient program-contract continuation/u);
  assert.match(plan, /같은 source-language Terminal backend의 macOS qualification/u);
  assert.match(plan, /child fork, network, protected read, outside write/u);
  assert.match(plan, /Console·exec product wiring과 independent relation verification·F publication은 아직 0/u);
  assert.match(plan, /두 행의 고유값 교환[\s\S]*요청하지 않은 개인정보 JSON/u);
  assert.match(plan, /one-to-one·one-to-many·many-to-one·ambiguous·unmatched·conflicting/u);
  assert.match(plan, /최종 Excel·ZIP을 독립 재개방/u);
  assert.match(plan, /model partial[\s\S]*surface persistence[\s\S]*delivery terminal/u);
  assert.match(plan, /현재 사용할 수 있는 손[\s\S]*local\/external[\s\S]*privacy scope/u);
  assert.match(plan, /사용자 메시지·T5 답변·실제 작업시간/u);
  assert.match(plan, /Artifact lineage에서 version이 단조 증가/u);
  assert.match(plan, /내부 `sandbox:` URL/u);
  assert.match(plan, /권역별 Excel 6개[\s\S]*내부 파일 0/u);
  assert.match(plan, /장시간 한국어 오디오에서 현재 사용 가능한 STT engine[\s\S]*Notion에 반영·재개방/u);
  assert.match(agents, /`T5-FOURTH-COMPLETION\.md` — 지금 어느 Gate/u);
  assert.match(second, /현재 후속 Gate: `T5-FOURTH-COMPLETION\.md · S4-D1`/u);
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
