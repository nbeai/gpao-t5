#!/usr/bin/env node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFileRealityTool } from '../src/file-reality-tool.js';

const room = await mkdtemp(join(tmpdir(), 't5-s6-file-search-overlap-'));
const workspace = join(room, 'workspace'); const documents = join(room, 'Documents');
await Promise.all([mkdir(workspace), mkdir(documents)]);
try {
  const directories = [];
  for (let index = 0; index < 80; index += 1) {
    const directory = join(documents, `folder-${String(index).padStart(3, '0')}`);
    await mkdir(directory); directories.push(directory);
  }
  for (let batch = 0; batch < 100; batch += 1) await Promise.all(directories.map((directory, index) => (
    writeFile(join(directory, `record-${index}-${batch}.txt`), `ordinary synthetic record ${index} ${batch}\n`)
  )));
  const target = join(directories.at(-1), 'S6-TARGET-7391.txt');
  await writeFile(target, 'S6-TARGET-7391 exact content\n');
  const tool = makeFileRealityTool({ workspace, home: room, platform: 'test', computerRoots: [documents],
    indexSearch: async () => { await new Promise((resolve) => setTimeout(resolve, 600)); return [target]; } });
  const started = performance.now();
  const result = await tool.execute({ action: 'search', query: 'S6-TARGET-7391', scope: 'computer', path: null,
    handles: null, maxCandidates: 5, placements: null, planId: null, effect: null,
    sourceUses: null, purpose: null, unknowns: null, standardization: null });
  process.stdout.write(`${JSON.stringify({ schema: 't5.s6-p0-file-search-overlap-qualification.v1',
    wallMs: Number((performance.now() - started).toFixed(3)), passed: result.candidates[0]?.displayName === 'S6-TARGET-7391.txt',
    candidateCount: result.candidates.length, filenameScope: result.coverage.filenameScope,
    contentScope: result.coverage.contentScope, filenameEntriesVisited: result.coverage.filenameEntriesVisited,
    filesystemEntriesVisited: result.coverage.filesystemEntriesVisited, indexedCandidates: result.coverage.indexedCandidates,
  }, null, 2)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
