#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lock = JSON.parse(await readFile(resolve(root, 'refoundation/package-lock.json'), 'utf8'));
const rows = Object.entries(lock.packages).filter(([path]) => path).map(([path, metadata]) => {
  const name = path.replace(/^node_modules\//, '');
  if (!metadata.version || !metadata.license) throw new Error(`package metadata incomplete: ${name}`);
  return `| \`${name}\` | ${metadata.version} | ${metadata.license} |`;
}).sort((left, right) => left.localeCompare(right, 'en'));

const output = `# GPAO-T5 Third-Party Notices

GPAO-T5 original project materials are Copyright © 2026 YOON. Third-party
components listed here are not owned by YOON and remain governed by their own
copyright notices and license terms.

This inventory is generated from the exact versions in
\`refoundation/package-lock.json\`. The authoritative license text is the
\`LICENSE\`, \`LICENSE.md\`, \`COPYING\`, or equivalent file shipped with each
package. Any GPAO-T5 distribution that bundles one of these packages must
retain that complete text and all required notices.

| Package | Version | Declared license |
|---|---:|---|
${rows.join('\n')}

Direct upstream projects:

- Mozilla Readability: <https://github.com/mozilla/readability>
- Model Context Protocol TypeScript SDK: <https://github.com/modelcontextprotocol/typescript-sdk>
- Office Kit XLSX: <https://github.com/office-kit/xlsx>
- clawpdf: <https://github.com/openclaw/clawpdf>
- cron-parser: <https://github.com/harrisiirak/cron-parser>
- Kordoc: <https://github.com/chrisryugj/kordoc>
- LinkeDOM: <https://github.com/WebReflection/linkedom>
- node-pty: <https://github.com/microsoft/node-pty>
- Playwright: <https://github.com/microsoft/playwright>
- tree-sitter-bash: <https://github.com/tree-sitter/tree-sitter-bash>
- web-tree-sitter: <https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web>
- YAML: <https://github.com/eemeli/yaml>

This file is an attribution inventory, not a replacement for any third-party
license text.
`;

const path = resolve(root, 'THIRD_PARTY_NOTICES.md');
if (process.argv.includes('--check')) {
  if (await readFile(path, 'utf8') !== output) throw new Error('THIRD_PARTY_NOTICES.md is out of date');
} else await writeFile(path, output, 'utf8');
