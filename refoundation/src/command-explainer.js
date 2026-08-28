import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import * as TreeSitter from 'web-tree-sitter';

const require = createRequire(import.meta.url);
const MAX_SOURCE_CHARS = 128 * 1024;
const MAX_PARSE_MS = 500;
let parserPromise = null;

function resolvePackageFile(packageName, fileName) {
  let directory = dirname(require.resolve(packageName));
  const searched = [];
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(directory, fileName);
    searched.push(candidate);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Unable to locate ${fileName} in ${packageName}; searched ${searched.join(', ')}`);
}

async function loadParser() {
  await TreeSitter.Parser.init({
    locateFile: (fileName) => resolvePackageFile('web-tree-sitter', fileName),
  });
  const language = await TreeSitter.Language.load(resolvePackageFile(
    'tree-sitter-bash', 'tree-sitter-bash.wasm',
  ));
  const parser = new TreeSitter.Parser();
  parser.setLanguage(language);
  return parser;
}

function parser() {
  parserPromise ??= loadParser().catch((error) => {
    parserPromise = null;
    throw error;
  });
  return parserPromise;
}

function namedChildren(node) {
  return Array.from({ length: node.namedChildCount }, (_, index) => node.namedChild(index))
    .filter(Boolean);
}

function decodeLiteral(node) {
  const text = String(node.text ?? '');
  if (node.type === 'raw_string' || node.type === 'string') return text.slice(1, -1);
  if (node.type === 'ansi_c_string') return text.slice(2, -1);
  return text.replace(/\\(.)/gs, '$1');
}

function commandNameNode(node) {
  return node.childForFieldName('name')
    ?? namedChildren(node).find((child) => child.type === 'command_name')
    ?? null;
}

const ARGUMENT_TYPES = new Set([
  'word', 'number', 'raw_string', 'string', 'ansi_c_string', 'concatenation',
  'expansion', 'simple_expansion', 'command_substitution', 'process_substitution',
  'arithmetic_expansion',
]);

function stepFrom(node, context, index) {
  const name = commandNameNode(node);
  if (!name) return null;
  const executable = decodeLiteral(name).trim();
  if (!executable) return null;
  const argv = [executable];
  for (const child of namedChildren(node)) {
    if (child === name || child.type === 'command_name' || child.type === 'variable_assignment') continue;
    if (!ARGUMENT_TYPES.has(child.type)) continue;
    argv.push(decodeLiteral(child));
  }
  return {
    id: `command-${index}`,
    context,
    executable,
    argv,
    text: node.text,
    span: {
      startIndex: node.startIndex,
      endIndex: node.endIndex,
      startPosition: { row: node.startPosition.row, column: node.startPosition.column },
      endPosition: { row: node.endPosition.row, column: node.endPosition.column },
    },
  };
}

function operatorBetween(source, left, right, index) {
  const separator = source.slice(left.span.endIndex, right.span.startIndex);
  const candidates = [
    ['stderr-pipe', '|&'], ['and', '&&'], ['or', '||'], ['pipe', '|'],
    ['sequence', ';'], ['background', '&'], ['newline-sequence', '\n'],
  ];
  let found = null;
  for (const [kind, text] of candidates) {
    const offset = separator.indexOf(text);
    if (offset < 0 || (found && offset >= found.offset)) continue;
    found = { kind, text, offset };
  }
  if (!found) return null;
  const startIndex = left.span.endIndex + found.offset;
  return {
    id: `operator-${index}`,
    kind: found.kind,
    text: found.text,
    fromCommandId: left.id,
    toCommandId: right.id,
    span: { startIndex, endIndex: startIndex + found.text.length },
  };
}

function contextInside(node, current) {
  if (node.type === 'command_substitution') return 'command-substitution';
  if (node.type === 'process_substitution') return 'process-substitution';
  if (node.type === 'function_definition') return 'function-definition';
  if (node.type === 'subshell') return 'subshell';
  return current;
}

function redirectedCommandId(node, steps) {
  let statement = node.parent;
  while (statement && statement.type !== 'redirected_statement') statement = statement.parent;
  const body = statement?.childForFieldName('body');
  if (!body) return null;
  return steps.find((step) => (
    step.span.startIndex >= body.startIndex && step.span.endIndex <= body.endIndex
  ))?.id ?? null;
}

/** Parse a POSIX shell command into executable steps and topology without deciding permission. */
export async function explainShellCommand(sourceValue) {
  const source = String(sourceValue ?? '');
  if (source.length > MAX_SOURCE_CHARS) throw new Error('Shell command is too large to explain');
  const bashParser = await parser();
  const deadline = performance.now() + MAX_PARSE_MS;
  let timedOut = false;
  const tree = bashParser.parse(source, null, {
    progressCallback: () => {
      timedOut = performance.now() > deadline;
      return timedOut;
    },
  });
  if (!tree) {
    bashParser.reset();
    if (timedOut) throw new Error(`tree-sitter-bash timed out after ${MAX_PARSE_MS}ms`);
    throw new Error('tree-sitter-bash returned no parse tree');
  }
  try {
    const steps = [];
    const heredocs = [];
    const shapes = new Set();
    function walk(node, context = 'top-level', commandId = null) {
      if (node.type === 'pipeline') shapes.add('pipeline');
      if (node.type === 'list') {
        const text = node.text;
        if (text.includes('&&')) shapes.add('and');
        if (text.includes('||')) shapes.add('or');
        if (text.includes(';')) shapes.add('sequence');
      }
      if (node.type === 'subshell') shapes.add('subshell');
      if (node.type === 'command') {
        const step = stepFrom(node, context, steps.length);
        if (step) { steps.push(step); commandId = step.id; }
      }
      if (node.type === 'heredoc_body') {
        const body = String(node.text ?? ''); shapes.add('heredoc-body');
        heredocs.push({ commandId: commandId ?? redirectedCommandId(node, steps),
          startIndex: node.startIndex, endIndex: node.endIndex,
          bytes: Buffer.byteLength(body, 'utf8'), sha256: createHash('sha256').update(body).digest('hex') });
      }
      const childContext = contextInside(node, context);
      for (const child of namedChildren(node)) walk(child, childContext, commandId);
    }
    walk(tree.rootNode);
    steps.sort((left, right) => left.span.startIndex - right.span.startIndex);
    const topLevel = steps.filter((step) => step.context === 'top-level');
    const operators = [];
    for (let index = 0; index < topLevel.length - 1; index += 1) {
      const operator = operatorBetween(source, topLevel[index], topLevel[index + 1], operators.length);
      if (operator) operators.push(operator);
    }
    return {
      ok: !tree.rootNode.hasError,
      hasParseError: tree.rootNode.hasError,
      source,
      shapes: [...shapes],
      steps,
      operators,
      ...(heredocs.length > 0 ? { heredocs } : {}),
    };
  } finally {
    tree.delete();
  }
}
