import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  auditDocumentTexts,
  auditRepositoryDocuments,
  DOCUMENT_RULES,
} from '../scripts/audit-document-authority.mjs';

test('현재 주요 문서의 권위·상태 계약이 일치한다', async () => {
  assert.deepEqual(await auditRepositoryDocuments(), []);
});

test('낡은 현재 지시가 다시 들어오면 문서 감사가 잡는다', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const texts = new Map();
  for (const { file } of DOCUMENT_RULES) {
    texts.set(file, await readFile(path.join(root, file), 'utf8'));
  }
  const target = 'GPAO-T5-CORE-OPERATOR-HARNESS-WORK-ORDER-2026-07-28-ko.md';
  texts.set(target, `${texts.get(target)}\n지금의 단 하나의 최우선 코어 작업이다\n`);
  assert.ok(auditDocumentTexts(texts).some(
    (finding) => finding.file === target && finding.kind === 'stale_forbidden',
  ));
});
