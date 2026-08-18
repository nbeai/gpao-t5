#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lane = process.env.T5_REFOUNDATION_BOUNDARY_ROOT
  ? resolve(process.env.T5_REFOUNDATION_BOUNDARY_ROOT)
  : resolve(here, '..');
const sourceRoot = resolve(lane, 'src');
const failures = [];

function filesUnder(path) {
  const out = [];
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (statSync(child).isDirectory()) out.push(...filesUnder(child));
    else out.push(child);
  }
  return out;
}

const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
for (const file of filesUnder(sourceRoot).filter((path) => ['.js', '.mjs'].includes(extname(path)))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(importPattern)) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(file), specifier);
    if (target !== lane && !target.startsWith(`${lane}/`)) {
      failures.push(`${relative(lane, file)} → ${specifier} (refoundation 밖 import)`);
    }
  }
}

if (failures.length) {
  console.error('T5 refoundation 경계 FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('T5 refoundation 경계 OK — legacy source import 0');
