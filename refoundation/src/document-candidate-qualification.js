import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SCHEMA = 't5.document-candidate-qualification.v1';
const RHWP_COMMIT = '496333b27d21ddb9114ba9ae340bcb895870c9a7';

export const KORDOC_CANDIDATE = Object.freeze({
  name: 'kordoc', version: '4.9.1', sourceCommit: 'c3ec5b5358197e488f96e5aa05ef9ad683359352',
  license: 'MIT',
  tarball: 'https://registry.npmjs.org/kordoc/-/kordoc-4.9.1.tgz',
  tarballSha256: '113154cb8a687822352023b82c610c8ba01325d12dd023e004ac28cde40a3237',
  npmIntegrity: 'sha512-kGwqIZNu6JAoOmseQqTcKeozuWBdJa5aZUxjfHbuFfSStBOGMuK1Ochb8VqCOhxabMmNZ1tJlkjVeltoWaDVTQ==',
  packedBytes: 3_289_476,
  unpackedBytes: 12_119_609,
  installedDiskBytesWithoutOptionalDependencies: 42_676_224,
  nodeEngine: '>=18',
  declaredDependencies: Object.freeze({
    '@modelcontextprotocol/sdk': '^1.29.0', '@xmldom/xmldom': '^0.9.10', cfb: '1.2.2',
    commander: '^13.0.0', jszip: '^3.10.1', 'markdown-it': '^14.3.0', zod: '^3.23.0',
  }),
  optionalDependenciesOmitted: Object.freeze({
    '@huggingface/transformers': '^4.1.0', '@hyzyla/pdfium': '^2.1.0',
    'onnxruntime-node': '^1.24.0', 'pdfjs-dist': '^4.10.38', sharp: '^0.35.0',
  }),
});

