import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { makeFileRealityTool } from '../src/file-reality-tool.js';

const room = await mkdtemp(join(tmpdir(), 't5-file-reality-performance-')); const workspace = join(room, 'workspace');
await mkdir(workspace); const count = 20_000; const batch = 200;
try {
  for (let from = 0; from < count; from += batch) await Promise.all(Array.from({ length: Math.min(batch, count - from) }, (_, offset) => {
    const index = from + offset; const directory = join(workspace, String(index % 100).padStart(3, '0'));
    return mkdir(directory, { recursive: true }).then(() => writeFile(join(directory, `자료-${String(index).padStart(6, '0')}.txt`), `일반 자료 ${index}\n`));
  }));
  const target = join(workspace, '099', 'KakaoTalk_20260827_random.txt'); await writeFile(target, '한빛상사 특수 견적 478만원\n');
  const tool = makeFileRealityTool({ workspace, home: room, platform: 'qualification', computerRoots: [workspace],
    indexSearch: async () => [target] });
  const result = await tool.execute({ action: 'search', query: '한빛상사 478만원', scope: 'workspace', path: null,
    handles: null, maxCandidates: 5, placements: null, planId: null, effect: null, sourceUses: null,
    purpose: null, unknowns: null, standardization: null });
  const evidence = { schema: 't5.file-reality-performance-sample.v1', fixtureFiles: count + 1,
    firstCandidate: result.candidates[0]?.displayName ?? null, candidateCount: result.candidates.length,
    contentIncluded: result.contentIncluded, coverage: result.coverage };
  if (evidence.firstCandidate !== 'KakaoTalk_20260827_random.txt' || evidence.contentIncluded !== false
    || result.coverage.filesystemFilesVisited < count) throw new Error(`file reality performance qualification failed: ${JSON.stringify(evidence)}`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally { await rm(room, { recursive: true, force: true }); }
