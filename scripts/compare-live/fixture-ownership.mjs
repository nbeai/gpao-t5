import {
  chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

const digest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const identity = (path) => {
  const st = lstatSync(path);
  if (st.isSymbolicLink()) throw new Error(`심볼릭 링크는 fixture가 아니다: ${path}`);
  return { device: Number(st.dev), inode: Number(st.ino) };
};

export const createOwned = (downloads, files, anchorDir) => {
  mkdirSync(anchorDir, { recursive: true });
  const made = [];
  try {
    for (const [name, body] of Object.entries(files)) {
      const path = join(downloads, name);
      writeFileSync(path, body, { flag: 'wx' });
      const id = identity(path);
      const anchor = join(anchorDir, `${randomUUID()}-${name}`);
      linkSync(path, anchor);
      made.push({ path, anchor, ...id, sha256: digest(path) });
    }
  } catch (error) {
    cleanupOwned(made, join(anchorDir, 'rollback-snapshots'));
    throw error;
  }
  return made;
};

const sameIdentity = (record, path) => {
  if (!existsSync(path) || !existsSync(record.anchor)) return false;
  try {
    const pst = lstatSync(path);
    const ast = statSync(record.anchor);
    return !pst.isSymbolicLink()
      && Number(pst.dev) === Number(ast.dev)
      && Number(pst.ino) === Number(ast.ino)
      && Number(pst.dev) === record.device
      && Number(pst.ino) === record.inode;
  } catch {
    return false;
  }
};

const sameOwned = (record, path) => {
  return sameIdentity(record, path) && digest(path) === record.sha256;
};

export const chmodOwned = (record, mode) => {
  try {
    const ast = statSync(record.anchor);
    if (Number(ast.dev) !== record.device || Number(ast.ino) !== record.inode) return false;
    // 예측 불가능한 anchor가 가리키는 생성 inode만 바꾼다. 원래 경로가 교체돼도
    // 사용자 파일에는 권한 변경이 닿지 않는다.
    chmodSync(record.anchor, mode);
    if (!sameIdentity(record, record.path)) return false;
    // mode 000은 내용 재검사가 불가능하다. 해제(읽기 가능) 시에는 내용도 다시 확인한다.
    if ((mode & 0o444) !== 0 && !sameOwned(record, record.path)) return false;
    return true;
  } catch {
    return false;
  }
};

export const cleanupOwned = (records, snapshotDir) => {
  const removed = [];
  const preserved = [];
  mkdirSync(snapshotDir, { recursive: true });
  for (const record of records) {
    const path = record.path;
    if (!existsSync(path)) {
      try { unlinkSync(record.anchor); } catch { /* already absent */ }
      preserved.push({ path, reason: 'missing_or_replaced' });
      continue;
    }

    const quarantine = join(
      dirname(path),
      `.${basename(path)}.gpao-fixture-${randomUUID()}`,
    );
    try {
      renameSync(path, quarantine);
    } catch (error) {
      preserved.push({ path, reason: `quarantine_failed:${error.message}` });
      continue;
    }

    if (sameOwned(record, quarantine)) {
      copyFileSync(quarantine, join(snapshotDir, basename(path)));
      unlinkSync(quarantine);
      try { unlinkSync(record.anchor); } catch { /* already absent */ }
      removed.push(path);
      continue;
    }

    try {
      if (!existsSync(path)) {
        renameSync(quarantine, path);
        preserved.push({ path, reason: 'identity_changed_restored' });
      } else {
        preserved.push({ path: quarantine, reason: 'identity_changed_original_path_occupied' });
      }
    } catch (error) {
      preserved.push({ path: quarantine, reason: `restore_failed:${error.message}` });
    }
    try { unlinkSync(record.anchor); } catch { /* already absent */ }
  }
  return { removed, preserved };
};
