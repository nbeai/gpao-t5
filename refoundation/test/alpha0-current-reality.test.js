import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { makeConsoleServer } from '../src/console-server.js';
import { inspectBusinessDocument } from '../src/document-data-inspector.js';

function manyPagePdf(pageCount, sentinelPage) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const pageObject = objects.length + 1; const contentObject = pageObject + 1;
    const text = page === sentinelPage ? `TARGET-REVENUE-PAGE-${page}` : `ordinary-page-${page}`;
    const stream = `BT /F1 11 Tf 72 720 Td (${text}) Tj ET`;
    kids.push(`${pageObject} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  let body = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test('Alpha1 UI client disconnect와 packaged launcher 종료는 Local Runtime을 끝내지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha0-runtime-'));
  const server = makeConsoleServer({ stateDir: join(room, 'state'), workspace: room,
    localConsoleToken: 'alpha0-local-token',
    modelFactory: () => ({ async respond() { return { text: 'unused', toolCalls: [] }; } }) });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/`); await page.text();
    const afterClientClosed = await fetch(`${base}/health`).then((response) => response.json());
    assert.equal(afterClientClosed.ok, true);
    const launcher = await readFile(new URL('../scripts/macos-launcher.m', import.meta.url), 'utf8');
    assert.match(launcher, /ensure-local-runtime\.mjs/u);
    assert.doesNotMatch(launcher, /applicationWillTerminate[\s\S]*\[self\.child terminate\]/u);
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(room, { recursive: true, force: true }); }
});

test('Alpha0 500쪽 PDF는 전체 전송 후보가 아니지만 목적 관련 후반 페이지 선택은 현재 미달이다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-alpha0-document-')); const file = join(room, '500-pages.pdf');
  try {
    await writeFile(file, manyPagePdf(500, 421));
    const observed = await inspectBusinessDocument({ file });
    assert.equal(observed.pdf.pageCount, 500);
    assert.equal(observed.pdf.projection.shownPages, 20);
    assert.equal(observed.pdf.projection.omittedPages, 480);
    assert.equal(observed.pdf.projection.truncated, true);
    assert.doesNotMatch(JSON.stringify(observed.pdf.pages), /TARGET-REVENUE-PAGE-421/u);
  } finally { await rm(room, { recursive: true, force: true }); }
});
