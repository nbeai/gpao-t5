import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAuthoringPreview } from './authoring-plan.js';
import { prepareAuthoringPlan } from './authoring-prepare.js';
import { AuthoringLockCoordinator } from './authoring-lock.js';
import { publishAuthoringTransaction } from './authoring-publish.js';
import { verifyAuthoringTransaction } from './authoring-verify.js';
import { settleAuthoringTransaction } from './authoring-settle.js';
import { assertVerifiedEphemeralProgramOutput } from './ephemeral-program-observer.js';

const SETTLED = new WeakSet();

export async function publishAndCleanEphemeralProgram({ verification: rawVerification,
  workspace, stateRoot, removeCapsule = rm } = {}) {
  const verification = assertVerifiedEphemeralProgramOutput(rawVerification);
  const publishable = verification.outputs.filter((item) => item.category === 'publishable');
  if (!publishable.length) throw new Error('capsule has no publishable output');
  const { plan } = await buildAuthoringPreview({ workspace, operations: await Promise.all(publishable.map(async (item) => (
    { type: 'create', path: item.relativePath, content: await readFile(item.path) }
  ))) });
  const { prepared } = await prepareAuthoringPlan({ plan, scratchRoot: join(stateRoot, 'authoring-scratch') });
  const coordinator = new AuthoringLockCoordinator(join(stateRoot, 'locks'));
  const { admission } = await coordinator.acquireAndRevalidate(prepared);
  const published = await publishAuthoringTransaction({ admission, coordinator,
    rollbackRoot: join(stateRoot, 'rollback') });
  if (!published.transaction) return { settlement: null, receipt: {
    ...published.receipt, capsuleScratchCleaned: false } };
  const observed = await verifyAuthoringTransaction({ transaction: published.transaction, coordinator,
    relationVerifier: async ({ targets }) => ({ state: targets.length === publishable.length ? 'verified' : 'failed' }) });
  if (!observed.verification) return { settlement: null, receipt: {
    ...observed.receipt, capsuleScratchCleaned: false } };
  const authored = await settleAuthoringTransaction({ verification: observed.verification, coordinator });
  if (!authored.settlement) return { settlement: null, receipt: {
    ...authored.receipt, capsuleScratchCleaned: false } };
  const capsuleDirectory = verification.execution.qualification.prepared.directory;
  let cleaned = false;
  try {
    await removeCapsule(capsuleDirectory, { recursive: true, force: true });
    cleaned = await lstat(capsuleDirectory).then(() => false).catch((error) => error?.code === 'ENOENT');
  } catch { cleaned = false; }
  if (!cleaned) return { settlement: null, receipt: { state: 'published_verified_cleanup_unknown',
    publishedTargets: publishable.length, capsuleScratchCleaned: false,
    undoAvailableTargets: authored.receipt.undoAvailableTargets } };
  const settlement = Object.freeze({ schema: 't5.ephemeral-program-publication-settlement.v1',
    authoringSettlement: authored.settlement, state: 'published_verified_cleaned' });
  SETTLED.add(settlement);
  return { settlement, receipt: { state: 'published_verified_cleaned',
    publishedTargets: publishable.length, excludedInternalTargets: verification.outputs.length - publishable.length,
    capsuleScratchCleaned: true, undoAvailableTargets: authored.receipt.undoAvailableTargets } };
}

export function assertSettledEphemeralProgramPublication(value) {
  if (!SETTLED.has(value) || value.state !== 'published_verified_cleaned') {
    throw new TypeError('settled ephemeral program publication required');
  }
  return value;
}
