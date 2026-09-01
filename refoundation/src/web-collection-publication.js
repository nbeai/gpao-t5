import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { createWorkbookFromSpec } from './document-data-inspector.js';

function safeName(value) {
  const leaf = basename(String(value ?? 'web-collection.xlsx')).replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  return (leaf.toLowerCase().endsWith('.xlsx') ? leaf : `${leaf || 'web-collection'}.xlsx`).slice(0, 180);
}
function width(key) { return /(?:title|name|url|description)/iu.test(key) ? 56 : 18; }

export function makeWebCollectionPublisher({ attachmentStore, sessionId, runId, scratchRoot } = {}) {
  if (!attachmentStore?.receive || !attachmentStore?.link || !sessionId || !runId || !scratchRoot) {
    throw new TypeError('Web collection publisher inputs are required');
  }
  return async function publish({ result, fields, outputName, structureDigest } = {}) {
    if (result?.state !== 'verified_collection' || result.verified !== true || !Array.isArray(result.records)
      || !Array.isArray(fields) || !fields.length) throw new Error('only a verified collection can be published');
    await mkdir(scratchRoot, { recursive: true, mode: 0o700 });
    const room = await mkdtemp(join(scratchRoot, 'publication-')); const name = safeName(outputName);
    const output = join(room, name);
    try {
      const rows = result.records.map((record) => Object.fromEntries([
        ...fields.map((key) => [key, record[key] ?? '']),
        ['source_page', record.source?.page ?? ''], ['source_url', record.source?.url ?? ''],
      ]));
      const columns = [...fields, 'source_page', 'source_url'].map((key) => ({ key, header: key, width: width(key) }));
      const summaryRows = [
        ['records', result.coverage.observedRecords], ['requested_pages', result.coverage.requestedPages],
        ['observed_pages', result.coverage.observedPages], ['coverage_complete', result.coverage.complete],
        ['required_missing', result.validation.requiredMissing], ['duplicates', result.validation.duplicateCount],
        ['origin', result.network.origin], ['request_count', result.network.requestCount],
      ].map(([metric, value]) => ({ metric, value }));
      const created = await createWorkbookFromSpec({ output, spec: { sheets: [
        { name: 'records', columns, rows },
        { name: 'summary', columns: [{ key: 'metric', header: 'metric', width: 30 },
          { key: 'value', header: 'value', width: 52 }], rows: summaryRows },
      ] } });
      const bytes = await readFile(output); const recordDigest = createHash('sha256')
        .update(JSON.stringify(result.records)).digest('hex');
      const artifact = await attachmentStore.receive({ sessionId, direction: 'output', originalName: name, bytes,
        providerIdentity: { kind: 'web_collection', structureDigest, recordDigest,
          sourceOrigin: result.network.origin, coverage: 'verified' } });
      await attachmentStore.link({ sessionId, attachmentIds: [artifact.attachmentId],
        messageId: `${runId}:web-collection:${artifact.attachmentId}`, runId });
      const observation = created.observation;
      return { artifact, recordDigest, cleanup: 'verified', reopened: {
        kind: observation.kind, sheetCount: observation.workbook?.sheetCount ?? null,
        recordRows: observation.workbook?.sheets?.find((sheet) => sheet.name === 'records')?.rowCount ?? null,
      } };
    } finally { await rm(room, { recursive: true, force: true }); }
  };
}
