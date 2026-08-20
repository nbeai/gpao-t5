import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function clone(value) { return value == null ? value : structuredClone(value); }

export class WorkspaceCredentialStore {
  constructor(directory) {
    if (!directory) throw new TypeError('workspace credential directory is required');
    this.directory = directory;
    this.file = join(directory, 'workspace-connections.json');
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const state = JSON.parse(await readFile(this.file, 'utf8'));
      if (state?.version !== 1 || !state.connections || typeof state.connections !== 'object'
        || Array.isArray(state.connections)) throw new Error('unsupported workspace credential state');
      return state;
    } catch (error) {
      if (error?.code === 'ENOENT') return { version: 1, connections: {} };
      throw error;
    }
  }

  serialize(work) {
    const next = this.queue.then(work, work);
    this.queue = next.catch(() => {});
    return next;
  }

  async write(state) {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, this.file);
  }

  /** Internal credential read. Never return this object from a console endpoint or ToolReceipt. */
  async get(provider) {
    const entry = (await this.read()).connections[String(provider ?? '')];
    return entry ? clone(entry) : null;
  }

  async setVerified(provider, { credential, scopes = [], verifiedAt = Date.now() } = {}) {
    if (!credential || typeof credential !== 'object' || !credential.accessToken) {
      throw new TypeError('verified workspace credential is required');
    }
    const normalizedScopes = [...new Set((Array.isArray(scopes) ? scopes : []).map(String).filter(Boolean))];
    return this.serialize(async () => {
      const state = await this.read();
      state.connections[String(provider)] = {
        credential: clone(credential), scopes: normalizedScopes, verifiedAt,
      };
      await this.write(state);
      return true;
    });
  }

  async clear(provider) {
    return this.serialize(async () => {
      const state = await this.read();
      delete state.connections[String(provider ?? '')];
      if (!Object.keys(state.connections).length) await rm(this.file, { force: true });
      else await this.write(state);
      return true;
    });
  }

  async describe() {
    const state = await this.read();
    return Object.fromEntries(Object.entries(state.connections).map(([provider, entry]) => [provider, {
      connected: Boolean(entry?.credential?.accessToken || entry?.credential?.refreshToken),
      scopes: Array.isArray(entry?.scopes) ? [...entry.scopes] : [],
      verifiedAt: entry?.verifiedAt ?? null,
    }]));
  }
}
