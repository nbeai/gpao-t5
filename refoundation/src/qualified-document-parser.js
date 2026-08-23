import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./kordoc-read-worker.mjs', import.meta.url));
const REFOUNDATION_ROOT = resolve(dirname(WORKER), '..');
const NODE_MODULES = resolve(REFOUNDATION_ROOT, 'node_modules');
const MAX_STDOUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export const QUALIFIED_DOCUMENT_PARSER = Object.freeze({
  name: 'kordoc-read-split', version: '4.9.1',
  sourceCommit: 'c3ec5b5358197e488f96e5aa05ef9ad683359352',
  tarballSha256: '113154cb8a687822352023b82c610c8ba01325d12dd023e004ac28cde40a3237',
  formats: Object.freeze(['hwp3', 'hwp5', 'hwpx', 'xls', 'docx']),
  excludedSurfaces: Object.freeze(['pdf', 'ocr', 'image', 'mcp', 'cli', 'generate', 'fill', 'patch']),
  isolation: Object.freeze({
    process: 'node-permission-worker', input: 'stdin-exact-bytes', filesystemWrite: false,
    network: false, childProcess: false, workerThreads: false,
  }),
});

function starts(bytes, text) { return bytes.subarray(0, Buffer.byteLength(text)).equals(Buffer.from(text)); }
function zipContains(bytes, path) { return bytes.includes(Buffer.from(path, 'utf8')); }

export function detectQualifiedDocumentFormat(bytesInput, originalName = '') {
  const bytes = Buffer.from(bytesInput); const extension = extname(String(originalName)).toLowerCase();
  const ole = bytes.subarray(0, 4).equals(Buffer.from('d0cf11e0', 'hex'));
  const zip = bytes.subarray(0, 2).toString('ascii') === 'PK';
  if (extension === '.hwp' && starts(bytes, 'HWP Document File V3.00')) return 'hwp3';
  if (extension === '.hwp' && ole) return 'hwp5';
  if (extension === '.xls' && ole) return 'xls';
  if (extension === '.hwpx' && zip && (zipContains(bytes, 'Contents/content.hpf') || zipContains(bytes, 'mimetype'))) return 'hwpx';
  if (extension === '.docx' && zip && zipContains(bytes, 'word/document.xml')) return 'docx';
  return null;
}

function parseResult(stdout, stderr, code) {
  try { return JSON.parse(stdout); }
  catch {
    return { success: false, code: 'PARSER_PROTOCOL_ERROR', error: stderr.trim() || `parser exited ${code}` };
  }
}

export async function inspectQualifiedDocument({
  bytes: inputBytes, format, sourceSha256, maxChars = 64_000, maxCells = 10_000,
  timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = spawn,
} = {}) {
  const bytes = Buffer.from(inputBytes ?? []);
  if (!bytes.length || bytes.length > 32 * 1024 * 1024 || !QUALIFIED_DOCUMENT_PARSER.formats.includes(format)) {
    throw new TypeError('qualified document parser input is invalid');
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sourceSha256) throw new Error('qualified document source digest mismatch');
  const args = [
    '--permission', `--allow-fs-read=${WORKER}`, `--allow-fs-read=${NODE_MODULES}`,
    WORKER, format, String(maxChars), String(maxCells),
  ];
  const startedAt = Date.now();
  const child = spawnImpl(process.execPath, args, {
    cwd: REFOUNDATION_ROOT, env: { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = ''; let stderr = ''; let outputBytes = 0; let timedOut = false; let oversized = false;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  const collect = (target) => (chunk) => {
    outputBytes += Buffer.byteLength(chunk);
    if (outputBytes > MAX_STDOUT_BYTES) { oversized = true; child.kill('SIGKILL'); return; }
    if (target === 'stdout') stdout += chunk; else stderr += chunk;
  };
  child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
  child.stdin.on('error', () => {});
  child.stdin.end(bytes);
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once('error', reject); child.once('close', resolveExit);
  }).finally(() => clearTimeout(timer));
  if (timedOut) return { kind: 'qualified_document', format, state: 'capability_boundary', reason: 'parser_timeout' };
  if (oversized) return { kind: 'qualified_document', format, state: 'capability_boundary', reason: 'parser_output_limit' };
  const result = parseResult(stdout, stderr, exitCode);
  if (!result.success) {
    return {
      kind: 'qualified_document', format, state: 'capability_boundary', reason: 'parser_rejected',
      errorCode: result.code ?? 'PARSE_ERROR', warning: result.error ?? 'document parse failed',
      parser: QUALIFIED_DOCUMENT_PARSER, sourceSha256, durationMs: Date.now() - startedAt,
    };
  }
  return {
    kind: 'qualified_document', format, state: 'observed', parser: QUALIFIED_DOCUMENT_PARSER,
    sourceSha256, durationMs: Date.now() - startedAt,
    text: result.markdown, coverage: result.coverage, structure: result.structure,
    warnings: result.warnings, metadata: result.metadata,
  };
}
