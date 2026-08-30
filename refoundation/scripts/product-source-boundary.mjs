import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const FOURTH_CYCLE_DORMANT_SOURCE = Object.freeze([
  'src/capability-acquisition-coordinator.js',
  'src/capability-package-contract.js',
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

export const QUALIFICATION_ONLY_SOURCE = Object.freeze([
  'src/attachment-qualification.js',
  'src/b-transition-qualification.js',
  'src/backend-demand.js',
  'src/business-artifact-continuity.js',
  'src/business-workflow-qualification.js',
  'src/connection-readiness.js',
  'src/deliverable-truth-qualification.js',
  'src/document-candidate-qualification.js',
  'src/document-compatibility-baseline.js',
  'src/document-data-qualification.js',
  'src/ephemeral-program-actual.js',
  'src/ephemeral-program-observer.js',
  'src/ephemeral-program-preparation.js',
  'src/ephemeral-program-publication.js',
  'src/ephemeral-program-quickjs.js',
  'src/human-scenarios.js',
  'src/incident-reference-fixture.js',
  'src/korean-web-baseline.js',
  'src/memory-recall-auditor.js',
  'src/pdf-deliverable-qualification.js',
  'src/project-qualification.js',
  'src/recovery-qualification.js',
  'src/resource-report.js',
  'src/s3-human-business-observation.js',
  'src/s3-human-business-scenarios.js',
  'src/skill-value-comparison.js',
  'src/social-link-baseline.js',
  'src/structural-document-qualification.js',
  'src/terminal-performance.js',
  'src/text-tabular-qualification.js',
  'src/user-grounded-social-fixture.js',
  'src/user-grounded-social-scenarios.js',
  'src/video-text-baseline.js',
  'src/web-variance-analysis.js',
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

export async function removeQualificationOnlySource(refoundationRoot) {
  for (const relativePath of QUALIFICATION_ONLY_SOURCE) {
    await rm(join(refoundationRoot, relativePath), { force: true });
  }
}

export async function assertQualificationOnlySourceExcluded(refoundationRoot) {
  const present = [];
  for (const relativePath of QUALIFICATION_ONLY_SOURCE) {
    try { await lstat(join(refoundationRoot, relativePath)); present.push(relativePath); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  if (present.length) throw new Error(`qualification-only source entered the current product payload: ${present.join(', ')}`);
  return { excluded: true, files: QUALIFICATION_ONLY_SOURCE.length };
}
