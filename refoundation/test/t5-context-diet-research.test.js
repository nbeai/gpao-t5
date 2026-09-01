import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Context Diet 연구는 80% 삭제가 아니라 source·incident·A/B 소유권 계획이다', async () => {
  const plan = await read('티파이브개발 연구/T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH.md');
  assert.match(plan, /98 lines/u);
  assert.match(plan, /29,362 bytes/u);
  assert.match(plan, /목표는 “Prompt 80% 삭제”가 아니다/u);
  assert.match(plan, /Instruction Family Audit Contract/u);
  assert.match(plan, /incidentRefs:/u);
  assert.match(plan, /Tool Contract SSOT/u);
  assert.match(plan, /Level 4 — Human Closure epoch/u);
  assert.match(plan, /gpt-5\.5 qualified default[\s\S]*Terra comparison\/holdout/u);
  assert.match(plan, /KEEP \/ MOVE \/ REVISE \/ REMOVE_CANDIDATE/u);
  assert.match(plan, /actual incident·countertest가 있는 문장을 대체 enforcement 없이 제거한다/u);
  assert.doesNotMatch(plan, /80% 이상 삭제를 완료 기준/u);
});

test('Context Diet 연구는 NX-1과 분리된 비정본 연구로 색인된다', async () => {
  const index = await read('티파이브개발 연구/INDEX.md');
  assert.match(index, /T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH\.md/u);
  assert.match(index, /제품 변경 0의 전체 Context surface inventory/u);
  assert.match(index, /현재 NX-1을 중단하거나.*전역 Prompt를 수정하지 않는다/u);
});

test('오너 결정은 NX2-1 선택 한계를 수용하고 제품 변경 0의 CX-0만 연다', async () => {
  const [nx, plan, research, evidence] = await Promise.all([
    read('T5-NX.md'), read('티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md'),
    read('티파이브개발 연구/T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH.md'),
    read('refoundation/evidence/nx2-1-owner-acceptance-and-context-diet-open-2026-09-01.json').then(JSON.parse),
  ]);
  assert.equal(evidence.ownerDecision.nx2_1Status, 'CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT');
  assert.equal(evidence.nextGate.currentSlice, 'CX-0 Prompt Surface Inventory');
  assert.equal(evidence.nextGate.productChangesAuthorized, 0);
  assert.equal(evidence.productSourceDelta, 0);
  assert.match(nx, /NX_2_1_CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT/u);
  assert.match(nx, /NX_2_2_CONTEXT_DIET_CURRENT/u);
  assert.match(plan, /NX2_2_CONTEXT_DIET_CURRENT/u);
  assert.match(research, /OWNER_GATE_OPEN · CX_0_(?:CURRENT|COMPLETE)/u);
});

test('CX-0은 모든 Context surface를 계측하고 삭제 없이 CX-1 provenance audit만 연다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-cx0-context-surface-inventory-2026-09-01.json'));
  assert.equal(evidence.instructions.lines, 98);
  assert.equal(evidence.instructions.bytes, 29742);
  assert.equal(evidence.instructionFamilies.allGlobalLinesAdmitted, true);
  assert.equal(evidence.instructionFamilies.allCurrentDigestsMatch, true);
  assert.equal(evidence.directActiveTools.count, 7);
  assert.equal(evidence.skills.bodiesPreloadedInDirect, false);
  assert.equal(evidence.runtimeContext.emptyDirectWorkspaceBytes, 485);
  assert.equal(evidence.providerBaseline.firstRequestBytes, 41566);
  assert.equal(evidence.boundaries.promptDeletionAuthorized, false);
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.next.gate, 'CX-1 Family Provenance Audit');
});

