import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { setFormula } from '@office-kit/xlsx/cell';
import { workbookToBytes } from '@office-kit/xlsx/io';
import { addWorksheet, createWorkbook } from '@office-kit/xlsx/workbook';
import { mergeCells, setCell, setColumnWidth, setRowHeight } from '@office-kit/xlsx/worksheet';

export const MERGED_QUOTE_RANGES = Object.freeze([
  'A11:F11', 'A13:A22', 'A1:F1', 'A26:C26', 'A27:F27', 'A28:F28', 'A9:A10',
  'B10:F10', 'B12:F12', 'B13:F13', 'B14:F14', 'B15:F15', 'B16:F16', 'B17:F17',
  'B18:F18', 'B19:F19', 'B20:F20', 'B21:F21', 'B22:F22', 'B8:F8', 'B9:F9',
  'D26:E26', 'D2:F2', 'D3:F3', 'D4:F4', 'D5:F5', 'D6:F6', 'D7:F7',
]);

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export async function createMergedQuoteFixture(directory) {
  await mkdir(directory, { recursive: true }); const path = join(directory, '병합_행사견적_비식별.xlsx');
  const workbook = createWorkbook(); const sheet = addWorksheet(workbook, 'Sheet1');
  for (const range of MERGED_QUOTE_RANGES) mergeCells(sheet, range);
  const values = {
    A1: '견적서', A2: '견적일', B2: '2026-08-20(목)', C2: '상호명', D2: '테스트케이터링',
    A3: '업체명', B3: '한빛상회', C3: '담당자', D3: '홍길동', A4: '담당자', B4: null,
    C4: '주소', D4: '대전시 서구 샘플로 10', A5: '연락처', B5: '010-0000-0000',
    C5: '사업자번호', D5: '000-00-00000', A6: '행사일자', B6: '2026-09-01(화)',
    C6: '홈페이지', D6: 'https://example.invalid', A7: '행사시간', B7: '12시 30분 도착',
    C7: '연락처', D7: '010-0000-0000', A8: '배송지주소', B8: '대전시 중구 테스트로 1, 1층 로비',
    A9: '비고', B9: '당일 카드결제', B10: '요청사항: 고등학생 도시락, 탄수화물·단백질 균형, 주스 포함',
    A11: '아래와 같이 견적 드립니다', A12: '항목', B12: '메뉴 세부 내역',
    B13: '** 케이터링 행사 도시락 **', B14: '미니버거', B15: '닭강정과 샐러드',
    B16: '주먹밥', B17: '계절 과일', B18: '오렌지 주스',
    B23: '품목', C23: '수량', D23: '단가', E23: '금액', F23: '비고',
    A24: 1, B24: '행사 도시락', C24: 85, D24: 27000,
    A25: 2, B25: '배송비', A26: '합계',
    A27: '* 개인정보·계좌정보는 제거했습니다.\n* 부가세와 배송비는 미확인입니다.',
    A28: '안전한 행사가 되도록 최선을 다하겠습니다.',
  };
  for (const [address, value] of Object.entries(values)) {
    const match = /^([A-Z]+)(\d+)$/u.exec(address); let column = 0;
    for (const character of match[1]) column = column * 26 + character.charCodeAt(0) - 64;
    setCell(sheet, Number(match[2]), column, value);
  }
  setFormula(setCell(sheet, 24, 5), 'C24*D24', { cachedValue: 2_295_000 });
  setFormula(setCell(sheet, 26, 4), 'SUM(E24:E25)', { cachedValue: 2_295_000 });
  [14, 24, 14, 12, 14, 10, 3].forEach((width, index) => setColumnWidth(sheet, index + 1, width));
  setRowHeight(sheet, 27, 54); const bytes = Buffer.from(await workbookToBytes(workbook));
  await writeFile(path, bytes, { mode: 0o600 });
  return {
    path, sha256: digest(bytes), bytes: bytes.length, sheetName: 'Sheet1', merges: MERGED_QUOTE_RANGES,
    expected: {
      customer: '한빛상회', eventDate: '2026-09-01(화)', arrival: '12시 30분 도착', quantity: 85,
      unitPrice: 27000, amount: 2_295_000, amountFormula: 'C24*D24', deliveryFee: null, vat: null,
      recipeRow: ['불린녹말', '마는녹말', '밀가루', '계란흰자1개'],
      recipeSheet: '끼니강성미샘', recipeAddresses: ['A9', 'B9', 'C9', 'D9'],
    },
  };
}

export async function createRecipeLayoutFixture(directory) {
  await mkdir(directory, { recursive: true }); const path = join(directory, '24시트_레시피_비식별.xlsx');
  const workbook = createWorkbook();
  for (let index = 0; index < 24; index += 1) {
    const sheet = addWorksheet(workbook, index === 0 ? '끼니강성미샘' : `비식별${String(index + 1).padStart(2, '0')}`);
    setCell(sheet, 1, 1, `비식별 레시피 ${index + 1}`); mergeCells(sheet, 'A1:I1');
    if (index === 0) {
      ['불린녹말', '마는녹말', '밀가루', '계란흰자1개', '', '타바스코', '약간', '', '']
        .forEach((value, column) => setCell(sheet, 9, column + 1, value));
    } else setCell(sheet, 9, 1, `비식별 항목 ${index + 1}`);
  }
  const bytes = Buffer.from(await workbookToBytes(workbook)); await writeFile(path, bytes, { mode: 0o600 });
  return { path, sha256: digest(bytes), bytes: bytes.length, sheets: 24 };
}

export function assessStructuralDocumentQualification({
  fixture, quoteSheet, quotePreview = '', recipePreview = '', recipeTarget = null, modelTasks = [], sourceFilesUnchanged = false,
} = {}) {
  const cell = (address) => quoteSheet?.cells?.find((item) => item.address === address);
  const checks = {
    quoteHasExactMerges: quoteSheet?.merges?.length === 28
      && MERGED_QUOTE_RANGES.every((range) => quoteSheet.merges.includes(range)),
    quoteMeaningBoundToCells: cell('B3')?.text === fixture.expected.customer
      && cell('B6')?.text === fixture.expected.eventDate && cell('B7')?.text === fixture.expected.arrival
      && cell('C24')?.value === 85 && cell('D24')?.value === 27000 && cell('E24')?.result === 2_295_000,
    quoteFormulaPreserved: cell('E24')?.formula === fixture.expected.amountFormula,
    quoteUnknownsRemainUnknown: cell('B4')?.text == null && cell('C25')?.value == null,
    quotePreviewHonorsMerges: /colspan="6"/u.test(quotePreview) && /rowspan="10"/u.test(quotePreview),
    recipeRowKeptHorizontal: recipeTarget?.sheetName === fixture.expected.recipeSheet
      && JSON.stringify(recipeTarget.addresses) === JSON.stringify(fixture.expected.recipeAddresses)
      && JSON.stringify(recipeTarget.values) === JSON.stringify(fixture.expected.recipeRow),
    recipeNotRelabeledAsQuantityUnit: recipeTarget?.semanticRoles?.every((role) => role === 'parallel_source_item') === true,
    recipePreviewShowsSameStructure: /끼니강성미샘/u.test(recipePreview)
      && ['A9', 'B9', 'C9', 'D9', ...fixture.expected.recipeRow].every((value) => recipePreview.includes(value)),
    modelTasksPassed: modelTasks.length === 4 && modelTasks.every((task) => task.passed === true),
    sourceFilesUnchanged,
  };
  return { checks, passed: Object.values(checks).every(Boolean) };
}
