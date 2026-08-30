const MAX_OPERATIONS = 4;
const MAX_OUTPUTS = 8;
const MAX_ROOTS = 8;
const MAX_PROCESSES = 4;
const MAX_BYTES = 8 * 1024;

function strings(values, maximum) {
  return [...new Set((values ?? []).map((value) => String(value ?? '').normalize('NFC').trim())
    .filter((value) => value && !value.includes('\0') && !/[\r\n]/u.test(value)))].slice(0, maximum);
}

export function workspaceRuntimeContextBlock({
  absoluteRoot, writableRoots = [], activeOutputOperations = [], pendingOutputs = [], activeProcesses = [],
} = {}) {
  const root = strings([absoluteRoot], 1)[0];
  if (!root) return null;
  const operations = (activeOutputOperations ?? []).slice(0, MAX_OPERATIONS).map((operation) => ({
    handle: String(operation.handle ?? '').slice(0, 100),
    sourceRoot: String(operation.sourceRoot ?? '').slice(0, 2_000),
    outputName: String(operation.outputName ?? '').slice(0, 180),
    state: String(operation.state ?? '').slice(0, 80),
  })).filter((operation) => operation.handle && operation.sourceRoot && operation.outputName && operation.state);
  const currentRunOutputRoot = operations.length === 1 ? operations[0].sourceRoot : null;
  const outputs = (pendingOutputs ?? []).slice(0, MAX_OUTPUTS).map((output) => ({
    outputHandle: String(output.outputHandle ?? '').slice(0, 100),
    name: String(output.originalName ?? '').slice(0, 180),
    bytes: Number(output.bytes ?? 0),
    producerRunId: String(output.producerRunId ?? '').slice(0, 100),
  })).filter((output) => output.outputHandle && output.name && Number.isSafeInteger(output.bytes)
    && output.bytes >= 0 && output.producerRunId);
  const processes = (activeProcesses ?? []).slice(0, MAX_PROCESSES).map((process) => ({
    processId: String(process.processId ?? '').slice(0, 100),
    state: String(process.state ?? '').slice(0, 40),
    cursor: { stdout: Number(process.cursor?.stdout ?? 0), stderr: Number(process.cursor?.stderr ?? 0) },
  })).filter((process) => process.processId && process.state === 'running'
    && Number.isSafeInteger(process.cursor.stdout) && process.cursor.stdout >= 0
    && Number.isSafeInteger(process.cursor.stderr) && process.cursor.stderr >= 0);
  const block = [
    '[T5 CURRENT WORKSPACE — observed now, not conversation history]',
    `absoluteRoot=${root}`,
    `writableRoots=${JSON.stringify(strings(writableRoots, MAX_ROOTS))}`,
    `activeOutputOperations=${JSON.stringify(operations)}`,
    `currentRunOutputRoot=${JSON.stringify(currentRunOutputRoot)}`,
    `pendingOutputs=${JSON.stringify(outputs)}`,
    `activeManagedProcesses=${JSON.stringify(processes)}`,
    processes.length ? 'When the user supplies input for an active managed process, use terminal_session write with its exact processId, then poll from its current cursor. Do not search attachments or start another process.' : '',
    'Use these observed roots for current computer work. Do not mention this internal workspace block unless the user explicitly asks.',
  ].join('\n');
  if (Buffer.byteLength(block, 'utf8') > MAX_BYTES) throw new Error('workspace runtime context exceeds bounded projection');
  return block;
}

export const WORKSPACE_RUNTIME_CONTEXT_LIMITS = Object.freeze({
  maxOperations: MAX_OPERATIONS, maxOutputs: MAX_OUTPUTS, maxRoots: MAX_ROOTS,
  maxProcesses: MAX_PROCESSES, maxBytes: MAX_BYTES,
});
