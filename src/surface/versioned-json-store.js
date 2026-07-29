import { chmod, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

async function missing(error) {
  return error?.code === 'ENOENT';
}

export async function atomicWritePrivate(file, value) {
  const dir = dirname(file);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const temp = join(dir, `.${basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temp, 'wx', 0o600);
    await handle.writeFile(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temp, file);
    await chmod(file, 0o600);
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function quarantine(file, raw) {
  const target = `${file}.corrupt-${randomUUID()}`;
  await rename(file, target);
  return { corrupted: true, quarantinedFile: target, corruptBytes: Buffer.byteLength(raw) };
}

export async function loadVersionedJson(file, fallback, migrate, validateState) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (await missing(error)) return { state: structuredClone(fallback), migrated: false, recovery: null };
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const recovery = await quarantine(file, raw);
    return { state: structuredClone(fallback), migrated: false, recovery };
  }

  const state = migrate(parsed);
  validateState(state);
  const migrated = state !== parsed;
  if (migrated) await atomicWritePrivate(file, state);
  return { state, migrated, recovery: null };
}

export function assertStateRecords(records, validator, label) {
  for (const record of records ?? []) {
    const checked = validator(record);
    if (!checked.ok) throw new Error(`${label} invalid: ${checked.errors.join('; ')}`);
  }
}
