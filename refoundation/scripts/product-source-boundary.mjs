import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const FOURTH_CYCLE_DORMANT_SOURCE = Object.freeze([
  'src/capability-acquisition-coordinator.js',
  'src/capability-package-contract.js',
  'src/capability-reality.js',
  'src/local-capability-package-store.js',
  'src/principle-evidence-materializer.js',
  'src/principle-evidence-product-adapter.js',
  'src/principle-ledger.js',
  'src/principle-qualification.js',
  'src/reflection-background-noninterference.js',
  'src/reflection-candidate.js',
  'src/reflection-evidence-materializer.js',
  'src/reflection-ledger.js',
  'src/reflection-meaning-tool.js',
  'src/reflection-review-coordinator.js',
  'src/reflection-review-product-adapter.js',
  'src/reflection-review-surface.js',
  'src/reflection-source-window-coordinator.js',
]);

export async function removeFourthCycleDormantSource(refoundationRoot) {
  for (const relativePath of FOURTH_CYCLE_DORMANT_SOURCE) {
    await rm(join(refoundationRoot, relativePath), { force: true });
  }
}

export async function assertFourthCycleDormantSourceExcluded(refoundationRoot) {
  const present = [];
  for (const relativePath of FOURTH_CYCLE_DORMANT_SOURCE) {
    try { await lstat(join(refoundationRoot, relativePath)); present.push(relativePath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  if (present.length) throw new Error(`fourth-cycle source entered the current product payload: ${present.join(', ')}`);
  return { excluded: true, files: FOURTH_CYCLE_DORMANT_SOURCE.length };
}
