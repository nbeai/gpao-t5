import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, unzipSync, zipSync } from 'fflate';

import {
  ARTIFACT_QUALITY_OUTPUT_CONTRACT, makeArtifactQualityOutputQualifier,
} from '../src/artifact-quality-output-qualification.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';
import { renderDocxFirstPage } from '../src/docx-visual-renderer.js';

function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function xml(value) { return strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`); }
function inlineCell(address, value) {
  return `<c r="${address}" t="inlineStr"><is><t>${value}</t></is></c>`;
}
function numberCell(address, value) { return `<c r="${address}"><v>${value}</v></c>`; }

function hardcodedCalculationWorkbook() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="정산" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">\'정산\'!A1:B8</definedName></definedNames><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'),
    'xl/_rels/workbook.xml.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': xml('<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Arial"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'),
    'xl/worksheets/sheet1.xml': xml(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetData>
      <row r="1">${inlineCell('A1', 'source-a')}${numberCell('B1', 40000)}</row>
      <row r="2">${inlineCell('A2', 'source-b')}${numberCell('B2', 28300)}</row>
      <row r="3">${inlineCell('A3', 'grand-total')}${numberCell('B3', 68300)}</row>
      <row r="4">${inlineCell('A4', 'source-a.xlsx#B2')}</row>
      <row r="5">${inlineCell('A5', 'source-b.xlsx#B2')}</row>
      <row r="6">${inlineCell('A6', '원본 근거 두 건의 합계를 계산한다')}</row>
    </sheetData><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`),
  }, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
}

function calculationPurpose(bytes) {
  const digest = sha256(bytes);
  return {
    contractId: 'hardcoded-calculation-red-v1',
    artifact: { artifactId: 'hardcoded.xlsx', kind: 'xlsx', sha256: digest },
    audience: '정산 담당자', domain: 'settlement', usePurpose: '원본 두 건에서 총액을 계산하고 감사한다',
    deliveryMedium: 'both',
    sourceFacts: [
      { factId: 'source-a', sourceRef: 'source-a.xlsx#B2', resolution: 'resolved', preserveOriginal: true },
      { factId: 'source-b', sourceRef: 'source-b.xlsx#B2', resolution: 'resolved', preserveOriginal: true },
    ],
    calculations: [{ calculationId: 'grand-total', sourceFactIds: ['source-a', 'source-b'] }],
    requiredArtifactForms: ['정산'], visualHierarchyGoals: ['원본 근거 두 건의 합계를 계산한다'],
    domainProfile: { profileId: 'settlement', version: '1', invariantRefs: ['source-backed-calculation'] },
    laneRequirements: {
      semantic: [{ requirementId: 'semantic', kind: 'semantic_reconciliation', expected: { satisfiedFactIds: ['source-a', 'source-b'], unchangedSourceFactIds: ['source-a', 'source-b'], preservedUnresolvedFactIds: [] } }],
      domain: [{ requirementId: 'lineage', kind: 'domain_traceability', invariantRefs: ['source-backed-calculation'], expected: { sourceFactIds: ['source-a', 'source-b'], reversibleSourceFactIds: ['source-a', 'source-b'], calculationIds: ['grand-total'] } }],
      structural: [
        { requirementId: 'reopen', kind: 'structural_scan', expected: { reopenedArtifactSha256: digest, maximumFormulaErrors: 0, maximumSchemaErrors: 0 } },
        { requirementId: 'forms', kind: 'artifact_forms', expected: { formIds: ['정산'] } },
      ],
      screen: [
        { requirementId: 'screen-render', kind: 'render_coverage', expected: { surface: 'screen', unitIds: ['정산'] } },
        { requirementId: 'screen-integrity', kind: 'visual_integrity', expected: { surface: 'screen', unitIds: ['정산'], disallowedDefects: ['clipping', 'glyph_loss'] } },
        { requirementId: 'screen-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'screen', unitIds: ['정산'], goalIds: ['원본 근거 두 건의 합계를 계산한다'] } },
      ],
      print: [
        { requirementId: 'page-setup', kind: 'openxml_page_setup', expected: { sheets: [{ sheetId: '정산', paperSize: 'A4', orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printArea: 'A1:B8' }] } },
        { requirementId: 'print-render', kind: 'render_coverage', expected: { surface: 'print', unitIds: ['정산:p1'] } },
        { requirementId: 'print-integrity', kind: 'visual_integrity', expected: { surface: 'print', unitIds: ['정산:p1'], disallowedDefects: ['clipping', 'glyph_loss'] } },
        { requirementId: 'print-hierarchy', kind: 'visual_hierarchy', expected: { surface: 'print', unitIds: ['정산:p1'], goalIds: ['원본 근거 두 건의 합계를 계산한다'] } },
      ],
    },
  };
}

function koreanThreePageDocx() {
  const paragraph = (text) => `<w:p><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial"/></w:rPr><w:t>${text}</w:t></w:r></w:p>`;
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  return Buffer.from(zipSync({
    '[Content_Types].xml': xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': xml(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraph('첫째 쪽 한글 기준 글리프 가나다')}${pageBreak}${paragraph('둘째 쪽 한글 기준 글리프 라마바')}${pageBreak}${paragraph('셋째 쪽 한글 기준 글리프 사아자')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`),
  }, { mtime: new Date('2020-01-01T00:00:00.000Z') }));
}

const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);

