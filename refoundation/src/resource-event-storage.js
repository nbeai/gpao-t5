import { mkdir, open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Default Node filesystem storage. Platform-specific durability can replace this interface. */
export class NodeResourceEventStorage {
  constructor(directory) {
    if (!directory) throw new TypeError('resource storage directory is required');
    this.directory = directory;
    this.file = join(directory, 'events.jsonl');
  }

  async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const handle = await open(this.file, 'a', 0o600); await handle.close();
  }

  async read() {
    try { return await readFile(this.file, 'utf8'); }
    catch (error) { if (error?.code === 'ENOENT') return ''; throw error; }
  }

  async append(line, { durable = false } = {}) {
    const handle = await open(this.file, 'a', 0o600);
    try {
      await handle.writeFile(line, { encoding: 'utf8' });
      if (durable) await handle.datasync();
    } finally {
      await handle.close();
    }
  }
}
