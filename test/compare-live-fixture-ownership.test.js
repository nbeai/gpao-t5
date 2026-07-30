import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  chmodOwned, cleanupOwned, createOwned,
} from '../scripts/compare-live/fixture-ownership.mjs';

test('비교 fixture: 생성한 같은 파일만 지우고 교체된 사용자 파일은 보존한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const records = createOwned(
      root,
      { 'owned.txt': 'runner fixture\n' },
      join(root, 'anchors'),
    );
    const path = join(root, 'owned.txt');

    unlinkSync(path);
    writeFileSync(path, 'user replacement\n');

    assert.equal(chmodOwned(records[0], 0o000), false);
    const result = cleanupOwned(records, join(root, 'snapshots'));
    assert.deepEqual(result.removed, []);
    assert.equal(result.preserved.length, 1);
    assert.equal(readFileSync(path, 'utf8'), 'user replacement\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('비교 fixture: 생성 신분과 내용이 그대로면 스냅샷 뒤 정리한다', () => {
  const root = mkdtempSync(join(tmpdir(), 't5-fixture-owner-'));
  try {
    const records = createOwned(
      root,
      { 'owned.txt': 'runner fixture\n' },
      join(root, 'anchors'),
    );
    const path = join(root, 'owned.txt');

    assert.equal(chmodOwned(records[0], 0o000), true);
    assert.equal(chmodOwned(records[0], 0o644), true);
    const result = cleanupOwned(records, join(root, 'snapshots'));
    assert.deepEqual(result.removed, [path]);
    assert.deepEqual(result.preserved, []);
    assert.equal(existsSync(path), false);
    assert.equal(readFileSync(join(root, 'snapshots', 'owned.txt'), 'utf8'), 'runner fixture\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