test('source-backed 계산 목적은 formulaErrors=0만으로 hardcoded target을 구조 qualified하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh2-hardcoded-red-'));
  const workspace = join(room, 'workspace'); await mkdir(workspace);
  const filePath = join(workspace, 'hardcoded.xlsx'); const bytes = hardcodedCalculationWorkbook();
  await writeFile(filePath, bytes);
  await writeFile(`${filePath}${ARTIFACT_QUALITY_OUTPUT_CONTRACT.suffix}`, JSON.stringify(calculationPurpose(bytes)));
  try {
    const observed = await inspectBusinessDocument({ file: filePath });
    assert.equal(observed.workbook.totals.formulas, 0);
    assert.equal(observed.workbook.totals.formulaErrors, 0);
    assert.equal(observed.workbook.sheets[0].cells.find((cell) => cell.address === 'B3')?.value, 68300);
    const result = await makeArtifactQualityOutputQualifier()({ filePath, workspace });
    assert.notEqual(result.receipt.lanes.structural.status, 'qualified',
      'formula presence, target-cell lineage, and engine recalc are unobserved');
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('한글 다페이지 DOCX visual receipt는 모든 page와 required glyph coverage를 증명한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-qh2-docx-red-'));
  const filePath = join(room, 'korean-three-pages.docx'); await writeFile(filePath, koreanThreePageDocx());
  const archive = unzipSync(await readFile(filePath));
  const documentXml = Buffer.from(archive['word/document.xml']).toString('utf8');
  assert.equal((documentXml.match(/w:type="page"/gu) ?? []).length + 1, 3);
  for (const marker of ['가나다', '라마바', '사아자']) assert.match(documentXml, new RegExp(marker, 'u'));
  try {
    const rendered = await renderDocxFirstPage(filePath, {
      platform: 'darwin', temporaryRoot: room,
      runCommand: async (_command, args) => {
        const output = args[args.indexOf('-o') + 1];
        await writeFile(join(output, 'korean-three-pages.docx.png'), png);
      },
    });
    assert.deepEqual(rendered.observedPageIds, ['document:page1', 'document:page2', 'document:page3']);
    assert.deepEqual(rendered.requiredGlyphCoverage, [
      { pageId: 'document:page1', marker: '가나다', present: true },
      { pageId: 'document:page2', marker: '라마바', present: true },
      { pageId: 'document:page3', marker: '사아자', present: true },
    ]);
  } finally { await rm(room, { recursive: true, force: true }); }
});
