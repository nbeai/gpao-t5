import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AttachmentStore } from '../src/attachment-store.js';
import { makeAttachmentTool } from '../src/attachment-hand.js';
import { runAgent } from '../src/agent-loop.js';
import { reopenBusinessDocumentPages, searchBusinessDocumentPages } from '../src/document-data-inspector.js';

function manyPagePdf(pageCount, sentinelPage) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']; const kids = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const pageObject = objects.length + 1; const contentObject = pageObject + 1;
    const text = page === sentinelPage ? `TARGET REVENUE PAGE ${page} TOTAL 7391` : `ordinary page ${page}`;
    const stream = `BT /F1 11 Tf 72 720 Td (${text}) Tj ET`; kids.push(`${pageObject} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>`;
  let body = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(body)); body += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(body); body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return Buffer.from(body);
}

test('500쪽 PDF는 로컬 전 페이지 후보화 뒤 목적 관련 421쪽만 exact reopen한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-context-')); const file = join(room, 'large.pdf');
  try {
    await writeFile(file, manyPagePdf(500, 421));
    const candidates = await searchBusinessDocumentPages({ file, query: 'target revenue total' });
    assert.equal(candidates.locallySearchedPages, 500); assert.equal(candidates.totalPages, 500);
    assert.equal(candidates.candidates[0].page, 421); assert.ok(candidates.candidates.length <= 8);
    assert.equal(candidates.transmission.wholeSourceSent, false);
    const reopened = await reopenBusinessDocumentPages({ file, expectedSha256: candidates.fileSha256,
      pages: [candidates.candidates[0].page] });
    assert.match(reopened.pages[0].text, /TOTAL 7391/u); assert.equal(reopened.pages.length, 1);
    assert.deepEqual(reopened.transmission.selectedUnits, [421]); assert.equal(reopened.transmission.totalUnits, 500);
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('Attachment Hand는 search가 발급한 같은 첨부 handle만 reopen하고 foreign handle을 거부한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-hand-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const sessionId = '11111111-1111-4111-8111-111111111111'; const store = new AttachmentStore(join(room, 'attachments'));
  try {
    const record = await store.receive({ sessionId, originalName: 'large.pdf', bytes: manyPagePdf(500, 421) });
    const tool = makeAttachmentTool({ store, sessionId, workspace });
    const searched = await tool.execute({ action: 'search_document', attachmentId: record.attachmentId, query: 'target revenue total' });
    const handle = searched.observation.candidates[0].pageHandle;
    const reopened = await tool.execute({ action: 'reopen_document_pages', attachmentId: record.attachmentId,
      pageHandles: [handle], maxChars: 20000 });
    assert.match(reopened.observation.pages[0].text, /7391/u);
    await assert.rejects(() => tool.execute({ action: 'reopen_document_pages', attachmentId: record.attachmentId,
      pageHandles: ['page-foreign'], maxChars: 20000 }), { code: 'T5_DOCUMENT_SELECTION_INVALID' });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('선택 뒤 원문 hash가 바뀌면 old page를 반환하지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-stale-')); const file = join(room, 'large.pdf');
  try {
    await writeFile(file, manyPagePdf(30, 21)); const candidates = await searchBusinessDocumentPages({ file, query: 'target revenue' });
    await writeFile(file, manyPagePdf(30, 22));
    await assert.rejects(() => reopenBusinessDocumentPages({ file, expectedSha256: candidates.fileSha256, pages: [21] }),
      { code: 'T5_DOCUMENT_SELECTION_STALE' });
  } finally { await rm(room, { recursive: true, force: true }); }
});

test('모델이 로컬 후보 handle을 선택한 뒤 exact page를 보고 목적 답을 작성한다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-model-select-')); const workspace = join(room, 'workspace'); await mkdir(workspace);
  const sessionId = '22222222-2222-4222-8222-222222222222'; const store = new AttachmentStore(join(room, 'attachments'));
  try {
    const record = await store.receive({ sessionId, originalName: 'large.pdf', bytes: manyPagePdf(500, 421) });
    const attachment = makeAttachmentTool({ store, sessionId, workspace }); let call = 0;
    const result = await runAgent({ request: '이 문서의 target revenue total을 알려줘', tools: [attachment],
      model: { async respond({ messages }) {
        call += 1;
        if (call === 1) return { text: '', toolCalls: [{ id: 'search', name: 'attachment', args: {
          action: 'search_document', attachmentId: record.attachmentId, filePath: null, maxChars: null,
          maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
          expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
          query: 'target revenue total', pageHandles: null } }] };
        if (call === 2) { const observed = JSON.parse(messages.at(-1).content); const handle = observed.result.observation.candidates[0].pageHandle;
          return { text: '', toolCalls: [{ id: 'reopen', name: 'attachment', args: {
            action: 'reopen_document_pages', attachmentId: record.attachmentId, filePath: null, maxChars: 20000,
            maxCells: null, maxPages: null, outputName: null, resultRelativePath: null,
            expectedResultJson: null, expectedStdoutIncludes: null, operationHandle: null, outputHandle: null,
            query: null, pageHandles: [handle] } }] }; }
        assert.match(messages.at(-1).content, /TOTAL 7391/u); return { text: 'Target revenue total은 7391입니다.', toolCalls: [] };
      } } });
    assert.equal(result.answer, 'Target revenue total은 7391입니다.'); assert.equal(result.receipts.length, 2);
  } finally { await rm(room, { recursive: true, force: true }); }
});
