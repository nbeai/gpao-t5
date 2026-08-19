#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import {
  createWorkbookFromSpec, inspectBusinessDocument,
} from '../src/document-data-inspector.js';

function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? null : args[index + 1];
}

function integerOption(args, name, fallback) {
  const value = option(args, name);
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new TypeError(`${name} must be an integer`);
  return parsed;
}

async function main(args) {
  const action = args[0];
  if (action === 'help' || action === '--help' || action === '-h') return {
    schema: 't5.document-cli-help.v1',
    actions: [
      {
        name: 'inspect',
        usage: 't5-document inspect ABSOLUTE_PATH [--max-cells N] [--max-pages N]',
        result: 'JSON file facts plus XLSX sheets/cells/formulas/merges/hidden state or PDF page text/projection/OCR boundary.',
      },
      {
        name: 'create-xlsx',
        usage: 't5-document create-xlsx --spec ABSOLUTE_JSON --output ABSOLUTE_XLSX [--replace]',
        spec: 'JSON {sheets:[{name,title?,columns:[{key,header,width?,numberFormat?}],rows:[{key:value}],formulas?:[{cell,formula,result,numberFormat?}]}]}',
        result: 'JSON created flag and a complete re-opened document observation.',
      },
    ],
  };
  if (action === 'inspect') {
    const file = args[1];
    if (!file) throw new TypeError('Usage: t5-document inspect ABSOLUTE_PATH [--max-cells N] [--max-pages N]');
    return inspectBusinessDocument({
      file,
      maxCells: integerOption(args, '--max-cells', undefined),
      maxPages: integerOption(args, '--max-pages', undefined),
    });
  }
  if (action === 'create-xlsx') {
    const specPath = option(args, '--spec');
    const output = option(args, '--output');
    if (!specPath || !output) {
      throw new TypeError('Usage: t5-document create-xlsx --spec ABSOLUTE_JSON --output ABSOLUTE_XLSX [--replace]');
    }
    if (!isAbsolute(specPath)) throw new TypeError('spec path must be absolute');
    const stat = await lstat(specPath);
    if (stat.isSymbolicLink()) throw new Error('spec path must not be a symbolic link');
    if (!stat.isFile()) throw new Error('spec path must be a regular file');
    if (stat.size > 8 * 1024 * 1024) throw new Error('spec exceeds 8388608 byte limit');
    const spec = JSON.parse(await readFile(specPath, 'utf8'));
    return createWorkbookFromSpec({ output, spec, replace: args.includes('--replace') });
  }
  throw new TypeError('Unknown action. Use inspect or create-xlsx.');
}

try {
  const result = await main(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    schema: 't5.document-cli-error.v1',
    error: error?.message ?? String(error),
  })}\n`);
  process.exitCode = 1;
}