test('CX-1은 12개 family를 증거별로 분류하고 stale countertest 이름을 proposed correction으로만 남긴다', async () => {
  const [evidence, fileReality, attachment, browser, automation, exec, sandbox] = await Promise.all([
    read('refoundation/evidence/nx2-cx1-instruction-family-provenance-audit-2026-09-01.json').then(JSON.parse),
    read('refoundation/test/file-reality-console.integration.js'),
    read('refoundation/test/attachment-console.integration.js'),
    read('refoundation/test/browser-observation-tool.test.js'),
    read('refoundation/test/automation-console.integration.js'),
    read('refoundation/test/exec-tool.test.js'),
    read('refoundation/test/terminal-sandbox-first.test.js'),
  ]);
  assert.equal(evidence.summary.families, 12);
  assert.equal(evidence.families.length, 12);
  assert.equal(evidence.summary.KEEP, 5);
  assert.equal(evidence.summary.MOVE, 2);
  assert.equal(evidence.summary.REVISE, 4);
  assert.equal(evidence.summary.REMOVE_CANDIDATE, 0);
  assert.equal(evidence.summary.UNKNOWN, 1);
  assert.equal(evidence.countertestDrift.length, 5);
  assert.equal(evidence.boundaries.instructionDeleted, false);
  assert.equal(evidence.boundaries.manifestCountertestNamesChanged, false);
  assert.equal(evidence.boundaries.nx2_1Reopened, false);
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.next.gate, 'CX-2 Tool Contract SSOT Pilot');
  assert.match(fileReality, /file_reality[\s\S]*search/u);
  assert.match(attachment, /register_output[\s\S]*download/u);
  assert.match(browser, /effect_declaration_mismatch/u);
  assert.match(automation, /deliveryStatus/u);
  assert.match(exec, /effect_declaration_required|managed_process_required/u);
  assert.match(sandbox, /effect_declaration_required/u);
});

test('CX-2는 이미 고쳐진 drift와 비노출 내부 중복을 새 pilot로 꾸미지 않는다', async () => {
  const [evidence, terminalSource, attachmentSource, fileRealitySource] = await Promise.all([
    read('refoundation/evidence/nx2-cx2-tool-contract-ssot-admission-2026-09-01.json').then(JSON.parse),
    read('refoundation/src/terminal-session-tool.js'), read('refoundation/src/attachment-hand.js'),
    read('refoundation/src/file-reality-tool.js'),
  ]);
  assert.equal(evidence.reviewedFamilies.some((item) => item.eligiblePilot), false);
  assert.equal(evidence.boundaries.toolContractRewritten, false);
  assert.equal(evidence.boundaries.pilotInvented, false);
  assert.equal(evidence.productChanges, 0);
  assert.equal(evidence.next.gate, 'CX-3 Instruction Ownership Migration');
  assert.match(terminalSource, /effect: \{ \.\.\.effectSchema, type: \['object', 'null'\] \}/u);
  assert.match(terminalSource, /ptyStart\.execute\(argsForPty\(args, normalizeEffect\)/u);
  const attachmentActions = attachmentSource.match(/action: \{ type: 'string', enum: \[([^\]]+)\]/u)?.[1]
    .match(/'[^']+'/gu) ?? [];
  const attachmentBranches = [...attachmentSource.matchAll(/args\.action === '([^']+)'/gu)]
    .map((match) => match[1]);
  assert.deepEqual([...new Set(attachmentBranches)].sort(), attachmentActions.map((item) => item.slice(1, -1)).sort());
  const fileActions = fileRealitySource.match(/action: \{ type: 'string', enum: \[([^\]]+)\]/u)?.[1]
    .match(/'[^']+'/gu) ?? [];
  const fileBranches = [...fileRealitySource.matchAll(/action === '([^']+)'/gu)].map((match) => match[1]);
  assert.deepEqual([...new Set(fileBranches.filter((name) => fileActions.includes(`'${name}'`)))].sort(),
    fileActions.map((item) => item.slice(1, -1)).sort());
});

test('CX-3는 attachment ownership A/B를 통과해도 wall과 미실행 actual을 숨기지 않고 제품 적용을 보류한다', async () => {
  const evidence = JSON.parse(await read('refoundation/evidence/nx2-cx3-artifact-guidance-ownership-qualification-2026-09-01.json'));
  assert.equal(evidence.candidate.instructionByteDelta, -496);
  assert.equal(evidence.ab.A.direct.passed, true);
  assert.equal(evidence.ab.B.direct.passed, true);
  assert.equal(evidence.ba.A.attachment.passed, true);
  assert.equal(evidence.ba.B.attachment.passed, true);
  assert.equal(evidence.ab.B.attachment.sentinelCreated, false);
  assert.equal(evidence.pairedMedian.direct.requestByteDelta, -498);
  assert.equal(evidence.pairedMedian.direct.wallDeltaMs > 0, true);
  assert.deepEqual(evidence.lineDecisions.map((item) => item.decision), ['MOVE_CANDIDATE', 'UNKNOWN']);
  assert.equal(evidence.gateDecision.productIntegration, false);
  assert.equal(evidence.gateDecision.productSourceDelta, 0);
  assert.equal(evidence.next.gate, 'CX-4 Progressive Disclosure Refinement');
});
