#!/usr/bin/env node
import { lstat, readFile, readlink, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(root, 'node_modules', '.bin');
const names = process.platform === 'win32'
  ? ['kordoc', 'kordoc.cmd', 'kordoc.ps1', 'kordoc-mcp', 'kordoc-mcp.cmd', 'kordoc-mcp.ps1']
  : ['kordoc', 'kordoc-mcp'];

for (const name of names) {
  const path = join(bin, name); let info;
  try { info = await lstat(path); } catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
  const target = info.isSymbolicLink() ? await readlink(path) : await readFile(path, 'utf8');
  if (!/kordoc[\\/]dist[\\/](?:cli|mcp)\.js/u.test(String(target))) {
    throw new Error(`refusing to remove unexpected bin surface: ${name}`);
  }
  await unlink(path);
}
