import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('T5 NX가 제품 정의 다음의 유일한 현재 개발 정본이다', async () => {
  const [agents, nx, sixth] = await Promise.all([
    read('AGENTS.md'), read('T5-NX.md'), read('T5-SIXTH-COMPLETION.md'),
  ]);
  assert.match(agents, /1\. `T5-PRODUCT\.md`[\s\S]*2\. `T5-NX\.md`/u);
  assert.match(nx, /OWNER_CURRENT_DEVELOPMENT_SOURCE/u);
  assert.match(nx, /NX_0_GENERATION_TRANSITION_COMPLETE/u);
  assert.match(nx, /NX_1_FIRST_FLAGSHIP_MASTERY_COMPLETE/u);
  assert.match(nx, /NX_2_1_CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT/u);
  assert.match(nx, /NX_2_2_CONTEXT_DIET_CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION/u);
  assert.match(nx, /NX_2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT/u);
  assert.match(nx, /NX_2_SE_CURRENT/u);
  assert.match(sixth, /SIXTH_COMPLETE_HISTORICAL_SOURCE/u);
  assert.match(sixth, /SUPERSEDED_CURRENT_DEVELOPMENT_SOURCE_BY_T5_NX/u);
  assert.match(sixth, /CURRENT DEVELOPMENT SOURCE IS T5-NX\.md/u);
});

test('NX는 Refoundation Core를 계승하면서 Mastery Lab의 공격적 후보를 허용한다', async () => {
  const nx = await read('T5-NX.md');
  assert.match(nx, /Core와 Mastery Lab 분리/u);
  assert.match(nx, /한 목적만으로 후보를 열 수 있다/u);
  assert.match(nx, /새 상태는 금지가 아니라 정본 밀도로 판정/u);
  assert.match(nx, /Runtime의 의미 경계/u);
  assert.match(nx, /Pareto 경쟁/u);
  assert.match(nx, /제품 entry·Prompt·schema·Store delta 0/u);
  assert.match(nx, /설치 파일 제작은 NX 개발 목록에 포함하지 않는다/u);
});

test('NX-1은 DR-0 actual을 통합 성과 Method의 첫 Flagship baseline으로 계승한다', async () => {
  const [nx, evidence, plan] = await Promise.all([
    read('T5-NX.md'),
    read('refoundation/evidence/t5-nx-generation-transition-2026-08-31.json').then(JSON.parse),
    read('refoundation/evidence/t5-nx-integral-outcome-plan-2026-08-31.json').then(JSON.parse),
  ]);
  assert.equal(evidence.status, 'NX0_COMPLETE_NX1_FLAGSHIP_MASTERY_CURRENT');
  assert.equal(evidence.currentGate.id, 'NX-1');
  assert.equal(evidence.baseline.purchase.status, 'PASS');
  assert.equal(evidence.baseline.contract.status, 'PARTIAL_SCOPE');
  assert.equal(evidence.baseline.expense.status, 'PARTIAL_SCOPE');
  assert.equal(evidence.baseline.methodCostPassed, false);
  assert.equal(evidence.productSourceChanges, 0);
  assert.equal(plan.status, 'NX1_INTEGRAL_OUTCOME_IMPLEMENTATION_PLAN_READY');
  assert.equal(plan.productSourceChanges, 0);
  assert.equal(plan.candidate.newPersistentStore, false);
  assert.equal(plan.candidate.newGlobalPrompt, false);
  assert.equal(plan.requiredMeasuredUpgrade.medianFinalWallImprovementPercent, 20);
  assert.match(nx, /Reality Scout/u);
  assert.match(nx, /Integral Outcome Method/u);
  assert.match(nx, /Reality Closure \+ Human Closure/u);
  assert.match(nx, /인문적 의미 적합성[\s\S]*전략적 효과[\s\S]*기술적 현실성[\s\S]*미학적 완성도/u);
  assert.match(nx, /Direct·단일 Hand·단순 질문에는 만들지 않는다/u);
  assert.match(nx, /median final wall 20% 이상 개선/u);
  assert.match(nx, /네 관점을 네 고정 Agent·네 model call/u);
  assert.match(nx, /Commit 1 — NX-1A baseline freeze/u);
  assert.match(nx, /Commit 7 — NX-1 closeout/u);
  assert.match(nx, /60\.481초·model 9·Tool 11/u);
  assert.match(nx, /85\.000초·12·18/u);
});

test('연구실은 NX source library이며 통합 계획은 현재 정본이 아니다', async () => {
  const [readme, index, plan] = await Promise.all([
    read('티파이브개발 연구/README.md'),
    read('티파이브개발 연구/INDEX.md'),
    read('티파이브개발 연구/T5-NON-GUI-INTEGRATED-DEVELOPMENT-PLAN.md'),
  ]);
  assert.match(readme, /현재 단일 개발 정본 `T5-NX\.md`/u);
  assert.match(index, /현재 개발 정본: `\.\.\/T5-NX\.md`/u);
  assert.match(index, /NX Mastery 후보의 source library/u);
  assert.match(plan, /ABSORBED_INTO_T5_NX/u);
  assert.match(plan, /NO_LONGER_CURRENT_DEVELOPMENT_SOURCE/u);
});
