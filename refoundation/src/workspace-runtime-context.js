const MAX_OPERATIONS = 4;
const MAX_ROOTS = 8;
const MAX_BYTES = 8 * 1024;

function strings(values, maximum) {
  return [...new Set((values ?? []).map((value) => String(value ?? '').normalize('NFC').trim())
    .filter((value) => value && !value.includes('\0') && !/[\r\n]/u.test(value)))].slice(0, maximum);
}

export function workspaceRuntimeContextBlock({ absoluteRoot, writableRoots = [], activeOutputOperations = [] } = {}) {
  const root = strings([absoluteRoot], 1)[0];
  if (!root) return null;
  const operations = (activeOutputOperations ?? []).slice(0, MAX_OPERATIONS).map((operation) => ({
    handle: String(operation.handle ?? '').slice(0, 100),
    sourceRoot: String(operation.sourceRoot ?? '').slice(0, 2_000),
    outputName: String(operation.outputName ?? '').slice(0, 180),
    state: String(operation.state ?? '').slice(0, 80),
  })).filter((operation) => operation.handle && operation.sourceRoot && operation.outputName && operation.state);
  const currentRunOutputRoot = operations.length === 1 ? operations[0].sourceRoot : null;
  const block = [
    '[T5 CURRENT WORKSPACE — observed now, not conversation history]',
    `absoluteRoot=${root}`,
    `writableRoots=${JSON.stringify(strings(writableRoots, MAX_ROOTS))}`,
    `activeOutputOperations=${JSON.stringify(operations)}`,
    `currentRunOutputRoot=${JSON.stringify(currentRunOutputRoot)}`,
    'Use these observed roots for current computer work. Do not mention this internal workspace block unless the user explicitly asks.',
  ].join('\n');
  if (Buffer.byteLength(block, 'utf8') > MAX_BYTES) throw new Error('workspace runtime context exceeds bounded projection');
  return block;
}

export const WORKSPACE_RUNTIME_CONTEXT_LIMITS = Object.freeze({
  maxOperations: MAX_OPERATIONS, maxRoots: MAX_ROOTS, maxBytes: MAX_BYTES,
});