export const D5_PINNED_FIXTURES = Object.freeze([
  {
    caseId: 'paired-hwp3', format: 'hwp3', fileName: '같은내용_HWP3.hwp',
    url: `https://raw.githubusercontent.com/edwardkim/rhwp/${RHWP_COMMIT}/samples/hwp3-sample.hwp`,
    sha256: '645525c8cd5ec11b1742ba7cfc759f68622861916233b5e982385cdb12f0ced2',
    sourceCommit: RHWP_COMMIT, license: 'MIT', required: ['content'],
  },
  {
    caseId: 'paired-hwp5', format: 'hwp5', fileName: '같은내용_HWP5.hwp',
    url: `https://raw.githubusercontent.com/edwardkim/rhwp/${RHWP_COMMIT}/samples/hwp3-sample-hwp5.hwp`,
    sha256: 'dc2edf4737c110ab16a6c6543bceed9f5648d634a40e180ce3fc2725ec0f21d8',
    sourceCommit: RHWP_COMMIT, license: 'MIT', required: ['content', 'page_structure', 'table_structure'],
  },
  {
    caseId: 'paired-hwpx', format: 'hwpx', fileName: '같은내용_HWPX.hwpx',
    url: `https://raw.githubusercontent.com/edwardkim/rhwp/${RHWP_COMMIT}/samples/hwp3-sample-hwpx.hwpx`,
    sha256: 'aa043a7df44f9d28893cd75423e8e7b5e8eb2be56d8819d4a4cf39e2d64e5cb1',
    sourceCommit: RHWP_COMMIT, license: 'MIT', required: ['content', 'page_structure', 'table_structure'],
  },
  {
    caseId: 'encrypted-hwp3', format: 'hwp3', fileName: '암호_HWP3.hwp',
    url: `https://raw.githubusercontent.com/edwardkim/rhwp/${RHWP_COMMIT}/samples/HWP3-password-123456.hwp`,
    sha256: 'db743d084efc9e08e839a5b4d978b16b8676434011776e090e4cda43e57304be',
    sourceCommit: RHWP_COMMIT, license: 'MIT', required: ['encrypted_boundary'],
  },
  {
    caseId: 'legacy-xls-biff8-korean', format: 'xls', fileName: '구형_한국어_예산.xls',
    url: `https://raw.githubusercontent.com/chrisryugj/kordoc/${KORDOC_CANDIDATE.sourceCommit}/tests/fixtures/xls/budget.xls`,
    sha256: '69a4180a7b2d8044220ea2b35116c0c1fe3d4b0dd247d025c0dbc0daf211e14b',
    sourceCommit: KORDOC_CANDIDATE.sourceCommit, license: 'MIT',
    expectedText: ['2025년도 부서별 예산 편성', '기획조정실', '12500000000'], required: ['content', 'table_structure'],
  },
]);

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export async function fetchD5PinnedFixtures(directory, { fetchImpl = fetch } = {}) {
  await mkdir(directory, { recursive: true }); const fixtures = [];
  for (const definition of D5_PINNED_FIXTURES) {
    const response = await fetchImpl(definition.url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`D5 fixture download failed: ${definition.caseId} HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) throw new Error(`D5 fixture exceeds size limit: ${definition.caseId}`);
    if (digest(bytes) !== definition.sha256) throw new Error(`D5 fixture digest mismatch: ${definition.caseId}`);
    const path = join(directory, definition.fileName); await writeFile(path, bytes, { mode: 0o600 });
    fixtures.push({ ...definition, path, bytes: bytes.length, sourceKind: 'pinned_public_fixture' });
  }
  return fixtures;
}

function words(value) {
  return new Set(String(value ?? '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

export function tokenSimilarity(left, right) {
  const a = words(left); const b = words(right); let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = a.size + b.size - intersection;
  return {
    leftTokens: a.size, rightTokens: b.size, intersection,
    jaccard: union ? intersection / union : 1,
    leftCoverage: a.size ? intersection / a.size : 1,
    rightCoverage: b.size ? intersection / b.size : 1,
  };
}

export function summarizeKordocObservation(definition, output = {}, performance = {}) {
  const markdown = String(output.markdown ?? '');
  const counts = {};
  for (const block of output.blocks ?? []) counts[block?.type ?? 'unknown'] = (counts[block?.type ?? 'unknown'] ?? 0) + 1;
  const anchors = definition.expectedText ?? [];
  const matched = anchors.filter((anchor) => markdown.includes(anchor));
  const encrypted = output.success === false && output.code === 'ENCRYPTED';
  const capabilities = {
    content: output.success === true && (anchors.length ? matched.length === anchors.length : markdown.trim().length >= 20),
    table_structure: Number(counts.table ?? 0) > 0,
    page_structure: Number(output.pageCount ?? output.metadata?.pageCount ?? 0) > 0 && Array.isArray(output.pages),
    encrypted_boundary: encrypted,
    corrupted_boundary: output.success === false && [
      'CORRUPTED', 'UNSUPPORTED_FORMAT', 'PARSE_ERROR', 'DECOMPRESSION_BOMB', 'ZIP_BOMB',
    ].includes(output.code),
  };
  return {
    caseId: definition.caseId, expectedFormat: definition.format, sourceSha256: definition.sha256,
    success: output.success === true, reportedFormat: output.fileType ?? null,
    markdownChars: markdown.length, uniqueWordTokens: words(markdown).size,
    blockCounts: counts, pageCount: output.pageCount ?? output.metadata?.pageCount ?? null,
    warnings: Array.isArray(output.warnings) ? output.warnings : [],
    error: output.error ?? null, errorCode: output.code ?? null,
    boundaryAccuracy: definition.required.includes('corrupted_boundary')
      ? (output.code === 'CORRUPTED' ? 'exact' : capabilities.corrupted_boundary ? 'fail_closed_misclassified' : 'failed_open')
      : null,
    anchors: { expected: anchors.length, matched: matched.length }, capabilities,
    required: definition.required, missing: definition.required.filter((name) => !capabilities[name]),
    targetReady: definition.required.every((name) => capabilities[name]), performance,
    markdown,
  };
}

export function assessDocumentCandidateQualification({
  candidate = KORDOC_CANDIDATE, current = [], candidateObservations = [], corruptObservations = [],
  sourceFilesUnchanged = false, platform = process.platform, modelTasks = [],
} = {}) {
  const byId = new Map(candidateObservations.map((row) => [row.caseId, row]));
  const paired = ['paired-hwp3', 'paired-hwp5', 'paired-hwpx'].map((id) => byId.get(id));
  const pairSimilarity = paired.every(Boolean) ? {
    hwp3ToHwp5: tokenSimilarity(paired[0].markdown, paired[1].markdown),
    hwp3ToHwpx: tokenSimilarity(paired[0].markdown, paired[2].markdown),
    hwp5ToHwpx: tokenSimilarity(paired[1].markdown, paired[2].markdown),
  } : null;
  const checks = {
    exactCandidateIdentity: candidate.version === KORDOC_CANDIDATE.version
      && candidate.tarballSha256 === KORDOC_CANDIDATE.tarballSha256 && candidate.license === 'MIT',
    sameContentAcrossHwpGenerations: Boolean(pairSimilarity)
      && Object.values(pairSimilarity).every((score) => score.jaccard >= 0.98),
    hwpFamilyReady: paired.every((row) => row?.targetReady),
    xlsReady: byId.get('legacy-xls-biff8-korean')?.targetReady === true,
    docxReady: byId.get('modern-docx')?.targetReady === true,
    encryptedFailsClosed: byId.get('encrypted-hwp3')?.targetReady === true,
    corruptFilesFailClosed: corruptObservations.length >= 3 && corruptObservations.every((row) => row.capabilities.corrupted_boundary),
    sourceFilesUnchanged,
    macActuallyMeasured: platform === 'darwin',
    actualModelTasksPassed: modelTasks.length >= 2 && modelTasks.every((task) => task.passed === true),
  };
  const currentReady = Object.fromEntries(current.map((row) => [row.caseId, row.targetReady === true]));
  const qualifiedFormats = ['hwp3', 'hwp5', 'hwpx', 'xls', 'docx'].filter((format) => {
    const id = format === 'xls' ? 'legacy-xls-biff8-korean' : format === 'docx' ? 'modern-docx' : `paired-${format}`;
    return byId.get(id)?.targetReady === true;
  });
  const disposition = Object.values(checks).every(Boolean) ? 'split' : 'reject';
  return {
    schema: SCHEMA, checks, passed: Object.values(checks).every(Boolean), disposition,
    qualifiedFormats, keepCurrentPaths: ['text', 'csv', 'tsv', 'xlsx', 'pdf'],
    currentReady, pairSimilarity,
    reason: disposition === 'split'
      ? 'HWP3/HWP5/HWPX/XLS/DOCX parser surfaces qualify, but the package-wide CLI/MCP/OCR/PDF surface is broader than the measured need.'
      : 'The candidate did not satisfy every bounded D5 qualification check; do not connect it to T5.',
  };
}
