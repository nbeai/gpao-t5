import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const SCHEMA = 't5.windows-search-projection.v1';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

function fileName(identifier) { return `${sha256(identifier).slice(0, 24)}.txt`; }
function rendered(item) { return `${item.title}\n\n${item.content}\n`; }

export function makeWindowsSearchProjectionDriver({ root: inputRoot } = {}) {
  const root = resolve(String(inputRoot ?? ''));
  const manifestPath = join(root, 'manifest.json'); let queue = Promise.resolve();
  const serial = (work) => { const next = queue.then(work, work); queue = next.catch(() => {}); return next; };

  async function ensure() {
    const existing = await stat(root);
    if (existing?.isSymbolicLink() || (existing && !existing.isDirectory())) {
      throw new Error('Windows Search projection root is unsafe');
    }
    await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700).catch(() => {});
    if (!await stat(manifestPath)) {
      await writeFile(manifestPath, `${JSON.stringify({ schema: SCHEMA, canonical: false, items: [] }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await chmod(manifestPath, 0o600).catch(() => {});
    }
  }

  async function readManifest() {
    await ensure(); const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (parsed.schema !== SCHEMA || parsed.canonical !== false || !Array.isArray(parsed.items)) {
      throw new Error('Windows Search projection manifest is invalid');
    }
    return parsed;
  }

  async function publish(manifest) {
    const candidate = join(root, `.manifest-${randomUUID()}.json`);
    await writeFile(candidate, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await chmod(candidate, 0o600).catch(() => {}); await rename(candidate, manifestPath);
  }

  return {
    verificationKind: 'derived_file_projection', root,
    async available() { try { await ensure(); return true; } catch { return false; } },
    async list({ domain }) {
      const manifest = await readManifest(); const items = [];
      for (const record of manifest.items.filter((item) => item.domain === domain)) {
        const path = join(root, record.fileName);
        if (basename(path) !== record.fileName || !/^[a-f0-9]{24}\.txt$/u.test(record.fileName)) {
          throw new Error('Windows Search projection file identity is invalid');
        }
        const body = await readFile(path, 'utf8');
        if (sha256(body) !== record.fileSha256) throw new Error('Windows Search projection file changed');
        const prefix = `${record.title}\n\n`;
        if (!body.startsWith(prefix) || !body.endsWith('\n')) throw new Error('Windows Search projection body is invalid');
        items.push({ identifier: record.identifier, domain: record.domain, memoryId: record.memoryId,
          revision: record.revision, title: record.title,
          content: body.slice(prefix.length, -1), contentDigest: record.contentDigest });
      }
      return items;
    },
    async index(items, { domain }) {
      return serial(async () => {
        const manifest = await readManifest(); const records = new Map(manifest.items.map((item) => [item.identifier, item]));
        for (const item of items) {
          if (item.domain !== domain) throw new Error('Windows Search projection domain mismatch');
          const name = fileName(item.identifier); const body = rendered(item); const candidate = join(root, `.${name}.${randomUUID()}`);
          await writeFile(candidate, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await chmod(candidate, 0o600).catch(() => {}); await rename(candidate, join(root, name));
          records.set(item.identifier, { identifier: item.identifier, domain, memoryId: item.memoryId,
            revision: item.revision, title: item.title, contentDigest: item.contentDigest,
            fileName: name, fileSha256: sha256(body) });
        }
        await publish({ schema: SCHEMA, canonical: false, items: [...records.values()] });
      });
    },
    async delete(identifiers, { domain }) {
      return serial(async () => {
        const manifest = await readManifest(); const remove = new Set(identifiers);
        for (const identifier of remove) {
          await unlink(join(root, fileName(identifier))).catch((error) => { if (error?.code !== 'ENOENT') throw error; });
        }
        await publish({ schema: SCHEMA, canonical: false,
          items: manifest.items.filter((item) => !(item.domain === domain && remove.has(item.identifier))) });
      });
    },
    async rebuild(items, { domain }) {
      return serial(async () => {
        const manifest = await readManifest();
        for (const entry of await readdir(root, { withFileTypes: true })) {
          if (entry.isFile() && /^[a-f0-9]{24}\.txt$/u.test(entry.name)) {
            await unlink(join(root, entry.name));
          }
        }
        await publish({ schema: SCHEMA, canonical: false,
          items: manifest.items.filter((item) => item.domain !== domain) });
        for (const item of items) {
          const name = fileName(item.identifier); const body = rendered(item); const candidate = join(root, `.${name}.${randomUUID()}`);
          await writeFile(candidate, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
          await chmod(candidate, 0o600).catch(() => {}); await rename(candidate, join(root, name));
        }
        const records = items.map((item) => { const body = rendered(item); return {
          identifier: item.identifier, domain, memoryId: item.memoryId, revision: item.revision,
          title: item.title, contentDigest: item.contentDigest, fileName: fileName(item.identifier),
          fileSha256: sha256(body),
        }; });
        await publish({ schema: SCHEMA, canonical: false,
          items: [...manifest.items.filter((item) => item.domain !== domain), ...records] });
      });
    },
  };
}
