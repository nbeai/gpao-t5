import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const safe = (value) => {
  const text = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{8,200}$/u.test(text)) throw new Error('authoring undo handle is unavailable');
  return text;
};

export class AuthoringUndoStore {
  constructor(directory, { makeId = randomUUID } = {}) {
    this.directory = directory; this.makeId = makeId;
  }
  async ensure() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); await chmod(this.directory, 0o700); }
  path(handle, suffix = 'ready') { return join(this.directory, `${safe(handle)}.${suffix}.json`); }
  async save({ sessionId, settlement }) {
    const transaction = settlement.verification.transaction;
    const targets = transaction.applied.map((item) => ({ pointer: item.pointer,
      expectedPostimage: item.expectedPostimage }));
    return this.saveTargets({ sessionId, planId: transaction.admission.prepared.plan.planId, targets });
  }
  async saveTargets({ sessionId, planId, targets }) {
    if (!Array.isArray(targets) || !targets.length || targets.length > 32) {
      throw new TypeError('authoring undo targets are invalid');
    }
    await this.ensure(); const handle = `undo_${String(this.makeId()).replaceAll('-', '_')}`;
    const manifest = { schema: 't5.authoring-undo.v1', handle, sessionId, state: 'ready',
      planId: String(planId ?? 'external_local_change'), targets,
      createdAt: new Date().toISOString() };
    const temporary = this.path(handle, `tmp_${process.pid}_${randomUUID()}`);
    await writeFile(temporary, JSON.stringify(manifest), { mode: 0o600 });
    await rename(temporary, this.path(handle)); return { handle, targetCount: targets.length };
  }
  async claim({ handle: raw, sessionId }) {
    const handle = safe(raw); await this.ensure(); const token = String(this.makeId()).replaceAll('-', '_');
    const claimedPath = this.path(handle, `claimed_${token}`);
    try { await rename(this.path(handle), claimedPath); }
    catch (error) { if (error?.code === 'ENOENT') throw new Error('authoring undo handle is stale'); throw error; }
    const manifest = JSON.parse(await readFile(claimedPath, 'utf8'));
    if (manifest.schema !== 't5.authoring-undo.v1' || manifest.handle !== handle
      || manifest.sessionId !== sessionId || manifest.state !== 'ready') throw new Error('authoring undo manifest is invalid');
    return { manifest, claimedPath, token };
  }
  async available({ handle: raw, sessionId }) {
    const handle = safe(raw); await this.ensure();
    try {
      const manifest = JSON.parse(await readFile(this.path(handle), 'utf8'));
      return manifest.schema === 't5.authoring-undo.v1' && manifest.handle === handle
        && manifest.sessionId === sessionId && manifest.state === 'ready';
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  async complete(claim, state) {
    const terminal = { ...claim.manifest, state, completedAt: new Date().toISOString() };
    await writeFile(claim.claimedPath, JSON.stringify(terminal), { mode: 0o600 });
    await rename(claim.claimedPath, this.path(claim.manifest.handle, `terminal_${state}`));
    return terminal;
  }
}
