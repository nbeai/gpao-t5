#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lane = resolve(here, '..');
const mutations = [
  {
    name: 'completion blockers ignored',
    file: 'src/work-completion-evaluator.js',
    test: 'test/work-completion-tool.test.js',
    from: "proposedOutcome === 'achieved' && unique.length === 0",
    to: "proposedOutcome === 'achieved' && true",
  },
  {
    name: 'input terminal without exact surface receipt',
    file: 'src/work-store.js',
    test: 'test/work-store.test.js',
    from: `if (!surfaceReceipt || surfaceReceipt.surface !== 'console_session'
      || surfaceReceipt.sessionId !== input.sessionId || surfaceReceipt.runId !== runId
      || surfaceReceipt.resultDigest !== input.resultDigest) {`,
    to: 'if (false) {',
  },
];

const results = [];
for (const mutation of mutations) {
  const room = await mkdtemp(join(tmpdir(), 't5-core-mutation-'));
  try {
    await Promise.all([
      cp(join(lane, 'src'), join(room, 'src'), { recursive: true }),
      mkdir(join(room, 'test'), { recursive: true }),
      writeFile(join(room, 'package.json'), '{"type":"module"}\n'),
    ]);
    await cp(join(lane, mutation.test), join(room, mutation.test));
    await symlink(join(lane, 'node_modules'), join(room, 'node_modules'));
    const target = join(room, mutation.file);
    const original = await readFile(target, 'utf8');
    if (!original.includes(mutation.from)) throw new Error(`mutation anchor missing: ${mutation.name}`);
    await writeFile(target, original.replace(mutation.from, mutation.to));
    const run = spawnSync(process.execPath, ['--test', mutation.test], {
      cwd: room, encoding: 'utf8', timeout: 30_000,
    });
    results.push({ name: mutation.name, killed: run.status !== 0 });
  } finally { await rm(room, { recursive: true, force: true }); }
}

for (const result of results) console.log(`${result.killed ? 'KILLED' : 'SURVIVED'} ${result.name}`);
if (results.some((result) => !result.killed)) process.exit(1);
