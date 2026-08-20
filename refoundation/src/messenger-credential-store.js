import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function clone(value) { return value == null ? value : structuredClone(value); }

export class MessengerCredentialStore {
  constructor(directory) {
    if (!directory) throw new TypeError('messenger credential directory is required');
    this.directory = directory;
    this.file = join(directory, 'messenger-credentials.json');
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'));
      if (value?.version !== 1 || !value.connections || typeof value.connections !== 'object') {
        throw new Error('unsupported messenger credential state');
      }
      return value;
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

  /** Internal runtime read. Never include this value in status, logs, receipts, or errors. */
  async get(provider) {
    const entry = (await this.read()).connections[String(provider ?? '')];
    return entry ? clone(entry) : null;
  }

  async setVerified(provider, { token, bot, verifiedAt = Date.now() } = {}) {
    if (!token || typeof token !== 'string') throw new TypeError('verified messenger token is required');
    return this.serialize(async () => {
      const state = await this.read();
      state.connections[String(provider)] = {
        token,
        bot: { id: String(bot?.id ?? ''), username: String(bot?.username ?? '') },
        verifiedAt,
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
      connected: Boolean(entry?.token),
      bot: entry?.bot ? clone(entry.bot) : null,
      verifiedAt: entry?.verifiedAt ?? null,
    }]));
  }
}
