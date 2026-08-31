import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { observePublicationPreimage } from './atomic-file-publication.js';

const TYPES = new Set(['create', 'modify', 'delete', 'move']);
const PLANS = new WeakSet();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (candidate, root) => { const value = relative(root, candidate);
  return value === '' || (value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value)); };

async function targetPath(workspace, value) {
  const lexical = resolve(workspace, String(value ?? ''));
  if (!inside(lexical, workspace) || lexical === workspace) throw new Error('authoring target escaped workspace');
  let candidate = dirname(lexical); const missingParents = [];
  while (candidate !== workspace) {
    try { await lstat(candidate); break; }
    catch (error) { if (error?.code !== 'ENOENT') throw error;
      missingParents.unshift(candidate); candidate = dirname(candidate); }
  }
  let parent; try { parent = await realpath(candidate); }
  catch { throw new Error('authoring parent is unavailable'); }
  if (!inside(parent, workspace)) throw new Error('authoring parent escaped workspace');
  const stat = await lstat(parent);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('authoring parent is unavailable');
  const path = resolve(parent, relative(candidate, lexical));
  return { path, parentPath: parent, missingParents: missingParents.map((item) => (
    resolve(parent, relative(candidate, item))
  )), parentIdentity: { dev: stat.dev, ino: stat.ino } };
}

export async function buildAuthoringPreview({ workspace: rootValue, operations, makeId = randomUUID,
  platform = process.platform } = {}) {
  const workspace = await realpath(resolve(rootValue));
  if (!Array.isArray(operations) || !operations.length) throw new TypeError('authoring operations required');
  const paths = new Set(); const prepared = [];
  for (const input of operations) {
    if (!input || !TYPES.has(input.type) || Object.keys(input).some((key) => (
      !['type', 'path', 'to', 'content'].includes(key)
    ))) throw new TypeError('authoring operation is invalid');
    const sourceTarget = await targetPath(workspace, input.path); const path = sourceTarget.path;
    const destinationTarget = input.type === 'move' ? await targetPath(workspace, input.to) : null;
    const to = destinationTarget?.path ?? null;
    for (const candidate of [path, to].filter(Boolean)) {
      const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
      if (paths.has(key)) throw new Error('authoring target is duplicated'); paths.add(key);
    }
    const preimage = await observePublicationPreimage(path);
    if (input.type === 'create' && preimage) throw new Error('authoring create target exists');
    if (input.type !== 'create' && !preimage) throw new Error('authoring source is unavailable');
    if (to && await observePublicationPreimage(to)) throw new Error('authoring move destination exists');
    const contentRequired = ['create', 'modify'].includes(input.type);
    if (contentRequired && !Object.hasOwn(input, 'content')) throw new TypeError('authoring content is required');
    const bytes = contentRequired ? (Buffer.isBuffer(input.content)
      ? Buffer.from(input.content) : Buffer.from(String(input.content))) : null;
    prepared.push({ type: input.type, path, to, preimage, bytes,
      parentPath: sourceTarget.parentPath, missingParents: sourceTarget.missingParents,
      parentIdentity: sourceTarget.parentIdentity,
      toParentPath: destinationTarget?.parentPath ?? null,
      toMissingParents: destinationTarget?.missingParents ?? [],
      toParentIdentity: destinationTarget?.parentIdentity ?? null,
      candidate: bytes ? { bytes: bytes.length, sha256: sha256(bytes) } : null });
  }
  const plan = { schema: 't5.authoring-plan.v1', planId: makeId(), workspace,
    operations: prepared, state: 'previewed', createdAt: new Date().toISOString() };
  PLANS.add(plan);
  const preview = { state: 'previewed', planId: plan.planId, readyToPrepare: true,
    changes: prepared.map((item) => ({ type: item.type,
      path: relative(workspace, item.path), ...(item.to ? { to: relative(workspace, item.to) } : {}),
      exists: item.preimage != null, preimageSha256: item.preimage?.sha256 ?? null,
      candidateSha256: item.candidate?.sha256 ?? null, candidateBytes: item.candidate?.bytes ?? null })) };
  return { plan, preview };
}

export function assertAuthoringPlan(plan) {
  if (!PLANS.has(plan)) throw new TypeError('fresh authoring plan required'); return plan;
}
