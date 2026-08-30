import assert from 'node:assert/strict';
import test from 'node:test';

import { documentPublicationTemporary } from '../src/document-publication-temporary.js';

test('격리된 Document CLI는 sibling 대신 Runtime scratch에서 임시 파일을 만든다', () => {
  const confined = documentPublicationTemporary('/workspace/result/report.xlsx', {
    env: { T5_DOCUMENT_CONFINED: '1', TMPDIR: '/runtime/scratch' }, makeId: () => 'one',
  });
  assert.equal(confined, '/runtime/scratch/.t5-document-one.xlsx');
  const ordinary = documentPublicationTemporary('/workspace/result/report.docx', {
    env: {}, makeId: () => 'two',
  });
  assert.equal(ordinary, '/workspace/result/.t5-document-two.docx');
});
