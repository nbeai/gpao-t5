import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const planPath = new URL('../../티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md', import.meta.url);
const indexPath = new URL('../../티파이브개발 연구/INDEX.md', import.meta.url);
const nxPath = new URL('../../T5-NX.md', import.meta.url);
const selectionPlanPath = new URL('../../티파이브개발 연구/T5-SELECTION-SIDE-EXPLORATION-RESEARCH.md', import.meta.url);

test('NX-2 plan records NX-1 closeout, the current Context Diet slice, and excludes generic GUI work', async () => {
  const plan = await readFile(planPath, 'utf8');
  assert.match(plan, /NX_1_COMPLETE/);
  assert.match(plan, /NX2_1_CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT/);
  assert.match(plan, /NX2_2_CONTEXT_DIET_CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION/);
  assert.match(plan, /NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT/);
  assert.match(plan, /NX2_SE_COMPLETE/);
  assert.match(plan, /NX2_4_AU0_COMPLETE/);
  assert.match(plan, /NX2_4_AU1_CURRENT/);
  assert.match(plan, /NX2-SE — Selection-Scoped Side Exploration/);
  assert.match(plan, /범용 Computer Use·좌표 클릭·데스크톱 앱 조작/);
  assert.match(plan, /독립 미래 Gate 유지/);
  assert.match(plan, /NX-2 후보가 실패해도 NX-1 제품 경계를 바꾸거나 약화해 성공으로 꾸미지 않는다/);
});

