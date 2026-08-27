import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
}

function ownershipError(code, message) { return Object.assign(new Error(message), { code }); }

function resourceName(value) {
  const name = String(value ?? '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name)) throw new TypeError('process ownership resource is invalid');
  return name;
}

/** Durable PID + random-token fencing only; this is an ownership marker, not product state. */
export class DurableProcessOwnership {
  constructor(directory, {
    pid = process.pid, tokenFactory = randomUUID, isProcessAlive = processIsAlive,
    lockName = (resource) => `${resource}.owner`, activeReason = 'owner_active',
    contendedCode = 'process_owner_contended', lostCode = 'process_ownership_lost',
    resourceField = 'resource',
  } = {}) {
    if (!directory) throw new TypeError('process ownership directory is required');
    this.directory = directory; this.pid = Number(pid); this.tokenFactory = tokenFactory;
    this.isProcessAlive = isProcessAlive; this.lockName = lockName;
    this.activeReason = activeReason; this.contendedCode = contendedCode; this.lostCode = lostCode;
    if (!/^[a-z][a-zA-Z0-9]*$/u.test(resourceField)) throw new TypeError('process ownership resource field is invalid');
    this.resourceField = resourceField;
  }

  paths(resource) {
    const name = resourceName(resource); const leaf = String(this.lockName(name));
    if (!/^[a-z0-9.-]+\.owner$/u.test(leaf)) throw new TypeError('process ownership lock name is invalid');
    const lockDirectory = join(this.directory, leaf);
    return { lockDirectory, recordFile: join(lockDirectory, 'owner.json') };
  }

  async read(resource) {
    const { recordFile } = this.paths(resource);
    try {
      const record = JSON.parse(await readFile(recordFile, 'utf8'));
      if (record?.version !== 1 || record[this.resourceField] !== resource
        || !Number.isSafeInteger(record.pid) || record.pid <= 0
        || typeof record.ownerToken !== 'string' || !record.ownerToken) return null;
      return record;
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async acquire(resourceInput) {
    const resource = resourceName(resourceInput); const { lockDirectory, recordFile } = this.paths(resource);
    await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const ownerToken = String(this.tokenFactory()); let created = false;
      try {
        await mkdir(lockDirectory, { mode: 0o700 }); created = true;
        const claim = {
          version: 1, [this.resourceField]: resource, pid: this.pid, ownerToken, acquiredAt: Date.now(),
        };
        await writeFile(recordFile, JSON.stringify(claim), { encoding: 'utf8', mode: 0o600 });
        await chmod(recordFile, 0o600); return { claimed: true, claim };
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          if (created) await rm(lockDirectory, { recursive: true, force: true }).catch(() => {});
          throw error;
        }
      }
      const existing = await this.read(resource);
      if (existing && this.isProcessAlive(existing.pid)) return {
        claimed: false, reason: this.activeReason,
        owner: { pid: existing.pid, acquiredAt: existing.acquiredAt ?? null },
      };
      if (!existing) {
        const ageMs = await stat(lockDirectory).then((entry) => Date.now() - entry.mtimeMs).catch(() => null);
        if (ageMs != null && ageMs < 1_000) { await new Promise((resolve) => setTimeout(resolve, 10)); continue; }
      }
      const stale = `${lockDirectory}.stale.${this.pid}.${ownerToken}`;
      try { await rename(lockDirectory, stale); }
      catch (error) { if (error?.code === 'ENOENT') continue; throw error; }
      await rm(stale, { recursive: true, force: true });
    }
    throw ownershipError(this.contendedCode, 'process ownership remained contended');
  }

  async assert(resourceInput, claim) {
    const resource = resourceName(resourceInput); const current = await this.read(resource);
    if (claim?.pid !== this.pid || !current || current.pid !== claim.pid
      || current.ownerToken !== claim?.ownerToken) {
      throw ownershipError(this.lostCode, 'process ownership was lost');
    }
    return true;
  }

  async release(resourceInput, claim) {
    const resource = resourceName(resourceInput); const { lockDirectory } = this.paths(resource);
    if (claim?.pid !== this.pid) return false;
    const current = await this.read(resource);
    if (!current || current.pid !== claim.pid || current.ownerToken !== claim.ownerToken) return false;
    const released = `${lockDirectory}.released.${this.pid}.${String(this.tokenFactory())}`;
    try { await rename(lockDirectory, released); }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
    await rm(released, { recursive: true, force: true }); return true;
  }
}

export class LocalRuntimeOwnership {
  constructor(directory, options = {}) {
    this.ownership = new DurableProcessOwnership(directory, {
      ...options, lockName: () => 'local-runtime.owner', activeReason: 'runtime_owner_active',
      contendedCode: 'runtime_owner_contended', lostCode: 'runtime_ownership_lost',
    });
  }
  acquire() { return this.ownership.acquire('runtime'); }
  assert(claim) { return this.ownership.assert('runtime', claim); }
  release(claim) { return this.ownership.release('runtime', claim); }
  read() { return this.ownership.read('runtime'); }
}
