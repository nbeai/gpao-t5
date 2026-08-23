import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeAttachmentTool } from '../src/attachment-hand.js';
import { AttachmentStore } from '../src/attachment-store.js';
import {
  PINNED_DOCUMENT_FIXTURES, assessDocumentCompatibilityBaseline,
  createGeneratedCompatibilityFixtures, fetchPinnedCompatibilityFixtures,
  summarizeCompatibilityObservation,
} from '../src/document-compatibility-baseline.js';

test('문서 호환성 생성 corpus는 인코딩·Office·ODF·PDF의 현재와 경계를 함께 가진다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-baseline-fixture-'));
  const cases = await createGeneratedCompatibilityFixtures(room);
  assert.equal(cases.length, 11);
  assert.deepEqual([...new Set(cases.map((item) => item.family))].sort(), [
    'pdf', 'presentation', 'spreadsheet', 'text', 'word_processing',
  ]);
  assert.deepEqual(cases.filter((item) => item.family === 'text').map((item) => item.encoding), [
    'utf-8', 'utf-8', 'utf-16le', 'cp949',
  ]);
  assert.ok(cases.every((item) => item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
  assert.ok(cases.some((item) => item.caseId === 'textless-pdf' && item.required.includes('ocr_completion')));
  const repeated = await createGeneratedCompatibilityFixtures(await mkdtemp(join(tmpdir(), 't5-document-baseline-repeat-')));
  assert.deepEqual(repeated.map((item) => item.sha256), cases.map((item) => item.sha256));
});

test('핀 고정 공개 corpus는 source commit·license·digest 없이 내려받지 않는다', async () => {
  assert.equal(PINNED_DOCUMENT_FIXTURES.length, 6);
  assert.ok(PINNED_DOCUMENT_FIXTURES.every((item) => item.sourceCommit.length === 40 && item.license && item.sha256.length === 64));
  const room = await mkdtemp(join(tmpdir(), 't5-document-baseline-download-'));
  await assert.rejects(() => fetchPinnedCompatibilityFixtures(room, {
    fetchImpl: async () => new Response('wrong bytes', { status: 200 }),
  }), /digest mismatch/u);
});

test('현재 실제 Attachment Hand 측정은 식별·내용·구조·OCR 필요 감지를 서로 합치지 않는다', async () => {
  const room = await mkdtemp(join(tmpdir(), 't5-document-baseline-current-'));
  const cases = await createGeneratedCompatibilityFixtures(join(room, 'corpus'));
  const sessionId = randomUUID(); const store = new AttachmentStore(join(room, 'attachments'));
  const tool = makeAttachmentTool({ store, sessionId, workspace: join(room, 'workspace') });
  const observations = [];
  for (const definition of cases) {
    const record = await store.receive({
      sessionId, originalName: definition.fileName, bytes: await readFile(definition.path),
    });
    const inspected = await tool.execute({
      action: 'inspect', attachmentId: record.attachmentId, filePath: null,
      maxChars: 20_000, maxCells: 5_000, maxPages: 20,
    });
    observations.push(summarizeCompatibilityObservation(definition, record, inspected));
  }
  const byId = new Map(observations.map((item) => [item.caseId, item]));
  assert.equal(byId.get('modern-xlsx').capabilities.tabular_structure, true);
  assert.equal(byId.get('modern-xlsx').inspection.matchedTextAnchors, 2);
  assert.equal(byId.get('text-pdf').capabilities.page_structure, true);
  assert.equal(byId.get('textless-pdf').capabilities.ocr_need_detection, true);
  assert.equal(byId.get('textless-pdf').capabilities.ocr_completion, false);
  assert.equal(byId.get('utf8-bom-csv').capabilities.tabular_structure, true);
  assert.equal(byId.get('utf16le-text').targetReady, true);
  assert.equal(byId.get('cp949-csv').capabilities.text_content, true);
  assert.equal(byId.get('cp949-csv').capabilities.encoding_identity, true);
  assert.equal(byId.get('cp949-csv').capabilities.tabular_structure, true);
  assert.equal(byId.get('modern-docx').capabilities.format_identity, true);
  assert.equal(byId.get('modern-docx').capabilities.text_content, false);
});

test('기준선 완료와 사용자 목표 준비 완료는 다른 판정이며 receipt identity가 틀리면 기준선도 실패한다', () => {
  const cases = [
    { caseId: 'a', family: 'text', format: 'text', sha256: 'a'.repeat(64), sourceKind: 'generated_fixture', required: ['text_content'] },
    { caseId: 'b', family: 'spreadsheet', format: 'xls', sha256: 'b'.repeat(64), sourceKind: 'pinned_public_fixture', required: ['tabular_structure'] },
    { caseId: 'c', family: 'pdf', format: 'pdf', sha256: 'c'.repeat(64), sourceKind: 'generated_fixture', required: ['ocr_completion'] },
    { caseId: 'd', family: 'word_processing', format: 'doc', sha256: 'd'.repeat(64), sourceKind: 'pinned_public_fixture', required: ['text_content'] },
    { caseId: 'e', family: 'presentation', format: 'ppt', sha256: 'e'.repeat(64), sourceKind: 'pinned_public_fixture', required: ['text_content'] },
    { caseId: 'f', family: 'korean_document', format: 'hwp5', sha256: 'f'.repeat(64), sourceKind: 'pinned_public_fixture', required: ['text_content'] },
  ];
  const observations = cases.map((item, index) => ({
    caseId: item.caseId, sourceSha256: item.sha256, record: { sha256: item.sha256 },
    truthfulBoundary: true, targetReady: index === 0, missing: index === 0 ? [] : item.required,
  }));
  const measured = assessDocumentCompatibilityBaseline(cases, observations);
  assert.equal(measured.baselineComplete, true); assert.equal(measured.targetReady, false);
  assert.equal(measured.targetReadyCases, 1); assert.equal(measured.missingCapabilityCounts.text_content, 3);
  observations[1].record.sha256 = '0'.repeat(64);
  assert.equal(assessDocumentCompatibilityBaseline(cases, observations).baselineComplete, false);
});
