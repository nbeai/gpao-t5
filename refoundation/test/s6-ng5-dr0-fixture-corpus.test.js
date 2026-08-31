import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { inspectBusinessDocument, reopenBusinessDocumentPages } from '../src/document-data-inspector.js';

const testRoot = dirname(fileURLToPath(import.meta.url));
const repository = resolve(testRoot, '..', '..');
const fixtureRoot = join(repository, 'refoundation', 'fixtures', 's6-ng5-dr0');
const oraclePath = join(repository, 'refoundation', 'evidence', 's6-ng5-dr0-hidden-oracle-2026-08-31.json');

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixtureFiles(directory = fixtureRoot, prefix = '') {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) output.push(...await fixtureFiles(join(directory, entry.name), relative));
    else output.push(relative);
  }
  return output.sort();
}

test('NG5 DR-0 corpus는 세 bounded 목적과 PDF·XLSX·이미지 12개만 모델 workspace 입력으로 가진다', async () => {
  const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
  const files = await fixtureFiles();
  assert.equal(oracle.scenarios.length, 3);
  assert.equal(files.length, 12);
  assert.equal(files.filter((file) => file.endsWith('.pdf')).length, 5);
  assert.equal(files.filter((file) => file.endsWith('.xlsx')).length, 3);
  assert.equal(files.filter((file) => file.endsWith('.png')).length, 4);
  assert.ok(files.every((file) => !/oracle|answer|expected|inspect|render/iu.test(file)), files.join('\n'));
  assert.deepEqual(oracle.scenarios.map((scenario) => scenario.id), [
    'purchase_reconciliation', 'contract_revision', 'expense_evidence',
  ]);
});

test('NG5 DR-0 hidden oracle은 모든 source를 exact digest로 결속하고 fixture 밖에 존재한다', async () => {
  const oracle = JSON.parse(await readFile(oraclePath, 'utf8'));
  const declared = oracle.scenarios.flatMap((scenario) => scenario.sources);
  const files = await fixtureFiles();
  assert.equal(declared.length, files.length);
  assert.deepEqual(declared.map((source) => source.path).sort(), files);
  for (const source of declared) {
    const bytes = await readFile(join(fixtureRoot, source.path));
    assert.equal(sha256(bytes), source.sha256, source.path);
  }
  assert.equal(oracle.corpus.oracleVisibility,
    'qualification evaluator only; never copied into the model workspace or prompt');
  assert.equal(oracle.passContract.oracleProjectedToModel, 0);
});

test('NG5 DR-0 PDF는 현재 제품 inspector로 전체 page가 열리고 exact page handle 재개방이 된다', async () => {
  const po = await inspectBusinessDocument({ file: join(fixtureRoot, 'purchase', 'purchase-order-PO-2026-104.pdf') });
  assert.equal(po.kind, 'pdf');
  assert.equal(po.pdf.pageCount, 2);
  assert.match(po.pdf.pages[0].text, /X-12 Calibration cartridge 120 25,000 3,000,000/u);
  assert.match(po.pdf.pages[1].text, /Short delivery must be reported before payment/u);
  const reopened = await reopenBusinessDocumentPages({ file: po.file.path, expectedSha256: po.file.sha256, pages: [2] });
  assert.equal(reopened.pages.length, 1);
  assert.match(reopened.pages[0].text, /automatic substitution/u);

  const contract = await inspectBusinessDocument({ file: join(fixtureRoot, 'contract', 'contract-v2.pdf') });
  assert.match(contract.pdf.pages[0].text, /KRW 5,100,000/u);
  assert.match(contract.pdf.pages[0].text, /monthly backup/u);
  assert.match(contract.pdf.pages[0].text, /Provider \[blank\]/u);

  const invoice = await inspectBusinessDocument({ file: join(fixtureRoot, 'expense', 'tax-invoice-C102.pdf') });
  assert.match(invoice.pdf.pages[0].text, /C-102/u);
  assert.match(invoice.pdf.pages[0].text, /41,000/u);
});

test('NG5 DR-0 XLSX는 현재 제품 inspector로 관계와 차이를 결정하는 exact sheet·row·cell을 보존한다', async () => {
  const receiving = await inspectBusinessDocument({ file: join(fixtureRoot, 'purchase', 'receiving-ledger.xlsx') });
  const rcv = receiving.workbook.sheets[0];
  assert.equal(rcv.name, 'Receiving');
  assert.equal(rcv.cells.find((cell) => cell.address === 'B3').value, 'PO-2026-104');
  assert.equal(rcv.cells.find((cell) => cell.address === 'F3').value, 118);
  assert.equal(rcv.cells.find((cell) => cell.address === 'G3').value, 25000);
  assert.match(rcv.cells.find((cell) => cell.address === 'H4').value, /outside this packet; do not reconcile/u);
  assert.match(rcv.cells.find((cell) => cell.address === 'H5').value, /outside this packet; do not reconcile/u);

  const responsibility = await inspectBusinessDocument({ file: join(fixtureRoot, 'contract', 'responsibility-matrix.xlsx') });
  const revision = responsibility.workbook.sheets[0];
  assert.equal(revision.name, 'Revision Control');
  assert.equal(revision.cells.find((cell) => cell.address === 'C5').value, 'v1');
  assert.equal(revision.cells.find((cell) => cell.address === 'D5').value, 'Weekly backup');
  assert.equal(revision.cells.find((cell) => cell.address === 'F5').value, 'Not updated');
  assert.equal(revision.cells.find((cell) => cell.address === 'F6').value, 'Pending provider');

  const ledger = await inspectBusinessDocument({ file: join(fixtureRoot, 'expense', 'card-ledger.xlsx') });
  const card = ledger.workbook.sheets[0];
  assert.equal(card.cells.find((cell) => cell.address === 'A4').value, 'C-102');
  assert.equal(card.cells.find((cell) => cell.address === 'D4').value, 42000);
  assert.equal(card.cells.find((cell) => cell.address === 'A5').value, 'C-103');
  assert.equal(card.cells.find((cell) => cell.address === 'G5').value, 'No evidence attached');
});

test('NG5 DR-0 이미지 입력은 bounded PNG이며 중복 영수증은 byte 동일성이 아닌 같은 receipt identity 반례다', async () => {
  const imagePaths = [
    'purchase/tax-invoice-IV-991.png', 'contract/signature-page-v2.png',
    'expense/receipt-C101.png', 'expense/receipt-C101-copy.png',
  ];
  for (const relative of imagePaths) {
    const bytes = await readFile(join(fixtureRoot, relative));
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.format, 'png');
    assert.equal(metadata.width, 800);
    assert.equal(metadata.height, 700);
    assert.ok(bytes.length < 100_000, relative);
  }
  const original = await readFile(join(fixtureRoot, 'expense', 'receipt-C101.png'));
  const copy = await readFile(join(fixtureRoot, 'expense', 'receipt-C101-copy.png'));
  assert.notEqual(sha256(original), sha256(copy));
});
