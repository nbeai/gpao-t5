import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { assertPreparedAuthoring } from './authoring-prepare.js';
import { DurableProcessOwnership } from './durable-process-ownership.js';
import { observePublicationPreimage } from './atomic-file-publication.js';

const ADMISSIONS = new WeakSet();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const authoringTargetResource = (path) => `target-${sha256(path).slice(0, 48)}`;

export class AuthoringLockCoordinator {
  constructor(lockRoot, options = {}) {
    this.ownership = new DurableProcessOwnership(lockRoot, {
      ...options, activeReason: 'authoring_target_locked',
      contendedCode: 'authoring_target_contended', lostCode: 'authoring_target_lock_lost',
    });
  }

  async acquireAndRevalidate(rawPrepared) {
    const prepared = assertPreparedAuthoring(rawPrepared); const plan = prepared.plan;
    const targets = [...new Set(plan.operations.flatMap((item) => [item.path, item.to].filter(Boolean)))].sort();
    const claims = [];
    try {
      for (const path of targets) {
        const key = authoringTargetResource(path); const acquired = await this.ownership.acquire(key);
        if (!acquired.claimed) throw Object.assign(new Error('authoring target is locked'), {
          code: 'authoring_target_contended',
        });
        claims.push({ path, key, claim: acquired.claim });
      }
      for (const item of claims) await this.ownership.assert(item.key, item.claim);
      for (const operation of plan.operations) {
        const current = await observePublicationPreimage(operation.path);
        if (!same(current, operation.preimage)) throw new Error('authoring preimage changed after preview');
        const parent = await lstat(dirname(operation.path));
        if (!parent.isDirectory() || parent.isSymbolicLink()
          || parent.dev !== operation.parentIdentity.dev || parent.ino !== operation.parentIdentity.ino) {
          throw new Error('authoring parent changed after preview');
        }
        if (operation.to) {
          if (await observePublicationPreimage(operation.to)) throw new Error('authoring destination collision');
          const toParent = await lstat(dirname(operation.to));
          if (!toParent.isDirectory() || toParent.isSymbolicLink()
            || toParent.dev !== operation.toParentIdentity.dev || toParent.ino !== operation.toParentIdentity.ino) {
            throw new Error('authoring destination parent changed after preview');
          }
        }
      }
      for (const candidate of prepared.candidates) {
        if (sha256(await readFile(candidate.path)) !== candidate.sha256) {
          throw new Error('authoring scratch candidate changed');
        }
      }
      const admission = { schema: 't5.authoring-publication-admission.v1', prepared,
        claims, state: 'admitted', admittedAt: new Date().toISOString() };
      ADMISSIONS.add(admission); prepared.state = 'admitted';
      return { admission, receipt: { state: 'admitted', planId: plan.planId,
        lockedTargets: claims.length, orderedTargetDigests: claims.map((item) => sha256(item.path)) } };
    } catch (error) {
      for (const item of claims.reverse()) await this.ownership.release(item.key, item.claim).catch(() => {});
      throw error;
    }
  }

  async acquirePaths(paths) {
    const claims = [];
    try {
      for (const path of [...new Set(paths)].sort()) {
        const key = authoringTargetResource(path); const acquired = await this.ownership.acquire(key);
        if (!acquired.claimed) throw Object.assign(new Error('authoring target is locked'), {
          code: 'authoring_target_contended',
        });
        claims.push({ path, key, claim: acquired.claim });
      }
      return claims;
    } catch (error) {
      await this.releaseClaims(claims); throw error;
    }
  }

  async releaseClaims(claims) {
    let released = 0;
    for (const item of [...claims].reverse()) if (await this.ownership.release(item.key, item.claim)) released += 1;
    return { released };
  }

  async release(admission) {
    if (!ADMISSIONS.has(admission)) throw new TypeError('fresh authoring admission required');
    const result = await this.releaseClaims(admission.claims);
    admission.state = 'released'; return result;
  }
}

export function assertAuthoringAdmission(value) {
  if (!ADMISSIONS.has(value) || value.state !== 'admitted') throw new TypeError('active authoring admission required');
  return value;
}