test('NX-2 plan covers every remaining non-GUI research family in one ordered line', async () => {
  const plan = await readFile(planPath, 'utf8');
  for (const required of [
    'NX2-1 — Integral Mastery Generalization',
    'NX2-2 — Context Diet & Interface Intelligence',
    'NX2-3 — Cognitive Flow & Practical Judgment Qualification',
    'NX2-SE — Selection-Scoped Side Exploration',
    'NX2-4 — Auditory Intelligence',
    'NX2-5 — Web Intelligence Collector',
    'NX2-6 — Naver Identity·Mail·Blog Native Work',
    'NX2-7 — Experience Promotion',
    'NX2-HQ — Competitive Whole Human Qualification',
  ]) assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('NX-2 plan preserves T5 model/runtime boundaries and whole-human evidence', async () => {
  const plan = await readFile(planPath, 'utf8');
  assert.match(plan, /모델이 소유할 것/);
  assert.match(plan, /Runtime이 소유할 것/);
  assert.match(plan, /Runtime이 하지 않을 것/);
  assert.match(plan, /T0 Enter/);
  assert.match(plan, /clean second pass/);
  assert.match(plan, /Direct·Single Reality 개입 0/);
  assert.match(plan, /업무별 schema·Router·Prompt fork 0/);
});

test('research index and NX canonical source link the active NX-2 plan and current slice', async () => {
  const [index, nx] = await Promise.all([readFile(indexPath, 'utf8'), readFile(nxPath, 'utf8')]);
  const filename = 'T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md';
  assert.match(index, new RegExp(filename));
  assert.match(nx, new RegExp(filename));
  assert.match(nx, /CURRENT · NX_1_COMPLETE · NX2_1_CLOSED_WITH_MODEL_PROVIDER_SELECTION_LIMIT · NX2_2_CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION · NX2_3_CLOSED_WITH_MODEL_PROVIDER_JUDGMENT_LIMIT · NX2_SE_COMPLETE · CURRENT_SLICE_NX2_4_AUDITORY_INTELLIGENCE/);
  assert.match(nx, /현재 개발 순서/);
  assert.match(nx, /NX-1 합격일 때만 NX-2 CURRENT로 이동/);
  assert.match(nx, /ABSORBED_AS_NX2_7 · NOT_SEPARATELY_OPEN/);
  assert.match(nx, /ABSORBED_AS_NX2_4 · NOT_SEPARATELY_OPEN/);
  assert.match(nx, /NX-SE — Selection-Scoped Side Exploration — PLANNED_AFTER_NX2_3/);
});

test('current NX-2A through NX-2D are bound inside NX2-1 and cannot bypass the remaining roadmap', async () => {
  const plan = await readFile(planPath, 'utf8');
  for (const required of [
    'NX-2A Evidence Reuse & Exact-Head Baseline',
    'NX-2B metadata-only Reality Scout 두 후보',
    'NX-2B2 model-selected bounded batch',
    'NX-2C Existing Path Common Observer Delta',
    'NX-2D Five-Lane Proportionality',
  ]) assert.match(plan, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(plan, /NX2-2 Context Diet & Interface Intelligence — CLOSED_WITH_WORK_SETTLEMENT_OBSERVATION/);
  assert.match(plan, /NX2-7 Experience Promotion\n→ NX2-HQ Competitive Whole Human Qualification/);
  assert.match(plan, /현재 계획에 없는 새 Gate를 임의로 끼워 넣지 않는다/);
  assert.match(plan, /별도 selection Tool·selection model call·selection→Reality→Human 3-model pipeline은 NX2-1의 제품 구조가 아니다/);
  assert.match(plan, /기존 `file_reality → bind_sources → integral_method`/);
});

test('every remaining specialist plan is bound to NX-2 competitive promotion instead of feature-only completion', async () => {
  const plans = [
    ['T5-CONTEXT-DIET-INTERFACE-INTELLIGENCE-RESEARCH.md', 'NX2-2'],
    ['T5-COGNITIVE-FLOW-RESEARCH.md', 'NX2-3'],
    ['T5-PRACTICAL-JUDGMENT-RESEARCH.md', 'NX2-3'],
    ['T5-COGNITIVE-FLOW-HQ-RESEARCH.md', 'NX2-HQ'],
    ['T5-SELECTION-SIDE-EXPLORATION-RESEARCH.md', 'NX2-SE'],
    ['T5-AUDITORY-INTELLIGENCE-WHISPER-RESEARCH.md', 'NX2-4'],
    ['T5-NAVER-IDENTITY-MAIL-BLOG-CAPABILITY-RESEARCH.md', 'NX2-6'],
  ];
  for (const [filename, gate] of plans) {
    const body = await readFile(new URL(`../../티파이브개발 연구/${filename}`, import.meta.url), 'utf8');
    assert.match(body, /NX-2 공통 승격 계약/);
    assert.match(body, new RegExp(gate));
    assert.match(body, /현재 T5|현재 제품/);
    assert.match(body, /실제 Console/);
  }
  const history = await readFile(new URL('../../티파이브개발 연구/T5-NON-GUI-INTEGRATED-DEVELOPMENT-PLAN.md', import.meta.url), 'utf8');
  assert.match(history, /NX-2 승계 상태/);
  assert.match(history, /NG-4·NG-5: NX-1/);
  assert.match(history, /NX2-HQ/);
});

test('Selection Side Exploration is a cognitive Work-continuity gate, not generic GUI', async () => {
  const [plan, nx2, index] = await Promise.all([
    readFile(selectionPlanPath, 'utf8'), readFile(planPath, 'utf8'), readFile(indexPath, 'utf8'),
  ]);
  assert.match(plan, /NX2-SE — Selection-Scoped Side Exploration/);
  assert.match(plan, /NX-2 공통 승격 계약/);
  assert.match(plan, /Selection → Side Exploration → Explicit Apply → Work Revision/);
  assert.match(plan, /same-T5 read-only side projection/);
  assert.match(plan, /completed derived Work/);
  assert.match(plan, /light\/dark theme 모두 흰색 배경/u);
  assert.match(plan, /실제 Console/);
  assert.match(nx2, /NX2-3 Cognitive Flow & Practical Judgment\n→ NX2-SE Selection-Scoped Side Exploration\n→ NX2-4 Auditory Intelligence/);
  assert.match(index, /Selection-Scoped Side Exploration/);
});
