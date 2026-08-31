import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const planPath = new URL('../../티파이브개발 연구/T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md', import.meta.url);
const indexPath = new URL('../../티파이브개발 연구/INDEX.md', import.meta.url);
const nxPath = new URL('../../T5-NX.md', import.meta.url);

test('NX-2 plan remains closed until NX-1 closeout and excludes generic GUI work', async () => {
  const plan = await readFile(planPath, 'utf8');
  assert.match(plan, /NX_1_CLOSEOUT_REQUIRED/);
  assert.match(plan, /PRODUCT_IMPLEMENTATION_NOT_OPEN/);
  assert.match(plan, /범용 Computer Use·좌표 클릭·데스크톱 앱 조작/);
  assert.match(plan, /독립 미래 Gate 유지/);
  assert.match(plan, /NX-1의 실패를 NX-2 기능으로 덮지 않는다/);
});

test('NX-2 plan covers every remaining non-GUI research family in one ordered line', async () => {
  const plan = await readFile(planPath, 'utf8');
  for (const required of [
    'NX2-1 — Integral Mastery Generalization',
    'NX2-2 — Context Diet & Interface Intelligence',
    'NX2-3 — Cognitive Flow & Practical Judgment Qualification',
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

test('research index and NX canonical source link the same NX-2 plan without opening the gate', async () => {
  const [index, nx] = await Promise.all([readFile(indexPath, 'utf8'), readFile(nxPath, 'utf8')]);
  const filename = 'T5-NX2-GENERALIZED-MASTERY-DEVELOPMENT-PLAN.md';
  assert.match(index, new RegExp(filename));
  assert.match(nx, new RegExp(filename));
  assert.match(nx, /PLANNED_NOT_OPEN · NX_1_CLOSEOUT_REQUIRED/);
  assert.match(nx, /현재 개발 순서/);
  assert.match(nx, /NX-1 합격일 때만 NX-2 CURRENT로 이동/);
  assert.match(nx, /ABSORBED_AS_NX2_7 · NOT_SEPARATELY_OPEN/);
  assert.match(nx, /ABSORBED_AS_NX2_4 · NOT_SEPARATELY_OPEN/);
});
