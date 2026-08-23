import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import {
  MERGED_QUOTE_RANGES, assessStructuralDocumentQualification, createMergedQuoteFixture,
  createRecipeLayoutFixture,
} from '../src/structural-document-qualification.js';

test('D6 비식별 견적 fixture는 실제 반대시험과 같은 28개 병합·수식·미확인을 가진다', async () => {
  const fixture = await createMergedQuoteFixture(await mkdtemp(join(tmpdir(), 't5-d6-quote-')));
  const observed = await inspectBusinessDocument({ file: fixture.path, maxCells: 1_000 });
  const sheet = observed.workbook.sheets[0];
  assert.equal(sheet.name, 'Sheet1'); assert.equal(sheet.merges.length, 28);
  assert.deepEqual(sheet.merges, [...MERGED_QUOTE_RANGES].sort());
  const amount = sheet.cells.find((cell) => cell.address === 'E24');
  assert.equal(amount.formula, 'C24*D24'); assert.equal(amount.result, 2_295_000);
  assert.equal(sheet.cells.find((cell) => cell.address === 'B3').text, '한빛상회');
  assert.equal(sheet.cells.find((cell) => cell.address === 'B4')?.text, undefined);
});

test('모델용 recipe fixture는 실제 원본 없이 24시트와 목표 가로 행만 재현한다', async () => {
  const fixture = await createRecipeLayoutFixture(await mkdtemp(join(tmpdir(), 't5-d6-recipe-')));
  const observed = await inspectBusinessDocument({ file: fixture.path, maxCells: 2_000 });
  assert.equal(observed.workbook.sheetCount, 24);
  const sheet = observed.workbook.sheets.find((item) => item.name === '끼니강성미샘');
  assert.deepEqual(['A9', 'B9', 'C9', 'D9'].map((address) => sheet.cells.find((cell) => cell.address === address)?.text), [
    '불린녹말', '마는녹말', '밀가루', '계란흰자1개',
  ]);
});

test('D6 판정은 병합 preview·원본 좌표·가로 재료·모델 목적의 논리곱이다', async () => {
  const fixture = await createMergedQuoteFixture(await mkdtemp(join(tmpdir(), 't5-d6-assess-')));
  const observed = await inspectBusinessDocument({ file: fixture.path, maxCells: 1_000 });
  const verdict = assessStructuralDocumentQualification({
    fixture, quoteSheet: observed.workbook.sheets[0], quotePreview: '<td colspan="6"><td rowspan="10">',
    recipePreview: '끼니강성미샘 A9 불린녹말 B9 마는녹말 C9 밀가루 D9 계란흰자1개',
    recipeTarget: {
      sheetName: '끼니강성미샘', addresses: ['A9', 'B9', 'C9', 'D9'],
      values: ['불린녹말', '마는녹말', '밀가루', '계란흰자1개'],
      semanticRoles: Array(4).fill('parallel_source_item'),
    },
    modelTasks: Array(4).fill({ passed: true }), sourceFilesUnchanged: true,
  });
  assert.equal(verdict.passed, true);
  const broken = assessStructuralDocumentQualification({
    fixture, quoteSheet: observed.workbook.sheets[0], quotePreview: '', recipePreview: '', recipeTarget: null,
    modelTasks: Array(4).fill({ passed: true }), sourceFilesUnchanged: true,
  });
  assert.equal(broken.passed, false);
  assert.equal(broken.checks.quotePreviewHonorsMerges, false);
  assert.equal(broken.checks.recipeRowKeptHorizontal, false);
});
