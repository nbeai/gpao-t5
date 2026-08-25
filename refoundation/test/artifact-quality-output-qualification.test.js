import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';

import {
  ARTIFACT_QUALITY_OUTPUT_CONTRACT, makeArtifactQualityOutputQualifier,
} from '../src/artifact-quality-output-qualification.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function xml(value) { return strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`); }
function cell(address, value) {
  return `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
}
function numberCell(address, value) { return `<c r="${address}"><v>${value}</v></c>`; }
function formulaCell(address, formula, result) { return `<c r="${address}"><f>${formula}</f><v>${result}</v></c>`; }

function settlementWorkbook({ missingTrace = false, horizontalSplit = false } = {}) {
  const goal = '총액과 미확인 금액을 첫 화면에서 구분한다';
  const detailValues = [
    'row-1-customer', 'source-a.xlsx#row=2',
    'row-5-customer', ...(missingTrace ? [] : ['source-c.xlsx#row=3']),
    'grand-total', '550000',
  ];
  const detailRows = detailValues.map((value, index) => (
    `<row r="${index + 1}">${cell(`A${index + 1}`, value)}${index === 0 ? numberCell('B1', 250000) : index === 2 ? numberCell('B3', 300000) : index === 4 ? formulaCell('B5', 'SUM(B1,B3)', 550000) : ''}</row>`
  )).join('');
  return Buffer.from(zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="요약" sheetId="1" r:id="rId1"/><sheet name="상세" sheetId="2" r:id="rId2"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="1">\'상세\'!A1:H6</definedName></definedNames></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell('A1', goal)}</row><row r="2">${cell('A2', '요약')}</row></sheetData></worksheet>`),
    'xl/worksheets/sheet2.xml': xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData>${detailRows}</sheetData><pageSetup paperSize="9" orientation="landscape" fitToWidth="${horizontalSplit ? 2 : 1}" fitToHeight="0"/></worksheet>`),
  }, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
}

function contract(bytes) {
  return {
    contractId: 'settlement-output-v1',
    artifact: { artifactId: 'settlement.xlsx', kind: 'xlsx', sha256: sha256(bytes) },
    audience: '정산 담당자와 사업주', domain: 'customer_settlement',
    usePurpose: '지급 전 합계와 미확인 항목을 원문까지 감사한다', deliveryMedium: 'both',
    sourceFacts: [
      { factId: 'row-1-customer', sourceRef: 'source-a.xlsx#row=2', resolution: 'resolved', preserveOriginal: true },
      { factId: 'row-5-customer', sourceRef: 'source-c.xlsx#row=3', resolution: 'unresolved', preserveOriginal: true },
    ],
    calculations: [{
      calculationId: 'grand-total', sourceFactIds: ['row-1-customer', 'row-5-customer'],
      outputTarget: { sheetId: '상세', cell: 'B5' },
      sourceCellRefs: [
        { sourceFactId: 'row-1-customer', sheetId: '상세', cell: 'B1' },
        { sourceFactId: 'row-5-customer', sheetId: '상세', cell: 'B3' },
      ],
    }],
    requiredArtifactForms: ['요약', '상세'],
    visualHierarchyGoals: ['총액과 미확인 금액을 첫 화면에서 구분한다'],
    domainProfile: { profileId: 'settlement-audit', version: '1', invariantRefs: ['source-trace'] },
    laneRequirements: {
      semantic: [{
        requirementId: 'semantic-truth', kind: 'semantic_reconciliation', expected: {
          satisfiedFactIds: ['row-1-customer'], unchangedSourceFactIds: ['row-1-customer', 'row-5-customer'],
          preservedUnresolvedFactIds: ['row-5-customer'],
        },
      }],
      domain: [{
        requirementId: 'domain-trace', kind: 'domain_traceability', invariantRefs: ['source-trace'],
        expected: {
          sourceFactIds: ['row-1-customer', 'row-5-customer'], reversibleSourceFactIds: ['row-1-customer'],
          calculationIds: ['grand-total'],
        },
      }],
      structural: [
        { requirementId: 'reopen', kind: 'structural_scan', expected: { reopenedArtifactSha256: sha256(bytes), maximumFormulaErrors: 0, maximumSchemaErrors: 0 } },
        { requirementId: 'forms', kind: 'artifact_forms', expected: { formIds: ['요약', '상세'] } },
      ],
      screen: [
        { requirementId: 'screen-render', kind: 'render_coverage', expected: { surface: 'screen', unitIds: ['요약', '상세'] } },
        { requirementId: 'screen-integrity', kind: 'visual_integrity', expected: { surface: 'screen', unitIds: ['요약', '상세'], disallowedDefects: ['clipping', 'glyph_loss', 'overlap'] } },
        { requirementId: 'screen-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'screen', unitIds: ['요약', '상세'], goalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
      ],
      print: [
        { requirementId: 'print-setup', kind: 'openxml_page_setup', expected: { sheets: [{ sheetId: '상세', paperSize: 'A4', orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:H6' }] } },
        { requirementId: 'print-render', kind: 'render_coverage', expected: { surface: 'print', unitIds: ['요약:p1', '상세:p1'] } },
        { requirementId: 'print-integrity', kind: 'visual_integrity', expected: { surface: 'print', unitIds: ['요약:p1', '상세:p1'], disallowedDefects: ['horizontal_split', 'clipping'] } },
        { requirementId: 'print-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'print', unitIds: ['요약:p1', '상세:p1'], goalIds: ['총액과 미확인 금액을 첫 화면에서 구분한다'] } },
      ],
    },
  };
}

async function fixture(input) {
  const room = await mkdtemp(join(tmpdir(), 't5-qh2-output-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const filePath = join(workspace, 'settlement.xlsx'); const bytes = settlementWorkbook(input);
  await writeFile(filePath, bytes);
  await writeFile(`${filePath}${ARTIFACT_QUALITY_OUTPUT_CONTRACT.suffix}`, JSON.stringify(contract(bytes)));
  return { room, workspace, filePath, bytes, async close() { await rm(room, { recursive: true, force: true }); } };
}

test('누락 고객 trace와 fitToWidth=2는 실제 재개방·OpenXML 관측으로 qualified되지 않는다', async () => {
  const app = await fixture({ missingTrace: true, horizontalSplit: true });
  try {
    const result = await makeArtifactQualityOutputQualifier()({ filePath: app.filePath, workspace: app.workspace });
    assert.equal(result.applicable, true);
    assert.equal(result.qualified, false);
    assert.equal(result.receipt.lanes.semantic.status, 'failed');
    assert.equal(result.receipt.lanes.domain.status, 'failed');
    assert.equal(result.receipt.lanes.structural.status, 'qualified');
    assert.equal(result.receipt.lanes.print.status, 'failed');
    assert.ok(result.receipt.lanes.print.failedRequirementIds.includes('print-setup'));
    assert.ok(result.receipt.lanes.print.failedRequirementIds.includes('print-integrity'));
  } finally { await app.close(); }
});

test('구조와 page setup이 정상이어도 독립 Semantic·Domain·Visual verifier가 없으면 정직하게 unmeasured다', async () => {
  const app = await fixture({ missingTrace: false, horizontalSplit: false });
  try {
    const result = await makeArtifactQualityOutputQualifier()({ filePath: app.filePath, workspace: app.workspace });
    assert.equal(result.applicable, true);
    assert.equal(result.qualified, false);
    assert.equal(result.receipt.lanes.structural.status, 'qualified');
    assert.equal(result.receipt.lanes.semantic.status, 'unmeasured');
    assert.equal(result.receipt.lanes.domain.status, 'unmeasured');
    assert.equal(result.receipt.lanes.screen.status, 'unmeasured');
    assert.equal(result.receipt.lanes.print.status, 'unmeasured', JSON.stringify(result.receipt.lanes.print));
  } finally { await app.close(); }
});

test('purpose contract 없는 일반 문서 결과에는 품질 Gate를 무조건 강제하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh2-output-plain-'));
  const filePath = join(room, 'plain.xlsx'); await writeFile(filePath, settlementWorkbook());
  try {
    const result = await makeArtifactQualityOutputQualifier()({ filePath, workspace: room });
    assert.deepEqual(result, { applicable: false });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('contract artifact kind는 실제 파일 형식을 바꿔 주장할 수 없다', async () => {
  const app = await fixture();
  try {
    const mismatched = contract(app.bytes);
    mismatched.artifact.kind = 'pdf';
    await writeFile(`${app.filePath}${ARTIFACT_QUALITY_OUTPUT_CONTRACT.suffix}`, JSON.stringify(mismatched));
    const result = await makeArtifactQualityOutputQualifier()({ filePath: app.filePath, workspace: app.workspace });
    assert.equal(result.qualified, false);
    assert.equal(result.reason, 'artifact_purpose_kind_mismatch');
  } finally { await app.close(); }
});

test('register_output은 품질 계약의 누락 trace·print 결함을 artifact 등록 전에 차단한다', async () => {
  const app = await fixture({ missingTrace: true, horizontalSplit: true });
  try {
    const store = new AttachmentStore(join(app.room, 'attachments'));
    const tool = makeAttachmentTool({
      store, sessionId: '11111111-1111-4111-8111-111111111111', workspace: app.workspace,
      runId: 'qh2-run', authorizeOutputPath: (path) => path === app.filePath,
    });
    const result = await tool.execute({
      action: 'register_output', attachmentId: null, filePath: app.filePath,
      maxChars: null, maxCells: null, maxPages: null,
    });
    assert.equal(result.state, 'artifact_quality_unqualified');
    assert.equal(result.verificationMissing, true);
    assert.equal((await store.list({ sessionId: '11111111-1111-4111-8111-111111111111' })).length, 0);
  } finally { await app.close(); }
});
