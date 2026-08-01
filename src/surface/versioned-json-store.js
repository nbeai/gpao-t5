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
  await chmod(target, 0o600);
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

// **파일 하나에 대한 읽기-병합-쓰기를 직렬화한다.** 병합만으로는 경쟁이 안 닫힌다 —
// 두 저장이 각자 현재를 읽고 각자 쓰면 나중 것이 앞 것을 지운다(오너 지적 2026-08-02).
// 같은 원리가 automation-run-ledger 에도 있다. 여기 한 자리로 모아 두 저장선이 같이 쓴다.
const 파일큐 = new Map();

export function serializeByFile(file, task) {
  const 앞 = 파일큐.get(file) ?? Promise.resolve();
  const 지금 = 앞.catch(() => {}).then(task);
  파일큐.set(file, 지금);
  return 지금.finally(() => { if (파일큐.get(file) === 지금) 파일큐.delete(file); });
}
